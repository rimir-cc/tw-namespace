/*\
title: $:/plugins/rimir/namespace/relink-prettylink.js
type: application/javascript
module-type: relinkwikitextrule

Relink support for namespace-aware `[[…]]` / `[[text|target]]` refs.

When a tiddler T is renamed, every `[[ref]]` whose namespace resolution
points to T must be updated. We can't do a simple text-match because the
ref is usually NOT the literal title — it might be a short form that
walk-up, context, or self-prefix resolved against the source's location.

Strategy:
  1. For each match, ask the namespace resolver "what does this ref
     resolve to from this source, right now?"
  2. If the answer is fromTitle, the ref needs updating.
  3. Build a simulated post-rename wiki (fromTitle removed, toTitle added)
     and re-resolve the SAME ref text. If it still resolves to toTitle
     — meaning the user's short form remains valid even though the
     target moved — leave the ref alone.
  4. Try to find the SHORTEST suffix of toTitle that resolves to toTitle
     from the source post-rename. e.g. rename `a/b/c/d` → `a/b/c/e`
     from source `a/b/c`: try `e` first (resolves via self-prefix),
     then `c/e`, then full title. First valid form wins.
  5. Style preservation:
       - `[[oldFullTitle]]`           → `[[newFullTitle]]`
       - `[[shortRef]]` + short works → `[[newShortRef]]`
       - `[[shortRef]]` + only abs    → `[[shortRef|newFullTitle]]`
       - `[[label|target]]` keeps label, replaces target similarly

Batch renames (e.g. relink-titles cascading `knowledge/llm` → `knowledge/ai`):
each child rename runs this rule independently. Smart shortening
also helps here — `[[bar]]` from `knowledge/llm/foo` becomes `[[ai/bar]]`
when `knowledge/llm/bar` → `knowledge/ai/bar` (walk-up post-rename
catches the new title via the `knowledge` ancestor).

\*/

"use strict";

var resolver = require("$:/plugins/rimir/namespace/resolver.js");
var flags = require("$:/plugins/rimir/namespace/featureflags.js");

/* ---------- helpers ---------- */

/*
Extract a context prefix that the resolver should use when resolving refs
from sourceTitle. Mirrors the logic in filter.js's getContext() but
without access to a widget variable — we read only the persisted forms:
  1. The "context" field on the source tiddler (when implicit-context
     feature flag is on).
  2. A `\context <prefix>` pragma at the top of the source's text.
*/
function getContextForSource(sourceTitle, wiki) {
	if(!sourceTitle || !wiki) { return ""; }
	var t = wiki.getTiddler(sourceTitle);
	if(!t || !t.fields) { return ""; }
	// Pragma takes precedence over field (matches the rendering-time rule).
	var text = t.fields.text || "";
	var m = text.match(/^[ \t]*\\context[ \t]+(\S[^\r\n]*)/m);
	if(m) { return m[1].trim(); }
	if(flags.isEnabled("implicit-context", wiki) && t.fields.context) {
		return t.fields.context;
	}
	return "";
}

/*
Wrap a wiki so that fromTitle "no longer exists" and toTitle "now exists".
Used to evaluate the resolver against the post-rename state.

Goes beyond the bare existence check by also overriding `getTiddler`,
`each`, and `eachShadow` to surface the renamed tiddler under its new
title. This is needed for modules that scan the wiki to build derived
state from tiddler fields — notably `field-aliases.js`, whose per-wiki
cache is built from `each` + `eachShadow` and would otherwise still
attribute the alias tokens to the old title.

The synthesised tiddler carries `fromTiddler`'s fields with `title`
overridden to `toTitle`, so a downstream scan reads identical field
values to what relink will persist after the rename.
*/
function wrapWikiForRename(wiki, fromTitle, toTitle) {
	var fromTiddler = wiki.getTiddler(fromTitle);
	var sim = Object.create(wiki);
	function renamed() {
		if(!fromTiddler) { return undefined; }
		// Synthesise a tiddler under the new title carrying the same fields.
		// Cheap to build once per wrap; we'll reuse the reference.
		return new $tw.Tiddler(fromTiddler.fields, {title: toTitle});
	}
	var renamedTiddler = renamed();
	sim.tiddlerExists = function(title) {
		if(title === fromTitle) { return false; }
		if(title === toTitle) { return true; }
		return wiki.tiddlerExists(title);
	};
	sim.getTiddler = function(title) {
		if(title === fromTitle) { return undefined; }
		if(title === toTitle && renamedTiddler) { return renamedTiddler; }
		return wiki.getTiddler(title);
	};
	if(typeof wiki.each === "function") {
		sim.each = function(callback) {
			var sawTo = false;
			wiki.each(function(t, title) {
				if(title === fromTitle) { return; }
				if(title === toTitle) { sawTo = true; }
				callback(t, title);
			});
			// Inject the renamed tiddler under its new title — but only if
			// the wiki doesn't already have a tiddler at that title (relink
			// will reject the rename in that case anyway, but defensive).
			if(!sawTo && renamedTiddler) { callback(renamedTiddler, toTitle); }
		};
	}
	if(typeof wiki.isShadowTiddler === "function") {
		sim.isShadowTiddler = function(title) {
			if(title === fromTitle) { return false; }
			return wiki.isShadowTiddler(title);
		};
	}
	if(typeof wiki.eachShadow === "function") {
		sim.eachShadow = function(callback) {
			wiki.eachShadow(function(t, title) {
				if(title === fromTitle) { return; }
				callback(t, title);
			});
		};
	}
	return sim;
}

/*
Wrap a wiki so that fromTitle is treated as existing, regardless of its
actual state. Needed because relink's bulkops calls deleteTiddler(from)
BEFORE the nested relinkTiddler runs, so by the time our rule fires for
a cascaded child rename the original fromTitle is already gone — the
resolver can't reach what was the ref's target. With this wrap,
"current" resolution sees the world as it was just before the rename.
*/
function wrapWikiForPreRename(wiki, fromTitle) {
	var sim = Object.create(wiki);
	sim.tiddlerExists = function(title) {
		if(title === fromTitle) { return true; }
		return wiki.tiddlerExists(title);
	};
	if(typeof wiki.isShadowTiddler === "function") {
		sim.isShadowTiddler = function(title) {
			return wiki.isShadowTiddler(title);
		};
	}
	return sim;
}

function isExternal(ref) {
	return $tw.utils.isLinkExternal(ref);
}

/*
Pick a suffix of `toTitle` (split on `/`) that resolves back to `toTitle`
from `sourceTitle` against the post-rename `simWiki`. Returns the
candidate string, or null if only the full title works.

Selection policy:
  1. Try the SAME number of segments as the original ref first.
     This preserves the user's chosen "depth" — e.g. `[[b/c/d]]` (3 segs)
     stays a 3-segment form like `[[f/c/d]]` even when a 1-segment form
     `[[d]]` would also resolve.
  2. Otherwise try shortest-first from 1 up to (segs.length - 1).
  3. Full title is excluded — caller pins absolute as fallback.

System-namespace targets ($:/...) skip this entirely; absolute is the
only safe form for them.
*/
function findGoodSelfRef(toTitle, sourceTitle, simWiki, options, originalSegCount) {
	if(!toTitle || toTitle.indexOf("$:/") === 0) { return null; }
	var segs = toTitle.split("/");
	var maxI = segs.length - 1;
	if(maxI < 1) { return null; }
	function tryAt(i) {
		var candidate = segs.slice(segs.length - i).join("/");
		if(!candidate) { return null; }
		var r = resolver.resolve(candidate, sourceTitle, simWiki, options);
		if(r.resolved === toTitle) { return candidate; }
		return null;
	}
	// 1. Same length as the original ref (when in range).
	if(originalSegCount && originalSegCount >= 1 && originalSegCount <= maxI) {
		var same = tryAt(originalSegCount);
		if(same) { return same; }
	}
	// 2. Shortest-first fallback.
	for(var i = 1; i <= maxI; i++) {
		if(i === originalSegCount) { continue; }
		var hit = tryAt(i);
		if(hit) { return hit; }
	}
	return null;
}

/* ---------- relinkwikitextrule API ---------- */

exports.name = "namespaceprettylink";

/*
Indexer pass: report every `[[ref]]` and the title it currently resolves
to. Relink uses this to know which sources contain references to which
targets, so it can call exports.relink only on the right candidates.

Critical: must advance `this.parser.pos` past the match, otherwise the
relink wikitext walker loops forever on the same match (same convention
as flibbles' built-in prettylink relinker).

Source title comes from `options.settings.title` — relink wraps each
tiddler being scanned in a TiddlerContext whose `.title` is the source.
*/
exports.report = function(text, callback, options) {
	try {
		var rawDisplay = this.match[1];
		var rawTarget  = this.match[2];
		var ref = (rawTarget !== undefined ? rawTarget : rawDisplay);
		if(!ref || isExternal(ref)) { return; }
		var sourceTitle = options.settings && options.settings.title;
		var wiki = options.wiki;
		if(!sourceTitle || !wiki) {
			// Fall back to a literal-text report so a rename of a tiddler
			// whose exact title appears in the ref still triggers our relink.
			callback(ref, "[[" + ref + "]]");
			return;
		}
		var context = getContextForSource(sourceTitle, wiki);
		var result = resolver.resolve(ref, sourceTitle, wiki, {context: context});
		if(result.resolved) {
			callback(result.resolved, "[[" + ref + "]]");
		}
	} finally {
		this.parser.pos = this.matchRegExp.lastIndex;
	}
};

/*
Rename pass: rewrite refs whose current resolution matches fromTitle.
Returns {output: "<new text>"} or undefined to leave unchanged.
*/
exports.relink = function(text, fromTitle, toTitle, options) {
	var entry;
	try {
		var rawDisplay = this.match[1];
		var rawTarget  = this.match[2];
		var ref = (rawTarget !== undefined ? rawTarget : rawDisplay);
		if(!ref || isExternal(ref)) { return undefined; }
		var sourceTitle = options.settings && options.settings.title;
		var wiki = options.wiki;
		if(!sourceTitle || !wiki) { return undefined; }
		var context = getContextForSource(sourceTitle, wiki);
		var refSegCount = ref.split("/").length;

		// Does this ref currently point to the renamed tiddler?
		// Use a pre-rename wiki so cascaded child renames (where bulkops
		// already deleted the old fromTitle before the nested relinkTiddler
		// fires) still see the original target.
		var preWiki = wrapWikiForPreRename(wiki, fromTitle);
		var current = resolver.resolve(ref, sourceTitle, preWiki, {context: context});
		if(current.status === "out-of-scope") {
			// Source is outside the namespace whitelist — namespace machinery
			// (walk-up, context, alias, mount, pseudo, self-prefix) doesn't
			// apply. But absolute-title refs are still text matches that the
			// rename should fix; flibbles' built-in prettylink rule would
			// otherwise be eclipsed by ours since both share the same regex.
			// Handle the absolute-title cases here and defer everything else.
			if(rawTarget !== undefined) {
				if(rawTarget === fromTitle) {
					entry = {output: "[[" + rawDisplay + "|" + toTitle + "]]"};
				}
			} else if(ref === fromTitle) {
				entry = {output: "[[" + toTitle + "]]"};
			}
			// Short refs from OOS sources can't have resolved to fromTitle by
			// namespace logic (the resolver would have returned out-of-scope),
			// and can't be rewritten as literal text either, so leave alone.
			return entry;
		}
		if(current.resolved !== fromTitle) { return undefined; }

		// Will the same ref still resolve to toTitle after the rename?
		var simWiki = wrapWikiForRename(wiki, fromTitle, toTitle);
		var afterSame = resolver.resolve(ref, sourceTitle, simWiki, {context: context});

		var newText;
		if(rawTarget !== undefined) {
			// `[[label|target]]` — keep label, replace target.
			if(afterSame.resolved === toTitle) { return undefined; }
			var newTarget;
			if(rawTarget === fromTitle) {
				// User wrote the full title explicitly — keep absolute style.
				newTarget = toTitle;
			} else {
				// Smart-replace the target portion; fall back to absolute.
				var targetSegCount = rawTarget.split("/").length;
				newTarget = findGoodSelfRef(toTitle, sourceTitle, simWiki, {context: context}, targetSegCount) || toTitle;
			}
			newText = "[[" + rawDisplay + "|" + newTarget + "]]";
		} else if(ref === fromTitle) {
			// Absolute literal — rewrite to new absolute literal.
			newText = "[[" + toTitle + "]]";
		} else if(afterSame.resolved === toTitle) {
			// Short ref still resolves correctly — leave alone.
			return undefined;
		} else {
			// Try to find a new short form that resolves post-rename,
			// preferring the same segment count as the original ref. If
			// found, use it as both display and target. Else preserve the
			// original display text via a labeled absolute pin.
			var shortRef = findGoodSelfRef(toTitle, sourceTitle, simWiki, {context: context}, refSegCount);
			if(shortRef) {
				if(shortRef === ref) { return undefined; }
				newText = "[[" + shortRef + "]]";
			} else {
				newText = "[[" + ref + "|" + toTitle + "]]";
			}
		}
		entry = {output: newText};
	} finally {
		this.parser.pos = this.matchRegExp.lastIndex;
	}
	return entry;
};

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
*/
function wrapWikiForRename(wiki, fromTitle, toTitle) {
	var sim = Object.create(wiki);
	sim.tiddlerExists = function(title) {
		if(title === fromTitle) { return false; }
		if(title === toTitle) { return true; }
		return wiki.tiddlerExists(title);
	};
	if(typeof wiki.isShadowTiddler === "function") {
		sim.isShadowTiddler = function(title) {
			if(title === fromTitle) { return false; }
			return wiki.isShadowTiddler(title);
		};
	}
	return sim;
}

function isExternal(ref) {
	return $tw.utils.isLinkExternal(ref);
}

/*
Find the shortest suffix of `toTitle` (split on `/`) that resolves back to
`toTitle` from `sourceTitle` against the post-rename `simWiki`. Returns
the candidate string, or null if only the full title works (caller falls
back to a label-preserving absolute pin in that case).

The full title is excluded from the search — it's the trivial fallback
and should be handled by the caller's pin branch when no shorter form
resolves.

System-namespace targets ($:/...) skip this entirely; absolute is the
only safe form for them.
*/
function findShortestSelfRef(toTitle, sourceTitle, simWiki, options) {
	if(!toTitle || toTitle.indexOf("$:/") === 0) { return null; }
	var segs = toTitle.split("/");
	for(var i = 1; i < segs.length; i++) {
		var candidate = segs.slice(segs.length - i).join("/");
		if(!candidate) { continue; }
		var r = resolver.resolve(candidate, sourceTitle, simWiki, options);
		if(r.resolved === toTitle) { return candidate; }
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

		// Does this ref currently point to the renamed tiddler?
		var current = resolver.resolve(ref, sourceTitle, wiki, {context: context});
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
				// Try smart shortening for the target portion; fall back to
				// the absolute new title.
				newTarget = findShortestSelfRef(toTitle, sourceTitle, simWiki, {context: context}) || toTitle;
			}
			newText = "[[" + rawDisplay + "|" + newTarget + "]]";
		} else if(ref === fromTitle) {
			// Absolute literal — rewrite to new absolute literal.
			newText = "[[" + toTitle + "]]";
		} else if(afterSame.resolved === toTitle) {
			// Short ref still resolves correctly — leave alone.
			return undefined;
		} else {
			// Try to find a new short form that resolves post-rename. If
			// found, use it as both display and target. Else preserve the
			// original display text via a labeled absolute pin.
			var shortRef = findShortestSelfRef(toTitle, sourceTitle, simWiki, {context: context});
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

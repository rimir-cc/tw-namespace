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
  4. Otherwise rewrite. Style preservation:
       - `[[label|target]]` → keep label, replace target with toTitle
       - `[[oldFullTitle]]` → `[[toTitle]]` (absolute → absolute)
       - `[[shortRef]]`     → `[[shortRef|toTitle]]` (preserve display
         while pinning the target absolutely; user can re-shorten later)

Batch renames (e.g. relink-titles cascading `knowledge/llm` → `knowledge/ai`):
each child rename runs this rule independently. Because relink processes
them sequentially and doesn't expose the full batch, we can't know that
the source itself will be renamed in a parallel way — so short refs in
in-subtree sources get pinned to the absolute new target. After the
source's own rename runs, the absolute ref still resolves correctly.

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
			// `[[label|target]]` — keep label, replace target with toTitle
			// unless the existing target text would still resolve correctly.
			if(afterSame.resolved === toTitle) { return undefined; }
			newText = "[[" + rawDisplay + "|" + toTitle + "]]";
		} else if(ref === fromTitle) {
			// Absolute literal — rewrite to new absolute literal.
			newText = "[[" + toTitle + "]]";
		} else if(afterSame.resolved === toTitle) {
			// Short ref still resolves correctly — leave alone.
			return undefined;
		} else {
			// Short ref no longer resolves; preserve display text via a
			// labeled form pinning the absolute target.
			newText = "[[" + ref + "|" + toTitle + "]]";
		}
		entry = {output: newText};
	} finally {
		this.parser.pos = this.matchRegExp.lastIndex;
	}
	return entry;
};

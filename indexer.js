/*\
title: $:/plugins/rimir/namespace/indexer.js
type: application/javascript
module-type: library

Backlinks indexer — tracks which source tiddlers reference which
//resolved// targets. Core TW's backlink cascade only sees the literal
link text (e.g. `V3.3`) because our parser emits filtered `to`
attributes; this module gives you the real graph.

Scanning strategy: regex over the tiddler's `text` field for `[[REF]]`,
`[[label|REF]]`, and `{{REF}}` / `{{REF||template}}` forms. Cheap, has
occasional false positives inside code blocks — the trade-off is
acceptable for a backlinks view (extra edges never hurt lookup).

Per-source context detection:

  1. `\context <prefix>` pragma on the first non-blank body line.
  2. `context` field on the source tiddler.
  3. No context.

The `<$context>` widget's scoped context is //not// tracked — backlinks
for refs inside a mid-body widget use the whole-tiddler context only.
Documented as a known limitation.

Change tracking: full rebuild on startup (idle, after 1 tick so other
startup modules finish first); incremental per change event. Refs
indexed for a given source are stored forward so we can remove them
cleanly on re-index.

\*/

"use strict";

var resolver = require("$:/plugins/rimir/namespace/resolver.js");

// Forward: sourceTitle → Set<targetTitle>
// (so we can remove a source's old edges on re-index cleanly).
var forward = Object.create(null);
// Reverse: targetTitle → Set<sourceTitle>
var reverse = Object.create(null);

function addEdge(source, target) {
	if(!forward[source]) { forward[source] = Object.create(null); }
	forward[source][target] = true;
	if(!reverse[target]) { reverse[target] = Object.create(null); }
	reverse[target][source] = true;
}

function removeSource(source) {
	var targets = forward[source];
	if(!targets) { return; }
	for(var target in targets) {
		if(reverse[target]) {
			delete reverse[target][source];
			// Leave empty object rather than deleting — negligible memory,
			// keeps shape stable for callers that iterate.
		}
	}
	delete forward[source];
}

// Regexes are deliberately forgiving — extra spurious matches cost
// nothing, missed matches cost backlinks.
var RE_PRETTYLINK = /\[\[(?:[^\]|\n]*\|)?([^\]\n]+)\]\]/g;
// {{REF}} and {{REF||template}} but NOT {{{filter}}} (triple-brace).
var RE_TRANSCLUDE = /(^|[^{])\{\{([^{}|][^{}|]*)(?:\|\|[^{}]*)?\}\}(?!\})/g;
var RE_CONTEXT_PRAGMA = /^\s*\\context\s+(\S+)/m;

function extractRefs(text) {
	var refs = [];
	if(!text) { return refs; }
	var m;
	RE_PRETTYLINK.lastIndex = 0;
	while((m = RE_PRETTYLINK.exec(text)) !== null) { refs.push(m[1]); }
	RE_TRANSCLUDE.lastIndex = 0;
	while((m = RE_TRANSCLUDE.exec(text)) !== null) { refs.push(m[2]); }
	return refs;
}

function detectContext(tiddler) {
	if(!tiddler || !tiddler.fields) { return ""; }
	if(tiddler.fields.context) { return tiddler.fields.context; }
	var text = tiddler.fields.text || "";
	var m = text.match(RE_CONTEXT_PRAGMA);
	return m ? m[1] : "";
}

function isIndexable(tiddler) {
	if(!tiddler || !tiddler.fields) { return false; }
	var type = tiddler.fields.type;
	// wikitext (unset or vnd.tiddlywiki) and markdown carry our syntax.
	// Everything else (JSON data, images, css, js, code) is skipped.
	if(!type || type === "text/vnd.tiddlywiki" || type === "text/x-markdown") {
		return true;
	}
	return false;
}

function indexSource(title, wiki) {
	removeSource(title);
	var tiddler = wiki.getTiddler(title);
	if(!isIndexable(tiddler)) { return; }
	var refs = extractRefs(tiddler.fields.text);
	if(!refs.length) { return; }
	var context = detectContext(tiddler),
		opts = context ? {context: context} : undefined;
	for(var i = 0; i < refs.length; i++) {
		var r = resolver.resolve(refs[i], title, wiki, opts);
		if(r.resolved) { addEdge(title, r.resolved); }
	}
}

/*
Index all tiddlers + shadows. Safe to call multiple times — each source
is cleaned up before re-indexing. Expensive but linear in wiki size;
call from startup (once) and on bulk changes.
*/
exports.rebuildAll = function(wiki) {
	forward = Object.create(null);
	reverse = Object.create(null);
	if(wiki.each) {
		wiki.each(function(tiddler, title) { indexSource(title, wiki); });
	}
	if(wiki.eachShadow) {
		wiki.eachShadow(function(tiddler, title) { indexSource(title, wiki); });
	}
};

/*
Re-index a single source tiddler. If the tiddler no longer exists or
isn't indexable, its edges are dropped.
*/
exports.reindex = function(title, wiki) {
	indexSource(title, wiki);
};

/*
Bulk re-index — for change events with multiple changed titles.
*/
exports.reindexMany = function(titles, wiki) {
	for(var i = 0; i < titles.length; i++) { indexSource(titles[i], wiki); }
};

/*
Return an array of source titles that reference `target` (via whatever
route — literal, alias, mount, context, walk-up). Sorted alphabetically
for stable output.
*/
exports.getBacklinks = function(target) {
	var sources = reverse[target];
	if(!sources) { return []; }
	return Object.keys(sources).sort();
};

/*
Return the resolved targets a source tiddler currently references.
Useful for diagnostics and for the settings tab.
*/
exports.getForwardLinks = function(source) {
	var targets = forward[source];
	if(!targets) { return []; }
	return Object.keys(targets).sort();
};

/*
Empty the index. Tests use this between wikis; normal runtime doesn't
need it (the startup hook calls rebuildAll which is idempotent).
*/
exports.reset = function() {
	forward = Object.create(null);
	reverse = Object.create(null);
};

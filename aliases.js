/*\
title: $:/plugins/rimir/namespace/aliases.js
type: application/javascript
module-type: library

Named alias resolution.

Two shapes, both declarative via tagged tiddlers (no JS required):

  Exact aliases — tiddler tagged `$:/tags/NamespaceAlias` with fields:
      short:       the token the user types in refs (required)
      expands-to:  the rewritten ref (required)
    Looked up via O(1) hash.

  Pattern aliases — tiddler tagged `$:/tags/NamespacePatternAlias`:
      pattern:     JS regex source (required) — NOT auto-anchored;
                   include ^ and $ yourself if you want whole-ref match.
      replacement: substitution template, supports $1…$9 captures
    Tried in title order; first match wins.

Exact wins over pattern. The resolver.resolve() pipeline applies aliases
up to 3 hops deep (cycle safety) before pseudo-segment expansion, so an
alias can expand to a path containing `_latest` or other pseudos.

Cache is built lazily on first use and dropped whole on any wiki change
(startup.js hooks this). Rebuild cost is O(A) over the alias-tagged
tiddler set, typically small.

\*/

"use strict";

var EXACT_TAG   = "$:/tags/NamespaceAlias";
var PATTERN_TAG = "$:/tags/NamespacePatternAlias";

// Cache keyed per-wiki (WeakMap) so multiple concurrent wikis — in
// practice only matters for tests — don't share stale entries.
// Entry shape: {exact: {short → expansion}, patterns: [{regex, replacement, title}]}
var caches = typeof WeakMap !== "undefined" ? new WeakMap() : null;

function iterateTaggedTitles(wiki, tag, cb) {
	var titles = wiki.filterTiddlers("[all[tiddlers+shadows]tag[" + tag + "]]");
	for(var i = 0; i < titles.length; i++) { cb(titles[i]); }
}

function buildCache(wiki) {
	var entry = caches && caches.get(wiki);
	if(entry) { return entry; }
	entry = {exact: Object.create(null), patterns: []};
	iterateTaggedTitles(wiki, EXACT_TAG, function(title) {
		var t = wiki.getTiddler(title);
		if(!t || !t.fields) { return; }
		var short = t.fields["short"],
			expansion = t.fields["expands-to"];
		if(typeof short === "string" && short && typeof expansion === "string" && expansion) {
			entry.exact[short] = expansion;
		}
	});
	iterateTaggedTitles(wiki, PATTERN_TAG, function(title) {
		var t = wiki.getTiddler(title);
		if(!t || !t.fields) { return; }
		var pattern = t.fields["pattern"],
			replacement = t.fields["replacement"];
		if(typeof pattern !== "string" || !pattern) { return; }
		if(typeof replacement !== "string") { return; }
		try {
			entry.patterns.push({
				regex: new RegExp(pattern),
				replacement: replacement,
				title: title
			});
		} catch(e) {
			if(typeof console !== "undefined" && console.error) {
				console.error("namespace: invalid alias pattern in " + title + ": " + e.message);
			}
		}
	});
	if(caches) { caches.set(wiki, entry); }
	return entry;
}

/*
Look up an alias for `ref`. Returns the rewritten ref, or null if no
alias matched (exact lookup first, then patterns in definition order).
The caller is responsible for depth-limiting repeated application if it
wants to support chained aliases.
*/
exports.resolveAlias = function(ref, wiki) {
	if(!ref) { return null; }
	var cache = buildCache(wiki);
	if(cache.exact[ref]) { return cache.exact[ref]; }
	for(var i = 0; i < cache.patterns.length; i++) {
		var p = cache.patterns[i],
			m = ref.match(p.regex);
		if(m) {
			return ref.replace(p.regex, p.replacement);
		}
	}
	return null;
};

/*
Drop the alias cache. Next lookup rebuilds. With no wiki argument, drops
every wiki's cache — matches the existing call signature from startup.js.
*/
exports.invalidateAliases = function(wiki) {
	if(!caches) { return; }
	if(wiki) { caches.delete(wiki); } else { caches = new WeakMap(); }
};

/*\
title: $:/plugins/rimir/namespace/field-aliases.js
type: application/javascript
module-type: library

Target-attached aliases.

A tiddler can declare alternative names by listing them in a configured
field (default `aliases`, configurable via
`$:/config/rimir/namespace/alias-field`). Each token is a free-form string
that callers can use as a ref:

    title:   project/widget
    aliases: Widget [[Foo Bar]] OldName

References `[[Widget]]`, `[[Foo Bar]]`, `[[OldName]]` then all resolve to
`project/widget`. The field is parsed as a TW title list, so multi-word
tokens use `[[...]]` wrapping.

Distinction from `aliases.js` (`$:/tags/NamespaceAlias`): that module is
a separate-tiddler rewrite (`short` → `expands-to` path). This module is
target-attached — the alias values live on the same tiddler the ref
should point to.

Ambiguity policy: when two or more tiddlers declare the same alias token,
`resolveFieldAlias()` returns a sentinel with the colliding titles so the
resolver can surface the conflict instead of silently picking one. The
caller is expected to style the link as unresolved and present the
diagnostic to the user.

Cache: built lazily per-wiki via WeakMap, dropped wholesale on any wiki
change (startup.js hooks this). Rebuild cost is O(N) over tiddlers+shadows
with the configured field; for typical wikis this is small. Iteration uses
`wiki.each` / `wiki.eachShadow` so a wrapped wiki (e.g. the relink
post-rename simulation) sees the simulated state and builds a separate
cache for the simulated wiki object.

\*/

"use strict";

var FIELD_CONFIG = "$:/config/rimir/namespace/alias-field";
var DEFAULT_FIELD = "aliases";

// WeakMap<wiki, {field: string, tokenToTitles: Object<token, [titles]>}>
/* istanbul ignore next — WeakMap fallback is for ancient engines */
var caches = typeof WeakMap !== "undefined" ? new WeakMap() : null;

function getConfiguredField(wiki) {
	if(!wiki || typeof wiki.getTiddlerText !== "function") { return DEFAULT_FIELD; }
	var raw = wiki.getTiddlerText(FIELD_CONFIG, DEFAULT_FIELD);
	var name = (raw || "").trim();
	if(!name) { return DEFAULT_FIELD; }
	// Field names in TW are case-insensitive lookups but always stored
	// lowercase; normalise here so a config like "Aliases" works.
	return name.toLowerCase();
}

exports.getAliasField = getConfiguredField;

function parseTokens(rawValue) {
	if(rawValue == null || rawValue === "") { return []; }
	if($tw && $tw.utils && typeof $tw.utils.parseStringArray === "function") {
		return $tw.utils.parseStringArray(String(rawValue)) || [];
	}
	/* istanbul ignore next — fallback when running outside TW */
	return String(rawValue).split(/\s+/).filter(Boolean);
}

function addEntries(field, tokenToTitles, tiddler, title) {
	if(!tiddler || !tiddler.fields) { return; }
	var raw = tiddler.fields[field];
	if(!raw) { return; }
	var tokens = parseTokens(raw);
	for(var i = 0; i < tokens.length; i++) {
		var token = tokens[i];
		if(!token) { continue; }
		var bucket = tokenToTitles[token];
		if(!bucket) {
			bucket = [];
			tokenToTitles[token] = bucket;
		}
		// Deduplicate — a single tiddler shouldn't appear twice for one token
		// even if the author repeats it in the field value.
		if(bucket.indexOf(title) === -1) { bucket.push(title); }
	}
}

function buildCache(wiki) {
	var entry = caches && caches.get(wiki);
	if(entry) { return entry; }
	var field = getConfiguredField(wiki);
	var tokenToTitles = Object.create(null);
	if(typeof wiki.each === "function") {
		wiki.each(function(t, title) { addEntries(field, tokenToTitles, t, title); });
	}
	if(typeof wiki.eachShadow === "function") {
		wiki.eachShadow(function(t, title) {
			// Skip when a regular tiddler already declared the same alias —
			// the regular version overrides the shadow (TW convention).
			// We don't pre-filter by tiddler-existence here: shadow entries
			// can stand on their own; collision detection still surfaces if
			// both a regular tiddler AND a different shadow share a token.
			addEntries(field, tokenToTitles, t, title);
		});
	}
	entry = {field: field, tokenToTitles: tokenToTitles};
	/* istanbul ignore else — caches null only on ancient engines */
	if(caches) { caches.set(wiki, entry); }
	return entry;
}

/*
Look up a single alias token. Returns:
  null                                        — no match
  {ambiguous: false, title: "<title>"}        — single match
  {ambiguous: true, candidates: [titles]}     — collision (two or more)

Multi-target results never auto-pick a winner. Callers should style the
link as unresolved-with-ambiguity and present the candidates to the user
so they can disambiguate at the source (remove the alias from all but one
target tiddler).
*/
exports.resolveFieldAlias = function(token, wiki) {
	if(!token || !wiki) { return null; }
	var cache = buildCache(wiki);
	var hits = cache.tokenToTitles[token];
	if(!hits || !hits.length) { return null; }
	if(hits.length === 1) {
		return {ambiguous: false, title: hits[0]};
	}
	// Return a defensive copy — callers should be able to mutate freely.
	return {ambiguous: true, candidates: hits.slice()};
};

/*
Return all current ambiguous tokens for diagnostic surfaces (settings tab
listing, indexer warnings). Shape: [{token, candidates: [titles]}, ...]
sorted by token. Returns an empty array when no collisions exist.
*/
exports.getAmbiguities = function(wiki) {
	if(!wiki) { return []; }
	var cache = buildCache(wiki);
	var results = [];
	var keys = Object.keys(cache.tokenToTitles).sort();
	for(var i = 0; i < keys.length; i++) {
		var hits = cache.tokenToTitles[keys[i]];
		if(hits.length > 1) {
			results.push({token: keys[i], candidates: hits.slice()});
		}
	}
	return results;
};

/*
Return the configured field name (useful for diagnostic messages so the
user knows which field to edit).
*/
exports.getFieldName = function(wiki) {
	return getConfiguredField(wiki);
};

/*
Drop the field-alias cache. With no argument, drops every wiki's cache
(used by tests and by wiki-less invalidation). With a wiki, drops only
that wiki's cache — matches the existing module call signatures.
*/
exports.invalidate = function(wiki) {
	/* istanbul ignore if — caches null only on ancient engines */
	if(!caches) { return; }
	if(wiki) { caches.delete(wiki); } else { caches = new WeakMap(); }
};

/*
Check whether a TW changes object touches the field-alias config tiddler.
Used by startup.js to know it needs to invalidate.
*/
exports.isConfigChange = function(changes) {
	return !!(changes && changes[FIELD_CONFIG]);
};

/*
Determine whether any of `titles` is a (current or previous) contributor
to the field-alias index. Used by startup.js to decide whether a tiddler
change requires a full backlinks rebuild — `reindexMany(changedTitles)`
alone misses the case where a target's aliases field changed and the
SOURCES that reference those aliases didn't.

Call this BEFORE `invalidate(wiki)` so the cache still reflects the
pre-change state for the "previously had" check. Returns true on first
match.
*/
exports.containsAffectedTiddler = function(titles, wiki) {
	if(!wiki || !titles || !titles.length) { return false; }
	var field = getConfiguredField(wiki);
	var cache = caches && caches.get(wiki);
	for(var i = 0; i < titles.length; i++) {
		var title = titles[i];
		// Currently has the field?
		var t = (typeof wiki.getTiddler === "function") ? wiki.getTiddler(title) : null;
		if(t && t.fields && t.fields[field]) { return true; }
		// Previously contributed (per the pre-invalidation cache)?
		if(cache) {
			var buckets = cache.tokenToTitles;
			for(var token in buckets) {
				if(buckets[token].indexOf(title) !== -1) { return true; }
			}
		}
	}
	return false;
};

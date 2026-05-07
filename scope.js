/*\
title: $:/plugins/rimir/namespace/scope.js
type: application/javascript
module-type: library

Source-scope gate for the namespace plugin.

Two modes:

  global    — namespace behavior applies to every source tiddler (default).
              Bit-for-bit identical to the pre-scope behavior.

  prefixes  — namespace behavior only applies when the source tiddler's
              title starts (at a segment boundary) with one of a configured
              set of prefixes. Sources outside that set short-circuit the
              resolver entirely (status "out-of-scope") so refs there get
              vanilla TW link rendering — no walk-up, context, alias, mount,
              pseudo, or self-prefix. References into namespace areas from
              outside MUST be fully qualified by design.

Config tiddlers (live, no restart needed):

  $:/config/rimir/namespace/scope-mode      — "global" (default) or "prefixes"
  $:/config/rimir/namespace/scope-prefixes  — newline-separated list of
                                              prefixes (one per line)

The match is segment-boundary literal: prefix "knowledge" covers exactly
"knowledge" and any descendant "knowledge/...", but NOT "knowledgeBase/x".
Whitespace and blank lines in the list are tolerated.

Reading both tiddlers on every resolve would be expensive; we cache the
parsed shape and the startup change listener calls invalidate() when
either tiddler changes (see startup.js).

\*/

"use strict";

var MODE_TIDDLER = "$:/config/rimir/namespace/scope-mode";
var PREFIXES_TIDDLER = "$:/config/rimir/namespace/scope-prefixes";

// null = not yet read. Object: {mode: "global"|"prefixes", prefixes: [string,...]}
var cached = null;

function read(wiki) {
	if(cached) { return cached; }
	var rawMode = wiki.getTiddlerText(MODE_TIDDLER, "global");
	var mode = (rawMode || "").trim();
	// Anything other than the exact string "prefixes" falls back to global —
	// defensive against typos / partial config writes.
	mode = (mode === "prefixes") ? "prefixes" : "global";
	var rawPrefixes = wiki.getTiddlerText(PREFIXES_TIDDLER, "") || "";
	var prefixes = [];
	if(rawPrefixes.trim()) {
		var lines = rawPrefixes.split(/\r?\n/);
		for(var i = 0; i < lines.length; i++) {
			var p = lines[i].trim();
			// Strip trailing slashes — typing "knowledge/" should behave the
			// same as "knowledge". Without this the boundary check below
			// (which appends "/" before comparing) would look for
			// "knowledge//..." and never match.
			while(p.charAt(p.length - 1) === "/") { p = p.substring(0, p.length - 1); }
			if(p) { prefixes.push(p); }
		}
	}
	cached = {mode: mode, prefixes: prefixes};
	return cached;
}

/*
Decide whether a source tiddler is subject to namespace behavior.

  sourceTitle — title of the tiddler the ref is rendered/relinked from.
                May be empty/null/undefined.
  wiki        — used for live config lookup.

Returns true (run namespace) or false (skip; treat as out-of-scope).
*/
exports.isInScope = function(sourceTitle, wiki) {
	var s = read(wiki);
	if(s.mode === "global") { return true; }
	// In prefixes mode an empty source can't be matched — anything that
	// reaches the resolver without a known source falls through to OOS so
	// the caller's <$link> renders the raw ref without namespace styling.
	if(!sourceTitle) { return false; }
	for(var i = 0; i < s.prefixes.length; i++) {
		var p = s.prefixes[i];
		if(sourceTitle === p) { return true; }
		if(sourceTitle.indexOf(p + "/") === 0) { return true; }
	}
	return false;
};

exports.invalidate = function() {
	cached = null;
};

/*
Whether a TW change set (map of titles → true) touches a scope config
tiddler. Used by startup.js to decide whether to invalidate the cache
and trigger a backlinks rebuild.
*/
exports.isConfigChange = function(changes) {
	if(!changes) { return false; }
	return !!(changes[MODE_TIDDLER] || changes[PREFIXES_TIDDLER]);
};

// Exposed for tests + diagnostics.
exports.MODE_TIDDLER = MODE_TIDDLER;
exports.PREFIXES_TIDDLER = PREFIXES_TIDDLER;

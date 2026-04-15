/*\
title: $:/plugins/rimir/namespace/resolver.js
type: application/javascript
module-type: library

Pure resolver for namespace-aware link references.

Resolution order for a reference REF looked up from source tiddler SRC:

  1. Literal     — REF exists as-is (covers $:/… system titles).
  2. Absolute    — REF contains '/', looked up literally (identical to #1
                   in stage 1; becomes meaningful once mount points land).
  3. Walk-up     — walk prefixes of SRC (excluding SRC's own last segment)
                   and try "<prefix>/REF" at each depth. First hit wins.
  4. Unresolved  — no candidate matched.

No caching in stage 1 — wiki.tiddlerExists is already O(1) and walk depth
is small. Resolution is invoked at render time (via the ns-resolve filter
operator), so the source tiddler comes from the widget's currentTiddler.

\*/

"use strict";

/*
Split a tiddler title into path segments on '/'. Titles starting with '$:/'
return a single segment for the whole title — we never walk up into the
system namespace.
*/
exports.splitPath = function(title) {
	if(!title) { return []; }
	if(title.indexOf("$:/") === 0) { return [title]; }
	return title.split("/");
};

/*
Check whether a tiddler exists as a regular OR shadow tiddler. Shadow
tiddlers (from plugins like $:/core) must count as "resolved" or every
[[$:/ControlPanel]]-style link would be flagged unresolved.
*/
function exists(wiki, title) {
	return wiki.tiddlerExists(title) || (wiki.isShadowTiddler && wiki.isShadowTiddler(title));
}

/*
Resolve a reference.

ref:         the raw link target as the user typed it (e.g. "V3.3")
sourceTitle: title of the tiddler being rendered
wiki:        object with tiddlerExists(title) and isShadowTiddler(title)
             (pass $tw.wiki)

Returns: {status, resolved, tried}
  status:   "literal" | "absolute" | "walkup" | "unresolved"
  resolved: resolved title or null
  tried:    ordered array of every title we checked (useful for tooltips)
*/
exports.resolve = function(ref, sourceTitle, wiki) {
	var tried = [];
	if(!ref) {
		return {status: "unresolved", resolved: null, tried: tried};
	}
	// 1. Literal — always try first so $:/… and exact-title refs win.
	tried.push(ref);
	if(exists(wiki, ref)) {
		return {status: "literal", resolved: ref, tried: tried};
	}
	// 2. Absolute (ref contains '/'): stop after the literal check — don't
	//    walk up. In stage 1 this branch is identical to #1; it becomes
	//    meaningful once mount points prepend a root prefix.
	if(ref.indexOf("/") !== -1) {
		return {status: "unresolved", resolved: null, tried: tried};
	}
	// System-namespace refs never walk up.
	if(ref.indexOf("$:/") === 0) {
		return {status: "unresolved", resolved: null, tried: tried};
	}
	// 3. Walk-up from the source tiddler's prefix.
	if(sourceTitle) {
		var segs = exports.splitPath(sourceTitle);
		// Start from parent of source (i = segs.length - 1 drops SRC's own
		// last segment) and walk up to i = 1 (deepest prefix with at least
		// one segment). i = 0 is the bare ref, already tried as literal.
		for(var i = segs.length - 1; i >= 1; i--) {
			var candidate = segs.slice(0, i).join("/") + "/" + ref;
			tried.push(candidate);
			if(exists(wiki, candidate)) {
				return {status: "walkup", resolved: candidate, tried: tried};
			}
		}
	}
	return {status: "unresolved", resolved: null, tried: tried};
};

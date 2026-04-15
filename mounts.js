/*\
title: $:/plugins/rimir/namespace/mounts.js
type: application/javascript
module-type: library

Mount-point rewrites — map a logical namespace prefix to a physical one.

Declarative via tiddlers tagged `$:/tags/NamespaceMount`:

    from:  logical prefix users type (required, no trailing slash)
    to:    physical prefix the ref rewrites to (required)

A mount fires when the incoming REF either:
  * equals `<from>` exactly → rewritten to `<to>`, or
  * starts with `<from>/`   → rewritten to `<to>/<rest>`

Longest `from` wins when multiple mounts match — most-specific beats
most-general. Unlike pattern aliases, mounts are strictly prefix-based
and need no regex: the common "map a namespace root" use case without
the footgun.

The rewritten REF continues through the resolver pipeline, so mount
results go through pseudo expansion (`_latest` etc.) and the normal
literal / context / walk-up lookup.

Cache is built lazily on first use and dropped whole on any wiki change
(startup.js hooks this). Rebuild cost is O(M) over mount-tagged tiddlers,
typically tiny.

\*/

"use strict";

var MOUNT_TAG = "$:/tags/NamespaceMount";

// Cache keyed per-wiki (WeakMap) so multiple concurrent wikis don't
// share stale entries. Entry = sorted array of {from, to, title},
// longest `from` first.
var caches = typeof WeakMap !== "undefined" ? new WeakMap() : null;

function buildCache(wiki) {
	var entry = caches && caches.get(wiki);
	if(entry) { return entry; }
	entry = [];
	var titles = wiki.filterTiddlers("[all[tiddlers+shadows]tag[" + MOUNT_TAG + "]]");
	for(var i = 0; i < titles.length; i++) {
		var t = wiki.getTiddler(titles[i]);
		if(!t || !t.fields) { continue; }
		var from = t.fields["from"],
			to = t.fields["to"];
		if(typeof from !== "string" || !from) { continue; }
		if(typeof to !== "string" || !to) { continue; }
		// Normalise: drop any leading or trailing slash on `from` so users
		// can be sloppy. `to` is used verbatim (might intentionally include
		// a trailing separator somewhere).
		from = from.replace(/^\/+/, "").replace(/\/+$/, "");
		if(!from) { continue; }
		entry.push({from: from, to: to, title: titles[i]});
	}
	// Longest from first — ensures the most-specific mount wins when
	// two mounts could both match (e.g. `OWASP` vs `OWASP/ASVS`).
	entry.sort(function(a, b) { return b.from.length - a.from.length; });
	if(caches) { caches.set(wiki, entry); }
	return entry;
}

/*
Apply mount rewrites to REF. Returns the rewritten REF, or null if no
mount matched. One-pass: mount results don't get re-run through the
mount table to avoid cascades. (Use aliases for multi-step rewrites.)
*/
exports.resolveMount = function(ref, wiki) {
	if(!ref) { return null; }
	var cache = buildCache(wiki);
	for(var i = 0; i < cache.length; i++) {
		var m = cache[i];
		if(ref === m.from) { return m.to; }
		if(ref.length > m.from.length + 1 &&
		   ref.substring(0, m.from.length + 1) === m.from + "/") {
			return m.to + "/" + ref.substring(m.from.length + 1);
		}
	}
	return null;
};

/*
Drop the mount cache. With no wiki argument, drops every wiki's cache.
*/
exports.invalidateMounts = function(wiki) {
	if(!caches) { return; }
	if(wiki) { caches.delete(wiki); } else { caches = new WeakMap(); }
};

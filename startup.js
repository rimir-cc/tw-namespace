/*\
title: $:/plugins/rimir/namespace/startup.js
type: application/javascript
module-type: startup

Keep the resolver's caches fresh.

  Pseudo-segment cache — on any wiki change, walk every ancestor prefix
  of the changed title and drop its cache entries (across all pseudo
  names). Creating `OWASP/ASVS/5.0/X` invalidates entries keyed by
  `OWASP/ASVS/5.0` and `OWASP/ASVS` — so `_latest` under `OWASP/ASVS`
  recomputes and picks up the new `5.0` version child on next use.

  Alias cache — dropped whole on any change. Rebuild cost is O(A) over
  alias-tagged tiddlers; typically trivial. Simpler than per-tag
  targeted invalidation and catches "tiddler gained/lost the tag" too.

Walking ancestors costs O(depth) per change; negligible.

\*/

"use strict";

var resolver = require("$:/plugins/rimir/namespace/resolver.js");
var aliases  = require("$:/plugins/rimir/namespace/aliases.js");

exports.name = "rimir-namespace-cache-invalidation";
exports.platforms = ["browser", "node"];
exports.synchronous = true;

exports.startup = function() {
	if(!$tw.wiki || !$tw.wiki.addEventListener) { return; }
	$tw.wiki.addEventListener("change", function(changes) {
		// Alias cache: whole-cache drop. Cheap to rebuild.
		aliases.invalidateAliases();
		// Pseudo cache: prefix-scoped. Walk ancestors of every changed title.
		for(var title in changes) {
			var idx = title.lastIndexOf("/");
			while(idx > 0) {
				resolver.invalidatePseudoCache(title.substring(0, idx), $tw.wiki);
				idx = title.lastIndexOf("/", idx - 1);
			}
		}
	});
};

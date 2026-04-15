/*\
title: $:/plugins/rimir/namespace/startup.js
type: application/javascript
module-type: startup

Keep the resolver's pseudo-segment cache fresh.

On any wiki change, we walk every ancestor prefix of the changed title
and drop that prefix's cache entries (across all pseudo names). Example:
creating `OWASP/ASVS/5.0/X` invalidates entries keyed by `OWASP/ASVS/5.0`
and `OWASP/ASVS` — so `_latest` under `OWASP/ASVS` recomputes and picks
up the new `5.0` version child on next reference.

Walking ancestors costs O(depth) per change; trivial.

\*/

"use strict";

var resolver = require("$:/plugins/rimir/namespace/resolver.js");

exports.name = "rimir-namespace-cache-invalidation";
exports.platforms = ["browser", "node"];
exports.synchronous = true;

exports.startup = function() {
	if(!$tw.wiki || !$tw.wiki.addEventListener) { return; }
	$tw.wiki.addEventListener("change", function(changes) {
		for(var title in changes) {
			var idx = title.lastIndexOf("/");
			while(idx > 0) {
				resolver.invalidatePseudoCache(title.substring(0, idx), $tw.wiki);
				idx = title.lastIndexOf("/", idx - 1);
			}
		}
	});
};

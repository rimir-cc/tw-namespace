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
var mounts   = require("$:/plugins/rimir/namespace/mounts.js");
var indexer  = require("$:/plugins/rimir/namespace/indexer.js");
var flags    = require("$:/plugins/rimir/namespace/featureflags.js");

exports.name = "rimir-namespace-cache-invalidation";
exports.platforms = ["browser", "node"];
exports.synchronous = true;

exports.startup = function() {
	if(!$tw.wiki || !$tw.wiki.addEventListener) { return; }
	$tw.wiki.addEventListener("change", function(changes) {
		// If a feature flag config changed, invalidate the flags cache first
		// so subsequent isEnabled() calls see the new value.
		var configChanged = flags.isConfigChange(changes);
		if(configChanged) {
			flags.invalidate();
		}
		// Alias cache: only invalidate when aliases are enabled.
		if(flags.isEnabled("aliases", $tw.wiki)) {
			aliases.invalidateAliases();
		}
		// Mount cache: always (mounts are always-on).
		mounts.invalidateMounts();
		// Pseudo cache: only walk ancestors when pseudo-expansion is enabled.
		var changedTitles = [];
		for(var title in changes) {
			changedTitles.push(title);
		}
		if(flags.isEnabled("pseudo-expansion", $tw.wiki)) {
			for(var i = 0; i < changedTitles.length; i++) {
				var idx = changedTitles[i].lastIndexOf("/");
				while(idx > 0) {
					resolver.invalidatePseudoCache(changedTitles[i].substring(0, idx), $tw.wiki);
					idx = changedTitles[i].lastIndexOf("/", idx - 1);
				}
			}
		}
		// If a config flag changed, full rebuild (all resolutions may differ).
		// Otherwise, incremental re-index for changed sources.
		if(configChanged) {
			indexer.rebuildAll($tw.wiki);
		} else {
			indexer.reindexMany(changedTitles, $tw.wiki);
		}
	});
	// Initial backlinks index build — deferred one tick so other startup
	// modules finish first. On large wikis this can be noticeable; if it
	// matters, defer further or run in a web worker (not done here).
	if(typeof setTimeout === "function") {
		setTimeout(function() { indexer.rebuildAll($tw.wiki); }, 0);
	} else {
		indexer.rebuildAll($tw.wiki);
	}
};

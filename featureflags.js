/*\
title: $:/plugins/rimir/namespace/featureflags.js
type: application/javascript
module-type: library

Cached feature-flag reader for optional resolver stages.

Four flags gate expensive or implicit pipeline stages. All default to
"no" (off). Users toggle them via config tiddlers in the plugin's
settings tab.

  $:/config/rimir/namespace/walk-up           — stage 8 path walk-up
  $:/config/rimir/namespace/implicit-context   — context: field fallback
  $:/config/rimir/namespace/pseudo-expansion   — _latest and pseudo modules
  $:/config/rimir/namespace/aliases            — exact + pattern alias rewrite

Reading tiddler text on every resolve() call would be expensive, so we
cache the four booleans and invalidate on wiki change events (startup.js
calls invalidate() when it detects a config tiddler in the change set).

\*/

"use strict";

var CONFIG_PREFIX = "$:/config/rimir/namespace/";
var FLAGS = ["walk-up", "implicit-context", "pseudo-expansion", "aliases"];

// null = not yet read. Object maps flag name → boolean.
var cached = null;

function readFlags(wiki) {
	if(cached) { return cached; }
	cached = Object.create(null);
	for(var i = 0; i < FLAGS.length; i++) {
		var text = wiki.getTiddlerText(CONFIG_PREFIX + FLAGS[i], "no");
		cached[FLAGS[i]] = (text.trim().toLowerCase() === "yes");
	}
	return cached;
}

exports.isEnabled = function(flagName, wiki) {
	return !!readFlags(wiki)[flagName];
};

exports.invalidate = function() {
	cached = null;
};

/*
Check whether any config tiddler title appears in a TW changes object.
Used by startup.js to decide whether to invalidate + full-rebuild.
*/
exports.isConfigChange = function(changes) {
	for(var i = 0; i < FLAGS.length; i++) {
		if(changes[CONFIG_PREFIX + FLAGS[i]]) { return true; }
	}
	return false;
};

/*\
title: $:/plugins/rimir/namespace/filter.js
type: application/javascript
module-type: filteroperator

Filter operators exposing the namespace resolver.

Usage from wikitext:

  [<ref>ns-resolve<currentTiddler>]
    → resolved title, or the original ref if unresolved
      (so the enclosing $link widget still has a valid target).

  [<ref>ns-resolve-class<currentTiddler>]
    → "tc-tiddlylink ns-resolved"    when resolution succeeded
    → "tc-tiddlylink ns-unresolved"  when it did not

Both operators take the source tiddler title as their operand, so the caller
passes <currentTiddler>. The input is the reference string.

\*/

"use strict";

var resolver = require("$:/plugins/rimir/namespace/resolver.js");

exports["ns-resolve"] = function(source, operator, options) {
	var sourceTitle = operator.operand || "";
	var results = [];
	source(function(tiddler, title) {
		// 'title' here is the FILTER INPUT (the ref), not a tiddler title.
		var r = resolver.resolve(title, sourceTitle, options.wiki);
		results.push(r.resolved || title);
	});
	return results;
};

exports["ns-resolve-class"] = function(source, operator, options) {
	var sourceTitle = operator.operand || "";
	var results = [];
	source(function(tiddler, title) {
		var r = resolver.resolve(title, sourceTitle, options.wiki);
		if(r.status === "unresolved") {
			results.push("tc-tiddlylink ns-unresolved");
		} else {
			results.push("tc-tiddlylink ns-resolved");
		}
	});
	return results;
};

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

Context lookup (stage 3) — before calling the resolver we look up a
declared "context prefix":

  1. Widget variable `ns-context` (set by the <$context> widget or the
     \context pragma).
  2. Field `context` on the source tiddler (fallback).

The context is passed as options.context to the resolver. Widget variable
wins over field so that nested <$context> widgets and \context pragmas
override the tiddler-level default.

\*/

"use strict";

var resolver = require("$:/plugins/rimir/namespace/resolver.js");

function getContext(sourceTitle, options) {
	// Widget variable first (set by <$context> / \context pragma).
	if(options.widget && typeof options.widget.getVariable === "function") {
		var v = options.widget.getVariable("ns-context");
		if(v) { return v; }
	}
	// Fallback: context field on the source tiddler.
	if(sourceTitle && options.wiki) {
		var t = options.wiki.getTiddler(sourceTitle);
		if(t && t.fields && t.fields.context) { return t.fields.context; }
	}
	return "";
}

exports["ns-resolve"] = function(source, operator, options) {
	var sourceTitle = operator.operand || "",
		context = getContext(sourceTitle, options),
		results = [];
	source(function(tiddler, title) {
		var r = resolver.resolve(title, sourceTitle, options.wiki, {context: context});
		results.push(r.resolved || title);
	});
	return results;
};

exports["ns-resolve-class"] = function(source, operator, options) {
	var sourceTitle = operator.operand || "",
		context = getContext(sourceTitle, options),
		results = [];
	source(function(tiddler, title) {
		var r = resolver.resolve(title, sourceTitle, options.wiki, {context: context});
		if(r.status === "unresolved") {
			results.push("tc-tiddlylink ns-unresolved");
		} else {
			results.push("tc-tiddlylink ns-resolved");
		}
	});
	return results;
};

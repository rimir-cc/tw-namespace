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
var indexer = require("$:/plugins/rimir/namespace/indexer.js");

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

/*
[<title>ns-backlinks[]]
  → titles that reference `title` via any of literal, alias, mount,
    context, walk-up, pseudo-expanded, or transclusion. Sourced from
    the backlinks indexer — only accurate for indexable tiddlers
    (wikitext + markdown). Input titles are each looked up; outputs
    are union'd in sort order.
*/
exports["ns-backlinks"] = function(source, operator, options) {
	var results = {};
	source(function(tiddler, title) {
		var sources = indexer.getBacklinks(title);
		for(var i = 0; i < sources.length; i++) { results[sources[i]] = true; }
	});
	return Object.keys(results).sort();
};

/*
[<title>ns-forwardlinks[]]
  → titles that `title` references via the resolver. Diagnostic flip
    side of ns-backlinks.
*/
exports["ns-forwardlinks"] = function(source, operator, options) {
	var results = {};
	source(function(tiddler, title) {
		var targets = indexer.getForwardLinks(title);
		for(var i = 0; i < targets.length; i++) { results[targets[i]] = true; }
	});
	return Object.keys(results).sort();
};

/*
[<title>ns-pin-context[]]
  → title's body text with any `\context` pragma expanded (`_latest` and
    other pseudos resolved to current values). Non-destructive: returns
    the rewritten text; caller is responsible for persisting via
    $action-setfield. If no pragma or nothing to rewrite, returns the
    text unchanged.

    Typical use: <$button>
                   Pin _latest
                   <$action-setfield text={{{ [<currentTiddler>ns-pin-context[]] }}}/>
                 </$button>
*/
var RE_PRAGMA = /^(\s*\\context\s+)(\S+)(.*)$/m;
exports["ns-pin-context"] = function(source, operator, options) {
	var results = [];
	source(function(tiddler, title) {
		var t = options.wiki.getTiddler(title);
		if(!t || !t.fields) { results.push(""); return; }
		var text = t.fields.text || "";
		var m = text.match(RE_PRAGMA);
		if(!m) { results.push(text); return; }
		var prefix = m[2],
			expanded = resolver.expandPseudoSegments(prefix, options.wiki);
		if(!expanded || expanded === prefix) { results.push(text); return; }
		results.push(text.substring(0, m.index) + m[1] + expanded + m[3] + text.substring(m.index + m[0].length));
	});
	return results;
};

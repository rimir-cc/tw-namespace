/*\
title: $:/plugins/rimir/namespace/relink-pragma.js
type: application/javascript
module-type: relinkwikitextrule

Relink support for the `\context <prefix>` pragma.

When a tiddler whose title matches the prefix value is renamed, relink
updates the pragma accordingly. Combined with the relink-titles plugin
(which cascades renames to child tiddlers), this covers both exact and
prefix-based renames.

\*/

"use strict";

var utils = require("$:/plugins/flibbles/relink/js/utils.js");
var titleHandler = utils.getType("title");

exports.name = "namespacecontext";

exports.report = function(text, callback, options) {
	var parseTree = this.parse();
	var prefix = parseTree[0].attributes.prefix.value || "";
	if(prefix) {
		titleHandler.report(prefix, function(title, blurb, style) {
			callback(title, "\\context", style);
		}, options);
	}
};

exports.relink = function(text, fromTitle, toTitle, options) {
	var fullMatch = this.match[0];
	var prefix = this.match[1];
	this.parse();
	var entry = titleHandler.relink(prefix, fromTitle, toTitle, options);
	if(entry && entry.output) {
		// Replace just the prefix in the full match, preserving surrounding
		// whitespace and trailing newline.
		entry.output = fullMatch.replace(prefix, entry.output);
	}
	return entry;
};

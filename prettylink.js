/*\
title: $:/plugins/rimir/namespace/prettylink.js
type: application/javascript
module-type: wikirule

Namespace-aware replacement for the core `[[…]]` / `[[text|target]]` rule.

Matches the same regex as core prettylink. For external links, behaves
identically to core. For internal links, emits AST equivalent to:

  <$let __nsref__="REF">
    <$link to={{{ [<__nsref__>ns-resolve<currentTiddler>] }}}
           class={{{ [<__nsref__>ns-resolve-class<currentTiddler>] }}}>
      text
    </$link>
  </$let>

The $let scopes a fresh variable per link so the filter attributes can
pull the raw ref without collisions across sibling links in the same
tiddler. Resolution happens at render time via the ns-resolve filter
operator, so the currentTiddler reflects the *rendering* context (works
correctly under transclusion).

The core rule is disabled via a config tiddler shipped with this plugin;
our rule uses a distinct name to avoid any registration collision.

\*/

"use strict";

exports.name = "namespaceprettylink";
exports.types = {inline: true};

exports.init = function(parser) {
	this.parser = parser;
	this.matchRegExp = /\[\[(.*?)(?:\|(.*?))?\]\]/mg;
};

exports.parse = function() {
	var start = this.parser.pos + 2;
	this.parser.pos = this.matchRegExp.lastIndex;
	var text = this.match[1],
		link = this.match[2] || text,
		textEndPos = this.parser.source.indexOf("|", start);
	if(textEndPos < 0 || textEndPos > this.matchRegExp.lastIndex) {
		textEndPos = this.matchRegExp.lastIndex - 2;
	}
	var linkStart = this.match[2] ? (start + this.match[1].length + 1) : start,
		linkEnd = linkStart + link.length;
	// External links bypass the namespace machinery entirely.
	if($tw.utils.isLinkExternal(link)) {
		return [{
			type: "element",
			tag: "a",
			attributes: {
				href: {type: "string", value: link, start: linkStart, end: linkEnd},
				"class": {type: "string", value: "tc-tiddlylink-external"},
				target: {type: "string", value: "_blank"},
				rel: {type: "string", value: "noopener noreferrer"}
			},
			children: [{type: "text", text: text, start: start, end: textEndPos}]
		}];
	}
	// Internal link: wrap in $let so each link has its own __nsref__
	// scope, then render via $link with filtered to/class attributes.
	// Note: LetWidget reads `name` from each attribute VALUE object (via
	// getOrderedAttributesFromParseTreeNode), unlike the base Widget which
	// uses the attribute KEY — so we must set `name` explicitly here.
	return [{
		type: "let",
		attributes: {
			"__nsref__": {name: "__nsref__", type: "string", value: link, start: linkStart, end: linkEnd}
		},
		children: [{
			type: "link",
			attributes: {
				to:      {type: "filtered", filter: "[<__nsref__>ns-resolve<currentTiddler>]"},
				"class": {type: "filtered", filter: "[<__nsref__>ns-resolve-class<currentTiddler>]"}
			},
			children: [{type: "text", text: text, start: start, end: textEndPos}]
		}]
	}];
};

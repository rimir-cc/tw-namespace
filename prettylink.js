/*\
title: $:/plugins/rimir/namespace/prettylink.js
type: application/javascript
module-type: wikirule

Namespace-aware replacement for the core `[[…]]` / `[[text|target]]` rule.

Matches the same regex as core prettylink. For external links, behaves
identically to core. For internal links, emits AST equivalent to:

  <$let __nsref__="REF"
        __nssrc__={{{ [<thisTiddler>!is[blank]] ~[<currentTiddler>] }}}>
    <$link to={{{ [<__nsref__>ns-resolve<__nssrc__>] }}}
           class={{{ [<__nsref__>ns-resolve-class<__nssrc__>] }}}>
      text
    </$link>
  </$let>

The $let scopes a fresh variable per link so the filter attributes can
pull the raw ref without collisions across sibling links in the same
tiddler. Resolution happens at render time via the ns-resolve filter
operator.

Source-title selection: TW 5.4.0+ `<$transclude $tiddler=...>` sets
`thisTiddler` (not `currentTiddler`), so we prefer thisTiddler and fall
back to currentTiddler. This makes walk-up work whether the wikitext
is rendered via story river (only currentTiddler is set), via a plain
$tiddler widget wrapper, or via $transclude (only thisTiddler is set).

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
	// Internal link: wrap in $let so each link has its own __nsref__ +
	// __nssrc__ scope, then render via $link with filtered to/class
	// attributes. __nssrc__ resolves to thisTiddler (preferred — set by
	// $transclude), or currentTiddler (set by $tiddler widget / story).
	// Note: LetWidget reads `name` from each attribute VALUE object (via
	// getOrderedAttributesFromParseTreeNode), unlike the base Widget which
	// uses the attribute KEY — so we must set `name` explicitly here.
	return [{
		type: "let",
		attributes: {
			"__nsref__": {name: "__nsref__", type: "string", value: link, start: linkStart, end: linkEnd},
			"__nssrc__": {name: "__nssrc__", type: "filtered", filter: "[<thisTiddler>!is[blank]] ~[<currentTiddler>]"}
		},
		children: [{
			type: "link",
			attributes: {
				to:      {type: "filtered", filter: "[<__nsref__>ns-resolve<__nssrc__>]"},
				"class": {type: "filtered", filter: "[<__nsref__>ns-resolve-class<__nssrc__>]"}
			},
			children: [{type: "text", text: text, start: start, end: textEndPos}]
		}]
	}];
};

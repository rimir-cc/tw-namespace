/*\
title: $:/plugins/rimir/namespace/pragma.js
type: application/javascript
module-type: wikirule

Pragma rule for `\context <prefix>`.

Appears at the top of a tiddler (in the pragma section, alongside
\define / \procedure / \parameters / etc.). Wraps the rest of the
tiddler body in a $context widget so `ns-context` is set for every
[[REF]] rendered inside.

```
\context OWASP/ASVS/4.0.3

this tiddler's [[V3.3]] now resolves via the declared context.
```

\*/

"use strict";

exports.name = "namespacecontext";
exports.types = {pragma: true};

exports.init = function(parser) {
	this.parser = parser;
	// \context <prefix> up to end of line. Prefix must not contain whitespace.
	this.matchRegExp = /\\context\s+(\S+)[^\S\n]*(\r?\n)?/mg;
};

exports.parse = function() {
	this.parser.pos = this.matchRegExp.lastIndex;
	var prefix = this.match[1];
	// Emit a single $context node. The wikiparser's parsePragmas() auto-
	// wraps subsequent parse output as our children — so our widget's
	// ns-context variable is in scope for the entire remaining body.
	var attr = {name: "prefix", type: "string", value: prefix};
	return [{
		type: "context",
		attributes: {prefix: attr},
		orderedAttributes: [attr]
	}];
};

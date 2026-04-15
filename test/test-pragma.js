/*\
title: $:/plugins/rimir/namespace/test/test-pragma.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the \context pragma rule — verifies the AST shape (a $context
node with a `prefix` attribute) and that the wikiparser auto-wraps the
remaining body as the context node's children.

\*/

"use strict";

describe("namespace: \\context pragma rule", function() {

	function parse(text) {
		var wiki = new $tw.Wiki();
		return wiki.parseText("text/vnd.tiddlywiki", text).tree;
	}

	function findContext(tree) {
		for(var i = 0; i < tree.length; i++) {
			if(tree[i].type === "context") { return tree[i]; }
		}
		return null;
	}

	it("emits a $context node with the prefix attribute", function() {
		var tree = parse("\\context OWASP/ASVS/4.0.3\n\nBody here");
		var ctx = findContext(tree);
		expect(ctx).not.toBeNull();
		expect(ctx.attributes.prefix).toEqual({
			name: "prefix",
			type: "string",
			value: "OWASP/ASVS/4.0.3"
		});
	});

	it("preserves orderedAttributes (required for some widget paths)", function() {
		var ctx = findContext(parse("\\context X/Y\n\nBody"));
		expect(ctx.orderedAttributes).toBeDefined();
		expect(ctx.orderedAttributes.length).toBe(1);
		expect(ctx.orderedAttributes[0].name).toBe("prefix");
		expect(ctx.orderedAttributes[0].value).toBe("X/Y");
	});

	it("auto-wraps subsequent body as children", function() {
		var ctx = findContext(parse("\\context ctx\n\nSome body text"));
		// Body parsed into children — the exact shape depends on the
		// inline/block rules that fire next, but it must be non-empty.
		expect(ctx.children).toBeDefined();
		expect(ctx.children.length).toBeGreaterThan(0);
	});

	it("captures the prefix verbatim — no normalisation", function() {
		var ctx = findContext(parse("\\context a/b\n"));
		expect(ctx.attributes.prefix.value).toBe("a/b");
	});

	it("only matches when at the top of the tiddler (in pragma section)", function() {
		// `\context` mid-body is plain text, not a pragma.
		var tree = parse("Some text\n\\context X\n\nMore text");
		expect(findContext(tree)).toBeNull();
	});

	it("ignores trailing whitespace on the pragma line", function() {
		var ctx = findContext(parse("\\context X/Y   \n\nBody"));
		expect(ctx).not.toBeNull();
		expect(ctx.attributes.prefix.value).toBe("X/Y");
	});

});

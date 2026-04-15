/*\
title: $:/plugins/rimir/namespace/test/test-prettylink.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the namespace prettylink wikirule — verifies the AST shape that
[[REF]] / [[text|REF]] expands to. Guards the `$let` name-attribute fix
(LetWidget reads attribute.name from the value, not the map key) and
confirms the external-link branch is preserved verbatim.

\*/

"use strict";

describe("namespace: prettylink rule", function() {

	function parse(text) {
		var wiki = new $tw.Wiki();
		return wiki.parseText("text/vnd.tiddlywiki", text).tree;
	}

	// Skip the auto-wrapping <p> the parser adds in inline mode.
	function inline(tree) {
		var p = tree[0];
		if(p && p.type === "element" && p.tag === "p") { return p.children; }
		return tree;
	}

	describe("internal links", function() {

		it("emits a $let wrapper with __nsref__ name attribute", function() {
			var nodes = inline(parse("[[Foo]]"));
			expect(nodes.length).toBe(1);
			var letNode = nodes[0];
			expect(letNode.type).toBe("let");
			// The name-attribute fix: LetWidget reads attribute.name from
			// the value, not the map key.
			var attr = letNode.attributes["__nsref__"];
			expect(attr).toBeDefined();
			expect(attr.name).toBe("__nsref__");
			expect(attr.type).toBe("string");
			expect(attr.value).toBe("Foo");
		});

		it("wraps a $link child with filtered to/class attributes", function() {
			var letNode = inline(parse("[[Foo]]"))[0];
			expect(letNode.children.length).toBe(1);
			var link = letNode.children[0];
			expect(link.type).toBe("link");
			expect(link.attributes.to).toEqual({
				type: "filtered",
				filter: "[<__nsref__>ns-resolve<currentTiddler>]"
			});
			expect(link.attributes["class"]).toEqual({
				type: "filtered",
				filter: "[<__nsref__>ns-resolve-class<currentTiddler>]"
			});
		});

		it("uses the ref as link text when no `text|` prefix", function() {
			var link = inline(parse("[[Foo]]"))[0].children[0];
			expect(link.children).toEqual([
				jasmine.objectContaining({type: "text", text: "Foo"})
			]);
		});

		it("splits on `|` for [[text|target]] form", function() {
			var letNode = inline(parse("[[Click here|Foo/Bar]]"))[0];
			// __nsref__ holds the TARGET (after the |), not the text.
			expect(letNode.attributes["__nsref__"].value).toBe("Foo/Bar");
			var link = letNode.children[0];
			expect(link.children[0].text).toBe("Click here");
		});

		it("treats absolute paths as the ref", function() {
			var letNode = inline(parse("[[a/b/c]]"))[0];
			expect(letNode.attributes["__nsref__"].value).toBe("a/b/c");
		});

		it("treats $:/ system titles as the ref", function() {
			var letNode = inline(parse("[[$:/ControlPanel]]"))[0];
			expect(letNode.type).toBe("let");
			expect(letNode.attributes["__nsref__"].value).toBe("$:/ControlPanel");
		});

	});

	describe("external links (preserved verbatim from core)", function() {

		it("emits a plain <a> for http URLs, no $let wrapper", function() {
			var nodes = inline(parse("[[https://example.com]]"));
			expect(nodes.length).toBe(1);
			var a = nodes[0];
			expect(a.type).toBe("element");
			expect(a.tag).toBe("a");
			expect(a.attributes.href.value).toBe("https://example.com");
			expect(a.attributes["class"].value).toBe("tc-tiddlylink-external");
			expect(a.attributes.target.value).toBe("_blank");
			expect(a.attributes.rel.value).toBe("noopener noreferrer");
		});

		it("emits external <a> for [[text|http://...]] form too", function() {
			var a = inline(parse("[[click|https://example.com]]"))[0];
			expect(a.tag).toBe("a");
			expect(a.attributes.href.value).toBe("https://example.com");
			expect(a.children[0].text).toBe("click");
		});

	});

	describe("multiple links in one tiddler", function() {

		it("each link gets its own $let scope (no __nsref__ collision)", function() {
			var nodes = inline(parse("[[A]] and [[B]]"));
			// Two $let nodes (with a text node between them).
			var lets = nodes.filter(function(n) { return n.type === "let"; });
			expect(lets.length).toBe(2);
			expect(lets[0].attributes["__nsref__"].value).toBe("A");
			expect(lets[1].attributes["__nsref__"].value).toBe("B");
		});

	});

});

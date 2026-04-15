/*\
title: $:/plugins/rimir/namespace/test/test-context-and-filter.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the $context widget and the ns-resolve / ns-resolve-class
filter operators — covers the seam where the resolver pipeline meets
wikitext. In particular: that `ns-context` widget variable wins over
the tiddler's `context` field, and that an unresolved ref still gets a
sensible `to` (= the original ref) so the link remains clickable.

\*/

"use strict";

describe("namespace: $context widget", function() {

	function setupWiki(tiddlers) {
		var wiki = new $tw.Wiki();
		wiki.addTiddlers(tiddlers || []);
		wiki.addIndexersToWiki();
		return wiki;
	}

	// Render a tiddler body and return the resulting DOM text. We use
	// <$text text=<<ns-context>>/> as a sentinel so we can directly
	// assert the variable was set in the right scope.
	function renderText(wiki, body) {
		wiki.addTiddler({title: "renderme", text: body});
		var widget = wiki.makeTranscludeWidget("renderme",
			{parseAsInline: false, document: $tw.fakeDocument});
		var container = $tw.fakeDocument.createElement("div");
		widget.render(container, null);
		return container.textContent;
	}

	it("$context widget sets ns-context for its children", function() {
		var wiki = setupWiki();
		var text = renderText(wiki,
			"<$context prefix=\"foo/bar\">\n\n<$text text=<<ns-context>>/>\n\n</$context>");
		expect(text).toContain("foo/bar");
	});

	it("\\context pragma sets ns-context for the rest of the body", function() {
		var wiki = setupWiki();
		var text = renderText(wiki, "\\context my/ctx\n\n<$text text=<<ns-context>>/>");
		expect(text).toContain("my/ctx");
	});

	it("ns-context is empty/undefined outside any $context scope", function() {
		var wiki = setupWiki();
		var text = renderText(wiki, "<$text text=<<ns-context>>/>");
		// No context set — sentinel renders empty.
		expect(text.trim()).toBe("");
	});

});

describe("namespace: ns-resolve filter operator", function() {

	var aliases = require("$:/plugins/rimir/namespace/aliases.js"),
		mounts = require("$:/plugins/rimir/namespace/mounts.js"),
		resolver = require("$:/plugins/rimir/namespace/resolver.js");

	function setupWiki(tiddlers) {
		var wiki = new $tw.Wiki();
		wiki.addTiddlers(tiddlers || []);
		wiki.addIndexersToWiki();
		return wiki;
	}

	beforeEach(function() {
		resolver.invalidatePseudoCache();
		aliases.invalidateAliases();
		mounts.invalidateMounts();
	});

	describe("ns-resolve", function() {

		it("returns the resolved title when literal hits", function() {
			var wiki = setupWiki([{title: "Foo", text: ""}]);
			var r = wiki.filterTiddlers("[[Foo]ns-resolve[]]");
			expect(r).toEqual(["Foo"]);
		});

		it("returns the original ref when unresolved (so $link still works)", function() {
			var wiki = setupWiki([]);
			var r = wiki.filterTiddlers("[[Missing]ns-resolve[]]");
			expect(r).toEqual(["Missing"]);
		});

		it("uses source-tiddler operand for walk-up", function() {
			var wiki = setupWiki([{title: "a/b/X", text: ""}]);
			var r = wiki.filterTiddlers("[[X]ns-resolve[a/b/source]]");
			expect(r).toEqual(["a/b/X"]);
		});

		it("uses context field on the source tiddler as fallback", function() {
			var wiki = setupWiki([
				{title: "ctx/X", text: ""},
				{title: "src", text: "", context: "ctx"}
			]);
			var r = wiki.filterTiddlers("[[X]ns-resolve[src]]");
			expect(r).toEqual(["ctx/X"]);
		});

		it("widget variable ns-context wins over context field", function() {
			// End-to-end: a body that calls ns-resolve from inside a
			// $context wrapper. The wrapper sets ns-context="winner"; the
			// source tiddler also has a context field "loser". The widget
			// variable must take precedence.
			var wiki = setupWiki([
				{title: "winner/X", text: ""},
				{title: "loser/X", text: ""},
				{title: "src", text: "", context: "loser"}
			]);
			wiki.addTiddler({
				title: "renderme",
				text: "<$context prefix=\"winner\">\n\n" +
					"<$text text={{{ [[X]ns-resolve[src]] }}}/>\n\n" +
					"</$context>"
			});
			var widget = wiki.makeTranscludeWidget("renderme",
				{parseAsInline: false, document: $tw.fakeDocument});
			var container = $tw.fakeDocument.createElement("div");
			widget.render(container, null);
			expect(container.textContent).toContain("winner/X");
		});

	});

	describe("ns-resolve-class", function() {

		it("returns ns-resolved class when ref resolves", function() {
			var wiki = setupWiki([{title: "Foo", text: ""}]);
			var r = wiki.filterTiddlers("[[Foo]ns-resolve-class[]]");
			expect(r).toEqual(["tc-tiddlylink ns-resolved"]);
		});

		it("returns ns-unresolved class when ref doesn't resolve", function() {
			var wiki = setupWiki([]);
			var r = wiki.filterTiddlers("[[Missing]ns-resolve-class[]]");
			expect(r).toEqual(["tc-tiddlylink ns-unresolved"]);
		});

		it("ns-resolved when alias rewrites", function() {
			var wiki = setupWiki([
				{title: "real", text: ""},
				{title: "$:/a", tags: "$:/tags/NamespaceAlias", "short": "ALI", "expands-to": "real"}
			]);
			var r = wiki.filterTiddlers("[[ALI]ns-resolve-class[]]");
			expect(r).toEqual(["tc-tiddlylink ns-resolved"]);
		});

		it("ns-resolved when walk-up succeeds", function() {
			var wiki = setupWiki([{title: "a/b/X", text: ""}]);
			var r = wiki.filterTiddlers("[[X]ns-resolve-class[a/b/src]]");
			expect(r).toEqual(["tc-tiddlylink ns-resolved"]);
		});

	});

});

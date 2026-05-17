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

	it("renders children but does not set ns-context when prefix is empty", function() {
		// `<$context prefix="">` is a documented no-op shell — useful in templates
		// where the prefix is computed and may legitimately be empty.
		var wiki = setupWiki();
		var text = renderText(wiki, "<$context prefix=\"\">\n\n<$text text=<<ns-context>>/>\n\n</$context>");
		expect(text.trim()).toBe("");
	});

	it("re-applies a new prefix when a driving tiddler changes (refresh path)", function() {
		// $context wraps prefix-driven children; when the tiddler providing the
		// prefix changes, refresh() must re-execute so the variable is re-bound.
		var wiki = setupWiki([{title: "src", text: "first"}]);
		wiki.addTiddler({title: "renderme",
			text: "<$context prefix={{src}}>\n\n<$text text=<<ns-context>>/>\n\n</$context>"});
		var widget = wiki.makeTranscludeWidget("renderme",
			{parseAsInline: false, document: $tw.fakeDocument});
		var container = $tw.fakeDocument.createElement("div");
		widget.render(container, null);
		expect(container.textContent).toContain("first");

		wiki.addTiddler({title: "src", text: "second"});
		widget.refresh({src: true});
		expect(container.textContent).toContain("second");
	});

	it("delegates to children-refresh when own attributes are unchanged", function() {
		// When the $context's prefix attribute does NOT change but the subtree
		// references a tiddler that does, refresh() should fall through to
		// refreshChildren so the children re-render normally.
		var wiki = setupWiki([{title: "inner", text: "v1"}]);
		wiki.addTiddler({title: "renderme",
			text: "<$context prefix=\"static\">\n\n<<ns-context>> <$transclude tiddler=\"inner\" mode=\"inline\"/>\n\n</$context>"});
		var widget = wiki.makeTranscludeWidget("renderme",
			{parseAsInline: false, document: $tw.fakeDocument});
		var container = $tw.fakeDocument.createElement("div");
		widget.render(container, null);
		expect(container.textContent).toContain("static");
		expect(container.textContent).toContain("v1");

		wiki.addTiddler({title: "inner", text: "v2"});
		var result = widget.refresh({inner: true});
		// refresh should propagate the children-change signal upward.
		expect(typeof result).toBe("boolean");
		expect(container.textContent).toContain("v2");
		expect(container.textContent).toContain("static");
	});

});

describe("namespace: ns-resolve filter operator", function() {

	var aliases = require("$:/plugins/rimir/namespace/aliases.js"),
		mounts = require("$:/plugins/rimir/namespace/mounts.js"),
		resolver = require("$:/plugins/rimir/namespace/resolver.js"),
		flags = require("$:/plugins/rimir/namespace/featureflags.js"),
		scope = require("$:/plugins/rimir/namespace/scope.js");

	function setupWiki(tiddlers) {
		var wiki = new $tw.Wiki();
		wiki.addTiddlers(tiddlers || []);
		wiki.addTiddler({title: "$:/config/rimir/namespace/walk-up", text: "yes"});
		wiki.addTiddler({title: "$:/config/rimir/namespace/aliases", text: "yes"});
		wiki.addTiddler({title: "$:/config/rimir/namespace/implicit-context", text: "yes"});
		wiki.addIndexersToWiki();
		return wiki;
	}

	beforeEach(function() {
		flags.invalidate();
		scope.invalidate();
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

	// --------------------------------------------------------------------
	// Scope-mode interactions with the filter operators.
	// --------------------------------------------------------------------
	describe("scope mode (prefixes)", function() {

		function setupScopedWiki(tiddlers) {
			var wiki = setupWiki(tiddlers);
			wiki.addTiddler({title: "$:/config/rimir/namespace/scope-mode", text: "prefixes"});
			wiki.addTiddler({title: "$:/config/rimir/namespace/scope-prefixes", text: "knowledge"});
			flags.invalidate();
			scope.invalidate();
			return wiki;
		}

		it("ns-resolve from OOS source returns the raw ref unchanged (target exists)", function() {
			var wiki = setupScopedWiki([{title: "knowledge/foo", text: ""}]);
			var r = wiki.filterTiddlers("[[knowledge/foo]ns-resolve[inbox/today]]");
			expect(r).toEqual(["knowledge/foo"]);
		});

		it("ns-resolve from OOS source returns the raw ref unchanged (target missing)", function() {
			var wiki = setupScopedWiki([]);
			var r = wiki.filterTiddlers("[[knowledge/missing]ns-resolve[inbox/today]]");
			expect(r).toEqual(["knowledge/missing"]);
		});

		it("ns-resolve-class from OOS source returns 'tc-tiddlylink' (no namespace classes)", function() {
			var wiki = setupScopedWiki([{title: "knowledge/foo", text: ""}]);
			var r = wiki.filterTiddlers("[[knowledge/foo]ns-resolve-class[inbox/today]]");
			expect(r).toEqual(["tc-tiddlylink"]);
		});

		it("ns-resolve-class from OOS source + missing target → still 'tc-tiddlylink' (no ns-unresolved)", function() {
			var wiki = setupScopedWiki([]);
			var r = wiki.filterTiddlers("[[knowledge/missing]ns-resolve-class[inbox/today]]");
			expect(r).toEqual(["tc-tiddlylink"]);
		});

		it("in-scope source still gets ns-resolved styling", function() {
			var wiki = setupScopedWiki([{title: "knowledge/X", text: ""}]);
			var r = wiki.filterTiddlers("[[X]ns-resolve-class[knowledge/foo]]");
			expect(r).toEqual(["tc-tiddlylink ns-resolved"]);
		});

		it("in-scope source still walks up", function() {
			var wiki = setupScopedWiki([{title: "knowledge/X", text: ""}]);
			var r = wiki.filterTiddlers("[[X]ns-resolve[knowledge/foo]]");
			expect(r).toEqual(["knowledge/X"]);
		});

		it("\\context pragma sets ns-context but resolver still returns out-of-scope from OOS source", function() {
			var wiki = setupScopedWiki([{title: "knowledge/llm/X", text: ""}]);
			// Render an OOS tiddler with \context pragma; the ns-resolve call
			// inside should yield the raw ref (because OOS), not "knowledge/llm/X".
			wiki.addTiddler({
				title: "inbox/today",
				text: "\\context knowledge/llm\n\n<$text text={{{ [[X]ns-resolve[inbox/today]] }}}/>"
			});
			var widget = wiki.makeTranscludeWidget("inbox/today",
				{parseAsInline: false, document: $tw.fakeDocument});
			var container = $tw.fakeDocument.createElement("div");
			widget.render(container, null);
			expect(container.textContent).toContain("X");
			expect(container.textContent).not.toContain("knowledge/llm/X");
		});

		it("<$context> widget wrapping in OOS source — same: variable set but resolver short-circuits", function() {
			var wiki = setupScopedWiki([{title: "knowledge/ctx/X", text: ""}]);
			wiki.addTiddler({
				title: "inbox/today",
				text: "<$context prefix=\"knowledge/ctx\">\n\n" +
					"<$text text={{{ [[X]ns-resolve[inbox/today]] }}}/>\n\n" +
					"</$context>"
			});
			var widget = wiki.makeTranscludeWidget("inbox/today",
				{parseAsInline: false, document: $tw.fakeDocument});
			var container = $tw.fakeDocument.createElement("div");
			widget.render(container, null);
			expect(container.textContent).not.toContain("knowledge/ctx/X");
		});

	});

});

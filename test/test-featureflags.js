/*\
title: $:/plugins/rimir/namespace/test/test-featureflags.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the feature flags module — verifies that optional resolver
stages (walk-up, aliases, pseudo-expansion, implicit-context) are
properly gated by their config tiddlers.

\*/

"use strict";

describe("namespace: featureflags", function() {

	var flags = require("$:/plugins/rimir/namespace/featureflags.js");
	var resolver = require("$:/plugins/rimir/namespace/resolver.js");
	var aliases = require("$:/plugins/rimir/namespace/aliases.js");
	var mounts = require("$:/plugins/rimir/namespace/mounts.js");
	var indexer = require("$:/plugins/rimir/namespace/indexer.js");

	function setupWiki(tiddlers) {
		var wiki = new $tw.Wiki();
		wiki.addTiddlers(tiddlers || []);
		wiki.addIndexersToWiki();
		return wiki;
	}

	function enableFlag(wiki, name) {
		wiki.addTiddler({title: "$:/config/rimir/namespace/" + name, text: "yes"});
		flags.invalidate();
	}

	beforeEach(function() {
		flags.invalidate();
		resolver.invalidatePseudoCache();
		aliases.invalidateAliases();
		mounts.invalidateMounts();
		indexer.reset();
	});

	describe("flag defaults", function() {

		it("all flags return false when config tiddlers don't exist", function() {
			var wiki = setupWiki([]);
			expect(flags.isEnabled("walk-up", wiki)).toBe(false);
			expect(flags.isEnabled("implicit-context", wiki)).toBe(false);
			expect(flags.isEnabled("pseudo-expansion", wiki)).toBe(false);
			expect(flags.isEnabled("aliases", wiki)).toBe(false);
		});

		it("all flags return false when config tiddlers contain 'no'", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/namespace/walk-up", text: "no"},
				{title: "$:/config/rimir/namespace/implicit-context", text: "no"},
				{title: "$:/config/rimir/namespace/pseudo-expansion", text: "no"},
				{title: "$:/config/rimir/namespace/aliases", text: "no"}
			]);
			expect(flags.isEnabled("walk-up", wiki)).toBe(false);
			expect(flags.isEnabled("aliases", wiki)).toBe(false);
		});

		it("returns true when config tiddler contains 'yes'", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/namespace/walk-up", text: "yes"}
			]);
			expect(flags.isEnabled("walk-up", wiki)).toBe(true);
		});

		it("handles whitespace and case variations", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/namespace/walk-up", text: " Yes "},
				{title: "$:/config/rimir/namespace/aliases", text: "YES"}
			]);
			expect(flags.isEnabled("walk-up", wiki)).toBe(true);
			expect(flags.isEnabled("aliases", wiki)).toBe(true);
		});

		it("invalidate() causes re-read on next call", function() {
			var wiki = setupWiki([]);
			expect(flags.isEnabled("walk-up", wiki)).toBe(false);
			wiki.addTiddler({title: "$:/config/rimir/namespace/walk-up", text: "yes"});
			flags.invalidate();
			expect(flags.isEnabled("walk-up", wiki)).toBe(true);
		});

	});

	describe("isConfigChange", function() {

		it("returns true when changes contain a config tiddler", function() {
			var changes = {"$:/config/rimir/namespace/walk-up": {modified: true}};
			expect(flags.isConfigChange(changes)).toBe(true);
		});

		it("returns false for unrelated changes", function() {
			var changes = {"some/tiddler": {modified: true}};
			expect(flags.isConfigChange(changes)).toBe(false);
		});

	});

	describe("walk-up gating", function() {

		it("walk-up OFF: resolve returns unresolved even when target exists in parent", function() {
			var wiki = setupWiki([{title: "a/b/X", text: ""}]);
			var r = resolver.resolve("X", "a/b/source", wiki);
			expect(r.status).toBe("unresolved");
		});

		it("walk-up ON: resolve walks up and finds target", function() {
			var wiki = setupWiki([{title: "a/b/X", text: ""}]);
			enableFlag(wiki, "walk-up");
			var r = resolver.resolve("X", "a/b/source", wiki);
			expect(r.status).toBe("walkup");
			expect(r.resolved).toBe("a/b/X");
		});

		it("walk-up OFF but context still works", function() {
			var wiki = setupWiki([{title: "ctx/X", text: ""}]);
			// No walk-up flag, but explicit context
			var r = resolver.resolve("X", "some/source", wiki, {context: "ctx"});
			expect(r.status).toBe("context");
			expect(r.resolved).toBe("ctx/X");
		});

	});

	describe("alias gating", function() {

		it("aliases OFF: alias tiddler ignored", function() {
			var wiki = setupWiki([
				{title: "real/target", text: ""},
				{title: "$:/a", tags: "$:/tags/NamespaceAlias", "short": "SHORT", "expands-to": "real/target"}
			]);
			var r = resolver.resolve("SHORT", null, wiki);
			expect(r.status).toBe("unresolved");
		});

		it("aliases ON: alias rewrites ref", function() {
			var wiki = setupWiki([
				{title: "real/target", text: ""},
				{title: "$:/a", tags: "$:/tags/NamespaceAlias", "short": "SHORT", "expands-to": "real/target"}
			]);
			enableFlag(wiki, "aliases");
			var r = resolver.resolve("SHORT", null, wiki);
			expect(r.status).toBe("alias");
			expect(r.resolved).toBe("real/target");
		});

	});

	describe("pseudo gating", function() {

		it("pseudos OFF: _latest treated as literal", function() {
			var wiki = setupWiki([
				{title: "v/3.0/x", text: ""},
				{title: "v/4.0/x", text: ""}
			]);
			var r = resolver.resolve("v/_latest/x", null, wiki);
			expect(r.status).toBe("unresolved");
		});

		it("pseudos ON: _latest expands to highest version", function() {
			var wiki = setupWiki([
				{title: "v/3.0/x", text: ""},
				{title: "v/4.0/x", text: ""}
			]);
			enableFlag(wiki, "pseudo-expansion");
			var r = resolver.resolve("v/_latest/x", null, wiki);
			expect(r.resolved).toBe("v/4.0/x");
		});

		it("pseudos OFF + context: context string not expanded", function() {
			var wiki = setupWiki([
				{title: "v/3.0/x", text: ""},
				{title: "v/4.0/x", text: ""}
			]);
			// _latest in context should NOT expand when pseudo flag is off
			var r = resolver.resolve("x", "source", wiki, {context: "v/_latest"});
			// tries literal "v/_latest/x" which doesn't exist
			expect(r.status).toBe("unresolved");
		});

		it("pseudos ON + context: context string expanded", function() {
			var wiki = setupWiki([
				{title: "v/3.0/x", text: ""},
				{title: "v/4.0/x", text: ""}
			]);
			enableFlag(wiki, "pseudo-expansion");
			var r = resolver.resolve("x", "source", wiki, {context: "v/_latest"});
			expect(r.status).toBe("context");
			expect(r.resolved).toBe("v/4.0/x");
		});

	});

	describe("implicit-context gating", function() {

		it("implicit-context OFF: context field ignored by filter operator", function() {
			var wiki = setupWiki([
				{title: "ctx/X", text: ""},
				{title: "src", text: "", context: "ctx"}
			]);
			enableFlag(wiki, "walk-up");
			var r = wiki.filterTiddlers("[[X]ns-resolve[src]]");
			// Without implicit-context, the field is ignored.
			// Walk-up from "src" (no /) won't find "ctx/X" either.
			expect(r).toEqual(["X"]);
		});

		it("implicit-context ON: context field used as fallback", function() {
			var wiki = setupWiki([
				{title: "ctx/X", text: ""},
				{title: "src", text: "", context: "ctx"}
			]);
			enableFlag(wiki, "implicit-context");
			var r = wiki.filterTiddlers("[[X]ns-resolve[src]]");
			expect(r).toEqual(["ctx/X"]);
		});

		it("implicit-context OFF: \\context pragma still works", function() {
			var wiki = setupWiki([{title: "ctx/X", text: ""}]);
			// Render a tiddler with \context pragma — should resolve
			// regardless of the implicit-context flag.
			wiki.addTiddler({
				title: "renderme",
				text: "\\context ctx\n\n<$text text={{{ [[X]ns-resolve[renderme]] }}}/>"
			});
			var widget = wiki.makeTranscludeWidget("renderme",
				{parseAsInline: false, document: $tw.fakeDocument});
			var container = $tw.fakeDocument.createElement("div");
			widget.render(container, null);
			expect(container.textContent).toContain("ctx/X");
		});

	});

	describe("indexer respects flags", function() {

		it("walk-up OFF: indexer does not index walk-up resolves", function() {
			var wiki = setupWiki([
				{title: "a/b/source", text: "see [[target]]"},
				{title: "a/target", text: ""}
			]);
			indexer.rebuildAll(wiki);
			// Walk-up is off, so [[target]] from a/b/source won't resolve to a/target
			expect(indexer.getBacklinks("a/target")).toEqual([]);
		});

		it("walk-up ON: indexer indexes walk-up resolves", function() {
			var wiki = setupWiki([
				{title: "a/b/source", text: "see [[target]]"},
				{title: "a/target", text: ""}
			]);
			enableFlag(wiki, "walk-up");
			indexer.rebuildAll(wiki);
			expect(indexer.getBacklinks("a/target")).toEqual(["a/b/source"]);
		});

		it("implicit-context OFF: indexer ignores context field", function() {
			var wiki = setupWiki([
				{title: "ctx/target", text: ""},
				{title: "source", context: "ctx", text: "uses [[target]]"}
			]);
			indexer.rebuildAll(wiki);
			expect(indexer.getBacklinks("ctx/target")).toEqual([]);
		});

		it("implicit-context ON: indexer uses context field", function() {
			var wiki = setupWiki([
				{title: "ctx/target", text: ""},
				{title: "source", context: "ctx", text: "uses [[target]]"}
			]);
			enableFlag(wiki, "implicit-context");
			indexer.rebuildAll(wiki);
			expect(indexer.getBacklinks("ctx/target")).toEqual(["source"]);
		});

	});

});

/*\
title: $:/plugins/rimir/namespace/test/test-aliases.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the aliases module — exact and pattern forms, precedence,
malformed entries, and chained rewrites.

\*/

"use strict";

describe("namespace: aliases", function() {

	var aliases = require("$:/plugins/rimir/namespace/aliases.js");
	var resolver = require("$:/plugins/rimir/namespace/resolver.js");
	var flags = require("$:/plugins/rimir/namespace/featureflags.js");
	var scope = require("$:/plugins/rimir/namespace/scope.js");

	function setupWiki(tiddlers) {
		var wiki = new $tw.Wiki();
		wiki.addTiddlers(tiddlers || []);
		wiki.addTiddler({title: "$:/config/rimir/namespace/aliases", text: "yes"});
		wiki.addTiddler({title: "$:/config/rimir/namespace/pseudo-expansion", text: "yes"});
		wiki.addIndexersToWiki();
		return wiki;
	}

	beforeEach(function() {
		flags.invalidate();
		scope.invalidate();
		aliases.invalidateAliases();
		resolver.invalidatePseudoCache();
	});

	describe("exact aliases", function() {

		it("rewrites when short matches", function() {
			var wiki = setupWiki([
				{title: "$:/a", tags: "$:/tags/NamespaceAlias", "short": "X", "expands-to": "a/b/c"}
			]);
			expect(aliases.resolveAlias("X", wiki)).toBe("a/b/c");
		});

		it("returns null when short doesn't match", function() {
			var wiki = setupWiki([
				{title: "$:/a", tags: "$:/tags/NamespaceAlias", "short": "X", "expands-to": "y"}
			]);
			expect(aliases.resolveAlias("Y", wiki)).toBeNull();
		});

		it("ignores entries missing required fields", function() {
			var wiki = setupWiki([
				{title: "$:/a1", tags: "$:/tags/NamespaceAlias", "short": "", "expands-to": "y"},
				{title: "$:/a2", tags: "$:/tags/NamespaceAlias", "short": "X", "expands-to": ""},
				{title: "$:/a3", tags: "$:/tags/NamespaceAlias", "short": "OK", "expands-to": "target"}
			]);
			expect(aliases.resolveAlias("X", wiki)).toBeNull();
			expect(aliases.resolveAlias("", wiki)).toBeNull();
			expect(aliases.resolveAlias("OK", wiki)).toBe("target");
		});

	});

	describe("pattern aliases", function() {

		it("rewrites via regex substitution", function() {
			var wiki = setupWiki([
				{title: "$:/p", tags: "$:/tags/NamespacePatternAlias", pattern: "^V_(.+)$", replacement: "vers/$1"}
			]);
			expect(aliases.resolveAlias("V_abc", wiki)).toBe("vers/abc");
		});

		it("doesn't match when regex fails", function() {
			var wiki = setupWiki([
				{title: "$:/p", tags: "$:/tags/NamespacePatternAlias", pattern: "^V_(.+)$", replacement: "vers/$1"}
			]);
			expect(aliases.resolveAlias("something-else", wiki)).toBeNull();
		});

		it("supports multiple capture groups", function() {
			var wiki = setupWiki([
				{title: "$:/p", tags: "$:/tags/NamespacePatternAlias", pattern: "^(\\w+)/(\\w+)$", replacement: "$2/$1"}
			]);
			expect(aliases.resolveAlias("foo/bar", wiki)).toBe("bar/foo");
		});

		it("skips invalid regex (and logs)", function() {
			// Spy on console.error to verify warning, then ensure a sibling
			// valid pattern still works.
			var errSpy = spyOn(console, "error");
			var wiki = setupWiki([
				{title: "$:/bad", tags: "$:/tags/NamespacePatternAlias", pattern: "[unclosed", replacement: "x"},
				{title: "$:/ok", tags: "$:/tags/NamespacePatternAlias", pattern: "^OK$", replacement: "fine"}
			]);
			expect(aliases.resolveAlias("OK", wiki)).toBe("fine");
			expect(errSpy).toHaveBeenCalled();
		});

		it("skips a pattern alias that's missing the `pattern` field", function() {
			// Author may have tagged a tiddler but forgotten to set pattern.
			// The plugin should not crash; valid siblings still work.
			var wiki = setupWiki([
				{title: "$:/missing-pattern", tags: "$:/tags/NamespacePatternAlias", replacement: "wherever"},
				{title: "$:/ok", tags: "$:/tags/NamespacePatternAlias", pattern: "^X$", replacement: "y"}
			]);
			expect(aliases.resolveAlias("X", wiki)).toBe("y");
			expect(aliases.resolveAlias("anything", wiki)).toBeNull();
		});

		it("skips a pattern alias that's missing the `replacement` field", function() {
			// Mirror of the previous case: pattern set, replacement absent.
			var wiki = setupWiki([
				{title: "$:/missing-replacement", tags: "$:/tags/NamespacePatternAlias", pattern: "^X$"},
				{title: "$:/ok", tags: "$:/tags/NamespacePatternAlias", pattern: "^Y$", replacement: "z"}
			]);
			expect(aliases.resolveAlias("X", wiki)).toBeNull();
			expect(aliases.resolveAlias("Y", wiki)).toBe("z");
		});

	});

	describe("precedence: exact > pattern", function() {

		it("exact alias wins when both match the same ref", function() {
			var wiki = setupWiki([
				{title: "$:/ex", tags: "$:/tags/NamespaceAlias", "short": "X", "expands-to": "winner"},
				{title: "$:/pat", tags: "$:/tags/NamespacePatternAlias", pattern: "^X$", replacement: "loser"}
			]);
			expect(aliases.resolveAlias("X", wiki)).toBe("winner");
		});

	});

	describe("chained aliases via resolve()", function() {

		it("applies up to 3 hops, then stops", function() {
			// a → b → c → d → e, but only 3 hops allowed
			var wiki = setupWiki([
				{title: "e", text: ""},
				{title: "$:/1", tags: "$:/tags/NamespaceAlias", "short": "a", "expands-to": "b"},
				{title: "$:/2", tags: "$:/tags/NamespaceAlias", "short": "b", "expands-to": "c"},
				{title: "$:/3", tags: "$:/tags/NamespaceAlias", "short": "c", "expands-to": "d"},
				{title: "$:/4", tags: "$:/tags/NamespaceAlias", "short": "d", "expands-to": "e"}
			]);
			// 3 hops: a → b → c → d. Since "d" doesn't exist literally, walk-up
			// won't find it either, so it's unresolved (we stopped before
			// hopping to "e" which does exist).
			var r = resolver.resolve("a", null, wiki);
			expect(r.status).toBe("unresolved");
		});

		it("handles direct cycles gracefully", function() {
			var wiki = setupWiki([
				{title: "$:/a1", tags: "$:/tags/NamespaceAlias", "short": "A", "expands-to": "B"},
				{title: "$:/a2", tags: "$:/tags/NamespaceAlias", "short": "B", "expands-to": "A"}
			]);
			// No infinite loop — capped at 3 hops and terminates cleanly.
			expect(function() {
				resolver.resolve("A", null, wiki);
			}).not.toThrow();
		});

	});

	describe("aliases interact with pseudo expansion", function() {

		it("alias expansion containing _latest still drifts", function() {
			var wiki = setupWiki([
				{title: "v/3.0/x", text: ""},
				{title: "v/4.0/x", text: ""},
				{title: "$:/a", tags: "$:/tags/NamespaceAlias", "short": "SHORT", "expands-to": "v/_latest/x"}
			]);
			var r = resolver.resolve("SHORT", null, wiki);
			expect(r.status).toBe("alias");
			expect(r.resolved).toBe("v/4.0/x");
		});

	});

	describe("cache invalidation", function() {

		it("invalidateAliases(wiki) drops only that wiki's cache", function() {
			// Per-wiki invalidation is the contract used by startup.js's
			// change listener; verifying it here keeps that promise honest
			// across plugin refactors.
			var wikiA = setupWiki([
				{title: "$:/a", tags: "$:/tags/NamespaceAlias", "short": "X", "expands-to": "alpha"}
			]);
			var wikiB = setupWiki([
				{title: "$:/b", tags: "$:/tags/NamespaceAlias", "short": "X", "expands-to": "beta"}
			]);
			// Prime both caches
			expect(aliases.resolveAlias("X", wikiA)).toBe("alpha");
			expect(aliases.resolveAlias("X", wikiB)).toBe("beta");
			// Change wikiA's alias content
			wikiA.addTiddler({title: "$:/a", tags: "$:/tags/NamespaceAlias", "short": "X", "expands-to": "alpha-v2"});
			// Without invalidation we'd see the cached "alpha"
			aliases.invalidateAliases(wikiA);
			expect(aliases.resolveAlias("X", wikiA)).toBe("alpha-v2");
			// wikiB's cache is untouched (entry still says "beta")
			expect(aliases.resolveAlias("X", wikiB)).toBe("beta");
		});

	});

});

/*\
title: $:/plugins/rimir/namespace/test/test-latest.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the _latest pseudo-segment — version predicate, ordering,
prerelease handling, and the expandPseudoSegments integration.

\*/

"use strict";

describe("namespace: _latest pseudo", function() {

	var resolver = require("$:/plugins/rimir/namespace/resolver.js");
	var latest = require("$:/plugins/rimir/namespace/pseudo/_latest.js");

	function setupWiki(tiddlers) {
		var wiki = new $tw.Wiki();
		wiki.addTiddlers(tiddlers || []);
		wiki.addIndexersToWiki();
		return wiki;
	}

	beforeEach(function() {
		resolver.invalidatePseudoCache();
	});

	describe("resolve directly", function() {

		it("picks the highest dotted-numeric child", function() {
			var wiki = setupWiki([
				{title: "v/3.0/x", text: ""},
				{title: "v/3.0.1/x", text: ""},
				{title: "v/4.0.3/x", text: ""}
			]);
			expect(latest.resolve("v", wiki)).toBe("4.0.3");
		});

		it("compares versions numerically (not lexicographically)", function() {
			var wiki = setupWiki([
				{title: "v/2.0/x", text: ""},
				{title: "v/10.0/x", text: ""}
			]);
			// Lexicographic would pick "2.0"; numeric picks "10.0".
			expect(latest.resolve("v", wiki)).toBe("10.0");
		});

		it("treats release as greater than its prerelease", function() {
			var wiki = setupWiki([
				{title: "v/3.0/x", text: ""},
				{title: "v/3.0-rc.1/x", text: ""}
			]);
			expect(latest.resolve("v", wiki)).toBe("3.0");
		});

		it("handles missing segments as 0", function() {
			var wiki = setupWiki([
				{title: "v/3.0/x", text: ""},
				{title: "v/3.0.1/x", text: ""}
			]);
			// 3.0 === 3.0.0; 3.0.1 > 3.0.0
			expect(latest.resolve("v", wiki)).toBe("3.0.1");
		});

		it("ignores non-version children", function() {
			var wiki = setupWiki([
				{title: "v/main/x", text: ""},
				{title: "v/feature-branch/x", text: ""},
				{title: "v/3.0/x", text: ""}
			]);
			expect(latest.resolve("v", wiki)).toBe("3.0");
		});

		it("returns null for no version children", function() {
			var wiki = setupWiki([
				{title: "v/main/x", text: ""},
				{title: "v/stable/x", text: ""}
			]);
			expect(latest.resolve("v", wiki)).toBeNull();
		});

		it("returns null with an empty prefix", function() {
			expect(latest.resolve("", setupWiki([]))).toBeNull();
		});

	});

	describe("expandPseudoSegments", function() {

		it("expands _latest to the version-max child", function() {
			var wiki = setupWiki([
				{title: "v/3.0/x", text: ""},
				{title: "v/4.0/x", text: ""}
			]);
			expect(resolver.expandPseudoSegments("v/_latest/x", wiki))
				.toBe("v/4.0/x");
		});

		it("returns unchanged ref when no pseudo segments present", function() {
			var wiki = setupWiki([]);
			expect(resolver.expandPseudoSegments("a/b/c", wiki)).toBe("a/b/c");
		});

		it("returns null when _latest can't expand", function() {
			var wiki = setupWiki([]);
			expect(resolver.expandPseudoSegments("missing/_latest/x", wiki))
				.toBeNull();
		});

		it("returns null for pseudo at position 0 (no prefix anchor)", function() {
			var wiki = setupWiki([{title: "v/3.0/x", text: ""}]);
			expect(resolver.expandPseudoSegments("_latest/x", wiki)).toBeNull();
		});

		it("expands multiple _latest segments against their prefixes", function() {
			var wiki = setupWiki([
				{title: "a/1.0/b/3.0/x", text: ""},
				{title: "a/1.0/b/4.0/x", text: ""},
				{title: "a/2.0/b/9.0/x", text: ""}
			]);
			expect(resolver.expandPseudoSegments("a/_latest/b/_latest/x", wiki))
				.toBe("a/2.0/b/9.0/x");
		});

		it("leaves unknown _-prefixed segments as literal", function() {
			var wiki = setupWiki([{title: "a/_unknown/x", text: ""}]);
			// _unknown is not a registered pseudo; expansion leaves it alone
			expect(resolver.expandPseudoSegments("a/_unknown/x", wiki))
				.toBe("a/_unknown/x");
		});

	});

	describe("cache behaviour (through expandPseudoSegments)", function() {

		// Direct `latest.resolve(prefix, wiki)` bypasses the registry cache
		// (it's always fresh against the wiki). The cache lives one level up
		// in resolver.resolvePseudo, hit by expandPseudoSegments. These
		// tests go through that path.

		it("caches results; invalidation forces recompute", function() {
			var wiki = setupWiki([{title: "v/3.0/x", text: ""}]);
			expect(resolver.expandPseudoSegments("v/_latest/x", wiki))
				.toBe("v/3.0/x");
			// Add a newer version. Cache is not auto-invalidated in tests
			// (no startup hook), so next call returns stale answer.
			wiki.addTiddler({title: "v/4.0/x", text: ""});
			expect(resolver.expandPseudoSegments("v/_latest/x", wiki))
				.toBe("v/3.0/x"); // stale
			resolver.invalidatePseudoCache();
			expect(resolver.expandPseudoSegments("v/_latest/x", wiki))
				.toBe("v/4.0/x"); // fresh
		});

		it("prefix-scoped invalidation only drops matching entries", function() {
			var wiki = setupWiki([
				{title: "a/3.0/x", text: ""},
				{title: "b/5.0/x", text: ""}
			]);
			// Prime both caches
			expect(resolver.expandPseudoSegments("a/_latest/x", wiki)).toBe("a/3.0/x");
			expect(resolver.expandPseudoSegments("b/_latest/x", wiki)).toBe("b/5.0/x");
			// Add new versions under both
			wiki.addTiddler({title: "a/9.0/x", text: ""});
			wiki.addTiddler({title: "b/9.0/x", text: ""});
			// Invalidate only 'a' — 'b' stays cached
			resolver.invalidatePseudoCache("a", wiki);
			expect(resolver.expandPseudoSegments("a/_latest/x", wiki)).toBe("a/9.0/x"); // fresh
			expect(resolver.expandPseudoSegments("b/_latest/x", wiki)).toBe("b/5.0/x"); // stale
		});

	});

});

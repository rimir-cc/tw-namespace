/*\
title: $:/plugins/rimir/namespace/test/test-resolver.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the namespace resolver — splitPath + the full resolve pipeline
(literal, alias, mount, pseudo, context, walk-up, unresolved) including
their interactions.

\*/

"use strict";

describe("namespace: resolver", function() {

	var resolver = require("$:/plugins/rimir/namespace/resolver.js");
	var aliases = require("$:/plugins/rimir/namespace/aliases.js");
	var mounts = require("$:/plugins/rimir/namespace/mounts.js");
	var flags = require("$:/plugins/rimir/namespace/featureflags.js");

	function setupWiki(tiddlers) {
		var wiki = new $tw.Wiki();
		wiki.addTiddlers(tiddlers || []);
		// Enable all feature flags so existing tests pass unchanged.
		wiki.addTiddler({title: "$:/config/rimir/namespace/walk-up", text: "yes"});
		wiki.addTiddler({title: "$:/config/rimir/namespace/aliases", text: "yes"});
		wiki.addTiddler({title: "$:/config/rimir/namespace/pseudo-expansion", text: "yes"});
		wiki.addTiddler({title: "$:/config/rimir/namespace/implicit-context", text: "yes"});
		wiki.addIndexersToWiki();
		return wiki;
	}

	beforeEach(function() {
		flags.invalidate();
		resolver.invalidatePseudoCache();
		aliases.invalidateAliases();
		mounts.invalidateMounts();
	});

	describe("splitPath", function() {

		it("splits a regular title on /", function() {
			expect(resolver.splitPath("a/b/c")).toEqual(["a", "b", "c"]);
		});

		it("returns a single segment for no-slash titles", function() {
			expect(resolver.splitPath("foo")).toEqual(["foo"]);
		});

		it("splits $:/ titles with $: as the root segment", function() {
			expect(resolver.splitPath("$:/plugins/foo/bar"))
				.toEqual(["$:", "plugins", "foo", "bar"]);
		});

		it("handles bare $:/ as a single $: segment", function() {
			expect(resolver.splitPath("$:/")).toEqual(["$:"]);
		});

		it("returns empty for null/empty input", function() {
			expect(resolver.splitPath("")).toEqual([]);
			expect(resolver.splitPath(null)).toEqual([]);
			expect(resolver.splitPath(undefined)).toEqual([]);
		});

	});

	describe("resolve — literal", function() {

		it("finds an exact tiddler title", function() {
			var wiki = setupWiki([{title: "Foo", text: ""}]);
			var r = resolver.resolve("Foo", null, wiki);
			expect(r.status).toBe("literal");
			expect(r.resolved).toBe("Foo");
		});

		it("returns unresolved for a missing ref", function() {
			var wiki = setupWiki([]);
			var r = resolver.resolve("Missing", null, wiki);
			expect(r.status).toBe("unresolved");
			expect(r.resolved).toBeNull();
		});

		it("beats alias / mount / pseudo when the raw ref exists", function() {
			var wiki = setupWiki([
				{title: "V3.3", text: "I am literally V3.3"},
				{title: "a/V3.3", text: ""},
				// Alias that would rewrite V3.3 → a/V3.3
				{title: "$:/ns-alias", tags: "$:/tags/NamespaceAlias", "short": "V3.3", "expands-to": "a/V3.3"}
			]);
			var r = resolver.resolve("V3.3", "some/source", wiki);
			expect(r.status).toBe("literal");
			expect(r.resolved).toBe("V3.3");
		});

	});

	describe("resolve — absolute (has /)", function() {

		it("finds an exact-match absolute title", function() {
			var wiki = setupWiki([{title: "a/b/c", text: ""}]);
			var r = resolver.resolve("a/b/c", null, wiki);
			expect(r.status).toBe("literal");
			expect(r.resolved).toBe("a/b/c");
		});

		it("is unresolved if the absolute path misses", function() {
			var wiki = setupWiki([{title: "a/b/c", text: ""}]);
			var r = resolver.resolve("a/b/missing", null, wiki);
			expect(r.status).toBe("unresolved");
			expect(r.resolved).toBeNull();
		});

		it("walks up multi-segment refs to find an ancestor match", function() {
			// REF contains '/', but it's a relative subpath — walk-up still
			// applies and finds the ancestor candidate.
			var wiki = setupWiki([{title: "a/b/c/d", text: ""}]);
			var r = resolver.resolve("c/d", "a/b/source", wiki);
			expect(r.status).toBe("walkup");
			expect(r.resolved).toBe("a/b/c/d");
		});

		it("walk-up tries the deepest ancestor first for multi-segment refs", function() {
			// Both a/b/X/Y and a/X/Y exist; from source a/b/c the walk-up
			// should hit a/b/X/Y (closest ancestor) before a/X/Y.
			var wiki = setupWiki([
				{title: "a/b/X/Y", text: ""},
				{title: "a/X/Y", text: ""}
			]);
			var r = resolver.resolve("X/Y", "a/b/c", wiki);
			expect(r.status).toBe("walkup");
			expect(r.resolved).toBe("a/b/X/Y");
		});

		it("system-namespace refs ($:/...) never walk up or use context", function() {
			// $:/foo is treated as absolute; even if walk-up could synthesize
			// a hit, it's skipped to avoid degenerate $:/REF matches.
			var wiki = setupWiki([{title: "$:/foo", text: ""}]);
			var r = resolver.resolve("$:/missing", "$:/plugins/x/source", wiki);
			expect(r.status).toBe("unresolved");
		});

	});

	describe("resolve — walk-up", function() {

		it("walks up single step", function() {
			var wiki = setupWiki([{title: "a/b/X", text: ""}]);
			var r = resolver.resolve("X", "a/b/source", wiki);
			expect(r.status).toBe("walkup");
			expect(r.resolved).toBe("a/b/X");
		});

		it("walks up multiple steps to the first hit", function() {
			var wiki = setupWiki([{title: "a/Y", text: ""}]);
			var r = resolver.resolve("Y", "a/b/c/source", wiki);
			expect(r.status).toBe("walkup");
			expect(r.resolved).toBe("a/Y");
		});

		it("is unresolved when no ancestor has the name", function() {
			var wiki = setupWiki([]);
			var r = resolver.resolve("Z", "a/b/c/source", wiki);
			expect(r.status).toBe("unresolved");
		});

		it("walks up within $:/ titles too", function() {
			var wiki = setupWiki([{title: "$:/plugins/foo/Y", text: ""}]);
			var r = resolver.resolve("Y", "$:/plugins/foo/bar/source", wiki);
			expect(r.status).toBe("walkup");
			expect(r.resolved).toBe("$:/plugins/foo/Y");
		});

		it("does not reach '$:/Y' from $:/ sources (min-depth 2)", function() {
			// If we walked down to depth 1 for $:/ paths we'd try "$:/Y",
			// which is a valid-looking but rarely-intended match.
			var wiki = setupWiki([{title: "$:/Y", text: ""}]);
			var r = resolver.resolve("Y", "$:/plugins/foo/X", wiki);
			expect(r.status).toBe("unresolved");
		});

		it("shadow tiddlers count as hits", function() {
			// Stub wiki that claims "a/Y" as a shadow. Aliases/mounts modules
			// also call filterTiddlers — no-op stub is enough since we
			// don't exercise those rewrites here.
			var fakeWiki = {
				tiddlerExists: function(t) { return false; },
				isShadowTiddler: function(t) { return t === "a/Y"; },
				filterTiddlers: function() { return []; },
				getTiddler: function() { return null; },
				getTiddlerText: function(title, fallback) {
					// Feature flags: enable walk-up for this test.
					if(title === "$:/config/rimir/namespace/walk-up") { return "yes"; }
					return fallback || "";
				},
				each: function() {},
				eachShadow: function() {}
			};
			var r = resolver.resolve("Y", "a/b/source", fakeWiki);
			expect(r.status).toBe("walkup");
			expect(r.resolved).toBe("a/Y");
		});

	});

	describe("resolve — context", function() {

		it("uses context prefix when walk-up would miss", function() {
			var wiki = setupWiki([{title: "ctx/X", text: ""}]);
			var r = resolver.resolve("X", "some/source", wiki, {context: "ctx"});
			expect(r.status).toBe("context");
			expect(r.resolved).toBe("ctx/X");
		});

		it("applies context to multi-segment refs too", function() {
			var wiki = setupWiki([{title: "ctx/a/X", text: ""}]);
			var r = resolver.resolve("a/X", "some/source", wiki, {context: "ctx"});
			expect(r.status).toBe("context");
			expect(r.resolved).toBe("ctx/a/X");
		});

		it("doesn't use context if literal already matched", function() {
			var wiki = setupWiki([{title: "X", text: ""}, {title: "ctx/X", text: ""}]);
			var r = resolver.resolve("X", "some/source", wiki, {context: "ctx"});
			expect(r.status).toBe("literal");
			expect(r.resolved).toBe("X");
		});

		it("walk-up tried only if context misses", function() {
			var wiki = setupWiki([{title: "a/X", text: ""}]);
			var r = resolver.resolve("X", "a/b/source", wiki, {context: "wrong-ctx"});
			expect(r.status).toBe("walkup");
			expect(r.resolved).toBe("a/X");
		});

	});

	describe("resolve — alias", function() {

		it("rewrites an exact alias", function() {
			var wiki = setupWiki([
				{title: "a/b/X", text: ""},
				{title: "$:/a1", tags: "$:/tags/NamespaceAlias", "short": "SHORT", "expands-to": "a/b/X"}
			]);
			var r = resolver.resolve("SHORT", null, wiki);
			expect(r.status).toBe("alias");
			expect(r.resolved).toBe("a/b/X");
		});

		it("rewrites via pattern alias", function() {
			var wiki = setupWiki([
				{title: "vers/4.0/X", text: ""},
				{title: "$:/a2", tags: "$:/tags/NamespacePatternAlias", pattern: "^V_(.+)$", replacement: "vers/4.0/$1"}
			]);
			var r = resolver.resolve("V_X", null, wiki);
			expect(r.status).toBe("alias");
			expect(r.resolved).toBe("vers/4.0/X");
		});

		it("exact alias wins over pattern alias", function() {
			var wiki = setupWiki([
				{title: "winner", text: ""},
				{title: "loser", text: ""},
				{title: "$:/ex", tags: "$:/tags/NamespaceAlias", "short": "X", "expands-to": "winner"},
				{title: "$:/pat", tags: "$:/tags/NamespacePatternAlias", pattern: "^X$", replacement: "loser"}
			]);
			var r = resolver.resolve("X", null, wiki);
			expect(r.resolved).toBe("winner");
		});

	});

	describe("resolve — mount", function() {

		it("rewrites an exact prefix match", function() {
			var wiki = setupWiki([
				{title: "phys/root/sub", text: ""},
				{title: "$:/m", tags: "$:/tags/NamespaceMount", from: "short", to: "phys/root"}
			]);
			var r = resolver.resolve("short/sub", null, wiki);
			expect(r.status).toBe("mount");
			expect(r.resolved).toBe("phys/root/sub");
		});

		it("rewrites when ref equals 'from' exactly", function() {
			var wiki = setupWiki([
				{title: "phys/root", text: ""},
				{title: "$:/m", tags: "$:/tags/NamespaceMount", from: "short", to: "phys/root"}
			]);
			var r = resolver.resolve("short", null, wiki);
			expect(r.status).toBe("mount");
			expect(r.resolved).toBe("phys/root");
		});

		it("longest 'from' wins", function() {
			var wiki = setupWiki([
				{title: "specific/sub", text: ""},
				{title: "$:/m1", tags: "$:/tags/NamespaceMount", from: "a", to: "generic"},
				{title: "$:/m2", tags: "$:/tags/NamespaceMount", from: "a/b", to: "specific"}
			]);
			var r = resolver.resolve("a/b/sub", null, wiki);
			expect(r.resolved).toBe("specific/sub");
		});

		it("does not match a partial prefix without trailing slash", function() {
			var wiki = setupWiki([
				{title: "$:/m", tags: "$:/tags/NamespaceMount", from: "foo", to: "bar"},
				{title: "barely", text: ""}
			]);
			// "foobar" should NOT match "foo/" pattern
			var r = resolver.resolve("foobar", null, wiki);
			expect(r.status).toBe("unresolved");
		});

	});

	describe("resolve — precedence", function() {

		it("literal beats alias, alias beats mount, mount beats walk-up", function() {
			var wiki = setupWiki([
				// Literal target (highest precedence)
				{title: "TOP", text: ""},
				// Alias → ALIAS/x (second)
				{title: "$:/a", tags: "$:/tags/NamespaceAlias", "short": "ALI", "expands-to": "aliased"},
				{title: "aliased", text: ""},
				// Mount → MOUNT/x (third)
				{title: "$:/m", tags: "$:/tags/NamespaceMount", from: "mnt", to: "mounted"},
				{title: "mounted/x", text: ""},
				// Walk-up target (last)
				{title: "a/WUP", text: ""}
			]);
			expect(resolver.resolve("TOP", "a/b/src", wiki).status).toBe("literal");
			expect(resolver.resolve("ALI", "a/b/src", wiki).status).toBe("alias");
			expect(resolver.resolve("mnt/x", "a/b/src", wiki).status).toBe("mount");
			expect(resolver.resolve("WUP", "a/b/src", wiki).status).toBe("walkup");
		});

	});

	describe("self-prefix", function() {

		// Helper: setupWiki keeps the four pre-existing flags ON (matches the
		// default in this test file). This helper extends it with self-prefix.
		function setupWithSelfPrefix(tiddlers, on) {
			var wiki = setupWiki(tiddlers);
			wiki.addTiddler({title: "$:/config/rimir/namespace/self-prefix", text: on ? "yes" : "no"});
			flags.invalidate();
			return wiki;
		}

		it("is OFF by default — descendants are not auto-resolved", function() {
			var wiki = setupWiki([
				{title: "a/b/c", text: ""},
				{title: "a/b/c/x", text: ""}
			]);
			// No explicit toggle: setupWiki doesn't enable self-prefix.
			expect(resolver.resolve("x", "a/b/c", wiki).status).toBe("unresolved");
		});

		it("resolves a single-segment descendant ref when ON", function() {
			var wiki = setupWithSelfPrefix([
				{title: "a/b/c", text: ""},
				{title: "a/b/c/x", text: ""}
			], true);
			var r = resolver.resolve("x", "a/b/c", wiki);
			expect(r.status).toBe("self");
			expect(r.resolved).toBe("a/b/c/x");
		});

		it("resolves a multi-segment descendant ref when ON", function() {
			var wiki = setupWithSelfPrefix([
				{title: "a/b/c", text: ""},
				{title: "a/b/c/yt/y/z", text: ""}
			], true);
			var r = resolver.resolve("yt/y/z", "a/b/c", wiki);
			expect(r.status).toBe("self");
			expect(r.resolved).toBe("a/b/c/yt/y/z");
		});

		it("falls through to walk-up when no descendant exists", function() {
			var wiki = setupWithSelfPrefix([
				{title: "a/b/c", text: ""},
				{title: "a/x", text: ""}
			], true);
			var r = resolver.resolve("x", "a/b/c", wiki);
			expect(r.status).toBe("walkup");
			expect(r.resolved).toBe("a/x");
		});

		it("Stage 1 literal still wins when a top-level tiddler matches the ref", function() {
			var wiki = setupWithSelfPrefix([
				{title: "x", text: ""},                // top-level literal
				{title: "a/b/c", text: ""},
				{title: "a/b/c/x", text: ""}            // descendant also exists
			], true);
			var r = resolver.resolve("x", "a/b/c", wiki);
			expect(r.status).toBe("literal");
			expect(r.resolved).toBe("x");
		});

		it("Stage 6 context still wins over self-prefix when both would match", function() {
			var wiki = setupWithSelfPrefix([
				{title: "a/b/c", text: ""},
				{title: "ctx/x", text: ""},             // context match
				{title: "a/b/c/x", text: ""}            // self-prefix match
			], true);
			var r = resolver.resolve("x", "a/b/c", wiki, {context: "ctx"});
			expect(r.status).toBe("context");
			expect(r.resolved).toBe("ctx/x");
		});

		it("$:/ ref still short-circuits to unresolved before self-prefix runs", function() {
			// The $:/ guard at resolver.js:300 fires when the REF (not source)
			// starts with $:/. A $:/ ref means "absolute system title" and
			// shouldn't be contextualized or walked.
			var wiki = setupWithSelfPrefix([
				{title: "a/b/c", text: ""},
				{title: "a/b/c/$:/foo", text: ""}    // would self-prefix-match
			], true);
			var r = resolver.resolve("$:/foo", "a/b/c", wiki);
			expect(r.status).toBe("unresolved");
		});

		it("self-prefix runs from a $:/ source — consistent with walk-up", function() {
			// Walk-up runs from $:/ sources (with minI=2). Self-prefix should
			// behave the same: $:/ source + plain ref = system descendant
			// candidate. Allowed because we never construct "$:/<ref>" — only
			// "<source>/<ref>" which is well-formed.
			var wiki = setupWithSelfPrefix([
				{title: "$:/plugins/foo/bar", text: ""},
				{title: "$:/plugins/foo/bar/x", text: ""}
			], true);
			var r = resolver.resolve("x", "$:/plugins/foo/bar", wiki);
			expect(r.status).toBe("self");
			expect(r.resolved).toBe("$:/plugins/foo/bar/x");
		});

	});

});

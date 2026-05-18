/*\
title: $:/plugins/rimir/namespace/test/test-field-aliases.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the target-attached field-aliases stage — module lookup,
resolver integration, ambiguity surface, configurable field name,
precedence rules, cache invalidation, and relink wrap behaviour.

\*/

"use strict";

describe("namespace: field-aliases", function() {

	var fieldAliases = require("$:/plugins/rimir/namespace/field-aliases.js");
	var resolver     = require("$:/plugins/rimir/namespace/resolver.js");
	var aliases      = require("$:/plugins/rimir/namespace/aliases.js");
	var flags        = require("$:/plugins/rimir/namespace/featureflags.js");
	var scope        = require("$:/plugins/rimir/namespace/scope.js");

	function setupWiki(tiddlers, opts) {
		opts = opts || {};
		var wiki = new $tw.Wiki();
		wiki.addTiddlers(tiddlers || []);
		// Default: turn on field-aliases. Tests that need the off-state
		// pass {fieldAliases: false}.
		wiki.addTiddler({
			title: "$:/config/rimir/namespace/field-aliases",
			text: opts.fieldAliases === false ? "no" : "yes"
		});
		if(opts.aliasField) {
			wiki.addTiddler({title: "$:/config/rimir/namespace/alias-field", text: opts.aliasField});
		}
		if(opts.aliases) {
			wiki.addTiddler({title: "$:/config/rimir/namespace/aliases", text: "yes"});
		}
		wiki.addIndexersToWiki();
		return wiki;
	}

	beforeEach(function() {
		flags.invalidate();
		scope.invalidate();
		fieldAliases.invalidate();
		aliases.invalidateAliases();
	});

	describe("module: resolveFieldAlias", function() {

		it("returns null when no tiddler declares the token", function() {
			var wiki = setupWiki([{title: "project/widget", aliases: "Widget"}]);
			expect(fieldAliases.resolveFieldAlias("Nonexistent", wiki)).toBeNull();
		});

		it("returns a single match", function() {
			var wiki = setupWiki([{title: "project/widget", aliases: "Widget"}]);
			var hit = fieldAliases.resolveFieldAlias("Widget", wiki);
			expect(hit).not.toBeNull();
			expect(hit.ambiguous).toBe(false);
			expect(hit.title).toBe("project/widget");
		});

		it("parses multi-word tokens via [[...]] syntax", function() {
			var wiki = setupWiki([{title: "t", aliases: "One [[Two Words]] Three"}]);
			expect(fieldAliases.resolveFieldAlias("One", wiki).title).toBe("t");
			expect(fieldAliases.resolveFieldAlias("Two Words", wiki).title).toBe("t");
			expect(fieldAliases.resolveFieldAlias("Three", wiki).title).toBe("t");
		});

		it("returns an ambiguity sentinel when two tiddlers declare the same token", function() {
			var wiki = setupWiki([
				{title: "a", aliases: "Shared"},
				{title: "b", aliases: "Shared"}
			]);
			var hit = fieldAliases.resolveFieldAlias("Shared", wiki);
			expect(hit.ambiguous).toBe(true);
			expect(hit.candidates.sort()).toEqual(["a", "b"]);
		});

		it("deduplicates the same title appearing twice in one field", function() {
			// Author repeats a token by accident — shouldn't surface as
			// ambiguity (since both refer to the same target tiddler).
			var wiki = setupWiki([{title: "t", aliases: "Dup Dup"}]);
			var hit = fieldAliases.resolveFieldAlias("Dup", wiki);
			expect(hit.ambiguous).toBe(false);
			expect(hit.title).toBe("t");
		});

	});

	describe("module: configurable field name", function() {

		it("honours $:/config/rimir/namespace/alias-field", function() {
			var wiki = setupWiki([
				{title: "t1", aliases: "FromDefault"},
				{title: "t2", "other-names": "FromCustom"}
			], {aliasField: "other-names"});
			// Default field no longer in use — "FromDefault" is invisible.
			expect(fieldAliases.resolveFieldAlias("FromDefault", wiki)).toBeNull();
			expect(fieldAliases.resolveFieldAlias("FromCustom", wiki).title).toBe("t2");
		});

		it("normalises an UPPER-case config to lower-case (TW field convention)", function() {
			var wiki = setupWiki([{title: "t", aliases: "X"}], {aliasField: "Aliases"});
			expect(fieldAliases.resolveFieldAlias("X", wiki).title).toBe("t");
		});

		it("falls back to 'aliases' when the config tiddler is blank", function() {
			var wiki = setupWiki([{title: "t", aliases: "X"}], {aliasField: "   "});
			expect(fieldAliases.getFieldName(wiki)).toBe("aliases");
			expect(fieldAliases.resolveFieldAlias("X", wiki).title).toBe("t");
		});

	});

	describe("module: getAmbiguities", function() {

		it("lists every collision sorted by token", function() {
			var wiki = setupWiki([
				{title: "a", aliases: "Zebra Shared"},
				{title: "b", aliases: "Shared Apple"},
				{title: "c", aliases: "Apple"}
			]);
			var ambs = fieldAliases.getAmbiguities(wiki);
			expect(ambs.length).toBe(2);
			expect(ambs[0].token).toBe("Apple");
			expect(ambs[0].candidates.sort()).toEqual(["b", "c"]);
			expect(ambs[1].token).toBe("Shared");
			expect(ambs[1].candidates.sort()).toEqual(["a", "b"]);
		});

		it("returns empty array when there are no collisions", function() {
			var wiki = setupWiki([{title: "t", aliases: "X Y Z"}]);
			expect(fieldAliases.getAmbiguities(wiki)).toEqual([]);
		});

	});

	describe("resolver integration: status + precedence", function() {

		it("returns status 'field-alias' on a single match", function() {
			var wiki = setupWiki([{title: "project/widget", aliases: "Widget"}]);
			var r = resolver.resolve("Widget", null, wiki);
			expect(r.status).toBe("field-alias");
			expect(r.resolved).toBe("project/widget");
		});

		it("returns status 'ambiguous' with ambiguity metadata on collision", function() {
			var wiki = setupWiki([
				{title: "a", aliases: "Foo"},
				{title: "b", aliases: "Foo"}
			]);
			var r = resolver.resolve("Foo", null, wiki);
			expect(r.status).toBe("ambiguous");
			expect(r.resolved).toBeNull();
			expect(r.ambiguity.token).toBe("Foo");
			expect(r.ambiguity.candidates.sort()).toEqual(["a", "b"]);
			expect(r.ambiguity.field).toBe("aliases");
		});

		it("a real tiddler beats an alias on the same token (literal stage wins)", function() {
			var wiki = setupWiki([
				{title: "Widget", text: ""},                 // real tiddler
				{title: "other/widget", aliases: "Widget"}   // declares Widget as alias
			]);
			var r = resolver.resolve("Widget", null, wiki);
			expect(r.status).toBe("literal");
			expect(r.resolved).toBe("Widget");
		});

		it("field-alias beats a NamespaceAlias rewrite on the same token", function() {
			// Field-alias points to "T-fa"; NamespaceAlias points to "T-na".
			// Both targets exist. Field-alias should win (closer to truth).
			var wiki = setupWiki([
				{title: "T-fa", aliases: "Token"},
				{title: "T-na", text: ""},
				{title: "$:/a", tags: "$:/tags/NamespaceAlias", "short": "Token", "expands-to": "T-na"}
			], {aliases: true});
			var r = resolver.resolve("Token", null, wiki);
			expect(r.status).toBe("field-alias");
			expect(r.resolved).toBe("T-fa");
		});

		it("does nothing when the feature flag is off", function() {
			var wiki = setupWiki([{title: "project/widget", aliases: "Widget"}], {fieldAliases: false});
			var r = resolver.resolve("Widget", null, wiki);
			expect(r.status).toBe("unresolved");
		});

		it("skips $:/-prefixed refs even when field-aliases is on", function() {
			// A user typing [[$:/some/path]] is using absolute syntax; we
			// shouldn't accidentally match against an alias declaration.
			var wiki = setupWiki([{title: "t", aliases: "$:/foo"}]);
			var r = resolver.resolve("$:/foo", null, wiki);
			expect(r.status).toBe("unresolved");
		});

		it("falls through to walk-up when the field-alias target is missing", function() {
			// Stale cache or just a typo: tiddler "ghost" listed as an
			// alias on a tiddler that itself doesn't exist anymore. The
			// resolver should fall through rather than returning a missing
			// target.
			var wiki = setupWiki([
				{title: "section/note", aliases: "Note"},
				{title: "section/Note", text: ""}  // real tiddler under same section
			]);
			wiki.addTiddler({title: "$:/config/rimir/namespace/walk-up", text: "yes"});
			flags.invalidate();
			// From an unrelated source, the field-alias hit (section/note)
			// IS real, so this stays a field-alias resolution. Use a hit
			// that intentionally points at a non-existent target instead:
			wiki.deleteTiddler("section/note");
			fieldAliases.invalidate();
			// Now "Note" has no field-alias declaration anymore — falls
			// through cleanly to walk-up from a deep source.
			var r = resolver.resolve("Note", "section/sub/leaf", wiki);
			expect(r.status).toBe("walkup");
			expect(r.resolved).toBe("section/Note");
		});

	});

	describe("walk-up does not participate", function() {

		it("a field-alias resolution is global, not contextual", function() {
			// A target deep under section A declares 'Foo'. From a deep
			// source under section B, [[Foo]] should resolve to A's target
			// — field-aliases is global, not per-prefix.
			var wiki = setupWiki([
				{title: "sectionA/widget", aliases: "Foo"}
			]);
			wiki.addTiddler({title: "$:/config/rimir/namespace/walk-up", text: "yes"});
			flags.invalidate();
			var r = resolver.resolve("Foo", "sectionB/leaf/deep", wiki);
			expect(r.status).toBe("field-alias");
			expect(r.resolved).toBe("sectionA/widget");
		});

	});

	describe("cache invalidation", function() {

		it("rebuilds after invalidate()", function() {
			var wiki = setupWiki([{title: "t1", aliases: "X"}]);
			expect(fieldAliases.resolveFieldAlias("X", wiki).title).toBe("t1");
			// Add a second target — without invalidation the cache would
			// still report unambiguous.
			wiki.addTiddler({title: "t2", aliases: "X"});
			fieldAliases.invalidate();
			var hit = fieldAliases.resolveFieldAlias("X", wiki);
			expect(hit.ambiguous).toBe(true);
			expect(hit.candidates.sort()).toEqual(["t1", "t2"]);
		});

		it("invalidate(wiki) drops only that wiki's cache", function() {
			var wikiA = setupWiki([{title: "tA", aliases: "X"}]);
			var wikiB = setupWiki([{title: "tB", aliases: "X"}]);
			expect(fieldAliases.resolveFieldAlias("X", wikiA).title).toBe("tA");
			expect(fieldAliases.resolveFieldAlias("X", wikiB).title).toBe("tB");
			wikiA.addTiddler({title: "tA", aliases: "Y"});
			fieldAliases.invalidate(wikiA);
			expect(fieldAliases.resolveFieldAlias("X", wikiA)).toBeNull();
			expect(fieldAliases.resolveFieldAlias("Y", wikiA).title).toBe("tA");
			// wikiB cache is untouched.
			expect(fieldAliases.resolveFieldAlias("X", wikiB).title).toBe("tB");
		});

	});

	describe("locality narrowing (Restricted scope mode)", function() {

		function setupRestrictedWiki(tiddlers, prefixes) {
			var wiki = setupWiki(tiddlers);
			wiki.addTiddler({title: "$:/config/rimir/namespace/scope-mode", text: "prefixes"});
			wiki.addTiddler({
				title: "$:/config/rimir/namespace/scope-prefixes",
				text: prefixes.join("\n")
			});
			scope.invalidate();
			return wiki;
		}

		it("picks the single in-subtree candidate and carries ambiguity for tooltip", function() {
			var wiki = setupRestrictedWiki([
				{title: "knowledge/llm/Widget", aliases: "Widget"},
				{title: "knowledge/orga/Widget", aliases: "Widget"}
			], ["knowledge/llm", "knowledge/orga"]);
			var r = resolver.resolve("Widget", "knowledge/llm/note", wiki);
			expect(r.status).toBe("field-alias");
			expect(r.resolved).toBe("knowledge/llm/Widget");
			expect(r.ambiguity).toBeDefined();
			expect(r.ambiguity.narrowedTo).toBe("knowledge/llm/Widget");
			expect(r.ambiguity.subtree).toBe("knowledge/llm");
			expect(r.ambiguity.candidates.sort()).toEqual([
				"knowledge/llm/Widget", "knowledge/orga/Widget"
			]);
		});

		it("stays ambiguous when ≥2 candidates share the source's subtree", function() {
			var wiki = setupRestrictedWiki([
				{title: "knowledge/llm/a/Widget", aliases: "Widget"},
				{title: "knowledge/llm/b/Widget", aliases: "Widget"},
				{title: "knowledge/orga/Widget", aliases: "Widget"}
			], ["knowledge/llm", "knowledge/orga"]);
			var r = resolver.resolve("Widget", "knowledge/llm/note", wiki);
			expect(r.status).toBe("ambiguous");
			// Surfaced candidates are the in-subtree ones.
			expect(r.ambiguity.candidates.sort()).toEqual([
				"knowledge/llm/a/Widget", "knowledge/llm/b/Widget"
			]);
			// allCandidates preserves the full collision for context.
			expect(r.ambiguity.allCandidates.sort()).toEqual([
				"knowledge/llm/a/Widget", "knowledge/llm/b/Widget", "knowledge/orga/Widget"
			]);
		});

		it("stays ambiguous (full list) when 0 candidates share the source's subtree", function() {
			// Source is in 'knowledge/llm' subtree; all candidates are elsewhere.
			// The user is shown the full collision since locality can't help.
			var wiki = setupRestrictedWiki([
				{title: "knowledge/orga/Widget", aliases: "Widget"},
				{title: "private/Widget", aliases: "Widget"}
			], ["knowledge/llm", "knowledge/orga", "private"]);
			var r = resolver.resolve("Widget", "knowledge/llm/note", wiki);
			expect(r.status).toBe("ambiguous");
			expect(r.ambiguity.candidates.sort()).toEqual([
				"knowledge/orga/Widget", "private/Widget"
			]);
			// No narrowing happened, so allCandidates is omitted.
			expect(r.ambiguity.allCandidates).toBeUndefined();
		});

		it("uses the longest matching subtree prefix when several overlap", function() {
			// Source under 'knowledge/llm/vendor' matches both prefixes;
			// longer one wins so narrowing happens against 'knowledge/llm/vendor'.
			var wiki = setupRestrictedWiki([
				{title: "knowledge/llm/vendor/Widget", aliases: "Widget"},
				{title: "knowledge/llm/other/Widget", aliases: "Widget"}
			], ["knowledge/llm", "knowledge/llm/vendor"]);
			var r = resolver.resolve("Widget", "knowledge/llm/vendor/note", wiki);
			expect(r.status).toBe("field-alias");
			expect(r.resolved).toBe("knowledge/llm/vendor/Widget");
			expect(r.ambiguity.subtree).toBe("knowledge/llm/vendor");
		});

		it("falls through to plain ambiguity in Global scope mode", function() {
			// Locality is a Restricted-mode-only refinement. Same collision
			// resolved from a Global-mode wiki should stay ambiguous,
			// without narrowedTo / subtree metadata.
			var wiki = setupWiki([
				{title: "knowledge/llm/Widget", aliases: "Widget"},
				{title: "knowledge/orga/Widget", aliases: "Widget"}
			]);
			var r = resolver.resolve("Widget", "knowledge/llm/note", wiki);
			expect(r.status).toBe("ambiguous");
			expect(r.ambiguity.subtree).toBeUndefined();
			expect(r.ambiguity.allCandidates).toBeUndefined();
		});

		it("ignores narrowing when the source is out-of-scope (resolver short-circuits earlier)", function() {
			var wiki = setupRestrictedWiki([
				{title: "knowledge/llm/Widget", aliases: "Widget"},
				{title: "knowledge/orga/Widget", aliases: "Widget"}
			], ["knowledge/llm", "knowledge/orga"]);
			// Source outside any whitelisted prefix.
			var r = resolver.resolve("Widget", "scratchpad/x", wiki);
			expect(r.status).toBe("out-of-scope");
		});

	});

	describe("containsAffectedTiddler", function() {

		it("returns true for a tiddler that currently has the alias field", function() {
			var wiki = setupWiki([{title: "t", aliases: "X"}]);
			expect(fieldAliases.containsAffectedTiddler(["t"], wiki)).toBe(true);
		});

		it("returns true for a tiddler that previously contributed (pre-invalidation cache)", function() {
			var wiki = setupWiki([{title: "t", aliases: "X"}]);
			fieldAliases.resolveFieldAlias("X", wiki); // prime cache
			// Author drops the aliases field — but BEFORE invalidate, the
			// cache still records "t" as a contributor.
			wiki.addTiddler({title: "t", text: "now without aliases"});
			expect(fieldAliases.containsAffectedTiddler(["t"], wiki)).toBe(true);
		});

		it("returns false for an unrelated tiddler", function() {
			var wiki = setupWiki([{title: "t", aliases: "X"}]);
			fieldAliases.resolveFieldAlias("X", wiki);
			expect(fieldAliases.containsAffectedTiddler(["other"], wiki)).toBe(false);
		});

	});

});

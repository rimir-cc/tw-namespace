/*\
title: $:/plugins/rimir/namespace/test/test-indexer.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the backlinks indexer — basic forward/backward edges,
context detection (pragma + field), incremental reindex, and the
skip-non-indexable-types rule.

\*/

"use strict";

describe("namespace: indexer", function() {

	var indexer = require("$:/plugins/rimir/namespace/indexer.js");
	var aliases = require("$:/plugins/rimir/namespace/aliases.js");
	var mounts = require("$:/plugins/rimir/namespace/mounts.js");
	var resolver = require("$:/plugins/rimir/namespace/resolver.js");
	var flags = require("$:/plugins/rimir/namespace/featureflags.js");
	var scope = require("$:/plugins/rimir/namespace/scope.js");

	function setupWiki(tiddlers) {
		var wiki = new $tw.Wiki();
		wiki.addTiddlers(tiddlers || []);
		wiki.addTiddler({title: "$:/config/rimir/namespace/walk-up", text: "yes"});
		wiki.addTiddler({title: "$:/config/rimir/namespace/aliases", text: "yes"});
		wiki.addTiddler({title: "$:/config/rimir/namespace/pseudo-expansion", text: "yes"});
		wiki.addTiddler({title: "$:/config/rimir/namespace/implicit-context", text: "yes"});
		wiki.addIndexersToWiki();
		return wiki;
	}

	beforeEach(function() {
		flags.invalidate();
		scope.invalidate();
		indexer.reset();
		aliases.invalidateAliases();
		mounts.invalidateMounts();
		resolver.invalidatePseudoCache();
	});

	it("indexes a literal absolute reference", function() {
		var wiki = setupWiki([
			{title: "source", text: "see [[target]] here"},
			{title: "target", text: ""}
		]);
		indexer.rebuildAll(wiki);
		expect(indexer.getBacklinks("target")).toEqual(["source"]);
		expect(indexer.getForwardLinks("source")).toEqual(["target"]);
	});

	it("indexes walk-up resolves", function() {
		var wiki = setupWiki([
			{title: "a/b/source", text: "see [[target]]"},
			{title: "a/target", text: ""}
		]);
		indexer.rebuildAll(wiki);
		expect(indexer.getBacklinks("a/target")).toEqual(["a/b/source"]);
	});

	it("indexes _latest-expanded references", function() {
		var wiki = setupWiki([
			{title: "v/3.0/x", text: ""},
			{title: "v/4.0/x", text: ""},
			{title: "source", text: "see [[v/_latest/x]]"}
		]);
		indexer.rebuildAll(wiki);
		// Resolves to v/4.0/x
		expect(indexer.getBacklinks("v/4.0/x")).toEqual(["source"]);
	});

	it("detects context from \\context pragma", function() {
		var wiki = setupWiki([
			{title: "ctx/target", text: ""},
			{title: "source", text: "\\context ctx\n\nuses [[target]]"}
		]);
		indexer.rebuildAll(wiki);
		expect(indexer.getBacklinks("ctx/target")).toEqual(["source"]);
	});

	it("detects context from the context field", function() {
		var wiki = setupWiki([
			{title: "ctx/target", text: ""},
			{title: "source", context: "ctx", text: "uses [[target]]"}
		]);
		indexer.rebuildAll(wiki);
		expect(indexer.getBacklinks("ctx/target")).toEqual(["source"]);
	});

	it("indexes transclusion {{target}} refs", function() {
		var wiki = setupWiki([
			{title: "target", text: ""},
			{title: "source", text: "include: {{target}}"}
		]);
		indexer.rebuildAll(wiki);
		expect(indexer.getBacklinks("target")).toEqual(["source"]);
	});

	it("ignores filter-transclusion {{{filter}}}", function() {
		var wiki = setupWiki([
			{title: "target", text: ""},
			{title: "source", text: "list: {{{ [[target]] }}}"}
		]);
		indexer.rebuildAll(wiki);
		// The filter-transclusion regex must not match — otherwise "target"
		// would appear as a transclusion ref; but the [[target]] inside the
		// filter DOES count as a prettylink, so it's still a backlink. The
		// point of this test is we don't double-count or crash.
		expect(indexer.getBacklinks("target")).toEqual(["source"]);
	});

	it("skips non-indexable tiddler types", function() {
		var wiki = setupWiki([
			{title: "target", text: ""},
			{title: "source.json", type: "application/json", text: '{"ref":"[[target]]"}'},
			{title: "source.png", type: "image/png", text: "[[target]]"}
		]);
		indexer.rebuildAll(wiki);
		expect(indexer.getBacklinks("target")).toEqual([]);
	});

	it("indexes markdown tiddlers", function() {
		var wiki = setupWiki([
			{title: "target", text: ""},
			{title: "source", type: "text/x-markdown", text: "see [[target]]"}
		]);
		indexer.rebuildAll(wiki);
		expect(indexer.getBacklinks("target")).toEqual(["source"]);
	});

	it("returns empty arrays for unknown titles", function() {
		var wiki = setupWiki([]);
		indexer.rebuildAll(wiki);
		expect(indexer.getBacklinks("missing")).toEqual([]);
		expect(indexer.getForwardLinks("missing")).toEqual([]);
	});

	it("reindex drops stale edges and adds new ones", function() {
		var wiki = setupWiki([
			{title: "source", text: "see [[A]]"},
			{title: "A", text: ""},
			{title: "B", text: ""}
		]);
		indexer.rebuildAll(wiki);
		expect(indexer.getBacklinks("A")).toEqual(["source"]);
		expect(indexer.getBacklinks("B")).toEqual([]);

		// Change source to point to B
		wiki.addTiddler({title: "source", text: "see [[B]]"});
		indexer.reindex("source", wiki);
		expect(indexer.getBacklinks("A")).toEqual([]);
		expect(indexer.getBacklinks("B")).toEqual(["source"]);
	});

	it("reindexMany handles multiple changed titles", function() {
		var wiki = setupWiki([
			{title: "T", text: ""},
			{title: "s1", text: "[[T]]"},
			{title: "s2", text: "[[T]]"}
		]);
		indexer.rebuildAll(wiki);
		expect(indexer.getBacklinks("T").sort()).toEqual(["s1", "s2"]);

		// Remove s1's reference and s2's reference
		wiki.addTiddler({title: "s1", text: "nothing"});
		wiki.addTiddler({title: "s2", text: "nothing"});
		indexer.reindexMany(["s1", "s2"], wiki);
		expect(indexer.getBacklinks("T")).toEqual([]);
	});

	it("multiple sources pointing at the same target accumulate correctly", function() {
		var wiki = setupWiki([
			{title: "T", text: ""},
			{title: "s1", text: "[[T]]"},
			{title: "s2", text: "[[T]]"},
			{title: "s3", text: "[[T]]"}
		]);
		indexer.rebuildAll(wiki);
		expect(indexer.getBacklinks("T").sort()).toEqual(["s1", "s2", "s3"]);
	});

	// ----------------------------------------------------------------------
	// Scope mode — OOS sources should produce no edges (their refs only
	// resolve via TW core, which has its own backlinks tracking).
	// ----------------------------------------------------------------------
	describe("scope mode (prefixes)", function() {

		function setupScopedWiki(tiddlers) {
			var wiki = setupWiki(tiddlers);
			wiki.addTiddler({title: "$:/config/rimir/namespace/scope-mode", text: "prefixes"});
			wiki.addTiddler({title: "$:/config/rimir/namespace/scope-prefixes", text: "knowledge"});
			flags.invalidate();
			scope.invalidate();
			return wiki;
		}

		it("OOS source with [[ref]] adds NO forward edges", function() {
			var wiki = setupScopedWiki([
				{title: "knowledge/foo", text: ""},
				{title: "inbox/today", text: "see [[knowledge/foo]] and [[bar]]"}
			]);
			indexer.rebuildAll(wiki);
			expect(indexer.getForwardLinks("inbox/today")).toEqual([]);
			expect(indexer.getBacklinks("knowledge/foo")).toEqual([]);
		});

		it("in-scope source still indexes refs to in-scope targets", function() {
			var wiki = setupScopedWiki([
				{title: "knowledge/foo", text: ""},
				{title: "knowledge/bar", text: "see [[foo]]"}
			]);
			indexer.rebuildAll(wiki);
			// walk-up from "knowledge/bar" finds "knowledge/foo"
			expect(indexer.getBacklinks("knowledge/foo")).toEqual(["knowledge/bar"]);
		});

		it("in-scope source can reference an OOS-titled target (target scope is irrelevant)", function() {
			var wiki = setupScopedWiki([
				{title: "inbox/somewhere", text: ""},
				{title: "knowledge/foo", text: "see [[inbox/somewhere]]"}
			]);
			indexer.rebuildAll(wiki);
			// "inbox/somewhere" exists as a literal title; from in-scope source
			// the resolver Stage 1 hits it. Forward edge added.
			expect(indexer.getBacklinks("inbox/somewhere")).toEqual(["knowledge/foo"]);
		});

		it("OOS source after toggling scope back to global picks up edges on reindex", function() {
			var wiki = setupScopedWiki([
				{title: "T", text: ""},
				{title: "inbox/today", text: "see [[T]]"}
			]);
			indexer.rebuildAll(wiki);
			expect(indexer.getBacklinks("T")).toEqual([]);
			// Switch to global
			wiki.addTiddler({title: "$:/config/rimir/namespace/scope-mode", text: "global"});
			scope.invalidate();
			indexer.rebuildAll(wiki);
			expect(indexer.getBacklinks("T")).toEqual(["inbox/today"]);
		});

		it("incremental reindex of an OOS source clears its prior edges", function() {
			// Start in global mode so the source initially has edges, then
			// switch to prefixes mode that excludes it and reindex.
			var wiki = setupWiki([
				{title: "knowledge/T", text: ""},
				{title: "inbox/today", text: "see [[knowledge/T]]"}
			]);
			indexer.rebuildAll(wiki);
			expect(indexer.getBacklinks("knowledge/T")).toEqual(["inbox/today"]);
			// Switch to prefixes-mode w/ "knowledge"; inbox/today is now OOS.
			wiki.addTiddler({title: "$:/config/rimir/namespace/scope-mode", text: "prefixes"});
			wiki.addTiddler({title: "$:/config/rimir/namespace/scope-prefixes", text: "knowledge"});
			scope.invalidate();
			indexer.reindex("inbox/today", wiki);
			expect(indexer.getBacklinks("knowledge/T")).toEqual([]);
		});

		it("rebuildAll mixed wiki: in-scope sources indexed, OOS sources skipped", function() {
			var wiki = setupScopedWiki([
				{title: "knowledge/T", text: ""},
				{title: "knowledge/src1", text: "see [[T]]"},
				{title: "inbox/src2", text: "see [[knowledge/T]]"}
			]);
			indexer.rebuildAll(wiki);
			expect(indexer.getBacklinks("knowledge/T")).toEqual(["knowledge/src1"]);
		});

	});

});

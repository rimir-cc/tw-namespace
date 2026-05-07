/*\
title: $:/plugins/rimir/namespace/test/test-scope.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for scope.js — the source-scope gate that decides whether a given
source tiddler is subject to namespace behavior.

\*/

"use strict";

describe("namespace: scope", function() {

	var scope = require("$:/plugins/rimir/namespace/scope.js");

	function setupWiki(tiddlers) {
		var wiki = new $tw.Wiki();
		wiki.addTiddlers(tiddlers || []);
		return wiki;
	}

	function setMode(wiki, mode) {
		wiki.addTiddler({title: scope.MODE_TIDDLER, text: mode});
		scope.invalidate();
	}

	function setPrefixes(wiki, body) {
		wiki.addTiddler({title: scope.PREFIXES_TIDDLER, text: body});
		scope.invalidate();
	}

	beforeEach(function() {
		scope.invalidate();
	});

	describe("defaults & mode parsing", function() {

		it("returns true for any title when no config tiddlers are present", function() {
			var wiki = setupWiki([]);
			expect(scope.isInScope("anything/here", wiki)).toBe(true);
			expect(scope.isInScope("$:/plugins/foo", wiki)).toBe(true);
			expect(scope.isInScope("", wiki)).toBe(true); // global mode
		});

		it("treats unknown mode values as 'global'", function() {
			var wiki = setupWiki([]);
			setMode(wiki, "foo");
			expect(scope.isInScope("anything", wiki)).toBe(true);
		});

		it("treats empty mode tiddler text as 'global'", function() {
			var wiki = setupWiki([]);
			setMode(wiki, "");
			expect(scope.isInScope("anything", wiki)).toBe(true);
		});

		it("treats whitespace-only mode tiddler text as 'global'", function() {
			var wiki = setupWiki([]);
			setMode(wiki, "   \n  ");
			expect(scope.isInScope("anything", wiki)).toBe(true);
		});

		it("explicit 'global' mode → all titles in scope", function() {
			var wiki = setupWiki([]);
			setMode(wiki, "global");
			setPrefixes(wiki, "knowledge"); // ignored in global mode
			expect(scope.isInScope("knowledge/foo", wiki)).toBe(true);
			expect(scope.isInScope("inbox/today", wiki)).toBe(true);
			expect(scope.isInScope("$:/SiteTitle", wiki)).toBe(true);
			expect(scope.isInScope("", wiki)).toBe(true);
		});

		it("'prefixes' mode + empty list → nothing in scope (including empty source)", function() {
			var wiki = setupWiki([]);
			setMode(wiki, "prefixes");
			setPrefixes(wiki, "");
			expect(scope.isInScope("anything", wiki)).toBe(false);
			expect(scope.isInScope("knowledge/foo", wiki)).toBe(false);
			expect(scope.isInScope("", wiki)).toBe(false);
		});

		it("case-mismatched mode 'PREFIXES' falls back to global (we only match lowercase)", function() {
			var wiki = setupWiki([]);
			setMode(wiki, "PREFIXES");
			setPrefixes(wiki, "knowledge");
			expect(scope.isInScope("inbox/today", wiki)).toBe(true);
		});

		it("mode value with surrounding whitespace is trimmed", function() {
			var wiki = setupWiki([]);
			setMode(wiki, "  prefixes  ");
			setPrefixes(wiki, "knowledge");
			expect(scope.isInScope("knowledge/foo", wiki)).toBe(true);
			expect(scope.isInScope("inbox/today", wiki)).toBe(false);
		});

	});

	describe("segment-boundary matching", function() {

		function scopedWiki(prefixesBody) {
			var wiki = setupWiki([]);
			setMode(wiki, "prefixes");
			setPrefixes(wiki, prefixesBody);
			return wiki;
		}

		it("matches the prefix exactly", function() {
			var wiki = scopedWiki("knowledge");
			expect(scope.isInScope("knowledge", wiki)).toBe(true);
		});

		it("matches descendants below the prefix", function() {
			var wiki = scopedWiki("knowledge");
			expect(scope.isInScope("knowledge/llm/foo", wiki)).toBe(true);
			expect(scope.isInScope("knowledge/x", wiki)).toBe(true);
		});

		it("does NOT match titles where the prefix continues without a separator", function() {
			var wiki = scopedWiki("knowledge");
			expect(scope.isInScope("knowledgeBase/x", wiki)).toBe(false);
			expect(scope.isInScope("knowledge2/x", wiki)).toBe(false);
		});

		it("does NOT match the prefix appearing mid-title (must match from start)", function() {
			var wiki = scopedWiki("knowledge");
			expect(scope.isInScope("x/knowledge/y", wiki)).toBe(false);
		});

		it("does NOT match a truncated form of the prefix", function() {
			var wiki = scopedWiki("knowledge");
			expect(scope.isInScope("knowledg", wiki)).toBe(false);
		});

		it("multi-segment prefix matches only at full-segment boundary", function() {
			var wiki = scopedWiki("knowledge/llm");
			expect(scope.isInScope("knowledge/llm", wiki)).toBe(true);
			expect(scope.isInScope("knowledge/llm/vendor/x", wiki)).toBe(true);
			expect(scope.isInScope("knowledge/llmx", wiki)).toBe(false);
			expect(scope.isInScope("knowledge/llmother/x", wiki)).toBe(false);
			expect(scope.isInScope("knowledge", wiki)).toBe(false);
		});

		it("blank lines in the prefix list are ignored", function() {
			var wiki = scopedWiki("\n\n");
			expect(scope.isInScope("anything", wiki)).toBe(false);
		});

		it("deep prefix matches deeper descendants but not shallower ancestors", function() {
			var wiki = scopedWiki("a/b/c");
			expect(scope.isInScope("a/b/c", wiki)).toBe(true);
			expect(scope.isInScope("a/b/c/d", wiki)).toBe(true);
			expect(scope.isInScope("a/b", wiki)).toBe(false);
			expect(scope.isInScope("a", wiki)).toBe(false);
		});

		it("trailing slash on the prefix is tolerated ('knowledge/' acts like 'knowledge')", function() {
			var wiki = scopedWiki("knowledge/");
			expect(scope.isInScope("knowledge", wiki)).toBe(true);
			expect(scope.isInScope("knowledge/a/b/c", wiki)).toBe(true);
			expect(scope.isInScope("knowledge/a/b/c/d", wiki)).toBe(true);
			expect(scope.isInScope("knowledgeBase/x", wiki)).toBe(false);
		});

		it("multiple trailing slashes are stripped", function() {
			var wiki = scopedWiki("knowledge///");
			expect(scope.isInScope("knowledge/a/b", wiki)).toBe(true);
			expect(scope.isInScope("knowledgeBase/x", wiki)).toBe(false);
		});

		it("a line containing only slashes is ignored", function() {
			var wiki = scopedWiki("knowledge\n///");
			expect(scope.isInScope("knowledge/x", wiki)).toBe(true);
			expect(scope.isInScope("anything", wiki)).toBe(false);
		});

	});

	describe("multi-prefix lists", function() {

		function scopedWiki(prefixesBody) {
			var wiki = setupWiki([]);
			setMode(wiki, "prefixes");
			setPrefixes(wiki, prefixesBody);
			return wiki;
		}

		it("two prefixes — both areas in scope independently", function() {
			var wiki = scopedWiki("knowledge\nproject");
			expect(scope.isInScope("knowledge/foo", wiki)).toBe(true);
			expect(scope.isInScope("project/x", wiki)).toBe(true);
			expect(scope.isInScope("inbox/today", wiki)).toBe(false);
		});

		it("only newlines → empty effective list, nothing in scope", function() {
			var wiki = scopedWiki("\n\n\n");
			expect(scope.isInScope("anything", wiki)).toBe(false);
		});

		it("trims surrounding whitespace per line and skips blanks", function() {
			var wiki = scopedWiki("  knowledge  \n\n  project/research  \n");
			expect(scope.isInScope("knowledge/foo", wiki)).toBe(true);
			expect(scope.isInScope("project/research/x", wiki)).toBe(true);
			expect(scope.isInScope("project/other", wiki)).toBe(false);
		});

		it("CRLF line endings parse correctly", function() {
			var wiki = scopedWiki("knowledge\r\nproject");
			expect(scope.isInScope("knowledge/foo", wiki)).toBe(true);
			expect(scope.isInScope("project/x", wiki)).toBe(true);
		});

		it("duplicates in list are tolerated", function() {
			var wiki = scopedWiki("knowledge\nknowledge");
			expect(scope.isInScope("knowledge/foo", wiki)).toBe(true);
			expect(scope.isInScope("inbox/today", wiki)).toBe(false);
		});

	});

	describe("special title forms", function() {

		it("$:/-source in 'prefixes' mode without $:/ in whitelist → OOS", function() {
			var wiki = setupWiki([]);
			setMode(wiki, "prefixes");
			setPrefixes(wiki, "knowledge");
			expect(scope.isInScope("$:/plugins/foo", wiki)).toBe(false);
			expect(scope.isInScope("$:/SiteTitle", wiki)).toBe(false);
		});

		it("$:/ prefix in whitelist matches $:/ titles at segment boundary", function() {
			var wiki = setupWiki([]);
			setMode(wiki, "prefixes");
			setPrefixes(wiki, "$:/plugins/rimir");
			expect(scope.isInScope("$:/plugins/rimir", wiki)).toBe(true);
			expect(scope.isInScope("$:/plugins/rimir/foo", wiki)).toBe(true);
			expect(scope.isInScope("$:/plugins/other", wiki)).toBe(false);
		});

		it("empty / null / undefined sourceTitle in prefixes mode → OOS", function() {
			var wiki = setupWiki([]);
			setMode(wiki, "prefixes");
			setPrefixes(wiki, "knowledge");
			expect(scope.isInScope("", wiki)).toBe(false);
			expect(scope.isInScope(null, wiki)).toBe(false);
			expect(scope.isInScope(undefined, wiki)).toBe(false);
		});

	});

	describe("cache & invalidation", function() {

		it("repeated calls don't keep re-reading config tiddlers", function() {
			var wiki = setupWiki([]);
			setMode(wiki, "prefixes");
			setPrefixes(wiki, "knowledge");
			// Spy on getTiddlerText to confirm only one read pair after warm-up.
			var calls = 0;
			var orig = wiki.getTiddlerText;
			wiki.getTiddlerText = function() { calls++; return orig.apply(wiki, arguments); };
			scope.invalidate();
			scope.isInScope("knowledge/foo", wiki); // warms up — reads both tiddlers
			var afterWarmup = calls;
			scope.isInScope("knowledge/bar", wiki);
			scope.isInScope("inbox/today", wiki);
			scope.isInScope("knowledge/llm/x", wiki);
			expect(calls).toBe(afterWarmup); // no additional reads
			wiki.getTiddlerText = orig;
		});

		it("after invalidate(), next call re-reads", function() {
			var wiki = setupWiki([]);
			setMode(wiki, "global");
			expect(scope.isInScope("anything", wiki)).toBe(true);
			// Switch to prefixes-with-empty-list — anything goes OOS
			setMode(wiki, "prefixes");
			setPrefixes(wiki, "");
			expect(scope.isInScope("anything", wiki)).toBe(false);
		});

		it("isConfigChange detects scope-mode changes", function() {
			var changes = {};
			changes[scope.MODE_TIDDLER] = {modified: true};
			expect(scope.isConfigChange(changes)).toBe(true);
		});

		it("isConfigChange detects scope-prefixes changes", function() {
			var changes = {};
			changes[scope.PREFIXES_TIDDLER] = {modified: true};
			expect(scope.isConfigChange(changes)).toBe(true);
		});

		it("isConfigChange returns false for unrelated changes", function() {
			expect(scope.isConfigChange({"$:/foo": {}})).toBe(false);
			expect(scope.isConfigChange({})).toBe(false);
			expect(scope.isConfigChange(null)).toBe(false);
			expect(scope.isConfigChange(undefined)).toBe(false);
		});

	});

});

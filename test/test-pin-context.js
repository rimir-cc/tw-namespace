/*\
title: $:/plugins/rimir/namespace/test/test-pin-context.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the ns-pin-context filter operator — the "pin _latest" action.
Includes a regression test for the bug where the NS tab's $list rebound
currentTiddler to the filter output, causing the pin button to target
the wrong tiddler.

\*/

"use strict";

describe("namespace: ns-pin-context filter", function() {

	var filterModule = require("$:/plugins/rimir/namespace/filter.js");
	var resolver = require("$:/plugins/rimir/namespace/resolver.js");
	var flags = require("$:/plugins/rimir/namespace/featureflags.js");

	function setupWiki(tiddlers) {
		var wiki = new $tw.Wiki();
		wiki.addTiddlers(tiddlers || []);
		wiki.addTiddler({title: "$:/config/rimir/namespace/pseudo-expansion", text: "yes"});
		wiki.addIndexersToWiki();
		return wiki;
	}

	beforeEach(function() {
		flags.invalidate();
		resolver.invalidatePseudoCache();
	});

	// Minimal shim to invoke the filter-operator function directly.
	function runOp(wiki, inputTitles) {
		var results = [],
			source = function(iter) {
				for(var i = 0; i < inputTitles.length; i++) {
					iter(wiki.getTiddler(inputTitles[i]), inputTitles[i]);
				}
			};
		return filterModule["ns-pin-context"](source, {operand: ""}, {wiki: wiki});
	}

	it("rewrites \\context …/_latest to the current version-max", function() {
		var wiki = setupWiki([
			{title: "v/3.0/x", text: ""},
			{title: "v/5.0/x", text: ""},
			{title: "doc", text: "\\context v/_latest\n\nsome body"}
		]);
		var out = runOp(wiki, ["doc"]);
		expect(out.length).toBe(1);
		expect(out[0]).toBe("\\context v/5.0\n\nsome body");
	});

	it("returns text unchanged when pragma has no drifting pseudos", function() {
		var wiki = setupWiki([
			{title: "doc", text: "\\context v/4.0.3\n\nsome body"}
		]);
		var out = runOp(wiki, ["doc"]);
		expect(out[0]).toBe("\\context v/4.0.3\n\nsome body");
	});

	it("returns text unchanged when there is no \\context pragma", function() {
		var wiki = setupWiki([
			{title: "doc", text: "plain body, no pragma"}
		]);
		var out = runOp(wiki, ["doc"]);
		expect(out[0]).toBe("plain body, no pragma");
	});

	it("preserves the body after the pragma line", function() {
		var wiki = setupWiki([
			{title: "v/4.0/x", text: ""},
			{title: "doc", text: "\\context v/_latest\n\n! Heading\n\nPara with [[link]]"}
		]);
		var out = runOp(wiki, ["doc"]);
		expect(out[0]).toBe("\\context v/4.0\n\n! Heading\n\nPara with [[link]]");
	});

	it("handles a pragma that isn't the first line (leading blank)", function() {
		var wiki = setupWiki([
			{title: "v/4.0/x", text: ""},
			{title: "doc", text: "\n\\context v/_latest\nbody"}
		]);
		var out = runOp(wiki, ["doc"]);
		// /m anchor matches the pragma on its own line even with leading blanks
		expect(out[0]).toContain("\\context v/4.0");
		expect(out[0]).not.toContain("_latest");
	});

	it("returns empty string when tiddler doesn't exist", function() {
		var wiki = setupWiki([]);
		var out = runOp(wiki, ["missing"]);
		expect(out[0]).toBe("");
	});

	it("is idempotent on already-pinned content", function() {
		var wiki = setupWiki([
			{title: "v/5.0/x", text: ""},
			{title: "doc", text: "\\context v/_latest\n\nbody"}
		]);
		var first = runOp(wiki, ["doc"])[0];
		// Simulate applying the pin: update the tiddler's text.
		wiki.addTiddler({title: "doc", text: first});
		resolver.invalidatePseudoCache();
		var second = runOp(wiki, ["doc"])[0];
		expect(second).toBe(first);
	});

});

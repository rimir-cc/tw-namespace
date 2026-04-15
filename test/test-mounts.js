/*\
title: $:/plugins/rimir/namespace/test/test-mounts.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the mounts module — exact/prefix match, longest-first ordering,
slash normalisation, field validation.

\*/

"use strict";

describe("namespace: mounts", function() {

	var mounts = require("$:/plugins/rimir/namespace/mounts.js");

	function setupWiki(tiddlers) {
		var wiki = new $tw.Wiki();
		wiki.addTiddlers(tiddlers || []);
		wiki.addIndexersToWiki();
		return wiki;
	}

	beforeEach(function() { mounts.invalidateMounts(); });

	it("rewrites exact-match refs", function() {
		var wiki = setupWiki([
			{title: "$:/m", tags: "$:/tags/NamespaceMount", from: "short", to: "phys/root"}
		]);
		expect(mounts.resolveMount("short", wiki)).toBe("phys/root");
	});

	it("rewrites prefix-matched refs", function() {
		var wiki = setupWiki([
			{title: "$:/m", tags: "$:/tags/NamespaceMount", from: "short", to: "phys/root"}
		]);
		expect(mounts.resolveMount("short/a/b", wiki)).toBe("phys/root/a/b");
	});

	it("does not match partial prefixes", function() {
		var wiki = setupWiki([
			{title: "$:/m", tags: "$:/tags/NamespaceMount", from: "short", to: "phys/root"}
		]);
		// "shorty" starts with "short" but is not "short" nor "short/..."
		expect(mounts.resolveMount("shorty", wiki)).toBeNull();
	});

	it("returns null when nothing matches", function() {
		var wiki = setupWiki([
			{title: "$:/m", tags: "$:/tags/NamespaceMount", from: "a", to: "x"}
		]);
		expect(mounts.resolveMount("unrelated", wiki)).toBeNull();
	});

	it("longest 'from' wins", function() {
		var wiki = setupWiki([
			{title: "$:/m-short", tags: "$:/tags/NamespaceMount", from: "a", to: "generic"},
			{title: "$:/m-long", tags: "$:/tags/NamespaceMount", from: "a/b", to: "specific"}
		]);
		expect(mounts.resolveMount("a/b/sub", wiki)).toBe("specific/sub");
		expect(mounts.resolveMount("a/other", wiki)).toBe("generic/other");
	});

	it("normalises stray leading/trailing slashes in 'from'", function() {
		var wiki = setupWiki([
			{title: "$:/m", tags: "$:/tags/NamespaceMount", from: "/sloppy/", to: "clean"}
		]);
		expect(mounts.resolveMount("sloppy", wiki)).toBe("clean");
		expect(mounts.resolveMount("sloppy/sub", wiki)).toBe("clean/sub");
	});

	it("skips mount entries missing required fields", function() {
		var wiki = setupWiki([
			{title: "$:/m1", tags: "$:/tags/NamespaceMount", from: "", to: "x"},
			{title: "$:/m2", tags: "$:/tags/NamespaceMount", from: "x", to: ""},
			{title: "$:/m3", tags: "$:/tags/NamespaceMount", from: "ok", to: "ok-dest"}
		]);
		expect(mounts.resolveMount("x", wiki)).toBeNull();
		expect(mounts.resolveMount("ok", wiki)).toBe("ok-dest");
	});

});

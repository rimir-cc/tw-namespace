/*\
title: $:/plugins/rimir/namespace/test/test-relink.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for relink integration — verifies that renaming a tiddler updates
`\context` pragmas and `<$context>` widget attributes that reference it.

Requires the relink plugin to be loaded in the test wiki.

\*/

"use strict";

describe("namespace: relink integration", function() {

	// Guard: skip all specs if the relink plugin isn't loaded.
	var relinkAvailable = (typeof $tw.wiki.relinkTiddler === "function")
		&& !!$tw.wiki.getTiddler("$:/plugins/flibbles/relink");

	if(!relinkAvailable) {
		it("relink plugin not loaded — skipping relink tests", function() {
			pending("relink plugin not available in this test edition");
		});
		return;
	}

	function setupWiki(tiddlers) {
		var wiki = new $tw.Wiki();
		// Copy relink plugin shadow tiddlers into the test wiki so
		// relinkTiddler has its full infrastructure.
		$tw.wiki.each(function(tiddler, title) {
			if(title.indexOf("$:/plugins/flibbles/relink") === 0) {
				wiki.addTiddler(tiddler);
			}
		});
		$tw.wiki.eachShadow(function(tiddler, title) {
			if(title.indexOf("$:/plugins/flibbles/relink") === 0) {
				wiki.addTiddler(tiddler);
			}
		});
		// Add the namespace plugin's relink config tiddler.
		wiki.addTiddler({
			title: "$:/config/flibbles/relink/attributes/$context/prefix",
			text: "title"
		});
		wiki.addTiddlers(tiddlers || []);
		wiki.addIndexersToWiki();
		return wiki;
	}

	describe("\\context pragma", function() {

		it("updates prefix when referenced tiddler is renamed", function() {
			var wiki = setupWiki([
				{title: "page", text: "\\context old/prefix\n\nsome body"}
			]);
			wiki.relinkTiddler("old/prefix", "new/prefix");
			expect(wiki.getTiddler("page").fields.text)
				.toBe("\\context new/prefix\n\nsome body");
		});

		it("preserves single trailing newline", function() {
			var wiki = setupWiki([
				{title: "page", text: "\\context old/prefix\nsome body"}
			]);
			wiki.relinkTiddler("old/prefix", "new/prefix");
			expect(wiki.getTiddler("page").fields.text)
				.toBe("\\context new/prefix\nsome body");
		});

		it("does not change when prefix doesn't match", function() {
			var wiki = setupWiki([
				{title: "page", text: "\\context unrelated/prefix\nsome body"}
			]);
			wiki.relinkTiddler("old/prefix", "new/prefix");
			expect(wiki.getTiddler("page").fields.text)
				.toBe("\\context unrelated/prefix\nsome body");
		});

		it("handles prefix with deep path", function() {
			var wiki = setupWiki([
				{title: "page", text: "\\context OWASP/ASVS/4.0.3\n\nbody"}
			]);
			wiki.relinkTiddler("OWASP/ASVS/4.0.3", "OWASP/ASVS/5.0");
			expect(wiki.getTiddler("page").fields.text)
				.toBe("\\context OWASP/ASVS/5.0\n\nbody");
		});

	});

	describe("<$context> widget", function() {

		it("updates prefix attribute when referenced tiddler is renamed", function() {
			var wiki = setupWiki([
				{title: "page", text: "<$context prefix=\"old/prefix\">\nbody\n</$context>"}
			]);
			wiki.relinkTiddler("old/prefix", "new/prefix");
			expect(wiki.getTiddler("page").fields.text)
				.toBe("<$context prefix=\"new/prefix\">\nbody\n</$context>");
		});

		it("does not change when prefix doesn't match", function() {
			var wiki = setupWiki([
				{title: "page", text: "<$context prefix=\"unrelated\">\nbody\n</$context>"}
			]);
			wiki.relinkTiddler("old/prefix", "new/prefix");
			expect(wiki.getTiddler("page").fields.text)
				.toBe("<$context prefix=\"unrelated\">\nbody\n</$context>");
		});

	});

});

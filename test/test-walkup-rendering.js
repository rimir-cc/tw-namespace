/*\
title: $:/plugins/rimir/namespace/test/test-walkup-rendering.js
type: application/javascript
tags: [[$:/tags/test-spec]]

End-to-end regression: walk-up must succeed when wikitext is rendered
through `<$transclude $tiddler=...>`, which sets `thisTiddler` in
TW 5.4.0+ but does NOT set `currentTiddler`. The prettylink rule must
prefer thisTiddler over currentTiddler when picking a source-title
operand for ns-resolve.

Bug history (0.1.12): in knowledge-app, `[[sum]]` from
`knowledge/llm/test/ergo` (with `context: knowledge/llm`) rendered as
ns-unresolved because `<$transclude>` set thisTiddler but the prettylink
filter referenced `<currentTiddler>`, which was empty. Walk-up was
gated by `if(sourceTitle && ...)` and short-circuited.

\*/
"use strict";

describe("namespace: walk-up under transclusion (regression)", function() {

	var resolver = require("$:/plugins/rimir/namespace/resolver.js");
	var aliases = require("$:/plugins/rimir/namespace/aliases.js");
	var mounts = require("$:/plugins/rimir/namespace/mounts.js");
	var flags = require("$:/plugins/rimir/namespace/featureflags.js");

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
		resolver.invalidatePseudoCache();
		aliases.invalidateAliases();
		mounts.invalidateMounts();
	});

	function renderHtml(wiki, hostText) {
		wiki.addTiddler({title: "host", text: hostText});
		var widget = wiki.makeTranscludeWidget("host",
			{parseAsInline: false, document: $tw.fakeDocument});
		var container = $tw.fakeDocument.createElement("div");
		widget.render(container, null);
		return container.outerHTML || "";
	}

	it("[[sum]] resolves via walk-up when rendered through $transclude $tiddler=", function() {
		var wiki = setupWiki([
			{title: "knowledge/llm/test/ergo", context: "knowledge/llm", text: "[[sum]]"},
			{title: "knowledge/llm/test/sum", text: ""}
		]);
		// Mirror knowledge-app/views/note.tid pattern: outer $context wrap,
		// then $transclude $tiddler=<<viewTiddler>> $mode="block".
		var html = renderHtml(wiki,
			"<$let viewTiddler=\"knowledge/llm/test/ergo\" " +
			"      noteContext={{{ [<viewTiddler>get[context]] }}}>" +
			"<$context prefix=<<noteContext>>>" +
			"<$transclude $tiddler=<<viewTiddler>> $mode=\"block\"/>" +
			"</$context>" +
			"</$let>");
		expect(html).toContain("ns-resolved\"");
		expect(html).not.toContain("ns-unresolved");
	});

	it("[[test/sum]] also walks up under $transclude (multi-segment ref)", function() {
		var wiki = setupWiki([
			{title: "knowledge/llm/test/ergo", context: "knowledge/llm", text: "[[test/sum]]"},
			{title: "knowledge/llm/test/sum", text: ""}
		]);
		var html = renderHtml(wiki,
			"<$let viewTiddler=\"knowledge/llm/test/ergo\">" +
			"<$transclude $tiddler=<<viewTiddler>> $mode=\"block\"/>" +
			"</$let>");
		expect(html).toContain("ns-resolved\"");
		expect(html).not.toContain("ns-unresolved");
	});

	it("genuinely unresolved refs still get ns-unresolved", function() {
		var wiki = setupWiki([
			{title: "a/b/c", text: "[[Nope]]"}
		]);
		var html = renderHtml(wiki,
			"<$transclude $tiddler=\"a/b/c\" $mode=\"block\"/>");
		expect(html).toContain("ns-unresolved");
	});

});

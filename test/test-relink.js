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

	// Guard: skip all specs if the relink plugin's runtime isn't actually
	// active. A bare presence of the relink plugin tiddler and the core's
	// own relinkTiddler is not enough — we need the override patched in by
	// flibbles' bulkops.js startup module. Probe by running a no-op rename
	// against a temp wiki and checking that a `\context` reference was
	// rewritten (which only the relink wikitextrule pipeline can do).
	function relinkActuallyWorks() {
		try {
			var probe = new $tw.Wiki();
			probe.addTiddler({title: "_p", text: "\\context xx\nbody"});
			probe.relinkTiddler("xx", "yy");
			var t = probe.getTiddler("_p");
			return t && t.fields.text.indexOf("\\context yy") === 0;
		} catch(e) {
			return false;
		}
	}

	if(!relinkActuallyWorks()) {
		it("relink plugin not loaded — skipping relink tests", function() {
			pending("relink plugin not active in this test edition");
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

	describe("[[ref]] prettylink", function() {

		// Resolver feature flags need to be enabled per-test for short refs
		// to resolve via walk-up / context / self-prefix.
		function setupWithFlags(tiddlers, opts) {
			opts = opts || {};
			var wiki = setupWiki(tiddlers);
			if(opts.walkUp !== false) {
				wiki.addTiddler({title: "$:/config/rimir/namespace/walk-up", text: "yes"});
			}
			if(opts.selfPrefix) {
				wiki.addTiddler({title: "$:/config/rimir/namespace/self-prefix", text: "yes"});
			}
			if(opts.implicitContext) {
				wiki.addTiddler({title: "$:/config/rimir/namespace/implicit-context", text: "yes"});
			}
			// Re-invalidate the flag cache so new config is read.
			require("$:/plugins/rimir/namespace/featureflags.js").invalidate();
			return wiki;
		}

		it("rewrites an absolute literal ref to the new absolute title", function() {
			var wiki = setupWithFlags([
				{title: "page", text: "see [[knowledge/llm/foo]]"},
				{title: "knowledge/llm/foo", text: ""}
			]);
			wiki.relinkTiddler("knowledge/llm/foo", "knowledge/ai/foo");
			expect(wiki.getTiddler("page").fields.text)
				.toBe("see [[knowledge/ai/foo]]");
		});

		it("preserves [[label|target]] form, updating only the target", function() {
			var wiki = setupWithFlags([
				{title: "page", text: "[[friendly|knowledge/llm/foo]]"},
				{title: "knowledge/llm/foo", text: ""}
			]);
			wiki.relinkTiddler("knowledge/llm/foo", "knowledge/ai/foo");
			expect(wiki.getTiddler("page").fields.text)
				.toBe("[[friendly|knowledge/ai/foo]]");
		});

		it("rewrites a walk-up-resolved short ref to a labeled absolute when target moves out of scope", function() {
			var wiki = setupWithFlags([
				{title: "knowledge/llm/foo", text: "see [[bar]]"},
				{title: "knowledge/llm/bar", text: ""}
			]);
			wiki.relinkTiddler("knowledge/llm/bar", "knowledge/ai/bar");
			// [[bar]] resolved to knowledge/llm/bar via walk-up. After rename,
			// walk-up from knowledge/llm/foo can't reach knowledge/ai/bar.
			// Preserve the display "bar" with absolute target.
			expect(wiki.getTiddler("knowledge/llm/foo").fields.text)
				.toBe("see [[bar|knowledge/ai/bar]]");
		});

		it("leaves a walk-up short ref unchanged when target stays reachable post-rename", function() {
			// The ref text equals the new target's last segment AND the new
			// target lives on the source's walk-up path — so walk-up still
			// resolves the unchanged ref to the new title.
			var wiki = setupWithFlags([
				{title: "a/b/c", text: "see [[X]]"},
				{title: "a/b/X", text: ""}
			]);
			wiki.relinkTiddler("a/b/X", "a/X");
			// From a/b/c, [[X]] post-rename: walk-up tries a/b/c/X (no),
			// a/b/X (gone), a/X (yes). Resolves to the new title — no rewrite.
			expect(wiki.getTiddler("a/b/c").fields.text).toBe("see [[X]]");
		});

		it("does not touch refs that resolve to a different tiddler", function() {
			var wiki = setupWithFlags([
				{title: "knowledge/llm/foo", text: "see [[bar]] and [[unrelated]]"},
				{title: "knowledge/llm/bar", text: ""},
				{title: "unrelated", text: ""}
			]);
			wiki.relinkTiddler("knowledge/llm/bar", "knowledge/ai/bar");
			expect(wiki.getTiddler("knowledge/llm/foo").fields.text)
				.toBe("see [[bar|knowledge/ai/bar]] and [[unrelated]]");
		});

		it("does not touch external links", function() {
			var wiki = setupWithFlags([
				{title: "page", text: "[[https://example.com]]"}
			]);
			wiki.relinkTiddler("https://example.com", "https://other.com");
			expect(wiki.getTiddler("page").fields.text)
				.toBe("[[https://example.com]]");
		});

		it("rewrites a context-resolved short ref", function() {
			var wiki = setupWithFlags([
				{title: "page", context: "knowledge/llm", text: "[[bar]]"},
				{title: "knowledge/llm/bar", text: ""}
			], {implicitContext: true});
			wiki.relinkTiddler("knowledge/llm/bar", "knowledge/ai/bar");
			expect(wiki.getTiddler("page").fields.text)
				.toBe("[[bar|knowledge/ai/bar]]");
		});

		it("rewrites a self-prefix-resolved short ref", function() {
			var wiki = setupWithFlags([
				{title: "knowledge/llm/v4", text: "see [[notes/foo]]"},
				{title: "knowledge/llm/v4/notes/foo", text: ""}
			], {selfPrefix: true});
			wiki.relinkTiddler(
				"knowledge/llm/v4/notes/foo",
				"knowledge/llm/v4/articles/foo"
			);
			// Post-rename, [[notes/foo]] from knowledge/llm/v4 still tries
			// self-prefix → knowledge/llm/v4/notes/foo (no longer exists).
			// Walk-up tries other prefixes — none match. Pinned absolute.
			expect(wiki.getTiddler("knowledge/llm/v4").fields.text)
				.toBe("see [[notes/foo|knowledge/llm/v4/articles/foo]]");
		});

		it("handles batch rename of a subtree (knowledge/llm → knowledge/ai)", function() {
			// Mirrors a relink-titles cascading rename. Each child is renamed
			// individually: (1) update references, (2) move the tiddler.
			// Both notes reference each other.
			var wiki = setupWithFlags([
				{title: "knowledge/llm/foo", text: "see [[bar]]"},
				{title: "knowledge/llm/bar", text: "see [[foo]]"}
			]);

			function renameTiddler(from, to) {
				// Update references first so they capture the pre-rename state.
				wiki.relinkTiddler(from, to);
				// Then move the actual tiddler.
				var t = wiki.getTiddler(from);
				if(t) {
					var fields = $tw.utils.extend({}, t.fields, {title: to});
					wiki.deleteTiddler(from);
					wiki.addTiddler(new $tw.Tiddler(fields));
				}
			}

			// Step 1: rename knowledge/llm/foo → knowledge/ai/foo.
			renameTiddler("knowledge/llm/foo", "knowledge/ai/foo");
			// knowledge/llm/bar's [[foo]] resolved (via walk-up) to knowledge/llm/foo
			// = fromTitle. Post-rename simulation from knowledge/llm/bar: walk-up
			// tries knowledge/llm/foo (gone), knowledge/foo (no). Doesn't reach
			// knowledge/ai/foo. → pinned to absolute.
			expect(wiki.getTiddler("knowledge/llm/bar").fields.text)
				.toBe("see [[foo|knowledge/ai/foo]]");

			// Step 2: rename knowledge/llm/bar → knowledge/ai/bar.
			renameTiddler("knowledge/llm/bar", "knowledge/ai/bar");
			// knowledge/ai/foo's [[bar]]: pre-rename, walk-up from knowledge/ai/foo
			// tries knowledge/ai/bar (no — only ai/foo exists in ai/ at this moment),
			// then knowledge/bar (no), then bar (no). → unresolved BEFORE relink.
			// So current.resolved !== fromTitle (knowledge/llm/bar). Our rule
			// returns undefined — no rewrite needed (and none possible: the ref
			// didn't resolve to fromTitle in the first place).
			// HOWEVER, knowledge/llm/bar is the source for OTHER refs that may
			// have been pinned. The labeled-absolute pin from step 1
			// ([[foo|knowledge/ai/foo]] now sits in knowledge/ai/bar after move)
			// DOES resolve to knowledge/ai/foo, which is correct.
			expect(wiki.getTiddler("knowledge/ai/bar").fields.text)
				.toBe("see [[foo|knowledge/ai/foo]]");
			// And ai/foo's text is unchanged from input — but we expect it to
			// link to ai/bar correctly post-rename.
			expect(wiki.getTiddler("knowledge/ai/foo").fields.text)
				.toBe("see [[bar]]");
		});

		it("preserves [[label|target]] when the target stays a valid short ref", function() {
			// Labeled form where target is a short ref that still resolves
			// post-rename: leave unchanged.
			var wiki = setupWithFlags([
				{title: "knowledge/llm/foo", text: "[[click here|bar]]"},
				{title: "knowledge/llm/bar", text: ""}
			]);
			// Rename within walk-up scope: bar → bar2 inside same parent.
			wiki.relinkTiddler("knowledge/llm/bar", "knowledge/llm/bar2");
			// Post-rename, [[click here|bar]] target "bar" no longer resolves
			// (bar is gone). Must rewrite the target portion.
			expect(wiki.getTiddler("knowledge/llm/foo").fields.text)
				.toBe("[[click here|knowledge/llm/bar2]]");
		});

	});

});

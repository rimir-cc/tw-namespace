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

		it("smart-shortens a walk-up-resolved short ref when the new title has a valid shorter form", function() {
			var wiki = setupWithFlags([
				{title: "knowledge/llm/foo", text: "see [[bar]]"},
				{title: "knowledge/llm/bar", text: ""}
			]);
			wiki.relinkTiddler("knowledge/llm/bar", "knowledge/ai/bar");
			// Smart shortening tries: [[bar]] (no, walk-up doesn't reach
			// the new location), [[ai/bar]] (yes, walk-up via knowledge → ai/bar).
			expect(wiki.getTiddler("knowledge/llm/foo").fields.text)
				.toBe("see [[ai/bar]]");
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
			// [[bar]] gets smart-shortened to [[ai/bar]]; [[unrelated]]
			// resolves to a different tiddler so it stays put.
			expect(wiki.getTiddler("knowledge/llm/foo").fields.text)
				.toBe("see [[ai/bar]] and [[unrelated]]");
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

		it("smart-shortens a self-prefix-resolved short ref to the new path's last segments", function() {
			var wiki = setupWithFlags([
				{title: "knowledge/llm/v4", text: "see [[notes/foo]]"},
				{title: "knowledge/llm/v4/notes/foo", text: ""}
			], {selfPrefix: true});
			wiki.relinkTiddler(
				"knowledge/llm/v4/notes/foo",
				"knowledge/llm/v4/articles/foo"
			);
			// Smart shortening tries [[foo]] (walk-up from v4 can't find it),
			// then [[articles/foo]] which self-prefix resolves to the new
			// title. That's the rewrite.
			expect(wiki.getTiddler("knowledge/llm/v4").fields.text)
				.toBe("see [[articles/foo]]");
		});

		it("user's example: rename a/b/c/d → a/b/c/e from source a/b/c shortens [[d]] to [[e]]", function() {
			var wiki = setupWithFlags([
				{title: "a/b/c", text: "[[d]]"},
				{title: "a/b/c/d", text: ""}
			], {selfPrefix: true});
			wiki.relinkTiddler("a/b/c/d", "a/b/c/e");
			expect(wiki.getTiddler("a/b/c").fields.text).toBe("[[e]]");
		});

		it("preserves segment-count when rewriting: [[b/c/d]] from a/b/c → [[f/c/d]] (rename a/b → a/f cascade)", function() {
			// Source a/b/c references a deep descendant via 3-segment ref.
			// User renames a/b → a/f, cascading to rename a/b/c → a/f/c and
			// a/b/c/d → a/f/c/d. We expect the 3-segment ref to keep its
			// 3-segment shape rather than collapse to [[d]].
			var wiki = setupWithFlags([
				{title: "a/b", text: ""},
				{title: "a/b/c", text: "[[b/c/d]]"},
				{title: "a/b/c/d", text: ""}
			]);
			function renameTiddler(from, to) {
				wiki.relinkTiddler(from, to);
				var t = wiki.getTiddler(from);
				if(t) {
					var fields = $tw.utils.extend({}, t.fields, {title: to});
					wiki.deleteTiddler(from);
					wiki.addTiddler(new $tw.Tiddler(fields));
				}
			}
			// Cascade bottom-up: rename child first so its text gets a chance
			// to be relinked while parents are still at their old titles.
			renameTiddler("a/b/c/d", "a/f/c/d");
			renameTiddler("a/b/c", "a/f/c");
			renameTiddler("a/b", "a/f");
			expect(wiki.getTiddler("a/f/c").fields.text).toBe("[[f/c/d]]");
		});

		it("user-reported flow: relinkTiddler with relink-titles cascade rewrites [[b/c/d]] → [[f/c/d]]", function() {
			// Skip if relink-titles isn't actually wired up — copying its
			// shadow tiddlers into a fresh wiki doesn't re-run the
			// relinktitlesrule module registration.
			var hasRelinkTitles = false;
			if($tw.modules && $tw.modules.types && $tw.modules.types.relinktitlesrule) {
				hasRelinkTitles = !!$tw.modules.types.relinktitlesrule[
					"$:/plugins/flibbles/relink-titles/rules/directory"];
			}
			if(!hasRelinkTitles) { pending("relink-titles not loaded as a module"); return; }
			var wiki = setupWithFlags([
				{title: "a/b", text: ""},
				{title: "a/b/c", text: "[[b/c/d]]"},
				{title: "a/b/c/d", text: ""}
			]);
			// Rename the source itself + run relink (UI's typical flow).
			var t = wiki.getTiddler("a/b");
			wiki.deleteTiddler("a/b");
			wiki.addTiddler(new $tw.Tiddler($tw.utils.extend({}, t.fields, {title: "a/f"})));
			wiki.relinkTiddler("a/b", "a/f");
			// relink-titles' directory rule cascades child renames within
			// this single relinkTiddler call. By the time our rule fires
			// on the nested rename of a/b/c/d, the original is already
			// deleted — wrapWikiForPreRename keeps it visible to the
			// resolver so the ref's resolution is detectable.
			expect(wiki.getTiddler("a/f/c")).toBeDefined();
			expect(wiki.getTiddler("a/f/c/d")).toBeDefined();
			expect(wiki.getTiddler("a/f/c").fields.text).toBe("[[f/c/d]]");
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
			// = fromTitle. Smart shortening finds "ai/foo" works post-rename
			// (walk-up from knowledge/llm/bar climbs to knowledge/, then
			// "knowledge/ai/foo" exists).
			expect(wiki.getTiddler("knowledge/llm/bar").fields.text)
				.toBe("see [[ai/foo]]");

			// Step 2: rename knowledge/llm/bar → knowledge/ai/bar.
			renameTiddler("knowledge/llm/bar", "knowledge/ai/bar");
			// knowledge/ai/bar (was knowledge/llm/bar) now has "see [[ai/foo]]".
			// That ref resolves to knowledge/ai/foo via walk-up — unchanged.
			// knowledge/ai/foo's [[bar]] still says [[bar]] in raw text (its
			// resolution was never to knowledge/llm/bar, since walk-up from
			// ai/foo climbs to knowledge/ where ai/bar appears at the right
			// time). Both end-state texts are functional.
			expect(wiki.getTiddler("knowledge/ai/bar").fields.text)
				.toBe("see [[ai/foo]]");
			expect(wiki.getTiddler("knowledge/ai/foo").fields.text)
				.toBe("see [[bar]]");
		});

		it("rewrites [[label|target]] target with a smart-shortened form when available", function() {
			var wiki = setupWithFlags([
				{title: "knowledge/llm/foo", text: "[[click here|bar]]"},
				{title: "knowledge/llm/bar", text: ""}
			]);
			// Rename within walk-up scope: bar → bar2 inside same parent.
			wiki.relinkTiddler("knowledge/llm/bar", "knowledge/llm/bar2");
			// Label preserved; target shortened (bar2 resolves via walk-up).
			expect(wiki.getTiddler("knowledge/llm/foo").fields.text)
				.toBe("[[click here|bar2]]");
		});

		// ----------------------------------------------------------------
		// Scope mode — when scope-mode is "prefixes", OOS sources are NOT
		// rewritten by our namespace relink rule. (flibbles' core relinker
		// would still rewrite literal-title refs there in real use, but the
		// namespace rule itself must skip.)
		// ----------------------------------------------------------------
		describe("scope mode (prefixes)", function() {

			var scope = require("$:/plugins/rimir/namespace/scope.js");

			function setupScoped(tiddlers, opts) {
				var wiki = setupWithFlags(tiddlers, opts);
				wiki.addTiddler({title: "$:/config/rimir/namespace/scope-mode", text: "prefixes"});
				wiki.addTiddler({title: "$:/config/rimir/namespace/scope-prefixes", text: "knowledge"});
				scope.invalidate();
				return wiki;
			}

			afterEach(function() {
				// Restore global mode for subsequent describe blocks /
				// existing relink specs that don't expect scope active.
				scope.invalidate();
			});

			it("OOS source: short ref that needs walk-up is left alone (no namespace magic)", function() {
				// In an OOS source, walk-up doesn't apply — `[[bar]]` doesn't
				// resolve to `knowledge/llm/bar` from `inbox/today`. Renaming
				// `knowledge/llm/bar` therefore does NOT touch the short ref.
				var wiki = setupScoped([
					{title: "inbox/today", text: "see [[bar]]"},
					{title: "knowledge/llm/bar", text: ""}
				]);
				wiki.relinkTiddler("knowledge/llm/bar", "knowledge/ai/bar");
				expect(wiki.getTiddler("inbox/today").fields.text)
					.toBe("see [[bar]]");
			});

			it("OOS source: absolute-title ref IS rewritten (text match, no resolver needed)", function() {
				// Absolute-title rewrites are pure text replacements — we still
				// do them in OOS sources so the rename doesn't break the link.
				// (Without this, flibbles' built-in rule would otherwise handle
				// it, but rule iteration only fires one rule per match.)
				var wiki = setupScoped([
					{title: "inbox/today", text: "see [[knowledge/llm/foo]]"},
					{title: "knowledge/llm/foo", text: ""}
				]);
				wiki.relinkTiddler("knowledge/llm/foo", "knowledge/ai/foo");
				expect(wiki.getTiddler("inbox/today").fields.text)
					.toBe("see [[knowledge/ai/foo]]");
			});

			it("OOS source: [[label|absolute]] target IS rewritten, label preserved", function() {
				var wiki = setupScoped([
					{title: "inbox/today", text: "[[click here|knowledge/llm/foo]]"},
					{title: "knowledge/llm/foo", text: ""}
				]);
				wiki.relinkTiddler("knowledge/llm/foo", "knowledge/ai/foo");
				expect(wiki.getTiddler("inbox/today").fields.text)
					.toBe("[[click here|knowledge/ai/foo]]");
			});

			it("in-scope source still gets short-form rewrite (regression)", function() {
				var wiki = setupScoped([
					{title: "knowledge/llm/src", text: "see [[bar]]"},
					{title: "knowledge/llm/bar", text: ""}
				]);
				wiki.relinkTiddler("knowledge/llm/bar", "knowledge/ai/bar");
				// In-scope source: namespace rule rewrites short ref via walk-up.
				expect(wiki.getTiddler("knowledge/llm/src").fields.text)
					.toBe("see [[ai/bar]]");
			});

			it("in-scope source referencing OOS-titled target — still rewritten on rename", function() {
				// Source is in scope; target's title is outside any whitelist
				// but exists. Our rule should still pick this up because the
				// gate keys on source scope, not target scope.
				var wiki = setupScoped([
					{title: "knowledge/llm/src", text: "see [[inbox/old]]"},
					{title: "inbox/old", text: ""}
				]);
				wiki.relinkTiddler("inbox/old", "inbox/new");
				expect(wiki.getTiddler("knowledge/llm/src").fields.text)
					.toBe("see [[inbox/new]]");
			});

			it("global mode + same scenario: all rewrites happen as before", function() {
				// Regression: with no scope tiddlers (global default), the
				// short-form ref in an "OOS-by-name" source DOES get rewritten
				// because namespace machinery applies everywhere.
				var wiki = setupWithFlags([
					{title: "inbox/today", text: "see [[bar]]"},
					{title: "knowledge/llm/bar", text: ""}
				]);
				// "[[bar]]" from "inbox/today" doesn't resolve via walk-up
				// (bar isn't under inbox), so resolver returns unresolved →
				// namespace rule doesn't touch it. Behavior unchanged.
				wiki.relinkTiddler("knowledge/llm/bar", "knowledge/ai/bar");
				expect(wiki.getTiddler("inbox/today").fields.text)
					.toBe("see [[bar]]");
			});

			it("\\context pragma in OOS source: title-handler still rewrites the prefix", function() {
				// The pragma's title is "knowledge/llm" — flibbles' core
				// title handler still rewrites it (it's a registered attribute
				// type), but our namespace-context rule's resolver-driven path
				// would skip OOS sources. End-state: pragma is rewritten by
				// the title handler, so the test confirms no regression.
				var wiki = setupScoped([
					{title: "inbox/today", text: "\\context knowledge/llm\nbody"},
					{title: "knowledge/llm", text: ""}
				]);
				wiki.relinkTiddler("knowledge/llm", "knowledge/ai");
				// flibbles' title relink still fires for the pragma's prefix
				// attribute regardless of source scope, as designed.
				expect(wiki.getTiddler("inbox/today").fields.text)
					.toBe("\\context knowledge/ai\nbody");
			});

		});

	});

});

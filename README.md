# namespace — namespace-aware link resolution

Make TiddlyWiki's `[[…]]` links resolve relative to the **source tiddler's own title prefix**, so long slash-path titles become tractable.

> **⚠ Experimental — stage 1 only.** This release implements walk-up
> resolution + unresolved styling. Planned later stages: `_latest` version
> selector, `\context` pragma override, named aliases, mount points, and
> backlink-index integration. Breaking changes before 1.0 are likely.

## The problem it solves

When titles encode hierarchy (`a/b/OWASP/ASVS/4.0.3/V3.3`), referencing them inside tiddlers is awkward — you end up spelling out the full path everywhere. This plugin lets you write `[[V3.3]]` from *any* tiddler under `a/b/OWASP/ASVS/4.0.3/…` and it resolves to the right target by walking up the source tiddler's own title prefix.

## Resolution order

For a link `[[REF]]` rendered inside a tiddler titled `a/b/c/X`:

1. **Literal** — `REF` as an exact tiddler title (handles `$:/…` and shadow tiddlers).
2. **Absolute** — if `REF` contains `/`, try it as a full title.
3. **Walk-up** — try `a/b/c/REF`, then `a/b/REF`, then `a/REF`, then `REF`. First hit wins.
4. **Unresolved** — rendered with wavy underline + ⚠ marker; the link still navigates to the literal `REF` so you can click to create it.

## Quick start

1. Install the plugin.
2. Put related tiddlers under a common prefix (e.g. `docs/v4/intro`, `docs/v4/api`).
3. Inside any of them, write `[[api]]` or `[[intro]]` — walks up to the right sibling.

No pragmas, no configuration — works immediately.

## How it works

The plugin replaces the core `prettylink` parser rule. Each `[[REF]]` becomes a `$link` whose `to` and `class` are filter expressions that call a custom `ns-resolve` filter operator at render time. Resolution uses the widget's `currentTiddler` as the source, so it stays correct under transclusion.

## Prerequisites

- TiddlyWiki 5.3.0+

## Known limitations (stage 1)

- Core TiddlyWiki's backlink index and the `relink` plugin only see the literal `[[REF]]` string. Backlinks from walk-up references are missing until a later stage adds an indexer.
- No `_latest` / version resolution yet.
- No `\context` override yet.
- No configuration UI yet.
- Transclusion `{{REF}}` is not yet namespace-aware — only `[[REF]]`.

## License

MIT — see LICENSE.md.

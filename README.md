# namespace — namespace-aware link resolution

Make TiddlyWiki's `[[…]]` links resolve relative to the **source tiddler's own title prefix**, so long slash-path titles become tractable.

## The problem it solves

When titles encode hierarchy (`a/b/OWASP/ASVS/4.0.3/V3.3`), referencing them inside tiddlers is awkward — you end up spelling out the full path everywhere. This plugin lets you write `[[V3.3]]` from *any* tiddler under `a/b/OWASP/ASVS/4.0.3/…` and it resolves to the right target by walking up the source tiddler's own title prefix.

## Explicit-first design

The plugin is **explicit-first**: advanced features are off by default and toggled individually in settings. The always-on core handles literal matches, `\context` pragma, `<$context>` widget, and mount points. Optional features (enabled via checkboxes):

| Flag | What it enables |
|------|-----------------|
| Walk-up | Path-based walk-up from source tiddler title |
| Implicit context | `context:` field fallback on tiddlers |
| Pseudo expansion | `_latest` and other `_foo` pseudo-segment modules |
| Aliases | Exact + pattern alias resolution |

## Resolution pipeline

For a link `[[REF]]` rendered inside a tiddler:

1. **Literal** — `REF` as an exact tiddler title.
2. **Alias rewrite** *(optional)* — exact + pattern alias resolution.
3. **Mount rewrite** — prefix mapping via `$:/tags/NamespaceMount`.
4. **Pseudo expansion** *(optional)* — `_latest` and pluggable `_foo` segments.
5. **Literal on expanded** — catches aliased/mounted/pseudo-expanded forms.
6. **Absolute** — if REF contains `/`, try it as a full title only.
7. **Context prefix** — `\context` pragma or `<$context>` widget scope.
8. **Walk-up** *(optional)* — climb source title segments.
9. **Unresolved** — wavy underline + warning marker; link still navigable.

## Quick start

1. Install the plugin.
2. Add `\context my/prefix` at the top of a tiddler.
3. Write `[[sibling]]` — resolves to `my/prefix/sibling`.

For walk-up resolution without explicit context, enable the **Walk-up** flag in plugin settings.

## Prerequisites

- TiddlyWiki 5.3.0+

## License

MIT — see LICENSE.md.

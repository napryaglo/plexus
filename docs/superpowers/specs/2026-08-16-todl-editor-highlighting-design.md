# TODL Editor Syntax Highlighting — Design

**Date:** 2026-08-16
**Status:** Approved (design), ready for planning
**Repo:** Plexus (renderer / Monaco editor). No TODL changes.

## Problem

In the Plexus code editor, TODL source is under-highlighted:

- **Keywords aren't blue.** The Monaco Monarch grammar for `todl`
  ([todl-language.ts](../../../src/renderer/src/modules/meta-model/todl-language.ts))
  carries the **stale pre-cutover kebab vocabulary** (`meta-model`,
  `root-concept`, `top-level-concepts`, `connector`, `enum`, `implies`,
  `none`, `this`). It is missing every current keyword — `taxonomy`,
  `viewpoint`, `operator`, `annotation`, `annotate`, `import`, `uses`,
  `conforms`, `extends`, `represents`, `frames`, `instanceof`, … — so
  those render as plain identifiers.
- **Operator glyphs aren't highlighted.** The grammar only matches `->`
  and `==` and colors them as `operator` (not blue). The author-defined
  operator glyphs introduced in todl 0.28.0/0.29.0 — `-->`, `==>`, `~>`,
  `->>` — are runs of edge characters the current rule does not cover.
- **Concept names aren't blue.** Concept names (`component`, `step`,
  `connector`, …) are meta-model-derived, so a static grammar cannot know
  them. They already flow from the LSP as **semantic tokens** of type
  `type`, but the editor theme is defined with `rules: []` and no
  `semanticTokenColors`, so they fall back to a muted default rather than
  the keyword blue.

Secondary requirement: when the user **adds a new concept to a referenced
meta-model at runtime**, the new concept name should start highlighting in
open documents without requiring the user to re-type in the file.

## Key insight — the pipeline already exists

The hard infrastructure is already in place and does not need to be built:

- Plexus embeds **Monaco**; the `todl` language is registered with a
  Monarch grammar + language configuration.
- The **TODL LSP already emits semantic tokens** (`semanticTokensProvider`
  with a legend: `type, class, enumMember, property, method, variable`),
  and the renderer already **requests and renders them** via
  `monaco.languages.registerDocumentSemanticTokensProvider`
  ([register-providers.ts](../../../src/renderer/src/modules/meta-model/todl-lsp/register-providers.ts)).
- The server **recomputes semantic tokens on every analyze against the
  live resolved bases**. Bases are resolved on the renderer by
  `WorkspaceBaseResolver` and pushed to the server via `todl/setBases`;
  `RefreshDependents` re-validates dependent projects on base publish.

So concept-name coloring and its runtime-update behavior are properties of
the **existing semantic-token layer** — we recolor and nudge it, we do not
replace it. We explicitly do **not** inject dynamic concept names into the
Monarch keyword list (that would fight the semantic layer and require
re-registering the grammar on every base change).

## Design

Coloring splits by whether the token set is fixed or meta-model-derived.
Per the approved visual decision, **all three classes render in the same
keyword blue** (uniform, matching Monaco's keyword color).

### Layer 1 — Static grammar (Monarch), renderer-only

File: [todl-language.ts](../../../src/renderer/src/modules/meta-model/todl-language.ts)

1. **Replace the keyword list** with the current TODL keyword set:

   ```
   namespace, import, package, primitive, concept, taxonomy, viewpoint,
   annotation, annotate, model, operator, relationship, invariant, term,
   class, internal, sealed, extends, represents, frames, uses, conforms,
   instanceof, authoring, true, false
   ```

   These match `@keywords` in the tokenizer → `keyword` token → blue.

2. **Add an operator-glyph rule.** A maximal run of edge characters
   `[-~=><!]+` is colored as `keyword` (blue). This covers `->`, `-->`,
   `==>`, `~>`, `->>`, and any future author-defined glyph, because they
   are all lexically runs of those characters — no knowledge of the
   declared operator set is required. Ordering: this rule must run so that
   a lone `=` (assignment), `:`, `;`, `,` remain neutral delimiters and
   only multi-character or edge-directional runs read as operators. A lone
   `=` stays assignment; a run containing `>`/`<`/`~`/`!` or two+ edge
   chars is an operator glyph.

3. **Housekeeping.** Identifiers are C-like now
   (`[A-Za-z_]\w*`, drop the kebab `[\w-]*`). Remove the dead `&`-sigil
   `variable` rule — the reference sigil was removed in the type-directed
   references change. Keep comment / string / raw-string states as-is.

This layer is synchronous, needs no LSP, and covers keywords + operators.

### Layer 2 — Dynamic concept names (semantic tokens), theme-only

File: [code-editor.ts](../../../src/renderer/src/modules/code-editor/code-editor.ts)
(`defineTheme`, currently `rules: []`)

1. Set `semanticHighlighting: true` on the theme data so Monaco applies
   the semantic-token overlay.
2. Add theme rules mapping the concept-name-bearing semantic token types to
   the keyword blue:
   - `type` → blue (covers `Extends`, `FieldType`, `RelationshipTarget`,
     `InstanceConcept`, `InstanceOf`, `Represents`, `AnnotationName` — all
     concept references per the server's `ROLE_TYPE` map).
   - `class` → blue (imported namespace references).

   Other semantic types (`property`, `method`, `enumMember`, `variable`)
   are left at their inherited defaults; only concept-bearing types go
   blue. The blue must equal the Monarch keyword blue so keywords,
   operators, and concept names are visually identical; it is derived per
   light/dark base to match Monaco's own keyword color.

### The runtime-update wire (secondary requirement)

Concept names already recompute server-side on every analyze, so they
update on document edits. But Monaco **caches** semantic tokens and only
re-requests them on a **content** change. If a referenced meta-model gains
a concept while an open file's own text is untouched, the new concept would
not recolor until the next keystroke.

Fix: the `DocumentSemanticTokensProvider` interface exposes an optional
`onDidChange` event; firing it invalidates Monaco's cache and forces a
re-fetch. Wire an emitter into the provider registration and **fire it when
the language client applies new bases / re-validates** — i.e. on the
`todl/setBases` + `RefreshDependents` path (and on server restart /
reinitialize, which already re-syncs). This makes open documents re-fetch
semantic tokens the instant the meta-model's concept set changes, so a
newly added concept lights up live.

This is the only genuinely new behavior; it is small and localized to the
renderer LSP-provider wiring.

## Scope and deferrals

- **No TODL changes.** Operators are covered by Monarch; no republish.
- **Deferred:** classifying operator glyphs as *semantic* tokens in TODL
  (would require a `SymbolKind.Operator`, handling `DeclKind.Operator` in
  the definition index, and a new legend entry). Only needed for operator
  **hover / go-to-definition**, not for highlighting. Out of scope here.
- **No new theme colors surfaced to the user / no settings UI.** The blue
  matches Monaco's existing keyword color.

## Testing (vitest)

- **Grammar:** tokenize representative TODL snippets through the registered
  Monarch tokenizer and assert:
  - each current keyword yields a `keyword` token;
  - a stale kebab word (e.g. `root-concept`) does **not**;
  - operator glyphs `->`, `-->`, `==>`, `~>`, `->>` each yield a `keyword`
    token;
  - a lone `=` in `label = "x"` is **not** a keyword/operator run;
  - a C-like identifier (`agent_orchestrator`) is `identifier`.
- **Theme:** assert the defined theme data carries
  `semanticHighlighting: true` and a rule coloring `type` (and `class`) to
  the expected blue, for both light and dark bases.
- **Runtime refresh:** assert that applying new bases / the re-validate
  path fires the semantic-tokens provider's `onDidChange` (so open
  documents re-fetch). Unit-test the emitter wiring, not Monaco's internal
  re-render.

## Files touched

| File | Change |
|------|--------|
| `src/renderer/src/modules/meta-model/todl-language.ts` | Rewrite keyword list; add operator-glyph rule; C-like identifiers; drop `&` sigil |
| `src/renderer/src/modules/code-editor/code-editor.ts` | `defineTheme`: `semanticHighlighting: true` + `type`/`class` → blue rules |
| `src/renderer/src/modules/meta-model/todl-lsp/register-providers.ts` | Semantic-tokens provider `onDidChange` emitter |
| `src/renderer/src/services/todl/todl-language-client.ts` (or the base-refresh caller) | Fire the emitter on base apply / re-validate / reinitialize |
| `tests/` next to each above | vitest coverage per the Testing section |

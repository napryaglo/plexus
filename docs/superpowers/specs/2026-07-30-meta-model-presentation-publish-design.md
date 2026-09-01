# Meta-model Presentation Publish (Sub-project A) — Design

**Date:** 2026-07-30
**Status:** ✅ Finished
**Repo:** Plexus
**Umbrella:** "Double-click a tree entity → flyout renders it with its presentation template." Decomposed into A (publish presentation to the backend), B (runtime loader + `MetaModelEntity`), C (double-click → flyout → render). This spec is **A only**; B and C get their own spec → plan → build cycles.

## Goal

Make a published meta-model carry a self-contained **presentation payload** in the meta-models backend, so a consumer (sub-project B) can `instantiate()` its `mm:<id>` entity templates at runtime — no build step, no pre-compiled JS.

## Background

Sub-project 1 already generates a presentation dictionary source into the *project*:
`MetaModelProjectFactory.publish` calls `writePresentation(storage, doc)`, which runs
`generatePresentationMu(doc, authorDicts)` ([presentation-generator.ts](../../../src/renderer/src/modules/meta-model/services/presentation-generator.ts))
and writes `presentation.generated.mu` to the project root. Author dictionaries live
in the project's `presentation/` folder; the generated source `merge`s them by name.

Today `publish` writes only `model.json` + `src/` into the backend
(`<id>/<modelVersion>/`) — the presentation stays in the project and never reaches
a consumer. This sub-project closes that gap.

### Why ship source (not compiled JS)

mural's compiler exposes `instantiate(source, ctx, { include, glyphs, symbols })`
([compiler/compile.d.ts](../../../node_modules/@pragmatic-tech-ai/mural/dist/compiler/compile.d.ts)):
it compiles a `.mu` source and builds the objects in-process via `new Function`, with
`ctx` supplying imported symbols and `include` a resolver for `include "…svg"`. It uses
no `node:fs` and no dynamic `import`, and Plexus sets **no CSP** (verified: no meta tag,
no main-process header), so `new Function` is allowed in the renderer. B will therefore
instantiate the presentation live from source. Pre-compiling to a JS module would instead
require evaluating an ES module with bare `import`s at runtime — strictly harder — so A
ships **source + assets**, not JS.

## Global Constraints

- All backend writes flow through `IStorage` (rooted, project-relative paths) — no
  absolute paths, no raw filesystem. Testable with `FakeStorage`.
- Enums over string-literal unions; tests in a `tests/` subfolder (both per CLAUDE.md).
- Do not regress the existing publish contract (`model.json` + `src/` still written; the
  project's own `presentation.generated.mu` still written by `writePresentation`).

## Backend Layout (the contract B relies on)

Published under the existing base `<id>/<modelVersion>/`:

```
<id>/<modelVersion>/
  model.json                                  (existing)
  src/<uri>                                    (existing)
  presentation/
    presentation.generated.mu                 the generated dictionary source
    overrides/<…project presentation/ tree…>   author dictionaries + their assets, verbatim
    <iconPath>                                 each distinctIcons(doc) SVG, path preserved
```

Convention-based (no manifest): B reads `presentation/presentation.generated.mu`,
resolves `include "<iconPath>"` against the `presentation/` folder (so a project icon at
`<iconPath>` lands at `presentation/<iconPath>`), and finds author dictionaries by scanning
`presentation/overrides/**.mu` for their `resources <Name>` blocks.

## Component — `MetaModelProjectFactory.publish` extension

**File:** [meta-model-project-factory.ts](../../../src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts) (modify)
**Test:** `.../services/tests/meta-model-project-factory.test.ts` (extend)

### New constant

`PRESENTATION_BACKEND_DIR = 'presentation'` and `PRESENTATION_OVERRIDES_DIR = 'overrides'`
(scoped to the factory), joined under the publish `base`.

### `publish` change

After the existing `model.json` + `src/` writes and the project-side `writePresentation`,
call a new `publishPresentation(project storage, dest, base, doc)`:

1. **Generated source.** `authorDicts = scanAuthorDicts(storage)`;
   `source = generatePresentationMu(doc, authorDicts)` (the same call `writePresentation`
   makes — identical bytes); `dest.WriteText(\`${base}/presentation/presentation.generated.mu\`, source)`.
2. **Overrides.** If the project has a `presentation/` folder, recursively copy its entire
   tree into `${base}/presentation/overrides/` (verbatim — `.mu` sources and any assets the
   overrides reference). Missing folder → skip.
3. **Icons.** For each `iconPath` in `distinctIcons(doc)`, read the SVG from the project at
   `iconPath` and write it to `${base}/presentation/${iconPath}`. A `distinctIcons` entry
   whose file is missing in the project is skipped (not fatal — the model published; a
   missing asset is an authoring gap B degrades over, and A reports the count in the publish
   message).

The publish result message gains a suffix: `… (presentation: N template(s), M icon(s))`
so the author sees the presentation shipped.

### Recursive storage copy

A small private helper `copyTree(from: IStorage, srcDir, to: IStorage, destDir)`:
`List(srcDir)`; for each entry, recurse into directories, and copy files with
`to.WriteText(destPath, await from.ReadText(srcPath))`. Text copy is sufficient — presentation
assets are `.mu` and `.svg` (both UTF-8). Reused for the overrides copy; icons are copied
individually (they sit outside `presentation/`).

### Behavior when there is nothing to present

`distinctIcons` empty and no `presentation/` folder → only
`presentation/presentation.generated.mu` is written (it still holds the `mm:<id>` templates).
A model with zero ontology entities still writes a (near-empty) generated source — harmless.

## Testing Strategy

Drive a full `publish` over `FakeStorage` seeded as a meta-model project (manifest + a
`.todl` that compiles to concepts with an `icon` attr + a matching SVG file + optionally a
`presentation/custom.mu` override), then assert the **backend** contents:

- `presentation/presentation.generated.mu` exists and contains a `DataTemplate x:key="mm:<id>"`
  for each ontology entity (reuse the known-clean sources from the existing factory test).
- Each declared icon SVG is copied to `presentation/<iconPath>` (byte-equal to the project's).
- An author override at project `presentation/custom.mu` is copied to
  `presentation/overrides/custom.mu`.
- Existing assertions still hold: `model.json` and `src/<uri>` are written; the project's own
  `presentation.generated.mu` is still written.
- A publish whose model declares an icon with **no** SVG file still succeeds (model.json
  present), and the missing icon is simply absent from the backend.

No renderer, no `instantiate` — that is B's territory. A is a pure storage-layout unit.

## Out of Scope (deferred to B / C)

- Reading/instantiating the presentation at runtime; the `MetaModelEntity` data object;
  the include-resolver over backend SVGs; `merge` wiring (all B).
- Double-click, the `SideSheet` flyout, threading entity identity into the tree (all C).
- Glyph-font (`include`-via-`glyphs`) assets — the generator emits only SVG `include`s today.

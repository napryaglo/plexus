# Library Resource Bundle & Loading — Design

**Status:** Phase 1 designed for implementation; Phases 2–3 sketched.
**Date:** 2026-07-25

## Problem

A Plexus **library** project (a technology taxonomy authored against a
meta-model) today publishes only its *semantic* layer — the compiled TODL
`model.json` plus the raw `.todl` sources — into the libraries backend at
`<userData>/libraries/<id>/<libVersion>/`. A consuming **architecture** project
resolves those bases purely for TODL type-checking (`resolveBases` →
`checkAgainst`). There is no *visual* layer: nothing tells a diagram how to draw
an element typed by a library concept.

The goal is the full round-trip: a library publishes its concepts **and** how
they look and are documented; Plexus loads a bound library, mounts its visuals,
and lets a user drag a concept from a palette onto a diagram, rendered through
the library's template.

This spec captures the end-to-end architecture and details **Phase 1** — making
publish emit a complete resource bundle + manifest — which is self-contained and
the foundation everything downstream reads.

## Current state (grounding)

- **Tier chain (semantic, exists).** meta-model → library → architecture. Each
  publishable base writes `<id>/<version>/{model.json, src/*.todl}`;
  `base-resolver.ts` reads `model.json` as a `TodlDocument` and TODL
  `checkAgainst` validates a consumer against its bases.
- **Compiled model shape.** `toJSON(model)` → `TodlDocument = { nodes, edges }`.
  Each `JsonNode` has `{ id, tier, typeOf, attrs }`, where `tier` is the `Tier`
  enum **member name** (`toJSON` emits enums by name): `"Meta"`, `"Ontology"`,
  `"Instance"`. **Empirically verified** against the sample taxonomy: the terms an
  author declares (e.g. `azure`, `azure-openai`) compile to **`Instance`-tier
  nodes carrying `attrs.class === true`** — clabjects, each simultaneously an
  instance of a meta concept and a *class* available for further instantiation.
  Their `id` is the qualified name (`microsoft.azure`), `attrs.id` the local name
  (`azure`), `attrs.label` the display label, and `typeOf` the meta-model concept
  they realise (`location`). The `Ontology` tier holds the concept / field /
  taxonomy *definitions*, not the instantiable terms. So a library's **provided
  classes** = `nodes.filter(n => n.tier === "Instance" && n.attrs.class === true)`
  — derivable from `model.json` with no extra parsing. (These classes are the
  palette items a consumer drags; the visual/doc/thumbnail resources key to them.)
- **Source collection.** `collectTodlSources(storage)`
  ([todl-sources.ts](../../src/renderer/src/modules/meta-model/services/todl-sources.ts))
  recurses the whole project and returns every `.todl`. Any new `samples/`
  folder of example `.todl` would be swept into the taxonomy compile unless
  explicitly excluded.
- **Diagram is independent of TODL (relevant to Phase 3).** A `.diagram`
  document holds nodes keyed by a `kind` string that indexes a builtin
  `SHAPE_CATALOG` for geometry; nodes are purely visual (no concept, no
  ModelElement). `DiagramDocument` / `Figure` live in the **Mural** package.
  The toolbox drags a `kind`; drop calls `DiagramDocument.CreateNode(kind,x,y)`.

## End-to-end architecture (sketch)

```
AUTHOR (library project)          PUBLISH →   LIBRARIES BACKEND  <id>/<ver>/
  src/*.todl        taxonomy                    model.json      compiled TODL   [exists]
  visuals/*.mural   per-concept templates        library.json    manifest        [Phase 1]
  assets/*          icons/images                  src/*.todl                      [exists]
  docs/*.md                                       visuals/*  assets/*             [Phase 1]
  samples/*.todl                                  docs/*  samples/*  thumbnails/* [Phase 1]
  thumbnails/*.png  (author-supplied)

LOAD (architecture project opens)                                              [Phase 2]
  resolveBases  ── semantic validation ──────────────────────────  [exists]
  LibraryRegistry.mount(each bound lib):
      read library.json → register provided concepts
      mount visuals into a concept→template resolver
        (default visual library always installed; lib/view templates override)
      index assets · docs · thumbnails

WORK WITH IT (canvas)                                                          [Phase 3]
  Palette  = loaded concepts (thumbnail + doc)  ◄─ LibraryRegistry
  drag concept → drop → concept-typed node:
      ModelElement   concept ref + props   (north star: round-trips to .todl)
      VisualElement  rendered via concept→template resolver (falls back to default lib)
```

### Phasing

- **Phase 1 — Publish the resource bundle + `library.json` manifest.** No
  diagram/Mural changes. Defines the contract every consumer reads. **This spec.**
- **Phase 2 — `LibraryRegistry`:** discover + read bundles into a
  concept/visual/metadata registry (default-lib + override precedence).
  Testable headless. Separate spec.
- **Phase 3 — Concept-aware diagram nodes + palette + drag-create +
  render-through-template.** The deep integration; touches Mural; hosts the
  `.todl` round-trip question. Separate spec.

Deferred decisions (revisited in their phase): **thumbnail auto-generation**
(needs the renderer) and **whether Phase 3 extends the generic diagram or
introduces a concept-aware "architecture canvas" document type**.

---

## Phase 1 — detailed design

### Project layout (authoring conventions)

Reserved top-level folders inside a library project:

| Folder        | Holds                                   | Binding to a class              |
|---------------|-----------------------------------------|---------------------------------|
| `visuals/`    | `.mural` templates                      | `visuals/<classId>.mural`       |
| `assets/`     | icons/images referenced by templates    | none (shared)                   |
| `docs/`       | markdown; optional `README.md`          | `docs/<classId>.md`             |
| `samples/`    | `.todl` example instances               | none — **excluded** from compile|
| `thumbnails/` | preview images, author-supplied         | `thumbnails/<classId>.png`      |

Taxonomy `.todl` lives anywhere **except `samples/`**. Resources bind to a
library **class** by **filename convention** (stem = the class's qualified id),
so Phase 1 never parses `.mural`. `<classId>` is the class node id as emitted in
`model.json` — the qualified name, e.g. `microsoft.azure` (dots are fine —
extension detection uses the *last* `.`, so `visuals/microsoft.azure.mural` has
extension `.mural` and stem `microsoft.azure`).

### Manifest — `library.json`

Written into the bundle root alongside `model.json`. Shape:

```ts
interface PublishedClass {
    id:         string     // qualified class NodeId, e.g. "microsoft.azure"
    localId?:   string     // attrs.id, the short name, e.g. "azure"
    label?:     string     // attrs.label, if present, e.g. "Azure"
    concept:    string     // node.typeOf — the meta-model concept it realises, e.g. "location"
    template?:  string     // "visuals/<id>.mural"    — present only if the file exists
    thumbnail?: string     // "thumbnails/<id>.png"   — present only if the file exists
    doc?:       string     // "docs/<id>.md"          — present only if the file exists
}

interface LibraryBundleManifest {
    id:          string
    version:     string                 // libVersion
    name:        string                 // display name (manifest.name)
    description?: string                // optional, if the project manifest carries one
    metaModel:   { id: string; version: string }   // the BaseRef this library targets
    classes:     PublishedClass[]       // the instantiable classes (palette items)
    assets:      string[]               // every file under assets/ (bundle-relative)
    docs:        string[]               // every file under docs/  (incl README)
    samples:     string[]               // every file under samples/
}
```

The loader (Phase 2) reads `classes[]` for the palette + render resolver,
`assets[]` to resolve image references, and `docs[]` / `samples[]` for browsing.

### Publish flow

Extends `LibraryProjectFactory.publish`
([library-project-factory.ts](../../src/renderer/src/modules/library/services/library-project-factory.ts)).
Steps 1–4 below already exist; 5–8 are new. Only TODL errors block; resource
problems are non-blocking warnings.

1. Read manifest; require `metaModel` binding (exists).
2. `resolveBases(provider, { metaModel })`; block on problems (exists).
3. Collect taxonomy sources **excluding `samples/`** — a new exclude-aware
   collector (see below) — so samples never enter `model.json`.
4. `checkAgainst(bases, sources)`; block if any `Severity.Error` (exists).
5. Derive `classes` from the compiled model:
   `model.nodes.filter(n => n.tier === "Instance" && n.attrs.class === true)` →
   `{ id: n.id, localId: n.attrs.id, label: n.attrs.label, concept: n.typeOf }`.
   (`JsonNode.tier` is the enum **member name string** — `toJSON` emits enums by
   name — so the comparison is the literal `"Instance"`; `attrs.class` is a
   boolean scalar.)
6. Scan the resource folders; for each class attach `template`/`thumbnail`/`doc`
   when the conventionally-named file (stem = class id) exists; gather `assets` /
   `docs` / `samples` lists. **Validate:** any `visuals/*` or `thumbnails/*` whose
   stem is not a provided class id is an **orphan** → collect a warning (does not
   block).
7. Assemble `LibraryBundleManifest`.
8. Write the bundle under `<id>/<libVersion>/`:
   - `model.json` + `src/*.todl` (existing behavior),
   - `library.json` (the manifest),
   - copy through `visuals/`, `assets/`, `docs/`, `samples/`, `thumbnails/`:
     **text** copy (ReadText/WriteText) for `.mural` / `.md` / `.todl`, **bytes**
     copy (ReadBytes/WriteBytes) for everything else (images).
   Return `PublishResult` summarizing counts (files, classes, resources) and any
   orphan warnings in `message`.

### New/changed units

- **`todl-sources.ts`** — add `collectTaxonomySources(storage, excludeDirs)` that
  skips a set of top-level folders (default `['samples']`); the existing
  `collectTodlSources` stays as the unfiltered walk it is today.
- **`library-bundle.ts`** (new, in the library module) — the manifest types plus
  pure helpers: `deriveClasses(model: TodlDocument): PublishedClass[]` and
  `scanResources(storage, classIds): { byClass, assets, docs, samples, warnings }`
  where `byClass` maps a class id → `{ template?, thumbnail?, doc? }`. Pure
  functions of their inputs → unit-testable with `FakeStorage`.
- **`library-project-factory.ts`** — `publish` calls the helpers, assembles
  `library.json`, and copies the resource folders.

### Testing

Unit tests (Vitest + `FakeStorage` + the existing `publishEnv` pattern that
pre-registers meta-models + libraries backends; the sample `microsoft` taxonomy
compiles to classes `microsoft.azure` and `microsoft.azure-openai`):

- `deriveClasses` returns only `Instance`-tier `class===true` nodes — the two
  `microsoft.*` ids with `localId`/`label`/`concept` — not the `Ontology`-tier
  concept/field/taxonomy definition nodes.
- `collectTaxonomySources` excludes `samples/` (a `samples/x.todl` is not returned).
- Publish writes `library.json` with the right `classes[]` and per-class
  `template`/`thumbnail`/`doc` paths (present only when the file exists).
- Publish copies `visuals/ assets/ docs/ samples/ thumbnails/` into the bundle
  (assert the destination `FakeStorage` has the files; images round-trip as bytes).
- `samples/*.todl` is **not** compiled into `model.json`.
- An orphan `visuals/<unknown>.mural` produces a warning (publish still succeeds).

### Out of scope (Phase 1)

- Parsing `.mural` to read an in-file class target (filename convention instead).
- Thumbnail auto-generation (author-supplied only).
- Any loading / mounting / rendering / palette (Phases 2–3).
- Diagram or Mural changes.
```

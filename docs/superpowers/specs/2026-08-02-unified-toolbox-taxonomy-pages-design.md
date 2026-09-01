# Unified Toolbox with Taxonomy Pages — Design

**Status:** ✅ Finished
**Date:** 2026-08-02
**Scope:** Plexus (renderer). No TODL change — the `toolbox` annotation is
author-declared and taxonomy-level annotations already ship in
`@pragmatic-tech-ai/todl@0.7.0`.

## Goal

Replace the two parallel palette services with a single **`ToolboxService`** —
the primary tool for working with visual architecture content. It presents
draggable content as **pages**: one built-in *Shapes* page (the generic diagram
shapes we have today) plus one page per **taxonomy** that authors mark visible,
aggregated across **every published meta-model and library**. A term marked
hidden is dropped from its page.

Authoring contract (in a meta-model or library's `.todl`):

```todl
annotation toolbox { visible : boolean; }

taxonomy actors : represents actor {
    annotate toolbox { visible = true; }          // → this taxonomy becomes a page
    term internal { annotate toolbox { visible = false; } }   // → hidden from the page
}
```

- A taxonomy appears **only if** it carries `toolbox { visible = true }`.
- A term is shown **unless** it carries `toolbox { visible = false }`.

## Background — what exists today (two parallel palettes)

|                | `ToolBoxService` (diagram module)         | `ArchTermsPaletteService` (arch module)          |
| -------------- | ------------------------------------------ | ------------------------------------------------ |
| Canvas         | `.diagram` (generic)                       | `.archdiagram` (architecture)                    |
| Content        | mural framework `ToolboxShape`s            | published **library class** `TermTile`s          |
| Placement      | **global** left-rail Capability "Tool Box" | **document-embedded** (`ArchDiagramDocument.Palette`) |
| Drop result    | materialize a shape                        | create a concept **instance** referencing the term |
| UI             | flat WrapPanel of shape tiles              | flat StackPanel of term tiles (all libs flat)    |

Both tile kinds emit the same `TOOLBOX_NODE_KIND_FORMAT` drag payload; each
canvas auto-wires `DropReceiver = $Self` → `Document.CreateNode(kind, x, y)`.

Confirmed enablers:
- Both **meta-models and libraries ship `model.json`** (a `TodlDocument`) at
  `<id>/<version>/model.json` — [library-project-factory.ts:123](../../../src/renderer/src/modules/library/services/library-project-factory.ts#L123),
  meta-models under `<userData>/meta-models`.
- `model.json` carries taxonomies (`typeOf: 'taxonomy'`), their terms
  (Instance-tier `class` nodes reached by `Contains` edges), and annotations
  (`Annotated` edges to `<node>@<name>` application nodes).
- [`projectAnnotations(doc, id)`](../../../src/renderer/src/modules/meta-model/services/annotation-projection.ts#L12-L30)
  already returns `{ toolbox: { visible: … }, icon: { path: … }, … }` for any node.
- [`resolveFacets(node, annotations)`](../../../src/renderer/src/modules/meta-model/services/presentation-generator.ts#L141-L156)
  resolves a node's `{ icon, label }`.

## Decisions (from review)

- **D-naming.** Annotation is lowercase `toolbox`, param `visible : boolean`
  (matches `icon`/`label`).
- **D-shapes.** Generic diagram shapes are folded in as **one built-in page**
  ("Shapes"). The `.diagram` editor stays as-is otherwise.
- **D-scope.** Sourcing is **global**: pages come from every published
  meta-model and library, independent of the active document.
- **D-ui.** Pages render as **tabs/accordion** in one panel.
- **D-merge.** `ArchTermsPaletteService` is **removed**; the unified service is
  the surviving rail Capability.

## Architecture

### 1. `toolbox-projection.ts` (pure, new)

Given one loaded `TodlDocument`, return the visible taxonomies and their visible
terms — no I/O, no mural import.

```ts
export interface ToolboxTermRef { id: string; label: string; icon?: string; concept: string }
export interface ToolboxTaxonomy { id: string; label: string; terms: ToolboxTermRef[] }

// Visible taxonomies (annotate toolbox { visible = true }) with their terms,
// each term dropped when it carries toolbox { visible = false }. Model order.
export function projectToolbox(doc: TodlDocument): ToolboxTaxonomy[]
```

Algorithm: for each `typeOf === 'taxonomy'` node whose
`projectAnnotations(doc, id).toolbox?.visible === true`, collect its terms
(Instance-tier `class` nodes reached transitively by `Contains`, nested terms
included), excluding any term whose `.toolbox?.visible === false`. Label/icon via
`resolveFacets`. `concept` from the term node's `instanceOf`/concept.

### 2. Page + tile model

```ts
export enum ToolboxPageKind { Shapes = 'shapes', Taxonomy = 'taxonomy' }

export class ToolboxPage {           // one tab/accordion section
    Title: string
    Kind:  ToolboxPageKind
    Items: ObservableCollection<ToolboxTile>   // ToolboxShape | TermTile
}
```

`ToolboxShape` (existing, framework) and `TermTile` (existing, arch module —
moves into the toolbox) are the two tile kinds. Both already carry
`BeginKindDragData()` emitting `TOOLBOX_NODE_KIND_FORMAT`, so the drag path is
untouched.

### 3. `ToolboxService` (unified, global rail Capability)

Replaces both services. Holds `Pages: ObservableCollection<ToolboxPage>`.

`reload()` (on ctor + `IActivatable.OnActivated`, and after publish — see
Refresh) rebuilds `Pages`:

1. **Shapes page** — from the framework's built-in shapes (today's
   `ToolBoxService.Shapes` source).
2. **Taxonomy pages** — enumerate every published source:
   - meta-models: `ensureMetaModelsBackend` → list `<id>/<version>` → read each
     `model.json`.
   - libraries: `discoverLibraries` / `LibraryRegistry` → read each `model.json`.
   For each doc, `projectToolbox(doc)`; for each taxonomy build a page whose
   items are its visible terms as `TermTile`s. **Dedupe** taxonomies by
   qualified id (a library that re-exports its meta-model's ontology must not
   double a page); merge terms by id.

Tiles need a drag preview visual. **Term-tile template resolution order**
(D-tile): the class's compiled **library template** (`LibraryRegistry`) if the
term is a published library class → else the source meta-model's **presentation
template** `mm:<id>` if available → else a text-only tile.

### 4. UI — `DataTemplate [DataType = ToolboxService]`

A `TabControl` (or accordion) over `Pages`; each page renders `Items` in a
`WrapPanel`. The Shapes page uses the existing shape-tile template; taxonomy
pages use the existing term-tile template. Both tiles keep
`OnDragStart = $BeginKindDragData`.

### 5. Wiring changes

- **diagram module:** rename `ToolBoxService` → `ToolboxService`; keep the
  "Tool Box" Capability pointing at it; `DataTemplate` → the pages template
  above (shape-tile template becomes the Shapes-page item template).
- **architecture-repository module:** delete `ArchTermsPaletteService` (+ its
  tests + `.mu` templates); remove `ArchDiagramDocument.Palette` and its
  instantiation in the factory; the arch-canvas template drops its embedded
  left palette rail (the global rail now provides it) while keeping
  `DropReceiver = $Self`. `TermTile` moves into the toolbox’s files.
- **shared:** reuse the `TOOLBOX_NODE_KIND_FORMAT` constant.

### 6. Drop-scope interaction (global toolbox vs document bindings)

Because the toolbox is global, it can surface a term whose concept isn't in the
active document's bindings. **Default (D-drop):** the arch canvas's `CreateNode`
runs `resolveTermDrop` against the document's model as today; if the term's
concept/reference isn't resolvable, it is a **graceful no-op plus a transient
diagnostic** ("*term X isn't in scope for this document — add its
library/meta-model binding*"). Auto-adding the binding is out of scope (future).
Shape tiles are meaningful only on the diagram canvas and term tiles only on the
arch canvas; a cross-drop is a no-op.

## Data flow

```
published model.json (meta-models + libraries)
        │  read on reload()
        ▼
projectToolbox(doc)  ──►  ToolboxTaxonomy[]  ──►  dedupe/merge
        │
        ▼
ToolboxService.Pages = [ Shapes, …taxonomy pages ]
        │  bound
        ▼
TabControl (tabs)  →  WrapPanel of tiles  →  drag (node-kind format)
        │
        ▼
canvas DropReceiver → Document.CreateNode(kind, x, y)
   arch: applyTermDrop → concept instance   |   diagram: materialize shape
```

## Testing strategy

- **`toolbox-projection` (unit):** visible taxonomy → page; taxonomy without
  `toolbox` annotation excluded; `visible = false` term excluded; nested terms
  included; icon/label resolved; a doc with no taxonomies → `[]`.
- **`ToolboxService` (unit, FakeStorage-seeded meta-models + libraries):** Pages
  = Shapes + expected taxonomy pages; dedupe across a meta-model and a library
  that repeats it; reload picks up a newly-seeded source; empty backends → just
  the Shapes page.
- **Tile drag payload:** `TermTile.BeginKindDragData()` emits the node-kind
  format with the term id (regression, moved from arch tests).
- **Wiring:** the "Tool Box" Capability resolves `ToolboxService`; arch canvas
  still drops to `CreateNode`.
- Remove `arch-terms-palette-service.test.ts`; migrate its still-relevant
  assertions.

## Out of scope

- Auto-adding a binding on an out-of-scope drop.
- Filtering pages to the active document's bindings (global was chosen).
- Changing the `.diagram` editor beyond repointing its palette.
- A `toolbox` `order` param for page ordering (order taxonomy pages by label;
  Shapes first). Add later if wanted.

## Open questions for review

1. **Term source for a meta-model taxonomy with no library.** A meta-model's
   taxonomy terms are type-level; the draggable, instantiable items on the arch
   canvas are library classes. Should a taxonomy page that has *no* published
   library classes still show its meta-model terms (draggable, resolved via the
   presentation template), or only appear once a library contributes classes?
   Default in this draft: **show meta-model terms too**, resolved via `mm:<id>`.
2. **Page ordering.** Shapes first, then taxonomies alphabetically by label —
   acceptable, or do you want an explicit `order`?

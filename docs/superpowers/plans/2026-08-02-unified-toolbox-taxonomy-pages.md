# Unified Toolbox with Taxonomy Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two parallel palette services (`ToolBoxService` diagram shapes, `ArchTermsPaletteService` library terms) with one global `ToolboxService` that shows a built-in *Shapes* page plus one page per `toolbox`-visible taxonomy, aggregated across every published meta-model and library.

**Architecture:** A pure `projectToolbox(doc)` reads a `model.json` into visible taxonomies + their visible terms. `ToolboxService` (the surviving "Tool Box" rail Capability) scans the meta-models and libraries backends, projects each `model.json`, dedupes, and exposes `Pages: ObservableCollection<ToolboxPage>` (Shapes first, then taxonomy pages). A `TabControl`-based `DataTemplate` renders pages of draggable tiles; drag-drop is unchanged. `ArchTermsPaletteService` and `ArchDiagramDocument.Palette` are removed.

**Tech Stack:** TypeScript (strict, ESM), `@pragmatic-lab/mural` (runtime/basic/framework), `@pragmatic-lab/todl` types, Vitest + `FakeStorage`, mural `.mu` markup (compiled via `npm run compile:mu`).

## Global Constraints

- Every test file lives in a `tests/` subfolder next to its source (`src/**/*.test.ts`; Plexus CLAUDE.md).
- Use real TypeScript `enum`s, never string-literal unions (repo rule). New enum: `ToolboxPageKind`.
- No TODL change. The `toolbox` annotation is author-declared: `annotation toolbox { visible : boolean; }`. Taxonomy-level annotations already ship in `@pragmatic-lab/todl@0.7.0` (installed).
- Annotation contract: a taxonomy appears **only if** `toolbox { visible = true }`; a term is shown **unless** `toolbox { visible = false }`.
- Render through templates/bindings from `.mu` — no hardcoded chrome in code (repo rule).
- Both published meta-models and libraries live at `<id>/<version>/model.json` under their respective backends (`ensureMetaModelsBackend`, `ensureLibrariesBackend`); scan with `scanPublishedModels(storage)`.
- Drag payload stays `TOOLBOX_NODE_KIND_FORMAT` (framework). Do not change the drop pipeline contract.
- Run `npm run compile:mu`, `npm run typecheck`, and `npm test` (Vitest) — all green — before finishing.

---

## File Structure

- **Create** `src/renderer/src/modules/meta-model/services/toolbox-projection.ts` — pure `projectToolbox(doc)` + `ToolboxTaxonomy`/`ToolboxTermRef` types. Reuses `projectAnnotations` + `resolveFacets` + `termsOf`.
- **Create** `src/renderer/src/modules/diagram/services/toolbox-page.ts` — `ToolboxPageKind` enum, `ToolboxPage` model, and `TermTile` (moved here from the arch module).
- **Create** `src/renderer/src/modules/diagram/services/toolbox-term-template.ts` — `resolveTermTemplate(...)` (library → `mm:<id>` → text fallback).
- **Rewrite** `src/renderer/src/modules/diagram/services/diagram-panel-services.ts` — `ToolBoxService` → `ToolboxService` with `Pages` + `reload()`.
- **Edit** `src/renderer/src/modules/diagram/diagram.module.mu` — rename service + Capability wiring.
- **Edit** `src/renderer/src/modules/diagram/diagram.resources.mu` — `DataTemplate [DataType = ToolboxService]` renders `TabControl` over `Pages`; keep the shape-tile template; add the term-tile template.
- **Delete** `src/renderer/src/modules/architecture-repository/services/arch-terms-palette-service.ts` (+ its test).
- **Edit** `arch-diagram-document.ts` / `arch-diagram-document-factory.ts` — remove `Palette` property + instantiation.
- **Edit** `architecture-repository.resources.mu` — drop the embedded palette rail; keep the canvas `DropReceiver`.
- **Edit** `arch-canvas-ops.ts` / `arch-diagram-document.ts` (CreateNode path) — graceful no-op + diagnostic when a dropped term is out of the document's scope.

---

## Task 1: `projectToolbox` — pure model.json → visible taxonomies + terms

**Files:**
- Create: `src/renderer/src/modules/meta-model/services/toolbox-projection.ts`
- Test: `src/renderer/src/modules/meta-model/services/tests/toolbox-projection.test.ts`

**Interfaces:**
- Consumes: `projectAnnotations(doc, id)` ([annotation-projection.ts](../../../src/renderer/src/modules/meta-model/services/annotation-projection.ts)), `resolveFacets(node, annotations)` ([presentation-generator.ts](../../../src/renderer/src/modules/meta-model/services/presentation-generator.ts#L141-L156)), `termsOf(doc, taxonomyId)` ([meta-model-tree-builder.ts](../../../src/renderer/src/modules/meta-model/services/meta-model-tree-builder.ts#L12-L18)), `TodlDocument`/`JsonNode` from `@pragmatic-lab/todl`.
- Produces:
  ```ts
  export interface ToolboxTermRef { id: string; label: string; icon?: string; concept: string }
  export interface ToolboxTaxonomy { id: string; label: string; terms: ToolboxTermRef[] }
  export function projectToolbox(doc: TodlDocument): ToolboxTaxonomy[]
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-lab/todl'
import { projectToolbox } from '../toolbox-projection.js'

// A doc with: a visible taxonomy `actors` (2 terms, one hidden), and a taxonomy
// `plain` with no toolbox annotation (excluded). Annotations are Annotated edges
// to `<node>@toolbox` application nodes carrying the `visible` attr.
function doc(): TodlDocument {
  return {
    nodes: [
      { id: 'actors', tier: 'Ontology', typeOf: 'taxonomy', attrs: { label: 'Actors' } },
      { id: 'actors@toolbox', tier: 'Ontology', typeOf: 'toolbox', attrs: { visible: true } },
      { id: 'actors.internal', tier: 'Instance', typeOf: 'actor', attrs: { class: true, label: 'Internal' }, instanceOf: 'actor' },
      { id: 'actors.external', tier: 'Instance', typeOf: 'actor', attrs: { class: true, label: 'External' }, instanceOf: 'actor' },
      { id: 'actors.external@toolbox', tier: 'Instance', typeOf: 'toolbox', attrs: { visible: false } },
      { id: 'plain', tier: 'Ontology', typeOf: 'taxonomy', attrs: { label: 'Plain' } },
      { id: 'plain.x', tier: 'Instance', typeOf: 'actor', attrs: { class: true }, instanceOf: 'actor' },
    ],
    edges: [
      { kind: 'Annotated', via: null, from: 'actors', to: 'actors@toolbox' },
      { kind: 'Contains', via: null, from: 'actors', to: 'actors.internal' },
      { kind: 'Contains', via: null, from: 'actors', to: 'actors.external' },
      { kind: 'Annotated', via: null, from: 'actors.external', to: 'actors.external@toolbox' },
      { kind: 'Contains', via: null, from: 'plain', to: 'plain.x' },
    ],
  } as unknown as TodlDocument
}

describe('projectToolbox', () => {
  it('returns only visible taxonomies, dropping hidden terms', () => {
    const tax = projectToolbox(doc())
    expect(tax.map((t) => t.id)).toEqual(['actors'])          // `plain` excluded (no toolbox annotation)
    expect(tax[0]!.label).toBe('Actors')
    expect(tax[0]!.terms.map((t) => t.id)).toEqual(['actors.internal'])  // external hidden
    expect(tax[0]!.terms[0]!.label).toBe('Internal')
    expect(tax[0]!.terms[0]!.concept).toBe('actor')
  })

  it('a doc with no visible taxonomies yields []', () => {
    const d = { nodes: [{ id: 'plain', tier: 'Ontology', typeOf: 'taxonomy', attrs: {} }], edges: [] } as unknown as TodlDocument
    expect(projectToolbox(d)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/meta-model/services/tests/toolbox-projection.test.ts`
Expected: FAIL — `projectToolbox` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// toolbox-projection.ts — pure: a loaded model.json → the taxonomies an author
// marked visible for the toolbox, each with its visible terms. No I/O, no mural.
import type { TodlDocument, JsonNode } from '@pragmatic-lab/todl'
import { projectAnnotations } from './annotation-projection.js'
import { resolveFacets } from './presentation-generator.js'
import { termsOf } from './meta-model-tree-builder.js'

export interface ToolboxTermRef { id: string; label: string; icon?: string; concept: string }
export interface ToolboxTaxonomy { id: string; label: string; terms: ToolboxTermRef[] }

// True when a node carries `annotate toolbox { visible = <want> }`.
function toolboxVisible(doc: TodlDocument, id: string): boolean | undefined {
  const v = projectAnnotations(doc, id)['toolbox']?.['visible']
  return typeof v === 'boolean' ? v : undefined
}

export function projectToolbox(doc: TodlDocument): ToolboxTaxonomy[] {
  const out: ToolboxTaxonomy[] = []
  for (const n of doc.nodes) {
    if (n.tier !== 'Ontology' || n.typeOf !== 'taxonomy') continue
    if (toolboxVisible(doc, n.id) !== true) continue                       // taxonomy: opt-in
    const facets = resolveFacets(n, projectAnnotations(doc, n.id))
    const terms: ToolboxTermRef[] = []
    for (const t of termsOf(doc, n.id)) {
      if (toolboxVisible(doc, t.id) === false) continue                    // term: opt-out
      const f = resolveFacets(t, projectAnnotations(doc, t.id))
      terms.push({ id: t.id, label: f.label, icon: f.icon, concept: conceptOf(t) })
    }
    out.push({ id: n.id, label: facets.label, terms })
  }
  return out
}

function conceptOf(t: JsonNode): string {
  const io = (t as unknown as { instanceOf?: string }).instanceOf
  return typeof io === 'string' ? io : t.typeOf
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/toolbox-projection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(toolbox): projectToolbox — visible taxonomies + terms from model.json`

---

## Task 2: `ToolboxPage` model + move `TermTile`

**Files:**
- Create: `src/renderer/src/modules/diagram/services/toolbox-page.ts`
- Test: `src/renderer/src/modules/diagram/services/tests/toolbox-page.test.ts`

**Interfaces:**
- Consumes: `Model`, `ObservableCollection`, `MetaData`, `DataObject`, `DragDropEffects` (`mural/runtime`), `TOOLBOX_NODE_KIND_FORMAT` (`mural/framework`), `DataTemplate` (`mural/basic`), `ToolboxShape` (`mural/framework`).
- Produces:
  ```ts
  export enum ToolboxPageKind { Shapes = 'shapes', Taxonomy = 'taxonomy' }
  export class TermTile extends Model { /* moved verbatim from arch-terms-palette-service.ts */ }
  export class ToolboxPage extends Model {
    constructor(title: string, kind: ToolboxPageKind)
    get Title(): string
    get Kind(): ToolboxPageKind
    get Items(): ObservableCollection<unknown>   // ToolboxShape | TermTile
  }
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { ToolboxPage, ToolboxPageKind, TermTile } from '../toolbox-page.js'
import { DataTemplate } from '@pragmatic-lab/mural/basic'

describe('ToolboxPage', () => {
  it('carries a title, kind, and a live Items collection', () => {
    const p = new ToolboxPage('Actors', ToolboxPageKind.Taxonomy)
    expect(p.Title).toBe('Actors')
    expect(p.Kind).toBe(ToolboxPageKind.Taxonomy)
    const tile = new TermTile('actors.internal', 'Internal', 'actor', new DataTemplate(() => undefined as never))
    p.Items.Add(tile)
    expect(p.Items.Count).toBe(1)
  })

  it('TermTile drag payload carries the term id under the node-kind format', () => {
    const tile = new TermTile('actors.internal', 'Internal', 'actor', new DataTemplate(() => undefined as never))
    const payload = tile.BeginKindDragData!()
    expect(payload.data.Get('mural/node-kind')).toBe('actors.internal')  // TOOLBOX_NODE_KIND_FORMAT value
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/diagram/services/tests/toolbox-page.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation** — define `ToolboxPageKind`, `ToolboxPage` (Title/Kind via `Model.RegisterProperty`, `Items` = `ObservableCollection`), and move the `TermTile` class body **verbatim** from [arch-terms-palette-service.ts:15-45](../../../src/renderer/src/modules/architecture-repository/services/arch-terms-palette-service.ts#L15-L45) into this file. Confirm the `TOOLBOX_NODE_KIND_FORMAT` string value with a quick grep so the test's `'mural/node-kind'` literal matches; adjust the literal if the constant differs.

- [ ] **Step 4: Run test to verify it passes** — Expected: PASS.

- [ ] **Step 5: Commit** — `feat(toolbox): ToolboxPage model + relocate TermTile`

---

## Task 3: Term-tile template resolver

**Files:**
- Create: `src/renderer/src/modules/diagram/services/toolbox-term-template.ts`
- Test: `src/renderer/src/modules/diagram/services/tests/toolbox-term-template.test.ts`

**Interfaces:**
- Consumes: `LibraryRegistry` ([library-registry.ts](../../../src/renderer/src/modules/library/services/library-registry.ts) — `resolve(classId, concept): DataTemplate`), `DataTemplate`, `TextBlock` (`mural/basic`).
- Produces:
  ```ts
  // Resolve a term's drag-preview template: the library class template when the
  // registry knows it, else a plain text tile (the presentation `mm:<id>` hook is
  // wired in Task 4's service where the source dictionary is available).
  export function resolveTermTemplate(registry: LibraryRegistry | undefined, termId: string, concept: string, label: string): DataTemplate
  ```

- [ ] **Step 1: Write the failing test** — assert: with a registry, returns `registry.resolve(...)`; with `undefined` registry, returns a `DataTemplate` that applies to a `TextBlock` bearing `label` (build the template, `Apply({})`, assert a `TextBlock` with `Text === label` in the result — mirror the pattern in [presentation-icon.test.ts](../../../src/renderer/src/modules/meta-model/services/tests/presentation-icon.test.ts)).

- [ ] **Step 2: Run test to verify it fails** — Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation** — delegate to `registry.resolve(termId, concept)` when `registry` is defined; else return a code-built `DataTemplate` producing a `TextBlock` with `Text = label`.

- [ ] **Step 4: Run test to verify it passes** — Expected: PASS.

- [ ] **Step 5: Commit** — `feat(toolbox): term-tile template resolver`

---

## Task 4: `ToolboxService` — global pages from shapes + all published sources

**Files:**
- Modify: `src/renderer/src/modules/diagram/services/diagram-panel-services.ts` (rename `ToolBoxService` → `ToolboxService`, add `Pages` + `reload()`)
- Test: `src/renderer/src/modules/diagram/services/tests/toolbox-service.test.ts`

**Interfaces:**
- Consumes: `PlexusPanelService`, `IActivatable`, `ObservableCollection`, `DiagramWorkspaceService` (shapes source), `ensureMetaModelsBackend`, `ensureLibrariesBackend`, `scanPublishedModels(storage)` ([meta-model-tree-builder.ts](../../../src/renderer/src/modules/meta-model/services/meta-model-tree-builder.ts)), `projectToolbox` (Task 1), `ToolboxPage`/`ToolboxPageKind`/`TermTile` (Task 2), `resolveTermTemplate` (Task 3), `LibraryRegistry`.
- Produces:
  ```ts
  export class ToolboxService extends PlexusPanelService implements IActivatable {
    static readonly Key: ServiceKey<ToolboxService>
    get Pages(): ObservableCollection<ToolboxPage>
    OnActivated(): void        // → reload()
    reload(): Promise<void>
  }
  ```

**Behavior:** `reload()` rebuilds `Pages`: (1) a `ToolboxPageKind.Shapes` page titled "Shapes" holding the workspace `Document.ToolboxShapes`; (2) for each published meta-model and library (`scanPublishedModels` over each backend → read `<id>/<version>/model.json` → `projectToolbox`), one `ToolboxPageKind.Taxonomy` page per taxonomy, deduped by taxonomy id (merge terms by id), items = `TermTile`s built with `resolveTermTemplate`. Guard headless: missing backends/registry → just the Shapes page. Use a `reloadSeq` guard like the old service.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { ToolboxService } from '../diagram-panel-services.js'
import { ToolboxPageKind } from '../toolbox-page.js'
import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { META_MODELS_BACKEND_ID } from '../../../meta-model/services/meta-models-backend.js'
import { LIBRARIES_BACKEND_ID } from '../../../library/services/libraries-backend.js'

const MODEL = JSON.stringify({
  nodes: [
    { id: 'actors', tier: 'Ontology', typeOf: 'taxonomy', attrs: { label: 'Actors' } },
    { id: 'actors@toolbox', tier: 'Ontology', typeOf: 'toolbox', attrs: { visible: true } },
    { id: 'actors.internal', tier: 'Instance', typeOf: 'actor', attrs: { class: true, label: 'Internal' }, instanceOf: 'actor' },
  ],
  edges: [
    { kind: 'Annotated', via: null, from: 'actors', to: 'actors@toolbox' },
    { kind: 'Contains', via: null, from: 'actors', to: 'actors.internal' },
  ],
})

function provider(seed: (mm: FakeStorage, lib: FakeStorage) => void): ServiceProvider {
  const p = new ServiceProvider()
  const reg = new StorageProviderRegistry(p)
  const mm = new FakeStorage('fake://meta-models'); const lib = new FakeStorage('fake://libraries')
  reg.Register(META_MODELS_BACKEND_ID, () => mm)
  reg.Register(LIBRARIES_BACKEND_ID, () => lib)
  p.registerInstance(StorageProviderRegistry.Key, reg)
  seed(mm, lib)
  return p
}

describe('ToolboxService', () => {
  it('always has a Shapes page and adds a page per visible taxonomy', async () => {
    const svc = new ToolboxService(provider((mm) => { void mm.WriteText('tech/0.1.0/model.json', MODEL) }))
    await svc.reload()
    const titles = [...Array(svc.Pages.Count)].map((_, i) => svc.Pages.Get(i)!.Title)
    expect(svc.Pages.Get(0)!.Kind).toBe(ToolboxPageKind.Shapes)
    expect(titles).toContain('Actors')
    const actors = [...Array(svc.Pages.Count)].map((_, i) => svc.Pages.Get(i)!).find((p) => p.Title === 'Actors')!
    expect(actors.Items.Count).toBe(1)
  })

  it('dedupes a taxonomy that a meta-model and a library both carry', async () => {
    const svc = new ToolboxService(provider((mm, lib) => {
      void mm.WriteText('tech/0.1.0/model.json', MODEL)
      void lib.WriteText('ms/0.1.0/model.json', MODEL)
    }))
    await svc.reload()
    const actors = [...Array(svc.Pages.Count)].map((_, i) => svc.Pages.Get(i)!).filter((p) => p.Title === 'Actors')
    expect(actors.length).toBe(1)
  })

  it('empty backends → only the Shapes page', async () => {
    const svc = new ToolboxService(provider(() => {}))
    await svc.reload()
    expect(svc.Pages.Count).toBe(1)
    expect(svc.Pages.Get(0)!.Kind).toBe(ToolboxPageKind.Shapes)
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — Expected: FAIL (`ToolboxService` not exported / no `Pages`).

- [ ] **Step 3: Write minimal implementation** — rename the class to `ToolboxService`, keep the `Shapes` accessor for the shape-tile source, add `PagesKey` + `reload()` per Behavior. Dedupe with a `Map<string, ToolboxPage>` keyed by taxonomy id. Read backends via `StorageProviderRegistry`; tolerate their absence.

- [ ] **Step 4: Run test to verify it passes** — Expected: PASS.

- [ ] **Step 5: Commit** — `feat(toolbox): ToolboxService aggregates Shapes + taxonomy pages`

---

## Task 5: Rewire diagram module + pages UI

**Files:**
- Modify: `src/renderer/src/modules/diagram/diagram.module.mu` (service + Capability: `ToolBoxService` → `ToolboxService`)
- Modify: `src/renderer/src/modules/diagram/diagram.resources.mu` (`DataTemplate [DataType = ToolboxService]` → `TabControl` over `$Pages`; per-page `Items` renders shape tiles for the Shapes page and term tiles for taxonomy pages)

**Interfaces:**
- Consumes: `TabControl`/`TabItem` from `mural/framework` (usage pattern: [document-tabs.resources.mu](../../../src/renderer/src/services/document-tabs/document-tabs.resources.mu)), the existing shape-tile template ([diagram.resources.mu:241-265](../../../src/renderer/src/modules/diagram/diagram.resources.mu#L241-L265)), a new term-tile template (port the tile markup from [architecture-repository.resources.mu:70-81](../../../src/renderer/src/modules/architecture-repository/architecture-repository.resources.mu#L70-L81), binding `Content = $Template`, `OnDragStart = $BeginKindDragData`).

- [ ] **Step 1** — In `diagram.module.mu`: rename the import, the `.services: { … }` entry, and the `Capability [ Name = "Tool Box", … ServiceKey = ToolboxService ]` ([line 333](../../../src/renderer/src/modules/diagram/diagram.module.mu#L333)).

- [ ] **Step 2** — In `diagram.resources.mu`: replace the `DataTemplate [DataType = ToolBoxService]` body ([line 271](../../../src/renderer/src/modules/diagram/diagram.resources.mu#L271)) with a `TabControl [ ItemsSource = $Pages ]`, each tab titled `$Title`, its content an `ItemsControl [ ItemsSource = $Items ]` whose `ItemTemplate` renders a draggable tile. Keep the existing shape tile as the item template for the Shapes page; add a term-tile item template. (If a single `ItemTemplate` can't switch on tile type, use a `DataTemplateSelector`/type-matched templates — mirror how existing `.mu` distinguishes item types.)

- [ ] **Step 3** — Run `npm run compile:mu`. Expected: compiles with no unknown-symbol errors; `diagram.resources.mu.js` emits `TabControl` + both tile templates.

- [ ] **Step 4** — Headless smoke: extend `toolbox-service.test.ts` (or a new `toolbox-ui.test.ts`) to assert the compiled resources register `DataType = ToolboxService` (import the compiled `.mu.js` and check the dictionary resolves the template). Run it — Expected: PASS.

- [ ] **Step 5: Commit** — `feat(toolbox): pages UI (TabControl) + diagram module rewiring`

---

## Task 6: Remove `ArchTermsPaletteService` + embedded arch palette

**Files:**
- Delete: `src/renderer/src/modules/architecture-repository/services/arch-terms-palette-service.ts` and `.../tests/arch-terms-palette-service.test.ts`
- Modify: `arch-diagram-document.ts` (remove `PaletteKey`/`Palette` — [lines 38-39](../../../src/renderer/src/modules/architecture-repository/services/arch-diagram-document.ts#L38-L39)), `arch-diagram-document-factory.ts` (remove the `new ArchTermsPaletteService(provider)` instantiation — [line 32](../../../src/renderer/src/modules/architecture-repository/services/arch-diagram-document-factory.ts#L32))
- Modify: `architecture-repository.resources.mu` (remove the palette imports [lines 17-18], the `DataTemplate [DataType = ArchTermsPaletteService]` [line 54], and the embedded left palette rail from the canvas template [around lines 29-44] — keep the `Diagram` fill + `DropReceiver = $Self` [line 41])

- [ ] **Step 1** — Delete the two files. Update `TermTile` imports repo-wide to the new `toolbox-page.js` (grep `TermTile`); the arch canvas itself doesn't import `TermTile` (it reads the drag format), so expect only test/resource references.

- [ ] **Step 2** — Remove `Palette` from the document + factory; drop the palette rail from the arch canvas `.mu`, leaving the canvas as the fill child.

- [ ] **Step 3** — Run `npm run typecheck`. Expected: clean (no dangling `ArchTermsPaletteService`/`Palette` references).

- [ ] **Step 4** — Run `npm run compile:mu`. Expected: `architecture-repository.resources.mu` compiles without the removed symbols.

- [ ] **Step 5: Commit** — `refactor(arch): remove ArchTermsPaletteService — toolbox is now the global palette`

---

## Task 7: Graceful out-of-scope drop

**Files:**
- Modify: `src/renderer/src/modules/architecture-repository/services/arch-canvas-ops.ts` (`applyTermDrop`) and/or `arch-diagram-document.ts` (`CreateNode` — [lines 106-111](../../../src/renderer/src/modules/architecture-repository/services/arch-diagram-document.ts#L106-L111))
- Test: `.../services/tests/arch-canvas-ops.test.ts` (extend existing if present, else create)

**Behavior:** When a dropped term's concept/reference isn't resolvable against the document's model (`resolveTermDrop` returns nothing — [drop-resolver.ts:10-24](../../../src/renderer/src/modules/architecture-repository/services/drop-resolver.ts#L10-L24)), `applyTermDrop` must **not** throw or mutate the model; it returns a result the caller surfaces as a transient diagnostic ("term `<id>` isn't in scope for this document — add its library/meta-model binding"). No node is created.

- [ ] **Step 1: Write the failing test** — drop a `termId` whose concept is absent from a minimal doc model; assert no node added and `applyTermDrop` reports an unresolved outcome (return `{ ok: false, reason }` or similar — match the function's current return shape; if it returns `void`, change it to return a discriminated result and assert on that).

- [ ] **Step 2: Run test to verify it fails** — Expected: FAIL (currently throws or no-signal).

- [ ] **Step 3: Write minimal implementation** — guard the unresolved case; return the failure result; have `CreateNode` publish the diagnostic via the existing `DiagnosticsService` (grep for how other services publish transient messages).

- [ ] **Step 4: Run test to verify it passes** — Expected: PASS.

- [ ] **Step 5: Commit** — `feat(arch): graceful no-op + diagnostic on out-of-scope term drop`

---

## Task 8: Suite, typecheck, compile:mu, build green

**Files:** none (verification + cleanup)

- [ ] **Step 1** — `npm run typecheck` → clean.
- [ ] **Step 2** — `npm run compile:mu` → clean.
- [ ] **Step 3** — `npm test` (Vitest) → all green; fix any test that referenced removed services.
- [ ] **Step 4** — `npm run build` → 3 bundles, no errors.
- [ ] **Step 5: Commit** — `test(toolbox): green suite + build after unified toolbox`

---

## Self-Review

- **Spec coverage:** annotation contract (Task 1), Shapes page + taxonomy pages global sourcing + dedupe (Task 4), tabs UI (Task 5), merge/removal of `ArchTermsPaletteService` (Task 6), drop-scope default (Task 7), term-template resolution incl. `mm:<id>`/library/text (Tasks 3–4). Open-question defaults from the spec (show meta-model-only taxonomy terms via `mm:<id>`; order Shapes-first then by label) are realized in Tasks 3–4.
- **Type consistency:** `ToolboxService`, `ToolboxPage`, `ToolboxPageKind`, `TermTile`, `projectToolbox`, `resolveTermTemplate` names are used identically across tasks.
- **Known verification points during execution:** confirm the `TOOLBOX_NODE_KIND_FORMAT` literal (Task 2 test), the `TabControl` item-template-by-type mechanism (Task 5), and `applyTermDrop`'s current return shape (Task 7) against the live code before finalizing each.

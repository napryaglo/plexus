# Layout Pipeline Inspector — Design

**Date:** 2026-07-13
**Status:** Approved (design), pending implementation plan
**Repos touched:** `Plexus` (primary), `Fresco` (one additive change)

## Goal

Integrate Fresco into Plexus as a layout-pipeline inspector: a panel in
Plexus's right Inspector region where the user composes a graph
transform + layout pipeline, picks how it should affect the diagram, and
runs it on the active diagram.

Fresco works on a plain `Graph` (Node/Edge keyed by string Id); transforms
are immutable `Graph → Graph`, layouts are `Graph → Map<id, Point>`.
Plexus owns a `DiagramDocument` whose `Nodes`/`Connectors` are live mural
shapes on a canvas. Integration is an adapter loop: extract a `Graph` from
the active diagram → run the user's pipeline → write results back onto the
diagram shapes. The two projects do not reference each other today, so this
adds a new `@pragmatic-lab/fresco` dependency to Plexus plus a new inspector
contribution.

## Decisions (settled during brainstorming)

- **Builder scope:** full stage builder — every LayoutPipeline stage
  (layer assigner, layer improver, first-layer orderer, dummy inserter,
  reorderer, local improver, position computer, vertical aligner, edge
  router, port assigner) is a swappable strategy slot, plus an
  add/remove/reorder list of graph transforms.
- **Execution effect:** a run-mode selector chosen before running, all
  three modes implemented — positions-only, preview-then-apply, destructive.
- **Placement:** right Inspector region, as a "Layout" contribution to the
  mural `InspectorService`, bound to the active `DiagramDocument`. Compact
  and collapsible to fit the narrow strip.
- **Persistence:** per-diagram auto-saved config, plus a global named-preset
  library.
- **Architecture:** catalog-driven and config-serialized (approach B below).

## Approach B — catalog-driven, config-serialized

Fresco exposes a machine-readable **PipelineCatalog** describing each slot
and the strategies available for it. Plexus renders the whole builder
generically from that catalog. The user's composition *is* a Fresco
`PipelineConfiguration` (JSON), so save/load, per-diagram persistence, and
named presets fall out of serialization. Fresco already has
`BuildPipeline(config, repo)` to turn a config into runnable pipelines.

Rejected alternatives:
- **A — Plexus hardcodes Fresco's stages.** The builder's strategy lists
  drift every time Fresco adds a strategy; manual edits to stay in sync.
- **C — Plexus owns the engine, Fresco is just algorithms.** Duplicates
  Fresco's orchestration for no benefit.

The coupling between the two packages is a data catalog + a JSON config
schema, not class references. Both stay independently buildable and testable.

## Components

### 1. Fresco: `PipelineCatalog` (the one Fresco change — additive)

A pure-data description, exported from `@pragmatic-lab/fresco`, built by
joining the existing `STAGE_REGISTRIES` (in
`src/ge/configuration-loader.ts` — what's instantiable) with
`pipeline-elements.yaml` (display metadata: `Name`, `AlgorithmName`,
`AcademicReferences`).

Shape:

```ts
interface CatalogSlot {
  slotId: string;              // 'graph-transforms' | 'layer-assigner' | ...
  kind: 'transform-list' | 'strategy-slot';
  required: boolean;           // strategy slots optional per LayoutPipeline defaults
  strategies: CatalogStrategy[];
}
interface CatalogStrategy {
  className: string;           // registry key, e.g. 'BarycenterReorderer'
  name: string;                // display name from the yaml
  algorithmName: string;
  references: AcademicReference[];
  parameters?: CatalogParam[]; // only for parameterized strategies
}
interface CatalogParam {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'enum';
  values?: string[];           // for enum
  default?: string | number | boolean;
}
export const PipelineCatalog: CatalogSlot[];
```

A test asserts every catalog strategy instantiates via the registry, so the
yaml and the registry cannot silently drift.

**Parameterized transforms** (`FilterNodesTransform`, `FilterEdgesTransform`,
`MapLabelsTransform` — today they take code predicates and cannot round-trip
to JSON) get a declared `parameters` schema in the catalog and a factory
that builds the predicate from those params. Example: FilterNodes →
`{ field: 'label'|'id', op: 'contains'|'equals'|'matches', value: string }`.
Anything that genuinely cannot be expressed declaratively is omitted from the
catalog in v1. This keeps every catalog strategy serializable and UI-drivable.

### 2. Plexus: `DiagramGraphAdapter` (pure logic, no mural UI)

- `extract(doc: DiagramDocument): { graph: Graph, index: Map<string, shape> }`
  — walks `Nodes`/`Connectors` into a Fresco `Graph`. Assigns each shape a
  stable Id: reuse an existing model id if present, else generate one and
  cache it on the shape. `index` maps Id → shape for write-back. Connectors
  become edges via their endpoint nodes.
- `applyPositions(index, positions, mode)` — writes results back. Converts
  Fresco's **center** points to mural's **top-left** `Canvas.SetLeft/SetTop`
  using each shape's measured size (Fresco/`BuildScene` treats a position as
  a node center; mural positions by top-left corner). Dropped/merged elements
  are diffed against `index` so the run modes can act on the difference.

This is the main risk surface (identity mapping, center↔top-left math,
drop/merge diffing) and is deliberately pure so it can be unit-tested
headless against synthetic documents.

### 3. Plexus: `LayoutPipelineService` (the inspector)

Contributes a "Layout" section to the mural `InspectorService`, bound to the
active `DiagramDocument` (same seam the existing "Format Shape" inspector
uses). Responsibilities:

- Hold the current `PipelineConfiguration`.
- Render the builder generically from `PipelineCatalog` — collapsible
  per-stage sections to fit the narrow Inspector; a reorderable transform
  list; a strategy picker per layout stage; parameter inputs from
  `CatalogParam`.
- Own the **run-mode selector** and **Run**.
- Manage the **named-preset library**.
- Surface last-run diagnostics (node/edge counts, crossings from
  `LastCrossings`, timing) in the section.

## Data flow — run

```
Run
 └─ DiagramGraphAdapter.extract(activeDoc) → { graph, index }
 └─ BuildPipeline(config) → { graphPipeline, layoutPipeline }   (Fresco)
 └─ graphPipeline.Apply(graph) → transformedGraph
 └─ layoutPipeline.Apply(transformedGraph) → positions
        (+ layoutPipeline.LastRoutes, LastCrossings)
 └─ branch on run mode:
      positions-only : applyPositions(index, positions, 'positions')
                       — write positions; dropped nodes stay put
      preview        : show target positions as a non-committed ghost
                       overlay on the diagram canvas; explicit Apply commits
      destructive    : applyPositions + remove dropped nodes / collapse
                       merged edges, all inside one DiagramDocument.Execute
                       command so undo reverts it atomically
 └─ publish diagnostics to the inspector section
```

**Preview mode** renders target positions as a ghost overlay on the *real*
diagram canvas (not a separate Fresco `BuildScene` surface) — it reuses the
actual shapes and fits the narrow Inspector.

## Persistence

- **Per-diagram, auto:** the `PipelineConfiguration` serializes into the
  diagram's saved state; reopening a diagram restores its builder.
- **Named presets, global:** saved from the current pipeline into settings
  via the existing `settings-store` / IPC seam; applicable to any diagram.

Both are just JSON `PipelineConfiguration` blobs, so no bespoke serializer.

## Error handling

- Empty diagram / no active document: Run is disabled with a reason.
- A strategy that throws mid-run: catch, report which slot failed in the
  diagnostics area, leave the diagram untouched (extraction worked on a copy;
  nothing is written until the full run succeeds).
- Config references a strategy no longer in the catalog (e.g. after a Fresco
  update): flag the slot as unresolved in the builder and block Run until the
  user picks a replacement, rather than failing silently.
- Destructive mode failure: because the whole apply is one `Execute` command,
  a throw during apply rolls the command back — no half-mutated diagram.

## Testing

- `DiagramGraphAdapter` — unit tests, headless, against synthetic
  `DiagramDocument`s: identity assignment and reuse, center↔top-left
  conversion, edge extraction from connector endpoints, drop/merge diffing.
- Fresco `PipelineCatalog` — test that every catalog strategy instantiates
  via the registry (yaml/registry drift guard).
- `LayoutPipelineService` run-mode branching — against a fake document:
  positions-only leaves dropped nodes in place; destructive removes them and
  is undoable; preview writes nothing until Apply.
- Round-trip: a composed `PipelineConfiguration` serializes, deserializes,
  and rebuilds an equivalent pipeline.

## Out of scope (v1)

- Strategies that cannot be expressed as declarative parameters.
- A standalone Fresco `BuildScene` preview surface (using a ghost overlay
  instead).
- Editing the transform predicate as free-form code.
- Multi-diagram / batch runs.
```

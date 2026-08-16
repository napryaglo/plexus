# Drop-a-Scenario → Materialize Its Flow — Design

**Date:** 2026-08-16
**Status:** Approved (design), ready for planning
**Repo:** Plexus (renderer). No TODL changes.

## Problem / goal

Dropping a scenario onto the architecture canvas should materialize the
whole scenario as a diagram: a node for every component/actor/block that
participates in any step, and a directional connector for every step. It is
a **visualization** of an already-authored scenario — it writes **no** new
model data.

## Semantics (decided)

- **Placement of an existing scenario, viz-only.** The scenario already
  exists in the project `.todl` with its `sequences`/`steps` authored. The
  drop creates diagram elements only; it never calls `model.addRef` or
  otherwise mutates the model.
- **Drag source:** a new "Scenarios" group in the existing toolbox panel,
  listing the project's scenario entities.
- **Layout:** layered flow following step order (see below).
- **One node per participant** (shared across sequences, not duplicated).
- **Step connectors are visual-only**, directional, deduped per `(src,dst)`
  pair. No order-number labels in v1.
- **Intended on a Scenarios-viewpoint diagram** (e.g. the existing
  `diagram-3` with `"arch.viewpoints":["Scenarios"]`), where structural
  relationships are out of scope so the binding's structural auto-edge
  projection draws nothing and only the step connectors appear. We build
  assuming that viewpoint context; we do **not** add structural-suppression
  logic.

## Model access (meta-model relationship names)

From the `tech-architecture` meta-model:

- `scenario` — field `sequences : sequence[]`; also `label`, `outcome`.
- `sequence` — field `steps : step[]`; relationship `entry_point`.
- `step` — relationships `src` and `dst` (→ `actor | block | component`).

Runtime access via the existing `ArchModel` / todl `Entity` API:

```ts
const scenarios = model.entities().filter((e) => e.concept === 'scenario')
for (const seq of scenario.refs('sequences'))
  for (const step of seq.refs('steps')) {
    const src = step.refs('src')[0]   // Entity | undefined
    const dst = step.refs('dst')[0]
  }
```

`entity.refs(member)` returns target `Entity[]`; `entity.id`, `entity.concept`,
`entity.field(name)` as used elsewhere in the arch services.

## Components

### 1. Scenarios toolbox section

Add a "Scenarios" group to the toolbox panel listing scenario entities of
the open architecture project. Each row is draggable, emitting the existing
`TOOLBOX_ITEM_FORMAT` data object with a **new payload prefix**
`scenario:<entityId>` (siblings today: `term:<id>`, `mm:<id>`). The group is
populated from `ArchModel.entities()` filtered to `concept === 'scenario'`,
labeled via the same `displayLabel` helper (`label` ?? `name` ?? `id`).

### 2. Scenario drop factory

A new `ArchScenarioDropFactory` implementing the toolbox drop-factory
interface, registered next to `ArchInstanceDropFactory`. It recognizes the
`scenario:` payload and, given the drop `context` (position, `Mutator`,
model):

1. Resolve the scenario entity by id.
2. Walk sequences → steps; collect:
   - **participants**: the set of distinct entities appearing as any step's
     `src` or `dst`.
   - **stepEdges**: the set of distinct `(srcId, dstId)` ordered pairs.
3. Materialize participant nodes (§3), lay them out (§4), draw step
   connectors (§5), then `model.notifyChanged()` (single rescan) — **no**
   `model.save()` for edges, and no `addRef`.

Steps whose `src`/`dst` is missing/unresolved are skipped (defensive; a
malformed scenario must not throw).

### 3. Participant nodes (reuse-first)

For each participant entity:
- If an `ArchNodeVM` with `Id === entity.id` is already in `doc.Nodes`,
  reuse it (record it as pre-existing; do not reposition).
- Else create `new ArchNodeVM()`, set `Id = entity.id`, add via
  `Mutator.AddNode(vm)`. Its label/icon resolve on the subsequent binding
  rescan (the entity already exists in the model). Record it as newly
  created (eligible for layout positioning).

No entity is created; the node is a view onto an existing entity.

### 4. Layered flow layout

Compute positions for the **newly created** nodes only (pre-existing nodes
keep their place):

1. Build a directed graph: vertices = participant ids, arcs = `stepEdges`.
2. **Break cycles**: run a DFS; any arc pointing back to a vertex on the
   current stack is dropped from the layering graph (kept as a connector,
   just not used for layering).
3. **Assign columns by longest path**: `column(v) = 0` if `v` has no
   incoming (layering) arc, else `1 + max(column(u))` over predecessors
   (computed in topological order over the acyclic layering graph).
4. **Position**: for a node at column `c`, the `k`-th in its column (stable
   order by first appearance), set
   `Left = originX + c * COL_DX`, `Top = originY + k * ROW_DY`, where
   `originX/originY` is the drop position and `COL_DX`/`ROW_DY` are fixed
   spacings (e.g. 200 / 120). Only newly created nodes are moved; a
   pre-existing participant simply anchors its column at its current spot
   conceptually but is not repositioned.

This yields a left-to-right flow; shared prefixes across sequences collapse
to shared columns, divergences branch downward.

### 5. Step connectors (visual-only, directional)

For each distinct `(srcId, dstId)` in `stepEdges` where both nodes are
present (reused or created), create one directional connector:

```ts
doc.CreateConnector(
  new ConnectorEndpoint({ Node: srcNode }),
  new ConnectorEndpoint({ Node: dstNode }),
)
```

These are diagram-only; they are **not** written to the model and carry no
`member`. Deduped per pair. No order labels in v1.

## Non-goals / deferrals

- No new model data; no authoring of scenarios/steps (that was the rejected
  drop-semantics option).
- No step order numbering, no playback/animation overlay (separate future
  layer — the postponed scenario-overlay UX).
- No structural-edge suppression logic; relies on the Scenarios viewpoint
  scoping instead.
- No auto-run of the general layout engine; the layered flow is bespoke and
  local to the dropped scenario.
- Duplicating a participant per sequence (lanes) is explicitly not done.

## Testing (vitest, node env — no monaco/DOM)

The layout and graph logic must be pure and headless-tested; the drop
factory's model-walk is tested against a small in-memory `ArchModel`
built from `.todl` sources (as sibling arch-service tests do).

- **Participant + step-edge collection:** given a scenario with two
  sequences sharing a prefix, assert the participant set is the union and
  `stepEdges` is deduped per pair.
- **Cycle breaking:** a scenario whose steps form a cycle still produces a
  finite column assignment (back-arc dropped from layering, kept as edge).
- **Longest-path columns:** a diamond (A→B, A→C, B→D, C→D) yields
  columns A=0, B=1, C=1, D=2.
- **Reuse:** a participant already present as an `ArchNodeVM` is not
  duplicated and not repositioned; only missing participants are added.
- **Connectors:** one connector per distinct `(src,dst)`; a repeated pair
  across sequences collapses to one.
- **Malformed step:** a step missing `src` or `dst` is skipped without
  throwing.

## Files (anticipated)

| File | Change |
|------|--------|
| `src/renderer/src/modules/architecture-projects/services/scenario-flow.ts` (new, pure) | participant/step-edge collection + layered-flow layout (graph, cycle-break, longest-path columns, positions) |
| `src/renderer/src/modules/architecture-projects/services/arch-scenario-drop-factory.ts` (new) | drop factory: resolve scenario, materialize nodes (reuse-first), apply layout, draw step connectors |
| toolbox panel / library-tree services (new "Scenarios" group + `scenario:` drag payload) | list scenario entities as draggable items |
| drop-factory registration (`diagram-panel-services.ts` area) | register `ArchScenarioDropFactory` for the `scenario:` payload |
| `tests/` next to the new files | pure-logic coverage per Testing |

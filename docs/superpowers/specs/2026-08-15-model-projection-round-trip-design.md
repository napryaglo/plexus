# Model Projection Round-Trip — Design

**Date:** 2026-08-15
**Status:** Design (approved shape; pending spec review → implementation plan)
**Repo:** Plexus (consumes `@pragmatic-tech-ai/mural`, `@pragmatic-tech-ai/todl`)

## Goal

Turn an architecture `.diagram` into a **true, curated, two-way projection** of the
project's TODL architecture model: existing model entities are placed as nodes,
their relationships render as connectors, and canvas gestures (place, connect,
delete) write back to the `.todl`. The write path today only *creates new*
entities by dropping library terms; this design adds the **read/render** direction
and the **place-existing / draw-connector / delete** gestures, closing the loop.

## Context — what exists

The viewpoint-scoped multi-file architecture model (SP0–SP4) is headless-complete.
Relevant machinery this design builds on:

- **`ArchModel`** ([arch-model.ts](../../src/renderer/src/modules/architecture-projects/services/arch-model.ts)) — per-project live model over a `ModelDraft`. Read: `entities()`, `repository()`, `viewpoints()`. Write: `create`/`createInViewpoint`, **`addRef(from, member, to)`**, `remove(id)`, `save()`, `onChanged(cb)`, `notifyChanged()`.
- **`ArchDiagramBinding`** ([arch-diagram-binding.ts](../../src/renderer/src/modules/architecture-projects/services/arch-diagram-binding.ts)) — attached per opened arch diagram by `ArchDiagramBindingService`. Its `rescan()` binds placed nodes (`ArchNodeVM`/`Figure` whose `Id` is a live entity) → syncs label + icon, and removes tracked nodes whose entity was deleted. Runs on attach and on `model.onChanged`. Holds `doc`, `model`, `scope`.
- **`ArchDiagramBindingService`** — observes `DocumentsContentHostService.OpenDocuments`, attaches/disposes a binding per architecture-project diagram; exposes `modelForDocument(doc)` and `scopeForDocument(doc)`.
- **Drop resolver** ([arch-drop-resolver.ts](../../src/renderer/src/modules/architecture-projects/services/arch-drop-resolver.ts)) — `resolveDropActions(repo, key, scope) → DropAction[]` (subtype-aware, viewpoint-filtered; 0 reject / 1 auto / many chooser). Consumed by `ArchInstanceDropFactory`.
- **`DropCandidateChooserService`** — canvas-overlay popup for the many-candidates case.
- **Toolbox** ([diagram-panel-services.ts](../../src/renderer/src/modules/diagram/services/diagram-panel-services.ts)) — `ToolboxService` populates the mural `ToolboxRepository` singleton with pages built from *published* meta-models/libraries. Contributes via `repo.EnsurePage(id, label)` + `page.Items.Add(new ArchToolboxItem(itemId, label, descriptor, dropFactoryKey))`; tracks `contributedPageIds`; reloads on `OnActivated`. **Not diagram-aware today.**
- **Generic `DiagramDocument`** (mural) — observable `Connectors` collection (`.Subscribe`), `CreateConnector(source, target)`, `DeleteConnectors(cs)`, `AddNode(vm)`, `DeleteNodes(ns)`, `Nodes`.
- **`Entity`** (todl) — `field(name): Scalar|undefined`, **`refs(member): Entity[]`**. `repo.effectiveSchema(concept).relationships` yields `{name, targets}` per relationship member.

## Locked decisions

1. **Mode** — full round-trip view: entities + edges render from the model, layout persists per-diagram, canvas edits write back.
2. **Membership** — curated, model-backed: a node appears only when placed; membership + positions persist in the `.diagram` scene; a new model entity does not auto-appear.
3. **Delete** — `Delete` removes the node from the view only; **`Shift+Delete`** also removes the entity from the model (`ArchModel.remove`).
4. **Connector authoring** — meta-model-driven + chooser: drawing A→B resolves valid relationship members between A's and B's concepts (0 reject / 1 auto / many chooser), mirroring the term-drop resolver.
5. **Place-existing surface** — a dynamic **`"Model: <name>"` ToolboxPage** listing in-scope entities *not yet placed* on the active diagram; dragging one *places* it (no entity creation); dedup prevents a second placement of the same instance.
6. **Initial placement** — a placed/added node lands at the drop point (toolbox drag carries a position); programmatic adds land near a related placed node, else a cascade offset. No global auto-layout.

## Architecture

One principle, unchanged from SP0: **the generic `DiagramDocument` stays generic; arch behavior attaches externally.** All new behavior hangs off the existing per-diagram binding lifecycle (`ArchDiagramBindingService`) plus one new active-diagram-driven toolbox contributor.

**What persists vs. what derives:**

- **Persists** in the `.diagram` scene: node **membership + positions** (nodes carry `Id = entityId`, already the case).
- **Derives** (never persisted as diagram data): **connectors**. On every `rescan()` the projected connector set is recomputed from the model's relationships between placed nodes; connectors with no backing relationship or a missing endpoint are removed. This keeps the edge picture a truthful render of the model and sidesteps stale/duplicate connector persistence. (The generic `Save` may still serialize connectors into the scene JSON; the reconcile pass on open makes any persisted set correct, so it is harmless — a later refinement may strip them or persist per-connector routing.)

**Two-way data flow:**

```
                 model.onChanged / attach
   ArchModel  ───────────────────────────►  ArchDiagramBinding.rescan()
      ▲                                        • bind placed nodes (label/icon)   [exists]
      │                                        • project edges: for each placed   [SP1 new]
      │                                          entity, refs(member) → placed
      │                                          in-scope targets → CreateConnector
      │                                        • reconcile: remove stale nodes    [exists]
      │                                          + stale projected connectors      [SP1 new]
      │
      │  addRef / remove         place (AddNode, no model write)
      │ ◄──────────────┐        ◄──────────────┐
      │                │                        │
 connector draw   Shift+Delete            "Model:" page drag-drop
 (SP3)            (SP4)                    (SP2)
```

## Sub-projects

### SP1 — Edge projection (read)

Grow `ArchDiagramBinding.rescan()` with an edge pass, after the existing node-bind
pass. Track projected connectors like nodes are tracked:

- `private readonly boundEdges = new Map<string, Connector>()` keyed by
  `edgeKey(fromId, member, toId)` (e.g. `` `${from}|${member}|${to}` ``).
- **Desired set:** for each placed entity `e` (an entry in `bound`), for each
  `rel` in `repo.effectiveSchema(e.concept).relationships`, for each `target` in
  `e.refs(rel.name)` whose id is **also in `bound`** and whose concept is
  **in scope** (`repo.viewpointsFraming(target.concept)` intersects `scopeSet()`),
  emit `edgeKey(e.id, rel.name, target.id)`.
- **Reconcile:** `CreateConnector(sourceFigure, targetFigure)` for desired keys not
  in `boundEdges` (label = member name); `DeleteConnectors([c])` for
  `boundEdges` entries whose key is no longer desired. Figures are resolved from
  `bound` (entityId → node).
- **Self/duplicate guards:** skip self-loops unless the model truly has one; a
  key is unique per (from, member, to) so multi-member relationships between the
  same pair render as distinct connectors.

**Independently testable** against drop-created nodes: drop two related terms →
connector appears; delete one node → its connectors are reconciled away.

*Interfaces produced:* `edgeKey(from, member, to): string`; `boundEdges` map;
connector label = member name. *Consumes:* `Entity.refs`, `repo.effectiveSchema`,
`DiagramDocument.CreateConnector/DeleteConnectors/Connectors`.

### SP2 — "Model: <name>" ToolboxPage + place-existing

**Contributor.** A new `ArchModelToolboxContributor` service that watches the
**active** document (via `DocumentsContentHostService` selection +
`ArchDiagramBindingService.modelForDocument`). When the active document is an
architecture-project diagram, it ensures a single page
`repo.EnsurePage('arch:model', "Model: " + model.namespace)`; otherwise it removes
that page. It refreshes the page's items on: active-document change,
`model.onChanged`, diagram scope change, and `doc.Nodes` add/remove.

**Page items.** Items = entities `e` in `model.entities()` where (a) `e.concept`
is framed by the diagram's active viewpoints (`scopeForDocument`), and (b) `e.id`
is **not already placed** on the diagram (not in the binding's `bound` map). Each
item: `new ArchToolboxItem('instance:' + e.id, displayLabel(e), descriptor, ArchModelInstanceDropFactoryKey)`
where `descriptor = new ToolboxVisualDescriptor(TodlVisualResolverKey, iconEntityKey(repo, e) ?? e.concept)`
(same icon derivation as the binding).

**Place-existing drop factory.** `ArchModelInstanceDropFactory` (new,
`ArchModelInstanceDropFactoryKey`) implements `IToolboxDropFactory`. `CreateDropped(context)`:
- Resolve the model + placed set for `context.Mutator` via `ArchDiagramBindingService`.
- Parse the entity id from the item (`context.Descriptor` / item id `instance:<id>`).
  *(Note: `ToolboxDropContext` carries `Descriptor.Key` = the visual key. Placing
  needs the entity id; the item id — `instance:<id>` — must reach the factory.
  Confirm the drop context surfaces the item id or key we can map back to the
  entity; if only the visual key is available, key the item by the entity id.)*
- **Dedup:** if the entity is already placed, no-op (return null). Belt-and-
  suspenders behind the page-level exclusion.
- Else `AddNode(new ArchNodeVM{ Id: entityId, Left: X, Top: Y })`,
  `model.notifyChanged()` (rescan binds label/icon + projects its edges). **No
  `create`, no `addRef`, no `save`** — placement changes only the diagram scene.

Deleting a placed node (SP4 view-remove) drops it from `bound` → the contributor
refresh re-adds it to the page (reappears).

*Interfaces produced:* `ArchModelInstanceDropFactoryKey`; page id `'arch:model'`;
item id scheme `instance:<entityId>`. *Consumes:* `ToolboxRepository.EnsurePage/RemovePage`,
`ArchToolboxItem`, `ArchDiagramBindingService`, `DocumentsContentHostService`.

### SP3 — Connector authoring (write)

**Connector resolver.** `resolveConnectorActions(repo, sourceConcept, targetConcept, scope) → ConnectorAction[]`,
mirroring `resolveDropActions`: for each `rel` in
`repo.effectiveSchema(sourceConcept).relationships` whose `targets` accept
`targetConcept` (subtype-aware via the existing `acceptSet`/supertype logic) and
whose owning concept is in scope, emit `{ member: rel.name, label: `${rel.name} → ${targetConcept}` }`.
`ConnectorAction = { member: string; label: string }`. 0 reject / 1 auto / many chooser.

**Interception.** In the binding (or a sibling attached alongside it), subscribe to
`doc.Connectors`. On an **added** connector that is **not** one we projected
(its `edgeKey` is absent from `boundEdges` — i.e. user-drawn):
- Resolve source/target figures → their entity ids via `bound` (reverse lookup).
  If either endpoint is not a bound arch node, leave the connector alone (freeform).
- `resolveConnectorActions(repo, sourceConcept, targetConcept, scope)`:
  - 0 → remove the raw connector (`DeleteConnectors([c])`), it isn't a sanctioned
    relationship.
  - 1 → `model.addRef(sourceId, member, targetId)`; remove the raw connector; the
    next `rescan()` (fired by `notifyChanged` inside `addRef`) projects the real
    one via `boundEdges`.
  - many → `DropCandidateChooserService.Show(actions, chosen => { addRef; remove raw })`.
- **Re-entrancy guard:** ignore `Connectors` additions we make ourselves in the
  edge-projection pass (compare against `boundEdges`, or set a `_projecting` flag
  around `CreateConnector`).

*Interfaces produced:* `resolveConnectorActions`; `ConnectorAction`. *Consumes:*
`ArchModel.addRef`, `DropCandidateChooserService`, `doc.Connectors` subscription,
`bound` reverse lookup.

### SP4 — Delete / Shift+Delete routing

Plain `Delete` already means "remove from view": the generic diagram's delete
removes the figures via `DeleteNodes`; the entity is untouched, so the node simply
leaves the scene (and reappears in the Model page). The only new behavior is the
**`Shift+Delete` → also remove the entity** path.

Attach a small key behavior per arch diagram (through
`ArchDiagramBindingService`'s lifecycle). On `Shift+Delete` over the diagram: for
each selected node that is a bound arch node (`bound` reverse lookup),
`model.remove(entityId)` (fires `notifyChanged` → rescan removes the node + its
edges everywhere) and `model.save()`. Plain `Delete` falls through to the generic
view-only removal. Multi-select respected.

*Consumes:* selection surface of the diagram, `ArchModel.remove/save`, `bound`.

## Persistence

- **Nodes:** unchanged — the `.diagram` scene stores `Figure.Id/Left/Top`; a
  placed node's `Id = entityId` is the durable membership record.
- **Connectors:** derived, not authored data. Reconciled from the model on open;
  no arch-specific connector persistence in v1.
- **Model:** `ArchModel.save()` writes the multi-file `.todl` delta (via
  `toTodlByFile`) after `addRef` (SP3) and `remove` (SP4). Placement (SP2) and
  view-delete (SP4 plain) do **not** save — they touch only the scene.

## Testing

Each sub-project ships headless tests next to its source (`tests/` subfolder):

- **SP1:** given a model with two related entities placed as nodes, `rescan()`
  creates one connector labeled by the member; removing a node or the relationship
  reconciles it away; multi-member pairs → distinct connectors; out-of-scope
  target → no connector.
- **SP2:** contributor builds the page from in-scope, not-yet-placed entities;
  placing removes the item; deleting re-adds it; non-arch active doc → no page;
  place-existing factory adds a node without mutating the model; dedup no-ops a
  second placement.
- **SP3:** `resolveConnectorActions` returns 0/1/many correctly (subtype-aware,
  scope-filtered); a user-drawn connector with one candidate calls `addRef` and
  removes the raw connector; zero candidates removes it; the projection re-entrancy
  guard doesn't loop.
- **SP4:** plain delete leaves the entity; `Shift+Delete` calls `remove` + `save`;
  multi-select routes each node.

Live-GUI smoke (after headless): Model page renders + drags place nodes; connectors
draw + chooser picks; Shift+Delete removes from model; icons resolve.

## Build order

**SP1 → SP2 → SP3 → SP4.** SP1 is the foundational render (visible with existing
drop-created nodes). SP2 fills a canvas from an existing model (the headline
feature). SP3 closes the connector write loop. SP4 is delete polish. Each is a
working, independently reviewable increment.

## Open items / follow-ups (out of scope v1)

- **Entity id at the drop site (SP2):** confirm `ToolboxDropContext` surfaces the
  item id (`instance:<id>`); if it only carries the visual `Descriptor.Key`, key
  the Model-page items by the entity id so the factory can recover it.
- **Connector routing persistence:** v1 auto-routes derived connectors; persisting
  per-connector waypoints per diagram is a later refinement.
- **Searchable "Add existing…" command:** for very large models, a searchable
  picker alongside the Model page (the page alone can get long).
- **Directionality/label styling** of projected connectors (arrowheads per
  relationship semantics) beyond the member-name label.
- **Reverse-relationship placement affordance:** offering to place a related but
  not-yet-placed entity when drawing a connector to empty space.

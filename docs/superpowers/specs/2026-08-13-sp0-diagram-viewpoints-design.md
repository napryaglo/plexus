# SP0 — Diagram creation & editing with governing viewpoints

**Status:** design, awaiting review. Not committed.

## Context

First sub-project of the "governed projection" mechanism: an architecture
diagram is a view over the project's model, and its **viewpoints** govern what
can be added to it and (later) what stays on it. The full mechanism decomposes
into SP0 (this doc) → SP1 (reference-existing nodes + connector projection) →
SP2 (Model Explorer palette) → SP3 (populate from viewpoint) → SP4 (connector
creation / write). SP0 is the foundation: it establishes the governing viewpoint
set as the single authority every later sub-project reads via
`ArchDiagramBindingService.scopeForDocument(doc)`.

## Goal

A single viewpoint-picker **dialog**, used to (1) choose a new diagram's
viewpoints at creation and (2) edit an existing diagram's viewpoints later. The
selection is serialized **with the diagram file** so it restores on the next
open. Narrowing the set on edit removes now-out-of-scope nodes, but only after a
confirmation that lists them.

## Locked decisions (from brainstorming)

- **One dialog** reused for create and edit (not the current inline Inspector
  toggle panel).
- **Edit entry point:** the diagram's toolbar / document-tab context menu. The
  existing `DiagramViewpointScopeService` Inspector panel is **removed**.
- **Persistence:** the viewpoint list is serialized inside the `.diagram` file
  (see Persistence), superseding the project-manifest storage, and restored on
  open. Restored selection is the diagram's governing scope.
- **Scope authority:** the governing viewpoints gate what can be added (SP1–SP4)
  **and** what stays. Narrowing removes out-of-scope placed nodes after a
  confirmation dialog listing them; cancel leaves the scope unchanged.
- **Constraints:** at least one viewpoint required. Creation defaults to all
  viewpoints selected; edit pre-selects the current set.

## What already exists (reused, not rebuilt)

- `DiagramViewpointPickerService` — a modal multi-select VM: `pick(viewpoints)`
  opens it and resolves the chosen ids (or `undefined` on cancel), `Rows` /
  `IsOpen` / `ConfirmCommand` for the template. **No `.mu` template yet** — the
  missing piece.
- `ArchNewDiagramParticipant` — the new-`.diagram` participant that calls the
  picker and records the choice.
- `scopeForDocument(doc)` / `setScope` on `ArchDiagramBindingService` — the read
  authority the term-drop already honors.
- `ArchDiagramBinding.rescan()` — the model→diagram sync pass; the reconciliation
  removal reuses its node bookkeeping.

## Components

### 1. Viewpoint picker dialog (the missing `.mu`)

A modal `DataTemplate [DataType = DiagramViewpointPickerService]` (a new
`viewpoint-picker.resources.mu`, mounted like `chooser.resources.mu`): a titled
card over `$Rows` (checkbox per `PickerRow`, `IsSelected` two-way) with
Confirm / Cancel, shown while `$IsOpen`. Confirm is disabled when zero rows are
selected (the ≥1 constraint). `PickerRow.Label` shows the viewpoint's display
name.

`DiagramViewpointPickerService.pick()` gains: an optional pre-selection set (edit
pre-checks the current scope; creation pre-checks all), and a Cancel command
that resolves `undefined`.

### 2. Creation flow

`ArchNewDiagramParticipant` (already wired to run for a new `.diagram` in an arch
project): open the dialog with all viewpoints pre-selected; on confirm, the
chosen set becomes the new document's serialized viewpoints (Persistence); on
cancel, either abort creation or fall back to all — **decision: abort creation**
(a governed diagram must declare its viewpoints).

### 3. Edit flow

A new command `arch.editDiagramViewpoints`, surfaced on the diagram toolbar and
the document-tab context menu, enabled only for an arch-bound diagram. It opens
the dialog pre-selected with the document's current scope. On confirm:

1. Compute `removed = placed nodes whose entity is framed by NONE of the newly
   chosen viewpoints` (via `repository().viewpointsFraming(entity.concept)`).
2. If `removed` is non-empty, open a **confirmation dialog** listing those nodes
   (by display label). Cancel → abort the whole edit (scope unchanged). Confirm →
   continue.
3. Apply the new scope (`setScope` + persist), delete the `removed` nodes from
   the document, and let the binding re-sync.

The existing `DiagramViewpointScopeService` Inspector panel and its
registration/mount are removed.

### 4. Persistence — serialize with the diagram

The `.diagram` file is mural's `SerializedDiagram` JSON (`{ nodes, connectors }`)
written through `FileDiagramStorage`. It has no metadata slot, and `_serialize()`
regenerates the object each save, so viewpoints must be given a durable home in
that file.

**Chosen: a mural document-metadata slot.** Add an optional
`metadata?: Record<string, unknown>` to `SerializedDiagram`, round-tripped by
`DiagramDocument` (`_serialize` emits it when present, `_deserialize` retains it)
and exposed as `DiagramDocument.Metadata` get/set. Plexus stores the list under a
namespaced key (`metadata['arch.viewpoints']`). Clean, reusable for any app
metadata, and robust against mural re-serialization. **SP0 therefore includes a
mural change + version bump**, published to Verdaccio and consumed by Plexus, per
the established flow.

_Considered and rejected: a Plexus "sidecar key" injected into the same JSON at
`FileDiagramStorage` — no mural bump, but fragile (relies on mural ignoring
unknown keys) and couples the storage layer to arch data._

**Migration:** on load, read viewpoints from the document first; if absent, fall
back to the manifest (`readDiagramViewpoints`, legacy files); on save, write to
the document. The manifest path is retired once existing diagrams are re-saved.

## Data flow

Create/edit dialog → chosen ids → document metadata (Persistence) + `setScope`.
`scopeForDocument(doc)` reads the document's viewpoints. Every later sub-project
(palette, populate, projection, edge-creation) reads that one value.

## Testing (headless, `tests/` beside source)

- Picker service: `pick(preselected)` seeds `Rows` with the right checks;
  confirm resolves selected ids; cancel resolves `undefined`; confirm blocked at
  zero selection.
- Persistence round-trip: save a document with viewpoints → reload → same set;
  legacy manifest fallback when the document has none.
- Reconciliation: given placed nodes + a narrowed scope, the computed `removed`
  set is exactly the nodes framed by no chosen viewpoint; an unchanged/ widened
  scope yields an empty set.
- Creation participant: confirm persists the chosen set; cancel aborts.

## Out of scope (later sub-projects)

Placing existing entities (SP1/SP2), connector projection (SP1), populate (SP3),
edge creation (SP4). SP0 ships the governed scope + its dialog + persistence +
reconciliation only; nothing new is *added* to the canvas yet.

## Resolved decisions

1. **Persistence mechanism:** mural `SerializedDiagram.metadata` slot (SP0 spans a
   mural change + bump). ✅
2. **Cancel-at-creation:** abort creation. ✅

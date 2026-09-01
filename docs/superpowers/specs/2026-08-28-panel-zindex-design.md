# Panel.ZIndex + Diagram Z-Ordering — Design

**Date:** 2026-08-28
**Status:** Approved design; pending implementation plan
**Repos:** Mural (`@pragmatic-tech-ai/mural` framework + diagram) and Plexus (app)

## Problem

The diagram has only a coarse, fixed two-layer z-order (`DiagramLayersPanel`:
connectors always behind figures). Within a layer, paint order is purely the
child-insertion order of a `Canvas`, and there is **no** per-element z-order
control — no `ZIndex` attached property, and no Bring-to-Front / Send-to-Back
commands. WPF exposes z-order as a `Panel`-level attached property honored by
every panel; Mural has no equivalent.

This design closes that gap in one coherent mechanism: a `Panel.ZIndex`
attached property (the primitive), driven on the architecture diagram by
Bring-to-Front / Send-to-Back / Bring-Forward / Send-Backward commands, with
the resulting integer persisted per figure in the `.diagram` file.

## Goals

- A `Panel.ZIndex` attached property on the runtime `Panel` base, honored by
  **every** panel (Grid, Canvas, StackPanel, the diagram figures Canvas, …).
- Higher ZIndex paints on top; equal ZIndex breaks ties by insertion order.
- **Live** reactivity: changing a child's ZIndex at runtime repaints in the
  new order immediately (required for the diagram commands).
- Authorable in `.mu` markup as `Panel.ZIndex = N`, and programmatically via
  `Panel.SetZIndex(child, n)` / `Panel.GetZIndex(child)`.
- Diagram commands Bring-to-Front / Send-to-Back / Bring-Forward /
  Send-Backward on the selected figure(s), on the context menu and keyboard.
- Per-figure Z persisted in the `.diagram`, round-tripping cleanly; old files
  (no z) load unchanged.

## Non-Goals

- Z-order across the two diagram layers. Connectors stay behind figures;
  ZIndex orders only *within* a layer.
- Group/container-relative z rules beyond "figure is a child of its layer
  Canvas" (nested-container z is whatever the container's child host yields).

## Key Constraints (from the codebase)

- Paint order = the order `visual.visualChildren` yields; the SVG renderer
  walks that at Mural `src/visual-engine/drawing/svg-renderer.ts:519`.
- `Panel.visualChildren` and `logicalChildren` currently share one cached
  snapshot (`childrenSnapshot()`, Mural `src/visual-engine/element.ts:2104-2114`).
- The renderer's walk only `appendChild`s **new** nodes; existing children
  keep their DOM slot (Mural `svg-renderer.ts:381-383`). So reordering an
  existing child needs an explicit DOM reconcile.
- `RegisterAttachedProperty` (Mural `src/runtime/model.ts:328`) has no
  change-callback param; notifications flow through `OnPropertyChanged` /
  `AddPropertyChangedListener`, and `MetaData` flags only invalidate the
  element the property is on — never its parent's child ordering.
- Attached-property setters in `.mu` resolve generically
  (`emitSetDP(target, ownerType, …)`, Mural `src/compiler/compiler.ts:3395`);
  `Panel` is already a registered symbol (Mural `src/compiler/symbol-table.ts:17`).
- Hit-testing rides native `elementsFromPoint` (`HtmlTarget.HitTest`), so it
  follows DOM order automatically once the renderer reconciles it.

## Design

### §1 — Framework primitive: `Panel.ZIndex`

Register an attached property on the runtime `Panel` base:

- `Panel.ZIndexKey = RegisterAttachedProperty<number>(Panel, 'ZIndex', 0, MetaData.None)`
- `Panel.GetZIndex(v: Visual): number`
- `Panel.SetZIndex(v: Visual, n: number): void`

Shape mirrors `Canvas.SetLeft` / `Canvas.SetTop`. `MetaData.None` because the
invalidation is bespoke (§3), not the standard self-invalidation. Markup
`Panel.ZIndex = N` requires no new compiler wiring — a numeric attached setter
on an already-registered owner. Semantics: higher = painted on top; equal
values keep insertion order.

### §2 — Sorted visual order, unsorted logical order

Split the single snapshot into two:

- `visualChildren` → children **stable-sorted by ZIndex ascending** (last =
  top). Stable sort over an insertion-ordered array makes insertion order the
  implicit tie-break.
- `logicalChildren` → insertion order, unchanged. This preserves the
  `ItemsControl` container↔item index invariant, which must not be perturbed
  by z-order.

Both snapshots are lazily cached and cleared on child add/remove (the existing
`_children.Subscribe` seam, Mural `element.ts:2034`). The **sorted** snapshot
is additionally cleared on any child ZIndex change (§3).

### §3 — Live reactivity

`Panel.SetZIndex(v, n)` notifies the child's visual parent after writing the
value:

- After `v.set_property_value(ZIndexKey, n)`, read `v.GetVisualParent()`; if it
  is a `Panel`, call its package-internal `_invalidateZOrder()`, which clears
  the sorted `visualChildren` snapshot and calls `InvalidateVisual()` to
  schedule a render pass.
- Child add/remove already clears the snapshot via the existing
  `_children.Subscribe` seam, so a markup-set ZIndex on a new child sorts
  correctly on first read — no parent notify needed at construction.

This is chosen over a per-child `AddPropertyChangedListener` (the WPF-style
route) deliberately: a per-child listener would add a ZIndex EVD + subscription
to **every** child of **every** panel app-wide (every Grid cell, list item) for
a diagram-centric feature. Notifying from `SetZIndex` costs nothing for the
children that never touch Z. `MetaData.None` on the property — a `MetaData`
flag would invalidate the child, not reorder its siblings.

**Documented limitation:** only `SetZIndex` (and markup, at construction)
triggers a reorder. A runtime `Binding` or raw `set_property_value` to ZIndex
won't auto-reorder — the diagram commands and markup both use the supported
paths, so this doesn't affect the feature. Revisit if a bound ZIndex is ever
needed.

### §4 — Renderer reconciles DOM child order

Replace the "append only new nodes" logic in the walk's child loop with a
**positional reconcile**: iterate `visual.visualChildren` in order and, for
each child, ensure its outer `<g>` is at the correct position under the child
parent (`insertBefore` the expected next sibling) — issuing a DOM move **only
when the actual position is wrong**. New nodes and reordered nodes take the
same path. Clean renders (correct order already) do zero DOM writes, keeping
the hot path cheap. This coexists with the existing reparent relocation
(a child moving to a different parent/clip group still `appendChild`s into the
new parent, then the reconcile positions it).

### §5 — Diagram commands

In `DiagramCommands`, add `_installZOrderCommands()` (called from the
constructor) following the `_installAlignCommands()` pattern
(Mural `src/framework/diagram/collaborators/diagram-commands.ts`):

All four are one uniform operation: take the parent's children in current
effective order (stable sort by Z, insertion index breaking ties), rearrange
the selected items within that array, then renumber every sibling `0..n-1` by
its new position. Rearrangement per command:

- **Bring to Front** → move selected to the end (top).
- **Send to Back** → move selected to the start (bottom).
- **Bring Forward** → shift each selected up past the nearest non-selected
  neighbor above.
- **Send Backward** → shift each selected down past the nearest non-selected
  neighbor below.

Renumbering to `0..n-1` (rather than swapping) makes the operation correct even
when siblings share the default Z 0 (a swap of equal values is a no-op).
Multi-select preserves the selected items' relative order. `CanExecute` = ≥1
selected figure (reads `Diagram.SelectedItems`; reuse `selectedTopLevel` from
`commands/group-ops.js` to ignore nested container members). The command groups
the selection by visual parent and reorders each parent's child set
independently, so a figure nested in a container reorders among that
container's children.

New `Diagram` DP keys (`BringToFrontCommandKey`, …) + public getters, matching
the align-command registration. Commands read/write Z through
`Panel.GetZIndex` / `Panel.SetZIndex` on the figures — no separate
`Figure.ZIndex` DP; the attached property IS the state.

Plexus wiring:
- Context-menu items in
  `src/renderer/src/modules/diagram/diagram.resources.mu` after the
  align/distribute section, bound to `$ActiveView.BringToFrontCommand` etc.,
  with a preceding `MenuSeparator` and z-order icon geometries.
- Keyboard: `Ctrl+]` Bring Forward, `Ctrl+[` Send Backward,
  `Ctrl+Shift+]` Bring to Front, `Ctrl+Shift+[` Send to Back — in the
  diagram's key handling, gated on a figure selection.

### §6 — Persistence

Add `zIndex?: number` to the `NodeVisual` record
(Mural `src/framework/diagram/serialization/node-visual-store.ts`):

- `NodeVisualStore.Read(node)` → `const z = Panel.GetZIndex(node); if (z !== 0) v.zIndex = z;`
  (omit at default so existing files and unmoved figures serialize unchanged).
- `NodeVisualStore.Apply(v, node)` → `if (v.zIndex !== undefined) Panel.SetZIndex(node, v.zIndex);`

A z-order command renumbers a parent's figures `0..n-1`, so after a reorder
most figures carry an explicit small `zIndex` (the bottom one stays 0 → omitted).
A `.diagram` with no `zIndex` fields loads exactly as today (every figure at Z 0
→ insertion order).

### §7 — Testing

Framework (`src/visual-engine/tests/`, `src/runtime/tests/`):
- Stable sort by ZIndex; equal Z keeps insertion order.
- `logicalChildren` order is unaffected by ZIndex.
- A child ZIndex change clears the sorted snapshot and invalidates the panel.
- Renderer DOM reconcile under jsdom: reordering by ZIndex moves the `<g>`;
  a correct-order render issues no DOM move.
- Markup: `Panel.ZIndex = 5` compiles and sets the attached property.

Diagram (`src/framework/diagram/tests/`):
- Each command's Z math (front/back/forward/backward), including multi-select
  relative-order preservation and `CanExecute` gating.
- `NodeVisual` round-trip: Z survives Read→Apply; a record without `zIndex`
  restores Z 0.

All test files live in a `tests/` subfolder next to the source (repo rule).

## Rollout / Versioning

- Mural gets a minor version bump (new public `Panel.ZIndex` API + diagram
  commands). Plexus bumps its Mural dependency floor and adds the menu/keys.
- Backward compatible: `.diagram` files without `zIndex` are unchanged;
  default Z 0 reproduces today's insertion-order behavior everywhere.

## Risks

- **Render hot path.** The reconcile runs in the walk's child loop. Mitigated
  by DOM-writing only on mismatch; correct-order renders stay allocation-free.
- **Listener lifecycle.** Per-child ZIndex listeners must be removed on detach
  to avoid leaks; covered by the Attach/Detach symmetry and a test.
- **ItemsControl interaction.** Only `visualChildren` sorts; `logicalChildren`
  and item-index mapping are untouched — asserted by a test.

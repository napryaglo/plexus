# P1 — Plexus `ArchNodeVM` (icon + label on the canvas) — Design

**Parent:** `../../../../Mural/docs/superpowers/specs/2026-08-10-unified-node-viewmodel-engine-design.md` (§3, stage P1).
**Depends on:** mural M1–M4 (the node view-model engine: `NodeViewModel` base, `[DataType]` DataTemplate resolution, the generic per-node serialize registry). Currently on the unpublished mural branch `feat/unified-node-viewmodel-engine` — see **Build prerequisite** below.

**Goal:** When a library term is dropped on an architecture diagram, the node renders the term's **icon + a real label** instead of a placeholder rectangle labelled with the entity id (e.g. "component2"). This is where the original "we need icon and label" ask lands.

## Background — what exists today (from the code map)

- **Drop → node.** `ArchInstanceDropFactory.apply()` (`.../architecture-projects/services/arch-instance-drop-factory.ts:43-63`) creates a `.todl` entity via `model.createInViewpoint(concept, vp)`, then materialises a mural **`Figure`** via `context.Mutator.CreateNode('rectangle', X, Y)` (a placeholder — term keys aren't in mural's shape catalog, so `CreateNode(termKey)` returns null) and sets `fig.Id = entity.id`.
- **The bug (two layers).** (1) The node is a generic rectangle (placeholder fallback). (2) The label is `displayLabel(entity)` = the entity's `label`/`name`, else the entity **id** ("component2") — `arch-diagram-binding.ts:27-39,71-75`. No icon is drawn on the canvas; icons appear only in toolbox tiles.
- **Icon infrastructure is complete but unused on canvas.** `TodlPresentationRegistry.iconKeyFor(entityKey) → resourceKey` and `resolveAsset(resourceKey)` (`.../diagram/services/todl-presentation-registry.ts:99-109`). The toolbox tile renders its icon via `ToolboxVisualPresenter[Context=VisualContext.Tile, Descriptor=$Descriptor]` (`diagram.resources.mu:256-284`), where `Descriptor` is a `ToolboxVisualDescriptor(TodlVisualResolverKey, key)` (`diagram-panel-services.ts:81-83`). `TodlVisualResolver.Resolve(descriptor, context)` already contemplates a **`VisualContext.Figure`** (canvas, ~32px) alongside `Tile` (`todl-visual-resolver.ts:26-35`). The resolver handles vector icons, bitmaps, and the fallback glyph uniformly.
- **Persistence.** The `.diagram` JSON (mural `DiagramStorage`, `file-diagram-storage.ts`) stores nodes by `Id` + position; entities persist separately in `.todl` (`arch-model.ts:88-93`). Positions live **only** in the `.diagram`. On open, mural recreates nodes with their `Id`s; `ArchDiagramBinding.rescan()` matches each node's `Id` to a live entity and syncs its label.
- **Mural consumption.** Plexus imports the **published** `@pragmatic-tech-ai/mural` (`package.json` `^0.3.4`) — no relative source imports. It registers `[DataType]` templates in `.mu` resources (`diagram.resources.mu`); there is **no** `ArchNodeVM` or arch node template today.

## Design

Every piece rides the M1–M4 engine: a view-model in `Nodes` → mural wraps it in a container Figure → resolves its `[DataType]` template.

### 1. `ArchNodeVM extends NodeViewModel` (new, in Plexus)

Carries the node's identity + view state:
- `EntityId` — the `.todl` entity id; equals the node's `Id` (from `NodeViewModel`).
- `Label: string` — the display label.
- `Descriptor: ToolboxVisualDescriptor` — the icon descriptor (`TodlVisualResolverKey` + the term/concept key), the SAME descriptor type the toolbox uses.

`Left/Top/Width/Height` come from `NodeViewModel`. `ArchNodeVM` is a pure view concern — the `.todl` entity is the source of truth; the VM's `Label`/`Descriptor` are derived (see §3).

### 2. Icon + label render — `[DataType=ArchNodeVM]` template

Reuse the toolbox's proven icon path so canvas nodes and toolbox tiles render identical visuals:

```
DataTemplate [DataType = ArchNodeVM] {
    // vertical stack (or grid): icon above, label below
    ToolboxVisualPresenter [ Descriptor = $Descriptor, Context = VisualContext.Figure, Width = …, Height = … ]
    TextBlock [ Text = $Label, … ]
}
```

`ToolboxVisualPresenter[Context=Figure]` routes through `TodlVisualResolver` → `iconKeyFor` → the icon (vector/bitmap/fallback glyph). No new icon-rendering code — the existing presenter + converters do it. The template lives in Plexus's diagram resources; `ArchNodeVM` is registered in Plexus's `.mu` compiler symbols like its other markup-facing types.

### 3. Drop factory builds an `ArchNodeVM`

`ArchInstanceDropFactory.apply()` (arch-instance-drop-factory.ts:52-59): after creating the entity, instead of `CreateNode('rectangle', …)`:
- build `new ArchNodeVM()` with `Id = entity.id`, `Descriptor = new ToolboxVisualDescriptor(TodlVisualResolverKey, conceptKey)` (the dropped `descriptorKey`, `'mm:'`-stripped consistently with `arch-drop-resolver.ts`), `Label = displayLabel(entity)`, placed at the drop `X/Y`;
- add it to the diagram's `Nodes` (mural wraps it in a container + resolves the `[DataType=ArchNodeVM]` template). Use the mutator's node-add path (the exact API — `Mutator.Nodes.Add` / an add method — is resolved in the plan against the mural `DiagramMutator` surface).
- `notifyChanged()` + `save()` as today.

The standalone-diagram fallback (no `ArchModel`) keeps its current `CreateNode` behaviour — P1 only changes the architecture-model path.

### 4. Binding derives label + icon (drop and reload)

`ArchDiagramBinding.rescan()` (arch-diagram-binding.ts:27-39) is the single authority for a node's derived view state. Extend it from "set `LabelText`" to, for each `ArchNodeVM` whose `Id` matches a live entity:
- `archVM.Label = displayLabel(entity)` (as today, on the VM instead of `Figure.LabelText`);
- `archVM.Descriptor = descriptorFor(entity)` — derive the icon descriptor from the entity's **concept/type** (the entity is an instance; its concept drives the icon). The exact ArchModel accessor for an instance's concept id is resolved in the plan; the descriptor is `new ToolboxVisualDescriptor(TodlVisualResolverKey, conceptKey)`.

On drop the factory sets initial `Label`/`Descriptor` (no flash); on reload `rescan()` re-derives both from scratch — so a reopened diagram shows icon + label with no persisted icon data.

### 5. Serialize — register an `arch` node serializer (mural M3 registry)

An `ArchNodeVM` in `Nodes` must round-trip its **id + position** (positions live only in the `.diagram`). Register an `arch` `NodeSerializer` via mural's per-node registry (the M3 mechanism — **no `DiagramDocument` edit**):
- `matches: node instanceof ArchNodeVM`;
- `serialize: {}` — the base record already carries `{id, left, top, w, h}`; icon/label are NOT serialized (they re-derive from the entity);
- `deserialize: new ArchNodeVM()` at the base bounds with `Id = base.id`; `Label`/`Descriptor` are left empty and filled by `rescan()` when the binding attaches on open.

Registration happens where Plexus wires its diagram services (module init), so the serializer is present before any diagram loads.

### 6. Registration summary

- `ArchNodeVM` class (Plexus, extends mural `NodeViewModel`).
- `[DataType=ArchNodeVM]` template in `diagram.resources.mu` (or the architecture-projects resources).
- `ArchNodeVM` in Plexus's `.mu` compiler symbol registration.
- `arch` serializer registered via mural's node-serializer registry at module init.

## Build prerequisite (sequencing)

P1 compiles against mural's M1–M4 API (`NodeViewModel`, `[DataType]` resolution, the node-serializer registry), which is on the unpublished mural branch. Before P1 **builds**, mural M4 must reach Plexus by one of:
- **Publish** mural `0.4.0` (M1–M4) + bump Plexus `@pragmatic-tech-ai/mural` → `^0.4.0` (durable, matches the established publish→bump pattern); or
- **Workspace-link** the local mural build into Plexus `node_modules` (faster dev loop, no premature publish).

This is a build-time decision (raised at plan/execution), not a design dependency. The design is stable either way.

## Testing

- **Drop:** dropping a library term on an architecture diagram adds an `ArchNodeVM` (not a `Figure`) with `Id = entity.id`, `Label = displayLabel(entity)`, and a `Descriptor` for the dropped concept.
- **Render:** the `[DataType=ArchNodeVM]` template materialises a `ToolboxVisualPresenter` (icon) + a `Label` `TextBlock` — assert the icon presenter resolves the concept's icon and the label shows the entity label (not a bare rectangle / entity id).
- **Fallback:** a term with no indexed icon renders the default glyph (via the existing converter fallback), not a crash/blank.
- **Round-trip:** save → load a diagram with an `ArchNodeVM` restores its id + position; after the binding attaches, `Label` + `Descriptor` re-derive from the entity (no icon/label persisted).
- **Live-smoke:** the actual "drop a technology/component" gesture now shows the term icon + a real label on the canvas (the original bug), and reopening the project restores them.

## Risks

- **Mural availability.** P1 can't build until M1–M4 reaches Plexus (publish or link). Gated explicitly above.
- **Instance → concept for the icon.** The drop has the concept key directly; reload must derive it from the entity instance. If the ArchModel doesn't expose an instance's concept cleanly, the binding needs a lookup (concept via `conforms`/type). Resolved in the plan against the ArchModel API; a wrong derivation shows the fallback glyph, not a crash.
- **Node-add API.** Adding a VM to `Nodes` must go through the mural mutator surface the diagram exposes (M4's `AddItemRequested`/`Nodes` path), not a Plexus reach-in. Confirm the public seam in the plan.
- **Container sizing.** The `ArchNodeVM` container size (icon + label) must be sensible by default (the VM's `Width/Height`), since arch nodes have no geometry to auto-size from. Pick a default in the VM/template.

## Out of scope

- Syncing an in-place **renamed** label back into the `.todl` entity model (a follow-up; the binding is currently entity → view only).
- Connectors between arch nodes as a distinct concern (they ride mural's existing connector engine, which already routes to VMs after M3).
- Changing entity persistence or the `.todl` model shape — P1 is a view/render concern keyed on the existing entity id.

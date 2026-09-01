# Toolbox Repository (Plexus adapters) — Design

**Date:** 2026-08-08
**Repo:** Plexus (`@pragmatic-tech-ai/plexus`, renderer)
**Status:** Design approved; ready for implementation plan.

This is **Spec B** — the Plexus half of the two-spec effort to unify toolbox
elements and their visuals. **Spec A**
(`Mural/docs/superpowers/specs/2026-08-08-toolbox-repository-mural.md`, merged to
mural `main`) built the generic framework foundation: `ToolboxRepository`,
`ToolboxPage`, `ToolboxItem`, `ToolboxVisualDescriptor`, the
`IToolboxVisualResolver` / `IToolboxDropFactory` protocols, the shared
`ToolboxVisualPresenter`, a built-in Shapes page, and the single
`TOOLBOX_ITEM_FORMAT` drag payload. Spec B supplies Plexus's concrete resolvers,
drop factory, and populator, and migrates Plexus's toolbox tiles, canvas nodes,
and library preview onto that foundation.

---

## Problem

Toolbox elements in Plexus come from three sources — built-in shapes, meta-model
taxonomy terms, and library classes — and three consumers each hand-roll the same
"carry a template + resolve it + subscribe to an upgrade signal + present it"
pattern: the canvas node (`InstanceNodeVM` + `ArchDiagramDocument`), the library
preview (`LibrariesPanelService`), and the toolbox tile (`TermTile`). They
drifted. The canvas node and the preview resolve and render an element's visual
correctly, but the toolbox tile (`[DataType=TermTile]`) renders only its
`$Display` text label and silently drops the resolved `$Template` — so library
toolbox tiles show no icons. The root cause is structural: N sources × M consumers
wired pair-by-pair, with the one real resolution authority (`LibraryRegistry`)
only knowing library classes.

Spec A removed the divergence at the framework level. Spec B removes it in Plexus:
every surface routes its visual through the one `ToolboxVisualPresenter`, so a
consumer that forgets to resolve/subscribe cannot exist — which is what actually
fixes the missing-icon bug.

## Goal

Migrate the entire Plexus toolbox onto the mural `ToolboxRepository` subsystem in
one cutover:

- Two Plexus visual resolvers (`LibraryClassVisualResolver`,
  `ConceptVisualResolver`) and one drop factory (`ArchInstanceDropFactory`),
  registered under typed `ServiceKey`s.
- `ToolboxService` becomes a *populator* that fills the mural `ToolboxRepository`
  from the published models and exposes it as `.Repository`; its Plexus-local
  palette types are deleted.
- The toolbox tile, the canvas node, and the library preview all mount
  `ToolboxVisualPresenter`.
- `TermTile`, `toolbox-term-template`, the Plexus-local `ToolboxPage`, the
  `[DataType=TermTile]` template, `InstanceNodeVM.Template` + its manual
  resolve/upgrade, and `LibrariesPanelService`'s manual `onChanged` subscription
  are all deleted.

## Global Constraints

- **Prerequisite (hard cutover).** Mural is bumped `0.2.9 → 0.3.0` and published
  to Verdaccio (`http://localhost:4873/`); Plexus's `@pragmatic-tech-ai/mural`
  dependency moves to `^0.3.0`. This is not optional and not gradual: Plexus does
  not compile against the new mural because it imports the deleted `ToolboxShape`
  and `TOOLBOX_NODE_KIND_FORMAT` from `@pragmatic-tech-ai/mural/framework` and reads
  the removed `DiagramWorkspaceService.ToolboxShapes`.
- **Enums, never string-literal unions.** Reuse mural's `VisualContext` enum. Any
  new fixed-set type is a real `enum`.
- **No string-keyed resolution.** Resolvers and the factory resolve through typed
  `ServiceKey`s from `Application.current.Services`, never a `kind`-string switch.
- **Every mounted Control has a default Style** (mural rule; `ToolboxVisualPresenter`
  already satisfies it — Plexus only consumes it).
- **Every test file lives in a `tests/` subfolder** next to the code it exercises
  (Plexus `vitest`, `src/**/*.test.ts`).
- **Descriptor is `{ ResolverKey, Key }` only.** Concept never rides along: the
  library resolver keys on the class id alone (`registry.resolve`'s `concept` arg
  is currently unused in resolution), and drop re-derives concept from the term id
  via `resolveTermDrop`.

---

## Key mechanism — one presenter, DataContext-driven

A canvas node binds instance-specific data (`$Display` and any node fields); a
toolbox tile and a library-preview row show a class-generic visual. Mural's
`ToolboxVisualPresenter` resolves a `Visual` from the descriptor alone — it has no
per-instance data slot. This is reconciled by **DataContext inheritance**, with no
change to the shipped mural interface, because a template's bindings are
**DataContext-relative**, not captured from the `Apply(data)` argument
(`content-presenter.ts` sets `DataContext` *after* `Apply` and documents the arg
as redundant; `data-template.ts` confirms bindings resolve against the produced
subtree's DataContext).

`ToolboxVisualPresenter` is a `ContentControl`; the resolved `Visual` it slots as
`Content` inherits the presenter's `DataContext` down the visual tree. Each surface
mounts the presenter with the right data object as its DataContext, and each such
object **exposes the fields the class template binds** — chiefly `Display`:

- **Toolbox tile** — DataContext = the `ToolboxItem`. Mural's base `ToolboxItem`
  carries `Label`, not `Display`, so Plexus items are a thin subclass
  (`ArchToolboxItem`) that also exposes `Display = the term label`.
- **Canvas node** — DataContext = the `InstanceNodeVM` (already has `Display`).
- **Library preview** — DataContext = the `LibraryTreeNode` (already has `Display`).

The resolver therefore **never pins DataContext**; it `Apply`s the class template
and lets it inherit. `VisualContext` varies only **size/chrome**: `Tile` → 48px,
non-hit-test; `Figure` → full node size, interactive. The mural `ShapeVisualResolver`
ignores DataContext entirely (its Figures are geometric). One presenter, one
mechanism, every surface.

---

## Components

### 1. `LibraryClassVisualResolver` (`IToolboxVisualResolver`)

`src/renderer/src/modules/diagram/services/library-class-visual-resolver.ts`,
registered under `LibraryClassVisualResolverKey: ServiceKey<IToolboxVisualResolver>`.

- Holds the `LibraryRegistry` (from the provider).
- `Resolve(descriptor, context)`:
  1. `const template = registry.resolve(descriptor.Key, '')` — the class's compiled
     template, baked presentation, or the registry's default box. (`resolve`'s
     second arg is ignored today; pass `''`.)
  2. `const visual = template.Apply({})` — the `Apply` arg is inconsequential
     (bindings are DataContext-relative, per the Key mechanism above). The
     presenter's inherited DataContext drives the bindings.
  3. Do **not** set `visual.DataContext` — it inherits from the presenter (the
     item / VM / preview node). Size/chrome per `context`: `Tile` → 48px,
     `IsHitTestVisible = false`; `Figure` → node default size.
  4. Return `visual`.
- `AddChangedListener(cb)` / `RemoveChangedListener(cb)`: bridge
  `registry.onChanged((classId) => cb(classId))` — when a class's real template
  finishes lazy-compiling, the presenter re-resolves and swaps in place. Store the
  registry-unsubscribe per `cb` so `RemoveChangedListener` tears it down.

### 2. `ConceptVisualResolver` (`IToolboxVisualResolver`)

`src/renderer/src/modules/diagram/services/concept-visual-resolver.ts`, registered
under `ConceptVisualResolverKey: ServiceKey<IToolboxVisualResolver>`.

- **Icon-based, populator-fed.** Meta-model concept terms carry an annotation-driven
  `icon` (an SVG string) from `projectToolbox`'s `ToolboxTermRef.icon`. The resolver
  holds an `id → icon` map filled by the populator (`Register(key, icon)`), and
  `Resolve(descriptor, context)` builds an `Icon` visual from the stored SVG
  (`parseSvgIcon` + `Icon`, the same primitives the canvas term-icon path uses),
  sized per `context`. No DataContext pinning (§ Key mechanism). When the key has
  no registered icon it returns a labelled default box.
- **Parity, not a new capability.** A reference-less canvas node's descriptor `Key`
  is a bare **concept id**, which the populator never registered (it registers
  taxonomy **term ids**) — so such a node resolves to the default box, exactly as
  today (concept-only instances render as the registry default box on the current
  canvas). Full `mm:<id>` presentation-template resolution for concept nodes is a
  future enhancement (needs the per-base meta-model presentation dictionary, which
  is not merged app-globally) and is out of scope.
- **Ready-now:** the icon is available at populate time, so `AddChangedListener` /
  `RemoveChangedListener` are no-ops and it never fires `changed` (mirrors mural's
  `ShapeVisualResolver`).

### 3. `ArchInstanceDropFactory` (`IToolboxDropFactory`)

`src/renderer/src/modules/architecture-projects/services/arch-instance-drop-factory.ts`,
registered under `ArchInstanceDropFactoryKey: ServiceKey<IToolboxDropFactory>`.

- `CreateDropped(ctx)`: `ctx.Mutator` is the open `ArchDiagramDocument`. Delegate
  to the existing `applyTermDrop(ctx.Mutator, ctx.Descriptor.Key, ctx.Position.X,
  ctx.Position.Y)` (createInstance + addRelationship + layout + `AddNode`).
- Return the created node (so the diagram selects it), or `null` when the drop is
  unresolved (`resolveTermDrop` finds no compatible concept).
- One factory serves both term kinds — drop is uniform because `resolveTermDrop`
  re-derives the concept from the term id via the model.

### 4. Populator — `ToolboxService` fills the repository

`src/renderer/src/modules/diagram/services/diagram-panel-services.ts`.

- `reload()` now:
  1. `const repo = Application.current.Services.getRequired(ToolboxRepository.Key)`.
  2. Remove the Plexus-contributed taxonomy pages it added on a prior reload
     (track their page ids; do **not** touch mural's built-in Shapes page).
  3. Scan published meta-models + libraries (as today), tracking **which backend**
     each model came from (`this.sourceBackends()` must yield an `isLibrary` flag
     per backend). `projectToolbox(doc)` each, dedupe terms by id. For each
     taxonomy: `repo.EnsurePage(taxId, taxLabel)`; for each term add an
     `ArchToolboxItem` (§ below) with `Id = "term:" + termId`, `Label`,
     `Display = label`, `Descriptor = new ToolboxVisualDescriptor(isLibrary ?
     LibraryClassVisualResolverKey : ConceptVisualResolverKey, termId)`,
     `FactoryKey = ArchInstanceDropFactoryKey`. For a **meta-model** term also call
     `conceptResolver.Register(termId, term.icon)` so its icon resolves. The
     source→ResolverKey choice is unambiguous from the backend flag.
- **`ArchToolboxItem extends ToolboxItem`** (mural base) — adds a `Display` DP (=
  the term label) so the class template's `$Display` binds through the tile
  presenter's inherited DataContext (§ Key mechanism). The base already carries
  `Id` / `Label` / `Descriptor` / `FactoryKey` / `BeginDragData`
  (`TOOLBOX_ITEM_FORMAT` = `Id`). Register the symbol for `.mu` if the tile template
  binds `$Display` on it (it does).
- `Pages` getter → `repo.Pages` (bind the panel to the repository).
- New `get Repository(): ToolboxRepository` → the mural singleton.
- The Shapes page is no longer built here; mural's `ensureToolboxDefaults`
  (invoked from the `Diagram` control's first init) provides it.
- Adapter + factory registration happens once at diagram-module load (or lazily in
  `reload()` guarded by `Services.has(...)`), against `Application.current.Services`.

### 5. Toolbox tile template

`src/renderer/src/modules/diagram/diagram.resources.mu`.

- Delete `[DataType=TermTile]` and its `import TermTile` / `import ToolboxPage`
  lines. Add `[DataType=ArchToolboxItem]`: a draggable `Border[IsDraggable=true,
  OnDragStart=$BeginDragData]` hosting `ToolboxVisualPresenter[Descriptor=
  $Descriptor, Context=Tile, Width=48, Height=48]`. `$BeginDragData` emits
  `TOOLBOX_ITEM_FORMAT` = the item `Id` (mural's `ToolboxItem` base provides it).
  `ToolboxVisualPresenter` / `ToolboxPage` are mural built-in symbols (Spec A
  registered them in mural's compiler symbol table), so they need no `.mu` import;
  `ArchToolboxItem` is a Plexus type and is imported like `ArchDiagramDocument`.
- **Presenter-only tile:** the tile hosts just the presenter — no separate `$Label`
  TextBlock. Library-class tiles show the class visual (which includes its label);
  mural **Shape** tiles show only the geometric figure (the `ShapeVisualResolver`
  renders no text). Losing the shape tiles' text caption is a minor, acceptable
  cosmetic change for v1 (a `ShapeVisualResolver` caption is a later mural
  enhancement, not part of this bump).
- The page/accordion templates rebind from the Plexus-local page type to mural's
  `ToolboxPage` (`$Title`, `$Items`). The Plexus-local `ToolboxPageKind` /
  `IsExpanded` accordion state has no analog on mural's `ToolboxPage`; the accordion
  behavior (`wireAccordion`) either moves to a small view-model wrapper per page or
  is dropped for v1 (all pages expanded). **Planning task:** pick one — preserve the
  accordion via a per-page expand flag carried outside mural's `ToolboxPage`, or
  ship v1 without single-expand. Default: drop single-expand for v1 (simplest;
  pages stack).

### 6. Canvas migration

`instance-node-vm.ts`, `arch-diagram-document.ts`,
`architecture-projects.resources.mu`.

- `InstanceNodeVM`: drop the `Template` DP and the `Data` self-ref DP. Add
  `Descriptor: ToolboxVisualDescriptor | undefined`, rebuilt in `refresh()` from
  `ReferencedTerm !== '' ? new ToolboxVisualDescriptor(LibraryClassVisualResolverKey,
  ReferencedTerm) : new ToolboxVisualDescriptor(ConceptVisualResolverKey, Concept)`
  — same keying as today's `ResolveTemplate` (referenced term wins, else concept).
- Node template `[DataType=InstanceNodeVM]` → `ToolboxVisualPresenter[Descriptor=
  $Descriptor, Context=Figure]`. The presenter's DataContext is the VM (inherited
  from the Diagram's item container), so `Figure`-context bindings resolve against
  the node.
- `ArchDiagramDocument`: delete `ResolveTemplate`, `upgradeTemplatesFor`, and its
  `registry.onChanged` subscription. The presenter owns resolve + subscribe +
  in-place upgrade. `AddNode` just materializes the VM (which computes its own
  `Descriptor`); `CreateNode`/`applyTermDrop` stay (used by the drop factory and
  programmatic callers). `registry` is still needed by the resolvers, not the doc.

### 7. Library preview migration

`libraries-panel-service.ts`, `library.resources.mu`.

- The preview pane's `[DataType=LibraryTreeNode]` hosts `ToolboxVisualPresenter[
  Descriptor=$Descriptor, Context=Tile]`, where a class node exposes a
  `Descriptor = new ToolboxVisualDescriptor(LibraryClassVisualResolverKey,
  node.TermId)` (computed when the node is built / selected).
- Delete the service's manual `registry.onChanged` subscription and its
  `node.Template` upgrade bookkeeping — the presenter handles the lazy upgrade.

### 8. Library tree drag → repo items

`library-tree-node.ts`, `library.resources.mu`.

The Libraries-panel tree is a second drag source onto the arch canvas. Post-bump
the canvas router accepts only `TOOLBOX_ITEM_FORMAT` = a repo item id. Scope the
tree drag to toolbox items (approved decision):

- `LibraryTreeNode` drops `TOOLBOX_NODE_KIND_FORMAT` (deleted in mural `0.3.0`).
  Replace `BeginKindDragData` with `BeginDragData` emitting `TOOLBOX_ITEM_FORMAT` =
  `"term:" + TermId` (the populator's item id for that class).
- A tree class that is **not** a toolbox item (`repo.ItemById("term:"+TermId) ===
  undefined`) is not droppable: gate the leaf's `IsDraggable` on repo membership
  (the leaf checks the repo, so non-taxonomy classes silently aren't draggable). No
  repo pollution, no second populator — aligned with the `annotate toolbox {
  visible }` opt-in contract.

### 9. Deletions (hard cutover)

- `toolbox-page.ts`'s `TermTile` class, the Plexus-local `ToolboxPage`, and
  `ToolboxPageKind` (replaced by mural's `ToolboxItem` / `ToolboxPage` +
  `ArchToolboxItem`). The file may be deleted outright if nothing else lives in it.
- `toolbox-term-template.ts` (`resolveTermTemplate`).
- `[DataType=TermTile]` markup template + its imports.
- `InstanceNodeVM.Template` + `InstanceNodeVM.Data` DPs; `ArchDiagramDocument`'s
  `ResolveTemplate` / `upgradeTemplatesFor` / `registry.onChanged`.
- `LibrariesPanelService`'s manual `onChanged` subscription + `Template` upgrade.
- Every `ToolboxShape` / `TOOLBOX_NODE_KIND_FORMAT` /
  `DiagramWorkspaceService.ToolboxShapes` reference in Plexus (they no longer exist
  in mural `0.3.0`) — includes the `buildShapesPage()` path in `ToolboxService` and
  the `LibraryTreeNode.BeginKindDragData` drag payload.

---

## Testing

Plexus `vitest`; every test file under a `tests/` subfolder.

- **`LibraryClassVisualResolver`** — a fake `LibraryRegistry` returning a probe
  template: `Resolve(desc, Tile)` and `Resolve(desc, Figure)` both apply the
  template and never set `DataContext` (it inherits from the presenter); `Tile`
  sets the root's `IsHitTestVisible = false` and `Figure` leaves it interactive
  (pixel size is the host template's job — the tile presenter is `48×48`).
  `AddChangedListener` wired to `registry.onChanged`: firing the registry's
  `onChanged(classId)` invokes the cb with that key; `RemoveChangedListener` tears
  down the registry subscription.
- **`ConceptVisualResolver`** — `Register(id, icon)` then `Resolve(desc, ctx)`
  builds an `Icon` from the SVG at the context size; an unregistered key returns the
  default box; `AddChangedListener` is a no-op and it never fires `changed`.
- **`ArchInstanceDropFactory`** — `CreateDropped` on a fake mutator calls
  `applyTermDrop` with the descriptor `Key` + offset-applied position and returns
  the created node; an unresolved term returns `null`.
- **Populator** — `reload()` against a stub backend + a real `ToolboxRepository`:
  builds one page per taxonomy, one item per deduped term, each stamped with the
  correct `ResolverKey` for its source (library vs meta-model) and
  `ArchInstanceDropFactoryKey`; a second `reload()` replaces the taxonomy pages
  without duplicating and without disturbing the Shapes page; `.Repository` returns
  the singleton.
- **Canvas node** — an `InstanceNodeVM` over a model with a reference edge computes
  a `LibraryClassVisualResolverKey` descriptor keyed on the referenced term; a
  reference-less node computes a `ConceptVisualResolverKey` descriptor keyed on the
  concept; editing the model refreshes the descriptor.
- **Presenter upgrade (integration net)** — mount a node/tile through
  `ToolboxVisualPresenter` with the library resolver over a fake registry that
  returns default-then-real on `onChanged`; assert the content swaps in place when
  the registry fires. This is the regression net whose absence allowed the original
  bug.
- **Preview** — selecting a class node sets a `LibraryClassVisualResolverKey`
  descriptor; the pane renders through the presenter and upgrades on `onChanged`.
- **Tree drag scoping** — a `LibraryTreeNode` whose class is a repo item emits
  `TOOLBOX_ITEM_FORMAT = "term:"+TermId` and is draggable; a class with no repo item
  is not draggable.

---

## Out of scope

- Any change to the mural framework beyond the `0.3.0` version bump + publish
  (Spec A shipped the framework; Spec B consumes it).
- Connectors / reference edges drawn on the canvas (still `.todl`-only, unchanged).
- A drop-target chooser when `resolveTermDrop` finds multiple compatible concepts
  (still first-pick, unchanged).

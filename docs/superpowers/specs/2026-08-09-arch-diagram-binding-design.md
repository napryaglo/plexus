# Arch Diagram Binding — Design (Sub-project 4a)

**Status:** Design. Plexus phase of the viewpoint-scoped multi-file architecture
model (parent: `docs/superpowers/specs/2026-08-09-viewpoint-multifile-architecture-model-design.md`,
§5 sub-project 4). Builds on SP3 (`ArchitectureModelService` + `ArchModel`).
SP4b (drop write-routing) and SP4c (new-diagram viewpoint picker + read-filter +
`{scene, arch}` persistence) consume this.

**Date:** 2026-08-09

## 1. Goal

When a `.diagram` opens inside an **architecture** project, bind its
already-placed nodes to the project's `ArchModel` entities and keep them in
sync with the model; retire the seeded demo canvas. This is the binding
**infrastructure** — no term-drop, no viewpoint picker, no file-format change
(those are SP4b/SP4c). In the live app an architecture diagram stays empty
until SP4b's drop lands; SP4a is exercised through hand-authored scenes in
tests and is the seam SP4b builds on.

## 2. Key facts (empirically verified)

- The `.diagram` file is a **plain-JSON** mural scene: `{ nodes: [...],
  connectors: [...], nextId }`. Each node: `{ id, kind, left, top, w, h, d,
  text: { content } }`.
- A mural `Figure` round-trips `Id`, `Kind`, `Left`, `Top`, and `LabelText`
  (= `Text.Content`) through `DiagramDocument.Save()`/`Load()`. `Id` set after
  `CreateNode` sticks.
- `DiagramDocument.Save()` re-emits exactly `{ nodes, connectors, nextId }` —
  it does **not** preserve unknown top-level keys. So a `{ scene, arch }`
  wrapper cannot be owned by the generic factory; SP4a therefore keeps the
  file as the bare scene and defers the wrapper to SP4c.
- `DocumentsContentHostService.OpenDocuments` is an app-level
  `ObservableCollection<IDocument>` broadcasting opened documents — the attach
  seam, requiring no change to the generic diagram module.

## 3. Node ↔ entity identity

A placed arch node is a `Figure` whose **`Figure.Id` is the model entity id**.
Because `Id` and position round-trip in the bare scene, placements persist with
no file-format change. Pure-visual freeform shapes are `Figure`s whose `Id`
matches no entity; they are ignored by the binding.

## 4. Components

### 4.1 `ArchDiagramBinding` (per opened doc + model)
`architecture-projects/services/arch-diagram-binding.ts`

```ts
class ArchDiagramBinding {
  constructor(doc: DiagramDocument, model: ArchModel)
  attach(): void        // bind current nodes + subscribe model.onChanged
  dispose(): void       // unsubscribe
}
```

- **attach():** for each `Figure` in `doc.Nodes` whose `Id` is a live entity id
  (`model.repository().resolve(id)` defined and instance-tier), sync its
  `LabelText` from the entity's display field via `displayLabel(entity)`
  (`label` → `name` → `id`). Then subscribe `model.onChanged`.
- **on model change (refresh):** re-sync bound `Figure` labels; and for any
  bound `Figure` whose entity no longer resolves, remove it via
  `doc.DeleteNodes([figure])`. Nodes whose `Id` matches no entity are left
  untouched (freeform shapes).
- **dispose():** call the disposer returned by `model.onChanged`.
- Helper `displayLabel(entity: Entity): string` — `entity.field('label') ??
  entity.field('name') ?? entity.id` (coerced to string).
- A `Figure` is identified among `doc.Nodes` by `node instanceof Figure`
  (skip `Group`).

SP4a does **not** re-resolve node visuals (`Kind`); the `Kind`/icon is owned by
whoever created the node (SP4b's drop). SP4a owns identity, label sync, and
orphan removal only.

### 4.2 `ArchDiagramBindingService` (app-scoped observer)
`architecture-projects/services/arch-diagram-binding-service.ts`

```ts
class ArchDiagramBindingService extends ServiceBase {
  static readonly Key: ServiceKey<ArchDiagramBindingService>
  // subscribes to DocumentsContentHostService.OpenDocuments in ctor
}
```

- Constructor subscribes to
  `host.OpenDocuments.Subscribe(...)` (host = `this.Provider.get(
  DocumentsContentHostService.Key)`; guarded `?.` like `WorkspaceBaseResolver`).
- On each change, diff `OpenDocuments` against a
  `Map<IDocument, ArchDiagramBinding>`:
  - **added** `IDocument` that is a `DiagramDocument` in an architecture
    project → build + `attach()` a binding, store it.
  - **removed** `IDocument` → `dispose()` its binding, drop from the map.
- **Owning-project resolution** `projectFor(doc): OpenProject | undefined`:
  `doc.Storage instanceof FileDiagramStorage` → its project `IStorage`;
  find the `OpenProject` in `ProjectExplorerService.OpenProjects` whose
  `Storage` is that same instance; require `op.Project.Type === 'architecture'`.
  (Expose the project `IStorage` from `FileDiagramStorage` via a getter if not
  already public.)
- **Model fetch:** `await this.Provider.getRequired(
  ArchitectureModelService.Key).modelFor(op)`, then attach. Attachment is async;
  a document removed before the model resolves is simply not attached (check the
  map/`OpenDocuments` membership after the await).
- Registered in `app.mu` `.services:` (eager, like `WorkspaceBaseResolver`), so
  it observes from startup.

### 4.3 Retire the seeded demo
`diagram/services/diagram-workspace-service.ts`

- Remove the `seed(doc)` sample-shape injection (rectangle/ellipse/squircle/
  flower/heart + connectors) and its call site, so no demo shapes are created.
  If `DiagramWorkspaceService` exists only to seed the demo, remove the service
  and its registration; if it has other responsibilities, drop only `seed()`
  and its invocation. Verify no remaining references to the removed member.

## 5. Data flow

```
DocumentsContentHostService.OpenDocuments  ──(added DiagramDocument)──►
  ArchDiagramBindingService.projectFor(doc)  ──architecture?──►
    ArchitectureModelService.modelFor(op) ──► ArchModel
      new ArchDiagramBinding(doc, model).attach()
        doc.Nodes[Figure].Id === entity.id  ──► LabelText = displayLabel(entity)
        model.onChanged ──► re-sync labels / remove orphaned Figures
  OpenDocuments (removed doc) ──► binding.dispose()
```

## 6. Testing

Unit tests, each in a `tests/` subfolder.

- **`arch-diagram-binding.test.ts`** — build an `ArchModel` (meta-model base +
  entities `web`/`host`, as in the SP3 fixtures); `new DiagramDocument()`;
  `CreateNode('rectangle', 0, 0)` and set its `.Id = 'web'`; add a second node
  with `.Id = 'ghost'` (no entity) and a third with `.Id = 'host'`. Attach the
  binding. Assert: the `web`/`host` figures' `LabelText` equals
  `displayLabel(entity)`; the `ghost` figure is untouched. Then
  `model.setField('web', 'label', 'Web App')` → the `web` figure's `LabelText`
  updates. Then `model.remove('host')` → the `host` figure is gone from
  `doc.Nodes`, the `ghost` figure remains. `dispose()` then
  `model.setField('web','label','X')` → no further change.
- **`arch-diagram-binding-service.test.ts`** — a fake
  `DocumentsContentHostService` exposing an `OpenDocuments`
  `ObservableCollection<IDocument>`; a `ServiceProvider` with instances for
  `DocumentsContentHostService.Key`, `ProjectExplorerService.Key` (fake with an
  `OpenProjects` collection containing one architecture `OpenProject` whose
  `Storage` backs the doc), and `ArchitectureModelService.Key` (returns a
  prebuilt `ArchModel`). Add a `DiagramDocument` (over a `FileDiagramStorage`
  on that project storage) with a `Figure` `Id='web'` to `OpenDocuments` →
  after the microtask, the figure's `LabelText` is synced (proves attach).
  Remove the document → a subsequent `model.setField` does not change the
  detached figure (proves dispose). A `DiagramDocument` whose storage maps to a
  non-architecture project is not attached.
- **Demo retirement** — a light assertion/compile check that
  `DiagramWorkspaceService` no longer seeds shapes (e.g. a freshly built
  document/service has empty `Nodes`), or removal leaves the suite green.

## 7. Constraints

- `@pragmatic-tech-ai/todl@^0.23.0`; import `DiagramDocument`, `Figure`,
  `DocumentsContentHostService`, `type IDocument` from
  `@pragmatic-tech-ai/mural/framework`; `ServiceBase`/`ServiceKey`/
  `ObservableCollection` from `@pragmatic-tech-ai/mural/runtime`; `Entity` from
  `@pragmatic-tech-ai/todl`.
- Real enums; every test in a `tests/` subfolder; no relative `../src` mural
  imports.
- The generic `DiagramDocument`/`DiagramDocumentFactory` are not modified — the
  binding is a pure external observer, so a standalone diagram is unaffected.

## 8. Out of scope (SP4b / SP4c)

- **SP4b:** term-drop → `ArchModel.create` + viewpoint→home-file routing
  (create the conforming file if missing; first-selected-viewpoint rule);
  materializing the dropped entity as a bound `Figure` with its resolved
  visual.
- **SP4c:** new-diagram viewpoint picker; persisting selected viewpoints via a
  `{ scene, arch }` file wrapper; real read-filtering (bind/show only entities
  framed by the selected viewpoints); per-document-close cleanup refinement.

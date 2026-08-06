# Meta-model Entity Drawer — Design

**Date:** 2026-07-31
**Status:** ✅ Finished
**Umbrella:** Meta-model presentation. Sub-project A (publish the presentation
payload to the backend) shipped 2026-07-30. This spec covers sub-projects **B**
(runtime presentation loader + `MetaModelEntity`) and **C** (double-click →
drawer → render), combined into one cycle because B is dead code without C.

## Goal

Double-clicking an ontology-entity row in the Meta-models tree opens a Modal
drawer that renders the entity through its published `mm:<id>` presentation
template (as a header) above an attribute/field detail view.

## Background — why it doesn't work today

The umbrella was decomposed A/B/C; only A was built. A published, per model
version, a `presentation/presentation.generated.mu` dictionary (one
`DataTemplate x:key="mm:<id>" [DataType = MetaModelEntity]` per ontology entity),
its author overrides, and the referenced icon SVGs into the meta-models backend
under `<id>/<version>/presentation/`.

Nothing consumes that payload. The tree's Entity rows carry only `Label` (no
entity identity), there is no double-click hook, no `MetaModelEntity` type, and
no drawer. So the requested double-click behaviour has never existed.

## Decisions (from brainstorming)

- **Drawer content:** the `mm:<id>` template as a header, **plus** an attribute
  detail view — not the template alone.
- **Attribute scope:** resolve the entity's **fields** (via `HasField` edges),
  not just the entity node's own `attrs`. In this model a concept's own `attrs`
  are often empty (`application` → `attrs: {}`); the substance lives in separate
  `field` nodes linked by `{kind:"HasField", from:<conceptId>, to:<fieldId>}`,
  each field carrying `{name, type, cardinality}`.
- **One combined spec** for B + C.

## Global Constraints

- **mural version floor:** the double-click hook ships in a new mural release
  (`0.1.57`); Plexus depends on `^0.1.57`.
- **Enums over string-literal unions** (TS): any fixed value set is a real
  `enum`.
- **Tests in `tests/` subfolders** next to the code, in both repos.
- **Render through templates only:** every visible drawer element flows through a
  `DataTemplate`/`Style`/`Binding` in `.mu`. The service composes **no** visuals
  — it only fills DPs. The one allowed exception is `entity.Presentation`, which
  holds the *result* of applying the loaded `mm:<id>` `DataTemplate` (itself a
  template), hosted by a `ContentControl` in markup.
- Commit messages end with the `Co-Authored-By: Claude Opus 4.8` trailer.

## Architecture & data flow

Trigger → load → render, all driven off `MetaModelsService`:

1. **Double-click** an entity row. mural's `TreeView` fires a new `OnActivate()`
   data hook on the row's data item — the exact sibling of the existing
   `OnExpand()` hook — gated on `args.IsDoubleClick`.
2. The Entity `MetaModelTreeNode` (now carrying an `EntityRef`) responds by
   invoking an injected `activate(ref)` callback the tree-builder wired to the
   service. Non-entity nodes have no ref and no-op.
3. **Sub-project B** resolves the payload:
   - **Presentation loader** reads the published `.mu`, `instantiate()`s it into
     a live `ResourceDictionary` (with `MetaModelEntity` in ctx and an
     include-resolver feeding the sibling SVGs). Cached per `(modelId, version)`.
   - **Entity builder** builds a `MetaModelEntity` from `model.json`, resolving
     `Fields` via `HasField` edges.
4. **Sub-project C** finishes: the service resolves `mm:<id>` from the loaded
   dictionary, applies it against the entity (→ `entity.Presentation`), sets
   `DrawerEntity` and flips `IsDrawerOpen = true`. The Modal `SideSheet`'s scrim
   / close button dismiss it (two-way `IsOpen`).

**Seams:** loader and entity-builder are pure functions over `IStorage` + the
parsed doc — no view, independently testable. The drawer is a `SideSheet`
declared in the panel template, bound to two service DPs. The sole mural change
is the `OnActivate` hook.

## Components

### Sub-project B (Plexus)

**`services/meta-model-entity.ts` (create).**
- `MetaModelEntity extends Model` with DPs: `Id: string`, `TypeOf: string`,
  `Label: string`, `Attrs: Record<string, unknown>`, `Fields:
  ObservableCollection<MetaModelField>`, `Presentation: Visual | undefined`
  (filled by the service with the applied `mm:<id>` template; `undefined` when
  the presentation is unavailable).
- `MetaModelField extends Model` with DPs `Name: string`, `Type: string`,
  `Cardinality: number` (bindable so the field item template resolves).
- Exported: it is both the `instantiate` ctx symbol and the detail template's
  `DataType`.

**`services/meta-model-entity-builder.ts` (create).**
- `buildEntity(doc: TodlDocument, entityId: string): MetaModelEntity`.
- Own attrs from the entity node; `Label = attrs.label ?? humanize(id)` (reuse
  the presentation-generator helper).
- `Fields`: for each edge `kind === 'HasField' && from === entityId`, look up the
  `to` field node and map `{ Name: attrs.name, Type: attrs.type, Cardinality:
  attrs.cardinality }`, in edge order. Missing target node → skip.
- Pure; no I/O.

**`services/presentation-loader.ts` (create).**
- `loadPresentation(storage: IStorage, base: string): Promise<ResourceDictionary>`
  where `base = "<modelId>/<version>"`.
- Reads `<base>/presentation/presentation.generated.mu`; `instantiate()`s it with
  `{ MetaModelEntity }` in ctx and a `CompilerOptions` include-resolver that
  reads each `include`d SVG from `<base>/presentation/<path>` via `storage`.
- Returns the built `ResourceDictionary`. Throws on read/instantiate failure
  (the service catches). Author overrides already `merge` into the generated
  source, so loading the generated file is sufficient.

### Sub-project C

**mural `framework/list/tree-view.ts` (modify).**
- Add an `OnActivate()` data hook mirroring `OnExpand()`: when a row's
  `ClickableRow` receives a click whose `args.IsDoubleClick` is true, read the
  row's data item and call `data.OnActivate?.()`. Add `OnActivate?()` to the
  `ExpandableTreeData` interface (rename to a broader `TreeRowData` or add a
  sibling interface — plan decides). Idempotency is the data item's concern.
- Publish `0.1.57`; bump Plexus to `^0.1.57`.

**`services/meta-model-tree-node.ts` (modify).**
- `EntityRef { modelId: string; version: string; id: string }`.
- Entity leaves gain an optional `ref` + an optional `activate:(ref) => void`
  callback; `OnActivate()` calls `activate(ref)` when both are set (guarded).
- A new `static entity(label, ref, activate)` factory (or extend `leaf`); Group /
  Version / Model nodes keep no ref.

**`services/meta-model-tree-builder.ts` (modify).**
- `loadVersionEntities` and `buildCatalog` thread `modelId` + `version` and, for
  each entity, its `id`, building `EntityRef`s and wiring the `activate` callback
  passed down from the service.

**`services/meta-models-service.ts` (modify).**
- DPs: `DrawerEntity: MetaModelEntity | undefined`, `IsDrawerOpen: boolean`.
- `openEntity(ref: EntityRef)`: load-or-cache the dictionary for
  `(ref.modelId, ref.version)`; read that version's `model.json`; `buildEntity`;
  resolve `mm:<ref.id>` from the dictionary and `Apply(entity)` → set
  `entity.Presentation`; set `DrawerEntity = entity`, `IsDrawerOpen = true`.
- On load/resolve failure: leave `Presentation` undefined and still open (the
  template shows a "presentation unavailable" note).
- Dictionary cache: `Map<string, ResourceDictionary>` keyed `modelId@version`,
  cleared in `reload()`.
- Pass its `openEntity` as the `activate` callback into `buildCatalog`.

**`meta-model.resources.mu` (modify).**
- Add a Modal `SideSheet [ Variant = Modal, IsOpen = $IsDrawerOpen, Title = …,
  Content = $DrawerEntity, ContentTemplate = @MetaModelEntityDetail ]` into the
  panel's `DataTemplate [DataType = MetaModelsService]`.
- `DataTemplate x:key="MetaModelEntityDetail" [ DataType = MetaModelEntity ]`:
  a `ContentControl [ Content = $Presentation ]` (the header), an
  `ItemsControl [ ItemsSource = $Fields ]` with an item template rendering
  `name : type`, and the own-attrs list. Empty-`Presentation` fallback text.

## Error handling

- Presentation load / instantiate failure, or `mm:<id>` absent → open the drawer
  with `Presentation` undefined; the detail template renders the fields/attrs and
  a "presentation unavailable" line. No crash.
- Double-click on a non-entity row → no-op (no `ref`).
- Published model versions are immutable, so the per-version dictionary cache
  never goes stale within a session; `reload()` clears it defensively.

## Testing

**B**
- `buildEntity`: fields resolved from `HasField` edges in order; a concept with
  empty own `attrs` still yields its fields; missing field target skipped;
  `Label` falls back to `humanize(id)`.
- `loadPresentation`: instantiated dictionary resolves `mm:<id>` to a
  `DataTemplate`; include-resolver supplies an SVG geometry; read failure throws.

**C**
- `meta-model-tree-node`: an Entity node with `ref` + `activate` calls
  `activate(ref)` on `OnActivate()`; a Group node does nothing.
- `meta-models-service`: `openEntity` sets `DrawerEntity` + `IsDrawerOpen`, fills
  `Presentation` on success, and degrades (open, `Presentation` undefined) on
  loader failure; cache hit avoids a second load.
- mural: a data-bound row double-click fires the data item's `OnActivate()`; a
  single click does not.

All test files live in `tests/` subfolders.

## File layout summary

**Plexus — create:** `services/meta-model-entity.ts`,
`services/meta-model-entity-builder.ts`, `services/presentation-loader.ts`
(+ their `tests/`).
**Plexus — modify:** `services/meta-model-tree-node.ts`,
`services/meta-model-tree-builder.ts`, `services/meta-models-service.ts`,
`meta-model.resources.mu`, `package.json` (mural `^0.1.57`).
**mural — modify:** `framework/list/tree-view.ts` (+ `tests/`), `package.json`
(`0.1.57`); publish to Verdaccio.

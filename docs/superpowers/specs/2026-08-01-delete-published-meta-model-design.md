# Delete Published Meta-Model Design

**Status:** design complete, pending user review
**Target:** Plexus (renderer, meta-model module)
**Date:** 2026-08-01

## 1. Goal

Add a context-menu **Delete** action to the Meta-models panel, mirroring the
existing "delete published library" command. A user right-clicks a published
meta-model in the tree and removes it from the local meta-models store. Delete
acts at two levels:

- a **Version** node (`<id>/<version>`) removes that one published copy;
- a **Model** node (`<id>`) removes every version of that meta-model.

Because a meta-model has downstream dependents (installed libraries bind to it),
the confirm dialog **warns** when installed libraries depend on the target.

## 2. Pattern mirrored

The library flow (`library` module) is the template:
- `LibraryRegistry.delete(id, version)` → `backend.Delete(\`${id}/${version}\`)`.
- `LibraryTreeNode` carries `LibId`/`LibVersion` + a `DeleteCommand` property.
- `LibrariesPanelService.deleteLibrary(node)` shows a `ConfirmDialogModel` (skips
  it headless when no `DialogService`), deletes, then `Reload()`.
- `library.resources.mu` defines a `ContextMenu` and attaches it via
  `when ( $IsLibrary = true ) { ContextMenuService.ContextMenu = @… }`.

The meta-models backend (`ensureMetaModelsBackend`) is the same `IStorage`; its
`Delete(path)` is a recursive `rm` (removes the whole folder).

## 3. Locked decisions

- **Two levels:** Version node → delete `<id>/<version>`; Model node → delete the
  whole `<id>` (all versions). Group/Entity nodes get no menu.
- **Dependents warning, library-scoped.** Installed libraries are centrally
  scannable (the libraries backend + each `library.json`'s `metaModel: {id,
  version}`), so the confirm dialog lists dependent libraries. **Architecture
  projects are arbitrary on-disk projects with no central index and are NOT
  scanned**; the confirm text notes this generically. The delete always proceeds
  after confirm (no block/cascade), like libraries.
- **Empty-id cleanup.** After a version delete that leaves the `<id>` folder with
  no remaining versions, the now-empty `<id>` folder is removed too.
- **No diagnostics slice to clear** (unlike libraries, which clear
  `library:${id}@${version}`) — meta-models keep no per-published diagnostics slice.
- **Accepted coupling:** the meta-model delete queries the library store for
  dependents (a meta-model → library import). The reverse (library → meta-model)
  already exists. The scan degrades to `[]` if the libraries store is unavailable.

## 4. Components

### A. `MetaModelTreeNode` — new properties

In `meta-model-tree-node.ts`, mirroring `LibraryTreeNode`:

```ts
static readonly ModelIdKey      = Model.RegisterProperty<string>(MetaModelTreeNode, 'ModelId', '', MetaData.None)
static readonly ModelVersionKey = Model.RegisterProperty<string>(MetaModelTreeNode, 'ModelVersion', '', MetaData.None)
static readonly DeleteCommandKey = Model.RegisterProperty<ICommand | undefined>(
    MetaModelTreeNode, 'DeleteCommand', undefined, MetaData.None)
```
plus getters/setters for `ModelId`, `ModelVersion`, `DeleteCommand`, and a getter:
```ts
get IsDeletable(): boolean { return this.Kind === MetaModelNodeKind.Model || this.Kind === MetaModelNodeKind.Version }
```

### B. `DeleteTarget` + `buildCatalog`

In `meta-model-tree-builder.ts`:

```ts
export interface DeleteTarget { id: string; version?: string }

export async function buildCatalog(
    storage: IStorage,
    activate: (ref: EntityRef) => void,
    onDelete: (target: DeleteTarget) => void,
): Promise<MetaModelTreeNode[]>
```

For each published id:
- the **Model** node gets `ModelId = p.id` and
  `DeleteCommand = new RelayCommand(() => onDelete({ id: p.id }))`;
- each **Version** node gets `ModelId = p.id`, `ModelVersion = version`, and
  `DeleteCommand = new RelayCommand(() => onDelete({ id: p.id, version }))`.

`RelayCommand` is imported into the builder (renderer code), consistent with how
`activate` already drives entity-node commands.

### C. `MetaModelsService` — delete + dependents scan

In `meta-models-service.ts`:

- `reload()` passes the callback:
  `buildCatalog(backend, (ref) => void this.openEntity(ref), (t) => void this.deleteTarget(t))`.

- `private async deleteTarget(target: DeleteTarget): Promise<void>`:
  1. `const deps = await this.dependentLibraries(target.id, target.version)`.
  2. If a `DialogService` is registered, show a `ConfirmDialogModel` (below); on
     `!== true`, return. Headless (no `DialogService`) proceeds.
  3. `const backend = ensureMetaModelsBackend(this.Provider)`;
     `const path = target.version !== undefined ? \`${target.id}/${target.version}\` : target.id`;
     `await backend.Delete(path)`.
  4. If `target.version !== undefined`, and
     `(await backend.List(target.id)).filter((e) => e.IsDirectory).length === 0`,
     then `await backend.Delete(target.id)` (empty-id cleanup).
  5. `await this.reload()`.

- `private async dependentLibraries(id: string, version?: string): Promise<string[]>`:
  ```ts
  try {
      const libs = await discoverLibraries(ensureLibrariesBackend(this.Provider))
      return libs
          .filter((l) => l.metaModel.id === id && (version === undefined || l.metaModel.version === version))
          .map((l) => l.name)
  } catch { return [] }
  ```

**Confirm message:**
- Version: `Delete meta-model "<id> <version>"? This removes the published copy.`
- Model: `Delete all <N> version(s) of meta-model "<id>"? This removes every published copy.`
  For a Model target the service lists `<id>` (`backend.List(id)` → directory
  entries) to get `<N>`, since `deleteTarget` receives only `{ id }`.
- If `deps.length > 0`, append:
  `\n\n<N> installed library(ies) bind to it: <names joined by ", ">. They'll fail
  to resolve until rebound. (Architecture projects that bind it aren't tracked here.)`

### D. View — `meta-model.resources.mu`

Add a context menu and attach it to deletable nodes:

```mu
ContextMenu x:key="MetaModelContextMenu" { MenuItem [ Header = "Delete", Command = $DeleteCommand ] }
```
Inside `MetaModelNodeTemplate`, after the row `StackPanel`:
```mu
when ( $IsDeletable = true ) { ContextMenuService.ContextMenu = @MetaModelContextMenu; }
```

## 5. Data flow

```
right-click Model/Version row → MenuItem "Delete" → $DeleteCommand (RelayCommand)
  → MetaModelsService.deleteTarget({ id, version? })
      → dependentLibraries(id, version?)  (scan libraries backend)
      → ConfirmDialogModel (with dependents warning)  [skipped headless]
      → backend.Delete(<id>/<version> | <id>)  + empty-id cleanup
      → reload()  → row disappears
```

## 6. Error handling

- **Dependents scan** — any failure (no libraries store, malformed manifest)
  yields `[]`; the delete still offers its base confirm.
- **Delete** — `IStorage.Delete` is `rm(force, recursive)`; a missing path is a
  no-op (force). Cleanup `List(id)` after a version delete is guarded by the
  version-delete branch only.
- **Headless** — with no `DialogService`, `deleteTarget` proceeds without a prompt
  (matches the library flow; keeps the service unit-testable).
- **Reload race** — `reload()` already guards with its `reloadSeq`; unchanged.

## 7. Testing

Vitest + `FakeStorage`, `tests/` subfolders:

- **`meta-model-tree-builder`** — `buildCatalog` over a FakeStorage with
  `a/1.0.0`, `a/1.1.0`, `b/1.0.0`: the Model node for `a` has `ModelId = 'a'` and a
  `DeleteCommand`; its Version nodes carry `ModelId`/`ModelVersion` and a
  `DeleteCommand`; invoking a Version node's command fires `onDelete({ id: 'a',
  version: '1.0.0' })`, and the Model node's fires `onDelete({ id: 'a' })`.
- **`meta-models-service`** (or a focused delete test) — with FakeStorage
  meta-models + libraries backends and no `DialogService`:
  - version delete removes `a/1.0.0` and leaves `a/1.1.0`;
  - version delete of the last version also removes the empty `a` folder;
  - model delete removes the whole `a` tree;
  - `dependentLibraries('a', '1.0.0')` returns the names of libraries whose
    `metaModel` is `a@1.0.0`, `dependentLibraries('a')` returns all bound to `a`
    (any version), and both return `[]` when none / the store is absent.

The `.mu` context menu is view wiring, unit-tested only through the node-property
+ command behavior (as the library menu is).

## 8. Out of scope

- Scanning on-disk **architecture** projects for meta-model bindings (no central
  index) — the warning covers installed libraries only.
- Any **block or cascade** — delete always proceeds after confirm.
- Undo / trash — deletion is immediate (mirrors libraries).

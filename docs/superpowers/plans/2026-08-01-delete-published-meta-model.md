# Delete Published Meta-Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A context-menu **Delete** on the Meta-models tree that removes a published meta-model — a Version node deletes `<id>/<version>`, a Model node deletes all versions — with a confirm dialog that warns about dependent installed libraries.

**Architecture:** Mirror the library-delete flow. `MetaModelTreeNode` gains `ModelId`/`ModelVersion`/`DeleteCommand`; `buildCatalog` wires each Model/Version node's `DeleteCommand` to an `onDelete` callback; `MetaModelsService.deleteTarget` scans dependent libraries, confirms, deletes the folder (recursive `IStorage.Delete`) with empty-id cleanup, and reloads; the `.mu` attaches the menu to deletable nodes.

**Tech Stack:** TypeScript (strict ESM), `@pragmatic-lab/mural` (`Model`/`RelayCommand`/`ICommand`, `DialogService`), `FakeStorage`, Vitest.

## Global Constraints

- Mirror the library delete: `ConfirmDialogModel(message, 'Delete', onClose)` + `dialogs.Show<boolean>({ Title, Content, Width })`; headless (no `DialogService`) skips the confirm and proceeds.
- **Two levels:** Version node → delete `<id>/<version>`; Model node → delete the whole `<id>`. `IsDeletable = Kind === Model || Kind === Version`.
- **Dependents warning is library-scoped** (installed libraries whose `library.json` `metaModel` matches). Architecture projects are NOT scanned (no central index); the confirm text says so. The delete always proceeds after confirm.
- **Empty-id cleanup:** after a version delete that leaves `<id>` with no versions, delete the `<id>` folder too.
- `IStorage.Delete(path)` is recursive (`rm(force, recursive)`); a missing path is a no-op.
- Every test file lives in a `tests/` subfolder (Vitest globs `src/**/*.test.ts`).
- Single file: `npx vitest run <path>`; whole suite: `npm test`; typecheck: `npm run typecheck`.
- `ICommand.Execute(parameter?)` / `CanExecute(parameter?)` (`node_modules/@pragmatic-lab/mural/dist/runtime/command.d.ts`).

## File Structure

- **Modify** `src/renderer/src/modules/meta-model/services/meta-model-tree-node.ts` — `ModelId`/`ModelVersion`/`DeleteCommand` + `IsDeletable`.
- **Modify** `src/renderer/src/modules/meta-model/services/meta-model-tree-builder.ts` — `DeleteTarget`, `buildCatalog(storage, activate, onDelete)`.
- **Modify** `src/renderer/src/modules/meta-model/services/meta-models-service.ts` — `deleteTarget` (public), `dependentLibraryNames` (exported), reload wiring.
- **Modify** `src/renderer/src/modules/meta-model/meta-model.resources.mu` — context menu + `when ($IsDeletable)` trigger.
- **Test** files alongside each in `tests/` subfolders.

---

### Task 1: `MetaModelTreeNode` — delete properties + `IsDeletable`

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/meta-model-tree-node.ts`
- Test: `src/renderer/src/modules/meta-model/services/tests/meta-model-tree-node.test.ts`

**Interfaces:**
- Produces: `MetaModelTreeNode` gains `ModelId: string`, `ModelVersion: string`, `DeleteCommand: ICommand | undefined` (get/set) and `get IsDeletable(): boolean`. Used by Tasks 2–4.

- [ ] **Step 1: Write the failing tests**

Append to `tests/meta-model-tree-node.test.ts` (add `RelayCommand` to the `@pragmatic-lab/mural/runtime` import, and `MetaModelNodeKind` if not present):

```ts
test('IsDeletable is true for Model and Version, false for Group and Entity', () => {
    expect(MetaModelTreeNode.leaf(MetaModelNodeKind.Model, 'a').IsDeletable).toBe(true)
    expect(MetaModelTreeNode.leaf(MetaModelNodeKind.Version, '1.0.0').IsDeletable).toBe(true)
    expect(MetaModelTreeNode.leaf(MetaModelNodeKind.Group, 'Concepts').IsDeletable).toBe(false)
    expect(MetaModelTreeNode.leaf(MetaModelNodeKind.Entity, 'x').IsDeletable).toBe(false)
})

test('ModelId / ModelVersion / DeleteCommand round-trip', () => {
    const n = MetaModelTreeNode.leaf(MetaModelNodeKind.Version, '1.0.0')
    n.ModelId = 'a'
    n.ModelVersion = '1.0.0'
    const cmd = new RelayCommand(() => {})
    n.DeleteCommand = cmd
    expect(n.ModelId).toBe('a')
    expect(n.ModelVersion).toBe('1.0.0')
    expect(n.DeleteCommand).toBe(cmd)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-tree-node.test.ts`
Expected: FAIL — `IsDeletable` / `ModelId` / `DeleteCommand` don't exist.

- [ ] **Step 3: Add the properties**

In `meta-model-tree-node.ts`, extend the runtime import to include the `ICommand` type:

```ts
import { MetaData, Model, ObservableCollection, type ICommand } from '@pragmatic-lab/mural/runtime'
```

Add these registered properties after `ChildrenKey`:

```ts
    // Delete wiring — set on Model and Version nodes by buildCatalog. ModelId is
    // the published id; ModelVersion is the version (empty on a Model node);
    // DeleteCommand removes the target (see MetaModelsService.deleteTarget).
    public static readonly ModelIdKey = Model.RegisterProperty<string>(
        MetaModelTreeNode, 'ModelId', '', MetaData.None)
    public static readonly ModelVersionKey = Model.RegisterProperty<string>(
        MetaModelTreeNode, 'ModelVersion', '', MetaData.None)
    public static readonly DeleteCommandKey = Model.RegisterProperty<ICommand | undefined>(
        MetaModelTreeNode, 'DeleteCommand', undefined, MetaData.None)
```

Add the accessors after the `Children` getter:

```ts
    public get ModelId(): string { return this.get_property_value(MetaModelTreeNode.ModelIdKey) }
    public set ModelId(v: string) { this.set_property_value(MetaModelTreeNode.ModelIdKey, v) }
    public get ModelVersion(): string { return this.get_property_value(MetaModelTreeNode.ModelVersionKey) }
    public set ModelVersion(v: string) { this.set_property_value(MetaModelTreeNode.ModelVersionKey, v) }
    public get DeleteCommand(): ICommand | undefined { return this.get_property_value(MetaModelTreeNode.DeleteCommandKey) }
    public set DeleteCommand(v: ICommand | undefined) { this.set_property_value(MetaModelTreeNode.DeleteCommandKey, v) }

    // Only Model (id) and Version (<id>/<version>) rows can be deleted; Group /
    // Entity rows get no context menu.
    public get IsDeletable(): boolean
    {
        return this.Kind === MetaModelNodeKind.Model || this.Kind === MetaModelNodeKind.Version
    }
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-tree-node.test.ts`
Expected: PASS (new tests + existing).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/meta-model-tree-node.ts \
        src/renderer/src/modules/meta-model/services/tests/meta-model-tree-node.test.ts
git commit -m "feat: MetaModelTreeNode delete properties + IsDeletable"
```

---

### Task 2: `buildCatalog` wires the delete commands

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/meta-model-tree-builder.ts`
- Test: `src/renderer/src/modules/meta-model/services/tests/meta-model-tree-builder.test.ts`

**Interfaces:**
- Consumes: `MetaModelTreeNode` delete props (Task 1); `RelayCommand`.
- Produces: `export interface DeleteTarget { id: string; version?: string }` and `buildCatalog(storage, activate, onDelete: (target: DeleteTarget) => void)`. Used by Task 3.

- [ ] **Step 1: Write the failing test**

Append to `tests/meta-model-tree-builder.test.ts` (imports it will need: `FakeStorage`, `buildCatalog`, `type DeleteTarget`):

```ts
test('buildCatalog wires ModelId/ModelVersion + DeleteCommand on Model and Version nodes', async () => {
    const store = new FakeStorage('fake://meta-models')
    await store.WriteText('a/1.0.0/model.json', '{"nodes":[],"edges":[]}')
    await store.WriteText('a/1.1.0/model.json', '{"nodes":[],"edges":[]}')
    await store.WriteText('b/1.0.0/model.json', '{"nodes":[],"edges":[]}')

    const calls: DeleteTarget[] = []
    const nodes = await buildCatalog(store, () => {}, (t) => calls.push(t))

    const a = nodes.find((n) => n.Label === 'a')!
    expect(a.ModelId).toBe('a')
    expect(a.DeleteCommand).toBeDefined()
    a.DeleteCommand!.Execute()
    expect(calls).toContainEqual({ id: 'a' })

    const v = a.Children.ToArray().find((c) => c.Label === '1.0.0')!
    expect(v.ModelId).toBe('a')
    expect(v.ModelVersion).toBe('1.0.0')
    expect(v.DeleteCommand).toBeDefined()
    v.DeleteCommand!.Execute()
    expect(calls).toContainEqual({ id: 'a', version: '1.0.0' })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-tree-builder.test.ts`
Expected: FAIL — `buildCatalog` takes 2 args / `DeleteTarget` unexported.

- [ ] **Step 3: Add `DeleteTarget`, extend `buildCatalog`**

In `meta-model-tree-builder.ts`, add the `RelayCommand` import:

```ts
import { RelayCommand } from '@pragmatic-lab/mural/runtime'
```

Add the interface (near `PublishedModel`):

```ts
// A delete request from a tree row: a whole model (id only) or one version.
export interface DeleteTarget { id: string; version?: string }
```

Replace `buildCatalog`:

```ts
export async function buildCatalog(
    storage: IStorage,
    activate: (ref: EntityRef) => void,
    onDelete: (target: DeleteTarget) => void,
): Promise<MetaModelTreeNode[]>
{
    const published = await scanPublishedModels(storage)
    return published.map((p) =>
    {
        const model = MetaModelTreeNode.leaf(MetaModelNodeKind.Model, p.id)
        model.ModelId = p.id
        model.DeleteCommand = new RelayCommand(() => onDelete({ id: p.id }))
        for (const version of p.versions)
        {
            const vnode = MetaModelTreeNode.lazy(
                MetaModelNodeKind.Version, version,
                () => loadVersionEntities(storage, p.id, version, activate),
            )
            vnode.ModelId = p.id
            vnode.ModelVersion = version
            vnode.DeleteCommand = new RelayCommand(() => onDelete({ id: p.id, version }))
            model.Children.Add(vnode)
        }
        return model
    })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-tree-builder.test.ts`
Expected: PASS (new test + existing).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/meta-model-tree-builder.ts \
        src/renderer/src/modules/meta-model/services/tests/meta-model-tree-builder.test.ts
git commit -m "feat: buildCatalog wires DeleteCommand on model + version nodes"
```

---

### Task 3: `MetaModelsService.deleteTarget` + dependents scan

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/meta-models-service.ts`
- Test: `src/renderer/src/modules/meta-model/services/tests/meta-models-service.test.ts`

**Interfaces:**
- Consumes: `buildCatalog` + `DeleteTarget` (Task 2); `ensureMetaModelsBackend`; `discoverLibraries` + `LoadedLibrary` (`../../library/services/library-loader.js`); `ensureLibrariesBackend` (`../../library/services/libraries-backend.js`); `ConfirmDialogModel`; `DialogService`.
- Produces: `export function dependentLibraryNames(libs, id, version?): string[]` and `public async deleteTarget(target: DeleteTarget): Promise<void>`; `reload()` passes the delete callback.

- [ ] **Step 1: Write the failing tests**

Append to `tests/meta-models-service.test.ts`. Provider seeds both backends (mirrors the libraries panel test's `providerWith`):

```ts
import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { META_MODELS_BACKEND_ID } from '../meta-models-backend.js'
import { LIBRARIES_BACKEND_ID } from '../../../library/services/libraries-backend.js'
import { dependentLibraryNames } from '../meta-models-service.js'
import type { LoadedLibrary } from '../../../library/services/library-loader.js'

function lib(id: string, mmId: string, mmVersion: string): LoadedLibrary {
    return { id, version: '0.1.0', name: id, metaModel: { id: mmId, version: mmVersion }, classes: [], problems: [] }
}

test('dependentLibraryNames filters by meta-model id and optional version', () => {
    const libs = [lib('l1', 'ea', '1.0.0'), lib('l2', 'ea', '2.0.0'), lib('l3', 'other', '1.0.0')]
    expect(dependentLibraryNames(libs, 'ea').sort()).toEqual(['l1', 'l2'])          // any version
    expect(dependentLibraryNames(libs, 'ea', '1.0.0')).toEqual(['l1'])              // exact version
    expect(dependentLibraryNames(libs, 'none')).toEqual([])
})

function providerWith(seed: (mm: FakeStorage) => void): { provider: ServiceProvider; mm: FakeStorage } {
    const provider = new ServiceProvider()
    const registry = new StorageProviderRegistry(provider)
    const mm = new FakeStorage('fake://meta-models')
    registry.Register(META_MODELS_BACKEND_ID, () => mm)
    registry.Register(LIBRARIES_BACKEND_ID, () => new FakeStorage('fake://libraries'))
    provider.registerInstance(StorageProviderRegistry.Key, registry)
    seed(mm)
    return { provider, mm }
}

test('deleteTarget removes one version and cleans an emptied id folder', async () => {
    const { provider, mm } = providerWith((s) => {
        void s.WriteText('a/1.0.0/model.json', '{"nodes":[],"edges":[]}')
        void s.WriteText('a/1.1.0/model.json', '{"nodes":[],"edges":[]}')
    })
    const svc = new MetaModelsService(provider)
    await svc.reload()

    await svc.deleteTarget({ id: 'a', version: '1.0.0' })
    expect(await mm.Exists('a/1.0.0')).toBe(false)
    expect(await mm.Exists('a/1.1.0')).toBe(true)      // sibling kept, id folder kept

    await svc.deleteTarget({ id: 'a', version: '1.1.0' })
    expect(await mm.Exists('a/1.1.0')).toBe(false)
    expect(await mm.Exists('a')).toBe(false)           // last version → id folder cleaned
})

test('deleteTarget removes a whole model (all versions)', async () => {
    const { provider, mm } = providerWith((s) => {
        void s.WriteText('a/1.0.0/model.json', '{"nodes":[],"edges":[]}')
        void s.WriteText('a/1.1.0/model.json', '{"nodes":[],"edges":[]}')
    })
    const svc = new MetaModelsService(provider)
    await svc.reload()

    await svc.deleteTarget({ id: 'a' })
    expect(await mm.Exists('a')).toBe(false)
    expect(svc.Nodes.Count).toBe(0)
})
```

(If the file already has its own `ServiceProvider`/`MetaModelsService` imports, reuse them rather than duplicating.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-models-service.test.ts`
Expected: FAIL — `dependentLibraryNames` / `deleteTarget` don't exist.

- [ ] **Step 3: Add imports**

In `meta-models-service.ts`, add:

```ts
import { RelayCommand } from '@pragmatic-lab/mural/runtime'
import { DialogService } from '@pragmatic-lab/mural/framework'

import type { IStorage } from '../../../services/storage/storage.js'
import { ConfirmDialogModel } from '../../../services/dialogs/confirm-dialog-model.js'
import { ensureLibrariesBackend } from '../../library/services/libraries-backend.js'
import { discoverLibraries, type LoadedLibrary } from '../../library/services/library-loader.js'
import { buildCatalog, type DeleteTarget } from './meta-model-tree-builder.js'
```

Note: the existing `import { buildCatalog } from './meta-model-tree-builder.js'` line is replaced by the one above (adds `DeleteTarget`). The existing `DialogService` note: `IActivatable` is already imported from `@pragmatic-lab/mural/framework`; add `DialogService` to that framework import instead of a second import line if you prefer. `RelayCommand` is unused by the service itself and may be omitted — it lives in the builder; do NOT add an unused import.

(Drop `RelayCommand` from this list — it is only used in `meta-model-tree-builder.ts`, Task 2.)

- [ ] **Step 4: Add the exported pure helper**

At the end of `meta-models-service.ts` (module scope):

```ts
// The names of installed libraries that bind the given meta-model — all versions
// when `version` is omitted, else the exact version. Pure over already-loaded
// libraries.
export function dependentLibraryNames(libs: readonly LoadedLibrary[], id: string, version?: string): string[]
{
    return libs
        .filter((l) => l.metaModel.id === id && (version === undefined || l.metaModel.version === version))
        .map((l) => l.name)
}
```

- [ ] **Step 5: Wire the delete callback in `reload()`**

In `reload()`, change the `buildCatalog` call:

```ts
        const built = await buildCatalog(
            backend,
            (ref) => { void this.openEntity(ref) },
            (t) => { void this.deleteTarget(t) },
        )
```

- [ ] **Step 6: Add `deleteTarget` + private helpers**

Add to the `MetaModelsService` class:

```ts
    // Delete a published meta-model — one version (`<id>/<version>`) or a whole id
    // (all versions). Warns in the confirm about installed libraries that bind it;
    // headless (no DialogService) proceeds. Cleans an emptied id folder, then
    // reloads so the row disappears.
    public async deleteTarget(target: DeleteTarget): Promise<void>
    {
        const backend = ensureMetaModelsBackend(this.Provider)
        const dialogs = this.Provider.get(DialogService.Key)
        if (dialogs !== undefined) {
            const deps = await this.dependentLibraries(target.id, target.version)
            const message = await this.confirmMessage(backend, target, deps)
            const vm = new ConfirmDialogModel(message, 'Delete', (r) => dialogs.Close(r))
            const ok = await dialogs.Show<boolean>({ Title: 'Delete Meta-Model', Content: vm, Width: 440 })
            if (ok !== true) return
        }

        const path = target.version !== undefined ? `${target.id}/${target.version}` : target.id
        await backend.Delete(path)
        if (target.version !== undefined) {
            const remaining = (await backend.List(target.id)).filter((e) => e.IsDirectory)
            if (remaining.length === 0) await backend.Delete(target.id)
        }
        await this.reload()
    }

    // Installed libraries bound to this meta-model, by name. Degrades to [] if the
    // libraries store is unavailable.
    private async dependentLibraries(id: string, version?: string): Promise<string[]>
    {
        try {
            const libs = await discoverLibraries(ensureLibrariesBackend(this.Provider))
            return dependentLibraryNames(libs, id, version)
        } catch { return [] }
    }

    private async confirmMessage(backend: IStorage, target: DeleteTarget, deps: string[]): Promise<string>
    {
        let base: string
        if (target.version !== undefined) {
            base = `Delete meta-model "${target.id} ${target.version}"? This removes the published copy.`
        } else {
            const n = (await backend.List(target.id)).filter((e) => e.IsDirectory).length
            base = `Delete all ${n} version(s) of meta-model "${target.id}"? This removes every published copy.`
        }
        if (deps.length === 0) return base
        return `${base}\n\n${deps.length} installed library(ies) bind to it: ${deps.join(', ')}. `
            + `They'll fail to resolve until rebound. (Architecture projects that bind it aren't tracked here.)`
    }
```

- [ ] **Step 7: Run to verify they pass**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-models-service.test.ts`
Expected: PASS (new tests + existing).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/meta-models-service.ts \
        src/renderer/src/modules/meta-model/services/tests/meta-models-service.test.ts
git commit -m "feat: MetaModelsService.deleteTarget + dependent-library warning"
```

---

### Task 4: Context menu in the panel view

**Files:**
- Modify: `src/renderer/src/modules/meta-model/meta-model.resources.mu`

**Interfaces:**
- Consumes: `$DeleteCommand` + `$IsDeletable` on `MetaModelTreeNode` (Task 1); the delete behavior (Task 3).

- [ ] **Step 1: Add the context menu resource**

In `meta-model.resources.mu`, near the top of the `resources { … }` block (beside the other keyed resources), add:

```mu
// Right-click menu for a published meta-model row: delete it. Attached only to
// Model / Version nodes (see the MetaModelNodeTemplate trigger). $DeleteCommand
// resolves against the row's MetaModelTreeNode DataContext.
ContextMenu x:key="MetaModelContextMenu" {
    MenuItem [ Header = "Delete", Command = $DeleteCommand ]
}
```

- [ ] **Step 2: Attach it to deletable rows**

In `MetaModelNodeTemplate`, after the row `StackPanel { … }` (as a sibling statement inside the template body, mirroring `library.resources.mu`'s `when ( $IsLibrary = true ) { … }`), add:

```mu
when ( $IsDeletable = true ) { ContextMenuService.ContextMenu = @MetaModelContextMenu; }
```

- [ ] **Step 3: Typecheck / build the renderer**

Run: `npm run typecheck`
Expected: clean. (The `.mu` is validated at instantiation; a syntax slip surfaces at build/runtime — the resource compiles as part of the module's dictionary.)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/modules/meta-model/meta-model.resources.mu
git commit -m "feat: Delete context menu on published meta-model rows"
```

---

### Task 5: Full-suite + typecheck verification + finish

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS — no regressions; the new node/builder/service tests pass. (The pre-existing suite is green as of the 0.5.0 migration.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean (node + web).

- [ ] **Step 3: Finish the branch**

Announce and use **superpowers:finishing-a-development-branch** to verify tests, present merge/PR/keep options (base `main`), and clean up.

---

## Self-Review

**Spec coverage:**
- §4.A `MetaModelTreeNode` ModelId/ModelVersion/DeleteCommand + IsDeletable → Task 1. ✓
- §4.B `DeleteTarget` + `buildCatalog(onDelete)` wiring Model + Version commands → Task 2. ✓
- §4.C `deleteTarget` (path, empty-id cleanup, reload), `dependentLibraries` + `dependentLibraryNames`, confirm message, reload wiring → Task 3. ✓
- §4.D `.mu` context menu + `when ($IsDeletable)` trigger → Task 4. ✓
- §3 dependents library-scoped + architecture note → Task 3 confirm message + `dependentLibraryNames`. ✓
- §3 empty-id cleanup → Task 3 Step 6. ✓
- §6 error handling (dependents scan → []; recursive/no-op Delete; headless proceeds) → Task 3 `dependentLibraries` try/catch + the `dialogs !== undefined` guard. ✓
- §7 testing (node props, builder wiring, deleteTarget behaviors, dependentLibraryNames) → Tasks 1–3. ✓

**Placeholder scan:** No TBD/TODO. Task 3 Step 3 explicitly flags the two easy import mistakes (unused `RelayCommand`; `DialogService` beside the existing framework import). The `.mu` steps anchor on existing template names (`MetaModelNodeTemplate`) since the file's line numbers aren't pinned. Every code step carries real code. ✓

**Type consistency:** `DeleteTarget { id: string; version?: string }` defined in Task 2, consumed identically in Tasks 2–3. `buildCatalog(storage, activate, onDelete)` 3-arg signature matches its only caller (`reload`, Task 3) and the Task 2 test. `dependentLibraryNames(libs, id, version?)` reused between Task 3's helper and its test. `ICommand`/`RelayCommand`/`DialogService`/`ConfirmDialogModel` imports match their real module paths (verified). `IsDeletable`/`ModelId`/`ModelVersion`/`DeleteCommand` names consistent across node, builder, `.mu`, and tests. ✓

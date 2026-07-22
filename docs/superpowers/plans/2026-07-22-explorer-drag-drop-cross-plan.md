# Project Explorer Cross-Project Drag-and-Drop (SP-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Dropping dragged node(s) onto another open project moves them there (cross-storage copy + delete), keeping any open tab re-pointed to the destination.

**Architecture:** Add `ReadBytes` to the storage seam; a `copyTree` cross-storage copy; an editor cross-storage relocate (keep-tab-open); an explorer `moveNodesAcross`; the behavior carries the source project in the DataObject.

**Tech Stack:** TypeScript (main + renderer), Electron IPC, mural drag-drop, Vitest.

## Global Constraints

- Every test file in a `tests/` subfolder next to its source.
- Real TS enums; no new string-literal union types.
- Commits authored `Eugene Napryaglo <evgen.napryaglo@gmail.com>`; message ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Do NOT stage `src/renderer/src/modules/ontologies/services/ontologies-service.ts`.
- `.mu.js` gitignored; the behavior file is already wired in the `.mu` (SP-1) — no `.mu` change.
- Verify from `Plexus/`: `npm test`, `npm run typecheck`.

---

## Task 0: Branch

- [ ] `git checkout -b explorer-drag-drop-cross` (spec committed to `main`).

---

## Task 1: `ReadBytes` across the storage seam

**Files:** `src/shared/file-system-api.ts`, `src/main/filesystem.ts`, `src/preload/index.ts`, `src/renderer/src/services/file-system/file-system-service.ts`, `src/renderer/src/services/storage/storage.ts`, `src/renderer/src/services/storage/local-file-storage.ts`, `src/renderer/src/services/storage/tests/fake-storage.ts`; tests: `tests/local-file-storage.test.ts`, `tests/fake-storage.ts` self-check via a new test file `tests/fake-storage-bytes.test.ts`.

**Interfaces:** Produces `IStorage.ReadBytes(path): Promise<Uint8Array>` end to end (mirrors `WriteBytes`).

- [ ] **Step 1: shared** — in `file-system-api.ts`, add the channel + the `IFileSystemApi` method (find the `writeBytes` line in the api interface and add `readBytes` beside it):

```ts
    ReadBytes     = 'fs:read-bytes',
```
```ts
    readBytes(path: string): Promise<Uint8Array>;
```

- [ ] **Step 2: main** — in `filesystem.ts`, add beside the `ReadText` handler (Buffer is a Uint8Array; Electron round-trips it):

```ts
  ipcMain.handle(
    FileSystemChannel.ReadBytes,
    async (_e, path: string): Promise<Uint8Array> => new Uint8Array(await readFile(path)),
  )
```

- [ ] **Step 3: preload** — beside `readText`:

```ts
  readBytes: (path: string): Promise<Uint8Array> =>
    ipcRenderer.invoke(FileSystemChannel.ReadBytes, path),
```

- [ ] **Step 4: FileSystemService** — beside `ReadText`:

```ts
    // Read raw bytes from a path — the binary-safe counterpart of ReadText.
    public ReadBytes(path: string): Promise<Uint8Array>
    {
        return this.api.readBytes(path);
    }
```

- [ ] **Step 5: IStorage** — in `storage.ts`, beside `WriteBytes`:

```ts
    // Read raw bytes — the binary-safe counterpart of ReadText, used to copy a
    // file across storages (its bytes may not be valid UTF-8).
    ReadBytes(path: string): Promise<Uint8Array>
```

- [ ] **Step 6: LocalFileStorage** — beside `WriteBytes`:

```ts
    public ReadBytes(path: string): Promise<Uint8Array>
    {
        return this.fs.ReadBytes(this.abs(path))
    }
```

- [ ] **Step 7: FakeStorage** — add `ReadBytes` (round-trips the latin1 string `WriteBytes`/`WriteText` store), and write a test:

```ts
    // Read stored content back as bytes (latin1 of the stored string; round-trips
    // WriteBytes exactly, and WriteText for ASCII — enough for the copy tests).
    public ReadBytes(path: string): Promise<Uint8Array>
    {
        const key = normalize(path)
        const value = this.files.get(key)
        if (value === undefined) return Promise.reject(new Error(`ENOENT: ${key}`))
        return Promise.resolve(Uint8Array.from(value, (c) => c.charCodeAt(0)))
    }
```

Test `tests/fake-storage-bytes.test.ts`:

```ts
import { test, expect } from 'vitest'
import { FakeStorage } from './fake-storage.js'

test('FakeStorage round-trips WriteBytes → ReadBytes', async () => {
    const s = new FakeStorage()
    await s.WriteBytes('a.bin', new Uint8Array([1, 2, 3, 250]))
    expect([...await s.ReadBytes('a.bin')]).toEqual([1, 2, 3, 250])
})

test('FakeStorage ReadBytes reads WriteText content as ASCII bytes', async () => {
    const s = new FakeStorage()
    await s.WriteText('a.txt', 'hi')
    expect([...await s.ReadBytes('a.txt')]).toEqual([104, 105])
})
```

- [ ] **Step 8:** Add a `LocalFileStorage.ReadBytes` delegation test to `tests/local-file-storage.test.ts` (the `stubFs` helper needs a `ReadBytes` entry — add `ReadBytes: (p) => { calls.push(['ReadBytes', p]); return Promise.resolve(new Uint8Array()) }` to the stub), then:

```ts
test('ReadBytes joins the path and delegates', async () => {
    const { fs, calls } = stubFs()
    await new LocalFileStorage('/root/proj', fs).ReadBytes('a/b.bin')
    expect(calls).toEqual([['ReadBytes', '/root/proj/a/b.bin']])
})
```

- [ ] **Step 9: Run — pass** (`npx vitest run src/renderer/src/services/storage/tests/`). Typecheck.

- [ ] **Step 10: Commit** `feat(storage): add ReadBytes across the seam (binary-safe read)`.

---

## Task 2: `copyTree` — cross-storage recursive copy

**Files:** Create `src/renderer/src/services/storage/copy-tree.ts`; test `tests/copy-tree.test.ts`.

**Interfaces:** Produces `copyTree(src: IStorage, srcPath: string, dst: IStorage, dstPath: string, isDirectory: boolean): Promise<void>`.

- [ ] **Step 1: Test:**

```ts
import { test, expect } from 'vitest'
import { FakeStorage } from './fake-storage.js'
import { copyTree } from '../copy-tree.js'

test('copies a single file across storages', async () => {
    const a = new FakeStorage('A'); const b = new FakeStorage('B')
    await a.WriteText('x.todl', 'hello')
    await copyTree(a, 'x.todl', b, 'sub/x.todl', false)
    expect(await b.ReadText('sub/x.todl')).toBe('hello')
})

test('copies a nested folder subtree across storages', async () => {
    const a = new FakeStorage('A'); const b = new FakeStorage('B')
    await a.WriteText('src/a.todl', 'A'); await a.WriteText('src/lib/b.todl', 'B')
    await copyTree(a, 'src', b, 'dst/src', true)
    expect(await b.ReadText('dst/src/a.todl')).toBe('A')
    expect(await b.ReadText('dst/src/lib/b.todl')).toBe('B')
})
```

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement `copy-tree.ts`:**

```ts
import type { IStorage } from './storage.js'

// Recursively copy a file or folder from one storage to another (paths are
// project-relative). A file copies binary-safe (ReadBytes → WriteBytes); a folder
// is created then each child recursed. The caller passes isDirectory (known from
// the ProjectNode kind), so no probing is needed.
export async function copyTree(src: IStorage, srcPath: string, dst: IStorage, dstPath: string, isDirectory: boolean): Promise<void>
{
    if (!isDirectory) {
        await dst.WriteBytes(dstPath, await src.ReadBytes(srcPath))
        return
    }
    await dst.CreateDirectory(dstPath)
    for (const entry of await src.List(srcPath)) {
        const from = srcPath === '' ? entry.Name : `${srcPath}/${entry.Name}`
        const to = dstPath === '' ? entry.Name : `${dstPath}/${entry.Name}`
        await copyTree(src, from, dst, to, entry.IsDirectory)
    }
}
```

- [ ] **Step 4: Run — pass.** Typecheck.

- [ ] **Step 5: Commit** `feat(storage): add copyTree (cross-storage recursive copy)`.

---

## Task 3: Editor cross-storage relocate (keep-tab-open)

**Files:** `code-file.ts`, `code-document.ts`, `services/documents/document-factory.ts`, `modules/meta-model/services/todl-document-factory.ts`, `services/todl/todl-validation-service.ts`; tests: `modules/code-editor/tests/code-document.test.ts` (create or extend), `services/todl/tests/todl-validation-service.test.ts` (extend).

**Interfaces:** Produces `StorageCodeFile.Retarget(id, storage?)`; `CodeDocument.RelocateTo(storage, path)`; `IRelocatableDocumentFactory.relocateAcrossStorage?`; `isRelocatableAcrossStorage`; `TodlValidationService.ReattachDocument(doc, storage)`.

- [ ] **Step 1: `StorageCodeFile`** — make `storage` mutable, widen `Retarget`:

```ts
    constructor(private storage: IStorage, public id: string) {}
    public read(): Promise<string> { return this.storage.ReadText(this.id) }
    public write(text: string): Promise<void> { return this.storage.WriteText(this.id, text) }
    // Re-point at a new path (in-place rename) and, when given, a new storage
    // (cross-project move); subsequent read/write use them.
    public Retarget(id: string, storage?: IStorage): void { this.id = id; if (storage !== undefined) this.storage = storage }
```

- [ ] **Step 2: `CodeDocument.RelocateTo`** — add beside `Relocate`, refactoring the identity refresh into a shared private:

```ts
    // Re-point at a new PATH after an in-place rename (same storage).
    public Relocate(newPath: string): void
    {
        (this.file as Partial<{ Retarget(id: string, storage?: unknown): void }>).Retarget?.(newPath)
        this.refreshIdentity(newPath)
    }

    // Re-point at a new STORAGE + path after a cross-project move; the tab stays
    // open (Content/dirty preserved) and now saves to the new project.
    public RelocateTo(storage: IStorage, newPath: string): void
    {
        (this.file as Partial<{ Retarget(id: string, storage?: IStorage): void }>).Retarget?.(newPath, storage)
        this.refreshIdentity(newPath)
    }

    private refreshIdentity(newPath: string): void
    {
        this.set_property_value(CodeDocument.IdKey, newPath)
        this.set_property_value(CodeDocument.TitleKey, fileName(newPath))
        this.set_property_value(CodeDocument.LanguageKey, languageForPath(newPath))
    }
```

Add the import `import type { IStorage } from '../../services/storage/storage.js'` to `code-document.ts`.

- [ ] **Step 3: factory seam** — in `document-factory.ts`, extend the relocatable interface + a guard:

```ts
export interface IRelocatableDocumentFactory
{
    relocateOpenFile(document: IDocument, newPath: string): void
    // Optional: re-point an open document at a DIFFERENT storage + path (a
    // cross-project move). Editors that can keep such a tab open implement it.
    relocateAcrossStorage?(document: IDocument, storage: IStorage, newPath: string): void
}

export function isRelocatableAcrossStorage(
    factory: IDocumentFactory,
): factory is IDocumentFactory & Required<Pick<IRelocatableDocumentFactory, 'relocateAcrossStorage'>>
{
    return typeof (factory as Partial<IRelocatableDocumentFactory>).relocateAcrossStorage === 'function'
}
```

(add `import type { IStorage } from '../storage/storage.js'`).

- [ ] **Step 4: `TodlDocumentFactory.relocateAcrossStorage`:**

```ts
    public relocateAcrossStorage(document: IDocument, storage: IStorage, newPath: string): void
    {
        (document as CodeDocument).RelocateTo(storage, newPath)
        this.Provider.get(TodlValidationService.Key)?.ReattachDocument(document as CodeDocument, storage)
    }
```

(add `import type { IStorage } from '../../../services/storage/storage.js'`).

- [ ] **Step 5: `TodlValidationService.ReattachDocument`** — re-key a tracked doc to a new storage:

```ts
    // Re-key a tracked document to a new project storage (after a cross-project
    // move) so it validates against the new project's bases. Keeps the Content
    // listener; schedules a revalidation pass.
    public ReattachDocument(doc: CodeDocument, storage: IStorage): void
    {
        const t = this.tracked.get(doc)
        if (t === undefined) { this.AttachDocument(doc, storage); return }
        this.tracked.set(doc, { storage, unhook: t.unhook })
        this.scheduleRevalidate()
    }
```

(`scheduleRevalidate` is private in the service — already exists; confirm the name.)

- [ ] **Step 6: Test** — `CodeDocument.RelocateTo` retargets storage + path (extend/create `modules/code-editor/tests/code-document.test.ts` with two `FakeStorage`s: seed content in A, open a `CodeDocument(new StorageCodeFile(A,'x.todl'))`, `RelocateTo(B,'sub/x.todl')`, set Content + `Save()`, assert B has it and `Id`/`Title` updated). Extend the validator test: a tracked doc `ReattachDocument(doc, storageB)` updates its group so the next `Revalidate` reads B's sources (assert via a base-binding difference or the doc's storage grouping). Run — fail → implement (done above) → pass.

- [ ] **Step 7: typecheck + targeted tests pass. Commit** `feat(code-editor): cross-storage relocate keeps a moved file's tab open`.

---

## Task 4: Explorer `moveNodesAcross` + routing

**Files:** `services/projects/node-move.ts` (planner flag), `modules/project-explorer/services/project-explorer-service.ts`; test: `project-explorer-service.test.ts` (extend) + `node-move.test.ts` (extend).

- [ ] **Step 1: planner flag** — `planNodeMoves(nodes, destParentPath, sameProject = true)`: when `sameProject` is false, skip the already-there + into-self/descendant checks (keep the ancestor-filter). Add a node-move test:

```ts
test('cross-project plan keeps ancestor-filter but skips same-project guards', () => {
    const plan = planNodeMoves([folder('src'), file('src/a.todl')], 'src', false)
    expect(plan.moves).toEqual([{ from: 'src', to: 'src/src', name: 'src' }])   // into a different project's 'src'
    expect(plan.rejects).toEqual([])
})
```

Implement: guard the two intra checks with `if (sameProject && …)`.

- [ ] **Step 2: explorer test** (two projects, two FakeStorages):

```ts
test('moveNodesAcross copies a file to the target storage and removes it from the source', async () => {
    const { priv } = makeExplorer()
    const a = new FakeStorage('C:/a'); await a.WriteText('x.todl', 'hi')
    const b = new FakeStorage('C:/b'); await b.CreateDirectory('src')
    const opA = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), a)
    const opB = await priv.addOpenProject(projectWith('B', 'C:/b'), fakeProjectFactory(), b)
    await priv.moveNodesAcross(opA, [new ProjectNode('x.todl', 'x.todl', 'todl')], opB, 'src')
    expect(await b.ReadText('src/x.todl')).toBe('hi')
    expect(await a.Exists('x.todl')).toBe(false)
})

test('moveNodesAcross skips a target collision, leaving source intact', async () => {
    const { priv, service } = makeExplorer()
    const a = new FakeStorage('C:/a'); await a.WriteText('x.todl', 'hi')
    const b = new FakeStorage('C:/b'); await b.WriteText('src/x.todl', 'other')
    const opA = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), a)
    const opB = await priv.addOpenProject(projectWith('B', 'C:/b'), fakeProjectFactory(), b)
    await priv.moveNodesAcross(opA, [new ProjectNode('x.todl', 'x.todl', 'todl')], opB, 'src')
    expect(await a.Exists('x.todl')).toBe(true)                 // not moved
    expect(await b.ReadText('src/x.todl')).toBe('other')        // untouched
    expect(service.Status).toMatch(/exist/i)
})
```

Add `moveNodesAcross` to the `ExplorerPrivates` interface.

- [ ] **Step 3: Run — fail. Implement** in `project-explorer-service.ts`:
  - Import `copyTree`, `isRelocatableAcrossStorage`.
  - `MoveArg` gains `source: OpenProject`. In `wireProjectCommands`, the `MoveNodesCommand` handler:

```ts
        op.MoveNodesCommand = new RelayCommand((arg) => {
            const a = arg as MoveArg
            if (a.source === op) void this.moveNodes(op, a.nodes, a.destPath)
            else void this.moveNodesAcross(a.source, a.nodes, op, a.destPath)
        })
```

  - `moveNodesAcross(source, nodes, target, destParentPath)`:

```ts
    private async moveNodesAcross(source: OpenProject, nodes: readonly ProjectNode[], target: OpenProject, destParentPath: string): Promise<void>
    {
        const { moves } = planNodeMoves(nodes, destParentPath, false)
        const collisions: string[] = []
        let moved = 0
        for (const m of moves) {
            if (await target.Storage.Exists(m.to)) { collisions.push(m.name); continue }
            const node = nodes.find((n) => n.Path === m.from)!
            await copyTree(source.Storage, m.from, target.Storage, m.to, node.Kind === 'folder')
            await source.Storage.Delete(m.from)
            this.repointMovedDocs(source, target, m.from, m.to)
            moved++
        }
        if (moved > 0) { await this.rescan(source); await this.rescan(target) }
        if (collisions.length === 0) { if (moved > 0) this.Status = `Moved ${moved} item(s) to ${target.Name}.`; return }
        this.Status = `Move to ${target.Name}: ${moved > 0 ? `moved ${moved}, ` : ''}${collisions.length} already exist.`
    }

    // Re-point every open doc that lived at (or under) fromPath in `source` to the
    // corresponding path under `toPath` in `target`: keep the tab open when its
    // editor supports a cross-storage relocate, else close it; reassign ownership.
    private repointMovedDocs(source: OpenProject, target: OpenProject, fromPath: string, toPath: string): void
    {
        for (const [doc, path] of [...this.docPaths]) {
            if (this.docOwners.get(doc) !== source) continue
            const moved = path === fromPath ? toPath
                : path.startsWith(fromPath + '/') ? toPath + path.slice(fromPath.length)
                    : undefined
            if (moved === undefined) continue
            const factory = this.resolveDocumentFactory(extname(moved))
            if (factory !== undefined && isRelocatableAcrossStorage(factory)) {
                factory.relocateAcrossStorage(doc, target.Storage, moved)
                this.docOwners.set(doc, target)
                this.docPaths.set(doc, moved)
            } else {
                this.host.Close(doc); this.docOwners.delete(doc); this.docPaths.delete(doc)
            }
        }
    }
```

- [ ] **Step 4: Run — pass. Typecheck. Commit** `feat(project-explorer): moveNodesAcross — cross-project move (copy+delete, keep tabs)`.

---

## Task 5: Behavior carries the source project

**Files:** `services/projects/tree-drag-drop-behavior.ts`.

- [ ] **Step 1:** Add a source format + carry the source op:

```ts
const NODES_FORMAT = 'plexus/project-nodes'
const SOURCE_FORMAT = 'plexus/project-source'
```

In `startDrag`, after building `data`:
```ts
        const op = this.ownerProject(source)
        // ... nodes ...
        data.Set(NODES_FORMAT, nodes)
        if (op !== undefined) data.Set(SOURCE_FORMAT, op)
        return { data, effects: DragDropEffects.Move }
```

In `drop`, read the source op and pass it (default to the target op for a same-project drag started elsewhere):
```ts
        const source = a.Data.Get<OpenProject>(SOURCE_FORMAT) ?? op
        op.MoveNodesCommand?.Execute({ nodes, destPath, source } satisfies MoveArg)
```

- [ ] **Step 2: compile:mu (no `.mu` change, but run to be safe), typecheck, full suite.** All green.

- [ ] **Step 3: Commit** `feat(project-explorer): drag carries its source project for cross-project drops`.

---

## Task 6: Finish the branch

- [ ] **Step 1: Gate** — `npm run typecheck && npm test` green; `git status` shows only `ontologies-service.ts` unstaged.
- [ ] **Step 2: Manual smoke note** — cross-project drag isn't unit-tested end to end: open two projects, drag a file from A onto B's folder → it appears in B, gone from A; if it was open, its tab stays open and now saves to B; a name clash in B is skipped with a status.
- [ ] **Step 3:** Invoke `superpowers:finishing-a-development-branch` (established pattern: merge to `main` + push).

---

## Self-Review Notes

- **Spec coverage:** unit 1 → Task 1; unit 2 → Task 2; unit 3 → Task 3; unit 4 → Task 4; unit 5 → Task 5.
- **Type consistency:** `ReadBytes(path): Promise<Uint8Array>` uniform across api/service/IStorage/impls; `copyTree(..., isDirectory)` matches both callers/tests; `RelocateTo(storage, path)` / `relocateAcrossStorage(doc, storage, path)` / `ReattachDocument(doc, storage)` align; `MoveArg { nodes, destPath, source }` constructed in the behavior, destructured in the handler; `planNodeMoves(nodes, dest, sameProject=true)` default keeps SP-1 callers unchanged.
- **Known risk:** the cross-project behavior path + keep-tab-open validator re-attach are only typecheck-verified; Task 6 flags the manual smoke. Confirm `scheduleRevalidate` is the actual private method name in the validator (Task 3 Step 5) — if it differs, use the real one.
- **No placeholders:** every code step is complete.
```

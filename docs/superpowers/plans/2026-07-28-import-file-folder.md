# Import File / Import Folder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Import File…" and "Import Folder…" commands that copy an existing OS file/folder into a project (into the project root from the project menu, or into a target folder from a node menu) and show it in the tree.

**Architecture:** Generalize the existing `addExistingFilesTo` into `importFilesInto(op, target)`, add a recursive `importFolderInto(op, target)` + `copyOsFolderInto` on `ProjectExplorerService` (using `FileSystemService.OpenFolder`/`ListDirectory`/`ReadBytes` to read the source and `IStorage.WriteBytes`/`CreateDirectory` to write), then surface both as commands on `OpenProject` (project menu → root) and `ProjectNode` (node menu → the node's container folder) via `.mu` context menus.

**Tech Stack:** TypeScript, mural runtime (`Model` DPs, `RelayCommand`), mural `.mu` templates, Electron renderer (Plexus), vitest, `FakeStorage` in-memory `IStorage`.

## Global Constraints

- Every test file lives in a `tests/` subfolder next to its source (repo rule).
- Collision handling: only the top-level imported name is made unique via `uniqueStorageName` (`foo` → `foo-2`); a folder's descendants keep their names under the renamed top.
- After a successful copy, refresh with the additive rescan `op.Adopt(await op.Factory.openProject(op.Storage))` + `this.wireNodes(op.Root, op)` — the same pattern New File / New Folder already use.
- Imported items are NOT auto-opened. Cancel (null pick) is a silent no-op. Errors set `this.Status = 'Import failed: …'`.
- Paths inside a project are project-relative POSIX; use `joinRel(dir, name)`. `basename(p)` already splits on both `\` and `/`, so it is safe on OS-native picked paths.
- Verify commands: `npx vitest run <file>` (tests), `npm run compile:mu` (`.mu` → `.mu.js`), `npm run typecheck`.
- **Commits are HELD** until the user explicitly asks. "Commit" steps below stage the work; do NOT actually commit unless told.

---

## File Structure

- `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts` — rename `addExistingFilesTo` → `importFilesInto(op, target)`; add `importFolderInto(op, target)` + `copyOsFolderInto`; wire project + node commands.
- `src/renderer/src/services/projects/open-project.ts` — rename `AddFileCommand` DP → `ImportFileCommand`; add `ImportFolderCommand` DP + accessors.
- `src/renderer/src/services/projects/project.ts` — add `ImportFileCommand` / `ImportFolderCommand` DPs + accessors on `ProjectNode`.
- `src/renderer/src/modules/project-explorer/project-explorer.resources.mu` — relabel + add the context-menu items.
- `src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts` — extend `fakeFs`; update existing import tests; add file-target, folder, collision, cancel, and command-wiring tests.

---

## Task 1: Generalize file import to a target folder

**Files:**
- Modify: `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts` (rename `addExistingFilesTo`; update its call site in `wireProjectCommands`)
- Test: `src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts`

**Interfaces:**
- Produces: `private importFilesInto(op: OpenProject, target = ''): Promise<void>` — replaces `addExistingFilesTo(op)`.

- [ ] **Step 1: Update the test `Priv` interface + existing call sites, add the target test**

In the test file, in `interface ExplorerPrivates`, replace the line `addExistingFilesTo(op: OpenProject): Promise<void>` with:

```ts
    importFilesInto(op: OpenProject, target?: string): Promise<void>
```

Replace all three existing `await priv.addExistingFilesTo(op)` call sites (in the "adds picked files", "auto-renames on a name collision", and "no-op when the picker is cancelled" tests) with:

```ts
    await priv.importFilesInto(op)
```

Then add this new test (after the "no-op when the picker is cancelled" test):

```ts
test('Import File targets the given folder', async () => {
    const picked: Picked[] = [{ Path: 'C:/ext/logo.png', Bytes: bytesOf('PNG') }]
    const { priv } = makeExplorer(picked)
    const storage = new FakeStorage('C:/a')
    await storage.CreateDirectory('src')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.importFilesInto(op, 'src')

    expect(await storage.Exists('src/logo.png')).toBe(true)
    expect(await storage.Exists('logo.png')).toBe(false)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts`
Expected: FAIL — `priv.importFilesInto` is not a function (the method is still named `addExistingFilesTo`).

- [ ] **Step 3: Rename + generalize the method**

In `project-explorer-service.ts`, replace the whole `addExistingFilesTo` method with:

```ts
    // Import existing file(s) into a project under `target` (project-relative;
    // '' = the project root): pick from the OS (multi-select, binary-safe), copy
    // each in under a non-colliding name (foo → foo-2), then rescan so they
    // appear. The picker is seeded with the factory's formats but not restricted.
    private async importFilesInto(op: OpenProject, target = ''): Promise<void>
    {
        const picked = await this.fs.OpenFiles({ Title: `Import files into ${op.Name}`, Filters: importFilters(op.Factory.formats) })
        if (picked === null || picked.length === 0) return

        try {
            const added: string[] = []
            for (const file of picked) {
                const name = await uniqueStorageName(op.Storage, joinRel(target, basename(file.Path)))
                await op.Storage.WriteBytes(name, file.Bytes)
                added.push(name)
            }
            // Refresh the tree so the imported files appear; re-wire the new nodes.
            op.Adopt(await op.Factory.openProject(op.Storage))
            this.wireNodes(op.Root, op)
            this.Status = added.length === 1
                ? `Added ${basename(added[0]!)}.`
                : `Added ${added.length} files.`
        } catch (e) {
            this.Status = `Import failed: ${(e as Error).message}`
        }
    }
```

Then update its call site in `wireProjectCommands` — replace the `op.AddFileCommand` line with:

```ts
        op.AddFileCommand = new RelayCommand(() => void this.importFilesInto(op))
```

(The `op.AddFileCommand` name is renamed to `ImportFileCommand` in Task 3; leaving it here keeps the code compiling until then.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts`
Expected: PASS (the 3 updated tests + the new target test).

- [ ] **Step 5: Typecheck**

Run: `cd Plexus && npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Stage (HOLD commit)**

```bash
git add src/renderer/src/modules/project-explorer/services/project-explorer-service.ts src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts
# Do NOT commit.
```

---

## Task 2: Recursive folder import

**Files:**
- Modify: `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts` (add `importFolderInto` + `copyOsFolderInto`)
- Test: `src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts` (extend `fakeFs`; add folder tests)

**Interfaces:**
- Consumes: `FileSystemService.OpenFolder(): Promise<string | null>`, `ListDirectory(path): Promise<readonly {Name, IsDirectory}[]>`, `ReadBytes(path): Promise<Uint8Array>`; `IStorage.CreateDirectory`, `WriteBytes`; `uniqueStorageName`, `joinRel`, `basename`.
- Produces: `private importFolderInto(op: OpenProject, target = ''): Promise<void>`; `private copyOsFolderInto(srcAbsDir: string, destRel: string, op: OpenProject): Promise<void>`.

- [ ] **Step 1: Extend `fakeFs` with an OS source tree + add folder tests**

In the test file, replace the whole `fakeFs` function with this version (adds `OpenFolder`/`ListDirectory`/`ReadBytes` backed by an in-memory OS tree; keeps the existing behavior when no tree is passed):

```ts
// An in-memory OS source tree for folder-import tests: absolute file path →
// text content. OpenFolder returns `pickedFolder`; ListDirectory/ReadBytes read
// this map (directory entries derived from path prefixes).
interface FakeOsTree { pickedFolder: string | null; files: Record<string, string> }

function fakeFs(openFiles: Picked[] | null = null, os: FakeOsTree = { pickedFolder: null, files: {} }): FileSystemService
{
    const files = new Map<string, string>()          // storage-side text (unused here)
    const osFiles = new Map(Object.entries(os.files))
    return {
        Exists: (p: string) => Promise.resolve(files.has(p)),
        ReadText: (p: string) => Promise.resolve(files.get(p) ?? ''),
        WriteText: (p: string, c: string) => { files.set(p, c); return Promise.resolve() },
        OpenFiles: () => Promise.resolve(openFiles),
        OpenFolder: () => Promise.resolve(os.pickedFolder),
        ReadBytes: (p: string) => Promise.resolve(bytesOf(osFiles.get(p) ?? '')),
        ListDirectory: (dir: string) => {
            const prefix = dir.replace(/[\\/]+$/, '') + '/'
            const names = new Map<string, boolean>()   // name → isDirectory
            for (const key of osFiles.keys()) {
                if (!key.startsWith(prefix)) continue
                const rest = key.slice(prefix.length)
                const slash = rest.indexOf('/')
                names.set(slash === -1 ? rest : rest.slice(0, slash), slash !== -1)
            }
            return Promise.resolve([...names].map(([Name, IsDirectory]) => ({ Name, IsDirectory })))
        },
    } as unknown as FileSystemService
}
```

Thread the OS tree through `makeExplorer` (it currently takes `(openFiles, confirm)` and calls `fakeFs(openFiles)`). Change its signature to add a third param and forward it:

```ts
function makeExplorer(openFiles: Picked[] | null = null, confirm = true, os: FakeOsTree = { pickedFolder: null, files: {} }): {
```

and change the `FileSystemService` registration line inside it from `fakeFs(openFiles)` to:

```ts
    provider.registerInstance(FileSystemService.Key, fakeFs(openFiles, os))
```

Add `importFolderInto` to `interface ExplorerPrivates`:

```ts
    importFolderInto(op: OpenProject, target?: string): Promise<void>
```

Then add these tests at the end of the file (note the `null, true, os` argument order — the 2nd arg is `confirm`):

```ts
test('Import Folder copies the picked directory subtree into the project', async () => {
    const os = { pickedFolder: 'C:/ext/pics', files: {
        'C:/ext/pics/a.png': 'AA',
        'C:/ext/pics/sub/b.png': 'BB',
    } }
    const { priv } = makeExplorer(null, true, os)
    const storage = new FakeStorage('C:/a')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.importFolderInto(op, '')

    expect(await storage.ReadText('pics/a.png')).toBe('AA')
    expect(await storage.ReadText('pics/sub/b.png')).toBe('BB')
})

test('Import Folder targets a subfolder', async () => {
    const os = { pickedFolder: 'C:/ext/pics', files: { 'C:/ext/pics/a.png': 'AA' } }
    const { priv } = makeExplorer(null, true, os)
    const storage = new FakeStorage('C:/a')
    await storage.CreateDirectory('src')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.importFolderInto(op, 'src')

    expect(await storage.ReadText('src/pics/a.png')).toBe('AA')
})

test('Import Folder auto-renames the top folder on a collision', async () => {
    const os = { pickedFolder: 'C:/ext/pics', files: { 'C:/ext/pics/a.png': 'AA' } }
    const { priv } = makeExplorer(null, true, os)
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('pics/existing.txt', 'x')   // makes 'pics' already exist
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.importFolderInto(op, '')

    expect(await storage.ReadText('pics-2/a.png')).toBe('AA')       // imported under a fresh name
    expect(await storage.ReadText('pics/existing.txt')).toBe('x')   // original untouched
})

test('Import Folder is a no-op when the picker is cancelled', async () => {
    const { priv } = makeExplorer(null, true, { pickedFolder: null, files: {} })
    const storage = new FakeStorage('C:/a')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)
    const before = storage.size

    await priv.importFolderInto(op, '')

    expect(storage.size).toBe(before)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts`
Expected: FAIL — `priv.importFolderInto` is not a function.

- [ ] **Step 3: Implement the folder import**

In `project-explorer-service.ts`, immediately after the `importFilesInto` method, add:

```ts
    // Import an existing OS folder into the project under `target` (project-
    // relative; '' = root): pick a directory, then copy its whole subtree in
    // under a non-colliding TOP-level name (pics → pics-2). Descendants keep
    // their names. Rescans so the subtree appears.
    private async importFolderInto(op: OpenProject, target = ''): Promise<void>
    {
        const dir = await this.fs.OpenFolder({ Title: `Import folder into ${op.Name}` })
        if (dir === null) return

        try {
            const destTop = await uniqueStorageName(op.Storage, joinRel(target, basename(dir)))
            await this.copyOsFolderInto(dir, destTop, op)
            op.Adopt(await op.Factory.openProject(op.Storage))
            this.wireNodes(op.Root, op)
            this.Status = `Imported ${basename(destTop)}.`
        } catch (e) {
            this.Status = `Import failed: ${(e as Error).message}`
        }
    }

    // Recursively copy an OS directory subtree (srcAbsDir) into project storage
    // at destRel. Empty directories are preserved; files copy byte-for-byte.
    // node fs accepts '/' on Windows, so a plain string join builds child paths.
    private async copyOsFolderInto(srcAbsDir: string, destRel: string, op: OpenProject): Promise<void>
    {
        await op.Storage.CreateDirectory(destRel)
        for (const entry of await this.fs.ListDirectory(srcAbsDir)) {
            const childSrc = `${srcAbsDir}/${entry.Name}`
            const childDest = joinRel(destRel, entry.Name)
            if (entry.IsDirectory) {
                await this.copyOsFolderInto(childSrc, childDest, op)
            } else {
                await op.Storage.WriteBytes(childDest, await this.fs.ReadBytes(childSrc))
            }
        }
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts`
Expected: PASS (all four folder tests + Task 1's tests still green).

- [ ] **Step 5: Typecheck**

Run: `cd Plexus && npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Stage (HOLD commit)**

```bash
git add src/renderer/src/modules/project-explorer/services/project-explorer-service.ts src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts
# Do NOT commit.
```

---

## Task 3: Surface the commands (project + node menus)

**Files:**
- Modify: `src/renderer/src/services/projects/open-project.ts` (rename `AddFileCommand` → `ImportFileCommand`; add `ImportFolderCommand`)
- Modify: `src/renderer/src/services/projects/project.ts` (`ProjectNode`: add `ImportFileCommand` / `ImportFolderCommand`)
- Modify: `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts` (`wireProjectCommands` + `wireNodes`)
- Modify: `src/renderer/src/modules/project-explorer/project-explorer.resources.mu` (menus)
- Test: `src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts`

**Interfaces:**
- Consumes: `importFilesInto` / `importFolderInto` (Tasks 1–2); the `container` local already computed in `wireNodes` (`node.Kind === 'folder' ? node.Path : parentOf(node.Path)`).
- Produces on `OpenProject`: `ImportFileCommand`, `ImportFolderCommand` (both `ICommand | undefined`). On `ProjectNode`: `ImportFileCommand`, `ImportFolderCommand`.

- [ ] **Step 1: Write the wiring test**

Add this test at the end of the test file:

```ts
test('Import commands are wired on the project and on each node', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    expect(op.ImportFileCommand).toBeDefined()
    expect(op.ImportFolderCommand).toBeDefined()
    const child = op.Root.Children.ToArray()[0]!   // the 'core.todl' node
    expect(child.ImportFileCommand).toBeDefined()
    expect(child.ImportFolderCommand).toBeDefined()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts`
Expected: FAIL — `op.ImportFileCommand` / `child.ImportFolderCommand` are `undefined` / not on the type.

- [ ] **Step 3: Add the `OpenProject` command DPs**

In `open-project.ts`, replace the `AddFileCommandKey` DP block:

```ts
    static readonly AddFileCommandKey = Model.RegisterProperty<ICommand | undefined>(
        OpenProject, 'AddFileCommand', undefined, MetaData.None)
```

with:

```ts
    static readonly ImportFileCommandKey = Model.RegisterProperty<ICommand | undefined>(
        OpenProject, 'ImportFileCommand', undefined, MetaData.None)
    static readonly ImportFolderCommandKey = Model.RegisterProperty<ICommand | undefined>(
        OpenProject, 'ImportFolderCommand', undefined, MetaData.None)
```

And replace the `AddFileCommand` accessors:

```ts
    public get AddFileCommand(): ICommand | undefined { return this.get_property_value(OpenProject.AddFileCommandKey) }
    public set AddFileCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.AddFileCommandKey, v) }
```

with:

```ts
    public get ImportFileCommand(): ICommand | undefined { return this.get_property_value(OpenProject.ImportFileCommandKey) }
    public set ImportFileCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.ImportFileCommandKey, v) }
    public get ImportFolderCommand(): ICommand | undefined { return this.get_property_value(OpenProject.ImportFolderCommandKey) }
    public set ImportFolderCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.ImportFolderCommandKey, v) }
```

- [ ] **Step 4: Add the `ProjectNode` command DPs**

In `project.ts`, after the `NewFolderCommandKey` DP block, add:

```ts
    static readonly ImportFileCommandKey = Model.RegisterProperty<ICommand | undefined>(
        ProjectNode, 'ImportFileCommand', undefined, MetaData.None)
    static readonly ImportFolderCommandKey = Model.RegisterProperty<ICommand | undefined>(
        ProjectNode, 'ImportFolderCommand', undefined, MetaData.None)
```

And after the `NewFolderCommand` accessors, add:

```ts
    public get ImportFileCommand(): ICommand | undefined { return this.get_property_value(ProjectNode.ImportFileCommandKey) }
    public set ImportFileCommand(v: ICommand | undefined) { this.set_property_value(ProjectNode.ImportFileCommandKey, v) }

    public get ImportFolderCommand(): ICommand | undefined { return this.get_property_value(ProjectNode.ImportFolderCommandKey) }
    public set ImportFolderCommand(v: ICommand | undefined) { this.set_property_value(ProjectNode.ImportFolderCommandKey, v) }
```

- [ ] **Step 5: Wire the commands in the service**

In `project-explorer-service.ts` `wireProjectCommands`, replace the `op.AddFileCommand` line with:

```ts
        op.ImportFileCommand = new RelayCommand(() => void this.importFilesInto(op, ''))
        op.ImportFolderCommand = new RelayCommand(() => void this.importFolderInto(op, ''))
```

In `wireNodes`, after the `node.NewFolderCommand = …` line (the `container` local is already in scope), add:

```ts
        node.ImportFileCommand = new RelayCommand(() => void this.importFilesInto(op, container))
        node.ImportFolderCommand = new RelayCommand(() => void this.importFolderInto(op, container))
```

- [ ] **Step 6: Run to verify the wiring test passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts`
Expected: PASS. If a stray `AddFileCommand` reference remains, `npm run typecheck` (Step 8) will surface it.

- [ ] **Step 7: Update the context menus**

In `project-explorer.resources.mu`, in `ContextMenu x:key="ProjectContextMenu"`, replace the "Add Existing Files…" `MenuItem` with:

```
        MenuItem
            [ Header = "Import File…",
              Command = $ImportFileCommand,
              Icon = Shape [ Geometry = @UploadFile, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header = "Import Folder…",
              Command = $ImportFolderCommand,
              Icon = Shape [ Geometry = @Folder, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
```

In `ContextMenu x:key="NodeContextMenu"`, after the "New Folder" `MenuItem` and before the `MenuSeparator`, add:

```
        MenuItem
            [ Header = "Import File…",
              Command = $ImportFileCommand,
              Icon = Shape [ Geometry = @UploadFile, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header = "Import Folder…",
              Command = $ImportFolderCommand,
              Icon = Shape [ Geometry = @Folder, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
```

- [ ] **Step 8: Recompile `.mu` + typecheck + full suite**

Run: `cd Plexus && npm run compile:mu`
Expected: compiles (no `$AddFileCommand` reference remains; `$ImportFileCommand`/`$ImportFolderCommand` resolve against the row's DataContext at runtime; `@Folder`/`@UploadFile` are existing icons).

Run: `cd Plexus && npm run typecheck`
Expected: exit 0 (confirms no leftover `AddFileCommand` references anywhere).

Run: `cd Plexus && npx vitest run`
Expected: all green.

- [ ] **Step 9: Stage (HOLD commit)**

```bash
git add src/renderer/src/services/projects/open-project.ts src/renderer/src/services/projects/project.ts src/renderer/src/modules/project-explorer/services/project-explorer-service.ts src/renderer/src/modules/project-explorer/project-explorer.resources.mu src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts
# Do NOT commit.
```

---

## Task 4: Manual smoke (`npm run dev`)

Not automatable (Electron dialogs). After Tasks 1–3:

- [ ] Right-click the project header → **Import File…** → pick a file → it copies into the project root and appears in the tree.
- [ ] Right-click a **folder** node → **Import Folder…** → pick an OS folder → its whole subtree copies under that folder and appears.
- [ ] Import a file/folder whose name already exists → it lands renamed (`foo` → `foo-2`), original untouched.
- [ ] Right-click a **file** node → **Import File…** → the file lands in that file's parent folder.
- [ ] Cancel a picker → nothing changes, no error toast.

---

## Self-Review

**Spec coverage:**
- Import File on project + node menus, into the target folder → Task 1 (target param) + Task 3 (wiring + menus). ✓
- Import Folder recursive copy into target → Task 2 + Task 3. ✓
- Relabel "Add Existing Files…" → "Import File…"; rename `AddFileCommand` → `ImportFileCommand` → Task 3. ✓
- Top-level-only collision rename → Task 1/2 use `uniqueStorageName` on the top name only; folder descendants copied verbatim. ✓
- Additive rescan refresh; not auto-opened; cancel no-op; error status → Tasks 1/2. ✓
- Testing (file-target, folder tree, collision, cancel, wiring) → Tasks 1/2/3. ✓

**Placeholder scan:** none — every code step has literal content.

**Type consistency:** `importFilesInto(op, target='')` / `importFolderInto(op, target='')` / `copyOsFolderInto(srcAbsDir, destRel, op)` names + signatures match across tasks and their tests. `ImportFileCommand` / `ImportFolderCommand` DP + accessor names are identical on `OpenProject` (Task 3 Step 3), `ProjectNode` (Step 4), the service wiring (Step 5), and the `.mu` bindings (Step 7). `fakeFs(openFiles, os)` and `makeExplorer(openFiles, confirm, os)`: Task 2 Step 1 updates `makeExplorer`'s signature to a THIRD param and forwards `os` to `fakeFs`; the folder tests pass `makeExplorer(null, true, os)` (2nd arg is `confirm`, not `os`) — resolved.

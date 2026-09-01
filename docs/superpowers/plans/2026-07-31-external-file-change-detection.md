# External File-Change Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an external program changes a file inside an open Plexus project, reload the editor buffer if clean (prompt if dirty) and re-validate the owning project.

**Architecture:** A chokidar watcher in the Electron main process watches each open project root and pushes normalized `Changed` events to the renderer over a new IPC channel (reusing the agent/LSP `webContents.send` → `ipcRenderer.on` push pattern). A renderer `FileWatchService` drives watch/unwatch off the `OpenProjects` collection and broadcasts events; two eager consumer services react — one reloads/prompts the matching open `CodeDocument`, the other debounces and calls `ProjectExplorerService.RefreshProjects([folder])` (the same re-scan+re-validate path the agent's `refresh_project` uses). No change to the `IStorage` seam.

**Tech Stack:** TypeScript (electron-vite), chokidar (new main dep), Vitest, mural runtime services.

## Global Constraints

- Work on branch `external-file-change-detection` (base `main`).
- Every test file lives in a `tests/` subfolder next to the code it exercises (Vitest globs `src/**/*.test.ts`).
- Enums over string-literal unions (repo rule): channels/kinds are `enum`s.
- Renderer reaches the preload bridge via `(globalThis as unknown as { api?: {...} }).api` — there is NO `Window` augmentation.
- Renderer services `extends ServiceBase`, sole ctor arg `provider: IServiceProvider`, deps via `this.Provider.getRequired(X.Key)`; registered in a `.services:` block and (for startup listeners) eagerly resolved in `src/renderer/src/main.js` via `app.Services.get(X.Key)`.
- Dirty-conflict policy: reload if `!IsDirty`, else prompt via `ConfirmDialogModel` + `DialogService`.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Verified facts (from exploration)

- **Push pattern:** `src/main/agent.ts` emits with `BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]` then `win?.webContents.send(channel, payload)`. Preload wraps `ipcRenderer.on(channel, listener)` returning an unsubscribe (`agent.onEvent`). `api = { fs, environment, settings, agent, todlLsp }` in `src/preload/index.ts`.
- **Main fs handlers** (`src/main/filesystem.ts`, `registerFileSystemHandlers()`): `WriteText(path, content)` → `writeFile`; `WriteBytes(path, bytes)`; `Rename(from, to)` → `rename`; `Delete(path)` → `rm`; `SaveFileAs` writes `result.filePath`. Handlers registered in `src/main/index.ts` before `createWindow()`.
- **Renderer bridge access:** `FileSystemService` does `const bridge = (globalThis as unknown as { api?: { fs?: IFileSystemApi } }).api; if (bridge?.fs === undefined) throw ...`.
- **Project registry:** `ProjectExplorerService.OpenProjects: ObservableCollection<OpenProject>`. `ObservableCollection.Subscribe(cb: () => void): () => void` (see `code-editor.ts:231`). `OpenProject.Folder: string` (absolute root = `Project.RootPath`), `OpenProject.Storage: IStorage`, `OpenProject.Name: string`. `RefreshProjects(folders: readonly string[]): Promise<void>` at `project-explorer-service.ts:797`. `docPaths: Map<IDocument, string>` and `docOwners: Map<IDocument, OpenProject>` are **private** (no accessor).
- **Storage:** `IStorage.Root: string`; `ILocalFileAccess.ResolveOsPath(path: string): string`; type guard `isLocalFileAccess(storage): storage is IStorage & ILocalFileAccess` (both in `src/renderer/src/services/storage/storage.ts`); `LocalFileStorage.ResolveOsPath` returns an absolute OS path.
- **CodeDocument** (`src/renderer/src/modules/code-editor/code-document.ts`): `Id: string`, `IsDirty: boolean`, `Content` (public getter/setter), private `savedContent`, and a **private** `async load()` that does `this.file.read().catch(()=> '')` → set `Content` → set `IsDirty=false`. `file: ICodeFile` (`read(): Promise<string>`). No public reload.
- **CodeEditorService** (`code-editor-service.ts`): private `open = new Map<string, CodeDocument>()` keyed by ABSOLUTE path (from `OpenFile(path)` → `new FileSystemCodeFile(this.fs, path)`). No public accessor.
- **DialogService:** `Show<T>(options: { Title?; Content: Model|Visual; Width?; ... }): Promise<T | undefined>`; `Close(result?)`. Reuse `ConfirmDialogModel(message: string, confirmLabel: string, close: (confirmed: boolean) => void)`. Call-site precedent (`project-explorer-service.ts:521`): `const vm = new ConfirmDialogModel(msg, 'Delete', (r) => this.dialogs.Close(r)); const ok = await this.dialogs.Show<boolean>({ Title:'Delete', Content: vm, Width: 420 }); return ok === true`.
- **Panel `Reload()`s read GLOBAL backends** (meta-models userData / LibraryRegistry), NOT project sources — so they are NOT the rescan target. The correct target is `RefreshProjects`. (Spec updated accordingly.)

## File structure

- Create `src/shared/file-watch-api.ts` — channel/kind enums + event/api types (shared across main/preload/renderer).
- Create `src/main/file-watcher-core.ts` — electron-free chokidar core + self-write suppression (unit-tested with a temp dir).
- Create `src/main/file-watcher.ts` — electron wiring: `registerFileWatchHandlers()` (ipcMain Watch/Unwatch, emit via `webContents.send`).
- Modify `src/main/filesystem.ts` — call `noteInternalWrite` before each write/rename/delete.
- Modify `src/main/index.ts` — `registerFileWatchHandlers()` at startup.
- Modify `src/preload/index.ts` — add `fileWatch` to `api`.
- Create `src/renderer/src/services/file-watch/file-watch-service.ts` — `FileWatchService` (lifecycle + broadcast) + `samePath` helper.
- Create `src/renderer/src/services/file-watch/editor-reload-service.ts` — `EditorReloadService` consumer.
- Create `src/renderer/src/services/file-watch/project-rescan-service.ts` — `ProjectRescanService` consumer.
- Modify `src/renderer/src/modules/code-editor/code-document.ts` — public `Reload()`.
- Modify `src/renderer/src/modules/code-editor/code-editor-service.ts` — `FindOpenByOsPath`.
- Modify `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts` — `FindOpenCodeDocByOsPath`.
- Modify `src/renderer/src/app.mu` — register the three new services.
- Modify `src/renderer/src/main.js` — eagerly resolve the three new services.

---

### Task 1: Main-process watcher core + IPC wiring + self-write suppression

**Files:**
- Create: `src/shared/file-watch-api.ts`
- Create: `src/main/file-watcher-core.ts`
- Create: `src/main/file-watcher.ts`
- Modify: `src/main/filesystem.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Test: `src/main/tests/file-watcher-core.test.ts`
- Dependency: add `chokidar`

**Interfaces:**
- Produces: `enum FileWatchChannel { Watch='fs-watch:watch', Unwatch='fs-watch:unwatch', Changed='fs-watch:changed' }`; `enum FileChangeKind { Added='add', Changed='change', Removed='unlink' }`; `interface FileChangeEvent { path: string; kind: FileChangeKind }`; `interface IFileWatchApi { watch(root: string): Promise<void>; unwatch(root: string): Promise<void>; onChanged(cb: (e: FileChangeEvent) => void): () => void }`.
- Produces (core): `startWatch(root: string, emit: (e: FileChangeEvent) => void): FSWatcher`; `stopWatch(root: string): void`; `noteInternalWrite(absPath: string): void`; `isSuppressed(absPath: string): boolean`; `normalize(p: string): string`.
- Produces: `registerFileWatchHandlers(): void`.

- [ ] **Step 1: Add chokidar**

Run: `npm install chokidar` (in `Plexus/`). Confirm it lands in `dependencies` of `package.json`.

- [ ] **Step 2: Create the shared API**

Create `src/shared/file-watch-api.ts`:

```ts
// Shared contract for the external file-change watcher across Plexus's three
// Electron layers (main owns chokidar; preload bridges; renderer FileWatchService
// wraps it). Mirrors the fs-api / agent-api shape.
export enum FileWatchChannel
{
    Watch   = 'fs-watch:watch',
    Unwatch = 'fs-watch:unwatch',
    Changed = 'fs-watch:changed',
}

export enum FileChangeKind
{
    Added   = 'add',
    Changed = 'change',
    Removed = 'unlink',
}

export interface FileChangeEvent
{
    path: string;      // absolute OS path of the changed file
    kind: FileChangeKind;
}

export interface IFileWatchApi
{
    watch(root: string): Promise<void>;
    unwatch(root: string): Promise<void>;
    onChanged(cb: (e: FileChangeEvent) => void): () => void;
}
```

- [ ] **Step 3: Write the failing core test**

Create `src/main/tests/file-watcher-core.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startWatch, stopWatch, noteInternalWrite } from '../file-watcher-core.js'
import { FileChangeKind, type FileChangeEvent } from '../../shared/file-watch-api.js'

// chokidar's awaitWriteFinish means events land ~150ms after a write settles.
function waitFor(pred: () => boolean, ms = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = (): void => {
      if (pred()) return resolve()
      if (Date.now() - started > ms) return reject(new Error('timeout'))
      setTimeout(tick, 25)
    }
    tick()
  })
}

describe('file-watcher-core', () => {
  let dir: string
  let events: FileChangeEvent[]
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'fw-')); events = [] })
  afterEach(async () => { stopWatch(dir); await rm(dir, { recursive: true, force: true }) })

  test('emits a Changed/Added event for an external write', async () => {
    startWatch(dir, (e) => events.push(e))
    const f = join(dir, 'note.txt')
    await writeFile(f, 'hello', 'utf8')
    await waitFor(() => events.some((e) => e.path === f))
    expect(events.some((e) => e.path === f && (e.kind === FileChangeKind.Added || e.kind === FileChangeKind.Changed))).toBe(true)
  })

  test('suppresses a write we announced via noteInternalWrite', async () => {
    startWatch(dir, (e) => events.push(e))
    const f = join(dir, 'ours.txt')
    noteInternalWrite(f)
    await writeFile(f, 'internal', 'utf8')
    // give chokidar time to (not) fire
    await new Promise((r) => setTimeout(r, 800))
    expect(events.some((e) => e.path === f)).toBe(false)
  })

  test('stopWatch halts further events', async () => {
    startWatch(dir, (e) => events.push(e))
    stopWatch(dir)
    await writeFile(join(dir, 'after.txt'), 'x', 'utf8')
    await new Promise((r) => setTimeout(r, 800))
    expect(events.length).toBe(0)
  })
})
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx vitest run src/main/tests/file-watcher-core.test.ts`
Expected: FAIL — `file-watcher-core.js` does not exist.

- [ ] **Step 5: Implement the electron-free core**

Create `src/main/file-watcher-core.ts`:

```ts
// Electron-free watcher core: chokidar per root + self-write suppression, so
// Plexus's own saves don't echo back as "external" changes. The electron wiring
// (ipcMain + webContents.send) lives in file-watcher.ts.
import chokidar, { type FSWatcher } from 'chokidar'
import { resolve } from 'node:path'
import { FileChangeKind, type FileChangeEvent } from '../shared/file-watch-api.js'

// Absolute-path normalization used for BOTH suppression keys and event paths so
// the two always compare equal. resolve() collapses separators; lowercase makes
// the compare case-insensitive (Windows filesystems are).
export function normalize(p: string): string
{
    return resolve(p).toLowerCase()
}

const SUPPRESS_WINDOW_MS = 1000
const recentWrites = new Map<string, number>()

export function noteInternalWrite(absPath: string): void
{
    recentWrites.set(normalize(absPath), Date.now())
}

export function isSuppressed(absPath: string): boolean
{
    const key = normalize(absPath)
    const at = recentWrites.get(key)
    if (at === undefined) return false
    recentWrites.delete(key)                         // one-shot
    return Date.now() - at < SUPPRESS_WINDOW_MS
}

const watchers = new Map<string, FSWatcher>()

// chokidar v4 dropped glob support in `ignored`; use a predicate.
function ignored(path: string): boolean
{
    return /(^|[\\/])(node_modules|\.git|dist)([\\/]|$)/.test(path)
}

export function startWatch(root: string, emit: (e: FileChangeEvent) => void): FSWatcher
{
    const key = normalize(root)
    const existing = watchers.get(key)
    if (existing !== undefined) return existing

    const watcher = chokidar.watch(root, {
        ignoreInitial: true,
        ignored,
        awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 20 },
    })
    const onFs = (kind: FileChangeKind) => (path: string): void => {
        if (isSuppressed(path)) return
        emit({ path, kind })
    }
    watcher.on('add', onFs(FileChangeKind.Added))
    watcher.on('change', onFs(FileChangeKind.Changed))
    watcher.on('unlink', onFs(FileChangeKind.Removed))
    watcher.on('error', () => { /* degrade silently — a dead watcher must not crash */ })
    watchers.set(key, watcher)
    return watcher
}

export function stopWatch(root: string): void
{
    const key = normalize(root)
    const w = watchers.get(key)
    if (w === undefined) return
    void w.close()
    watchers.delete(key)
}

export function stopAll(): void
{
    for (const w of watchers.values()) void w.close()
    watchers.clear()
}
```

- [ ] **Step 6: Run to verify the core passes**

Run: `npx vitest run src/main/tests/file-watcher-core.test.ts`
Expected: PASS (all three).

- [ ] **Step 7: Implement the electron wiring**

Create `src/main/file-watcher.ts`:

```ts
// Electron wiring for the file watcher: renderer asks main to Watch/Unwatch a
// project root (ipcMain.handle); main pushes Changed events to the renderer
// (webContents.send), reusing the agent/LSP push pattern.
import { BrowserWindow, ipcMain } from 'electron'
import { FileWatchChannel, type FileChangeEvent } from '../shared/file-watch-api.js'
import { startWatch, stopWatch } from './file-watcher-core.js'

function emitChange(event: FileChangeEvent): void
{
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    win?.webContents.send(FileWatchChannel.Changed, event)
}

export function registerFileWatchHandlers(): void
{
    ipcMain.handle(FileWatchChannel.Watch, (_e, root: string): void => {
        startWatch(root, emitChange)
    })
    ipcMain.handle(FileWatchChannel.Unwatch, (_e, root: string): void => {
        stopWatch(root)
    })
}
```

- [ ] **Step 8: Wire self-write suppression into filesystem.ts**

In `src/main/filesystem.ts`, add the import and a `noteInternalWrite(path)` call immediately before each mutation. Add at the top:

```ts
import { noteInternalWrite } from './file-watcher-core.js'
```

Then in `registerFileSystemHandlers`, before each write/rename/delete call the note. Concretely:
- In the `WriteText` handler, before `await writeFile(path, content, 'utf8')` add `noteInternalWrite(path)`.
- In the `WriteBytes` handler, before `await writeFile(path, Buffer.from(bytes))` add `noteInternalWrite(path)`.
- In the `Rename` handler, before `await rename(from, to)` add `noteInternalWrite(to)` (the new path is what appears on disk).
- In the `Delete` handler, before `await rm(path, { force: true, recursive: true })` add `noteInternalWrite(path)`.
- In the `SaveFileAs` handler, before `await writeFile(result.filePath, content, 'utf8')` add `noteInternalWrite(result.filePath)`.

- [ ] **Step 9: Register handlers in main/index.ts**

In `src/main/index.ts`, add the import next to the others:

```ts
import { registerFileWatchHandlers } from './file-watcher.js'
```

and call it alongside `registerFileSystemHandlers()` (same block, before `createWindow()`):

```ts
  registerFileSystemHandlers()
  registerFileWatchHandlers()
```

- [ ] **Step 10: Add the preload surface**

In `src/preload/index.ts`, add the import:

```ts
import { FileWatchChannel, type FileChangeEvent, type IFileWatchApi } from '../shared/file-watch-api.js'
```

Add the bridge object (mirroring `agent`):

```ts
const fileWatch: IFileWatchApi = {
  watch: (root: string): Promise<void> => ipcRenderer.invoke(FileWatchChannel.Watch, root),
  unwatch: (root: string): Promise<void> => ipcRenderer.invoke(FileWatchChannel.Unwatch, root),
  onChanged: (cb: (e: FileChangeEvent) => void): (() => void) => {
    const listener = (_e: unknown, event: FileChangeEvent): void => cb(event)
    ipcRenderer.on(FileWatchChannel.Changed, listener)
    return () => { ipcRenderer.removeListener(FileWatchChannel.Changed, listener) }
  },
}
```

and add it to the exposed object: `const api = { fs, environment, settings, agent, todlLsp, fileWatch }`.

- [ ] **Step 11: Typecheck + full main test run**

Run: `npx vitest run src/main/tests/file-watcher-core.test.ts` (Expected: PASS) and `npm run typecheck` if present, else `npx tsc -p tsconfig.node.json --noEmit` (Expected: no new errors).

- [ ] **Step 12: Commit**

```bash
git add src/shared/file-watch-api.ts src/main/file-watcher-core.ts src/main/file-watcher.ts src/main/filesystem.ts src/main/index.ts src/preload/index.ts src/main/tests/file-watcher-core.test.ts package.json package-lock.json
git commit -m "feat(main): chokidar file watcher with IPC + self-write suppression

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `FileWatchService` — lifecycle + broadcast (renderer)

**Files:**
- Create: `src/renderer/src/services/file-watch/file-watch-service.ts`
- Modify: `src/renderer/src/app.mu`
- Modify: `src/renderer/src/main.js`
- Test: `src/renderer/src/services/file-watch/tests/file-watch-service.test.ts`

**Interfaces:**
- Consumes: `IFileWatchApi` (Task 1); `ProjectExplorerService.OpenProjects: ObservableCollection<OpenProject>` with `OpenProject.Folder: string`; `ObservableCollection.Subscribe(cb): () => void`.
- Produces: `class FileWatchService extends ServiceBase` with `static readonly Key: ServiceKey<FileWatchService>`, and `Subscribe(cb: (e: FileChangeEvent) => void): () => void`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/services/file-watch/tests/file-watch-service.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest'
import { FileChangeKind, type FileChangeEvent, type IFileWatchApi } from '../../../../../shared/file-watch-api.js'
import { FileWatchService } from '../file-watch-service.js'
import { ProjectExplorerService } from '../../../modules/project-explorer/services/project-explorer-service.js'

// Minimal fakes: a fake preload bridge and a fake explorer exposing an OpenProjects
// collection with a Subscribe(cb) + ToArray().
function makeBridge() {
  let changedCb: ((e: FileChangeEvent) => void) | undefined
  const watch = vi.fn(async () => {})
  const unwatch = vi.fn(async () => {})
  const api: IFileWatchApi = {
    watch, unwatch,
    onChanged: (cb) => { changedCb = cb; return () => { changedCb = undefined } },
  }
  return { api, watch, unwatch, fire: (e: FileChangeEvent) => changedCb?.(e) }
}

function makeExplorer(folders: string[]) {
  let subCb: (() => void) | undefined
  const items = folders.map((f) => ({ Folder: f }))
  const OpenProjects = {
    ToArray: () => items.slice(),
    Subscribe: (cb: () => void) => { subCb = cb; return () => { subCb = undefined } },
    _set: (next: string[]) => { items.length = 0; next.forEach((f) => items.push({ Folder: f })); subCb?.() },
  }
  return { OpenProjects }
}

function makeProvider(bridgeApi: IFileWatchApi, explorer: unknown) {
  return {
    getRequired: (key: unknown) => {
      if (key === ProjectExplorerService.Key) return explorer
      throw new Error('unexpected key')
    },
  }
}

describe('FileWatchService', () => {
  test('watches the roots of already-open projects on construction', () => {
    const b = makeBridge()
    ;(globalThis as unknown as { api?: unknown }).api = { fileWatch: b.api }
    const explorer = makeExplorer(['C:/proj/a'])
    const svc = new FileWatchService(makeProvider(b.api, explorer) as never)
    expect(b.watch).toHaveBeenCalledWith('C:/proj/a')
    svc.Dispose()
  })

  test('watches on open and unwatches on close', () => {
    const b = makeBridge()
    ;(globalThis as unknown as { api?: unknown }).api = { fileWatch: b.api }
    const explorer = makeExplorer([])
    const svc = new FileWatchService(makeProvider(b.api, explorer) as never)
    ;(explorer.OpenProjects as never as { _set: (f: string[]) => void })._set(['C:/proj/b'])
    expect(b.watch).toHaveBeenCalledWith('C:/proj/b')
    ;(explorer.OpenProjects as never as { _set: (f: string[]) => void })._set([])
    expect(b.unwatch).toHaveBeenCalledWith('C:/proj/b')
    svc.Dispose()
  })

  test('broadcasts Changed events to subscribers', () => {
    const b = makeBridge()
    ;(globalThis as unknown as { api?: unknown }).api = { fileWatch: b.api }
    const explorer = makeExplorer([])
    const svc = new FileWatchService(makeProvider(b.api, explorer) as never)
    const seen: FileChangeEvent[] = []
    svc.Subscribe((e) => seen.push(e))
    b.fire({ path: 'C:/proj/b/x.todl', kind: FileChangeKind.Changed })
    expect(seen).toEqual([{ path: 'C:/proj/b/x.todl', kind: FileChangeKind.Changed }])
    svc.Dispose()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/services/file-watch/tests/file-watch-service.test.ts`
Expected: FAIL — `file-watch-service.js` not found.

- [ ] **Step 3: Implement the service**

Create `src/renderer/src/services/file-watch/file-watch-service.ts`:

```ts
// Watches open project roots (main owns chokidar) and broadcasts external file
// changes to in-renderer consumers. Pure lifecycle + fan-out: it does not know
// about editors or validation — consumers subscribe and decide. Eagerly resolved
// at startup (main.js) so it listens before any project work.
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { type FileChangeEvent, type IFileWatchApi } from '../../../../shared/file-watch-api.js'
import { ProjectExplorerService } from '../../modules/project-explorer/services/project-explorer-service.js'

// Absolute-path compare that tolerates separator + case differences (Windows).
export function samePath(a: string, b: string, caseInsensitive: boolean): boolean
{
    const norm = (p: string): string =>
        (caseInsensitive ? p.toLowerCase() : p).replace(/[\\/]+/g, '/').replace(/\/+$/, '')
    return norm(a) === norm(b)
}

export class FileWatchService extends ServiceBase
{
    public static readonly Key = new ServiceKey<FileWatchService>('FileWatchService')

    private readonly api: IFileWatchApi
    private readonly subscribers = new Set<(e: FileChangeEvent) => void>()
    private readonly watched = new Set<string>()
    private readonly disposers: Array<() => void> = []

    constructor(provider: IServiceProvider)
    {
        super(provider)
        const bridge = (globalThis as unknown as { api?: { fileWatch?: IFileWatchApi } }).api
        if (bridge?.fileWatch === undefined)
        {
            throw new Error(
                'FileWatchService: window.api.fileWatch is unavailable — the Electron preload '
                + 'bridge did not load. This service requires the Plexus desktop host.',
            )
        }
        this.api = bridge.fileWatch
        this.disposers.push(this.api.onChanged((e) => { for (const cb of this.subscribers) cb(e) }))

        const explorer = this.Provider.getRequired(ProjectExplorerService.Key)
        this.disposers.push(explorer.OpenProjects.Subscribe(() => this.reconcile()))
        this.reconcile()
    }

    public Subscribe(cb: (e: FileChangeEvent) => void): () => void
    {
        this.subscribers.add(cb)
        return () => { this.subscribers.delete(cb) }
    }

    // Diff the current open-project roots against what we're watching; watch new,
    // unwatch gone.
    private reconcile(): void
    {
        const explorer = this.Provider.getRequired(ProjectExplorerService.Key)
        const current = new Set(explorer.OpenProjects.ToArray().map((p) => p.Folder))
        for (const folder of current) if (!this.watched.has(folder)) { this.watched.add(folder); void this.api.watch(folder) }
        for (const folder of [...this.watched]) if (!current.has(folder)) { this.watched.delete(folder); void this.api.unwatch(folder) }
    }

    public Dispose(): void
    {
        for (const d of this.disposers) d()
        for (const folder of this.watched) void this.api.unwatch(folder)
        this.watched.clear()
        this.subscribers.clear()
    }
}

export default FileWatchService
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/services/file-watch/tests/file-watch-service.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Register + eagerly resolve**

In `src/renderer/src/app.mu`, add `FileWatchService` to the root `.services:` block (next to `WorkspaceRefreshService`). In `src/renderer/src/main.js`, add the import and an eager resolve next to the `WorkspaceRefreshService` one:

```js
import { FileWatchService } from './services/file-watch/file-watch-service.js'
// ... alongside app.Services.get(WorkspaceRefreshService.Key):
app.Services.get(FileWatchService.Key)
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/services/file-watch/file-watch-service.ts src/renderer/src/services/file-watch/tests/file-watch-service.test.ts src/renderer/src/app.mu src/renderer/src/main.js
git commit -m "feat(renderer): FileWatchService watches open roots + broadcasts changes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Enabling accessors — CodeDocument.Reload + open-doc lookups

**Files:**
- Modify: `src/renderer/src/modules/code-editor/code-document.ts`
- Modify: `src/renderer/src/modules/code-editor/code-editor-service.ts`
- Modify: `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts`
- Test: `src/renderer/src/modules/code-editor/tests/code-document-reload.test.ts`

**Interfaces:**
- Produces: `CodeDocument.Reload(): Promise<void>` (re-reads from disk, resets dirty).
- Produces: `CodeEditorService.FindOpenByOsPath(absPath: string): CodeDocument | undefined`.
- Produces: `ProjectExplorerService.FindOpenCodeDocByOsPath(absPath: string): CodeDocument | undefined`.
- Consumes: `samePath` (Task 2).

- [ ] **Step 1: Write the failing CodeDocument.Reload test**

Create `src/renderer/src/modules/code-editor/tests/code-document-reload.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { CodeDocument } from '../code-document.js'
import { type ICodeFile } from '../code-file.js'

class FakeFile implements ICodeFile {
  constructor(public id: string, public text: string) {}
  read(): Promise<string> { return Promise.resolve(this.text) }
  write(text: string): Promise<void> { this.text = text; return Promise.resolve() }
}

describe('CodeDocument.Reload', () => {
  test('re-reads content from the file and clears dirty', async () => {
    const file = new FakeFile('a.txt', 'v1')
    const doc = new CodeDocument(file)
    await Promise.resolve() // let the ctor load() settle
    doc.Content = 'edited'                 // user edit → dirty
    expect(doc.IsDirty).toBe(true)
    file.text = 'v2-external'              // external change on disk
    await doc.Reload()
    expect(doc.Content).toBe('v2-external')
    expect(doc.IsDirty).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/modules/code-editor/tests/code-document-reload.test.ts`
Expected: FAIL — `doc.Reload` is not a function.

- [ ] **Step 3: Add the public Reload**

In `src/renderer/src/modules/code-editor/code-document.ts`, add a public method that reuses the existing private `load()`:

```ts
    // Re-read the buffer from disk (external change). Discards any in-memory edits
    // — callers gate on IsDirty and prompt first when that matters.
    public async Reload(): Promise<void>
    {
        await this.load()
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/modules/code-editor/tests/code-document-reload.test.ts`
Expected: PASS.

- [ ] **Step 5: Add CodeEditorService.FindOpenByOsPath**

In `src/renderer/src/modules/code-editor/code-editor-service.ts`, import `samePath` and `EnvironmentService`, and add a public lookup over the private `open` map:

```ts
import { samePath } from '../../services/file-watch/file-watch-service.js'
import { EnvironmentService } from '../../services/environment/environment-service.js'
// ...
    public FindOpenByOsPath(absPath: string): CodeDocument | undefined
    {
        const ci = this.Provider.getRequired(EnvironmentService.Key).IsWindows
        for (const [key, doc] of this.open) if (samePath(key, absPath, ci)) return doc
        return undefined
    }
```

If `EnvironmentService` does not expose `IsWindows`, use the platform flag it does expose (check `environment-service.ts`); the only requirement is a boolean "is Windows" for case-insensitive compare. If none exists, pass `true` conservatively (case-insensitive compare is safe on POSIX for distinct-case paths only in the rare collision, acceptable for v1) — but prefer the real flag.

- [ ] **Step 6: Add ProjectExplorerService.FindOpenCodeDocByOsPath**

In `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts`, add a public lookup over the private `docPaths`/`docOwners`, matching by resolved OS path and narrowing to `CodeDocument`:

```ts
import { CodeDocument } from '../../code-editor/code-document.js'
import { isLocalFileAccess } from '../../../services/storage/storage.js'
import { samePath } from '../../../services/file-watch/file-watch-service.js'
import { EnvironmentService } from '../../../services/environment/environment-service.js'
// ...
    public FindOpenCodeDocByOsPath(absPath: string): CodeDocument | undefined
    {
        const ci = this.Provider.getRequired(EnvironmentService.Key).IsWindows
        for (const [doc, rel] of this.docPaths)
        {
            if (!(doc instanceof CodeDocument)) continue
            const owner = this.docOwners.get(doc)
            const storage = owner?.Storage
            if (storage === undefined || !isLocalFileAccess(storage)) continue
            if (samePath(storage.ResolveOsPath(rel), absPath, ci)) return doc
        }
        return undefined
    }
```

(Adjust the relative import paths to the file's actual depth; verify against existing imports in that file.)

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck` (or `npx tsc -p tsconfig.web.json --noEmit`).
Expected: no new errors. Fix import paths / the `IsWindows` accessor name as the compiler directs.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/modules/code-editor/code-document.ts src/renderer/src/modules/code-editor/code-editor-service.ts src/renderer/src/modules/project-explorer/services/project-explorer-service.ts src/renderer/src/modules/code-editor/tests/code-document-reload.test.ts
git commit -m "feat(editor): CodeDocument.Reload + open-document OS-path lookups

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `EditorReloadService` — reload clean, prompt dirty

**Files:**
- Create: `src/renderer/src/services/file-watch/editor-reload-service.ts`
- Modify: `src/renderer/src/app.mu`
- Modify: `src/renderer/src/main.js`
- Test: `src/renderer/src/services/file-watch/tests/editor-reload-service.test.ts`

**Interfaces:**
- Consumes: `FileWatchService.Subscribe` (Task 2); `CodeEditorService.FindOpenByOsPath`, `ProjectExplorerService.FindOpenCodeDocByOsPath`, `CodeDocument.Reload/IsDirty` (Task 3); `DialogService.Show`, `ConfirmDialogModel`.
- Produces: `class EditorReloadService extends ServiceBase` with `static readonly Key`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/services/file-watch/tests/editor-reload-service.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest'
import { FileChangeKind, type FileChangeEvent } from '../../../../../shared/file-watch-api.js'
import { EditorReloadService } from '../editor-reload-service.js'
import { FileWatchService } from '../file-watch-service.js'
import { CodeEditorService } from '../../../modules/code-editor/code-editor-service.js'
import { ProjectExplorerService } from '../../../modules/project-explorer/services/project-explorer-service.js'
import { DialogService } from '@pragmatic-tech-ai/mural/runtime'

function fakeDoc(dirty: boolean) {
  return { IsDirty: dirty, Reload: vi.fn(async () => {}) }
}

function harness(opts: { doc?: ReturnType<typeof fakeDoc>; confirm?: boolean }) {
  let changedCb: ((e: FileChangeEvent) => void) | undefined
  const fileWatch = { Subscribe: (cb: (e: FileChangeEvent) => void) => { changedCb = cb; return () => {} } }
  const codeEditor = { FindOpenByOsPath: vi.fn(() => opts.doc) }
  const explorer = { FindOpenCodeDocByOsPath: vi.fn(() => undefined) }
  const dialogs = { Show: vi.fn(async () => opts.confirm), Close: vi.fn() }
  const provider = {
    getRequired: (key: unknown) => {
      if (key === FileWatchService.Key) return fileWatch
      if (key === CodeEditorService.Key) return codeEditor
      if (key === ProjectExplorerService.Key) return explorer
      if (key === DialogService.Key) return dialogs
      throw new Error('unexpected key')
    },
  }
  const svc = new EditorReloadService(provider as never)
  return { svc, fire: (e: FileChangeEvent) => changedCb?.(e), dialogs }
}

describe('EditorReloadService', () => {
  test('clean buffer reloads silently, no dialog', async () => {
    const doc = fakeDoc(false)
    const h = harness({ doc })
    h.fire({ path: 'C:/p/x.todl', kind: FileChangeKind.Changed })
    await Promise.resolve(); await Promise.resolve()
    expect(doc.Reload).toHaveBeenCalledOnce()
    expect(h.dialogs.Show).not.toHaveBeenCalled()
  })

  test('dirty buffer prompts; confirm reloads', async () => {
    const doc = fakeDoc(true)
    const h = harness({ doc, confirm: true })
    h.fire({ path: 'C:/p/x.todl', kind: FileChangeKind.Changed })
    await Promise.resolve(); await Promise.resolve()
    expect(h.dialogs.Show).toHaveBeenCalledOnce()
    expect(doc.Reload).toHaveBeenCalledOnce()
  })

  test('dirty buffer prompts; cancel does NOT reload', async () => {
    const doc = fakeDoc(true)
    const h = harness({ doc, confirm: false })
    h.fire({ path: 'C:/p/x.todl', kind: FileChangeKind.Changed })
    await Promise.resolve(); await Promise.resolve()
    expect(h.dialogs.Show).toHaveBeenCalledOnce()
    expect(doc.Reload).not.toHaveBeenCalled()
  })

  test('Removed kind is ignored', async () => {
    const doc = fakeDoc(false)
    const h = harness({ doc })
    h.fire({ path: 'C:/p/x.todl', kind: FileChangeKind.Removed })
    await Promise.resolve()
    expect(doc.Reload).not.toHaveBeenCalled()
  })

  test('no matching open doc is a no-op', async () => {
    const h = harness({ doc: undefined })
    h.fire({ path: 'C:/p/none.todl', kind: FileChangeKind.Changed })
    await Promise.resolve()
    expect(h.dialogs.Show).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/services/file-watch/tests/editor-reload-service.test.ts`
Expected: FAIL — `editor-reload-service.js` not found.

- [ ] **Step 3: Implement the consumer**

> Import-path check: confirm where `DialogService` is exported from and match it. The reference below imports it from `@pragmatic-tech-ai/mural/runtime`; if `project-explorer-service.ts` (which uses `DialogService.Key`) imports it from a different subpath (e.g. `@pragmatic-tech-ai/mural/framework`), use that same specifier here and in the test.

Create `src/renderer/src/services/file-watch/editor-reload-service.ts`:

```ts
// Reacts to external file changes for files OPEN in the editor: reload a clean
// buffer silently; prompt before discarding unsaved edits on a dirty buffer.
// Eagerly resolved at startup so it listens from boot.
import { ServiceBase, ServiceKey, DialogService, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { FileChangeKind, type FileChangeEvent } from '../../../../shared/file-watch-api.js'
import { FileWatchService } from './file-watch-service.js'
import { CodeEditorService } from '../../modules/code-editor/code-editor-service.js'
import { ProjectExplorerService } from '../../modules/project-explorer/services/project-explorer-service.js'
import { CodeDocument } from '../../modules/code-editor/code-document.js'
import { ConfirmDialogModel } from '../dialogs/confirm-dialog-model.js'

export class EditorReloadService extends ServiceBase
{
    public static readonly Key = new ServiceKey<EditorReloadService>('EditorReloadService')

    private readonly unsubscribe: () => void

    constructor(provider: IServiceProvider)
    {
        super(provider)
        const watch = this.Provider.getRequired(FileWatchService.Key)
        this.unsubscribe = watch.Subscribe((e) => void this.handle(e))
    }

    private async handle(e: FileChangeEvent): Promise<void>
    {
        if (e.kind === FileChangeKind.Removed) return
        const doc = this.find(e.path)
        if (doc === undefined) return
        if (!doc.IsDirty) { await doc.Reload(); return }

        const dialogs = this.Provider.getRequired(DialogService.Key)
        const name = doc.Id
        const vm = new ConfirmDialogModel(
            `"${name}" changed on disk. Reload and discard your unsaved edits?`,
            'Reload',
            (r) => dialogs.Close(r),
        )
        const confirmed = await dialogs.Show<boolean>({ Title: 'File changed on disk', Content: vm, Width: 420 })
        if (confirmed === true) await doc.Reload()
    }

    private find(absPath: string): CodeDocument | undefined
    {
        const editor = this.Provider.getRequired(CodeEditorService.Key)
        const fromEditor = editor.FindOpenByOsPath(absPath)
        if (fromEditor !== undefined) return fromEditor
        return this.Provider.getRequired(ProjectExplorerService.Key).FindOpenCodeDocByOsPath(absPath)
    }

    public Dispose(): void { this.unsubscribe() }
}

export default EditorReloadService
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/services/file-watch/tests/editor-reload-service.test.ts`
Expected: PASS (all five).

- [ ] **Step 5: Register + eagerly resolve**

Add `EditorReloadService` to the `.services:` block in `src/renderer/src/app.mu`, and eagerly resolve it in `src/renderer/src/main.js`:

```js
import { EditorReloadService } from './services/file-watch/editor-reload-service.js'
// ...
app.Services.get(EditorReloadService.Key)
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/services/file-watch/editor-reload-service.ts src/renderer/src/services/file-watch/tests/editor-reload-service.test.ts src/renderer/src/app.mu src/renderer/src/main.js
git commit -m "feat(renderer): reload editor on external change, prompt on dirty conflict

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `ProjectRescanService` — debounced project re-validation

**Files:**
- Create: `src/renderer/src/services/file-watch/project-rescan-service.ts`
- Modify: `src/renderer/src/app.mu`
- Modify: `src/renderer/src/main.js`
- Test: `src/renderer/src/services/file-watch/tests/project-rescan-service.test.ts`

**Interfaces:**
- Consumes: `FileWatchService.Subscribe`; `ProjectExplorerService.OpenProjects` (`OpenProject.Folder`) and `RefreshProjects(folders: readonly string[]): Promise<void>`; `samePath` (Task 2).
- Produces: `class ProjectRescanService extends ServiceBase` with `static readonly Key`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/services/file-watch/tests/project-rescan-service.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest'
import { FileChangeKind, type FileChangeEvent } from '../../../../../shared/file-watch-api.js'
import { ProjectRescanService } from '../project-rescan-service.js'
import { FileWatchService } from '../file-watch-service.js'
import { ProjectExplorerService } from '../../../modules/project-explorer/services/project-explorer-service.js'
import { EnvironmentService } from '../../environment/environment-service.js'

function harness(folders: string[]) {
  let changedCb: ((e: FileChangeEvent) => void) | undefined
  const fileWatch = { Subscribe: (cb: (e: FileChangeEvent) => void) => { changedCb = cb; return () => {} } }
  const RefreshProjects = vi.fn(async () => {})
  const explorer = {
    OpenProjects: { ToArray: () => folders.map((f) => ({ Folder: f })) },
    RefreshProjects,
  }
  const env = { IsWindows: true }
  const provider = {
    getRequired: (key: unknown) => {
      if (key === FileWatchService.Key) return fileWatch
      if (key === ProjectExplorerService.Key) return explorer
      if (key === EnvironmentService.Key) return env
      throw new Error('unexpected key')
    },
  }
  const svc = new ProjectRescanService(provider as never)
  return { svc, fire: (e: FileChangeEvent) => changedCb?.(e), RefreshProjects }
}

describe('ProjectRescanService', () => {
  test('debounces a burst of changes into ONE RefreshProjects for the owning folder', async () => {
    vi.useFakeTimers()
    const h = harness(['C:/proj/a'])
    for (let i = 0; i < 5; i++) h.fire({ path: `C:/proj/a/src/f${i}.todl`, kind: FileChangeKind.Changed })
    await vi.advanceTimersByTimeAsync(300)
    expect(h.RefreshProjects).toHaveBeenCalledTimes(1)
    expect(h.RefreshProjects).toHaveBeenCalledWith(['C:/proj/a'])
    vi.useRealTimers()
  })

  test('ignores a change outside every open project', async () => {
    vi.useFakeTimers()
    const h = harness(['C:/proj/a'])
    h.fire({ path: 'C:/elsewhere/x.todl', kind: FileChangeKind.Changed })
    await vi.advanceTimersByTimeAsync(300)
    expect(h.RefreshProjects).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/services/file-watch/tests/project-rescan-service.test.ts`
Expected: FAIL — `project-rescan-service.js` not found.

- [ ] **Step 3: Implement the consumer**

Create `src/renderer/src/services/file-watch/project-rescan-service.ts`:

```ts
// Reacts to external file changes anywhere under an open project root by
// re-scanning + re-validating that project (the same path the agent's
// refresh_project uses). Debounced per folder so a burst collapses to one rescan.
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { type FileChangeEvent } from '../../../../shared/file-watch-api.js'
import { FileWatchService } from './file-watch-service.js'
import { ProjectExplorerService } from '../../modules/project-explorer/services/project-explorer-service.js'
import { EnvironmentService } from '../environment/environment-service.js'

const DEBOUNCE_MS = 250

export class ProjectRescanService extends ServiceBase
{
    public static readonly Key = new ServiceKey<ProjectRescanService>('ProjectRescanService')

    private readonly unsubscribe: () => void
    private readonly pending = new Map<string, ReturnType<typeof setTimeout>>()

    constructor(provider: IServiceProvider)
    {
        super(provider)
        const watch = this.Provider.getRequired(FileWatchService.Key)
        this.unsubscribe = watch.Subscribe((e) => this.handle(e))
    }

    private handle(e: FileChangeEvent): void
    {
        const folder = this.owningFolder(e.path)
        if (folder === undefined) return
        const existing = this.pending.get(folder)
        if (existing !== undefined) clearTimeout(existing)
        this.pending.set(folder, setTimeout(() => {
            this.pending.delete(folder)
            void this.Provider.getRequired(ProjectExplorerService.Key).RefreshProjects([folder])
        }, DEBOUNCE_MS))
    }

    // The open-project root that contains this path (prefix match, path-normalized).
    private owningFolder(absPath: string): string | undefined
    {
        const ci = this.Provider.getRequired(EnvironmentService.Key).IsWindows
        const norm = (p: string): string => (ci ? p.toLowerCase() : p).replace(/[\\/]+/g, '/').replace(/\/+$/, '')
        const target = norm(absPath)
        const explorer = this.Provider.getRequired(ProjectExplorerService.Key)
        for (const p of explorer.OpenProjects.ToArray())
        {
            const root = norm(p.Folder)
            if (target === root || target.startsWith(root + '/')) return p.Folder
        }
        return undefined
    }

    public Dispose(): void
    {
        this.unsubscribe()
        for (const t of this.pending.values()) clearTimeout(t)
        this.pending.clear()
    }
}

export default ProjectRescanService
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/services/file-watch/tests/project-rescan-service.test.ts`
Expected: PASS (both).

- [ ] **Step 5: Register + eagerly resolve**

Add `ProjectRescanService` to `.services:` in `src/renderer/src/app.mu`, and eagerly resolve in `src/renderer/src/main.js`:

```js
import { ProjectRescanService } from './services/file-watch/project-rescan-service.js'
// ...
app.Services.get(ProjectRescanService.Key)
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/services/file-watch/project-rescan-service.ts src/renderer/src/services/file-watch/tests/project-rescan-service.test.ts src/renderer/src/app.mu src/renderer/src/main.js
git commit -m "feat(renderer): re-validate owning project on external change (debounced)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Full-suite verification

- [ ] **Step 1: Run the whole renderer + main suite**

Run: `npx vitest run`
Expected: PASS. Investigate any failure — most likely an import-path or an assumed accessor name (`EnvironmentService.IsWindows`, relative import depth) that the compiler/runner names precisely.

- [ ] **Step 2: Typecheck both projects**

Run: `npm run typecheck` (or the project's `tsc -p tsconfig.node.json --noEmit` and `tsc -p tsconfig.web.json --noEmit`).
Expected: no new errors.

- [ ] **Step 3: Commit any final reconciliation**

```bash
git add -A
git commit -m "test: full suite green for external file-change detection

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Deferred (not in this plan)

- Auto-closing an editor tab when its file is deleted externally (v1 ignores `Removed` for reload).
- Watching the meta-models `userData` backend so the published-models panel auto-refreshes (its backend is outside project roots; the panel `Reload()`s stay manual/activation-driven).
- A settings toggle to disable watching (the watcher already degrades silently on error).
- Registering a watcher for out-of-project open files (only project roots are watched; an out-of-project file changing on disk is matched by `CodeEditorService.FindOpenByOsPath` only if it happens to sit under a watched root).

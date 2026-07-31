# External File-Change Detection — Design

**Date:** 2026-07-31
**Status:** Approved (design), pending plan
**Repo:** Plexus (Electron app on mural)
**Branch:** `external-file-change-detection` (base `main`)

## Goal

When an external program modifies a file inside an open Plexus project, Plexus
notices and reacts:

1. **Editor reload.** If the file is open in the code editor and the buffer is
   **clean**, silently reload it from disk. If the buffer is **dirty** (unsaved
   edits), surface a non-destructive prompt — *"… changed on disk. Reload / Keep
   my edits"* — and honor the choice.
2. **Auto-rescan.** Any external change under a project also re-triggers the
   pull-based panel services (meta-models, libraries, arch-terms) so their
   `Reload()` runs without a manual action. This is what makes an external
   `.todl` edit re-run validation on its own.

## Background — current state (verified)

- **All disk access is in the Electron main process** (`src/main/filesystem.ts`,
  Node `fs/promises`), reached from the renderer only by request/response IPC
  (`fs:*` channels declared in `src/shared/file-system-api.ts`). The renderer
  never touches `node:fs`.
- **There is no file watcher anywhere** — no `fs.watch`/`chokidar`. The only
  change hook is Monaco's in-editor `onDidChangeModelContent`
  (`code-editor.ts:173`).
- **Main→renderer push already works** and is the pattern to reuse:
  `AgentChannel.Event` and `TodlLspChannel.FromServer` both do
  `win.webContents.send(channel, msg)`, the preload wraps them with
  `ipcRenderer.on(channel, listener)`, and `window.api` exposes an
  `on<X>(cb): () => void` unsubscribe-returning subscription.
- **Open-document registries already exist.** `ProjectExplorerService` holds
  `docPaths: Map<IDocument, string>` (project-relative path) and
  `docOwners: Map<IDocument, OpenProject>`. `LocalFileStorage.ResolveOsPath(rel)`
  converts a project-relative path to the same absolute OS path a watcher
  reports. Out-of-project files live in `CodeEditorService.open: Map<string,
  CodeDocument>`, keyed by absolute path.
- **`CodeDocument`** exposes `IsDirty: boolean` (`IsDirty = Content !==
  savedContent`), tracks `savedContent`, and already updates the Monaco buffer
  when `Content` is set (echo-guarded in `CodeEditor.OnPropertyChanged`). It
  reads through its `ICodeFile` (`StorageCodeFile` or `FileSystemCodeFile`) via
  `file.read()`.
- **A confirm dialog exists:** `ConfirmDialogModel(message, confirmLabel,
  close)` shown through `DialogService`, resolving a boolean (confirm→true,
  cancel/scrim→false/undefined). Reused for the dirty-conflict prompt.
- **Pull-based rescans:** `MetaModelsService`, `LibrariesPanelService`,
  `ArchTermsPaletteService` each have a `Reload()` today triggered by user
  actions / the agent's `refresh_project` tool.

## Decisions (from brainstorming)

- **Dirty-conflict policy:** reload if clean, prompt if dirty (VS Code's model).
- **v1 scope:** editor reload **and** project auto-rescan.
- **Watcher tech:** chokidar (new main-process dependency) over raw `fs.watch`,
  for atomic-save/rename smoothing and cross-platform consistency.
- **Watch granularity:** watch each open **project root** (recursive), not each
  open file. Simpler lifecycle (one watcher per open project) and it is what the
  auto-rescan consumer needs anyway.
- **No change to the `IStorage` seam.** The watcher belongs at the fs layer in
  main; storage stays strictly request/response.

## Architecture

```
 main process                         │ renderer
 ─────────────────────────────────────┼───────────────────────────────────
 chokidar watcher (file-watcher.ts)   │ FileWatchService
   • Watch(root) / Unwatch(root)  ◄───┼──  drives watch/unwatch on
     [ipcMain.handle]                 │    project open / close
   • ignores node_modules/.git/dist   │
   • debounce ~100ms                  │  onChanged(evt) ──► ExternalChange event
   • drops self-writes (suppression)  │        │
   • webContents.send(Changed, evt) ──┼────────┘ (fanned out to consumers)
                                      │            ├─ editor reload (clean→reload,
 filesystem.ts handlers               │            │   dirty→ConfirmDialog)
   • noteInternalWrite(absPath)       │            └─ panel Reload() (debounced)
     before every write/rename/delete │
```

### Components

**`src/main/file-watcher.ts` (new).**
- `registerFileWatchHandlers(getWindow)` — mirrors `registerFileSystemHandlers`.
  Handles `FileWatchChannel.Watch(root)` and `Unwatch(root)`; maintains
  `Map<string root, FSWatcher>`.
- Each watcher: `chokidar.watch(root, { ignoreInitial: true, ignored:
  [**/node_modules/**, **/.git/**, **/dist/**], awaitWriteFinish: {
  stabilityThreshold: 100 } })`. On `add`/`change`/`unlink`, after the
  self-write filter, `getWindow()?.webContents.send(FileWatchChannel.Changed, {
  path: absPath, kind })`.
- **Self-write suppression:** module-level `recentWrites: Map<string, number>`
  (absPath → timestamp). `noteInternalWrite(absPath)` records `Date.now()`; a
  watcher event whose path is in `recentWrites` within a 1000 ms window is
  dropped and the entry cleared. Exported so `filesystem.ts` calls it before
  each `writeText`/`writeBytes`/`rename`/`rm`. Paths normalized
  (same absolute form the watcher emits).
- Watcher errors (`error` event: EPERM, ENOSPC, EMFILE) are logged and swallowed
  — a failed watcher degrades the feature silently, never crashes.

**`src/shared/file-watch-api.ts` (new).**
- `enum FileWatchChannel { Watch = 'fs-watch:watch', Unwatch = 'fs-watch:unwatch',
  Changed = 'fs-watch:changed' }`.
- `enum FileChangeKind { Added = 'add', Changed = 'change', Removed = 'unlink' }`.
- `interface FileChangeEvent { path: string; kind: FileChangeKind }`.
- `interface IFileWatchApi { watch(root): Promise<void>; unwatch(root):
  Promise<void>; onChanged(cb: (e: FileChangeEvent) => void): () => void }`.

**`src/preload/index.ts` (modify).** Add `fileWatch` to the `api` object:
`watch`/`unwatch` via `ipcRenderer.invoke`; `onChanged(cb)` wrapping
`ipcRenderer.on(FileWatchChannel.Changed, (_e, evt) => cb(evt))` and returning an
unsubscribe — identical shape to the agent `onEvent`.

**`src/main/index.ts` (modify).** Call `registerFileWatchHandlers` at startup
alongside `registerFileSystemHandlers`. On app quit, close all watchers.

**`FileWatchService` (renderer, new — `src/renderer/src/services/file-watch/`).**
- `extends ServiceBase`. Wraps `window.api.fileWatch`.
- Subscribes to project open/close (from the project host — `ProjectExplorer`
  side) to call `watch(root)` / `unwatch(root)`.
- Subscribes `onChanged`; on each event raises a typed `ExternalChange` the app
  can fan out (a small event emitter / observable on the service). It does **not**
  itself know about editors or panels — pure watch + normalize + broadcast.

### Consumers (subscribe to `FileWatchService.ExternalChange`)

- **Editor reload** — lives where the open-doc registries live. For a changed
  absolute path: check `CodeEditorService.open` (abs-path key) and, for each
  `docPaths` entry, compare `op.Storage.ResolveOsPath(rel)` to the event path.
  On a match:
  - `kind = Removed` → mark the document (e.g. a badge / leave to user; do not
    auto-close in v1).
  - clean buffer → `doc` reloads (`file.read()` → set `Content`; `savedContent`
    updates so `IsDirty` stays false).
  - dirty buffer → show `ConfirmDialogModel("<name> changed on disk. Reload and
    lose your unsaved edits?", "Reload", close)` via `DialogService`; on
    confirm, reload; on cancel, keep the buffer (leave `IsDirty`).
- **Panel rescan** — `MetaModelsService`, `LibrariesPanelService`,
  `ArchTermsPaletteService` subscribe and call their existing `Reload()`,
  debounced (~250 ms) per service so a burst of file events collapses to one
  rescan.

## Error handling

- Watcher registration failure or runtime `error` → log, drop that watcher, keep
  the app fully functional (feature simply off for that project).
- Debounce (main-side `awaitWriteFinish` + renderer-side rescan debounce) absorbs
  editor atomic-save churn (write-temp + rename) and rapid multi-file writes.
- Self-write suppression prevents Plexus's own `writeText`/`rename`/`delete` from
  echoing back as external changes.
- A `Changed` event for a path that matches no open document and no project just
  no-ops in the editor consumer (the rescan consumer still debounce-reloads).

## Testing

**Main — `src/main/tests/file-watcher.test.ts`:**
- External write to a watched temp dir emits a `Changed` event (real chokidar,
  temp dir, `awaitWriteFinish`).
- A path passed to `noteInternalWrite` immediately before the write is **not**
  emitted (self-write suppressed); a later external write to the same path **is**
  emitted (suppression window expires / one-shot).
- `Unwatch(root)` stops further events.
- Ignored globs (`node_modules`) produce no event.

**Renderer — `src/renderer/src/services/file-watch/tests/file-watch-service.test.ts`
and the editor-reload consumer's test:**
- With a fake preload bridge, an incoming `Changed` for an open, **clean**
  document triggers a reload (`file.read` called, `Content` set, `IsDirty`
  false).
- Same for a **dirty** document triggers the `DialogService` prompt, and confirm
  → reload, cancel → buffer unchanged and still dirty.
- Path matching: a project-relative doc whose `ResolveOsPath` equals the event
  path matches; a non-matching path does not.
- Rescan consumer: N rapid events collapse to a single debounced `Reload()`.
- Project open/close drives `watch`/`unwatch` exactly once each.

All test files live in `tests/` subfolders (per Plexus CLAUDE.md).

## Out of scope (v1)

- Auto-closing editors on external delete (v1 badges/marks; no auto-close).
- Watching files outside any open project (only project roots + already-open
  out-of-project files that the editor consumer matches by absolute path; no new
  watcher is registered for the latter in v1 — deferred).
- A dedicated Problems-panel surface (unrelated; tracked elsewhere).
- Per-file (vs per-root) watching, and a settings toggle to disable the feature
  (can be added later; the watcher already degrades silently on error).

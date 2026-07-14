# Storage Abstraction — Design

**Date:** 2026-07-14
**Status:** Approved (design), pending implementation plan
**Repos touched:** `Plexus` only (no Mural change, no republish)

## Goal

Introduce a storage-provider seam so Plexus projects can be backed by
interchangeable storage backends — local file system now, REST API / cloud /
network share later — without the project/document code knowing which backend
it sits on. Ship the seam with a single local-FS backend behind it; additional
backends are added later against a stable interface.

## Context — what exists today

The just-built Projects feature persists everything through
`FileSystemService`, a renderer-side mural service that wraps the Electron
`window.api.fs` bridge (absolute OS paths, native dialogs, IPC to the main
process). It is already a *portability* seam — the renderer never touches
`node:fs` — but it is **single-backend and absolute-path-based**: one
implementation, hard-wired to local disk.

Consumers that currently reach `FileSystemService` directly:

- `DiagramProjectFactory` — `ReadText`/`WriteText`/`ListDirectory` over
  absolute paths, for manifest read/write and folder scanning.
- `FileDiagramStorage` — `WriteText(absolutePath, json)` behind mural's
  `DiagramStorage` seam.
- `ProjectExplorerService` — `OpenFolder` (pick a project), `ReadText`
  (manifest envelope), `OpenExternal` (open a non-diagram attachment in the OS
  app).

All three thread **absolute paths**. This design re-roots them onto a
project-relative `IStorage` and leaves `FileSystemService` unchanged underneath.

## Decisions (settled during brainstorming)

- **Driver:** abstraction first, one backend. Design the seam properly; ship
  only the local-FS backend behind it. YAGNI on the rest.
- **Interface shape:** file-system-shaped — `ReadText`/`WriteText`/`Exists`/
  `Delete`/`List` over hierarchical path strings. Matches current consumers;
  remote backends emulate a tree via prefix listing when they arrive.
- **Binding granularity:** per-project. Opening a project constructs one
  `IStorage`; the factory's file ops flow through it. Different projects can
  live on different backends simultaneously.
- **Rooting:** project-relative. An `IStorage` is rooted at a project; every
  method takes a path relative to that root. Portable to cloud (root = container
  id, path = key). Local-only concerns move to a separate optional capability.
- **Registration weight:** a plain renderer-side registry, **not** a
  Mural-declarative `.storageProviders` module block. With one backend and
  everything living in Plexus, module-contribution machinery + a Mural
  republish is unearned. Promote to declarative contribution if/when modules
  need to contribute backends.

## Architecture

```
ProjectExplorerService (generic host)
        │  on open: registry.Create(backendId, location) → IStorage (rooted)
        ▼
   IProjectFactory  ── takes IStorage ──►  IStorage  (project-relative, FS-shaped)
   (DiagramProjectFactory)                    │
        │                                     ├─ LocalFileStorage  (the one backend)
        │  diagram files                      │        │ joins root+relative → absolute
        ▼                                     │        ▼
   FileDiagramStorage ── takes IStorage ──►   │   FileSystemService  (unchanged Electron seam)
                                              │        │
   optional, feature-tested:                 │        ▼
   ILocalFileAccess (OpenExternal / OS path) │   window.api.fs → main → node:fs
```

New code lives under `Plexus/src/renderer/src/services/storage/`.
`FileSystemService` and the shared `IFileSystemApi` IPC contract are untouched —
`LocalFileStorage` is a thin adapter over the existing service.

## API

### `IStorage` — the universal contract (rooted, FS-shaped)

Every backend must satisfy this. All paths are **project-relative** (POSIX-style
`/` separators inside the interface; the local backend translates to OS
separators). The empty string `''` addresses the root.

```ts
export interface StorageEntry {
    Name:        string
    IsDirectory: boolean
}

export interface IStorage {
    // Opaque, human-readable descriptor of where this storage is rooted —
    // an absolute OS folder locally, a container id/URL remotely. For display
    // and diagnostics only; never parsed or joined by consumers.
    readonly Root: string

    ReadText(path: string): Promise<string>
    WriteText(path: string, content: string): Promise<void>
    Exists(path: string): Promise<boolean>
    Delete(path: string): Promise<void>
    // Lists one directory (non-recursive). `path === ''` lists the root.
    List(path: string): Promise<readonly StorageEntry[]>
}
```

### `ILocalFileAccess` — optional local-only capability

Concerns that only a disk-backed store can honor. A backend **may** also
implement this; consumers feature-test before using it.

```ts
export interface ILocalFileAccess {
    // Project-relative → absolute OS path (for tooling that needs a real path).
    ResolveOsPath(path: string): string
    // Reveal/open a resource in the OS default application.
    OpenExternal(path: string): Promise<void>
}

export function isLocalFileAccess(s: IStorage): s is IStorage & ILocalFileAccess {
    return typeof (s as Partial<ILocalFileAccess>).OpenExternal === 'function'
}
```

A cloud backend simply won't implement `ILocalFileAccess`; the "open attachment
in OS app" affordance disables itself via `isLocalFileAccess`.

### `LocalFileStorage` — the one backend

Implements both `IStorage` and `ILocalFileAccess`. Constructed rooted at an
absolute folder; joins `root + relative → absolute` (separator-aware, reusing
the small path helpers already in the factory) and delegates every call to
`FileSystemService`.

```ts
export class LocalFileStorage implements IStorage, ILocalFileAccess {
    constructor(private readonly root: string, private readonly fs: FileSystemService) {}

    get Root(): string { return this.root }

    ReadText(path: string)               { return this.fs.ReadText(this.abs(path)) }
    WriteText(path: string, c: string)   { return this.fs.WriteText(this.abs(path), c) }
    Exists(path: string)                 { return this.fs.Exists(this.abs(path)) }
    Delete(path: string)                 { return this.fs.Delete(this.abs(path)) }
    async List(path: string): Promise<readonly StorageEntry[]> {
        const entries = await this.fs.ListDirectory(this.abs(path))
        return entries.map(e => ({ Name: e.Name, IsDirectory: e.IsDirectory }))
    }

    ResolveOsPath(path: string): string  { return this.abs(path) }
    OpenExternal(path: string)           { return this.fs.OpenExternal(this.abs(path)) }

    private abs(relative: string): string { /* join(root, relative), separator-aware */ }
}
```

### `StorageProviderRegistry` — backend selection

A plain renderer service (mirrors `ProjectFactoryRegistry` in spirit, but stays
in Plexus with no mural declarative block). Maps a backend id → a factory that
builds a rooted `IStorage` for a location. Seeded with `'local'`.

```ts
export type StorageProviderFactory = (location: string) => IStorage

export class StorageProviderRegistry extends ServiceBase {
    static readonly Key = new ServiceKey<StorageProviderRegistry>('StorageProviderRegistry')
    static readonly DefaultBackendId = 'local'

    Register(id: string, factory: StorageProviderFactory): void
    Create(id: string, location: string): IStorage   // throws if id unregistered
    Has(id: string): boolean
}
```

`'local'` is registered at construction: `(location) => new LocalFileStorage(location,
this.Provider.getRequired(FileSystemService.Key))`. Registered as a root
singleton in `app.mu`'s `.services:` block.

## How it threads through the Projects feature (the refactor)

The seam only becomes real once the current absolute-path consumers move onto
`IStorage`. Deltas, file by file:

### `IProjectFactory` (`services/projects/project-factory.ts`)

Methods take an `IStorage` instead of a folder string / the global service. The
factory reads its manifest via `storage.ReadText(PROJECT_MANIFEST_FILENAME)` and
scans via `storage.List('')`.

```ts
createProject(storage: IStorage, name: string): Promise<Project>
openProject(storage: IStorage): Promise<Project>
saveProject(project: Project, storage: IStorage): Promise<void>
openFile(storage: IStorage, path: string): Promise<IDocument>   // path project-relative
saveFile(document: IDocument): Promise<void>
newFile(storage: IStorage, format: string, name: string): Promise<string> // returns relative path
```

### `Project` / `ProjectNode` (`services/projects/project.ts`)

- `ProjectNode.Path` becomes **project-relative** (was absolute).
- `Project.RootPath` is retained as the storage's `Root` descriptor (display),
  renamed in intent to "the location string" — value unchanged for local.
- No structural change to the Model shape; only the semantics of `Path`.

### `DiagramProjectFactory` (`modules/diagram/services/diagram-project-factory.ts`)

- Drops its `fs` getter; every `this.fs.X(absolutePath)` becomes
  `storage.X(relativePath)`.
- `populate` recurses using relative paths (`join(node.Path, entry.Name)` where
  `node.Path` is now relative; the root node's path is `''`).
- Constructs `FileDiagramStorage(relativePath, storage, seed)`.

### `FileDiagramStorage` (`modules/diagram/persistence/file-diagram-storage.ts`)

- Constructor takes `(path: string, storage: IStorage, seed: string | null)`
  instead of `(Path, FileSystemService, seed)`.
- `SetItem` → `this.pending = this.storage.WriteText(this.path, value)`.
- The synchronous-cache / async-write pattern and `WhenWritten()` are unchanged.

### `ProjectExplorerService` (`modules/project-explorer/services/project-explorer-service.ts`)

- On open/create: after resolving the factory, read the manifest envelope's
  optional `storage` field (default `StorageProviderRegistry.DefaultBackendId`),
  `registry.Create(backendId, folder)` → rooted `IStorage`, and hand it to the
  factory. Hold the active `IStorage` alongside `activeFactory`.
- `OpenFolder` stays (local-only "locate a project" affordance — see Deferred).
- `openNode` OS-open path: feature-test `isLocalFileAccess(this.activeStorage)`
  before calling `OpenExternal(node.Path)`; if unsupported, the node is inert
  (or opens in-app when it's a diagram).
- `saveActive` / `newDiagram` / manifest read all route through the active
  `IStorage` rather than `this.fs`.

### `ProjectManifestEnvelope` (`services/projects/project-factory.ts`)

Gains one optional field:

```ts
export interface ProjectManifestEnvelope {
    type:     string
    name?:    string
    version?: number
    storage?: string   // backend id; absent ⇒ 'local'
}
```

## Error handling

- `IStorage` methods reject the same way `FileSystemService` does today (an IPC
  error surfaces as a rejected promise). Existing `try/catch → Status = ...`
  blocks in `ProjectExplorerService` are unchanged in shape.
- `StorageProviderRegistry.Create` throws synchronously for an unregistered
  backend id; the explorer catches it and reports
  `Unknown storage backend "<id>"` in the status line (a project whose manifest
  names a backend this build doesn't ship).
- `isLocalFileAccess` returning false is **not** an error — it's the designed
  path for backends that can't open in the OS; the affordance quietly no-ops.

## Testing

- **`IStorage` is trivially fakeable** — an in-memory `Map<string,string>`
  implementation (`FakeStorage`) with no Electron. New unit tests:
  - `DiagramProjectFactory` against `FakeStorage`: create → manifest written;
    open → tree scanned; newFile → empty diagram round-trips; openFile/saveFile
    persist the scene. No IPC, no disk.
  - `FileDiagramStorage` against `FakeStorage`: `SetItem` writes through;
    `GetItem` serves the seed; `WhenWritten()` resolves after the write.
  - `StorageProviderRegistry`: `'local'` pre-registered; `Create` returns a
    `LocalFileStorage`; unknown id throws; `Has` reflects registration.
- **`LocalFileStorage`** gets a thin test with a stub `FileSystemService`
  asserting it joins root+relative correctly and delegates each method
  (including `ResolveOsPath`/`OpenExternal`), and that `isLocalFileAccess`
  reports true for it.
- Existing 13 Plexus tests must stay green; the refactor is behavior-preserving
  for the local backend.

## What's done vs. deferred

**Done (the Projects feature this refactors):** generic `ProjectExplorerService`
host, `DiagramProjectFactory`, native `DiagramStorage`-backed `.diagram`
persistence, recursive tree UI, mural `.projectFactories` plumbing (published
0.1.12). All committed; awaiting in-app validation.

**This spec builds:** `IStorage` + `ILocalFileAccess` + `StorageEntry`
contracts; `LocalFileStorage`; `StorageProviderRegistry` (seeded `'local'`);
the refactor threading all project/document persistence onto `IStorage`;
the `storage?` manifest field; the unit-test suite over a fake storage.

**Deferred (noted, not built):**
- **Additional backends** — REST API, cloud, network share. The seam admits
  them; none are implemented. A remote backend emulates the FS tree via prefix
  listing and omits `ILocalFileAccess`.
- **Backend-specific "locate a project" affordance.** Picking a project is
  itself backend-specific (the folder dialog is local-only). For one backend
  the `OpenFolder` dialog stays. When a second backend lands, each provider
  needs its own locate/browse UI — the next seam.
- **Declarative module-contributed backends** (`.storageProviders` in
  `.module.mu`, mirroring `.projectFactories`). Only worthwhile once modules —
  not just app wiring — need to contribute backends; requires a Mural change +
  republish.
- **Streaming / binary / large-file APIs.** `IStorage` is text + directory
  listing only, matching current needs (JSON manifests, `.diagram` JSON). Binary
  blobs and streaming are out of scope until a consumer needs them.

## File structure summary

```
Plexus/src/renderer/src/services/storage/
  storage.ts                     # IStorage, StorageEntry, ILocalFileAccess, isLocalFileAccess
  local-file-storage.ts          # LocalFileStorage (adapter over FileSystemService)
  storage-provider-registry.ts   # StorageProviderRegistry (seeded 'local')
  tests/
    local-file-storage.test.ts
    storage-provider-registry.test.ts
    fake-storage.ts              # in-memory IStorage for factory/document tests
```

Modified: `services/projects/project-factory.ts`, `services/projects/project.ts`,
`modules/diagram/services/diagram-project-factory.ts`,
`modules/diagram/persistence/file-diagram-storage.ts`,
`modules/project-explorer/services/project-explorer-service.ts`,
`app.mu` (register `StorageProviderRegistry`).

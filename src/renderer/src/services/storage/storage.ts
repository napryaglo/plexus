// storage.ts — the storage-provider seam.
//
// IStorage is the universal, file-system-shaped contract a project is persisted
// through. It is ROOTED at a project: every path is project-relative (POSIX
// `/` separators inside the interface; a backend translates to its own scheme),
// and the empty string '' addresses the root. This lets a project live on the
// local disk today and a REST/cloud/network backend later without the project
// or document code knowing which — they only ever see relative paths.
//
// FileSystemService (the Electron seam) stays underneath, unchanged; the local
// backend (LocalFileStorage) is a thin adapter over it. See the design spec:
// docs/superpowers/specs/2026-07-14-storage-abstraction-design.md.

// One entry in a directory listing — mirrors the low-level FileEntry but is the
// storage-layer shape consumers bind to (kept separate so IStorage owns its
// vocabulary rather than leaking the IPC contract).
export interface StorageEntry
{
    Name:        string
    IsDirectory: boolean
}

// The universal storage contract. Every backend must satisfy this. All paths
// are project-relative; `Root` is an opaque, human-readable descriptor of where
// the storage is rooted (an absolute OS folder locally, a container id/URL
// remotely) — for display/diagnostics only, never parsed or joined.
export interface IStorage
{
    readonly Root: string

    ReadText(path: string): Promise<string>
    WriteText(path: string, content: string): Promise<void>
    Exists(path: string): Promise<boolean>
    Delete(path: string): Promise<void>
    // Lists one directory (non-recursive). `path === ''` lists the root.
    List(path: string): Promise<readonly StorageEntry[]>
}

// Optional, local-only capability a backend MAY also implement — concerns only
// a disk-backed store can honor. Consumers feature-test with isLocalFileAccess
// before using it; a cloud backend omits it and the affordance disables itself.
export interface ILocalFileAccess
{
    // Project-relative → absolute OS path (for tooling that needs a real path).
    ResolveOsPath(path: string): string
    // Reveal/open a resource in the OS default application.
    OpenExternal(path: string): Promise<void>
}

// Type guard: does this storage also offer local-file access?
export function isLocalFileAccess(storage: IStorage): storage is IStorage & ILocalFileAccess
{
    return typeof (storage as Partial<ILocalFileAccess>).OpenExternal === 'function'
}

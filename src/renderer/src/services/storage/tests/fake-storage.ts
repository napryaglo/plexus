import type { IStorage, StorageEntry } from '../storage.js'

// FakeStorage — an in-memory IStorage for unit tests: a flat Map of
// project-relative path → text content, with List() deriving a directory view
// from the key prefixes. No Electron, no disk. Because it satisfies the whole
// IStorage contract, the project factory and FileDiagramStorage can be tested
// with real read/write/list behavior and zero host plumbing.
//
// It deliberately does NOT implement ILocalFileAccess — so it also exercises the
// isLocalFileAccess feature-test path (a backend without OS access).
export class FakeStorage implements IStorage
{
    public readonly Root: string
    private readonly files = new Map<string, string>()
    // Explicitly-created directories (so empty folders register for Exists/List,
    // which the file-prefix derivation alone can't represent).
    private readonly dirs = new Set<string>()

    constructor(root = 'fake://project')
    {
        this.Root = root
    }

    public ReadText(path: string): Promise<string>
    {
        const key = normalize(path)
        const value = this.files.get(key)
        if (value === undefined) return Promise.reject(new Error(`ENOENT: ${key}`))
        return Promise.resolve(value)
    }

    public WriteText(path: string, content: string): Promise<void>
    {
        this.files.set(normalize(path), content)
        return Promise.resolve()
    }

    // Store bytes as a binary (latin1) string so the file registers for
    // Exists/List/size; content round-trips losslessly through fromCharCode.
    public WriteBytes(path: string, bytes: Uint8Array): Promise<void>
    {
        this.files.set(normalize(path), String.fromCharCode(...bytes))
        return Promise.resolve()
    }

    public Exists(path: string): Promise<boolean>
    {
        const key = normalize(path)
        if (this.files.has(key) || this.dirs.has(key)) return Promise.resolve(true)
        // A directory "exists" if any file or subdirectory sits under it.
        const prefix = key + '/'
        for (const k of this.files.keys()) if (k.startsWith(prefix)) return Promise.resolve(true)
        for (const d of this.dirs) if (d.startsWith(prefix)) return Promise.resolve(true)
        return Promise.resolve(false)
    }

    // Remove a file or a directory with its whole subtree — mirroring the local
    // backend's `rm(path, { recursive: true })`, so deleting a folder takes its
    // descendants (files and subdirs) with it, not just the bare directory key.
    public Delete(path: string): Promise<void>
    {
        const key = normalize(path)
        this.files.delete(key)
        this.dirs.delete(key)
        const prefix = key + '/'
        for (const k of [...this.files.keys()]) if (k.startsWith(prefix)) this.files.delete(k)
        for (const d of [...this.dirs]) if (d.startsWith(prefix)) this.dirs.delete(d)
        return Promise.resolve()
    }

    // Record the directory and each of its ancestors (recursive-mkdir semantics).
    public CreateDirectory(path: string): Promise<void>
    {
        let key = normalize(path)
        while (key !== '') { this.dirs.add(key); key = parentOf(key) }
        return Promise.resolve()
    }

    // Move `from` (a file or directory) to `to`, rewriting the key of the entry
    // itself and — for a directory — every descendant file/dir prefix.
    public Rename(from: string, to: string): Promise<void>
    {
        const src = normalize(from)
        const dst = normalize(to)
        const rewrite = (key: string): string | undefined =>
            key === src ? dst
                : key.startsWith(src + '/') ? dst + key.slice(src.length)
                    : undefined
        for (const [key, value] of [...this.files]) {
            const next = rewrite(key)
            if (next !== undefined) { this.files.delete(key); this.files.set(next, value) }
        }
        for (const key of [...this.dirs]) {
            const next = rewrite(key)
            if (next !== undefined) { this.dirs.delete(key); this.dirs.add(next) }
        }
        return Promise.resolve()
    }

    public List(path: string): Promise<readonly StorageEntry[]>
    {
        const dir = normalize(path)
        const prefix = dir === '' ? '' : dir + '/'
        const children = new Map<string, boolean>()   // name → isDirectory
        for (const key of this.files.keys()) {
            if (!key.startsWith(prefix)) continue
            const rest = key.slice(prefix.length)
            if (rest === '') continue
            const slash = rest.indexOf('/')
            if (slash === -1) children.set(rest, children.get(rest) ?? false)
            else children.set(rest.slice(0, slash), true)   // a folder always wins
        }
        for (const d of this.dirs) {
            if (!d.startsWith(prefix)) continue
            const rest = d.slice(prefix.length)
            if (rest === '') continue
            const slash = rest.indexOf('/')
            children.set(slash === -1 ? rest : rest.slice(0, slash), true)
        }
        return Promise.resolve([...children].map(([Name, IsDirectory]) => ({ Name, IsDirectory })))
    }

    // Test-only: how many files are stored (for assertions).
    public get size(): number { return this.files.size }
}

// Strip leading/trailing slashes and collapse separators so keys are canonical.
function normalize(path: string): string
{
    return path.split(/[\\/]/).filter((s) => s.length > 0).join('/')
}

// The parent of a normalized key ('' for a top-level entry).
function parentOf(key: string): string
{
    const slash = key.lastIndexOf('/')
    return slash === -1 ? '' : key.slice(0, slash)
}

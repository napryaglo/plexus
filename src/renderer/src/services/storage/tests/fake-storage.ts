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

    public Exists(path: string): Promise<boolean>
    {
        const key = normalize(path)
        if (this.files.has(key)) return Promise.resolve(true)
        // A directory "exists" if any file sits under it.
        const prefix = key + '/'
        for (const k of this.files.keys()) if (k.startsWith(prefix)) return Promise.resolve(true)
        return Promise.resolve(false)
    }

    public Delete(path: string): Promise<void>
    {
        this.files.delete(normalize(path))
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

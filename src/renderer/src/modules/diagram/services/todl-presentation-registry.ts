import { Application, ResourceDictionary, ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import type { DataTemplate } from '@pragmatic-lab/mural/basic'

// A single visual-template source contributing to the registry. Each source has a
// stable id (idempotency key for registerSource) and returns an async map of
// string key → DataTemplate on each discover() run.
export interface PresentationSource
{
    id: string
    load(): Promise<Map<string, DataTemplate>>
}

// App-global registry that aggregates every registered PresentationSource's visual
// templates into one ResourceDictionary, merged into Application.Resources as a
// single atomic swap so downstream DynamicResource consumers receive one
// merged-dictionary notification (O(1)) rather than one per key entry.
//
// resolve() reads the owned aggregate reference so it works headless (no
// Application.current). onChanged notifies subscribers after each discover().
export class TodlPresentationRegistry extends ServiceBase
{
    public static readonly Key = new ServiceKey<TodlPresentationRegistry>('TodlPresentationRegistry')

    // Registered sources keyed by their stable id — idempotent: re-registering the
    // same id replaces the previous entry.
    private readonly sources = new Map<string, PresentationSource>()

    // The currently owned aggregate ResourceDictionary. resolve() reads from here,
    // so headless (no Application.current) callers still work. Rebuilt wholesale on
    // each discover().
    private aggregate = new ResourceDictionary()
    // The currently merged ResourceDictionary instance (may be undefined when no
    // discover() has succeeded yet or the last discover produced zero entries and
    // the skip-if-empty rule applied).
    private merged: ResourceDictionary | undefined

    private readonly listeners = new Set<(key: string) => void>()

    constructor(provider: IServiceProvider)
    {
        super(provider)
        // The initial empty aggregate is a placeholder so headless resolve() before
        // any discover() returns undefined; it is replaced wholesale on the first
        // discover(). The meaningful StyleParticipating opt-out lives on `next`
        // inside discover() (the dict actually merged into the app resources).
    }

    // Register a source by id. Idempotent: re-registering the same id replaces the
    // previous entry (the new source's entries take effect on the next discover()).
    public registerSource(src: PresentationSource): void
    {
        this.sources.set(src.id, src)
    }

    // Run all registered sources and atomically swap the aggregate into
    // Application.Resources (one merged-dictionary swap → O(1) notifications).
    // Skip the swap when the next dict is empty AND was never merged, so a
    // zero-entry discover fires zero app-resource notifications.
    // resolve() and onChanged work headless (no Application.current needed).
    public async discover(): Promise<void>
    {
        const next = new ResourceDictionary()
        next.StyleParticipating = false

        // Collect string keys as we populate, so we can fire typed notifications
        // after the swap without iterating ResourceDictionary.Entries() (whose
        // ResourceKey = string | Function type does not satisfy the string callback).
        // Deduplicate: two sources may declare the same key, but a key must notify
        // exactly once per discover().
        const keys = new Set<string>()
        for (const source of this.sources.values()) {
            const map = await source.load()
            for (const [k, v] of map) { next.Set(k, v); keys.add(k) }
        }

        // Swap into app resources. Skip an empty-and-never-merged swap so the
        // no-source case fires zero app-resource notifications.
        if (keys.size > 0 || this.merged !== undefined) {
            Application.current?.Resources.ReplaceMergedDictionary(this.merged, next)
            this.merged = next
        }
        // Update owned reference so resolve() always reads the latest dict.
        this.aggregate = next

        // Notify subscribers for every key in the newly populated aggregate.
        for (const key of keys) {
            for (const cb of [...this.listeners]) cb(key)
        }
    }

    // Look up a key in the owned aggregate. Fully synchronous; returns undefined for
    // unknown keys. Works headless (reads this.aggregate, not Application.Resources).
    public resolve(key: string): DataTemplate | undefined
    {
        return this.aggregate.Resolve(key) as DataTemplate | undefined
    }

    // Subscribe to key-level change notifications fired after each discover().
    // Returns an unsubscribe function.
    public onChanged(cb: (key: string) => void): () => void
    {
        this.listeners.add(cb)
        return () => { this.listeners.delete(cb) }
    }
}

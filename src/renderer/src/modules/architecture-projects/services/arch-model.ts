import type { ModelDraft, Repository, Entity } from '@pragmatic-lab/todl'
import type { IStorage } from '../../../services/storage/storage.js'

// One viewpoint's projection over the model: the concepts it frames and the
// entities visible through it (an entity is a member when its concept is framed
// by this viewpoint, subtype-aware via Repository.viewpointsFraming).
export interface Viewpoint
{
    id: string
    framedConcepts: string[]
    members: Entity[]
}

// A live, per-project architecture model. Wraps a ModelDraft (bases ∪ own
// instances) and projects it through the meta-model's viewpoints. Read surface
// only here; mutation + save arrive in Task 2.
export class ArchModel
{
    public constructor(
        protected readonly draft: ModelDraft,
        protected readonly storage: IStorage,
        public readonly namespace: string,
    ) {}

    public entities(): Entity[]
    {
        return this.draft.ownInstances()
    }

    public repository(): Repository
    {
        return this.draft.model
    }

    public viewpoints(): Viewpoint[]
    {
        const repo = this.draft.model
        const ents = this.entities()
        return repo.viewpoints().map((id) => ({
            id,
            framedConcepts: repo.frames(id),
            members: ents.filter((e) => repo.viewpointsFraming(e.concept).includes(id)),
        }))
    }

    // Subscribers notified after any mutation, so SP4 diagrams can refresh.
    // ModelDraft has no events; ArchModel owns them.
    private readonly listeners = new Set<() => void>()

    public onChanged(cb: () => void): () => void
    {
        this.listeners.add(cb)
        return () => { this.listeners.delete(cb) }
    }

    private fire(): void
    {
        for (const cb of this.listeners) cb()
    }

    // Create an own instance. homeUri routes it to a source file for save();
    // viewpoint→file routing (first-suitable) is SP4's concern.
    public create(concept: string, id: string, homeUri?: string): Entity
    {
        const e = this.draft.create(concept, id, homeUri)
        this.fire()
        return e
    }

    public setField(id: string, name: string, value: string): void
    {
        this.draft.setField(id, name, value)
        this.fire()
    }

    public addRef(from: string, member: string, to: string): void
    {
        this.draft.addRef(from, member, to)
        this.fire()
    }

    public removeRef(from: string, member: string, to: string): void
    {
        this.draft.removeRef(from, member, to)
        this.fire()
    }

    public remove(id: string): void
    {
        this.draft.remove(id)
        this.fire()
    }

    // Persist every home file the draft partitions its own delta into.
    public async save(): Promise<void>
    {
        for (const [uri, text] of this.draft.toTodlByFile())
            await this.storage.WriteText(uri, text)
    }

    // The home file (source uri) an own entity round-trips to.
    public homeOf(id: string): string | undefined
    {
        return this.draft.homeOf(id)
    }

    // The file that conforms to `vp`: an existing own entity's home whose
    // `conforms` attr is `vp`, else a fresh `<vp>.todl` (lowercased).
    public homeForViewpoint(vp: string): string
    {
        for (const e of this.entities()) {
            if (this.repository().resolve(e.id)?.attrs.get('conforms') === vp) {
                const h = this.draft.homeOf(e.id)
                if (h !== undefined) return h
            }
        }
        return `${vp.toLowerCase()}.todl`
    }

    // Create a new own instance of `concept`, routed to `vp`'s file and stamped
    // `conforms = vp` so toTodlByFile emits that file's `conforms vp` header.
    public createInViewpoint(concept: string, vp: string): Entity
    {
        const id = this.uniqueId(concept)
        const e = this.draft.create(concept, id, this.homeForViewpoint(vp))
        this.draft.setField(id, 'conforms', vp)
        this.fire()
        return e
    }

    // Re-fire the change signal (used by the drop after wiring a Figure so the
    // binding rescans and binds the new node).
    public notifyChanged(): void
    {
        this.fire()
    }

    // A model-unique id: `concept1`, `concept2`, … Numbered from 1 so it never
    // collides with the concept node itself (which shares the lowercased name).
    public uniqueId(concept: string): string
    {
        const base = concept.toLowerCase()
        let i = 1
        while (this.repository().resolve(`${base}${i}`) !== undefined) i++
        return `${base}${i}`
    }
}

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
}

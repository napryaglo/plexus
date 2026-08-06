import { ModelDraft, Repository, graphFromJSON, type TodlDocument, type JsonNode, type FieldSchema } from '@pragmatic-lab/todl'

// The editable instance model behind an architecture-diagram document.
//
// A thin Plexus wrapper over TODL's mutable `ModelDraft`: the draft owns the
// delta, mutation, schema queries, and `.todl` emission; this layer keeps only
// the Plexus-facing concerns — id-allocation policy (`freshId`) and UI
// reactivity (`onChanged`). Every mutating call fans out to the listeners.
export class ArchInstanceModel
{
    private readonly listeners = new Set<() => void>()
    private seq = 0

    private constructor(
        private readonly draft: ModelDraft,
        public readonly namespace: string,
    )
    {}

    // Compile the instance source against the bases into an editable draft. An
    // empty source starts empty. Bases arrive as documents; the draft wants
    // Repositories, so wrap each one.
    public static load(bases: readonly TodlDocument[], instanceSource: string, namespace: string): ArchInstanceModel
    {
        const baseRepos = bases.map((d) => new Repository(graphFromJSON(d)))
        const draft = ModelDraft.fromSource(baseRepos, instanceSource, { namespace })
        return new ArchInstanceModel(draft, namespace)
    }

    // The own instance ids (leaf concept instances, not locally-declared classes).
    public ownInstances(): string[]
    {
        return this.draft.toJSON().nodes
            .filter((n) => n.tier === 'Instance' && (n.attrs as Record<string, unknown>).class !== true)
            .map((n) => n.id)
    }

    public node(id: string): JsonNode | undefined { return this.draft.toJSON().nodes.find((n) => n.id === id) }

    // The own document (for layout/persistence + emit).
    public get document(): TodlDocument { return this.draft.toJSON() }

    // Append a fresh concept instance; returns its generated id.
    public createInstance(concept: string): string
    {
        const id = this.freshId(concept)
        this.draft.create(concept, id)
        this.mutated()
        return id
    }

    public setField(id: string, name: string, value: string | number | boolean): void
    {
        this.draft.setField(id, name, value)
        this.mutated()
    }

    public addRelationship(from: string, member: string, to: string): void
    {
        this.draft.addRef(from, member, to)
        this.mutated()
    }

    public removeRelationship(from: string, member: string, to: string): void
    {
        this.draft.removeRef(from, member, to)
        this.mutated()
    }

    // Remove an instance and every edge that touches it.
    public remove(id: string): void
    {
        this.draft.remove(id)
        this.mutated()
    }

    // A Repository over bases + own, for schema queries.
    public repository(): Repository { return this.draft.model }

    // The reference members of `fromId`'s concept that `toId` could fill.
    public referenceMembers(fromId: string, toId: string): FieldSchema[]
    {
        return this.draft.referenceMembers(fromId, toId)
    }

    public emit(): string { return this.draft.toTodl() }

    public onChanged(listener: () => void): () => void
    {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    private freshId(concept: string): string
    {
        const stem = concept.slice(concept.lastIndexOf('.') + 1)
        let id = `${stem}-${++this.seq}`
        while (this.draft.has(id)) id = `${stem}-${++this.seq}`
        return id
    }

    private mutated(): void
    {
        for (const l of this.listeners) l()
    }
}

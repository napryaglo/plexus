import { checkAgainst, fromJSON, toJSON, type TodlDocument, type JsonNode, type Repository, type FieldSchema } from '@pragmatic-lab/todl'

import { emitInstances } from './todl-emitter.js'

// The editable instance model behind an architecture-diagram document.
//
// TODL's graph is ADD-ONLY (no node/edge removal), so the mutable source of truth
// is the OWN `TodlDocument` ({nodes, edges}) — just this project's concept
// instances + reference edges. A `Repository` is DERIVED on demand (fromJSON of
// bases + own) for schema queries; the emitter turns the own document back into
// `.todl` source. Adds append to the own doc, deletes filter it — so delete works
// despite TODL's add-only graph.
export class ArchInstanceModel
{
    private readonly listeners = new Set<() => void>()
    private repoCache: Repository | undefined
    private seq = 0

    private constructor(
        private own: TodlDocument,
        private readonly bases: readonly TodlDocument[],
        private readonly baseIds: ReadonlySet<string>,
        public readonly namespace: string,
    )
    {}

    // Compile the instance source against the bases, then keep only the non-base
    // nodes/edges as the own document. An empty source starts empty.
    public static load(bases: readonly TodlDocument[], instanceSource: string, namespace: string): ArchInstanceModel
    {
        const baseIds = new Set<string>()
        for (const b of bases) for (const n of b.nodes) baseIds.add(n.id)

        let own: TodlDocument = { nodes: [], edges: [] }
        if (instanceSource.trim().length > 0) {
            const full = toJSON(checkAgainst([...bases], [{ uri: `${namespace}.todl`, text: instanceSource }]).model)
            own = {
                nodes: full.nodes.filter((n) => !baseIds.has(n.id)),
                edges: full.edges.filter((e) => !baseIds.has(String(e.from))),
            }
        }
        return new ArchInstanceModel(own, bases, baseIds, namespace)
    }

    // The own instance ids (leaf concept instances, not locally-declared classes).
    public ownInstances(): string[]
    {
        return this.own.nodes
            .filter((n) => n.tier === 'Instance' && (n.attrs as Record<string, unknown>).class !== true)
            .map((n) => n.id)
    }

    public node(id: string): JsonNode | undefined { return this.own.nodes.find((n) => n.id === id) }

    // The own document (for layout/persistence + emit).
    public get document(): TodlDocument { return this.own }

    // Append a fresh concept instance; returns its generated id.
    public createInstance(concept: string): string
    {
        const id = this.freshId(concept)
        this.own.nodes.push({ id, tier: 'Instance', typeOf: concept, attrs: { id } })
        this.mutated()
        return id
    }

    public setField(id: string, name: string, value: string | number | boolean): void
    {
        const n = this.node(id)
        if (n === undefined) return
        ;(n.attrs as Record<string, unknown>)[name] = value
        this.mutated()
    }

    public addRelationship(from: string, member: string, to: string): void
    {
        this.own.edges.push({ kind: 'Relationship', via: member, from, to })
        this.mutated()
    }

    public removeRelationship(from: string, member: string, to: string): void
    {
        this.own.edges = this.own.edges.filter(
            (e) => !(e.kind === 'Relationship' && e.from === from && e.via === member && e.to === to))
        this.mutated()
    }

    // Remove an instance and every edge that touches it.
    public remove(id: string): void
    {
        this.own.nodes = this.own.nodes.filter((n) => n.id !== id)
        this.own.edges = this.own.edges.filter((e) => e.from !== id && e.to !== id)
        this.mutated()
    }

    // A Repository over bases + own, rebuilt on mutation, for schema queries.
    public repository(): Repository
    {
        if (this.repoCache === undefined) {
            // Bases overlap — a library base (compiled via checkAgainst) carries the
            // meta-model's nodes too — so dedup nodes by id and edges by identity
            // before fromJSON, which rejects duplicates.
            const nodes = new Map<string, JsonNode>()
            for (const n of [...this.bases.flatMap((b) => b.nodes), ...this.own.nodes]) nodes.set(n.id, n)
            const edges = new Map<string, TodlDocument['edges'][number]>()
            for (const e of [...this.bases.flatMap((b) => b.edges), ...this.own.edges]) {
                edges.set(`${e.kind}|${e.from}|${e.to}|${e.via}`, e)
            }
            this.repoCache = fromJSON({ nodes: [...nodes.values()], edges: [...edges.values()] })
        }
        return this.repoCache
    }

    // The reference members of `fromId`'s concept that `toId` could fill — the
    // concept-typed FIELDS (e.g. `realised-by : technology`) whose type `toId` is
    // (or is a subtype of). Used to resolve a connector (or a term drop) to the
    // member that links the node to a term. Primitive-typed fields (`label :
    // string`) never match a concept target, so they fall out naturally.
    public referenceMembers(fromId: string, toId: string): FieldSchema[]
    {
        const repo = this.repository()
        const fromConcept = repo.resolve(fromId)?.typeOf
        const toConcept = repo.resolve(toId)?.typeOf
        if (fromConcept === undefined || toConcept === undefined) return []
        const compatible = new Set([toConcept, ...repo.supertypesOf(toConcept)])
        return repo.effectiveSchema(fromConcept).fields.filter((f) => compatible.has(f.type))
    }

    public emit(): string { return emitInstances(this.own, this.namespace) }

    public onChanged(listener: () => void): () => void
    {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    private freshId(concept: string): string
    {
        const stem = concept.slice(concept.lastIndexOf('.') + 1)
        let id = `${stem}-${++this.seq}`
        while (this.node(id) !== undefined || this.baseIds.has(id)) id = `${stem}-${++this.seq}`
        return id
    }

    private mutated(): void
    {
        this.repoCache = undefined
        for (const l of this.listeners) l()
    }
}

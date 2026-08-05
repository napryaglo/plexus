import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import type { TodlDocument } from '@pragmatic-lab/todl'

import type { IStorage } from '../storage/storage.js'
import { ProjectExplorerService } from '../../modules/project-explorer/services/project-explorer-service.js'
import { ensureMetaModelsBackend } from '../../modules/meta-model/services/meta-models-backend.js'
import { ensureLibrariesBackend } from '../../modules/library/services/libraries-backend.js'
import { TodlLanguageClient } from '../todl/todl-language-client.js'
import type { OpenProject } from './open-project.js'
import type { BaseRef } from './base-binding.js'
import { PROJECT_MANIFEST_FILENAME, ProducerKind, isProducer } from './project-factory.js'

// The normalized manifest fields the resolver reads (modelVersion/libVersion
// unified to `version`).
interface ProjManifest
{
    type:       string
    id?:        string
    version?:   string
    metaModel?: BaseRef
    libraries?: readonly BaseRef[]
}

// A snapshot of the open set, rebuilt when OpenProjects changes: producers keyed
// by `<kind>:<id>` (+ their version), and every project's outbound binding ids.
interface Snapshot
{
    producers: Map<string, { project: OpenProject; version: string | undefined }>
    consumers: { project: OpenProject; producedId: string | undefined; refIds: Set<string> }[]
}

// Resolves a project's bases local-first: an open producer (meta-model/library)
// whose manifest id matches a binding is compiled live (via its factory's
// compileToDocument) instead of read from the published registry. Recursive
// (a producer's own bases resolve the same way), cycle-guarded, self-excluding.
// Publish does NOT use this — it stays on resolveBases (published only).
export class WorkspaceBaseResolver extends ServiceBase
{
    public static readonly Key = new ServiceKey<WorkspaceBaseResolver>('WorkspaceBaseResolver')

    private snapshot: Snapshot | undefined
    private previousProducerKeys = new Set<string>()

    constructor(provider: IServiceProvider)
    {
        super(provider)
        // Signal B: rebuild the snapshot and refresh dependents whose resolution
        // could have flipped when the open set changes (open/close). Subscribed
        // once here; the explorer exists by the time this service is resolved.
        const explorer = this.Provider.get(ProjectExplorerService.Key)
        explorer?.OpenProjects.Subscribe(() => { this.snapshot = undefined; void this.onOpenSetChanged() })
    }

    // Resolve a consumer's declared bases, preferring open producers.
    public async ResolveForStorage(consumerStorage: IStorage): Promise<{ bases: TodlDocument[]; problems: string[] }>
    {
        return this.resolveBindingsOf(consumerStorage, new Set<IStorage>([consumerStorage]))
    }

    // The producer id this storage publishes, or undefined if it is not a producer.
    public producedIdOf(storage: IStorage): string | undefined
    {
        const snap = this.snapshot
        if (snap === undefined) return undefined
        for (const c of snap.consumers) if (c.project.Storage === storage) return c.producedId
        return undefined
    }

    // Open projects whose bindings reference `id` (direct dependents).
    public dependentsOf(id: string): OpenProject[]
    {
        const snap = this.snapshot
        if (snap === undefined) return []
        return snap.consumers.filter((c) => c.refIds.has(id)).map((c) => c.project)
    }

    // Refresh (revalidate) every open project that transitively depends on any of
    // the given producer ids, via the language client's per-storage base refresh.
    public async RefreshDependentsOfIds(ids: readonly string[]): Promise<void>
    {
        await this.ensureSnapshot()
        const client = this.Provider.get(TodlLanguageClient.Key)
        const seenIds = new Set<string>()
        const toRefresh = new Set<IStorage>()
        const queue = [...ids]
        while (queue.length > 0)
        {
            const id = queue.shift()!
            if (seenIds.has(id)) continue
            seenIds.add(id)
            for (const dep of this.dependentsOf(id))
            {
                toRefresh.add(dep.Storage)
                const depId = this.producedIdOf(dep.Storage)
                if (depId !== undefined) queue.push(depId)
            }
        }
        for (const storage of toRefresh) await client?.RefreshBases(storage)
    }

    // ── internals ──

    private async resolveBindingsOf(
        storage: IStorage, visited: Set<IStorage>,
    ): Promise<{ bases: TodlDocument[]; problems: string[] }>
    {
        const manifest = await this.readManifest(storage)
        const bases: TodlDocument[] = []
        const problems: string[] = []
        if (manifest?.metaModel !== undefined)
            await this.resolveOne(manifest.metaModel, ProducerKind.MetaModel, storage, visited, bases, problems)
        for (const lib of manifest?.libraries ?? [])
            await this.resolveOne(lib, ProducerKind.Library, storage, visited, bases, problems)
        return { bases, problems }
    }

    private async resolveOne(
        ref: BaseRef, kind: ProducerKind, consumerStorage: IStorage,
        visited: Set<IStorage>, bases: TodlDocument[], problems: string[],
    ): Promise<void>
    {
        const producer = await this.findOpenProducer(kind, ref.id)
        if (producer !== undefined && producer.Storage !== consumerStorage
            && !visited.has(producer.Storage) && isProducer(producer.Factory))
        {
            // `visited` is the current DFS path (ancestors), not a global seen-set:
            // add on entry, remove on exit (backtrack). This catches genuine cycles
            // — a producer still on the path — while allowing diamonds, where the
            // same producer (e.g. a meta-model bound by both the architecture and
            // one of its libraries) is reached by two independent branches.
            visited.add(producer.Storage)
            const child = await this.resolveBindingsOf(producer.Storage, visited)
            visited.delete(producer.Storage)
            problems.push(...child.problems)
            const compiled = await producer.Factory.compileToDocument(producer.Storage, child.bases, this.Provider)
            for (const p of compiled.problems) problems.push(`local ${kind} "${ref.id}" — ${p}`)
            const pv = (await this.readManifest(producer.Storage))?.version
            if (pv !== undefined && pv !== ref.version)
                problems.push(`using local "${ref.id}" (open project) — binding requests @${ref.version}, project is @${pv}`)
            bases.push(compiled.doc)
            return
        }
        if (producer !== undefined && visited.has(producer.Storage))
            problems.push(`cyclic local reference to "${ref.id}"; using published`)
        // Published fallback — mirrors resolveBases' inner read().
        const backend = kind === ProducerKind.MetaModel
            ? ensureMetaModelsBackend(this.Provider)
            : ensureLibrariesBackend(this.Provider)
        try {
            bases.push(JSON.parse(await backend.ReadText(`${ref.id}/${ref.version}/model.json`)) as TodlDocument)
        } catch {
            problems.push(`${kind} "${ref.id}@${ref.version}" is not published`)
        }
    }

    private async findOpenProducer(kind: ProducerKind, id: string): Promise<OpenProject | undefined>
    {
        const snap = await this.ensureSnapshot()
        return snap.producers.get(`${kind}:${id}`)?.project
    }

    private async ensureSnapshot(): Promise<Snapshot>
    {
        if (this.snapshot !== undefined) return this.snapshot
        const explorer = this.Provider.getRequired(ProjectExplorerService.Key)
        const producers = new Map<string, { project: OpenProject; version: string | undefined }>()
        const consumers: Snapshot['consumers'] = []
        for (const op of explorer.OpenProjects.ToArray())
        {
            const m = await this.readManifest(op.Storage)
            if (m === undefined) continue
            let producedId: string | undefined
            if ((m.type === ProducerKind.MetaModel || m.type === ProducerKind.Library) && m.id !== undefined)
            {
                producers.set(`${m.type}:${m.id}`, { project: op, version: m.version })
                producedId = m.id
            }
            const refIds = new Set<string>()
            if (m.metaModel?.id !== undefined) refIds.add(m.metaModel.id)
            for (const l of m.libraries ?? []) if (l.id !== undefined) refIds.add(l.id)
            consumers.push({ project: op, producedId, refIds })
        }
        this.snapshot = { producers, consumers }
        return this.snapshot
    }

    private async readManifest(storage: IStorage): Promise<ProjManifest | undefined>
    {
        try {
            const m = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as {
                type: string; id?: string; modelVersion?: string; libVersion?: string
                metaModel?: BaseRef; libraries?: readonly BaseRef[]
            }
            return { type: m.type, id: m.id, version: m.modelVersion ?? m.libVersion, metaModel: m.metaModel, libraries: m.libraries }
        } catch {
            return undefined
        }
    }

    // Signal B: on open/close, refresh dependents of any producer id that
    // appeared or disappeared (their resolution flips local<->published).
    private async onOpenSetChanged(): Promise<void>
    {
        const snap = await this.ensureSnapshot()
        const now = new Set(snap.producers.keys())
        const changedIds: string[] = []
        for (const key of now) if (!this.previousProducerKeys.has(key)) changedIds.push(key.split(':')[1]!)
        for (const key of this.previousProducerKeys) if (!now.has(key)) changedIds.push(key.split(':')[1]!)
        this.previousProducerKeys = now
        if (changedIds.length > 0) await this.RefreshDependentsOfIds(changedIds)
    }
}

export default WorkspaceBaseResolver

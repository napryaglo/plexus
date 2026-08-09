import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { ModelDraft, Repository, graphFromJSON, parse, type SourceFile } from '@pragmatic-lab/todl'

import { WorkspaceBaseResolver } from '../../../services/projects/workspace-base-resolver.js'
import { collectTodlSources } from '../../meta-model/services/todl-sources.js'
import type { OpenProject } from '../../project-explorer/services/open-project.js'
import { ArchModel } from './arch-model.js'

// App-scoped: one live ArchModel per open architecture project, keyed by the
// project's stable RootPath. Built lazily from the project's resolved bases
// (meta-model + libraries) plus every .todl file in its storage, composed via
// ModelDraft.fromSources. Dropped when the project closes (Task 4 wires that).
export class ArchitectureModelService extends ServiceBase
{
    public static readonly Key = new ServiceKey<ArchitectureModelService>('ArchitectureModelService')

    private readonly models = new Map<string, ArchModel>()

    public constructor(provider: IServiceProvider) { super(provider) }

    // Lazy build + cache. Idempotent: a second call returns the cached model.
    public async modelFor(op: OpenProject): Promise<ArchModel>
    {
        const key = op.Project.RootPath
        const cached = this.models.get(key)
        if (cached !== undefined) return cached

        const resolver = this.Provider.getRequired(WorkspaceBaseResolver.Key)
        const { bases } = await resolver.ResolveForStorage(op.Storage)
        const sources = await collectTodlSources(op.Storage)
        const namespace = deriveNamespace(sources, op.Project.Name)
        const baseRepos = bases.map((d) => new Repository(graphFromJSON(d)))
        const draft = ModelDraft.fromSources(baseRepos, sources, { namespace })

        const model = new ArchModel(draft, op.Storage, namespace)
        this.models.set(key, model)
        return model
    }

    public peek(rootPath: string): ArchModel | undefined
    {
        return this.models.get(rootPath)
    }

    public close(rootPath: string): void
    {
        this.models.delete(rootPath)
    }
}

// The project's model namespace is the namespace the first .todl file declares;
// with no sources, fall back to the project name.
function deriveNamespace(sources: readonly SourceFile[], fallback: string): string
{
    const first = sources[0]
    if (first === undefined) return fallback
    return parse(first.text, first.uri).namespace.path || fallback
}

import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { check, toJSON, Severity } from '@pragmatic-lab/todl'

import {
    PROJECT_MANIFEST_FILENAME,
    type IProjectFactory,
    type IPublishableProjectFactory,
    type ProjectFileFormat,
    type ProjectManifestEnvelope,
    type PublishResult,
} from '../../../services/projects/project-factory.js'
import { Project, ProjectNode, type ProjectNodeKind } from '../../../services/projects/project.js'
import { compareStorageEntries, type IStorage } from '../../../services/storage/storage.js'
import { ensureMetaModelsBackend } from './meta-models-backend.js'
import { ensureScaffold } from './meta-model-scaffold.js'
import { collectTodlSources, extname, joinRel } from './todl-sources.js'

// The 'meta-model' project type's factory — the meta-model module's contribution
// to the generic ProjectExplorerService (declared via `.projectFactories:` and
// resolved through the ProjectFactoryRegistry). It owns the project lifecycle;
// the `.todl` FILE format is edited by TodlDocumentFactory (resolved by
// extension) — editors own files, this factory owns the project.
//
// It is also publishable (IPublishableProjectFactory): publish validates every
// `.todl` in the project with TODL's check(), and — if clean — writes the
// compiled TodlDocument JSON plus the raw sources into the shared meta-models
// backend under `<id>/<modelVersion>/`, where other project types consume it.
//
// All persistence flows through the project's IStorage (rooted, project-relative
// paths); the factory never sees an absolute path or the raw file system.
interface MetaModelManifest extends ProjectManifestEnvelope
{
    id:           string   // stable publish identity, defaults to slugify(name)
    modelVersion: string   // published version, defaults to '0.1.0'
}

export class MetaModelProjectFactory extends ServiceBase implements IProjectFactory, IPublishableProjectFactory
{
    public static readonly Key = new ServiceKey<MetaModelProjectFactory>('MetaModelProjectFactory')
    public static readonly ProjectType = 'meta-model'

    public readonly formats: readonly ProjectFileFormat[] = [
        { extension: '.todl', kind: 'todl', displayName: 'TODL Definition' },
    ]

    constructor(provider: IServiceProvider) { super(provider) }

    public async createProject(storage: IStorage, name: string): Promise<Project>
    {
        const manifest: MetaModelManifest = {
            type: MetaModelProjectFactory.ProjectType, name, version: 1,
            id: slugify(name), modelVersion: '0.1.0',
        }
        await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))
        // Lay down the agent-support scaffold (CLAUDE.md + .claude/) so an agent
        // working in the project has the TODL rules + manual from the start.
        await ensureScaffold(storage)
        return this.buildProject(storage, manifest)
    }

    public async openProject(storage: IStorage): Promise<Project>
    {
        const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as MetaModelManifest
        // Self-heal: write any missing scaffold file (never overwrites the
        // author's edits) so existing projects gain it too.
        await ensureScaffold(storage)
        return this.buildProject(storage, manifest)
    }

    public async saveProject(project: Project, storage: IStorage): Promise<void>
    {
        // Preserve the publish identity (id / modelVersion); only the name tracks
        // the project.
        const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as MetaModelManifest
        manifest.name = project.Name
        await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))
    }

    // Validate every `.todl` together; if clean, emit the compiled model + copy
    // the sources into the meta-models backend under `<id>/<modelVersion>/`.
    public async publish(_project: Project, storage: IStorage, provider: IServiceProvider): Promise<PublishResult>
    {
        const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as MetaModelManifest
        const sources = await collectTodlSources(storage)
        if (sources.length === 0) return { ok: false, message: 'Nothing to publish — the project has no .todl files.' }

        const { model, diagnostics } = check(sources)
        const errors = diagnostics.filter((d) => d.severity === Severity.Error)
        if (errors.length > 0)
            return { ok: false, message: `Publish blocked: ${errors.length} error(s). Fix them first.` }

        const dest = ensureMetaModelsBackend(provider)
        const base = `${manifest.id}/${manifest.modelVersion}`
        await dest.WriteText(`${base}/model.json`, JSON.stringify(toJSON(model), null, 2))
        for (const s of sources) await dest.WriteText(`${base}/src/${s.uri}`, s.text)
        return { ok: true, message: `Published ${manifest.id}@${manifest.modelVersion} (${sources.length} file(s)).` }
    }

    private async buildProject(storage: IStorage, manifest: MetaModelManifest): Promise<Project>
    {
        const rootName = basename(storage.Root)
        const root = new ProjectNode(rootName, '', 'folder')   // the root node's path is ''
        await this.populate(storage, root)
        return new Project(manifest.type, manifest.name ?? rootName, storage.Root, root)
    }

    // Recursively fill a folder node's children from storage. The manifest file
    // is hidden; `.todl` files are marked openable (kind 'todl'). Node paths are
    // project-relative (POSIX `/`); the root node's path is ''.
    private async populate(storage: IStorage, node: ProjectNode): Promise<void>
    {
        const entries = [...await storage.List(node.Path)].sort(compareStorageEntries)
        for (const e of entries) {
            if (node.Path === '' && e.Name === PROJECT_MANIFEST_FILENAME) continue
            const childPath = joinRel(node.Path, e.Name)
            const kind: ProjectNodeKind = e.IsDirectory
                ? 'folder'
                : extname(e.Name) === '.todl' ? 'todl' : 'file'
            const child = new ProjectNode(e.Name, childPath, kind)
            node.Children.Add(child)
            if (e.IsDirectory) await this.populate(storage, child)
        }
    }
}

// ── helpers ──
function slugify(name: string): string
{
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'meta-model'
}

function basename(p: string): string
{
    const parts = p.split(/[\\/]/)
    return parts[parts.length - 1] || p
}

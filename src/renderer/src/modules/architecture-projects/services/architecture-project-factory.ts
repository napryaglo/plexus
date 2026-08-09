import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'

import {
    PROJECT_MANIFEST_FILENAME,
    type IProjectFactory,
    type ProjectFileFormat,
    type ProjectManifestEnvelope,
} from '../../../services/projects/project-factory.js'
import type { BaseBindings, BaseRef } from '../../../services/projects/base-binding.js'
import { Project, ProjectNode, type ProjectNodeKind } from '../../../services/projects/project.js'
import { compareStorageEntries, type IStorage } from '../../../services/storage/storage.js'

// The 'architecture' project type — the architecture-projects module's
// contribution to the generic ProjectExplorerService (declared via
// `.projectFactories:`, resolved through the ProjectFactoryRegistry). It is a
// TODL-authoring project: its `.todl` files are the instance-tier architecture
// model, validated live against the project's BOUND bases — a meta-model AND a
// set of libraries — by the shared base-aware TodlValidationService (which reads
// the manifest's metaModel + libraries via resolveBases). Architecture is the
// terminal consumer: it binds bases but publishes nothing, so it is not an
// IPublishableProjectFactory.
//
// The `.todl` FILE format is edited by the meta-model module's TodlDocumentFactory
// (resolved by extension) — editors own files, this factory owns the project. All
// persistence flows through the project's rooted IStorage (project-relative paths).
interface ArchitectureManifest extends ProjectManifestEnvelope
{
    metaModel?: BaseRef                  // the meta-model this architecture conforms to
    libraries?: readonly BaseRef[]       // the technology libraries it draws on
}

export class ArchitectureProjectFactory extends ServiceBase implements IProjectFactory
{
    public static readonly Key = new ServiceKey<ArchitectureProjectFactory>('ArchitectureProjectFactory')
    public static readonly ProjectType = 'architecture'

    public readonly requiresMetaModel = true
    public readonly offersLibraries = true

    public readonly formats: readonly ProjectFileFormat[] = [
        { extension: '.diagram', kind: 'diagram', displayName: 'Diagram' },
        { extension: '.todl',    kind: 'todl',    displayName: 'TODL Definition' },
    ]

    constructor(provider: IServiceProvider) { super(provider) }

    public async createProject(storage: IStorage, name: string, bindings?: BaseBindings): Promise<Project>
    {
        const manifest: ArchitectureManifest = {
            type: ArchitectureProjectFactory.ProjectType, name, version: 1,
            ...(bindings?.metaModel !== undefined ? { metaModel: bindings.metaModel } : {}),
            ...(bindings?.libraries !== undefined && bindings.libraries.length > 0
                ? { libraries: bindings.libraries } : {}),
        }
        await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))
        return this.buildProject(storage, manifest)
    }

    public async openProject(storage: IStorage): Promise<Project>
    {
        const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as ArchitectureManifest
        return this.buildProject(storage, manifest)
    }

    public async saveProject(project: Project, storage: IStorage): Promise<void>
    {
        // Preserve the bindings (metaModel / libraries); only the name tracks the project.
        const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as ArchitectureManifest
        manifest.name = project.Name
        await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))
    }

    private async buildProject(storage: IStorage, manifest: ArchitectureManifest): Promise<Project>
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
                : extname(e.Name) === '.diagram' ? 'diagram'
                    : extname(e.Name) === '.todl' ? 'todl' : 'file'
            const child = new ProjectNode(e.Name, childPath, kind)
            node.Children.Add(child)
            if (e.IsDirectory) await this.populate(storage, child)
        }
    }
}

// ── project-relative path helpers (POSIX `/`; the storage backend translates) ──
function joinRel(dir: string, name: string): string
{
    return dir === '' ? name : dir + '/' + name
}

function basename(p: string): string
{
    const parts = p.split(/[\\/]/)
    return parts[parts.length - 1] || p
}

function extname(name: string): string
{
    const i = name.lastIndexOf('.')
    return i > 0 ? name.slice(i).toLowerCase() : ''
}

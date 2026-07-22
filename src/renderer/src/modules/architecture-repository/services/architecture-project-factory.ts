import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'

import {
    PROJECT_MANIFEST_FILENAME,
    type IProjectFactory,
    type ProjectFileFormat,
    type ProjectManifestEnvelope,
} from '../../../services/projects/project-factory.js'
import { Project, ProjectNode, type ProjectNodeKind } from '../../../services/projects/project.js'
import { compareStorageEntries, type IStorage } from '../../../services/storage/storage.js'

// The 'architecture' project type — the architecture-repository module's
// contribution to the generic ProjectExplorerService (declared via
// `.projectFactories:`, resolved through the ProjectFactoryRegistry). It owns the
// project lifecycle only: a folder whose manifest type is "architecture" scans
// into a tree, with `.diagram` files marked openable. The `.diagram` FILE format
// is edited by the diagram module's DiagramDocumentFactory (resolved by
// extension) — editors own files, this factory owns the project.
//
// All persistence flows through the project's IStorage (rooted, project-relative
// paths); the factory never sees an absolute path or the raw file system.
interface ArchitectureManifest extends ProjectManifestEnvelope {}

export class ArchitectureProjectFactory extends ServiceBase implements IProjectFactory
{
    public static readonly Key = new ServiceKey<ArchitectureProjectFactory>('ArchitectureProjectFactory')
    public static readonly ProjectType = 'architecture'

    public readonly formats: readonly ProjectFileFormat[] = [
        { extension: '.diagram', kind: 'diagram', displayName: 'Diagram' },
    ]

    constructor(provider: IServiceProvider) { super(provider) }

    public async createProject(storage: IStorage, name: string): Promise<Project>
    {
        const manifest: ArchitectureManifest = { type: ArchitectureProjectFactory.ProjectType, name, version: 1 }
        await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))
        return this.buildProject(storage, manifest)
    }

    public async openProject(storage: IStorage): Promise<Project>
    {
        const text = await storage.ReadText(PROJECT_MANIFEST_FILENAME)
        const manifest = JSON.parse(text) as ArchitectureManifest
        return this.buildProject(storage, manifest)
    }

    public async saveProject(project: Project, storage: IStorage): Promise<void>
    {
        const manifest: ArchitectureManifest = { type: project.Type, name: project.Name, version: 1 }
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
    // is hidden; `.diagram` files are marked openable (kind 'diagram'). Node paths
    // are project-relative (POSIX `/`); the root node's path is ''.
    private async populate(storage: IStorage, node: ProjectNode): Promise<void>
    {
        const entries = [...await storage.List(node.Path)].sort(compareStorageEntries)
        for (const e of entries) {
            if (node.Path === '' && e.Name === PROJECT_MANIFEST_FILENAME) continue
            const childPath = joinRel(node.Path, e.Name)
            const kind: ProjectNodeKind = e.IsDirectory
                ? 'folder'
                : extname(e.Name) === '.diagram' ? 'diagram' : 'file'
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

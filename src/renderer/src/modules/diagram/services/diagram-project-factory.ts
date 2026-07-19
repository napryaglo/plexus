import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { DiagramDocument, type IDocument } from '@pragmatic-lab/mural/framework'

import {
    PROJECT_MANIFEST_FILENAME,
    type IProjectFactory,
    type IRelocatableFileFactory,
    type ProjectFileFormat,
    type ProjectManifestEnvelope,
} from '../../../services/projects/project-factory.js'
import { Project, ProjectNode, type ProjectNodeKind } from '../../../services/projects/project.js'
import type { IStorage } from '../../../services/storage/storage.js'
import { FileDiagramStorage } from '../persistence/file-diagram-storage.js'

// The 'architecture' project type's factory — the diagram module's contribution
// to the generic ProjectExplorerService (declared via `.projectFactories:` and
// resolved through the ProjectFactoryRegistry). It owns the `.diagram` format:
// a diagram file is a DiagramDocument persisted through mural's native
// Save()/Load() over a FileDiagramStorage (so the full scene round-trips).
//
// All persistence flows through the project's IStorage (rooted, project-relative
// paths) — the factory never sees an absolute path or the raw file system, so
// the backend (local FS today, cloud/REST later) is transparent to it.
//
// v1 derives the file tree by scanning storage; the manifest carries only the
// type/name envelope (explicit diagram/attachment curation is a follow-up).
interface ArchitectureManifest extends ProjectManifestEnvelope {}

export class DiagramProjectFactory extends ServiceBase implements IProjectFactory, IRelocatableFileFactory
{
    public static readonly Key = new ServiceKey<DiagramProjectFactory>('DiagramProjectFactory')
    public static readonly ProjectType = 'architecture'

    public readonly formats: readonly ProjectFileFormat[] = [
        { extension: '.diagram', kind: 'diagram', displayName: 'Diagram' },
    ]

    constructor(provider: IServiceProvider) { super(provider) }

    public async createProject(storage: IStorage, name: string): Promise<Project>
    {
        const manifest: ArchitectureManifest = { type: DiagramProjectFactory.ProjectType, name, version: 1 }
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

    public async openFile(storage: IStorage, path: string): Promise<IDocument>
    {
        const text = await storage.ReadText(path)
        const store = new FileDiagramStorage(path, storage, text)
        const doc = new DiagramDocument(store)
        doc.Load()
        doc.Title = basename(path)
        return doc
    }

    public async saveFile(document: IDocument): Promise<void>
    {
        const doc = document as DiagramDocument
        doc.Save()
        const store = doc.Storage
        if (store instanceof FileDiagramStorage) await store.WhenWritten()
    }

    // Re-point an open diagram after its file was renamed on storage: re-target
    // the FileDiagramStorage (so later Save()s write to the new path) and retitle
    // the tab. The in-memory scene is untouched.
    public relocateOpenFile(document: IDocument, newPath: string): void
    {
        const doc = document as DiagramDocument
        const store = doc.Storage
        if (store instanceof FileDiagramStorage) store.Path = newPath
        doc.Title = basename(newPath)
    }

    public async newFile(storage: IStorage, _format: string, name: string): Promise<string>
    {
        const path = ensureExtension(name, '.diagram')   // project-relative, at the root
        const store = new FileDiagramStorage(path, storage, null)
        const doc = new DiagramDocument(store)
        doc.Save()   // writes an empty scene
        await store.WhenWritten()
        return path
    }

    private async buildProject(storage: IStorage, manifest: ArchitectureManifest): Promise<Project>
    {
        const rootName = basename(storage.Root)
        const root = new ProjectNode(rootName, '', 'folder')   // the root node's path is ''
        await this.populate(storage, root)
        return new Project(manifest.type, manifest.name ?? rootName, storage.Root, root)
    }

    // Recursively fill a folder node's children from storage. The manifest file
    // itself is hidden; `.diagram` files are marked as openable diagrams. Node
    // paths are project-relative (POSIX `/`); the root node's path is ''.
    private async populate(storage: IStorage, node: ProjectNode): Promise<void>
    {
        const entries = await storage.List(node.Path)
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

function ensureExtension(name: string, ext: string): string
{
    return name.toLowerCase().endsWith(ext) ? name : name + ext
}

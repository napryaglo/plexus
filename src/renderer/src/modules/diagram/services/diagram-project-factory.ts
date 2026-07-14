import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { DiagramDocument, type IDocument } from '@pragmatic-lab/mural/framework'

import { FileSystemService } from '../../../services/file-system/file-system-service.js'
import {
    PROJECT_MANIFEST_FILENAME,
    type IProjectFactory,
    type ProjectFileFormat,
    type ProjectManifestEnvelope,
} from '../../../services/projects/project-factory.js'
import { Project, ProjectNode, type ProjectNodeKind } from '../../../services/projects/project.js'
import { FileDiagramStorage } from '../persistence/file-diagram-storage.js'

// The 'architecture' project type's factory — the diagram module's contribution
// to the generic ProjectExplorerService (declared via `.projectFactories:` and
// resolved through the ProjectFactoryRegistry). It owns the `.diagram` format:
// a diagram file is a DiagramDocument persisted through mural's native
// Save()/Load() over a FileDiagramStorage (so the full scene round-trips).
//
// v1 derives the file tree by scanning the folder; the manifest carries only
// the type/name envelope (explicit diagram/attachment curation is a follow-up).
interface ArchitectureManifest extends ProjectManifestEnvelope {}

export class DiagramProjectFactory extends ServiceBase implements IProjectFactory
{
    public static readonly Key = new ServiceKey<DiagramProjectFactory>('DiagramProjectFactory')
    public static readonly ProjectType = 'architecture'

    public readonly formats: readonly ProjectFileFormat[] = [
        { extension: '.diagram', kind: 'diagram', displayName: 'Diagram' },
    ]

    constructor(provider: IServiceProvider) { super(provider) }

    private get fs(): FileSystemService { return this.Provider.getRequired(FileSystemService.Key) }

    public async createProject(folder: string, name: string): Promise<Project>
    {
        const manifest: ArchitectureManifest = { type: DiagramProjectFactory.ProjectType, name, version: 1 }
        await this.fs.WriteText(join(folder, PROJECT_MANIFEST_FILENAME), JSON.stringify(manifest, null, 2))
        return this.buildProject(folder, manifest)
    }

    public async openProject(folder: string): Promise<Project>
    {
        const text = await this.fs.ReadText(join(folder, PROJECT_MANIFEST_FILENAME))
        const manifest = JSON.parse(text) as ArchitectureManifest
        return this.buildProject(folder, manifest)
    }

    public async saveProject(project: Project): Promise<void>
    {
        const manifest: ArchitectureManifest = { type: project.Type, name: project.Name, version: 1 }
        await this.fs.WriteText(join(project.RootPath, PROJECT_MANIFEST_FILENAME), JSON.stringify(manifest, null, 2))
    }

    public async openFile(_project: Project, path: string): Promise<IDocument>
    {
        const text = await this.fs.ReadText(path)
        const storage = new FileDiagramStorage(path, this.fs, text)
        const doc = new DiagramDocument(storage)
        doc.Load()
        doc.Title = basename(path)
        return doc
    }

    public async saveFile(document: IDocument): Promise<void>
    {
        const doc = document as DiagramDocument
        doc.Save()
        const storage = doc.Storage
        if (storage instanceof FileDiagramStorage) await storage.WhenWritten()
    }

    public async newFile(project: Project, _format: string, name: string): Promise<string>
    {
        const path = join(project.RootPath, ensureExtension(name, '.diagram'))
        const storage = new FileDiagramStorage(path, this.fs, null)
        const doc = new DiagramDocument(storage)
        doc.Save()   // writes an empty scene
        await storage.WhenWritten()
        return path
    }

    private async buildProject(folder: string, manifest: ArchitectureManifest): Promise<Project>
    {
        const root = new ProjectNode(basename(folder), folder, 'folder')
        await this.populate(root)
        return new Project(manifest.type, manifest.name ?? basename(folder), folder, root)
    }

    // Recursively fill a folder node's children from disk. The manifest file
    // itself is hidden; `.diagram` files are marked as openable diagrams.
    private async populate(node: ProjectNode): Promise<void>
    {
        const entries = await this.fs.ListDirectory(node.Path)
        for (const e of entries) {
            if (e.Name === PROJECT_MANIFEST_FILENAME) continue
            const childPath = join(node.Path, e.Name)
            const kind: ProjectNodeKind = e.IsDirectory
                ? 'folder'
                : extname(e.Name) === '.diagram' ? 'diagram' : 'file'
            const child = new ProjectNode(e.Name, childPath, kind)
            node.Children.Add(child)
            if (e.IsDirectory) await this.populate(child)
        }
    }
}

// ── path helpers (renderer has no node:path; keep it small + separator-aware) ──
function join(dir: string, name: string): string
{
    const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
    return dir.endsWith(sep) ? dir + name : dir + sep + name
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

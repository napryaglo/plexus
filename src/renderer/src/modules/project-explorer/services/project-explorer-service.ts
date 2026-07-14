// project-explorer-service.ts — the GENERIC project host for the left panel.
//
// It owns the active Project + its tree and orchestrates open/create/save, but
// knows nothing about diagrams or file formats: it reads a folder's manifest
// envelope (project.plexus.json → `type`), routes to the matching factory via
// the framework's ProjectFactoryRegistry, and delegates. A module contributes a
// project type by declaring a `.projectFactories:` entry whose Factory resolves
// to an IProjectFactory (see the diagram module's DiagramProjectFactory).
//
// Rendered by DataTemplate[DataType=ProjectExplorerService] (project-explorer.
// resources.mu), a tree + a small command bar.
import {
    MetaData,
    Model,
    RelayCommand,
    ServiceBase,
    ServiceKey,
    type ICommand,
    type IServiceProvider,
} from '@pragmatic-lab/mural/runtime'
import {
    ContentHostService,
    ProjectFactoryRegistry,
    type DocumentsContentHostService,
    type IDocument,
} from '@pragmatic-lab/mural/framework'

import { FileSystemService } from '../../../services/file-system/file-system-service.js'
import {
    PROJECT_MANIFEST_FILENAME,
    type IProjectFactory,
    type ProjectManifestEnvelope,
} from '../../../services/projects/project-factory.js'
import type { Project, ProjectNode } from '../../../services/projects/project.js'

export class ProjectExplorerService extends ServiceBase
{
    public static readonly Key = new ServiceKey<ProjectExplorerService>('ProjectExplorerService')

    public static readonly ProjectKey = Model.RegisterProperty<Project | undefined>(
        ProjectExplorerService, 'Project', undefined, MetaData.None)
    public static readonly StatusKey = Model.RegisterProperty<string>(
        ProjectExplorerService, 'Status', 'No project open.', MetaData.None)
    public static readonly OpenProjectCommandKey = Model.RegisterProperty<ICommand>(
        ProjectExplorerService, 'OpenProjectCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly NewProjectCommandKey = Model.RegisterProperty<ICommand>(
        ProjectExplorerService, 'NewProjectCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly NewDiagramCommandKey = Model.RegisterProperty<ICommand>(
        ProjectExplorerService, 'NewDiagramCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly SaveActiveCommandKey = Model.RegisterProperty<ICommand>(
        ProjectExplorerService, 'SaveActiveCommand', undefined as unknown as ICommand, MetaData.None)

    // The factory backing the active project — captured at open/create so file
    // open + save delegate to the same type.
    private activeFactory: IProjectFactory | undefined

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.set_property_value(ProjectExplorerService.OpenProjectCommandKey, new RelayCommand(() => void this.openProject()))
        this.set_property_value(ProjectExplorerService.NewProjectCommandKey, new RelayCommand(() => void this.newProject()))
        this.set_property_value(ProjectExplorerService.NewDiagramCommandKey, new RelayCommand(() => void this.newDiagram()))
        this.set_property_value(ProjectExplorerService.SaveActiveCommandKey, new RelayCommand(() => void this.saveActive()))
    }

    public get Project(): Project | undefined { return this.get_property_value(ProjectExplorerService.ProjectKey) }
    public get Status(): string { return this.get_property_value(ProjectExplorerService.StatusKey) }
    public get OpenProjectCommand(): ICommand { return this.get_property_value(ProjectExplorerService.OpenProjectCommandKey) }
    public get NewProjectCommand(): ICommand { return this.get_property_value(ProjectExplorerService.NewProjectCommandKey) }
    public get NewDiagramCommand(): ICommand { return this.get_property_value(ProjectExplorerService.NewDiagramCommandKey) }
    public get SaveActiveCommand(): ICommand { return this.get_property_value(ProjectExplorerService.SaveActiveCommandKey) }

    private set Status(v: string) { this.set_property_value(ProjectExplorerService.StatusKey, v) }

    private get fs(): FileSystemService { return this.Provider.getRequired(FileSystemService.Key) }
    private get host(): DocumentsContentHostService
    {
        return this.Provider.getRequired(ContentHostService.Key) as DocumentsContentHostService
    }

    // Pick a folder → read its manifest envelope → route to the matching factory.
    private async openProject(): Promise<void>
    {
        const folder = await this.fs.OpenFolder({ Title: 'Open Project Folder' })
        if (folder === null) return

        let envelope: ProjectManifestEnvelope
        try {
            envelope = JSON.parse(await this.fs.ReadText(join(folder, PROJECT_MANIFEST_FILENAME))) as ProjectManifestEnvelope
        } catch {
            this.Status = `No ${PROJECT_MANIFEST_FILENAME} in that folder.`
            return
        }

        const factory = this.resolveFactory(envelope.type)
        if (factory === undefined) { this.Status = `No factory for project type "${envelope.type}".`; return }

        try {
            const project = await factory.openProject(folder)
            this.setActive(project, factory)
            this.Status = `Opened ${project.Name}.`
        } catch (e) {
            this.Status = `Open failed: ${(e as Error).message}`
        }
    }

    // Pick a folder → create a project of the first registered type.
    private async newProject(): Promise<void>
    {
        const folder = await this.fs.OpenFolder({ Title: 'Choose a folder for the new project' })
        if (folder === null) return

        const registry = this.Provider.getRequired(ProjectFactoryRegistry.Key)
        const def = registry.Definitions.ToArray()[0]
        const factory = def?.Factory !== undefined ? (this.Provider.get(def.Factory) as IProjectFactory | undefined) : undefined
        if (def === undefined || factory === undefined) { this.Status = 'No project factory registered.'; return }

        try {
            const project = await factory.createProject(folder, basename(folder))
            this.setActive(project, factory)
            this.Status = `Created ${project.Name}.`
        } catch (e) {
            this.Status = `Create failed: ${(e as Error).message}`
        }
    }

    // Create a new empty diagram file in the project root and open it.
    private async newDiagram(): Promise<void>
    {
        const project = this.Project
        if (project === undefined || this.activeFactory === undefined) { this.Status = 'Open a project first.'; return }
        try {
            const path = await this.activeFactory.newFile(project, 'diagram', `diagram-${project.Root.Children.Count + 1}`)
            // Refresh the tree so the new file appears, then open it.
            const refreshed = await this.activeFactory.openProject(project.RootPath)
            this.setActive(refreshed, this.activeFactory)
            const doc = await this.activeFactory.openFile(refreshed, path)
            this.host.Open(doc)
            this.Status = `New diagram at ${basename(path)}.`
        } catch (e) {
            this.Status = `New diagram failed: ${(e as Error).message}`
        }
    }

    // Activate a tree node: open a diagram in a tab, an other file via the OS.
    private async openNode(node: ProjectNode | undefined): Promise<void>
    {
        if (node === undefined || this.Project === undefined || this.activeFactory === undefined) return
        try {
            if (node.Kind === 'diagram') {
                const doc = await this.activeFactory.openFile(this.Project, node.Path)
                this.host.Open(doc)
                this.Status = `Opened ${node.Name}.`
            } else if (node.Kind === 'file') {
                await this.fs.OpenExternal(node.Path)
            }
        } catch (e) {
            this.Status = `Open failed: ${(e as Error).message}`
        }
    }

    // Save the active document through the active project's factory.
    private async saveActive(): Promise<void>
    {
        const doc: IDocument | undefined = this.host.ActiveDocument
        if (doc === undefined || this.activeFactory === undefined) { this.Status = 'Nothing to save.'; return }
        try {
            await this.activeFactory.saveFile(doc)
            this.Status = `Saved ${doc.Title}.`
        } catch (e) {
            this.Status = `Save failed: ${(e as Error).message}`
        }
    }

    private resolveFactory(type: string): IProjectFactory | undefined
    {
        const def = this.Provider.getRequired(ProjectFactoryRegistry.Key).GetByType(type)
        if (def?.Factory === undefined) return undefined
        return this.Provider.get(def.Factory) as IProjectFactory | undefined
    }

    private setActive(project: Project, factory: IProjectFactory): void
    {
        this.activeFactory = factory
        this.wireNode(project.Root)
        this.set_property_value(ProjectExplorerService.ProjectKey, project)
    }

    // Give every tree node an OpenCommand closing over it, so a row binds
    // `Command = $OpenCommand` (folders get one too — a no-op activation).
    private wireNode(node: ProjectNode): void
    {
        node.OpenCommand = new RelayCommand(() => void this.openNode(node))
        for (const child of node.Children.ToArray()) this.wireNode(child)
    }
}

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

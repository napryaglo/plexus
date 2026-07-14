// project-explorer-service.ts — the GENERIC project host for the left panel.
//
// It owns the active Project + its tree and orchestrates open/create/save, but
// knows nothing about diagrams or file formats: it reads a folder's manifest
// envelope (project.plexus → `type`), routes to the matching factory via
// the framework's ProjectFactoryRegistry, and delegates. A module contributes a
// project type by declaring a `.projectFactories:` entry whose Factory resolves
// to an IProjectFactory (see the diagram module's DiagramProjectFactory).
//
// Rendered by DataTemplate[DataType=ProjectExplorerService] (project-explorer.
// resources.mu), a tree + a small command bar.
import {
    MetaData,
    Model,
    ObservableCollection,
    RelayCommand,
    ServiceBase,
    ServiceKey,
    ServiceProvider,
    type ICommand,
    type IServiceProvider,
} from '@pragmatic-lab/mural/runtime'
import {
    ContentHostService,
    DialogService,
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
import {
    NewProjectDialogModel,
    ProjectTypeChoice,
    type NewProjectResult,
} from '../../../services/projects/new-project-dialog-model.js'
import {
    OpenProjectDialogModel,
    type OpenProjectResult,
} from '../../../services/projects/open-project-dialog-model.js'
import { RecentProjectsService } from '../../../services/projects/recent-projects-service.js'
import { StorageProviderRegistry } from '../../../services/storage/storage-provider-registry.js'
import { isLocalFileAccess, type IStorage } from '../../../services/storage/storage.js'

export class ProjectExplorerService extends ServiceBase
{
    public static readonly Key = new ServiceKey<ProjectExplorerService>('ProjectExplorerService')

    public static readonly ProjectKey = Model.RegisterProperty<Project | undefined>(
        ProjectExplorerService, 'Project', undefined, MetaData.None)
    // The tree's roots — a one-item collection holding the active project's root
    // node, so the recursive DataTemplate[ProjectNode] renders the whole
    // hierarchy anchored at the project (the project name + nested children),
    // not just the root's children. Empty until a project is open.
    public static readonly RootsKey = Model.RegisterProperty<ObservableCollection<ProjectNode>>(
        ProjectExplorerService, 'Roots', undefined as unknown as ObservableCollection<ProjectNode>, MetaData.None)
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

    // The factory + storage backing the active project — captured at open/create
    // so file open + save delegate to the same type through the same backend.
    private activeFactory: IProjectFactory | undefined
    private activeStorage: IStorage | undefined

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.set_property_value(ProjectExplorerService.RootsKey, new ObservableCollection<ProjectNode>())
        this.set_property_value(ProjectExplorerService.OpenProjectCommandKey, new RelayCommand(() => void this.openProject()))
        this.set_property_value(ProjectExplorerService.NewProjectCommandKey, new RelayCommand(() => void this.newProject()))
        this.set_property_value(ProjectExplorerService.NewDiagramCommandKey, new RelayCommand(() => void this.newDiagram()))
        this.set_property_value(ProjectExplorerService.SaveActiveCommandKey, new RelayCommand(() => void this.saveActive()))
    }

    public get Project(): Project | undefined { return this.get_property_value(ProjectExplorerService.ProjectKey) }
    public get Roots(): ObservableCollection<ProjectNode> { return this.get_property_value(ProjectExplorerService.RootsKey) }
    public get Status(): string { return this.get_property_value(ProjectExplorerService.StatusKey) }
    public get OpenProjectCommand(): ICommand { return this.get_property_value(ProjectExplorerService.OpenProjectCommandKey) }
    public get NewProjectCommand(): ICommand { return this.get_property_value(ProjectExplorerService.NewProjectCommandKey) }
    public get NewDiagramCommand(): ICommand { return this.get_property_value(ProjectExplorerService.NewDiagramCommandKey) }
    public get SaveActiveCommand(): ICommand { return this.get_property_value(ProjectExplorerService.SaveActiveCommandKey) }

    private set Status(v: string) { this.set_property_value(ProjectExplorerService.StatusKey, v) }

    private get fs(): FileSystemService { return this.Provider.getRequired(FileSystemService.Key) }
    private get storageRegistry(): StorageProviderRegistry
    {
        return this.Provider.getRequired(StorageProviderRegistry.Key)
    }
    private get dialogs(): DialogService { return this.Provider.getRequired(DialogService.Key) }
    private get recents(): RecentProjectsService { return this.Provider.getRequired(RecentProjectsService.Key) }
    private get host(): DocumentsContentHostService
    {
        return this.Provider.getRequired(ContentHostService.Key) as DocumentsContentHostService
    }

    // Open Project: present the recents-or-Browse dialog; open whatever folder it
    // resolves to. (Locating a project is local-only — a deferred, backend-
    // specific affordance — so Browse and recents both yield a local folder.)
    private async openProject(): Promise<void>
    {
        const recents = await this.recents.List()
        const vm = new OpenProjectDialogModel(recents, this.fs, (r) => this.dialogs.Close(r))
        const result = (await this.dialogs.Show({ Title: 'Open Project', Content: vm, Width: 480 })) as OpenProjectResult | undefined
        if (result === undefined) return
        await this.openProjectAt(result.location)
    }

    // New Project: present the full type-picker dialog; create the project in the
    // chosen folder on the default (local) backend.
    private async newProject(): Promise<void>
    {
        const choices = this.typeChoices()
        if (choices.length === 0) { this.Status = 'No project factory registered.'; return }

        const vm = new NewProjectDialogModel(
            choices,
            this.fs,
            (r) => this.validateNewProject(r),
            (r) => this.dialogs.Close(r),
        )
        const result = (await this.dialogs.Show({ Title: 'New Project', Content: vm, Width: 520 })) as NewProjectResult | undefined
        if (result === undefined) return
        await this.createProjectAt(result.type, result.name, result.location)
    }

    // Read a folder's manifest envelope → build the project's storage for the
    // backend it names → route to the matching factory → activate + record.
    private async openProjectAt(folder: string): Promise<void>
    {
        const bootstrap = this.storageRegistry.Create(StorageProviderRegistry.DefaultBackendId, folder)

        let envelope: ProjectManifestEnvelope
        try {
            envelope = JSON.parse(await bootstrap.ReadText(PROJECT_MANIFEST_FILENAME)) as ProjectManifestEnvelope
        } catch {
            this.Status = `No ${PROJECT_MANIFEST_FILENAME} in that folder.`
            return
        }

        const factory = this.resolveFactory(envelope.type)
        if (factory === undefined) { this.Status = `No factory for project type "${envelope.type}".`; return }

        let storage: IStorage
        try {
            const backendId = envelope.storage ?? StorageProviderRegistry.DefaultBackendId
            storage = backendId === StorageProviderRegistry.DefaultBackendId
                ? bootstrap
                : this.storageRegistry.Create(backendId, folder)
        } catch (e) {
            this.Status = (e as Error).message   // unknown storage backend
            return
        }

        try {
            const project = await factory.openProject(storage)
            this.setActive(project, factory, storage)
            await this.recents.Add({ name: project.Name, path: folder, type: envelope.type, openedAt: Date.now() })
            this.Status = `Opened ${project.Name}.`
        } catch (e) {
            this.Status = `Open failed: ${(e as Error).message}`
        }
    }

    // Create a project of `type` named `name` in `folder`, activate + record it.
    private async createProjectAt(type: string, name: string, folder: string): Promise<void>
    {
        const factory = this.resolveFactory(type)
        if (factory === undefined) { this.Status = `No factory for project type "${type}".`; return }

        const storage = this.storageRegistry.Create(StorageProviderRegistry.DefaultBackendId, folder)
        try {
            const project = await factory.createProject(storage, name)
            this.setActive(project, factory, storage)
            await this.recents.Add({ name: project.Name, path: folder, type, openedAt: Date.now() })
            this.Status = `Created ${project.Name}.`
        } catch (e) {
            this.Status = `Create failed: ${(e as Error).message}`
        }
    }

    // One selectable choice per registered project-type factory (Title +
    // Description straight from the ProjectFactoryDefinition).
    private typeChoices(): ProjectTypeChoice[]
    {
        return this.Provider.getRequired(ProjectFactoryRegistry.Key)
            .Definitions.ToArray()
            .map((d) => new ProjectTypeChoice(d.Type, d.Title, d.Description))
    }

    // New Project validation: refuse a folder that already holds a project.
    private async validateNewProject(result: NewProjectResult): Promise<string | null>
    {
        const storage = this.storageRegistry.Create(StorageProviderRegistry.DefaultBackendId, result.location)
        if (await storage.Exists(PROJECT_MANIFEST_FILENAME)) return 'Folder already contains a project.'
        return null
    }

    // Create a new empty diagram file in the project root and open it.
    private async newDiagram(): Promise<void>
    {
        const project = this.Project
        if (project === undefined || this.activeFactory === undefined || this.activeStorage === undefined) {
            this.Status = 'Open a project first.'; return
        }
        try {
            const path = await this.activeFactory.newFile(this.activeStorage, 'diagram', `diagram-${project.Root.Children.Count + 1}`)
            // Refresh the tree so the new file appears, then open it.
            const refreshed = await this.activeFactory.openProject(this.activeStorage)
            this.setActive(refreshed, this.activeFactory, this.activeStorage)
            const doc = await this.activeFactory.openFile(this.activeStorage, path)
            this.host.Open(doc)
            this.Status = `New diagram at ${basename(path)}.`
        } catch (e) {
            this.Status = `New diagram failed: ${(e as Error).message}`
        }
    }

    // Activate a tree node: open a diagram in a tab; open another file in the OS
    // default app when the backend supports local access (isLocalFileAccess).
    private async openNode(node: ProjectNode | undefined): Promise<void>
    {
        if (node === undefined || this.Project === undefined || this.activeFactory === undefined || this.activeStorage === undefined) return
        try {
            if (node.Kind === 'diagram') {
                const doc = await this.activeFactory.openFile(this.activeStorage, node.Path)
                this.host.Open(doc)
                this.Status = `Opened ${node.Name}.`
            } else if (node.Kind === 'file') {
                if (isLocalFileAccess(this.activeStorage)) {
                    await this.activeStorage.OpenExternal(node.Path)
                } else {
                    this.Status = `Can't open ${node.Name} — this project's storage has no OS access.`
                }
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
        // `Factory` holds the service class (from `Factory = DiagramProjectFactory`
        // in the .projectFactories block), but the module registers it under its
        // static `.Key` (tokenFor). Normalize class → .Key so the lookup matches;
        // otherwise get() misses and it looks like "no factory for this type".
        const token = ServiceProvider.tokenFor(def.Factory as unknown as new (...args: never[]) => IProjectFactory)
        return this.Provider.get(token) as IProjectFactory | undefined
    }

    private setActive(project: Project, factory: IProjectFactory, storage: IStorage): void
    {
        this.activeFactory = factory
        this.activeStorage = storage
        this.wireNode(project.Root)
        // Rebuild the tree roots to the new project's root node so the hierarchy
        // renders (the project name at top, children nested beneath).
        this.Roots.Clear()
        this.Roots.Add(project.Root)
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

function basename(p: string): string
{
    const parts = p.split(/[\\/]/)
    return parts[parts.length - 1] || p
}

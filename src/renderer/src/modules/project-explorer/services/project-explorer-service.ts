// project-explorer-service.ts — the GENERIC project host for the left panel.
//
// It owns the set of OPEN projects + orchestrates open/create/close/save, but
// knows nothing about diagrams or file formats: it reads a folder's manifest
// envelope (project.plexus → `type`), routes to the matching factory via the
// framework's ProjectFactoryRegistry, and delegates. A module contributes a
// project type by declaring a `.projectFactories:` entry whose Factory resolves
// to an IProjectFactory (see the diagram module's DiagramProjectFactory).
//
// Several projects can be open at once: each is an OpenProject (its own factory
// + storage + tree + per-project commands), rendered as a tree root. Uniform
// actions (Open / New / Save) live on the command bar; project-specific actions
// (New File / Publish / Close) live on each project's context menu. The open set
// is persisted (OpenProjectsStore) and restored at launch.
//
// Rendered by DataTemplate[DataType=ProjectExplorerService] (project-explorer.
// resources.mu): a command bar + a tree of DataTemplate[OpenProject] roots.
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
    isPublishable,
    type IProjectFactory,
    type ProjectManifestEnvelope,
} from '../../../services/projects/project-factory.js'
import type { Project, ProjectNode } from '../../../services/projects/project.js'
import { OpenProject } from '../../../services/projects/open-project.js'
import { OpenProjectsStore } from '../../../services/projects/open-projects-store.js'
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

    // The open projects — the tree's roots (each a collapsible DataTemplate
    // [OpenProject]). Empty until a project is opened or the session restores.
    public static readonly OpenProjectsKey = Model.RegisterProperty<ObservableCollection<OpenProject>>(
        ProjectExplorerService, 'OpenProjects', undefined as unknown as ObservableCollection<OpenProject>, MetaData.None)
    public static readonly StatusKey = Model.RegisterProperty<string>(
        ProjectExplorerService, 'Status', 'No project open.', MetaData.None)
    public static readonly OpenProjectCommandKey = Model.RegisterProperty<ICommand>(
        ProjectExplorerService, 'OpenProjectCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly NewProjectCommandKey = Model.RegisterProperty<ICommand>(
        ProjectExplorerService, 'NewProjectCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly SaveActiveCommandKey = Model.RegisterProperty<ICommand>(
        ProjectExplorerService, 'SaveActiveCommand', undefined as unknown as ICommand, MetaData.None)

    // Which open project each open document belongs to — for save-routing (the
    // active doc saves through its own factory) and close-cleanup.
    private readonly docOwners = new Map<IDocument, OpenProject>()

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.set_property_value(ProjectExplorerService.OpenProjectsKey, new ObservableCollection<OpenProject>())
        this.set_property_value(ProjectExplorerService.OpenProjectCommandKey, new RelayCommand(() => void this.openProject()))
        this.set_property_value(ProjectExplorerService.NewProjectCommandKey, new RelayCommand(() => void this.newProject()))
        this.set_property_value(ProjectExplorerService.SaveActiveCommandKey, new RelayCommand(() => void this.saveActive()))
    }

    public get OpenProjects(): ObservableCollection<OpenProject> { return this.get_property_value(ProjectExplorerService.OpenProjectsKey) }
    public get Status(): string { return this.get_property_value(ProjectExplorerService.StatusKey) }
    public get OpenProjectCommand(): ICommand { return this.get_property_value(ProjectExplorerService.OpenProjectCommandKey) }
    public get NewProjectCommand(): ICommand { return this.get_property_value(ProjectExplorerService.NewProjectCommandKey) }
    public get SaveActiveCommand(): ICommand { return this.get_property_value(ProjectExplorerService.SaveActiveCommandKey) }

    private set Status(v: string) { this.set_property_value(ProjectExplorerService.StatusKey, v) }

    private get fs(): FileSystemService { return this.Provider.getRequired(FileSystemService.Key) }
    private get storageRegistry(): StorageProviderRegistry { return this.Provider.getRequired(StorageProviderRegistry.Key) }
    private get dialogs(): DialogService { return this.Provider.getRequired(DialogService.Key) }
    private get recents(): RecentProjectsService { return this.Provider.getRequired(RecentProjectsService.Key) }
    private get openStore(): OpenProjectsStore { return this.Provider.getRequired(OpenProjectsStore.Key) }
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
    // backend it names → route to the matching factory → add it to the open set.
    // A no-op (with a status) if the folder is already open.
    private async openProjectAt(folder: string): Promise<void>
    {
        const already = this.findByFolder(folder)
        if (already !== undefined) { this.Status = `${already.Name} is already open.`; return }

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
            const op = await this.addOpenProject(project, factory, storage)
            await this.recents.Add({ name: op.Name, path: folder, type: envelope.type, openedAt: Date.now() })
            this.Status = `Opened ${op.Name}.`
        } catch (e) {
            this.Status = `Open failed: ${(e as Error).message}`
        }
    }

    // Create a project of `type` named `name` in `folder`, add + record it.
    private async createProjectAt(type: string, name: string, folder: string): Promise<void>
    {
        const factory = this.resolveFactory(type)
        if (factory === undefined) { this.Status = `No factory for project type "${type}".`; return }

        const storage = this.storageRegistry.Create(StorageProviderRegistry.DefaultBackendId, folder)
        try {
            const project = await factory.createProject(storage, name)
            const op = await this.addOpenProject(project, factory, storage)
            await this.recents.Add({ name: op.Name, path: folder, type, openedAt: Date.now() })
            this.Status = `Created ${op.Name}.`
        } catch (e) {
            this.Status = `Create failed: ${(e as Error).message}`
        }
    }

    // Reopen the previous session's projects. Skips (and prunes) folders whose
    // project manifest is gone; already-open folders dedupe.
    public async RestoreSession(): Promise<void>
    {
        for (const folder of await this.openStore.List()) {
            let hasManifest = false
            try {
                const storage = this.storageRegistry.Create(StorageProviderRegistry.DefaultBackendId, folder)
                hasManifest = await storage.Exists(PROJECT_MANIFEST_FILENAME)
            } catch { hasManifest = false }
            if (hasManifest) await this.openProjectAt(folder)
            else await this.openStore.Remove(folder)
        }
    }

    // Wrap a project as an OpenProject, wire its per-project commands + node
    // open-commands, add it to the tree, and persist the folder. Deduped by
    // folder — a project already open is returned as-is (no duplicate, no
    // re-persist), so every entry point stays idempotent.
    private async addOpenProject(project: Project, factory: IProjectFactory, storage: IStorage): Promise<OpenProject>
    {
        const existing = this.findByFolder(project.RootPath)
        if (existing !== undefined) return existing

        const op = new OpenProject(project, factory, storage)
        this.wireProjectCommands(op)
        this.wireNodes(op.Root, op)
        this.OpenProjects.Add(op)
        await this.openStore.Add(op.Folder)
        return op
    }

    private wireProjectCommands(op: OpenProject): void
    {
        op.NewFileCommand = new RelayCommand(() => void this.newFileIn(op))
        op.PublishCommand = new RelayCommand(() => void this.publishProject(op), () => isPublishable(op.Factory))
        op.CloseCommand = new RelayCommand(() => void this.closeProject(op))
    }

    // Create a new file of the project's primary format and open it.
    private async newFileIn(op: OpenProject): Promise<void>
    {
        const format = op.Factory.formats[0]
        if (format === undefined) { this.Status = 'This project type has no file format.'; return }
        try {
            const path = await op.Factory.newFile(op.Storage, format.kind, `${format.kind}-${op.Root.Children.Count + 1}`)
            // Refresh the project's tree so the new file appears, then open it.
            op.Adopt(await op.Factory.openProject(op.Storage))
            this.wireNodes(op.Root, op)
            await this.openDocument(op, path)
            this.Status = `New ${format.displayName} at ${basename(path)}.`
        } catch (e) {
            this.Status = `New file failed: ${(e as Error).message}`
        }
    }

    // Publish the project through its factory (the menu item is disabled for
    // non-publishable types, but guard anyway). Surfaces the result message.
    private async publishProject(op: OpenProject): Promise<void>
    {
        if (!isPublishable(op.Factory)) { this.Status = "This project type can't be published."; return }
        try {
            const result = await op.Factory.publish(op.Project, op.Storage, this.Provider)
            this.Status = result.message
        } catch (e) {
            this.Status = `Publish failed: ${(e as Error).message}`
        }
    }

    // Close a project: close its open tabs, drop it from the tree, and forget it
    // from the persisted open set.
    private async closeProject(op: OpenProject): Promise<void>
    {
        for (const [doc, owner] of [...this.docOwners]) {
            if (owner === op) { this.host.Close(doc); this.docOwners.delete(doc) }
        }
        this.OpenProjects.Remove(op)
        await this.openStore.Remove(op.Folder)
        this.Status = `Closed ${op.Name}.`
    }

    // Activate a tree node: open a factory-format file in a tab (any node whose
    // kind matches a declared format of its OWNING project), or open another file
    // in the OS default app when the backend supports local access.
    private async openNode(node: ProjectNode, op: OpenProject): Promise<void>
    {
        try {
            const openable = op.Factory.formats.some((f) => f.kind === node.Kind)
            if (openable) {
                await this.openDocument(op, node.Path)
                this.Status = `Opened ${node.Name}.`
            } else if (node.Kind === 'file') {
                if (isLocalFileAccess(op.Storage)) await op.Storage.OpenExternal(node.Path)
                else this.Status = `Can't open ${node.Name} — this project's storage has no OS access.`
            }
        } catch (e) {
            this.Status = `Open failed: ${(e as Error).message}`
        }
    }

    // Open a project file as a document tab and record its owning project.
    private async openDocument(op: OpenProject, path: string): Promise<void>
    {
        const doc = await op.Factory.openFile(op.Storage, path)
        this.docOwners.set(doc, op)
        this.host.Open(doc)
    }

    // Save the active document through ITS project's factory.
    private async saveActive(): Promise<void>
    {
        const doc: IDocument | undefined = this.host.ActiveDocument
        const op = doc === undefined ? undefined : this.docOwners.get(doc)
        if (doc === undefined || op === undefined) { this.Status = 'Nothing to save.'; return }
        try {
            await op.Factory.saveFile(doc)
            this.Status = `Saved ${doc.Title}.`
        } catch (e) {
            this.Status = `Save failed: ${(e as Error).message}`
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

    private resolveFactory(type: string): IProjectFactory | undefined
    {
        const def = this.Provider.getRequired(ProjectFactoryRegistry.Key).GetByType(type)
        if (def?.Factory === undefined) return undefined
        // `Factory` holds the service class (from `Factory = DiagramProjectFactory`
        // in the .projectFactories block), but the module registers it under its
        // static `.Key` (tokenFor). Normalize class → .Key so the lookup matches.
        const token = ServiceProvider.tokenFor(def.Factory as unknown as new (...args: never[]) => IProjectFactory)
        return this.Provider.get(token) as IProjectFactory | undefined
    }

    private findByFolder(folder: string): OpenProject | undefined
    {
        return this.OpenProjects.ToArray().find((o) => o.Folder === folder)
    }

    // Give every node in a project's tree an OpenCommand closing over it + its
    // owning project, so a row binds `Command = $OpenCommand` and routes file-open
    // through the right factory/storage (folders get a no-op activation).
    private wireNodes(node: ProjectNode, op: OpenProject): void
    {
        node.OpenCommand = new RelayCommand(() => void this.openNode(node, op))
        for (const child of node.Children.ToArray()) this.wireNodes(child, op)
    }
}

function basename(p: string): string
{
    const parts = p.split(/[\\/]/)
    return parts[parts.length - 1] || p
}

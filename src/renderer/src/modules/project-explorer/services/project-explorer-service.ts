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
    Key,
    MetaData,
    Model,
    ObservableCollection,
    RelayCommand,
    ServiceBase,
    ServiceKey,
    ServiceProvider,
    type ICommand,
    type IServiceProvider,
    type KeyEventArgs,
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
    isRelocatable,
    type IProjectFactory,
    type ProjectFileFormat,
    type ProjectManifestEnvelope,
} from '../../../services/projects/project-factory.js'
import type { FileFilter } from '../../../../../shared/file-system-api.js'
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
    // Each open document's project-relative path — so an in-place rename can
    // re-point the tab (via the factory's relocateOpenFile) instead of leaving
    // it stale.
    private readonly docPaths = new Map<IDocument, string>()

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
        op.NewFolderCommand = new RelayCommand(() => void this.newFolderIn(op))
        op.AddFileCommand = new RelayCommand(() => void this.addExistingFilesTo(op))
        op.TreeKeyCommand = new RelayCommand((arg) => this.handleTreeKey(op, arg as KeyEventArgs))
        op.PublishCommand = new RelayCommand(() => void this.publishProject(op), () => isPublishable(op.Factory))
        op.CloseCommand = new RelayCommand(() => void this.closeProject(op))
    }

    // Create a new file of the project's primary format inside `parentFolder`
    // (project-relative; '' = the project root) and open it. The name is the
    // format kind, auto-numbered to dodge collisions (foo → foo-2).
    private async newFileIn(op: OpenProject, parentFolder = ''): Promise<void>
    {
        const format = op.Factory.formats[0]
        if (format === undefined) { this.Status = 'This project type has no file format.'; return }
        try {
            const name = await uniqueStorageName(op.Storage, joinRel(parentFolder, `${format.kind}${format.extension}`))
            const path = await op.Factory.newFile(op.Storage, format.kind, name)
            // Refresh the project's tree so the new file appears, then open it.
            op.Adopt(await op.Factory.openProject(op.Storage))
            this.wireNodes(op.Root, op)
            await this.openDocument(op, path)
            this.Status = `New ${format.displayName} at ${basename(path)}.`
        } catch (e) {
            this.Status = `New file failed: ${(e as Error).message}`
        }
    }

    // Create a subfolder ("New Folder", auto-numbered on collision) inside
    // `parentFolder` (project-relative; '' = the project root) and refresh the
    // tree so it appears. Generic — a directory is backend state, not a factory
    // format, so this goes straight through the project's storage.
    private async newFolderIn(op: OpenProject, parentFolder = ''): Promise<void>
    {
        try {
            const path = await uniqueStorageName(op.Storage, joinRel(parentFolder, 'New Folder'))
            await op.Storage.CreateDirectory(path)
            op.Adopt(await op.Factory.openProject(op.Storage))
            this.wireNodes(op.Root, op)
            this.Status = `Created folder ${basename(path)}.`
        } catch (e) {
            this.Status = `New folder failed: ${(e as Error).message}`
        }
    }

    // Add existing file(s) into a project: pick from the OS (multi-select,
    // binary-safe), copy each into the project's storage under a non-colliding
    // name (auto-renamed foo → foo-2), then rescan the tree so they appear. The
    // picker is seeded with the factory's formats but not restricted — any file
    // can be brought in as an attachment.
    private async addExistingFilesTo(op: OpenProject): Promise<void>
    {
        const picked = await this.fs.OpenFiles({ Title: `Add files to ${op.Name}`, Filters: importFilters(op.Factory.formats) })
        if (picked === null || picked.length === 0) return

        try {
            const added: string[] = []
            for (const file of picked) {
                const name = await uniqueStorageName(op.Storage, basename(file.Path))
                await op.Storage.WriteBytes(name, file.Bytes)
                added.push(name)
            }
            // Refresh the tree so the imported files appear; re-wire the new nodes.
            op.Adopt(await op.Factory.openProject(op.Storage))
            this.wireNodes(op.Root, op)
            this.Status = added.length === 1
                ? `Added ${added[0]}.`
                : `Added ${added.length} files.`
        } catch (e) {
            this.Status = `Add failed: ${(e as Error).message}`
        }
    }

    // TreeView key handler (bound via `on KeyDown`): F2 renames the selected
    // node, Enter commits the in-progress rename, Escape cancels it. Marks the
    // args handled so the keystroke doesn't also drive tree navigation.
    private handleTreeKey(op: OpenProject, args: KeyEventArgs): void
    {
        if (args === undefined) return
        switch (args.Key) {
            case Key.F2: {
                const node = op.SelectedNode
                if (node !== undefined && node.Path !== '') { this.beginRename(op, node); args.Handled = true }
                return
            }
            case Key.Return: {
                if (op.EditingNode !== undefined) { void this.commitRename(op, op.EditingNode); args.Handled = true }
                return
            }
            case Key.Escape: {
                if (op.EditingNode !== undefined) { this.cancelRename(op, op.EditingNode); args.Handled = true }
                return
            }
        }
    }

    // Open a node's in-place editor: seed the buffer with the current name and
    // flip IsEditing (which the row template swaps to a focused TextBox). Only
    // one node edits at a time, so close any prior editor first.
    private beginRename(op: OpenProject, node: ProjectNode): void
    {
        if (node.Path === '') return
        const prev = op.EditingNode
        if (prev !== undefined && prev !== node) prev.IsEditing = false
        node.EditingName = node.Name
        node.IsEditing = true
        op.EditingNode = node
    }

    private cancelRename(op: OpenProject, node: ProjectNode): void
    {
        node.IsEditing = false
        if (op.EditingNode === node) op.EditingNode = undefined
    }

    // Commit a rename: move the file/folder within its parent, re-point any open
    // tabs to the new path, and rescan the tree. A no-op name, a collision, or a
    // name with a path separator aborts back to the label (with a status).
    private async commitRename(op: OpenProject, node: ProjectNode): Promise<void>
    {
        const proposed = node.EditingName.trim()
        if (proposed === '' || proposed === node.Name) { this.cancelRename(op, node); return }
        if (/[\\/]/.test(proposed)) { this.Status = "A name can't contain a path separator."; this.cancelRename(op, node); return }

        const dest = joinRel(parentOf(node.Path), proposed)
        try {
            if (await op.Storage.Exists(dest)) { this.Status = `"${proposed}" already exists.`; this.cancelRename(op, node); return }
            await op.Storage.Rename(node.Path, dest)
            this.repointOpenDocuments(op, node.Path, dest)
            op.EditingNode = undefined
            // Rescan so the renamed node (and, for a folder, its moved contents)
            // reappear under the new path; re-wire the fresh nodes' commands.
            op.Adopt(await op.Factory.openProject(op.Storage))
            this.wireNodes(op.Root, op)
            this.Status = `Renamed to ${proposed}.`
        } catch (e) {
            this.cancelRename(op, node)
            this.Status = `Rename failed: ${(e as Error).message}`
        }
    }

    // After a rename, re-point every open tab whose file lived at (or under, for
    // a folder rename) the old path — the factory updates the document's path +
    // title in place so the tab keeps working. No-op for factories that can't
    // relocate (their tabs would need a manual reopen).
    private repointOpenDocuments(op: OpenProject, oldPath: string, newPath: string): void
    {
        if (!isRelocatable(op.Factory)) return
        for (const [doc, path] of [...this.docPaths]) {
            if (this.docOwners.get(doc) !== op) continue
            const moved = path === oldPath ? newPath
                : path.startsWith(oldPath + '/') ? newPath + path.slice(oldPath.length)
                    : undefined
            if (moved === undefined) continue
            op.Factory.relocateOpenFile(doc, moved)
            this.docPaths.set(doc, moved)
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
            if (owner === op) { this.host.Close(doc); this.docOwners.delete(doc); this.docPaths.delete(doc) }
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
        this.docPaths.set(doc, path)
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
        // The folder a node's context-menu creations land in: a folder node
        // creates inside itself; a file node creates beside itself (VSCode-style).
        const container = node.Kind === 'folder' ? node.Path : parentOf(node.Path)
        node.NewFileCommand = new RelayCommand(() => void this.newFileIn(op, container))
        node.NewFolderCommand = new RelayCommand(() => void this.newFolderIn(op, container))
        // The root node isn't shown as a row, so it never renames; every other
        // node's context-menu "Rename" opens its in-place editor.
        node.BeginRenameCommand = new RelayCommand(() => this.beginRename(op, node), () => node.Path !== '')
        for (const child of node.Children.ToArray()) this.wireNodes(child, op)
    }
}

// ── project-relative path helpers (POSIX `/`; the storage backend translates) ──
function joinRel(dir: string, name: string): string
{
    return dir === '' ? name : dir + '/' + name
}

function parentOf(path: string): string
{
    const slash = path.lastIndexOf('/')
    return slash === -1 ? '' : path.slice(0, slash)
}

function basename(p: string): string
{
    const parts = p.split(/[\\/]/)
    return parts[parts.length - 1] || p
}

// A project-relative name for `fileName` that doesn't collide with an existing
// entry: returns it as-is when free, else the first free `stem-N.ext` (N ≥ 2),
// mirroring an OS "copy" rename. The extension (leading dot only — dotfiles like
// `.gitignore` keep their whole name) is preserved on the suffix.
export async function uniqueStorageName(storage: IStorage, fileName: string): Promise<string>
{
    if (!(await storage.Exists(fileName))) return fileName
    const dot = fileName.lastIndexOf('.')
    const stem = dot > 0 ? fileName.slice(0, dot) : fileName
    const ext = dot > 0 ? fileName.slice(dot) : ''
    for (let n = 2; ; n++) {
        const candidate = `${stem}-${n}${ext}`
        if (!(await storage.Exists(candidate))) return candidate
    }
}

// The open-dialog filters for importing into a project: one entry per factory
// format (so its files surface first) plus an All-files catch-all — a guide,
// not a restriction. Extensions carry no leading dot (the dialog's convention).
export function importFilters(formats: readonly ProjectFileFormat[]): FileFilter[]
{
    const known = formats.map((f) => ({ Name: f.displayName, Extensions: [f.extension.replace(/^\./, '')] }))
    return [...known, { Name: 'All files', Extensions: ['*'] }]
}

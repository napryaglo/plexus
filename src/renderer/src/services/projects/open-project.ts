import { MetaData, Model, type ICommand, type PropertyDescriptor } from '@pragmatic-lab/mural/runtime'

import type { IProjectFactory } from './project-factory.js'
import type { IStorage } from '../storage/storage.js'
import { ProjectNode, type Project } from './project.js'

// One open project in the explorer — the VM the tree renders as a collapsible
// root. It bundles the project's model (Name + file tree) with the factory and
// storage that back it, and carries the project-specific commands (New File,
// Publish, Close) that its context menu binds. The explorer constructs one per
// open project and sets each command to a RelayCommand closing over this
// instance, so every action unambiguously names its project.
export class OpenProject extends Model
{
    static readonly NameKey = Model.RegisterProperty<string>(OpenProject, 'Name', '', MetaData.None)
    static readonly RootKey = Model.RegisterProperty<ProjectNode>(
        OpenProject, 'Root', undefined as unknown as ProjectNode, MetaData.None)
    static readonly NewFileCommandKey = Model.RegisterProperty<ICommand | undefined>(
        OpenProject, 'NewFileCommand', undefined, MetaData.None)
    static readonly PublishCommandKey = Model.RegisterProperty<ICommand | undefined>(
        OpenProject, 'PublishCommand', undefined, MetaData.None)
    static readonly CloseCommandKey = Model.RegisterProperty<ICommand | undefined>(
        OpenProject, 'CloseCommand', undefined, MetaData.None)
    // The tree's selected node — two-way target of the TreeView's
    // SelectedDataItem. Selecting a row pushes the ProjectNode here; the
    // OnPropertyChanged hook activates it (a leaf opens, a folder no-ops via its
    // OpenCommand). Lets the whole tree stay declarative (ItemsSource +
    // HierarchicalDataTemplate) with no view-tree wiring.
    static readonly SelectedNodeKey = Model.RegisterProperty<ProjectNode | undefined>(
        OpenProject, 'SelectedNode', undefined, MetaData.None)

    private project: Project
    private readonly factory: IProjectFactory
    private readonly storage: IStorage

    constructor(project: Project, factory: IProjectFactory, storage: IStorage)
    {
        super()
        this.project = project
        this.factory = factory
        this.storage = storage
        this.set_property_value(OpenProject.NameKey, project.Name)
        this.set_property_value(OpenProject.RootKey, project.Root)
    }

    // Activate the node the tree just selected — run its OpenCommand (wired by
    // ProjectExplorerService.wireNodes: a leaf opens its file, a folder no-ops).
    protected override OnPropertyChanged(descriptor: PropertyDescriptor, oldValue: unknown, newValue: unknown): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue)
        if (descriptor.Name === 'SelectedNode' && newValue instanceof ProjectNode)
        {
            newValue.OpenCommand?.Execute(undefined)
        }
    }

    // Adopt a freshly-scanned Project (same factory/storage) — after a New File
    // rebuilds the tree. Updates the Name/Root DPs so the bound view refreshes;
    // the caller re-wires the new nodes' OpenCommands.
    public Adopt(project: Project): void
    {
        this.project = project
        this.set_property_value(OpenProject.NameKey, project.Name)
        this.set_property_value(OpenProject.RootKey, project.Root)
    }

    public get Name(): string { return this.get_property_value(OpenProject.NameKey) }
    public get Root(): ProjectNode { return this.get_property_value(OpenProject.RootKey) }

    public get NewFileCommand(): ICommand | undefined { return this.get_property_value(OpenProject.NewFileCommandKey) }
    public set NewFileCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.NewFileCommandKey, v) }

    public get PublishCommand(): ICommand | undefined { return this.get_property_value(OpenProject.PublishCommandKey) }
    public set PublishCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.PublishCommandKey, v) }

    public get CloseCommand(): ICommand | undefined { return this.get_property_value(OpenProject.CloseCommandKey) }
    public set CloseCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.CloseCommandKey, v) }

    public get SelectedNode(): ProjectNode | undefined { return this.get_property_value(OpenProject.SelectedNodeKey) }
    public set SelectedNode(v: ProjectNode | undefined) { this.set_property_value(OpenProject.SelectedNodeKey, v) }

    // The backing project model, factory, and storage (read-only to the explorer).
    public get Project(): Project { return this.project }
    public get Factory(): IProjectFactory { return this.factory }
    public get Storage(): IStorage { return this.storage }
    // The project's root folder — the dedupe + persistence key.
    public get Folder(): string { return this.project.RootPath }
}

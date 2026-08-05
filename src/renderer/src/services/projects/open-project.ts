import { MetaData, Model, ObservableCollection, type ICommand, type PropertyDescriptor } from '@pragmatic-lab/mural/runtime'

import type { IProjectFactory } from './project-factory.js'
import type { IStorage } from '../storage/storage.js'
import { ProjectNode, type Project } from './project.js'
import { NewItemChoice } from './new-item-choice.js'

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
    // The "Add New" submenu's choices — one per the factory's declared formats,
    // set by the host (ProjectExplorerService.wireProjectCommands).
    static readonly NewItemChoicesKey = Model.RegisterProperty<ObservableCollection<NewItemChoice>>(
        OpenProject, 'NewItemChoices', undefined as unknown as ObservableCollection<NewItemChoice>, MetaData.None)
    static readonly ImportFileCommandKey = Model.RegisterProperty<ICommand | undefined>(
        OpenProject, 'ImportFileCommand', undefined, MetaData.None)
    static readonly ImportFolderCommandKey = Model.RegisterProperty<ICommand | undefined>(
        OpenProject, 'ImportFolderCommand', undefined, MetaData.None)
    static readonly NewFolderCommandKey = Model.RegisterProperty<ICommand | undefined>(
        OpenProject, 'NewFolderCommand', undefined, MetaData.None)
    // Keyboard handler for the project's TreeView (bound via `on KeyDown`): the
    // host inspects the KeyEventArgs and drives F2 (begin rename of SelectedNode),
    // Enter (commit the EditingNode) and Escape (cancel).
    static readonly TreeKeyCommandKey = Model.RegisterProperty<ICommand | undefined>(
        OpenProject, 'TreeKeyCommand', undefined, MetaData.None)
    static readonly PublishCommandKey = Model.RegisterProperty<ICommand | undefined>(
        OpenProject, 'PublishCommand', undefined, MetaData.None)
    // (Re)generate the project's presentation resource dictionary — enabled only
    // for factories that support it (meta-model today).
    static readonly GeneratePresentationCommandKey = Model.RegisterProperty<ICommand | undefined>(
        OpenProject, 'GeneratePresentationCommand', undefined, MetaData.None)
    // Re-resolve the project's declared bases (drop the validator's per-storage
    // cache + revalidate) — picks up a republished meta-model/library.
    static readonly RefreshBasesCommandKey = Model.RegisterProperty<ICommand | undefined>(
        OpenProject, 'RefreshBasesCommand', undefined, MetaData.None)
    // Bind an already-published library to this project's manifest — enabled only
    // for a factory that OffersLibraries (architecture). Covers a library not
    // chosen at creation time (or published later).
    static readonly AddLibraryReferenceCommandKey = Model.RegisterProperty<ICommand | undefined>(
        OpenProject, 'AddLibraryReferenceCommand', undefined, MetaData.None)
    static readonly CloseCommandKey = Model.RegisterProperty<ICommand | undefined>(
        OpenProject, 'CloseCommand', undefined, MetaData.None)
    // Move dragged node(s) into a target folder — the drag behavior executes this
    // with a { nodes, destPath } argument (see MoveArg in the explorer service).
    static readonly MoveNodesCommandKey = Model.RegisterProperty<ICommand | undefined>(
        OpenProject, 'MoveNodesCommand', undefined, MetaData.None)
    // The tree's selected node — two-way target of the TreeView's
    // SelectedDataItem. Selecting a row pushes the ProjectNode here; the
    // OnPropertyChanged hook activates it (a leaf opens, a folder no-ops via its
    // OpenCommand). Lets the whole tree stay declarative (ItemsSource +
    // HierarchicalDataTemplate) with no view-tree wiring.
    static readonly SelectedNodeKey = Model.RegisterProperty<ProjectNode | undefined>(
        OpenProject, 'SelectedNode', undefined, MetaData.None)
    // Whether the project's file tree is shown. Pure view state, owned here and
    // two-way bound to the header chevron's ToggleButton.IsChecked; the chevron
    // glyph and the tree's Visibility both bind to it.
    static readonly IsExpandedKey = Model.RegisterProperty<boolean>(
        OpenProject, 'IsExpanded', true, MetaData.None)

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

    // Adopt a freshly-scanned Project (same factory/storage) — after a rescan
    // (new file/folder, import, delete) rebuilds the tree. The Root instance is
    // KEPT and its subtree reconciled IN PLACE: the TreeView captures Root.Children
    // (an ObservableCollection) when a project's container is first prepared, so
    // swapping Root wholesale would leave the tree observing the old collection and
    // a rescan's added files/folders would never appear. The caller re-wires the
    // new nodes' OpenCommands.
    public Adopt(project: Project): void
    {
        this.project = project
        this.set_property_value(OpenProject.NameKey, project.Name)
        reconcileChildren(this.Root, project.Root)
    }

    public get Name(): string { return this.get_property_value(OpenProject.NameKey) }
    public get Root(): ProjectNode { return this.get_property_value(OpenProject.RootKey) }

    public get NewItemChoices(): ObservableCollection<NewItemChoice> { return this.get_property_value(OpenProject.NewItemChoicesKey) }
    public set NewItemChoices(v: ObservableCollection<NewItemChoice>) { this.set_property_value(OpenProject.NewItemChoicesKey, v) }

    public get ImportFileCommand(): ICommand | undefined { return this.get_property_value(OpenProject.ImportFileCommandKey) }
    public set ImportFileCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.ImportFileCommandKey, v) }
    public get ImportFolderCommand(): ICommand | undefined { return this.get_property_value(OpenProject.ImportFolderCommandKey) }
    public set ImportFolderCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.ImportFolderCommandKey, v) }

    public get NewFolderCommand(): ICommand | undefined { return this.get_property_value(OpenProject.NewFolderCommandKey) }
    public set NewFolderCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.NewFolderCommandKey, v) }

    public get TreeKeyCommand(): ICommand | undefined { return this.get_property_value(OpenProject.TreeKeyCommandKey) }
    public set TreeKeyCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.TreeKeyCommandKey, v) }

    // The node whose row is currently in rename mode (at most one per project).
    // Plain view-transient state — not bound, so a field rather than a DP.
    public EditingNode: ProjectNode | undefined = undefined

    // The tree's full multi-selection — the set of selected ProjectNodes,
    // pushed here by TreeSelectionBehavior (the TreeView runs in Extended
    // selection mode). SelectedNode above stays the anchor (what opens on
    // click); this is what a Delete acts on when several rows are selected.
    // Not bound to the view (the host reads it), so a plain field.
    public SelectedNodes: readonly ProjectNode[] = []

    public get PublishCommand(): ICommand | undefined { return this.get_property_value(OpenProject.PublishCommandKey) }
    public set PublishCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.PublishCommandKey, v) }
    public get GeneratePresentationCommand(): ICommand | undefined { return this.get_property_value(OpenProject.GeneratePresentationCommandKey) }
    public set GeneratePresentationCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.GeneratePresentationCommandKey, v) }

    public get RefreshBasesCommand(): ICommand | undefined { return this.get_property_value(OpenProject.RefreshBasesCommandKey) }
    public set RefreshBasesCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.RefreshBasesCommandKey, v) }

    public get AddLibraryReferenceCommand(): ICommand | undefined { return this.get_property_value(OpenProject.AddLibraryReferenceCommandKey) }
    public set AddLibraryReferenceCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.AddLibraryReferenceCommandKey, v) }

    public get MoveNodesCommand(): ICommand | undefined { return this.get_property_value(OpenProject.MoveNodesCommandKey) }
    public set MoveNodesCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.MoveNodesCommandKey, v) }

    public get CloseCommand(): ICommand | undefined { return this.get_property_value(OpenProject.CloseCommandKey) }
    public set CloseCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.CloseCommandKey, v) }

    public get SelectedNode(): ProjectNode | undefined { return this.get_property_value(OpenProject.SelectedNodeKey) }
    public set SelectedNode(v: ProjectNode | undefined) { this.set_property_value(OpenProject.SelectedNodeKey, v) }

    public get IsExpanded(): boolean { return this.get_property_value(OpenProject.IsExpandedKey) }
    public set IsExpanded(v: boolean) { this.set_property_value(OpenProject.IsExpandedKey, v) }

    // The backing project model, factory, and storage (read-only to the explorer).
    public get Project(): Project { return this.project }
    public get Factory(): IProjectFactory { return this.factory }
    public get Storage(): IStorage { return this.storage }
    // The project's root folder — the dedupe + persistence key.
    public get Folder(): string { return this.project.RootPath }
}

// Update `existing`'s Children subtree to match `fresh`'s IN PLACE, keyed by each
// node's project-relative Path (its stable identity). Mutating the same
// ObservableCollection the TreeView observes is what makes the change appear (see
// OpenProject.Adopt). Done INCREMENTALLY — only added/removed rows change — so a
// rescan does not churn the whole tree: a matched child keeps its instance and is
// recursed into, preserving unchanged folders' expansion. Both child lists come
// from the same sorted scan, so survivors stay in fresh's relative order and a new
// node just lands at its index.
function reconcileChildren(existing: ProjectNode, fresh: ProjectNode): void
{
    const freshList = fresh.Children.ToArray()
    const freshPaths = new Set(freshList.map((c) => c.Path))
    for (const child of existing.Children.ToArray())
        if (!freshPaths.has(child.Path)) existing.Children.Remove(child)

    const byPath = new Map(existing.Children.ToArray().map((c) => [c.Path, c]))
    freshList.forEach((child, i) =>
    {
        const kept = byPath.get(child.Path)
        if (kept === undefined) existing.Children.Insert(i, child)
        else reconcileChildren(kept, child)
    })
}

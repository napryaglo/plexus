import { MetaData, Model, ObservableCollection, type ICommand } from '@pragmatic-lab/mural/runtime'

// A project and its file tree — the generic, host-owned model a project
// factory populates. `Project` and `ProjectNode` are Models so the explorer's
// TreeView binds them directly (Name/Kind per item, Children for expansion).

// What a tree node represents. 'diagram' and 'todl' are files the active factory
// opens in-app (each is a factory format kind — the explorer routes any node
// whose kind matches a declared format to openFile); 'file' is any other
// attachment (opened via the OS); 'folder' groups.
export type ProjectNodeKind = 'folder' | 'diagram' | 'todl' | 'file'

export class ProjectNode extends Model
{
    static readonly NameKey = Model.RegisterProperty<string>(ProjectNode, 'Name', '', MetaData.None)
    static readonly PathKey = Model.RegisterProperty<string>(ProjectNode, 'Path', '', MetaData.None)
    static readonly KindKey = Model.RegisterProperty<ProjectNodeKind>(ProjectNode, 'Kind', 'file', MetaData.None)
    static readonly ChildrenKey = Model.RegisterProperty<ObservableCollection<ProjectNode>>(
        ProjectNode, 'Children', undefined as unknown as ObservableCollection<ProjectNode>, MetaData.None)
    // The action to run when this node is activated in the tree — set by the
    // host (ProjectExplorerService) so the row can bind `Command = $OpenCommand`
    // without threading the node through a CommandParameter.
    static readonly OpenCommandKey = Model.RegisterProperty<ICommand | undefined>(
        ProjectNode, 'OpenCommand', undefined, MetaData.None)
    // Create a new file / subfolder in this node's containing folder (a folder
    // node creates inside itself; a file node creates beside itself). Set by the
    // host (ProjectExplorerService.wireNodes) so a row's context menu can bind
    // `Command = $NewFileCommand` / `$NewFolderCommand` with no parameter.
    static readonly NewFileCommandKey = Model.RegisterProperty<ICommand | undefined>(
        ProjectNode, 'NewFileCommand', undefined, MetaData.None)
    static readonly NewFolderCommandKey = Model.RegisterProperty<ICommand | undefined>(
        ProjectNode, 'NewFolderCommand', undefined, MetaData.None)
    // In-place rename state. IsEditing swaps the row's label for a TextBox (see
    // the ProjectNodeTemplate); EditingName is that box's two-way text buffer.
    // BeginRename (context-menu "Rename" / F2) opens the editor; the TreeView's
    // key handler commits on Enter and cancels on Escape (host-driven).
    static readonly IsEditingKey = Model.RegisterProperty<boolean>(
        ProjectNode, 'IsEditing', false, MetaData.None)
    static readonly EditingNameKey = Model.RegisterProperty<string>(
        ProjectNode, 'EditingName', '', MetaData.None)
    static readonly BeginRenameCommandKey = Model.RegisterProperty<ICommand | undefined>(
        ProjectNode, 'BeginRenameCommand', undefined, MetaData.None)
    // Delete this node (file or folder, with its contents) from the project,
    // after a confirmation. Set by the host (ProjectExplorerService.wireNodes)
    // so a row's context menu can bind `Command = $DeleteCommand`; disabled on
    // the (unshown) root. When the node is part of a multi-selection, deleting
    // it removes the whole selected set.
    static readonly DeleteCommandKey = Model.RegisterProperty<ICommand | undefined>(
        ProjectNode, 'DeleteCommand', undefined, MetaData.None)

    constructor(name: string, path: string, kind: ProjectNodeKind)
    {
        super()
        this.set_property_value(ProjectNode.NameKey, name)
        this.set_property_value(ProjectNode.PathKey, path)
        this.set_property_value(ProjectNode.KindKey, kind)
        this.set_property_value(ProjectNode.ChildrenKey, new ObservableCollection<ProjectNode>())
    }

    public get Name(): string { return this.get_property_value(ProjectNode.NameKey) }
    public get Path(): string { return this.get_property_value(ProjectNode.PathKey) }
    public get Kind(): ProjectNodeKind { return this.get_property_value(ProjectNode.KindKey) }
    public get Children(): ObservableCollection<ProjectNode> { return this.get_property_value(ProjectNode.ChildrenKey) }
    public get OpenCommand(): ICommand | undefined { return this.get_property_value(ProjectNode.OpenCommandKey) }
    public set OpenCommand(v: ICommand | undefined) { this.set_property_value(ProjectNode.OpenCommandKey, v) }

    public get NewFileCommand(): ICommand | undefined { return this.get_property_value(ProjectNode.NewFileCommandKey) }
    public set NewFileCommand(v: ICommand | undefined) { this.set_property_value(ProjectNode.NewFileCommandKey, v) }

    public get NewFolderCommand(): ICommand | undefined { return this.get_property_value(ProjectNode.NewFolderCommandKey) }
    public set NewFolderCommand(v: ICommand | undefined) { this.set_property_value(ProjectNode.NewFolderCommandKey, v) }

    public get IsEditing(): boolean { return this.get_property_value(ProjectNode.IsEditingKey) }
    public set IsEditing(v: boolean) { this.set_property_value(ProjectNode.IsEditingKey, v) }

    public get EditingName(): string { return this.get_property_value(ProjectNode.EditingNameKey) }
    public set EditingName(v: string) { this.set_property_value(ProjectNode.EditingNameKey, v) }

    public get BeginRenameCommand(): ICommand | undefined { return this.get_property_value(ProjectNode.BeginRenameCommandKey) }
    public set BeginRenameCommand(v: ICommand | undefined) { this.set_property_value(ProjectNode.BeginRenameCommandKey, v) }

    public get DeleteCommand(): ICommand | undefined { return this.get_property_value(ProjectNode.DeleteCommandKey) }
    public set DeleteCommand(v: ICommand | undefined) { this.set_property_value(ProjectNode.DeleteCommandKey, v) }
}

export class Project extends Model
{
    static readonly NameKey = Model.RegisterProperty<string>(Project, 'Name', '', MetaData.None)
    static readonly TypeKey = Model.RegisterProperty<string>(Project, 'Type', '', MetaData.None)
    static readonly RootPathKey = Model.RegisterProperty<string>(Project, 'RootPath', '', MetaData.None)
    static readonly RootKey = Model.RegisterProperty<ProjectNode>(
        Project, 'Root', undefined as unknown as ProjectNode, MetaData.None)

    constructor(type: string, name: string, rootPath: string, root: ProjectNode)
    {
        super()
        this.set_property_value(Project.TypeKey, type)
        this.set_property_value(Project.NameKey, name)
        this.set_property_value(Project.RootPathKey, rootPath)
        this.set_property_value(Project.RootKey, root)
    }

    public get Name(): string { return this.get_property_value(Project.NameKey) }
    public get Type(): string { return this.get_property_value(Project.TypeKey) }
    public get RootPath(): string { return this.get_property_value(Project.RootPathKey) }
    public get Root(): ProjectNode { return this.get_property_value(Project.RootKey) }
}

import { MetaData, Model, ObservableCollection, type ICommand } from '@pragmatic-lab/mural/runtime'

// A project and its file tree — the generic, host-owned model a project
// factory populates. `Project` and `ProjectNode` are Models so the explorer's
// TreeView binds them directly (Name/Kind per item, Children for expansion).

// What a tree node represents. 'diagram' is a file the active factory can open
// in-app; 'file' is any other attachment (opened via the OS); 'folder' groups.
export type ProjectNodeKind = 'folder' | 'diagram' | 'file'

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

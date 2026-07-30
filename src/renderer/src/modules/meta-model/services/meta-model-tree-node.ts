import { MetaData, Model, ObservableCollection } from '@pragmatic-lab/mural/runtime'

// A uniform tree node for the Meta-models panel — one type for every level
// (model id, version, kind group, entity) so a single HierarchicalDataTemplate
// governs the whole tree (mirrors ProjectNode). Kind drives the leading icon.
//
// Version nodes are lazy: they carry a loader and a single "Loading…" sentinel
// child so the TreeView paints a chevron before anything is read. The mural
// TreeViewItem calls OnExpand() on first expand; the node runs its loader once
// and swaps the sentinel for the produced subtree. Because Children is an
// ObservableCollection bound live as the row's ItemsSource, the async swap
// updates the tree in place.
export enum MetaModelNodeKind
{
    Model = 'model',
    Version = 'version',
    Group = 'group',
    Entity = 'entity',
}

export class MetaModelTreeNode extends Model
{
    public static readonly KindKey = Model.RegisterProperty<MetaModelNodeKind>(
        MetaModelTreeNode, 'Kind', MetaModelNodeKind.Entity, MetaData.None)

    public static readonly LabelKey = Model.RegisterProperty<string>(
        MetaModelTreeNode, 'Label', '', MetaData.None)

    public static readonly ChildrenKey = Model.RegisterProperty<ObservableCollection<MetaModelTreeNode>>(
        MetaModelTreeNode, 'Children',
        undefined as unknown as ObservableCollection<MetaModelTreeNode>, MetaData.None)

    // Lazy machinery (view-invisible → plain fields). Only lazy() sets a loader.
    private loader?: () => Promise<MetaModelTreeNode[]>
    private loaded = false

    private constructor(kind: MetaModelNodeKind, label: string)
    {
        super()
        this.set_property_value(MetaModelTreeNode.KindKey, kind)
        this.set_property_value(MetaModelTreeNode.LabelKey, label)
        this.set_property_value(MetaModelTreeNode.ChildrenKey, new ObservableCollection<MetaModelTreeNode>())
    }

    public get Kind(): MetaModelNodeKind { return this.get_property_value(MetaModelTreeNode.KindKey) }
    public get Label(): string { return this.get_property_value(MetaModelTreeNode.LabelKey) }
    public get Children(): ObservableCollection<MetaModelTreeNode>
    {
        return this.get_property_value(MetaModelTreeNode.ChildrenKey)
    }

    // A non-lazy node: children (if any) are added by the caller.
    public static leaf(kind: MetaModelNodeKind, label: string): MetaModelTreeNode
    {
        return new MetaModelTreeNode(kind, label)
    }

    // A lazy node: seeded with a "Loading…" sentinel; loader runs on first expand.
    public static lazy(
        kind: MetaModelNodeKind, label: string,
        loader: () => Promise<MetaModelTreeNode[]>,
    ): MetaModelTreeNode
    {
        const node = new MetaModelTreeNode(kind, label)
        node.loader = loader
        node.Children.Add(MetaModelTreeNode.leaf(MetaModelNodeKind.Entity, 'Loading…'))
        return node
    }

    // Called by the mural TreeViewItem when this row expands. Runs the loader
    // exactly once (idempotent); subsequent expands are no-ops.
    public OnExpand(): void
    {
        if (this.loaded || this.loader === undefined) return
        this.loaded = true
        void this.runLoader(this.loader)
    }

    private async runLoader(loader: () => Promise<MetaModelTreeNode[]>): Promise<void>
    {
        let children: MetaModelTreeNode[]
        try { children = await loader() }
        catch { children = [MetaModelTreeNode.leaf(MetaModelNodeKind.Entity, 'Failed to load model.json')] }
        this.Children.Clear()
        for (const c of children) this.Children.Add(c)
    }
}

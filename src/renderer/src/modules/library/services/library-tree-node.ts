import { DataObject, DragDropEffects, MetaData, Model, ObservableCollection, type ICommand } from '@pragmatic-lab/mural/runtime'
import { ToolboxVisualDescriptor, TOOLBOX_ITEM_FORMAT } from '@pragmatic-lab/mural/framework'
import { TodlVisualResolverKey } from '../../diagram/services/todl-visual-resolver.js'

// The three tiers of the Libraries tree. One node type carries all three, kept
// apart by Kind (mirrors ProjectNode's single-type-plus-Kind shape).
export enum LibraryNodeKind { Library = 'library', Concept = 'concept', Class = 'class' }

// A node in the Libraries TreeView. Group nodes (Library/Concept) carry a Name +
// Children; Class leaves additionally carry the render surface a class template
// binds against ($Display/$Label/$LocalId/$Concept), a visual Descriptor (rendered
// by the preview's ToolboxVisualPresenter), and a drag payload emitting the term's
// repository item id (TOOLBOX_ITEM_FORMAT) so the leaf can be dropped onto a
// diagram — the drop router no-ops for a class that isn't a toolbox item.
export class LibraryTreeNode extends Model
{
    public static readonly NameKey = Model.RegisterProperty<string>(LibraryTreeNode, 'Name', '', MetaData.None)
    public static readonly KindKey = Model.RegisterProperty<LibraryNodeKind>(LibraryTreeNode, 'Kind', LibraryNodeKind.Class, MetaData.None)
    public static readonly ChildrenKey = Model.RegisterProperty<ObservableCollection<LibraryTreeNode>>(
        LibraryTreeNode, 'Children', undefined as unknown as ObservableCollection<LibraryTreeNode>, MetaData.None)
    public static readonly IsLibraryKey = Model.RegisterProperty<boolean>(LibraryTreeNode, 'IsLibrary', false, MetaData.None)
    public static readonly IsDraggableKey = Model.RegisterProperty<boolean>(LibraryTreeNode, 'IsDraggable', false, MetaData.None)
    // Whether this class's concept has an openable wiki page (filled async by the
    // libraries panel service). Drives the shared "Open Wiki" menu-item visibility.
    public static readonly HasWikiKey = Model.RegisterProperty<boolean>(LibraryTreeNode, 'HasWiki', false, MetaData.None)

    // Library-node identity (id/version of the installed library) + the uninstall
    // command the row's context menu invokes. Set only on Library nodes.
    public static readonly LibIdKey = Model.RegisterProperty<string>(LibraryTreeNode, 'LibId', '', MetaData.None)
    public static readonly LibVersionKey = Model.RegisterProperty<string>(LibraryTreeNode, 'LibVersion', '', MetaData.None)
    public static readonly DeleteCommandKey = Model.RegisterProperty<ICommand | undefined>(
        LibraryTreeNode, 'DeleteCommand', undefined, MetaData.None)

    // Class-leaf render surface + drag payload.
    public static readonly TermIdKey = Model.RegisterProperty<string>(LibraryTreeNode, 'TermId', '', MetaData.None)
    public static readonly ConceptKey = Model.RegisterProperty<string>(LibraryTreeNode, 'Concept', '', MetaData.None)
    public static readonly DisplayKey = Model.RegisterProperty<string>(LibraryTreeNode, 'Display', '', MetaData.None)
    public static readonly LabelKey = Model.RegisterProperty<string>(LibraryTreeNode, 'Label', '', MetaData.None)
    public static readonly LocalIdKey = Model.RegisterProperty<string>(LibraryTreeNode, 'LocalId', '', MetaData.None)
    // The visual descriptor the preview's ToolboxVisualPresenter renders (Tile
    // context); the presenter's DataContext is this node, so $Display binds here.
    public static readonly DescriptorKey = Model.RegisterProperty<ToolboxVisualDescriptor | undefined>(
        LibraryTreeNode, 'Descriptor', undefined, MetaData.None)
    public static readonly BeginDragDataKey = Model.RegisterProperty<(() => { data: DataObject; effects: DragDropEffects }) | undefined>(
        LibraryTreeNode, 'BeginDragData', undefined, MetaData.None)

    constructor()
    {
        super()
        this.set_property_value(LibraryTreeNode.ChildrenKey, new ObservableCollection<LibraryTreeNode>())
    }

    public get Name(): string { return this.get_property_value(LibraryTreeNode.NameKey) }
    public get Kind(): LibraryNodeKind { return this.get_property_value(LibraryTreeNode.KindKey) }
    public get Children(): ObservableCollection<LibraryTreeNode> { return this.get_property_value(LibraryTreeNode.ChildrenKey) }
    public get IsLibrary(): boolean { return this.get_property_value(LibraryTreeNode.IsLibraryKey) }
    public get IsDraggable(): boolean { return this.get_property_value(LibraryTreeNode.IsDraggableKey) }
    public get HasWiki(): boolean { return this.get_property_value(LibraryTreeNode.HasWikiKey) }
    public set HasWiki(v: boolean) { this.set_property_value(LibraryTreeNode.HasWikiKey, v) }
    public get LibId(): string { return this.get_property_value(LibraryTreeNode.LibIdKey) }
    public get LibVersion(): string { return this.get_property_value(LibraryTreeNode.LibVersionKey) }
    public get DeleteCommand(): ICommand | undefined { return this.get_property_value(LibraryTreeNode.DeleteCommandKey) }
    public set DeleteCommand(v: ICommand | undefined) { this.set_property_value(LibraryTreeNode.DeleteCommandKey, v) }
    public get TermId(): string { return this.get_property_value(LibraryTreeNode.TermIdKey) }
    public get Concept(): string { return this.get_property_value(LibraryTreeNode.ConceptKey) }
    public get Display(): string { return this.get_property_value(LibraryTreeNode.DisplayKey) }
    public get Label(): string { return this.get_property_value(LibraryTreeNode.LabelKey) }
    public get LocalId(): string { return this.get_property_value(LibraryTreeNode.LocalIdKey) }
    public get Descriptor(): ToolboxVisualDescriptor | undefined { return this.get_property_value(LibraryTreeNode.DescriptorKey) }
    public get BeginDragData(): (() => { data: DataObject; effects: DragDropEffects }) | undefined {
        return this.get_property_value(LibraryTreeNode.BeginDragDataKey)
    }

    // A container node (Library or Concept): named, no drag, no preview surface.
    public static group(name: string, kind: LibraryNodeKind): LibraryTreeNode
    {
        const n = new LibraryTreeNode()
        n.set_property_value(LibraryTreeNode.NameKey, name)
        n.set_property_value(LibraryTreeNode.KindKey, kind)
        n.set_property_value(LibraryTreeNode.IsLibraryKey, kind === LibraryNodeKind.Library)
        return n
    }

    // A Library group node: a named group that also carries its installed id/version
    // so the row's context menu can uninstall it.
    public static library(name: string, id: string, version: string): LibraryTreeNode
    {
        const n = LibraryTreeNode.group(name, LibraryNodeKind.Library)
        n.set_property_value(LibraryTreeNode.LibIdKey, id)
        n.set_property_value(LibraryTreeNode.LibVersionKey, version)
        return n
    }

    // A class leaf: carries the render surface + a visual descriptor + a draggable
    // repository-item payload the architecture canvas accepts.
    public static leaf(
        info: { display: string; label: string; localId: string; termId: string; concept: string },
    ): LibraryTreeNode
    {
        const n = new LibraryTreeNode()
        n.set_property_value(LibraryTreeNode.KindKey, LibraryNodeKind.Class)
        n.set_property_value(LibraryTreeNode.NameKey, info.display)
        n.set_property_value(LibraryTreeNode.DisplayKey, info.display)
        n.set_property_value(LibraryTreeNode.LabelKey, info.label)
        n.set_property_value(LibraryTreeNode.LocalIdKey, info.localId)
        n.set_property_value(LibraryTreeNode.TermIdKey, info.termId)
        n.set_property_value(LibraryTreeNode.ConceptKey, info.concept)
        n.set_property_value(LibraryTreeNode.DescriptorKey, new ToolboxVisualDescriptor(TodlVisualResolverKey, info.termId))
        n.set_property_value(LibraryTreeNode.IsDraggableKey, true)
        const itemId = 'term:' + info.termId
        n.set_property_value(LibraryTreeNode.BeginDragDataKey, () => ({
            data:    new DataObject().Set(TOOLBOX_ITEM_FORMAT, itemId),
            effects: DragDropEffects.Copy,
        }))
        return n
    }
}

import { DataObject, DragDropEffects, MetaData, Model, ObservableCollection } from '@pragmatic-lab/mural/runtime'
import { TOOLBOX_NODE_KIND_FORMAT } from '@pragmatic-lab/mural/framework'
import type { DataTemplate } from '@pragmatic-lab/mural/basic'

// The three tiers of the Libraries tree. One node type carries all three, kept
// apart by Kind (mirrors ProjectNode's single-type-plus-Kind shape).
export enum LibraryNodeKind { Library = 'library', Concept = 'concept', Class = 'class' }

// A node in the Libraries TreeView. Group nodes (Library/Concept) carry a Name +
// Children; Class leaves additionally carry the render surface a mounted library
// template binds against ($Display/$Label/$LocalId/$Concept), the resolved
// Template, a self-reference Data (so the inline-preview ContentPresenter can bind
// Content = $Data), and a drag payload emitting the term id under the canvas-drop
// format so the leaf can be dropped onto an .archdiagram.
export class LibraryTreeNode extends Model
{
    public static readonly NameKey = Model.RegisterProperty<string>(LibraryTreeNode, 'Name', '', MetaData.None)
    public static readonly KindKey = Model.RegisterProperty<LibraryNodeKind>(LibraryTreeNode, 'Kind', LibraryNodeKind.Class, MetaData.None)
    public static readonly ChildrenKey = Model.RegisterProperty<ObservableCollection<LibraryTreeNode>>(
        LibraryTreeNode, 'Children', undefined as unknown as ObservableCollection<LibraryTreeNode>, MetaData.None)
    public static readonly IsLibraryKey = Model.RegisterProperty<boolean>(LibraryTreeNode, 'IsLibrary', false, MetaData.None)
    public static readonly IsDraggableKey = Model.RegisterProperty<boolean>(LibraryTreeNode, 'IsDraggable', false, MetaData.None)
    public static readonly IsPreviewOpenKey = Model.RegisterProperty<boolean>(LibraryTreeNode, 'IsPreviewOpen', false, MetaData.None)

    // Class-leaf render surface + drag payload.
    public static readonly TermIdKey = Model.RegisterProperty<string>(LibraryTreeNode, 'TermId', '', MetaData.None)
    public static readonly ConceptKey = Model.RegisterProperty<string>(LibraryTreeNode, 'Concept', '', MetaData.None)
    public static readonly DisplayKey = Model.RegisterProperty<string>(LibraryTreeNode, 'Display', '', MetaData.None)
    public static readonly LabelKey = Model.RegisterProperty<string>(LibraryTreeNode, 'Label', '', MetaData.None)
    public static readonly LocalIdKey = Model.RegisterProperty<string>(LibraryTreeNode, 'LocalId', '', MetaData.None)
    public static readonly TemplateKey = Model.RegisterProperty<DataTemplate | undefined>(LibraryTreeNode, 'Template', undefined, MetaData.None)
    public static readonly DataKey = Model.RegisterProperty<LibraryTreeNode>(
        LibraryTreeNode, 'Data', undefined as unknown as LibraryTreeNode, MetaData.None)
    public static readonly BeginKindDragDataKey = Model.RegisterProperty<(() => { data: DataObject; effects: DragDropEffects }) | undefined>(
        LibraryTreeNode, 'BeginKindDragData', undefined, MetaData.None)

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
    public get IsPreviewOpen(): boolean { return this.get_property_value(LibraryTreeNode.IsPreviewOpenKey) }
    public set IsPreviewOpen(v: boolean) { this.set_property_value(LibraryTreeNode.IsPreviewOpenKey, v) }
    public get TermId(): string { return this.get_property_value(LibraryTreeNode.TermIdKey) }
    public get Concept(): string { return this.get_property_value(LibraryTreeNode.ConceptKey) }
    public get Display(): string { return this.get_property_value(LibraryTreeNode.DisplayKey) }
    public get Label(): string { return this.get_property_value(LibraryTreeNode.LabelKey) }
    public get LocalId(): string { return this.get_property_value(LibraryTreeNode.LocalIdKey) }
    public get Template(): DataTemplate | undefined { return this.get_property_value(LibraryTreeNode.TemplateKey) }
    public get Data(): LibraryTreeNode { return this.get_property_value(LibraryTreeNode.DataKey) }
    public get BeginKindDragData(): (() => { data: DataObject; effects: DragDropEffects }) | undefined {
        return this.get_property_value(LibraryTreeNode.BeginKindDragDataKey)
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

    // A class leaf: carries the render surface + resolved template + a draggable
    // term payload the architecture canvas accepts.
    public static leaf(
        info: { display: string; label: string; localId: string; termId: string; concept: string },
        template: DataTemplate | undefined,
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
        n.set_property_value(LibraryTreeNode.TemplateKey, template)
        n.set_property_value(LibraryTreeNode.DataKey, n)
        n.set_property_value(LibraryTreeNode.IsDraggableKey, true)
        n.set_property_value(LibraryTreeNode.BeginKindDragDataKey, () => ({
            data:    new DataObject().Set(TOOLBOX_NODE_KIND_FORMAT, info.termId),
            effects: DragDropEffects.Copy,
        }))
        return n
    }
}

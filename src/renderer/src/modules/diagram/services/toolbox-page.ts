// toolbox-page.ts — the unified toolbox's page + tile models.
//
// A ToolboxPage is one tab/accordion section: a built-in Shapes page (its Items
// are framework ToolboxShapes) or a taxonomy page (its Items are TermTiles).
// TermTile lives here (moved from the architecture module) because the toolbox
// is now the single palette that renders both tile kinds.
import {
    DataObject,
    DragDropEffects,
    MetaData,
    Model,
    ObservableCollection,
} from '@pragmatic-lab/mural/runtime'
import { TOOLBOX_NODE_KIND_FORMAT } from '@pragmatic-lab/mural/framework'
import type { DataTemplate } from '@pragmatic-lab/mural/basic'

// Which content a page carries. Markup-facing (a template selector may switch on
// it), so it is a real enum with stable string values.
export enum ToolboxPageKind
{
    Shapes = 'shapes',
    Taxonomy = 'taxonomy',
}

// One draggable palette tile: a published library term (or a meta-model taxonomy
// term). `TermId` is the full dotted id the drop resolver + reference wiring
// consume; `Display`/`Concept` label it; `Template` is the term's mounted visual.
// Dragging carries the term id under the framework's canvas-drop format
// (TOOLBOX_NODE_KIND_FORMAT) via `BeginKindDragData` wired to the tile's
// `OnDragStart`, mirroring ToolboxShape. The canvas's ItemDropped handler reads
// it back and calls applyTermDrop.
export class TermTile extends Model
{
    public static readonly TermIdKey   = Model.RegisterProperty<string>(TermTile, 'TermId', '', MetaData.None)
    public static readonly DisplayKey  = Model.RegisterProperty<string>(TermTile, 'Display', '', MetaData.None)
    public static readonly ConceptKey  = Model.RegisterProperty<string>(TermTile, 'Concept', '', MetaData.None)
    public static readonly TemplateKey = Model.RegisterProperty<DataTemplate>(
        TermTile, 'Template', undefined as unknown as DataTemplate, MetaData.None)
    public static readonly BeginKindDragDataKey = Model.RegisterProperty<(() => { data: DataObject; effects: DragDropEffects }) | undefined>(
        TermTile, 'BeginKindDragData', undefined, MetaData.None)

    constructor(termId: string, display: string, concept: string, template: DataTemplate)
    {
        super()
        this.set_property_value(TermTile.TermIdKey, termId)
        this.set_property_value(TermTile.DisplayKey, display)
        this.set_property_value(TermTile.ConceptKey, concept)
        this.set_property_value(TermTile.TemplateKey, template)
        this.set_property_value(TermTile.BeginKindDragDataKey, () => ({
            data:    new DataObject().Set(TOOLBOX_NODE_KIND_FORMAT, this.TermId),
            effects: DragDropEffects.Copy,
        }))
    }

    public get TermId(): string { return this.get_property_value(TermTile.TermIdKey) }
    public get Display(): string { return this.get_property_value(TermTile.DisplayKey) }
    public get Concept(): string { return this.get_property_value(TermTile.ConceptKey) }
    public get Template(): DataTemplate { return this.get_property_value(TermTile.TemplateKey) }
    public get BeginKindDragData(): (() => { data: DataObject; effects: DragDropEffects }) | undefined {
        return this.get_property_value(TermTile.BeginKindDragDataKey)
    }
}

// One toolbox tab/accordion section.
export class ToolboxPage extends Model
{
    public static readonly TitleKey = Model.RegisterProperty<string>(ToolboxPage, 'Title', '', MetaData.None)
    public static readonly KindKey  = Model.RegisterProperty<ToolboxPageKind>(
        ToolboxPage, 'Kind', ToolboxPageKind.Taxonomy, MetaData.None)
    public static readonly ItemsKey = Model.RegisterProperty<ObservableCollection<unknown>>(
        ToolboxPage, 'Items', undefined as unknown as ObservableCollection<unknown>, MetaData.None)

    constructor(title: string, kind: ToolboxPageKind)
    {
        super()
        this.set_property_value(ToolboxPage.TitleKey, title)
        this.set_property_value(ToolboxPage.KindKey, kind)
        this.set_property_value(ToolboxPage.ItemsKey, new ObservableCollection<unknown>())
    }

    public get Title(): string { return this.get_property_value(ToolboxPage.TitleKey) }
    public get Kind(): ToolboxPageKind { return this.get_property_value(ToolboxPage.KindKey) }
    public get Items(): ObservableCollection<unknown> { return this.get_property_value(ToolboxPage.ItemsKey) }
}

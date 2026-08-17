import { MetaData, Model, type ServiceKey } from '@pragmatic-lab/mural/runtime'
import { ToolboxItem, type ToolboxVisualDescriptor, type IToolboxDropFactory } from '@pragmatic-lab/mural/framework'

// A Plexus toolbox item that also exposes Display (= the term label) so a class
// presentation template's $Display binds through the tile presenter's inherited
// DataContext. The mural base carries Id/Label/Descriptor/FactoryKey/BeginDragData.
export class ArchToolboxItem extends ToolboxItem
{
    public static readonly DisplayKey = Model.RegisterProperty<string>(
        ArchToolboxItem, 'Display', '', MetaData.None)
    // The concept this tile drops + whether it has an openable wiki page. Drive
    // the shared "Open Wiki" context menu (Visibility via HasWiki, CommandParameter
    // via Concept). HasWiki is filled asynchronously by the contributor.
    public static readonly ConceptKey = Model.RegisterProperty<string>(
        ArchToolboxItem, 'Concept', '', MetaData.None)
    public static readonly HasWikiKey = Model.RegisterProperty<boolean>(
        ArchToolboxItem, 'HasWiki', false, MetaData.None)

    constructor(
        id: string,
        label: string,
        descriptor: ToolboxVisualDescriptor,
        factoryKey: ServiceKey<IToolboxDropFactory>,
        concept = '',
    )
    {
        super(id, label, descriptor, factoryKey)
        this.set_property_value(ArchToolboxItem.DisplayKey, label)
        this.set_property_value(ArchToolboxItem.ConceptKey, concept)
    }

    public get Display(): string { return this.get_property_value(ArchToolboxItem.DisplayKey) }
    public get Concept(): string { return this.get_property_value(ArchToolboxItem.ConceptKey) }
    public get HasWiki(): boolean { return this.get_property_value(ArchToolboxItem.HasWikiKey) }
    public set HasWiki(v: boolean) { this.set_property_value(ArchToolboxItem.HasWikiKey, v) }
}

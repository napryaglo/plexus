import { MetaData, Model, type ServiceKey } from '@pragmatic-lab/mural/runtime'
import { ToolboxItem, type ToolboxVisualDescriptor, type IToolboxDropFactory } from '@pragmatic-lab/mural/framework'

// A Plexus toolbox item that also exposes Display (= the term label) so a class
// presentation template's $Display binds through the tile presenter's inherited
// DataContext. The mural base carries Id/Label/Descriptor/FactoryKey/BeginDragData.
export class ArchToolboxItem extends ToolboxItem
{
    public static readonly DisplayKey = Model.RegisterProperty<string>(
        ArchToolboxItem, 'Display', '', MetaData.None)

    constructor(
        id: string,
        label: string,
        descriptor: ToolboxVisualDescriptor,
        factoryKey: ServiceKey<IToolboxDropFactory>,
    )
    {
        super(id, label, descriptor, factoryKey)
        this.set_property_value(ArchToolboxItem.DisplayKey, label)
    }

    public get Display(): string { return this.get_property_value(ArchToolboxItem.DisplayKey) }
}

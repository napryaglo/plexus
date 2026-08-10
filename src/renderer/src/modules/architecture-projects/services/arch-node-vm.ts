import { MetaData, Model } from '@pragmatic-lab/mural/runtime'
import { SideConnectableNodeVM, ToolboxVisualDescriptor } from '@pragmatic-lab/mural/framework'

// Extends SideConnectableNodeVM (not NodeViewModel) so connector endpoints
// anchored to an arch item distribute across its sides, rebalance, and show
// port markers — the same side-endpoint host surface ShapeNodeVM has. Without
// it, side-slot registration silently no-ops for arch items.
export class ArchNodeVM extends SideConnectableNodeVM {
    static readonly LabelKey = Model.RegisterProperty<string>(ArchNodeVM, 'Label', '', MetaData.None)
    static readonly DescriptorKey = Model.RegisterProperty<ToolboxVisualDescriptor | undefined>(
        ArchNodeVM,
        'Descriptor',
        undefined,
        MetaData.None,
    )

    constructor() {
        super()
        this.Width = 72
        this.Height = 56
    }

    get Label(): string {
        return this.get_property_value(ArchNodeVM.LabelKey)
    }

    set Label(v: string) {
        this.set_property_value(ArchNodeVM.LabelKey, v)
    }

    get Descriptor(): ToolboxVisualDescriptor | undefined {
        return this.get_property_value(ArchNodeVM.DescriptorKey)
    }

    set Descriptor(v: ToolboxVisualDescriptor | undefined) {
        this.set_property_value(ArchNodeVM.DescriptorKey, v)
    }

    get EntityId(): string | undefined {
        return this.Id
    }
}

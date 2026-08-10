import { MetaData, Model } from '@pragmatic-lab/mural/runtime'
import { NodeViewModel, ToolboxVisualDescriptor } from '@pragmatic-lab/mural/framework'

export class ArchNodeVM extends NodeViewModel {
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

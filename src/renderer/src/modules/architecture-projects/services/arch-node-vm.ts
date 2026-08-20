import { MetaData, Model } from '@pragmatic-lab/mural/runtime'
import { DiagramSettings, NodeViewModel, ToolboxVisualDescriptor } from '@pragmatic-lab/mural/framework'

// A content view-model: identity (Id) + content (Label / Descriptor / IconSize /
// Concept / wiki). It carries NO geometry — its container Figure is the geometry
// owner AND the side-endpoint host (connector endpoints resolve to the container,
// which distributes them across its sides). The tile's default 72×56 box comes
// from the drop factory's store record, and content-fit from the container's
// SizeToContent (set when the container binds a VM). See the container-owned-
// geometry redesign.
export class ArchNodeVM extends NodeViewModel {
    static readonly LabelKey = Model.RegisterProperty<string>(ArchNodeVM, 'Label', '', MetaData.None)
    static readonly DescriptorKey = Model.RegisterProperty<ToolboxVisualDescriptor | undefined>(
        ArchNodeVM,
        'Descriptor',
        undefined,
        MetaData.None,
    )
    // Edge length of the icon glyph. Seeded from the shared shape-default-size
    // setting (read once at construction, exactly as Figure.fromKind reads it)
    // so an arch node's icon renders at the same size as a geometric shape.
    // A real DP so the tile template can bind `$IconSize`.
    static readonly IconSizeKey = Model.RegisterProperty<number>(ArchNodeVM, 'IconSize', 80, MetaData.None)

    // The concept this node instantiates + whether it has an openable wiki page.
    // Drive the "Open Wiki" context menu (Visibility via HasWiki, CommandParameter
    // via Concept). Populated by ArchDiagramBinding.rescan.
    static readonly ConceptKey = Model.RegisterProperty<string>(ArchNodeVM, 'Concept', '', MetaData.None)
    static readonly HasWikiKey = Model.RegisterProperty<boolean>(ArchNodeVM, 'HasWiki', false, MetaData.None)

    constructor() {
        super()
        // Icon glyph edge length, seeded from the shared shape-default-size
        // setting so an arch node's icon matches a geometric shape. A real DP so
        // the tile template can bind `$IconSize`. Geometry (box size, content-fit)
        // lives on the container Figure, not here.
        this.IconSize = DiagramSettings.ShapeDefaultSize()
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

    get IconSize(): number {
        return this.get_property_value(ArchNodeVM.IconSizeKey)
    }

    set IconSize(v: number) {
        this.set_property_value(ArchNodeVM.IconSizeKey, v)
    }

    get Concept(): string {
        return this.get_property_value(ArchNodeVM.ConceptKey)
    }

    set Concept(v: string) {
        this.set_property_value(ArchNodeVM.ConceptKey, v)
    }

    get HasWiki(): boolean {
        return this.get_property_value(ArchNodeVM.HasWikiKey)
    }

    set HasWiki(v: boolean) {
        this.set_property_value(ArchNodeVM.HasWikiKey, v)
    }

    get EntityId(): string | undefined {
        return this.Id
    }
}

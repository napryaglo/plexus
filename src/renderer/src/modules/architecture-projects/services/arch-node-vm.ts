import { MetaData, Model } from '@pragmatic-lab/mural/runtime'
import { DiagramSettings, SideConnectableNodeVM, ToolboxVisualDescriptor } from '@pragmatic-lab/mural/framework'

// Extends SideConnectableNodeVM (not NodeViewModel) so connector endpoints
// anchored to an arch item distribute across its sides, rebalance, and show
// port markers — the same side-endpoint host surface a shape Figure has. Without
// it, side-slot registration silently no-ops for arch items.
export class ArchNodeVM extends SideConnectableNodeVM {
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
        this.Width = 72
        this.Height = 56
        this.IconSize = DiagramSettings.ShapeDefaultSize()
        // An arch node is an icon+label tile, not a geometric shape — its box
        // should follow its content so the selection/resize adorner wraps the
        // whole tile (icon AND label), not just the icon. The container measures
        // the tile and writes Width/Height back through the two-way bind.
        this.SizeToContent = true
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

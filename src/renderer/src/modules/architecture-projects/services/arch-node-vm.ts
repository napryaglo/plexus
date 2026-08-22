import { MetaData, MuralBase } from '@pragmatic-lab/mural/runtime'
import { DiagramSettings, NodeViewModel, ToolboxVisualDescriptor } from '@pragmatic-lab/mural/framework'

// Initial box for a freshly-dropped arch tile. The container fits its content
// once measured (SizeToContent), but a drop needs a starting box before the
// container realizes — the drop factories write this into the document store by
// id (was the ArchNodeVM ctor's 72×56 before geometry moved off the VM).
export const ARCH_TILE_DEFAULT = { w: 72, h: 56 } as const

// A content view-model: identity (Id) + content (Label / Descriptor / IconSize /
// Concept / wiki). It carries NO geometry — its container Figure is the geometry
// owner AND the side-endpoint host (connector endpoints resolve to the container,
// which distributes them across its sides). The tile's default 72×56 box comes
// from the drop factory's store record, and content-fit from the container's
// SizeToContent (set when the container binds a VM). See the container-owned-
// geometry redesign.
export class ArchNodeVM extends NodeViewModel {
    static readonly LabelKey = MuralBase.RegisterProperty<string>(ArchNodeVM, 'Label', '', MetaData.None)
    static readonly DescriptorKey = MuralBase.RegisterProperty<ToolboxVisualDescriptor | undefined>(
        ArchNodeVM,
        'Descriptor',
        undefined,
        MetaData.None,
    )
    // Edge length of the icon glyph. Seeded from the shared shape-default-size
    // setting (read once at construction, exactly as Figure.fromKind reads it)
    // so an arch node's icon renders at the same size as a geometric shape.
    // A real DP so the tile template can bind `$IconSize`.
    static readonly IconSizeKey = MuralBase.RegisterProperty<number>(ArchNodeVM, 'IconSize', 80, MetaData.None)

    // The concept this node instantiates + whether it has an openable wiki page.
    // Drive the "Open Wiki" context menu (Visibility via HasWiki, CommandParameter
    // via Concept). Populated by ArchDiagramBinding.rescan.
    static readonly ConceptKey = MuralBase.RegisterProperty<string>(ArchNodeVM, 'Concept', '', MetaData.None)
    static readonly HasWikiKey = MuralBase.RegisterProperty<boolean>(ArchNodeVM, 'HasWiki', false, MetaData.None)

    // ── In-place title editing (F2 / double-click) ──────────────────────────
    // An arch node's editable text is its TITLE ($Label), NOT the container
    // Figure's ShapeText (a geometric shape's centred caption). Implementing the
    // BeginEdit/CommitEdit/CancelEdit lifecycle makes the diagram's F2 handler
    // (and double-click) resolve the edit target to THIS VM — see mural
    // resolveEditTarget, which duck-types on BeginEdit — instead of falling back
    // to the blank ShapeText.
    //
    // IsEditing swaps the tile's static label for a TextBox (a `when($IsEditing)`
    // trigger in the ArchNodeVM DataTemplate); EditingLabel is that box's two-way
    // text buffer. Both are view-observable state (a trigger / binding reads
    // them), so they are DPs — not plain fields. The commit does NOT persist by
    // itself: the Label is DERIVED from the backing entity on every rescan, so a
    // local write would be clobbered. CommitEdit fires LabelCommitted; the
    // ArchDiagramBinding writes the entity's `label` field + saves, and the next
    // rescan re-derives the same title.
    static readonly IsEditingKey = MuralBase.RegisterProperty<boolean>(ArchNodeVM, 'IsEditing', false, MetaData.None)
    static readonly EditingLabelKey = MuralBase.RegisterProperty<string>(ArchNodeVM, 'EditingLabel', '', MetaData.None)

    // Listeners notified when an edit COMMITS with a changed, non-empty title.
    // The ArchDiagramBinding subscribes to persist the new title to the entity.
    private readonly labelCommitted: Array<(title: string) => void> = []

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

    get IsEditing(): boolean {
        return this.get_property_value(ArchNodeVM.IsEditingKey)
    }

    set IsEditing(v: boolean) {
        this.set_property_value(ArchNodeVM.IsEditingKey, v)
    }

    get EditingLabel(): string {
        return this.get_property_value(ArchNodeVM.EditingLabelKey)
    }

    set EditingLabel(v: string) {
        this.set_property_value(ArchNodeVM.EditingLabelKey, v)
    }

    // Enter in-place title editing: seed the buffer from the current title and
    // reveal the editor (the trigger swaps in the TextBox; FocusOnVisibleBehavior
    // focuses + selects it). No-op when already editing.
    BeginEdit(): void {
        if (this.IsEditing) return
        this.EditingLabel = this.Label
        this.IsEditing = true
    }

    // Commit the edit: a trimmed, changed, non-empty title fires LabelCommitted
    // (the binding persists it to the entity + saves; rescan re-derives Label).
    // An empty or unchanged edit just leaves edit mode — no persist, no clobber.
    // Idempotent: the IsEditing guard makes a redundant commit (e.g. a LostFocus
    // firing right after an Enter commit) a no-op.
    CommitEdit(): void {
        if (!this.IsEditing) return
        this.IsEditing = false
        const next = this.EditingLabel.trim()
        if (next === '' || next === this.Label) return
        for (const cb of [...this.labelCommitted]) cb(next)
    }

    // Abandon the edit — the buffer is discarded, Label unchanged.
    CancelEdit(): void {
        if (!this.IsEditing) return
        this.IsEditing = false
    }

    // Subscribe to committed title edits (the ArchDiagramBinding wires this to
    // persist the new title to the backing entity). Returns an unsubscribe thunk.
    AddLabelCommittedListener(cb: (title: string) => void): () => void {
        this.labelCommitted.push(cb)
        return () => {
            const i = this.labelCommitted.indexOf(cb)
            if (i >= 0) this.labelCommitted.splice(i, 1)
        }
    }
}

import { MetaData, MuralBase, type PropertyKey } from '@pragmatic-lab/mural/runtime'
import { DiagramSettings, NodeViewModel, ToolboxVisualDescriptor, type ITextStyleTarget } from '@pragmatic-lab/mural/framework'
import { Brush, FontFamily, FontStyle, FontWeight, TextAlignment, TextDecorations } from '@pragmatic-lab/mural/visual-engine'

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

    // Whether this node's concept is a container (holds nested children). Read
    // duck-typed by mural's GetContainerForItemOverride (0.21.0) to realize the
    // node as a ContentContainerFigure instead of a plain content tile. Set from
    // the concept by ArchDiagramBinding.rescan.
    static readonly IsContainerKey = MuralBase.RegisterProperty<boolean>(ArchNodeVM, 'IsContainer', false, MetaData.None)

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

    // ── Per-node label text style (Format Shape → Text page) ────────────────
    // The tile's $Label is a template TextBlock, not the container Figure's blank
    // ShapeText, so the Text page reaches it through the `TextStyle` adapter below
    // (mural FormatMirror routes a content VM's char/paragraph edits to its
    // ITextStyleTarget). Each DP is undefined until the user overrides it, so the
    // template keeps the @BodySmall / @OnSurface defaults (`$LabelX is set`
    // triggers) and only the touched properties override — no visual drift on
    // existing diagrams. Persisted per-node in the .diagram visual (labelStyle),
    // like the per-shape lock/anchor intents.
    static readonly LabelFontFamilyKey = MuralBase.RegisterProperty<string | undefined>(ArchNodeVM, 'LabelFontFamily', undefined, MetaData.None)
    static readonly LabelFontSizeKey = MuralBase.RegisterProperty<number | undefined>(ArchNodeVM, 'LabelFontSize', undefined, MetaData.None)
    static readonly LabelForegroundKey = MuralBase.RegisterProperty<Brush | undefined>(ArchNodeVM, 'LabelForeground', undefined, MetaData.None)
    static readonly LabelFontWeightKey = MuralBase.RegisterProperty<FontWeight | undefined>(ArchNodeVM, 'LabelFontWeight', undefined, MetaData.None)
    static readonly LabelFontStyleKey = MuralBase.RegisterProperty<FontStyle | undefined>(ArchNodeVM, 'LabelFontStyle', undefined, MetaData.None)
    static readonly LabelTextDecorationsKey = MuralBase.RegisterProperty<TextDecorations | undefined>(ArchNodeVM, 'LabelTextDecorations', undefined, MetaData.None)
    static readonly LabelTextAlignmentKey = MuralBase.RegisterProperty<TextAlignment | undefined>(ArchNodeVM, 'LabelTextAlignment', undefined, MetaData.None)

    // The @BodySmall size the label inherits when LabelFontSize is unset — the
    // value the Text page shows as the starting point (mural typography token).
    static readonly LABEL_DEFAULT_FONT_SIZE = 12

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

    get IsContainer(): boolean {
        return this.get_property_value(ArchNodeVM.IsContainerKey)
    }

    set IsContainer(v: boolean) {
        this.set_property_value(ArchNodeVM.IsContainerKey, v)
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

    // ── Label text-style DPs + adapter ──────────────────────────────────────
    get LabelFontFamily(): string | undefined { return this.get_property_value(ArchNodeVM.LabelFontFamilyKey) }
    set LabelFontFamily(v: string | undefined) { this.set_property_value(ArchNodeVM.LabelFontFamilyKey, v) }
    get LabelFontSize(): number | undefined { return this.get_property_value(ArchNodeVM.LabelFontSizeKey) }
    set LabelFontSize(v: number | undefined) { this.set_property_value(ArchNodeVM.LabelFontSizeKey, v) }
    get LabelForeground(): Brush | undefined { return this.get_property_value(ArchNodeVM.LabelForegroundKey) }
    set LabelForeground(v: Brush | undefined) { this.set_property_value(ArchNodeVM.LabelForegroundKey, v) }
    get LabelFontWeight(): FontWeight | undefined { return this.get_property_value(ArchNodeVM.LabelFontWeightKey) }
    set LabelFontWeight(v: FontWeight | undefined) { this.set_property_value(ArchNodeVM.LabelFontWeightKey, v) }
    get LabelFontStyle(): FontStyle | undefined { return this.get_property_value(ArchNodeVM.LabelFontStyleKey) }
    set LabelFontStyle(v: FontStyle | undefined) { this.set_property_value(ArchNodeVM.LabelFontStyleKey, v) }
    get LabelTextDecorations(): TextDecorations | undefined { return this.get_property_value(ArchNodeVM.LabelTextDecorationsKey) }
    set LabelTextDecorations(v: TextDecorations | undefined) { this.set_property_value(ArchNodeVM.LabelTextDecorationsKey, v) }
    get LabelTextAlignment(): TextAlignment | undefined { return this.get_property_value(ArchNodeVM.LabelTextAlignmentKey) }
    set LabelTextAlignment(v: TextAlignment | undefined) { this.set_property_value(ArchNodeVM.LabelTextAlignmentKey, v) }

    // The text-style target mural's FormatMirror seeds from + broadcasts to for
    // this node's label (the Text page). Lazily built; wraps the DPs above.
    private _textStyle: ArchLabelTextStyle | undefined
    get TextStyle(): ITextStyleTarget {
        return (this._textStyle ??= new ArchLabelTextStyle(this))
    }

    // The persisted style DPs whose edit must dirty the diagram (mural's
    // DiagramDocument watches these — a content VM has no Fill/Stroke/geometry of
    // its own, so without this a label-style edit never marks the doc dirty and is
    // never saved). The card fill/stroke lives on the container Figure, which the
    // document tracks separately.
    DirtyStyleKeys(): PropertyKey<unknown>[] {
        return [
            ArchNodeVM.LabelFontFamilyKey,
            ArchNodeVM.LabelFontSizeKey,
            ArchNodeVM.LabelForegroundKey,
            ArchNodeVM.LabelFontWeightKey,
            ArchNodeVM.LabelFontStyleKey,
            ArchNodeVM.LabelTextDecorationsKey,
            ArchNodeVM.LabelTextAlignmentKey,
        ] as PropertyKey<unknown>[]
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

// Block-level text style over an ArchNodeVM's Label* DPs. The Apply* set the DP
// (which the tile's PART_Title binds), the Current* read the effective value the
// Text page reflects. Bold/italic map to FontWeight/FontStyle; underline +
// strikethrough share the TextDecorations flags so both can be on at once.
class ArchLabelTextStyle implements ITextStyleTarget {
    constructor(private readonly vm: ArchNodeVM) {}

    private decos(): TextDecorations { return this.vm.LabelTextDecorations ?? TextDecorations.None }

    ApplyFontFamily(family: FontFamily | string): void { this.vm.LabelFontFamily = typeof family === 'string' ? family : family.Source }
    ApplyFontSize(size: number): void { this.vm.LabelFontSize = size }
    ApplyForeground(brush: Brush): void { this.vm.LabelForeground = brush }
    ApplyBold(on: boolean): void { this.vm.LabelFontWeight = on ? FontWeight.Bold : FontWeight.Normal }
    ApplyItalic(on: boolean): void { this.vm.LabelFontStyle = on ? FontStyle.Italic : FontStyle.Normal }
    ApplyUnderline(on: boolean): void { this.vm.LabelTextDecorations = on ? (this.decos() | TextDecorations.Underline) : (this.decos() & ~TextDecorations.Underline) }
    ApplyStrikethrough(on: boolean): void { this.vm.LabelTextDecorations = on ? (this.decos() | TextDecorations.Strikethrough) : (this.decos() & ~TextDecorations.Strikethrough) }
    ApplyParagraphAlignment(align: TextAlignment): void { this.vm.LabelTextAlignment = align }

    CurrentFontFamily(): string { return this.vm.LabelFontFamily ?? '' }
    CurrentFontSize(): number { return this.vm.LabelFontSize ?? ArchNodeVM.LABEL_DEFAULT_FONT_SIZE }
    CurrentForeground(): Brush | undefined { return this.vm.LabelForeground }
    CurrentBold(): boolean { return this.vm.LabelFontWeight === FontWeight.Bold }
    CurrentItalic(): boolean { return this.vm.LabelFontStyle === FontStyle.Italic }
    CurrentUnderline(): boolean { return (this.decos() & TextDecorations.Underline) !== 0 }
    CurrentStrikethrough(): boolean { return (this.decos() & TextDecorations.Strikethrough) !== 0 }
    CurrentParagraphAlignment(): TextAlignment { return this.vm.LabelTextAlignment ?? TextAlignment.Center }
}

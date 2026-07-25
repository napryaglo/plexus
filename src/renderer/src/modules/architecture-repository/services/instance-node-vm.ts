import { MetaData, Model } from '@pragmatic-lab/mural/runtime'
import type { DataTemplate } from '@pragmatic-lab/mural/basic'

import type { ArchInstanceModel } from './architecture-instance-model.js'

// A bindable view of one own instance node — the DataContext a class template
// renders against on the canvas. Reads the node from the JSON-backed model and
// refreshes reactively when the model changes; field edits write back through the
// model (which regenerates the `.todl` on save).
export class InstanceNodeVM extends Model
{
    // The node's display string (its `label`, else its id).
    public static readonly DisplayKey = Model.RegisterProperty<string>(InstanceNodeVM, 'Display', '', MetaData.None)
    // The meta-model concept the node instantiates (its typeOf).
    public static readonly ConceptKey = Model.RegisterProperty<string>(InstanceNodeVM, 'Concept', '', MetaData.None)
    // The library term the node references (its first reference edge target) — the
    // key the canvas resolves the visual template with. '' when none.
    public static readonly ReferencedTermKey = Model.RegisterProperty<string>(InstanceNodeVM, 'ReferencedTerm', '', MetaData.None)
    // The resolved visual template (its referenced term's, via LibraryRegistry).
    // Set by the canvas when the node's container is built; a
    // `DataTemplate[InstanceNodeVM]` binds a ContentPresenter's ContentTemplate to it.
    public static readonly TemplateKey = Model.RegisterProperty<DataTemplate | undefined>(
        InstanceNodeVM, 'Template', undefined, MetaData.None)
    // Self-reference: the node template presents the vm THROUGH its per-term
    // Template via `ContentPresenter [ Content = $Data, ContentTemplate = $Template ]`
    // (mirrors library ClassRow). `$Data` must be a registered property, hence a DP
    // that holds `this` rather than a plain getter — bindings only walk DPs.
    public static readonly DataKey = Model.RegisterProperty<InstanceNodeVM>(
        InstanceNodeVM, 'Data', undefined as unknown as InstanceNodeVM, MetaData.None)
    // Canvas position. The Diagram's ItemContainerStyle binds the node Figure's
    // Left/Top to these (the item is the container's DataContext); Figure.Left/Top
    // is two-way-by-default, so dragging the node writes back here, and Save reads
    // them. Seeded from the document layout when the container VM is created.
    public static readonly LeftKey = Model.RegisterProperty<number>(InstanceNodeVM, 'Left', 0, MetaData.None)
    public static readonly TopKey  = Model.RegisterProperty<number>(InstanceNodeVM, 'Top', 0, MetaData.None)

    private readonly unsubscribe: () => void

    constructor(
        private readonly model: ArchInstanceModel,
        public readonly Id: string,
    )
    {
        super()
        this.set_property_value(InstanceNodeVM.DataKey, this)
        this.unsubscribe = model.onChanged(() => this.refresh())
        this.refresh()
    }

    public get Display(): string { return this.get_property_value(InstanceNodeVM.DisplayKey) }
    public get Concept(): string { return this.get_property_value(InstanceNodeVM.ConceptKey) }
    public get ReferencedTerm(): string { return this.get_property_value(InstanceNodeVM.ReferencedTermKey) }
    public get Template(): DataTemplate | undefined { return this.get_property_value(InstanceNodeVM.TemplateKey) }
    public set Template(v: DataTemplate | undefined) { this.set_property_value(InstanceNodeVM.TemplateKey, v) }
    public get Data(): InstanceNodeVM { return this.get_property_value(InstanceNodeVM.DataKey) }
    public get Left(): number { return this.get_property_value(InstanceNodeVM.LeftKey) }
    public set Left(v: number) { this.set_property_value(InstanceNodeVM.LeftKey, v) }
    public get Top(): number { return this.get_property_value(InstanceNodeVM.TopKey) }
    public set Top(v: number) { this.set_property_value(InstanceNodeVM.TopKey, v) }

    // Edit a scalar field; the model fires `changed`, which refreshes this VM.
    public SetField(name: string, value: string | number | boolean): void
    {
        this.model.setField(this.Id, name, value)
    }

    // Stop tracking the model (call when the node leaves the canvas).
    public Dispose(): void { this.unsubscribe() }

    private refresh(): void
    {
        const node = this.model.node(this.Id)
        const label = node?.attrs.label
        this.set_property_value(InstanceNodeVM.DisplayKey, typeof label === 'string' ? label : this.Id)
        this.set_property_value(InstanceNodeVM.ConceptKey, node?.typeOf ?? '')
        const ref = this.model.document.edges.find((e) => e.kind === 'Relationship' && e.from === this.Id)
        this.set_property_value(InstanceNodeVM.ReferencedTermKey, ref !== undefined ? String(ref.to) : '')
    }
}

import { MetaData, Model } from '@pragmatic-lab/mural/runtime'
import { ToolboxVisualDescriptor } from '@pragmatic-lab/mural/framework'

import type { ArchInstanceModel } from './architecture-instance-model.js'
import { LibraryClassVisualResolverKey } from '../../diagram/services/library-class-visual-resolver.js'
import { ConceptVisualResolverKey } from '../../diagram/services/concept-visual-resolver.js'

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
    // The visual descriptor the node's ToolboxVisualPresenter renders (Figure
    // context). Rebuilt on refresh from the referenced term (library class) or,
    // absent one, the concept — the same keying the canvas used to resolve a
    // template with. The node template binds `Descriptor = $Descriptor`; the
    // presenter's DataContext is this VM, so the class template's $Display binds here.
    public static readonly DescriptorKey = Model.RegisterProperty<ToolboxVisualDescriptor | undefined>(
        InstanceNodeVM, 'Descriptor', undefined, MetaData.None)
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
        this.unsubscribe = model.onChanged(() => this.refresh())
        this.refresh()
    }

    public get Display(): string { return this.get_property_value(InstanceNodeVM.DisplayKey) }
    public get Concept(): string { return this.get_property_value(InstanceNodeVM.ConceptKey) }
    public get ReferencedTerm(): string { return this.get_property_value(InstanceNodeVM.ReferencedTermKey) }
    public get Descriptor(): ToolboxVisualDescriptor | undefined { return this.get_property_value(InstanceNodeVM.DescriptorKey) }
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
        const term = ref !== undefined ? String(ref.to) : ''
        this.set_property_value(InstanceNodeVM.ReferencedTermKey, term)
        // A referenced library term resolves through the library-class resolver; a
        // bare instance through the concept resolver. Same keying the old
        // ResolveTemplate used (referenced term wins, else concept).
        const descriptor = term !== ''
            ? new ToolboxVisualDescriptor(LibraryClassVisualResolverKey, term)
            : new ToolboxVisualDescriptor(ConceptVisualResolverKey, node?.typeOf ?? '')
        this.set_property_value(InstanceNodeVM.DescriptorKey, descriptor)
    }
}

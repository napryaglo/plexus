import { MetaData, Model, ObservableCollection } from '@pragmatic-lab/mural/runtime'
import { Figure } from '@pragmatic-lab/mural/framework'
import type { IDocument, Connector, DiagramMutator, ConnectorEndpoint, GeometryCombineMode } from '@pragmatic-lab/mural/framework'
import type { DataTemplate } from '@pragmatic-lab/mural/basic'

import type { IStorage } from '../../../services/storage/storage.js'
import type { LibraryRegistry } from '../../library/services/library-registry.js'
import type { ArchInstanceModel } from './architecture-instance-model.js'
import { InstanceNodeVM } from './instance-node-vm.js'
import { applyTermDrop, applyConnect } from './arch-canvas-ops.js'

// The on-disk shape of a `.archdiagram` file: the layout (positions) + the
// pointer to the sibling `.todl` that holds the semantics.
export interface ArchLayout
{
    namespace: string
    todlFile:  string
    layout:    Record<string, { x: number; y: number }>
    version:   number
}

// An architecture-diagram document (a tab). The TODL instance model is the source
// of truth; this document adds node view-models + their canvas positions. Save
// emits the `.todl` (validated by the existing pipeline) and writes the layout.
//
// It also IS the canvas's DiagramMutator: a base `Diagram` bound with this document
// as its DataContext auto-wires it (structural DiagramMutator check), so an item
// drop calls CreateNode, a drawn connector calls CreateConnector, and Delete calls
// DeleteNodes — no Diagram subclass needed (a subclass can't be a `.mu` element).
export class ArchDiagramDocument extends Model implements IDocument, DiagramMutator
{
    public static readonly TitleKey = Model.RegisterProperty<string>(ArchDiagramDocument, 'Title', '', MetaData.None)
    // Node VMs are a DP (not a plain field) so the editor DataTemplate can bind
    // `ItemsSource = $Nodes` — bindings only walk DPs. The palette is the global
    // Toolbox now (ToolboxService), not a per-document embed.
    public static readonly NodesKey = Model.RegisterProperty<ObservableCollection<InstanceNodeVM>>(
        ArchDiagramDocument, 'Nodes', undefined as unknown as ObservableCollection<InstanceNodeVM>, MetaData.None)
    // Empty in v1 — reference edges live in the emitted `.todl`, not as drawn
    // connectors. Bound so the canvas's connector-interaction behavior always has a
    // valid collection; deriving visual connectors from model edges is a follow-up.
    public static readonly ConnectorsKey = Model.RegisterProperty<ObservableCollection<Connector>>(
        ArchDiagramDocument, 'Connectors', undefined as unknown as ObservableCollection<Connector>, MetaData.None)

    private readonly positions = new Map<string, { x: number; y: number }>()
    private dirty = false

    constructor(
        public readonly Id: string,               // the .archdiagram project-relative path
        public readonly Model: ArchInstanceModel,
        public readonly storage: IStorage,
        public readonly todlFile: string,
        layout: Record<string, { x: number; y: number }>,
        title: string,
        private readonly registry?: LibraryRegistry,
    )
    {
        super()
        this.set_property_value(ArchDiagramDocument.TitleKey, title)
        this.set_property_value(ArchDiagramDocument.NodesKey, new ObservableCollection<InstanceNodeVM>())
        this.set_property_value(ArchDiagramDocument.ConnectorsKey, new ObservableCollection<Connector>())
        for (const [id, p] of Object.entries(layout)) this.positions.set(id, p)
        for (const id of Model.ownInstances()) this.AddNode(id)
        Model.onChanged(() => { this.dirty = true })
    }

    public get Title(): string { return this.get_property_value(ArchDiagramDocument.TitleKey) }
    public get IsDirty(): boolean { return this.dirty }
    public get Nodes(): ObservableCollection<InstanceNodeVM> { return this.get_property_value(ArchDiagramDocument.NodesKey) }
    public get Connectors(): ObservableCollection<Connector> { return this.get_property_value(ArchDiagramDocument.ConnectorsKey) }

    // The visual template for a node — its referenced term's template (else its
    // concept), resolved through the LibraryRegistry (which returns the default box
    // when nothing is mounted). Undefined only when no registry is wired.
    public ResolveTemplate(vm: InstanceNodeVM): DataTemplate | undefined
    {
        const key = vm.ReferencedTerm !== '' ? vm.ReferencedTerm : vm.Concept
        return this.registry?.resolve(key, vm.Concept)
    }

    public LayoutOf(id: string): { x: number; y: number } | undefined { return this.positions.get(id) }
    public SetLayout(id: string, x: number, y: number): void { this.positions.set(id, { x, y }); this.dirty = true }

    // Materialise a node VM for an instance id (on open + on drop-create). Seeds the
    // node's resolved term template + its saved canvas position so the container the
    // Diagram builds renders the right visual at the right place.
    public AddNode(id: string): InstanceNodeVM
    {
        const vm = new InstanceNodeVM(this.Model, id)
        vm.Template = this.ResolveTemplate(vm)
        const p = this.positions.get(id)
        if (p !== undefined) { vm.Left = p.x; vm.Top = p.y }
        this.Nodes.Add(vm)
        return vm
    }

    // ── DiagramMutator (auto-wired from the canvas's DataContext) ──────────

    // A library term was dropped at (x,y): create the concept instance referencing
    // it. `kind` is the term id the palette tile carried. Returns the node VM so the
    // Diagram selects the fresh drop; null when nothing resolves.
    public CreateNode(kind: string, x: number, y: number): unknown | null
    {
        const r = applyTermDrop(this, kind, x, y)
        if (!('created' in r)) return null
        return this.Nodes.ToArray().find((v) => v.Id === r.created) ?? null
    }

    // A connector was drawn between two nodes: set the reference member linking them.
    // No visual connector is materialised in v1 (the reference lives in the `.todl`).
    public CreateConnector(source: ConnectorEndpoint, target: ConnectorEndpoint): Connector | null
    {
        const from = this.nodeOf(source)
        const to = this.nodeOf(target)
        if (from === undefined || to === undefined) return null
        applyConnect(this.Model, from.Id, to.Id)
        return null
    }

    // Delete requested (Delete key): remove each node's instance from the model +
    // its VM/position from the canvas.
    public DeleteNodes(items: readonly unknown[]): void
    {
        for (const item of items) {
            if (!(item instanceof InstanceNodeVM)) continue
            this.Model.remove(item.Id)
            this.Nodes.Remove(item)
            this.positions.delete(item.Id)
            item.Dispose()
        }
        this.dirty = true
    }

    // Grouping is not modelled in v1 — the mutator surface is required for the
    // structural auto-wire, but these are intentional no-ops.
    public Group(_items: readonly unknown[]): void { /* unsupported in v1 */ }
    public Ungroup(_items: readonly unknown[]): void { /* unsupported in v1 */ }
    public CombineSelection(_items: readonly unknown[], _mode: GeometryCombineMode): void { /* unsupported in v1 */ }

    public async Save(): Promise<void>
    {
        // Fold live canvas positions (dragged nodes wrote back through Left/Top) into
        // the layout map before emitting; ids without a live VM keep their map entry.
        for (const vm of this.Nodes.ToArray()) this.positions.set(vm.Id, { x: vm.Left, y: vm.Top })
        await this.storage.WriteText(this.todlFile, this.Model.emit())
        const doc: ArchLayout = {
            namespace: this.Model.namespace,
            todlFile:  this.todlFile,
            layout:    Object.fromEntries(this.positions),
            version:   1,
        }
        await this.storage.WriteText(this.Id, JSON.stringify(doc, null, 2))
        this.dirty = false
    }

    // The InstanceNodeVM behind a connector endpoint (its Node is the item's Figure,
    // whose Content the base Diagram set to the VM).
    private nodeOf(ep: ConnectorEndpoint): InstanceNodeVM | undefined
    {
        const node = ep.Node
        const content = (node instanceof Figure) ? node.Content : undefined
        return (content instanceof InstanceNodeVM) ? content : undefined
    }
}

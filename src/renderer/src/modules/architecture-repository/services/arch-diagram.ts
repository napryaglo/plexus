import { MetaData, Model, type Visual } from '@pragmatic-lab/mural/runtime'
import { Diagram, Figure, TOOLBOX_NODE_KIND_FORMAT, type ItemDroppedArgs, type ConnectorCreatedArgs } from '@pragmatic-lab/mural/framework'

import { InstanceNodeVM } from './instance-node-vm.js'
import { applyTermDrop, applyConnect } from './arch-canvas-ops.js'
import type { ArchDiagramDocument } from './arch-diagram-document.js'

// A concept-aware diagram: each node is an InstanceNodeVM rendered through its
// library term's template (via the document's ResolveTemplate) rather than a
// builtin shape. Everything else — selection, drag, connectors, drop — is the
// framework Diagram's. A `Document` DP carries the collaborator that resolves both
// the template and the node's saved position.
export class ArchDiagram extends Diagram
{
    public static readonly DocumentKey = Model.RegisterProperty<ArchDiagramDocument | undefined>(
        ArchDiagram, 'Document', undefined, MetaData.None)

    constructor()
    {
        super()
        // Term drop → create a concept instance referencing the term. The palette
        // emits the term id under the canvas-drop format; the model mutation adds a
        // node VM to the document, which the base Diagram materialises as a Figure.
        this.AddItemDroppedListener((e) => this.OnTermDropped(e))
        // Connector drawn between two nodes → set the reference member linking them.
        this.AddConnectorCreatedListener((e) => this.OnConnectorCreated(e))
    }

    public get Document(): ArchDiagramDocument | undefined { return this.get_property_value(ArchDiagram.DocumentKey) }
    public set Document(v: ArchDiagramDocument | undefined) { this.set_property_value(ArchDiagram.DocumentKey, v) }

    // Read the dropped term id (carried under TOOLBOX_NODE_KIND_FORMAT) and create
    // the node through the pure canvas op. No-op when nothing resolves.
    public OnTermDropped(e: ItemDroppedArgs): void
    {
        const termId = e.Data.Get(TOOLBOX_NODE_KIND_FORMAT)
        const doc = this.Document
        if (typeof termId !== 'string' || doc === undefined) return
        applyTermDrop(doc, termId, e.Position.X, e.Position.Y)
    }

    // Map the two endpoint Figures back to their node ids and set the reference
    // member. No-op when either endpoint is not a node VM or no member links them.
    public OnConnectorCreated(e: ConnectorCreatedArgs): void
    {
        const doc = this.Document
        if (doc === undefined) return
        const from = this.nodeOf(e.Source.Node)
        const to = this.nodeOf(e.Target.Node)
        if (from === undefined || to === undefined) return
        applyConnect(doc.Model, from.Id, to.Id)
    }

    // The InstanceNodeVM behind an endpoint's Node (a Figure whose Content is the vm).
    private nodeOf(node: unknown): InstanceNodeVM | undefined
    {
        const content = (node instanceof Figure) ? node.Content : undefined
        return (content instanceof InstanceNodeVM) ? content : undefined
    }

    // Materialise a node container: a Figure whose Content is the VM and whose
    // ContentTemplate is the resolved term template (the overridden Figure template
    // hosts a ContentPresenter over that). Position comes from the saved layout.
    public override GetContainerForItemOverride(item: unknown): Visual
    {
        if (!(item instanceof InstanceNodeVM)) return super.GetContainerForItemOverride(item)

        const doc = this.Document
        const pos = doc?.LayoutOf(item.Id)
        // Resolve the node's visual template onto the VM; the Figure hosts the VM
        // as Content, and DataTemplate[InstanceNodeVM] binds a ContentPresenter's
        // ContentTemplate to `$Template` (ContentControl itself has no per-item
        // template DP — it resolves by the Content's type, one template for all).
        item.Template = doc?.ResolveTemplate(item)
        const fig = new Figure()
        fig.Left = pos?.x ?? 0
        fig.Top = pos?.y ?? 0
        fig.Id = item.Id
        fig.Content = item
        return fig
    }
}

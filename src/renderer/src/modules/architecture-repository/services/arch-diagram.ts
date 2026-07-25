import { MetaData, Model, type Visual } from '@pragmatic-lab/mural/runtime'
import { Diagram, Figure } from '@pragmatic-lab/mural/framework'

import { InstanceNodeVM } from './instance-node-vm.js'
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

    public get Document(): ArchDiagramDocument | undefined { return this.get_property_value(ArchDiagram.DocumentKey) }
    public set Document(v: ArchDiagramDocument | undefined) { this.set_property_value(ArchDiagram.DocumentKey, v) }

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

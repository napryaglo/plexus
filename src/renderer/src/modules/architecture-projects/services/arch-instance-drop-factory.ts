import { ServiceKey } from '@pragmatic-lab/mural/runtime'
import type { IToolboxDropFactory, ToolboxDropContext } from '@pragmatic-lab/mural/framework'

export const ArchInstanceDropFactoryKey = new ServiceKey<IToolboxDropFactory>('ArchInstanceDropFactory')

// Drops a toolbox term onto the arch canvas by reusing the document's own
// CreateNode (ArchDiagramDocument IS the DiagramMutator): create the concept
// instance referencing the term, at the drop position. The descriptor Key is the
// term id; the mutator re-derives the concept via resolveTermDrop. Returns the
// created node (so the Diagram selects it) or null when nothing resolves.
export class ArchInstanceDropFactory implements IToolboxDropFactory
{
    public CreateDropped(context: ToolboxDropContext): unknown | null
    {
        return context.Mutator.CreateNode(context.Descriptor.Key, context.Position.X, context.Position.Y) ?? null
    }
}

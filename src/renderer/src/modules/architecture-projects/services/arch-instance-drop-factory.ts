import { ServiceKey } from '@pragmatic-lab/mural/runtime'
import type { IToolboxDropFactory, ToolboxDropContext } from '@pragmatic-lab/mural/framework'

export const ArchInstanceDropFactoryKey = new ServiceKey<IToolboxDropFactory>('ArchInstanceDropFactory')

// Drops a toolbox term onto a canvas by delegating to the document's own
// CreateNode: the descriptor Key (the term id) is handed to whichever
// DiagramMutator backs the active diagram, which decides how to realize it.
// Document-agnostic — the future architecture-model-bound generic document will
// reuse this seam. Returns the created node (so the Diagram selects it) or null
// when the mutator resolves nothing (e.g. a standalone diagram that ignores terms).
export class ArchInstanceDropFactory implements IToolboxDropFactory
{
    public CreateDropped(context: ToolboxDropContext): unknown | null
    {
        return context.Mutator.CreateNode(context.Descriptor.Key, context.Position.X, context.Position.Y) ?? null
    }
}

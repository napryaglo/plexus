import { ServiceKey } from '@pragmatic-lab/mural/runtime'
import {
    DiagramDocument,
    Figure,
    type NodeViewModel,
    type IToolboxDropFactory,
    type ToolboxDropContext,
} from '@pragmatic-lab/mural/framework'

export const GenericContainerDropFactoryKey = new ServiceKey<IToolboxDropFactory>('GenericContainerDropFactory')

// Starting box for a freshly-dropped generic container.
const GENERIC_CONTAINER_BOX = { width: 240, height: 180 } as const

// Drops a generic, VISUAL-ONLY container: mural's `container` figure kind, which
// the standard ShapeDropFactory can't place (its CreateNode guards on the shape
// catalog, and `container` is not a catalog shape). The dropped ContainerFigure
// carries a `container:<n>` id — a scheme distinct from the document's `n<N>` node
// ids, so it never collides — which is required for ContainerPlacement to register
// it as a container (an id-less container can hold no children). The id matches no
// model entity, so the arch binding's rescan, containment projection, and
// write-back all skip it: its nesting stays visual (persisted via the visual
// store, not the model).
export class GenericContainerDropFactory implements IToolboxDropFactory
{
    public CreateDropped(context: ToolboxDropContext): unknown | null
    {
        const doc = context.Mutator as unknown as DiagramDocument
        const fig = Figure.fromKind('container', context.Position.X, context.Position.Y, GENERIC_CONTAINER_BOX)
        fig.Id = nextContainerId(doc)
        // AddNode is typed for content VMs; a container Figure is an equally valid node.
        context.Mutator.AddNode(fig as unknown as NodeViewModel)
        return fig
    }
}

// The next unused `container:<n>` id for this document — one past the highest such
// id currently placed. Distinct from the doc's `n<N>` counter, so the two never
// collide and a reload preserves the id (the load path claims non-empty ids).
function nextContainerId(doc: DiagramDocument): string
{
    let max = 0
    for (const n of doc.Nodes.ToArray()) {
        const id = (n as { Id?: string }).Id
        if (id === undefined || !id.startsWith('container:')) continue
        const k = Number(id.slice('container:'.length))
        if (Number.isFinite(k) && k > max) max = k
    }
    return `container:${max + 1}`
}

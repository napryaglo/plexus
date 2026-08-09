import { DiagramDocument, Figure } from '@pragmatic-lab/mural/framework'
import type { Entity } from '@pragmatic-lab/todl'
import type { ArchModel } from './arch-model.js'

// Binds a single opened diagram to a project's ArchModel: mural Figures whose
// Id is a model entity id are tracked and labelled from the entity; on model
// change their labels re-sync and figures whose entity was deleted are removed.
// Figures whose Id matches no entity are freeform shapes and left untouched.
// SP4a owns identity + label + orphan removal only; visuals/Kind belong to
// whoever created the node (SP4b's drop).
export class ArchDiagramBinding
{
    private off: (() => void) | undefined
    private readonly bound = new Map<string, Figure>()   // entityId -> figure

    public constructor(
        private readonly doc: DiagramDocument,
        private readonly model: ArchModel,
    ) {}

    public attach(): void
    {
        const byId = new Map(this.model.entities().map((e) => [e.id, e]))
        for (const node of this.doc.Nodes.ToArray()) {
            if (!(node instanceof Figure)) continue
            const id = node.Id
            if (id === undefined) continue
            const entity = byId.get(id)
            if (entity === undefined) continue
            this.bound.set(id, node)
            node.LabelText = displayLabel(entity)
        }
        this.off = this.model.onChanged(() => this.refresh())
    }

    private refresh(): void
    {
        const byId = new Map(this.model.entities().map((e) => [e.id, e]))
        for (const [id, figure] of [...this.bound]) {
            const entity = byId.get(id)
            if (entity === undefined) {
                this.doc.DeleteNodes([figure])
                this.bound.delete(id)
            } else {
                figure.LabelText = displayLabel(entity)
            }
        }
    }

    public dispose(): void
    {
        this.off?.()
        this.off = undefined
    }
}

// An entity's display label: its `label`, else `name`, else its id.
function displayLabel(entity: Entity): string
{
    const v = entity.field('label') ?? entity.field('name')
    return v !== undefined ? String(v) : entity.id
}

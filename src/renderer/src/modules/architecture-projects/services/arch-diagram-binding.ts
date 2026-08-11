import { DiagramDocument, Figure, ToolboxVisualDescriptor } from '@pragmatic-lab/mural/framework'
import type { Entity } from '@pragmatic-lab/todl'
import { TodlVisualResolverKey } from '../../diagram/services/todl-visual-resolver.js'
import type { ArchModel } from './arch-model.js'
import { ArchNodeVM } from './arch-node-vm.js'
import { iconEntityKey } from './arch-icon.js'

// Binds an opened diagram to a project's ArchModel. On every model change it
// rescans doc.Nodes: ArchNodeVMs (and legacy Figures) whose Id is a live entity
// are tracked + labelled (this binds drop-created nodes too, since the drop fires
// notifyChanged after setting the Id); tracked nodes whose entity was deleted are
// removed. Nodes whose Id matches no entity are freeform shapes, left untouched.
export class ArchDiagramBinding
{
    private off: (() => void) | undefined
    private readonly bound = new Map<string, Figure | ArchNodeVM>()   // entityId -> node
    private scope: string[] = []                                       // selected viewpoints ([] = all)

    public constructor(
        private readonly doc: DiagramDocument,
        public readonly model: ArchModel,
    ) {}

    public attach(): void
    {
        this.rescan()
        this.off = this.model.onChanged(() => this.rescan())
    }

    private rescan(): void
    {
        const byId = new Map(this.model.entities().map((e) => [e.id, e]))
        // Bind + derive label/icon for every node that maps to a live entity.
        for (const node of this.doc.Nodes.ToArray()) {
            if (node instanceof ArchNodeVM) {
                const id = node.Id
                if (id === undefined) continue
                const entity = byId.get(id)
                if (entity === undefined) continue
                this.bound.set(id, node)
                node.Label = displayLabel(entity)
                // Key the icon by the entity's stamped icon-annotation resource key
                // (referenced term first, then own concept); fall back to the bare
                // concept when nothing carries an icon (→ default glyph).
                const key = iconEntityKey(this.model.repository(), entity) ?? entity.concept
                node.Descriptor = new ToolboxVisualDescriptor(TodlVisualResolverKey, key)
            } else if (node instanceof Figure) {
                // Back-compat for any freeform Figure with a matching entity id.
                const id = node.Id
                if (id === undefined) continue
                const entity = byId.get(id)
                if (entity === undefined) continue
                this.bound.set(id, node)
                node.LabelText = displayLabel(entity)
            }
        }
        // Remove tracked nodes whose entity is gone.
        for (const [id, node] of [...this.bound]) {
            if (!byId.has(id)) {
                this.doc.DeleteNodes([node])
                this.bound.delete(id)
            }
        }
    }

    // Replace the diagram's selected-viewpoint scope (empty = all).
    public setScope(viewpoints: string[]): void
    {
        this.scope = [...viewpoints]
    }

    // The scope as a set; empty falls back to every viewpoint the model declares.
    public scopeSet(): Set<string>
    {
        return this.scope.length > 0
            ? new Set(this.scope)
            : new Set(this.model.viewpoints().map((v) => v.id))
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

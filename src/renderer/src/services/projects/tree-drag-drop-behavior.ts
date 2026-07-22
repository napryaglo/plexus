import { Behavior, type Visual } from '@pragmatic-lab/mural/runtime'
import { DataObject, DragDropEffects, type DragEventArgs, type DragStartSpec } from '@pragmatic-lab/mural/visual-engine'

import { OpenProject } from './open-project.js'
import { ProjectNode } from './project.js'
import { resolveDropTargetPath } from './node-move.js'
import type { MoveArg } from '../../modules/project-explorer/services/project-explorer-service.js'

// Drag-and-drop MOVE for the project tree, on top of mural's drag-drop framework.
// Attached (via `.Behaviors:`) to each tree row (DataContext = ProjectNode) and to
// the project header (DataContext = OpenProject, a drop-only root target).
//
// A ProjectNode row is both a drag SOURCE — OnDragStart packages the dragged set
// (the multi-selection if the pressed node is in it, else just that node) into a
// DataObject — and a drop TARGET. On drop, the target folder is resolved from the
// row under the pointer (folder → itself; file → its parent; header → root '') and
// the move runs through OpenProject.MoveNodesCommand. Intra-project only: the
// DataObject travels within one tree, and the owning OpenProject is found by
// walking up to the TreeView's DataContext.
const NODES_FORMAT = 'plexus/project-nodes'
const SOURCE_FORMAT = 'plexus/project-source'

export class TreeDragDropBehavior extends Behavior
{
    private visual: Visual | undefined
    private readonly onOver = (a: unknown): void => this.over(a as DragEventArgs)
    private readonly onDrop = (a: unknown): void => this.drop(a as DragEventArgs)

    public override OnAttached(visual: Visual): void
    {
        this.visual = visual
        visual.AllowDrop = true
        if (visual.DataContext instanceof ProjectNode) {
            visual.IsDraggable = true
            visual.OnDragStart = (source) => this.startDrag(source)
        }
        visual.AddRoutedEventListener('DragOver', this.onOver)
        visual.AddRoutedEventListener('Drop', this.onDrop)
    }

    public override OnDetached(visual: Visual): void
    {
        visual.RemoveRoutedEventListener('DragOver', this.onOver)
        visual.RemoveRoutedEventListener('Drop', this.onDrop)
        visual.OnDragStart = undefined
        this.visual = undefined
    }

    // Drag source: the dragged nodes = the multi-selection if the pressed node is
    // part of it, else just this row's node. Effect is Move.
    private startDrag(source: Visual): DragStartSpec | null
    {
        const node = source.DataContext
        if (!(node instanceof ProjectNode)) return null
        const op = this.ownerProject(source)
        const selected = op?.SelectedNodes ?? []
        const nodes = selected.includes(node) ? selected : [node]
        const data = new DataObject()
        data.Set(NODES_FORMAT, nodes)
        // Carry the source project so a drop onto ANOTHER project can move across.
        if (op !== undefined) data.Set(SOURCE_FORMAT, op)
        return { data, effects: DragDropEffects.Move }
    }

    // Accept a project-node drag (marks the Move effect, so the framework shows a
    // move cursor and this row highlights via its IsDragOver state).
    private over(a: DragEventArgs): void
    {
        if (a.Data.Has(NODES_FORMAT)) { a.Effect = DragDropEffects.Move; a.Handled = true }
    }

    // Drop: resolve the target folder from this row's node and run the move.
    private drop(a: DragEventArgs): void
    {
        const nodes = a.Data.Get<readonly ProjectNode[]>(NODES_FORMAT)
        if (nodes === undefined || this.visual === undefined) return
        const op = this.ownerProject(this.visual)
        if (op === undefined) return
        const targetNode = this.visual.DataContext instanceof ProjectNode ? this.visual.DataContext : undefined
        const destPath = resolveDropTargetPath(targetNode)
        // The source project rode in the DataObject; a drag begun elsewhere (no
        // source) is treated as same-project (source = the drop target's project).
        const source = a.Data.Get<OpenProject>(SOURCE_FORMAT) ?? op
        op.MoveNodesCommand?.Execute({ nodes, destPath, source } satisfies MoveArg)
        a.Handled = true
    }

    // The OpenProject that owns this visual — the TreeView's / header's DataContext,
    // found by walking up the visual tree.
    private ownerProject(from: Visual): OpenProject | undefined
    {
        let cur: Visual | undefined = from
        while (cur !== undefined) {
            if (cur.DataContext instanceof OpenProject) return cur.DataContext
            cur = cur.GetVisualParent()
        }
        return undefined
    }
}

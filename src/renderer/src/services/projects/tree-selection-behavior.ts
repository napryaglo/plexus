import { Behavior, type Visual } from '@pragmatic-lab/mural/runtime'
import { Selector } from '@pragmatic-lab/mural/framework'

import { OpenProject } from './open-project.js'
import { ProjectNode } from './project.js'

// Surfaces a project TreeView's MULTI-selection to the OpenProject it renders.
//
// The TreeView's single `SelectedDataItem` already two-way-binds to
// OpenProject.SelectedNode (the anchor — selecting a row opens it). But a
// multi-select delete needs the WHOLE set, and the framework exposes that only
// as the non-bindable `Selector.SelectedItems`. This behavior bridges the gap:
// attached to the TreeView (SelectionMode=Extended) via the view's `.Behaviors:`
// block, it listens for selection changes and pushes the selected ProjectNodes
// into OpenProject.SelectedNodes, where the host reads them for a Delete.
export class TreeSelectionBehavior extends Behavior
{
    private selector: Selector | undefined
    private listener: (() => void) | undefined

    public override OnAttached(visual: Visual): void
    {
        if (!(visual instanceof Selector)) return
        this.selector = visual
        this.listener = () => this.sync()
        visual.AddSelectionChangedListener(this.listener)
        this.sync()
    }

    public override OnDetached(_visual: Visual): void
    {
        if (this.selector !== undefined && this.listener !== undefined) {
            this.selector.RemoveSelectionChangedListener(this.listener)
        }
        this.selector = undefined
        this.listener = undefined
    }

    // Copy the selector's current data selection (the ProjectNodes) into the
    // OpenProject that is the TreeView's DataContext. Non-node items and a
    // missing/foreign DataContext are ignored so this stays inert off the tree.
    private sync(): void
    {
        const op = this.selector?.DataContext
        if (!(op instanceof OpenProject)) return
        op.SelectedNodes = (this.selector!.SelectedItems ?? []).filter(
            (i): i is ProjectNode => i instanceof ProjectNode)
    }
}

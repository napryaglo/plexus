import { Behavior, type Visual } from '@pragmatic-tech-ai/mural/runtime'
import { TreeView, TreeViewItem, type ItemTemplateSelector } from '@pragmatic-tech-ai/mural/framework'
import type { DataTemplate } from '@pragmatic-tech-ai/mural/basic'

import { OpenProject } from './open-project.js'

// View glue for the single unified project TreeView: picks the row template by
// item type, and expands each project root by default.
//
// The explorer renders one TreeView whose roots are OpenProjects and whose
// descendants are ProjectNodes — two different row templates. mural's TreeView
// has no implicit by-DataType template resolution (unlike ContentControl); it
// resolves a row via ItemTemplateSelector (which wins over ItemTemplate) and
// PROPAGATES that selector down every level. So a single selector on the root
// tree renders the OpenProject header at the top and the ProjectNode row at every
// depth. The selector is a function DP — unexpressible in markup — hence this
// behavior. Templates are resolved lazily (per row, at generation time) so their
// resource lookup runs when the tree is fully attached, not at attach time.
//
// Separately, TreeViewItem defaults to collapsed; the old per-project design kept
// projects expanded via a bound custom chevron. A ContainerPrepared hook expands
// each project root once when its container is first realized (a WeakSet keeps a
// user's later manual collapse from being undone on a rebuild).
export class ProjectTreeTemplateBehavior extends Behavior
{
    private tree: TreeView | undefined
    private prepared: ((container: Visual, item: unknown, index: number) => void) | undefined
    private readonly autoExpanded = new WeakSet<OpenProject>()

    public override OnAttached(visual: Visual): void
    {
        if (!(visual instanceof TreeView)) return
        this.tree = visual

        const selector: ItemTemplateSelector = (item) =>
            visual.TryFindResource(item instanceof OpenProject ? 'OpenProjectTemplate' : 'ProjectNodeTemplate') as DataTemplate | undefined
        visual.ItemTemplateSelector = selector

        this.prepared = (container, item) => this.expandRoot(container, item)
        visual.AddContainerPreparedListener(this.prepared)
        // Belt-and-suspenders: expand any roots already realized before the
        // listener registered (all root containers are OpenProjects).
        for (const root of visual.RootItems) root.IsExpanded = true
    }

    public override OnDetached(_visual: Visual): void
    {
        if (this.tree !== undefined && this.prepared !== undefined)
        {
            this.tree.RemoveContainerPreparedListener(this.prepared)
        }
        this.tree = undefined
        this.prepared = undefined
    }

    private expandRoot(container: Visual, item: unknown): void
    {
        if (!(item instanceof OpenProject) || !(container instanceof TreeViewItem)) return
        if (this.autoExpanded.has(item)) return
        this.autoExpanded.add(item)
        container.IsExpanded = true
    }
}

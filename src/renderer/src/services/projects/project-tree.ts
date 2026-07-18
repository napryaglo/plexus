// project-tree.ts — the view-layer glue that renders a project's ProjectNode
// tree into the framework's VSCode-style TreeView.
//
// The data-bound TreeView path (HierarchicalDataTemplate) can only carry a text
// Header — it applies no per-item leading icon or triggers — so we build the
// TreeViewItem containers explicitly. That buys full control: a per-kind leading
// glyph, initial expansion, and open-on-select routed through each node's
// existing OpenCommand (no new command wiring in the service).
//
// mountProjectTree is called from OpenProject.OnViewMounted with the mounted
// view and the project; it resolves the `x:name="tree"` TreeView, populates it,
// and re-populates whenever the project's Root swaps (a New File rebuilds the
// tree). It returns a disposer the caller keeps for teardown.
import { DynamicResource, type Visual } from '@pragmatic-lab/mural/runtime'
import { TreeView, TreeViewItem } from '@pragmatic-lab/mural/framework'
import { Shape } from '@pragmatic-lab/mural/basic'

import { OpenProject } from './open-project.js'
import { ProjectNode, type ProjectNodeKind } from './project.js'

const TREE_NAME = 'tree'
const LEADING_ICON_SIZE = 16

// The leading glyph resource key for a node kind (registered in plexus-icons.mu).
// 'folder' reuses the command-bar @Folder; each file kind has its own glyph; an
// unrecognised kind falls back to the generic file glyph.
export function iconKeyForKind(kind: ProjectNodeKind): string
{
    switch (kind) {
        case 'folder': return 'Folder'
        case 'diagram': return 'Diagram'
        case 'todl': return 'Todl'
        default: return 'File'
    }
}

// Resolve the tree, populate it from the project, and keep it in sync with Root.
// Returns a disposer that stops the Root listener and the selection routing.
export function mountProjectTree(view: Visual, op: OpenProject): () => void
{
    const tree = view.FindName(TREE_NAME)
    if (!(tree instanceof TreeView)) return () => {}

    // data item (a TreeViewItem, since built items are their own containers) →
    // its ProjectNode, so a selection can find and activate the right node.
    const nodeOf = new Map<TreeViewItem, ProjectNode>()

    const rebuild = (): void => {
        nodeOf.clear()
        tree.Items = op.Root.Children.ToArray().map((child) => buildItem(child, nodeOf))
    }
    rebuild()

    // Open on select: files run their OpenCommand (folders toggle instead). The
    // node's OpenCommand is pre-wired by ProjectExplorerService.wireNodes.
    const onSelect = (): void => {
        const sel = tree.SelectedDataItem
        if (!(sel instanceof TreeViewItem)) return
        const node = nodeOf.get(sel)
        if (node === undefined) return
        if (node.Kind === 'folder') sel.IsExpanded = !sel.IsExpanded
        else node.OpenCommand?.Execute(undefined)
    }
    tree.AddPropertyChangedListener(TreeView.SelectedDataItemKey, onSelect)
    op.AddPropertyChangedListener(OpenProject.RootKey, rebuild)

    return () => {
        tree.RemovePropertyChangedListener(TreeView.SelectedDataItemKey, onSelect)
        op.RemovePropertyChangedListener(OpenProject.RootKey, rebuild)
    }
}

// Build one TreeViewItem for a node and (recursively) its children. Folders open
// expanded so the tree isn't collapsed to bare roots on first mount.
function buildItem(node: ProjectNode, nodeOf: Map<TreeViewItem, ProjectNode>): TreeViewItem
{
    const item = new TreeViewItem()
    item.Header = node.Name
    item.Leading = leadingIcon(node.Kind)
    nodeOf.set(item, node)

    const children = node.Children.ToArray()
    if (children.length > 0) {
        item.Items = children.map((child) => buildItem(child, nodeOf))
        item.IsExpanded = true
    }
    return item
}

// A themed leading glyph for a node kind — a Shape painted through the theme's
// OnSurfaceVariant brush (no colour baked into the geometry).
function leadingIcon(kind: ProjectNodeKind): Shape
{
    const shape = new Shape()
    shape.set_property_value(Shape.GeometryKey, dyn(shape, iconKeyForKind(kind)))
    shape.set_property_value(Shape.FillKey, dyn(shape, 'OnSurfaceVariant'))
    shape.set_property_value(Shape.WidthKey, LEADING_ICON_SIZE)
    shape.set_property_value(Shape.HeightKey, LEADING_ICON_SIZE)
    return shape
}

// A DynamicResource is a deferred DP value the runtime resolves against the
// theme, but its Binding type can't stand in for the DP's declared value type
// (Geometry/Brush) in TypeScript — the generated .mu.js sets it untyped. Cast
// through `never` so a strongly-typed set_property_value accepts the binding.
function dyn(target: Shape, key: string): never
{
    return DynamicResource(target, key) as never
}

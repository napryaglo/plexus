import { test, expect, afterEach } from 'vitest'
import { Application, type Visual } from '@pragmatic-lab/mural/runtime'
import { DataTemplate, TextBlock } from '@pragmatic-lab/mural/basic'

import { LibraryResources } from '../../library.resources.mu.js'
import { LibraryTreeNode } from '../library-tree-node.js'

// View-level regression for the bottom preview pane. The preview renders a
// selected class LEAF through an implicit DataTemplate[LibraryTreeNode] whose
// inner ContentPresenter applies the node's OWN Template. Two traps this guards:
//   1. Recursion — if the inner presenter resolves Content before ContentTemplate,
//      it runs template-less and falls back to the implicit template for the
//      content's type (this same template), recursing until the stack blows and
//      the pane renders blank. The markup binds ContentTemplate before Content to
//      close that window; this test drives the REAL compiled template so a
//      reordering regresses here, not silently in the app.
//   2. Freeze — the node's self-referential Data + own Template survive the
//      ContentPresenter's DataContext pin, so the class visual actually shows.

let priorApp: Application | null = null

function withApp(): Application {
    priorApp = Application.current
    const app = new Application()
    Application.current = app
    // Merge the real library resources so findDataTemplateForType (the fallback
    // the recursion would ride) resolves the implicit preview template exactly as
    // it does in the running app.
    app.Resources.AddMergedDictionary(LibraryResources.Clone())
    return app
}

afterEach(() => { Application.current = priorApp })

function findText(root: Visual, text: string): boolean {
    if (root instanceof TextBlock && root.Text === text) return true
    for (const c of root.visualChildren) if (findText(c, text)) return true
    return false
}

function classLeaf(display: string, concept: string): LibraryTreeNode {
    const node = LibraryTreeNode.leaf({ display, label: display, localId: display, termId: `t.${display}`, concept }, undefined)
    // The class's mounted visual — a marker TextBlock so we can assert the node's
    // OWN template rendered (not a fallback / stringify / recursion artifact).
    node.Template = new DataTemplate(() => { const tb = new TextBlock(); tb.Text = `VISUAL:${display}`; return tb })
    return node
}

test('the preview template renders a class node without recursing, showing the class visual + concept', () => {
    const app = withApp()
    const preview = app.Resources.Resolve(LibraryTreeNode) as DataTemplate
    expect(preview).toBeInstanceOf(DataTemplate)   // implicit-by-type template is registered

    const node = classLeaf('Azure', 'location')

    // Applying the template + propagating DataContext is exactly what the hosting
    // ContentControl does; a broken (Content-first) ordering throws RangeError here.
    let root: Visual | undefined
    expect(() => { root = preview.Apply(node); root.DataContext = node }).not.toThrow()

    expect(findText(root!, 'VISUAL:Azure')).toBe(true)   // the node's OWN template rendered
    expect(findText(root!, 'location')).toBe(true)       // the concept label rendered
})

test('each class node renders its own visual — independent applications, no staleness', () => {
    const app = withApp()
    const preview = app.Resources.Resolve(LibraryTreeNode) as DataTemplate

    const nodeA = classLeaf('Azure', 'location')
    const rootA = preview.Apply(nodeA); rootA.DataContext = nodeA
    const nodeB = classLeaf('Kafka', 'technology')
    const rootB = preview.Apply(nodeB); rootB.DataContext = nodeB

    // Each rendered its own class visual — B is not a stale copy of A.
    expect(findText(rootA, 'VISUAL:Azure')).toBe(true)
    expect(findText(rootB, 'VISUAL:Kafka')).toBe(true)
    expect(findText(rootB, 'VISUAL:Azure')).toBe(false)
})

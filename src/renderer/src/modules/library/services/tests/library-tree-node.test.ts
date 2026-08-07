import { test, expect } from 'vitest'
import { DataTemplate } from '@pragmatic-lab/mural/basic'
import { TOOLBOX_NODE_KIND_FORMAT } from '@pragmatic-lab/mural/framework'
import { LibraryTreeNode, LibraryNodeKind } from '../library-tree-node.js'

test('group node: kind, name, empty children, inert (not draggable, no preview payload)', () => {
    const n = LibraryTreeNode.group('Microsoft  ·  0.1.0', LibraryNodeKind.Library)
    expect(n.Kind).toBe(LibraryNodeKind.Library)
    expect(n.Name).toBe('Microsoft  ·  0.1.0')
    expect(n.Children.Count).toBe(0)
    expect(n.IsLibrary).toBe(true)
    expect(n.IsDraggable).toBe(false)
    expect(n.BeginKindDragData).toBeUndefined()

    const concept = LibraryTreeNode.group('technology', LibraryNodeKind.Concept)
    expect(concept.IsLibrary).toBe(false)
})

test('class leaf: exposes the render surface + a draggable term payload', () => {
    const tpl = new DataTemplate((() => ({})) as never)
    const n = LibraryTreeNode.leaf(
        { display: 'Azure OpenAI', label: 'Azure OpenAI', localId: 'AzureOpenai', termId: 'Stack.AzureOpenai', concept: 'technology' },
        tpl,
    )
    expect(n.Kind).toBe(LibraryNodeKind.Class)
    expect(n.Name).toBe('Azure OpenAI')
    expect(n.Display).toBe('Azure OpenAI')
    expect(n.Label).toBe('Azure OpenAI')
    expect(n.LocalId).toBe('AzureOpenai')
    expect(n.TermId).toBe('Stack.AzureOpenai')
    expect(n.Concept).toBe('technology')
    expect(n.Template).toBe(tpl)
    expect(n.Data).toBe(n)
    expect(n.IsLibrary).toBe(false)
    expect(n.IsDraggable).toBe(true)

    const payload = n.BeginKindDragData!()
    expect(payload.data.Get(TOOLBOX_NODE_KIND_FORMAT)).toBe('Stack.AzureOpenai')
})

import { test, expect } from 'vitest'
import { DiagramDocument, Figure, ShapeVisualResolverKey, ToolboxRepository } from '@pragmatic-lab/mural/framework'
import { staticPageItems } from '../arch-model-toolbox-contributor.js'
import { GenericContainerDropFactory, GenericContainerDropFactoryKey } from '../generic-container-drop-factory.js'
import { ArchModelInstanceDropFactoryKey } from '../arch-model-instance-drop-factory.js'

void ToolboxRepository   // ensure the toolbox module is loaded (registers figure kinds)

test('staticPageItems contributes a generic-container tile via the shape (non-entity) factory', () => {
    const items = staticPageItems()
    const tile = items.find((i) => i.Id === 'shape:container')
    expect(tile).toBeDefined()
    expect(tile!.Label).toBe('Container')
    // Routes through the generic-container factory, NOT the model-instance factory.
    expect(tile!.FactoryKey).toBe(GenericContainerDropFactoryKey)
    expect(tile!.FactoryKey).not.toBe(ArchModelInstanceDropFactoryKey)
    // Its preview resolves through the shape visual resolver keyed by `container`.
    const descriptor = tile!.Descriptor!
    expect(descriptor.ResolverKey).toBe(ShapeVisualResolverKey)
    expect(descriptor.Key).toBe('container')
})

test('the factory drops a generic ContainerFigure with a non-entity `container:<n>` id', () => {
    const doc = new DiagramDocument()
    const item = staticPageItems()[0]!
    const ctx = {
        Item: item,
        Descriptor: item.Descriptor,
        Position: { X: 40, Y: 60 },
        Diagram: undefined,
        Mutator: doc,
    }
    const dropped = new GenericContainerDropFactory().CreateDropped(ctx as never)
    expect(dropped).toBeInstanceOf(Figure)
    const fig = dropped as Figure
    expect(fig.Id).toBe('container:1')          // distinct from the doc's `n<N>` scheme
    expect(doc.Nodes.ToArray()).toContain(fig)  // added to the document
    // A second drop gets the next container id (no collision).
    const second = new GenericContainerDropFactory().CreateDropped(ctx as never) as Figure
    expect(second.Id).toBe('container:2')
})

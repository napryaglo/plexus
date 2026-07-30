import { test, expect } from 'vitest'

import { MetaModelNodeKind } from '../meta-model-tree-node.js'
import { buildCatalog } from '../meta-model-tree-builder.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'

// The service's reload logic is `buildCatalog(backend)` → Nodes; exercise the
// builder directly against a seeded backend to assert the shape the panel binds.
test('buildCatalog produces the Model→Version node tree the service binds as Nodes', async () => {
    const storage = new FakeStorage('fake://meta-models')
    await storage.WriteText('tech/0.1.0/model.json', JSON.stringify({ nodes: [], edges: [] }))

    const nodes = await buildCatalog(storage)

    expect(nodes).toHaveLength(1)
    expect(nodes[0].Kind).toBe(MetaModelNodeKind.Model)
    expect(nodes[0].Children.Get(0)!.Kind).toBe(MetaModelNodeKind.Version)
})

test('buildCatalog on an empty backend yields no nodes (drives IsEmpty)', async () => {
    const nodes = await buildCatalog(new FakeStorage('fake://meta-models'))
    expect(nodes).toHaveLength(0)
})

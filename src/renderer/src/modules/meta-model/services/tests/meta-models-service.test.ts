import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'

import { MetaModelNodeKind } from '../meta-model-tree-node.js'
import { buildCatalog } from '../meta-model-tree-builder.js'
import { MetaModelsService } from '../meta-models-service.js'
import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { META_MODELS_BACKEND_ID } from '../meta-models-backend.js'

const NO_ACTIVATE = (): void => {}

// The service's reload logic is `buildCatalog(backend)` → Nodes; exercise the
// builder directly against a seeded backend to assert the shape the panel binds.
test('buildCatalog produces the Model→Version node tree the service binds as Nodes', async () => {
    const storage = new FakeStorage('fake://meta-models')
    await storage.WriteText('tech/0.1.0/model.json', JSON.stringify({ nodes: [], edges: [] }))

    const nodes = await buildCatalog(storage, NO_ACTIVATE)

    expect(nodes).toHaveLength(1)
    expect(nodes[0].Kind).toBe(MetaModelNodeKind.Model)
    expect(nodes[0].Children.Get(0)!.Kind).toBe(MetaModelNodeKind.Version)
})

test('buildCatalog on an empty backend yields no nodes (drives IsEmpty)', async () => {
    const nodes = await buildCatalog(new FakeStorage('fake://meta-models'), NO_ACTIVATE)
    expect(nodes).toHaveLength(0)
})

// ── openEntity / drawer ──────────────────────────────────────────────────

const MODEL_JSON = JSON.stringify({
    nodes: [
        { id: 'application', tier: 'Ontology', typeOf: 'concept', attrs: {} },
        { id: 'application.kind', tier: 'Ontology', typeOf: 'field', attrs: { name: 'kind', type: 'ApplicationKind', cardinality: 0 } },
    ],
    edges: [{ kind: 'HasField', via: null, from: 'application', to: 'application.kind' }],
})

const GENERATED = [
    'resources MetaModelPresentation {',
    '    DataTemplate x:key="mm:application" [ DataType = MetaModelEntity ] {',
    '        TextBlock [ Text = "Application" ]',
    '    }',
    '}',
].join('\n')

// A MetaModelsService over a fake meta-models backend seeded with `files`.
function serviceOver(files: Array<[string, string]>): MetaModelsService {
    const provider = new ServiceProvider()
    const registry = new StorageProviderRegistry(provider)
    const meta = new FakeStorage('fake://meta-models')
    for (const [path, text] of files) void meta.WriteText(path, text)
    registry.Register(META_MODELS_BACKEND_ID, () => meta)
    provider.registerInstance(StorageProviderRegistry.Key, registry)
    return new MetaModelsService(provider)
}

test('openEntity loads the dict, builds the entity, fills Presentation, and opens', async () => {
    const svc = serviceOver([
        ['tech-architecture/0.1.0/model.json', MODEL_JSON],
        ['tech-architecture/0.1.0/presentation/presentation.generated.mu', GENERATED],
    ])
    await svc.openEntity({ modelId: 'tech-architecture', version: '0.1.0', id: 'application' })

    expect(svc.IsDrawerOpen).toBe(true)
    expect(svc.DrawerEntity?.Id).toBe('application')
    expect(svc.DrawerEntity?.Fields.Count).toBe(1)
    expect(svc.DrawerEntity?.Presentation).toBeDefined()   // mm:application resolved + applied
})

test('openEntity still opens (Presentation undefined) when the presentation is missing', async () => {
    const svc = serviceOver([['tech-architecture/0.1.0/model.json', MODEL_JSON]])
    await svc.openEntity({ modelId: 'tech-architecture', version: '0.1.0', id: 'application' })

    expect(svc.IsDrawerOpen).toBe(true)
    expect(svc.DrawerEntity?.Id).toBe('application')
    expect(svc.DrawerEntity?.Presentation).toBeUndefined()
})

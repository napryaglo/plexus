import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'

import { MetaModelNodeKind } from '../meta-model-tree-node.js'
import { buildCatalog } from '../meta-model-tree-builder.js'
import { MetaModelsService, dependentLibraryNames } from '../meta-models-service.js'
import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { META_MODELS_BACKEND_ID } from '../meta-models-backend.js'
import { LIBRARIES_BACKEND_ID } from '../../../library/services/libraries-backend.js'
import type { LoadedLibrary } from '../../../library/services/library-loader.js'

const NO_ACTIVATE = (): void => {}
const NO_DELETE = (): void => {}

// The service's reload logic is `buildCatalog(backend)` → Nodes; exercise the
// builder directly against a seeded backend to assert the shape the panel binds.
test('buildCatalog produces the Model→Version node tree the service binds as Nodes', async () => {
    const storage = new FakeStorage('fake://meta-models')
    await storage.WriteText('tech/0.1.0/model.json', JSON.stringify({ nodes: [], edges: [] }))

    const nodes = await buildCatalog(storage, NO_ACTIVATE, NO_DELETE)

    expect(nodes).toHaveLength(1)
    expect(nodes[0].Kind).toBe(MetaModelNodeKind.Model)
    expect(nodes[0].Children.Get(0)!.Kind).toBe(MetaModelNodeKind.Version)
})

test('buildCatalog on an empty backend yields no nodes (drives IsEmpty)', async () => {
    const nodes = await buildCatalog(new FakeStorage('fake://meta-models'), NO_ACTIVATE, NO_DELETE)
    expect(nodes).toHaveLength(0)
})

// ── delete ───────────────────────────────────────────────────────────────

function lib(id: string, mmId: string, mmVersion: string): LoadedLibrary {
    return { id, version: '0.1.0', name: id, metaModel: { id: mmId, version: mmVersion }, classes: [], problems: [] }
}

test('dependentLibraryNames filters by meta-model id and optional version', () => {
    const libs = [lib('l1', 'ea', '1.0.0'), lib('l2', 'ea', '2.0.0'), lib('l3', 'other', '1.0.0')]
    expect(dependentLibraryNames(libs, 'ea').sort()).toEqual(['l1', 'l2'])   // any version
    expect(dependentLibraryNames(libs, 'ea', '1.0.0')).toEqual(['l1'])       // exact version
    expect(dependentLibraryNames(libs, 'none')).toEqual([])
})

function deleteEnv(seed: (mm: FakeStorage) => void): { provider: ServiceProvider; mm: FakeStorage } {
    const provider = new ServiceProvider()
    const registry = new StorageProviderRegistry(provider)
    const mm = new FakeStorage('fake://meta-models')
    registry.Register(META_MODELS_BACKEND_ID, () => mm)
    registry.Register(LIBRARIES_BACKEND_ID, () => new FakeStorage('fake://libraries'))
    provider.registerInstance(StorageProviderRegistry.Key, registry)
    seed(mm)
    return { provider, mm }
}

test('deleteTarget removes one version and cleans an emptied id folder', async () => {
    const { provider, mm } = deleteEnv((s) => {
        void s.WriteText('a/1.0.0/model.json', '{"nodes":[],"edges":[]}')
        void s.WriteText('a/1.1.0/model.json', '{"nodes":[],"edges":[]}')
    })
    const svc = new MetaModelsService(provider)
    await svc.reload()

    await svc.deleteTarget({ id: 'a', version: '1.0.0' })
    expect(await mm.Exists('a/1.0.0')).toBe(false)
    expect(await mm.Exists('a/1.1.0')).toBe(true)      // sibling + id folder kept

    await svc.deleteTarget({ id: 'a', version: '1.1.0' })
    expect(await mm.Exists('a/1.1.0')).toBe(false)
    expect(await mm.Exists('a')).toBe(false)           // last version → id folder cleaned
})

test('deleteTarget removes a whole model (all versions)', async () => {
    const { provider, mm } = deleteEnv((s) => {
        void s.WriteText('a/1.0.0/model.json', '{"nodes":[],"edges":[]}')
        void s.WriteText('a/1.1.0/model.json', '{"nodes":[],"edges":[]}')
    })
    const svc = new MetaModelsService(provider)
    await svc.reload()

    await svc.deleteTarget({ id: 'a' })
    expect(await mm.Exists('a')).toBe(false)
    expect(svc.Nodes.Count).toBe(0)
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

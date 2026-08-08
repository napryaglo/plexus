import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import type { DataTemplate } from '@pragmatic-lab/mural/basic'
import type { TodlDocument } from '@pragmatic-lab/todl'

import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { META_MODELS_BACKEND_ID } from '../meta-models-backend.js'
import { MetaModelPresentationSource } from '../meta-model-presentation-source.js'

const SVG = '<svg viewBox="0 0 16 16"><path d="M2 2 L14 2 L14 14 Z"/></svg>'

const DOC: TodlDocument = {
    nodes: [
        { id: 'application', tier: 'Ontology', typeOf: 'concept', attrs: { label: 'Application', icon: 'resources/app.svg' } },
    ],
    edges: [],
} as unknown as TodlDocument

// Wire a provider whose meta-models backend is the given FakeStorage.
// Mirrors the meta-models-service.test.ts pattern (registerInstance the registry,
// register the backend id so ensureMetaModelsBackend finds it via Has/Create).
function envWith(backend: FakeStorage): ServiceProvider {
    const provider = new ServiceProvider()
    const storageRegistry = new StorageProviderRegistry(provider)
    storageRegistry.Register(META_MODELS_BACKEND_ID, () => backend)
    provider.registerInstance(StorageProviderRegistry.Key, storageRegistry)
    return provider
}

// Bake a real compiled presentation for DOC into `backend` under `<id>/<version>/…`.
// Uses the real publishPresentation so the artifact format is always in sync.
async function bakePresentation(backend: FakeStorage, id: string, version: string): Promise<void> {
    const project = new FakeStorage('fake://proj')
    await project.WriteText('resources/app.svg', SVG)
    const { publishPresentation } = await import('../presentation-publisher.js')
    const res = await publishPresentation(project, backend, `${id}/${version}`, DOC)
    expect(res.ok).toBe(true)
}

// ── happy path ────────────────────────────────────────────────────────────────

test('load() returns a map containing mm:application DataTemplate for a baked meta-model', async () => {
    const backend = new FakeStorage('fake://meta-models')
    await bakePresentation(backend, 'ea', '1.0.0')
    const source = new MetaModelPresentationSource(envWith(backend))
    const map = await source.load()
    const tmpl = map.get('mm:application')
    expect(tmpl).toBeDefined()
    expect(typeof (tmpl as DataTemplate).Apply).toBe('function')
})

// ── missing presentation artifact ────────────────────────────────────────────

test('a published model dir with no presentation artifact contributes nothing (no throw)', async () => {
    // Seed the backend with a model directory but no compiled presentation file.
    const backend = new FakeStorage('fake://meta-models')
    // Create a directory by placing a different file (model.json) so scanPublishedModels lists it.
    await backend.WriteText('ea/1.0.0/model.json', JSON.stringify({ nodes: [], edges: [] }))
    const source = new MetaModelPresentationSource(envWith(backend))
    const map = await source.load()
    expect(map.size).toBe(0)
})

// ── empty backend ─────────────────────────────────────────────────────────────

test('empty backend yields an empty map', async () => {
    const backend = new FakeStorage('fake://meta-models')
    const source = new MetaModelPresentationSource(envWith(backend))
    const map = await source.load()
    expect(map.size).toBe(0)
})

// ── multiple models / versions ────────────────────────────────────────────────

test('multiple published versions each contribute their mm: keys', async () => {
    const backend = new FakeStorage('fake://meta-models')
    // Bake two versions of 'ea' — each with the same DOC (same key mm:application).
    await bakePresentation(backend, 'ea', '1.0.0')
    await bakePresentation(backend, 'ea', '2.0.0')
    const source = new MetaModelPresentationSource(envWith(backend))
    const map = await source.load()
    // Both versions produce mm:application — last one wins but map still has the key.
    expect(map.has('mm:application')).toBe(true)
})

// ── stable source id ──────────────────────────────────────────────────────────

test('MetaModelPresentationSource has id "meta-model"', () => {
    const backend = new FakeStorage('fake://meta-models')
    const source = new MetaModelPresentationSource(envWith(backend))
    expect(source.id).toBe('meta-model')
})

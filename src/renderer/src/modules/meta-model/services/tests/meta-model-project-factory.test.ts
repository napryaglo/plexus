import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { fromJSON } from '@pragmatic-lab/todl'

import { PROJECT_MANIFEST_FILENAME } from '../../../../services/projects/project-factory.js'
import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { MetaModelProjectFactory } from '../meta-model-project-factory.js'
import { META_MODELS_BACKEND_ID } from '../meta-models-backend.js'

function factory(): MetaModelProjectFactory
{
    return new MetaModelProjectFactory(new ServiceProvider())
}

// A provider whose meta-models backend resolves to an inspectable FakeStorage
// (pre-registered, so ensureMetaModelsBackend's Has-check finds it).
function publishEnv(): { provider: ServiceProvider; dest: FakeStorage }
{
    const provider = new ServiceProvider()
    const registry = new StorageProviderRegistry(provider)
    const dest = new FakeStorage('fake://meta-models')
    registry.Register(META_MODELS_BACKEND_ID, () => dest)
    provider.registerInstance(StorageProviderRegistry.Key, registry)
    return { provider, dest }
}

// Verified-clean TODL (see the empirical probe): concepts in one file, a
// meta-model referencing them in another — check() returns zero diagnostics.
const CONCEPTS = 'namespace d { concept model { label : string; } concept component { label : string; } concept location { label : string; } }'
const EA = 'namespace d { meta-model enterprise-architecture { name = "EA"; version = 5; root-concept = model; top-level-concepts = [ component, location ]; } }'
// A missing concept name is a syntax error.
const BAD = 'namespace d { concept { label : string; } }'

test('createProject writes a meta-model manifest with a publish identity', async () => {
    const storage = new FakeStorage('fake://Acme')
    const project = await factory().createProject(storage, 'Acme EA')

    expect(project.Type).toBe('meta-model')
    expect(project.Name).toBe('Acme EA')
    const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
    expect(manifest.type).toBe('meta-model')
    expect(manifest.id).toBe('acme-ea')          // slugified
    expect(manifest.modelVersion).toBe('0.1.0')
})

test('openProject tags .todl nodes openable and hides the manifest', async () => {
    const storage = new FakeStorage()
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'meta-model', name: 'P', id: 'p', modelVersion: '0.1.0' }))
    await storage.WriteText('defs/core.todl', CONCEPTS)
    await storage.WriteText('readme.md', 'hi')

    const project = await factory().openProject(storage)
    const names = project.Root.Children.ToArray().map((n) => n.Name)
    expect(names).toContain('defs')
    expect(names).not.toContain(PROJECT_MANIFEST_FILENAME)

    const defs = project.Root.Children.ToArray().find((n) => n.Name === 'defs')!
    expect(defs.Kind).toBe('folder')
    const core = defs.Children.ToArray()[0]
    expect(core.Kind).toBe('todl')
    expect(core.Path).toBe('defs/core.todl')
    const readme = project.Root.Children.ToArray().find((n) => n.Name === 'readme.md')!
    expect(readme.Kind).toBe('file')
})

test('publish writes compiled model + sources for a clean project', async () => {
    const storage = new FakeStorage('fake://Acme')
    const f = factory()
    await f.createProject(storage, 'Acme')
    await storage.WriteText('concepts.todl', CONCEPTS)
    await storage.WriteText('ea.todl', EA)

    const { provider, dest } = publishEnv()
    const project = await f.openProject(storage)
    const result = await f.publish(project, storage, provider)

    expect(result.ok).toBe(true)
    expect(await dest.Exists('acme/0.1.0/model.json')).toBe(true)
    const doc = JSON.parse(await dest.ReadText('acme/0.1.0/model.json'))
    expect(Array.isArray(doc.nodes)).toBe(true)
    expect(doc.nodes.length).toBeGreaterThan(0)
    expect(() => fromJSON(doc)).not.toThrow()          // compiled artifact round-trips
    expect(await dest.Exists('acme/0.1.0/src/concepts.todl')).toBe(true)
    expect(await dest.Exists('acme/0.1.0/src/ea.todl')).toBe(true)
})

test('publish is blocked and writes nothing when a source has an error', async () => {
    const storage = new FakeStorage('fake://Acme')
    const f = factory()
    await f.createProject(storage, 'Acme')
    await storage.WriteText('bad.todl', BAD)

    const { provider, dest } = publishEnv()
    const project = await f.openProject(storage)
    const result = await f.publish(project, storage, provider)

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/error/i)
    expect(dest.size).toBe(0)                           // nothing written
})

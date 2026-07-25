import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { fromJSON, check, toJSON } from '@pragmatic-lab/todl'

import { PROJECT_MANIFEST_FILENAME } from '../../../../services/projects/project-factory.js'
import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { META_MODELS_BACKEND_ID } from '../../../meta-model/services/meta-models-backend.js'
import { LIBRARIES_BACKEND_ID } from '../libraries-backend.js'
import { LibraryProjectFactory } from '../library-project-factory.js'

function factory(): LibraryProjectFactory { return new LibraryProjectFactory(new ServiceProvider()) }

// A meta-model with the concepts a library references, published to a fake
// meta-models backend; plus a fake libraries backend to receive the publish.
const META = 'namespace ea { concept location { label : string; } concept technology { label : string; } }'
function publishEnv(): { provider: ServiceProvider; meta: FakeStorage; libs: FakeStorage } {
  const provider = new ServiceProvider()
  const registry = new StorageProviderRegistry(provider)
  const meta = new FakeStorage('fake://meta-models')
  const libs = new FakeStorage('fake://libraries')
  registry.Register(META_MODELS_BACKEND_ID, () => meta)
  registry.Register(LIBRARIES_BACKEND_ID, () => libs)
  provider.registerInstance(StorageProviderRegistry.Key, registry)
  return { provider, meta, libs }
}
async function seedMeta(meta: FakeStorage): Promise<void> {
  await meta.WriteText('ea/5/model.json', JSON.stringify(toJSON(check([{ uri: 'm.todl', text: META }]).model)))
}

const LIB = `namespace lib { taxonomy microsoft : represents location, technology {
  location azure { label = "Azure"; }
  technology azure-openai { label = "Azure OpenAI"; }
} }`

test('createProject writes a library manifest with a publish identity + binding', async () => {
  const storage = new FakeStorage('fake://Acme')
  const project = await factory().createProject(storage, 'Acme Lib', { metaModel: { id: 'ea', version: '5' } })
  expect(project.Type).toBe('library')
  const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
  expect(manifest.type).toBe('library')
  expect(manifest.id).toBe('acme-lib')
  expect(manifest.libVersion).toBe('0.1.0')
  expect(manifest.metaModel).toEqual({ id: 'ea', version: '5' })
})

test('requiresMetaModel is true', () => {
  expect(factory().requiresMetaModel).toBe(true)
})

test('publish validates against the bound meta-model and writes the compiled library', async () => {
  const storage = new FakeStorage('fake://Acme')
  const f = factory()
  await f.createProject(storage, 'microsoft', { metaModel: { id: 'ea', version: '5' } })
  await storage.WriteText('microsoft.todl', LIB)
  const { provider, meta, libs } = publishEnv()
  await seedMeta(meta)
  const result = await f.publish(await f.openProject(storage), storage, provider)
  expect(result.ok).toBe(true)
  expect(await libs.Exists('microsoft/0.1.0/model.json')).toBe(true)
  const doc = JSON.parse(await libs.ReadText('microsoft/0.1.0/model.json'))
  expect(() => fromJSON(doc)).not.toThrow()
  expect(await libs.Exists('microsoft/0.1.0/src/microsoft.todl')).toBe(true)
})

test('publish is blocked when the bound meta-model is not published', async () => {
  const storage = new FakeStorage('fake://Acme')
  const f = factory()
  await f.createProject(storage, 'microsoft', { metaModel: { id: 'ghost', version: '1' } })
  await storage.WriteText('microsoft.todl', LIB)
  const { provider, libs } = publishEnv()
  const result = await f.publish(await f.openProject(storage), storage, provider)
  expect(result.ok).toBe(false)
  expect(libs.size).toBe(0)
})

test('publish writes library.json with the derived classes + resource paths, and copies the folders', async () => {
  const storage = new FakeStorage('fake://Acme')
  const f = factory()
  await f.createProject(storage, 'microsoft', { metaModel: { id: 'ea', version: '5' } })
  await storage.WriteText('microsoft.todl', LIB)
  await storage.WriteText('visuals/microsoft.azure.mural', '<template/>')
  await storage.WriteText('thumbnails/microsoft.azure.png', 'PNGBYTES')
  await storage.WriteText('docs/microsoft.azure.md', '# Azure')
  await storage.WriteText('assets/logo.svg', '<svg/>')
  await storage.WriteText('samples/demo.todl', 'sample instance')

  const { provider, meta, libs } = publishEnv()
  await seedMeta(meta)
  const result = await f.publish(await f.openProject(storage), storage, provider)

  expect(result.ok).toBe(true)

  const bundle = JSON.parse(await libs.ReadText('microsoft/0.1.0/library.json'))
  expect(bundle.id).toBe('microsoft')
  expect(bundle.version).toBe('0.1.0')
  expect(bundle.metaModel).toEqual({ id: 'ea', version: '5' })
  expect(bundle.classes.map((c: { id: string }) => c.id).sort())
      .toEqual(['microsoft.azure', 'microsoft.azure-openai'])
  const azure = bundle.classes.find((c: { id: string }) => c.id === 'microsoft.azure')
  expect(azure).toMatchObject({
      localId: 'azure', label: 'Azure', concept: 'location',
      template: 'visuals/microsoft.azure.mural',
      thumbnail: 'thumbnails/microsoft.azure.png',
      doc: 'docs/microsoft.azure.md',
  })
  expect(bundle.assets).toEqual(['assets/logo.svg'])
  expect(bundle.samples).toEqual(['samples/demo.todl'])

  // Resource folders copied into the bundle.
  expect(await libs.Exists('microsoft/0.1.0/visuals/microsoft.azure.mural')).toBe(true)
  expect(await libs.Exists('microsoft/0.1.0/assets/logo.svg')).toBe(true)
  expect(await libs.Exists('microsoft/0.1.0/samples/demo.todl')).toBe(true)
})

test('samples/*.todl is excluded from the compiled model', async () => {
  const storage = new FakeStorage('fake://Acme')
  const f = factory()
  await f.createProject(storage, 'microsoft', { metaModel: { id: 'ea', version: '5' } })
  await storage.WriteText('microsoft.todl', LIB)
  await storage.WriteText('samples/demo.todl', 'namespace boom { this is not valid todl }')

  const { provider, meta, libs } = publishEnv()
  await seedMeta(meta)
  const result = await f.publish(await f.openProject(storage), storage, provider)

  // Would fail to compile if samples/ were included; it is excluded, so publish succeeds.
  expect(result.ok).toBe(true)
  // The invalid sample is still copied verbatim into the bundle (as a resource).
  expect(await libs.Exists('microsoft/0.1.0/samples/demo.todl')).toBe(true)
})

test('an orphan visual is a non-blocking warning', async () => {
  const storage = new FakeStorage('fake://Acme')
  const f = factory()
  await f.createProject(storage, 'microsoft', { metaModel: { id: 'ea', version: '5' } })
  await storage.WriteText('microsoft.todl', LIB)
  await storage.WriteText('visuals/ghost.mural', '<template/>')

  const { provider, meta } = publishEnv()
  await seedMeta(meta)
  const result = await f.publish(await f.openProject(storage), storage, provider)

  expect(result.ok).toBe(true)
  expect(result.message).toContain('warning')
})

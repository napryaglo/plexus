import { describe, it, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { ToolboxRepository, ToolboxVisualDescriptor } from '@pragmatic-lab/mural/framework'
import { ToolboxService } from '../diagram-panel-services.js'
import { TodlVisualResolverKey } from '../todl-visual-resolver.js'
import { ArchInstanceDropFactoryKey } from '../../../architecture-projects/services/arch-instance-drop-factory.js'
import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { META_MODELS_BACKEND_ID } from '../../../meta-model/services/meta-models-backend.js'
import { LIBRARIES_BACKEND_ID } from '../../../library/services/libraries-backend.js'

const MODEL = JSON.stringify({
  nodes: [
    { id: 'actors', tier: 'Ontology', typeOf: 'taxonomy', attrs: { label: 'Actors' } },
    { id: 'actors@toolbox', tier: 'Ontology', typeOf: 'toolbox', attrs: { visible: true } },
    { id: 'actors.internal', tier: 'Instance', typeOf: 'actor', attrs: { class: true, label: 'Internal' }, instanceOf: 'actor' },
  ],
  edges: [
    { kind: 'Annotated', via: null, from: 'actors', to: 'actors@toolbox' },
    { kind: 'Contains', via: null, from: 'actors', to: 'actors.internal' },
  ],
})

function provider(seed: (mm: FakeStorage, lib: FakeStorage) => void): ServiceProvider {
  const p = new ServiceProvider()
  const reg = new StorageProviderRegistry(p)
  const mm = new FakeStorage('fake://meta-models'); const lib = new FakeStorage('fake://libraries')
  reg.Register(META_MODELS_BACKEND_ID, () => mm)
  reg.Register(LIBRARIES_BACKEND_ID, () => lib)
  p.registerInstance(StorageProviderRegistry.Key, reg)
  seed(mm, lib)
  return p
}

function pageIds(svc: ToolboxService): string[] {
  return svc.Pages.ToArray().map((p) => p.Id)
}

describe('ToolboxService', () => {
  it('keeps mural Shapes and adds a repo page per visible taxonomy (meta-model → concept resolver)', async () => {
    const svc = new ToolboxService(provider((mm) => { void mm.WriteText('tech/0.1.0/model.json', MODEL) }))
    await svc.reload()
    expect(svc.Repository).toBeInstanceOf(ToolboxRepository)
    expect(svc.Pages).toBe(svc.Repository.Pages)
    expect(pageIds(svc)).toContain('shapes')
    const actors = svc.Pages.ToArray().find((p) => p.Id === 'actors')!
    expect(actors.Title).toBe('Actors')
    expect(actors.Items.Count).toBe(1)
    const item = actors.Items.ToArray()[0]
    expect(item.Id).toBe('term:actors.internal')
    expect((item.Descriptor as ToolboxVisualDescriptor).ResolverKey).toBe(TodlVisualResolverKey)
    expect(item.FactoryKey).toBe(ArchInstanceDropFactoryKey)
  })

  it('dedupes a taxonomy that a meta-model and a library both carry', async () => {
    const svc = new ToolboxService(provider((mm, lib) => {
      void mm.WriteText('tech/0.1.0/model.json', MODEL)
      void lib.WriteText('ms/0.1.0/model.json', MODEL)
    }))
    await svc.reload()
    expect(svc.Pages.ToArray().filter((p) => p.Id === 'actors').length).toBe(1)
    expect(svc.Pages.ToArray().find((p) => p.Id === 'actors')!.Items.Count).toBe(1)
  })

  it('empty backends → the mural default pages (Shapes + annotate)', async () => {
    const svc = new ToolboxService(provider(() => {}))
    await svc.reload()
    expect(pageIds(svc)).toEqual(['shapes', 'annotate'])
  })
})

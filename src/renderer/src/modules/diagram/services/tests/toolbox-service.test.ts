import { describe, it, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { ToolboxService } from '../diagram-panel-services.js'
import { ToolboxPageKind, type ToolboxPage } from '../toolbox-page.js'
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

function pages(svc: ToolboxService): ToolboxPage[] {
  return [...Array(svc.Pages.Count)].map((_, i) => svc.Pages.Get(i)!)
}

describe('ToolboxService', () => {
  it('always has a Shapes page and adds a page per visible taxonomy', async () => {
    const svc = new ToolboxService(provider((mm) => { void mm.WriteText('tech/0.1.0/model.json', MODEL) }))
    await svc.reload()
    expect(svc.Pages.Get(0)!.Kind).toBe(ToolboxPageKind.Shapes)
    const actors = pages(svc).find((p) => p.Title === 'Actors')
    expect(actors).toBeDefined()
    expect(actors!.Kind).toBe(ToolboxPageKind.Taxonomy)
    expect(actors!.Items.Count).toBe(1)
  })

  it('dedupes a taxonomy that a meta-model and a library both carry', async () => {
    const svc = new ToolboxService(provider((mm, lib) => {
      void mm.WriteText('tech/0.1.0/model.json', MODEL)
      void lib.WriteText('ms/0.1.0/model.json', MODEL)
    }))
    await svc.reload()
    expect(pages(svc).filter((p) => p.Title === 'Actors').length).toBe(1)
  })

  it('empty backends → only the Shapes page', async () => {
    const svc = new ToolboxService(provider(() => {}))
    await svc.reload()
    expect(svc.Pages.Count).toBe(1)
    expect(svc.Pages.Get(0)!.Kind).toBe(ToolboxPageKind.Shapes)
  })
})

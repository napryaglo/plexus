import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'

import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { LIBRARIES_BACKEND_ID } from '../../../library/services/libraries-backend.js'
import { LibraryRegistry } from '../../../library/services/library-registry.js'
import { ArchTermsPaletteService } from '../arch-terms-palette-service.js'

// Synchronous seed (see the registry test) so all files exist before Reload lists.
function providerWith(seed: (b: FakeStorage) => void): ServiceProvider {
    const provider = new ServiceProvider()
    const registry = new StorageProviderRegistry(provider)
    const backend = new FakeStorage('fake://libraries')
    registry.Register(LIBRARIES_BACKEND_ID, () => backend)
    provider.registerInstance(StorageProviderRegistry.Key, registry)
    provider.registerInstance(LibraryRegistry.Key, new LibraryRegistry(provider))
    seed(backend)
    return provider
}

test('flattens published library terms into draggable tiles carrying the full dotted TermId', async () => {
    const provider = providerWith((b) => {
        void b.WriteText('microsoft/0.1.0/library.json', JSON.stringify({
            id: 'microsoft', version: '0.1.0', name: 'Microsoft', metaModel: { id: 'ea', version: '5' },
            classes: [{ id: 'stack.azure-openai', localId: 'azure-openai', label: 'Azure OpenAI', concept: 'technology', template: 'visuals/stack.azure-openai.mural' }],
            assets: [], docs: [], samples: [],
        }))
        void b.WriteText('microsoft/0.1.0/visuals/stack.azure-openai.mural', 'TextBlock [ Text = $Display ]')
    })
    const svc = new ArchTermsPaletteService(provider)
    await svc.Reload()

    expect(svc.IsEmpty).toBe(false)
    expect(svc.Terms.Count).toBe(1)
    const tile = svc.Terms.Get(0)!
    expect(tile.TermId).toBe('stack.azure-openai')
    expect(tile.Display).toBe('Azure OpenAI')
    expect(tile.Concept).toBe('technology')
    expect(typeof tile.Template.Apply).toBe('function')
})

test('IsEmpty is true when nothing is published', async () => {
    const svc = new ArchTermsPaletteService(providerWith(() => {}))
    await svc.Reload()
    expect(svc.IsEmpty).toBe(true)
    expect(svc.Terms.Count).toBe(0)
})

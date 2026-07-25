import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'

import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { LIBRARIES_BACKEND_ID } from '../libraries-backend.js'
import { LibraryRegistry } from '../library-registry.js'
import { LibrariesPanelService } from '../libraries-panel-service.js'

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

test('builds a LibraryRow per library with a ClassRow (template resolved) per class', async () => {
    const provider = providerWith((b) => {
        void b.WriteText('microsoft/0.1.0/library.json', JSON.stringify({
            id: 'microsoft', version: '0.1.0', name: 'Microsoft', metaModel: { id: 'ea', version: '5' },
            classes: [{ id: 'microsoft.azure', localId: 'azure', label: 'Azure', concept: 'location', template: 'visuals/microsoft.azure.mural' }],
            assets: [], docs: [], samples: [],
        }))
        void b.WriteText('microsoft/0.1.0/visuals/microsoft.azure.mural', 'TextBlock [ Text = $Display ]')
    })
    const svc = new LibrariesPanelService(provider)
    await svc.Reload()

    expect(svc.IsEmpty).toBe(false)
    expect(svc.Libraries.Count).toBe(1)
    const lib = svc.Libraries.Get(0)!
    expect(lib.Name).toContain('Microsoft')
    expect(lib.Classes.Count).toBe(1)
    const row = lib.Classes.Get(0)!
    expect(row.Data.Display).toBe('Azure')
    expect(typeof row.Template.Apply).toBe('function')
})

test('IsEmpty is true when nothing is published', async () => {
    const svc = new LibrariesPanelService(providerWith(() => {}))
    await svc.Reload()
    expect(svc.IsEmpty).toBe(true)
    expect(svc.Libraries.Count).toBe(0)
})

import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'

import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { DiagnosticsService } from '../../../../services/diagnostics/diagnostics-service.js'
import { DiagnosticSeverity } from '../../../../services/diagnostics/diagnostic.js'
import { LIBRARIES_BACKEND_ID } from '../libraries-backend.js'
import { LibraryRegistry } from '../library-registry.js'

// Seed is SYNCHRONOUS: FakeStorage.WriteText sets its map synchronously, so every
// file is present before refresh() lists the backend (an async seed with awaits
// would race the first List). Matches the meta-models-service test pattern.
function env(seed: (b: FakeStorage) => void): { provider: ServiceProvider; diagnostics: DiagnosticsService } {
    const provider = new ServiceProvider()
    const registry = new StorageProviderRegistry(provider)
    const backend = new FakeStorage('fake://libraries')
    registry.Register(LIBRARIES_BACKEND_ID, () => backend)
    provider.registerInstance(StorageProviderRegistry.Key, registry)
    const diagnostics = new DiagnosticsService(provider)
    provider.registerInstance(DiagnosticsService.Key, diagnostics)
    seed(backend)
    return { provider, diagnostics }
}

function manifest(id: string, template = `visuals/${id}.azure.mural`): string {
    return JSON.stringify({
        id, version: '0.1.0', name: id, metaModel: { id: 'ea', version: '5' },
        classes: [{ id: `${id}.azure`, localId: 'azure', label: 'Azure', concept: 'location', template }],
        assets: [], docs: [], samples: [],
    })
}

test('mounts a class template so resolve returns it, and the default otherwise', async () => {
    const { provider } = env((b) => {
        void b.WriteText('microsoft/0.1.0/library.json', manifest('microsoft'))
        void b.WriteText('microsoft/0.1.0/visuals/microsoft.azure.mural', 'TextBlock [ Text = $Display ]')
    })
    const reg = new LibraryRegistry(provider)
    await reg.refresh()

    const mounted = reg.resolve('microsoft.azure', 'location')
    const fallback = reg.resolve('nobody.here', 'location')
    expect(mounted).not.toBe(fallback)          // class template, not the default
    expect(fallback).toBe(reg.resolve('also.missing', 'x'))   // the single shared default
})

test('a class template that fails to compile falls back to default and reports an error to the Problems store', async () => {
    const { provider, diagnostics } = env((b) => {
        void b.WriteText('microsoft/0.1.0/library.json', manifest('microsoft'))
        void b.WriteText('microsoft/0.1.0/visuals/microsoft.azure.mural', 'not valid mural [[[')
    })
    const reg = new LibraryRegistry(provider)
    await reg.refresh()

    expect(reg.resolve('microsoft.azure', 'location')).toBe(reg.resolve('x.y', 'z'))   // fell back to default
    const errs = [...diagnostics.All].filter((d) => d.owner === 'libraries' && d.severity === DiagnosticSeverity.Error)
    expect(errs.some((d) => d.uri === 'visuals/microsoft.azure.mural')).toBe(true)
    expect(errs[0].projectId).toBe('library:microsoft@0.1.0')
})

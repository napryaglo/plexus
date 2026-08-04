import { test, expect } from 'vitest'
import { Application, ServiceProvider } from '@pragmatic-lab/mural/runtime'

import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { DiagnosticsService } from '../../../../services/diagnostics/diagnostics-service.js'
import { DiagnosticSeverity } from '../../../../services/diagnostics/diagnostic.js'
import { LIBRARIES_BACKEND_ID } from '../libraries-backend.js'
import { LibraryRegistry } from '../library-registry.js'

// Seed is SYNCHRONOUS: FakeStorage.WriteText sets its map synchronously, so every
// file is present before discover() lists the backend (an async seed with awaits
// would race the first List). Matches the meta-models-service test pattern.
// Wire a provider around a pre-populated backend (used when a test bakes a
// presentation artifact into the backend before constructing the registry).
function envWith(backend: FakeStorage): { provider: ServiceProvider; diagnostics: DiagnosticsService } {
    const provider = new ServiceProvider()
    const registry = new StorageProviderRegistry(provider)
    registry.Register(LIBRARIES_BACKEND_ID, () => backend)
    provider.registerInstance(StorageProviderRegistry.Key, registry)
    const diagnostics = new DiagnosticsService(provider)
    provider.registerInstance(DiagnosticsService.Key, diagnostics)
    return { provider, diagnostics }
}

function env(seed: (b: FakeStorage) => void): { provider: ServiceProvider; diagnostics: DiagnosticsService } {
    const backend = new FakeStorage('fake://libraries')
    seed(backend)
    return envWith(backend)
}

function manifest(id: string, template = `visuals/${id}.azure.mural`): string {
    return JSON.stringify({
        id, version: '0.1.0', name: id, metaModel: { id: 'ea', version: '5' },
        classes: [{ id: `${id}.azure`, localId: 'azure', label: 'Azure', concept: 'location', template }],
        assets: [], docs: [], samples: [],
    })
}

// Resolve `classId`, then wait until the registry finishes compiling it (a Changed
// tick), so the second resolve sees the compiled template. Returns nothing.
function whenCompiled(reg: LibraryRegistry, classId: string): Promise<void> {
    return new Promise((res) => {
        const off = reg.onChanged((id) => { if (id === classId) { off(); res() } })
        reg.resolve(classId, 'location')   // triggers the lazy compile
    })
}

test('discover compiles nothing; resolve returns the default until a class is compiled', async () => {
    const { provider } = env((b) => {
        void b.WriteText('microsoft/0.1.0/library.json', manifest('microsoft'))
        void b.WriteText('microsoft/0.1.0/visuals/microsoft.azure.mural', 'TextBlock [ Text = $Display ]')
    })
    const reg = new LibraryRegistry(provider)
    const libs = await reg.discover()
    expect(libs.map((l) => l.id)).toEqual(['microsoft'])

    // No eager compile: right after discover, the class resolves to the default.
    const def = reg.resolve('nobody.here', 'x')
    expect(reg.resolve('microsoft.azure', 'location')).toBe(def)

    // After the lazy compile settles, it resolves to its own (non-default) template.
    await whenCompiled(reg, 'microsoft.azure')
    expect(reg.resolve('microsoft.azure', 'location')).not.toBe(def)
})

test('concurrent resolves of the same class compile it only once', async () => {
    const { provider } = env((b) => {
        void b.WriteText('microsoft/0.1.0/library.json', manifest('microsoft'))
        void b.WriteText('microsoft/0.1.0/visuals/microsoft.azure.mural', 'TextBlock [ Text = $Display ]')
    })
    const reg = new LibraryRegistry(provider)
    await reg.discover()

    let fires = 0
    reg.onChanged((id) => { if (id === 'microsoft.azure') fires++ })
    reg.resolve('microsoft.azure', 'location')
    reg.resolve('microsoft.azure', 'location')
    reg.resolve('microsoft.azure', 'location')
    await new Promise((r) => setTimeout(r, 20))
    expect(fires).toBe(1)
})

test('delete removes the library from the backend and clears its Problems slice', async () => {
    const { provider, diagnostics } = env((b) => {
        void b.WriteText('microsoft/0.1.0/library.json', manifest('microsoft', 'visuals/missing.mural'))   // referenced template missing → discovery warning
    })
    const reg = new LibraryRegistry(provider)
    await reg.discover()
    expect([...diagnostics.All].some((d) => d.projectId === 'library:microsoft@0.1.0')).toBe(true)

    await reg.delete('microsoft', '0.1.0')

    expect(await reg.discover()).toEqual([])   // gone from the backend
    expect([...diagnostics.All].some((d) => d.projectId === 'library:microsoft@0.1.0')).toBe(false)
})

const SVG = '<svg viewBox="0 0 10 10"><path d="M0 0 L10 0 L10 10 Z"/></svg>'

function iconManifest(icon: string, template?: string): string {
    const cls: Record<string, unknown> = { id: 'microsoft.azure', localId: 'azure', label: 'Azure', concept: 'location', icon }
    if (template !== undefined) cls.template = template
    return JSON.stringify({ id: 'microsoft', version: '0.1.0', name: 'microsoft', metaModel: { id: 'ea', version: '5' }, classes: [cls], assets: [], docs: [], samples: [] })
}

test('a class with an icon annotation and no template mounts an icon template (non-default) lazily', async () => {
    const { provider } = env((b) => {
        void b.WriteText('microsoft/0.1.0/library.json', iconManifest('resources/azure.svg'))
        void b.WriteText('microsoft/0.1.0/resources/azure.svg', SVG)
    })
    const reg = new LibraryRegistry(provider)
    await reg.discover()
    await whenCompiled(reg, 'microsoft.azure')
    expect(reg.resolve('microsoft.azure', 'location')).not.toBe(reg.resolve('missing', 'x'))
})

test('an authored template wins over an icon annotation', async () => {
    const { provider, diagnostics } = env((b) => {
        void b.WriteText('microsoft/0.1.0/library.json', iconManifest('resources/broken.svg', 'visuals/microsoft.azure.mural'))
        void b.WriteText('microsoft/0.1.0/visuals/microsoft.azure.mural', 'TextBlock [ Text = $Display ]')
        void b.WriteText('microsoft/0.1.0/resources/broken.svg', 'not an svg')
    })
    const reg = new LibraryRegistry(provider)
    await reg.discover()
    await whenCompiled(reg, 'microsoft.azure')
    // authored path taken → non-default, and the broken icon was never parsed (no warning about it)
    expect(reg.resolve('microsoft.azure', 'location')).not.toBe(reg.resolve('missing', 'x'))
    expect([...diagnostics.All].some((d) => d.uri === 'resources/broken.svg')).toBe(false)
})

test('a class template that fails to compile falls back to default and reports an error to the Problems store', async () => {
    const { provider, diagnostics } = env((b) => {
        void b.WriteText('microsoft/0.1.0/library.json', manifest('microsoft'))
        void b.WriteText('microsoft/0.1.0/visuals/microsoft.azure.mural', 'not valid mural [[[')
    })
    const reg = new LibraryRegistry(provider)
    await reg.discover()
    await whenCompiled(reg, 'microsoft.azure')

    expect(reg.resolve('microsoft.azure', 'location')).toBe(reg.resolve('x.y', 'z'))   // fell back to default
    const errs = [...diagnostics.All].filter((d) => d.owner === 'libraries' && d.severity === DiagnosticSeverity.Error)
    expect(errs.some((d) => d.uri === 'visuals/microsoft.azure.mural')).toBe(true)
    expect(errs[0].projectId).toBe('library:microsoft@0.1.0')
})

// ── baked presentation tier ─────────────────────────────────────────────────
// Bake a presentation artifact into `backend` for a single iconful class.
async function bakePresentation(backend: any): Promise<void> {
    const proj = new (backend.constructor)('fake://proj')
    void proj.WriteText('resources/azure.svg', SVG)
    const doc = { nodes: [{ id: 'microsoft.azure', tier: 'Instance', typeOf: 'location',
        attrs: { class: true, id: 'azure', label: 'Azure', icon: 'resources/azure.svg' } }], edges: [] } as any
    const { publishLibraryPresentation } = await import('../library-presentation-publisher.js')
    await publishLibraryPresentation(proj, backend, 'microsoft/0.1.0', doc)
}

test('a class with a baked presentation resolves to its presentation template (non-default) right after discover', async () => {
    const backend = new FakeStorage('fake://libraries')
    await bakePresentation(backend)
    void backend.WriteText('microsoft/0.1.0/library.json', iconManifest('resources/azure.svg'))   // no authored template
    const { provider } = envWith(backend)
    const reg = new LibraryRegistry(provider)
    await reg.discover()
    // presentation tier resolves immediately — not the shared default
    expect(reg.resolve('microsoft.azure', 'location')).not.toBe(reg.resolve('nobody.here', 'x'))
})

// Bake a presentation with N iconful classes so discover() populates N template
// entries. Used to prove the population is O(1) notifications, not O(N).
async function bakePresentationN(backend: any, n: number): Promise<void> {
    const proj = new (backend.constructor)('fake://proj')
    void proj.WriteText('resources/azure.svg', SVG)
    const nodes = Array.from({ length: n }, (_, i) => ({
        id: `microsoft.c${i}`, tier: 'Instance', typeOf: 'location',
        attrs: { class: true, id: `c${i}`, label: `C${i}`, icon: 'resources/azure.svg' },
    }))
    const { publishLibraryPresentation } = await import('../library-presentation-publisher.js')
    await publishLibraryPresentation(proj, backend, 'microsoft/0.1.0', { nodes, edges: [] } as any)
}

// Regression guard for the style-invalidation storm: populating a large baked
// presentation into Application.Resources must fire a CONSTANT number of
// notifications (the merged-dictionary swap), not one per class. The old code
// merged the presentation dict up front then Set() each entry into it live,
// firing a global notification — and every element's style re-resolution — per
// class (~4-5s per open for the real 470-class library). discover() now builds
// the dict detached and swaps it in via ReplaceMergedDictionary.
test('populating a large baked presentation fires O(1) app-resource notifications, not one per class', async () => {
    const prior = Application.current
    try {
        const app = new Application()
        Application.current = app
        const N = 12
        const backend = new FakeStorage('fake://libraries')
        await bakePresentationN(backend, N)
        const classes = Array.from({ length: N }, (_, i) => ({ id: `microsoft.c${i}`, localId: `c${i}`, label: `C${i}`, concept: 'location', icon: 'resources/azure.svg' }))
        void backend.WriteText('microsoft/0.1.0/library.json', JSON.stringify({ id: 'microsoft', version: '0.1.0', name: 'microsoft', metaModel: { id: 'ea', version: '5' }, classes, assets: [], docs: [], samples: [] }))
        const { provider } = envWith(backend)
        const reg = new LibraryRegistry(provider)

        let general = 0, style = 0
        app.Resources.Subscribe(() => { general++ })
        app.Resources.SubscribeStyle(() => { style++ })

        await reg.discover()                         // merges libraryVisuals + swaps presentation in
        expect(general).toBeLessThan(N)              // NOT one notification per class
        const afterFirst = general, afterFirstStyle = style

        await reg.discover()                         // re-populate: only the presentation swap
        expect(general - afterFirst).toBe(1)         // exactly one notification for the whole re-populate
        expect(style - afterFirstStyle).toBe(1)      // one structural style signal, independent of N
    } finally {
        Application.current = prior
    }
})

test('an authored template still overrides the baked presentation template', async () => {
    const backend = new FakeStorage('fake://libraries')
    await bakePresentation(backend)
    void backend.WriteText('microsoft/0.1.0/library.json', iconManifest('resources/azure.svg', 'visuals/microsoft.azure.mural'))
    void backend.WriteText('microsoft/0.1.0/visuals/microsoft.azure.mural', 'TextBlock [ Text = $Display ]')
    const { provider } = envWith(backend)
    const reg = new LibraryRegistry(provider)
    await reg.discover()
    const presTemplate = reg.resolve('microsoft.azure', 'location')   // presentation tier (authored not yet compiled)
    await whenCompiled(reg, 'microsoft.azure')
    // once the authored .mural compiles it wins — a different template than the presentation one
    expect(reg.resolve('microsoft.azure', 'location')).not.toBe(presTemplate)
})

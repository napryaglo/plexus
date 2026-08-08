import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import type { DataTemplate } from '@pragmatic-lab/mural/basic'

import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { DiagnosticsService } from '../../../../services/diagnostics/diagnostics-service.js'
import { DiagnosticSeverity } from '../../../../services/diagnostics/diagnostic.js'
import { LIBRARIES_BACKEND_ID } from '../libraries-backend.js'
import { discoverLibraries } from '../library-loader.js'
import { LibraryPresentationSource } from '../library-presentation-source.js'
import { ensureLibrariesBackend } from '../libraries-backend.js'

// Wire a provider around a pre-populated backend. Same pattern as library-registry.test.ts.
function envWith(backend: FakeStorage): { provider: ServiceProvider; diagnostics: DiagnosticsService } {
    const provider = new ServiceProvider()
    const storageRegistry = new StorageProviderRegistry(provider)
    storageRegistry.Register(LIBRARIES_BACKEND_ID, () => backend)
    provider.registerInstance(StorageProviderRegistry.Key, storageRegistry)
    const diagnostics = new DiagnosticsService(provider)
    provider.registerInstance(DiagnosticsService.Key, diagnostics)
    return { provider, diagnostics }
}

function env(seed: (b: FakeStorage) => void): { provider: ServiceProvider; diagnostics: DiagnosticsService; backend: FakeStorage } {
    const backend = new FakeStorage('fake://libraries')
    seed(backend)
    const { provider, diagnostics } = envWith(backend)
    return { provider, diagnostics, backend }
}

function manifest(id: string, template = `visuals/${id}.azure.mural`): string {
    return JSON.stringify({
        id, version: '0.1.0', name: id, metaModel: { id: 'ea', version: '5' },
        classes: [{ id: `${id}.azure`, localId: 'azure', label: 'Azure', concept: 'location', template }],
        assets: [], docs: [], samples: [],
    })
}

const SVG = '<svg viewBox="0 0 10 10"><path d="M0 0 L10 0 L10 10 Z"/></svg>'

function iconManifest(icon: string, template?: string): string {
    const cls: Record<string, unknown> = { id: 'microsoft.azure', localId: 'azure', label: 'Azure', concept: 'location', icon }
    if (template !== undefined) cls.template = template
    return JSON.stringify({ id: 'microsoft', version: '0.1.0', name: 'microsoft', metaModel: { id: 'ea', version: '5' }, classes: [cls], assets: [], docs: [], samples: [] })
}

// Bake a presentation artifact into the backend for one iconful class.
async function bakePresentation(backend: FakeStorage): Promise<void> {
    const proj = new FakeStorage('fake://proj')
    void proj.WriteText('resources/azure.svg', SVG)
    const doc = { nodes: [{ id: 'microsoft.azure', tier: 'Instance', typeOf: 'location',
        attrs: { class: true, id: 'azure', label: 'Azure', icon: 'resources/azure.svg' } }], edges: [] } as any
    const { publishLibraryPresentation } = await import('../library-presentation-publisher.js')
    await publishLibraryPresentation(proj, backend, 'microsoft/0.1.0', doc)
}

// Build a source that discovers libraries from the given backend.
function makeSource(provider: ServiceProvider): LibraryPresentationSource {
    const backend = ensureLibrariesBackend(provider)
    return new LibraryPresentationSource(provider, async () => discoverLibraries(backend))
}

// ── authored template ────────────────────────────────────────────────────────

test('class with authored .mural → map has its compiled DataTemplate', async () => {
    const { provider } = env((b) => {
        void b.WriteText('microsoft/0.1.0/library.json', manifest('microsoft'))
        void b.WriteText('microsoft/0.1.0/visuals/microsoft.azure.mural', 'TextBlock [ Text = $Display ]')
    })
    const source = makeSource(provider)
    const map = await source.load()
    const tmpl = map.get('microsoft.azure')
    expect(tmpl).toBeDefined()
    // It's a DataTemplate — has an Apply method (the mural DataTemplate contract).
    expect(typeof (tmpl as DataTemplate).Apply).toBe('function')
})

// ── presentation-only class ──────────────────────────────────────────────────

test('class with only baked presentation → map has the presentation template', async () => {
    const backend = new FakeStorage('fake://libraries')
    await bakePresentation(backend)
    void backend.WriteText('microsoft/0.1.0/library.json', iconManifest('resources/azure.svg'))   // no authored template
    const { provider } = envWith(backend)
    const source = makeSource(provider)
    const map = await source.load()
    const tmpl = map.get('microsoft.azure')
    expect(tmpl).toBeDefined()
    expect(typeof (tmpl as DataTemplate).Apply).toBe('function')
})

// ── authored overrides presentation ─────────────────────────────────────────

test('authored overrides presentation: two backends produce different templates for same class', async () => {
    // Backend A: authored .mural present.
    const backendA = new FakeStorage('fake://libraries')
    await bakePresentation(backendA)
    void backendA.WriteText('microsoft/0.1.0/library.json', iconManifest('resources/azure.svg', 'visuals/microsoft.azure.mural'))
    void backendA.WriteText('microsoft/0.1.0/visuals/microsoft.azure.mural', 'TextBlock [ Text = $Display ]')
    const sourceA = new LibraryPresentationSource(
        envWith(backendA).provider,
        async () => discoverLibraries(backendA),
    )
    const mapA = await sourceA.load()
    const authored = mapA.get('microsoft.azure')

    // Backend B: no authored .mural — presentation tier only.
    const backendB = new FakeStorage('fake://libraries')
    await bakePresentation(backendB)
    void backendB.WriteText('microsoft/0.1.0/library.json', iconManifest('resources/azure.svg'))
    const sourceB = new LibraryPresentationSource(
        envWith(backendB).provider,
        async () => discoverLibraries(backendB),
    )
    const mapB = await sourceB.load()
    const presentation = mapB.get('microsoft.azure')

    // Both must exist and be distinct (authored wins → a different template).
    expect(authored).toBeDefined()
    expect(presentation).toBeDefined()
    expect(authored).not.toBe(presentation)
})

// ── class absent from both authored and presentation ────────────────────────

test('class with neither authored template nor presentation → absent from map', async () => {
    // Library with a class that has no template and no presentation artifact.
    const { provider } = env((b) => {
        // manifest cites a template that doesn't exist on disk — loadLibrary records a
        // warning but loadTemplateSource returns undefined (path absent → not on cls).
        // Easier: use a manifest with no template field.
        void b.WriteText('microsoft/0.1.0/library.json', JSON.stringify({
            id: 'microsoft', version: '0.1.0', name: 'microsoft', metaModel: { id: 'ea', version: '5' },
            classes: [{ id: 'microsoft.azure', localId: 'azure', label: 'Azure', concept: 'location' }],
            assets: [], docs: [], samples: [],
        }))
    })
    const source = makeSource(provider)
    const map = await source.load()
    expect(map.has('microsoft.azure')).toBe(false)
})

// ── authored compile failure ─────────────────────────────────────────────────

test('authored compile failure → key omitted from map + error Problem published', async () => {
    const { provider, diagnostics } = env((b) => {
        void b.WriteText('microsoft/0.1.0/library.json', manifest('microsoft'))
        void b.WriteText('microsoft/0.1.0/visuals/microsoft.azure.mural', 'not valid mural [[[')
    })
    const source = makeSource(provider)
    const map = await source.load()

    // Key must be absent from the map (compile failed → no entry).
    expect(map.has('microsoft.azure')).toBe(false)

    // An error Problem must be published with the template path as uri.
    const errs = [...diagnostics.All].filter(
        (d) => d.severity === DiagnosticSeverity.Error && d.owner === 'libraries',
    )
    expect(errs.length).toBeGreaterThan(0)
    expect(errs.some((d) => d.uri === 'visuals/microsoft.azure.mural')).toBe(true)
    expect(errs[0].projectId).toBe('library:microsoft@0.1.0')
})

// ── legacy icon ──────────────────────────────────────────────────────────────

test('class with icon and no presentation → icon template in map (non-default)', async () => {
    const { provider } = env((b) => {
        void b.WriteText('microsoft/0.1.0/library.json', iconManifest('resources/azure.svg'))
        void b.WriteText('microsoft/0.1.0/resources/azure.svg', SVG)
    })
    const source = makeSource(provider)
    const map = await source.load()
    const tmpl = map.get('microsoft.azure')
    expect(tmpl).toBeDefined()
})

test('broken icon NOT parsed when authored template exists (no warning about the icon)', async () => {
    const { provider, diagnostics } = env((b) => {
        void b.WriteText('microsoft/0.1.0/library.json', iconManifest('resources/broken.svg', 'visuals/microsoft.azure.mural'))
        void b.WriteText('microsoft/0.1.0/visuals/microsoft.azure.mural', 'TextBlock [ Text = $Display ]')
        void b.WriteText('microsoft/0.1.0/resources/broken.svg', 'not an svg')
    })
    const source = makeSource(provider)
    const map = await source.load()

    // Authored template → non-empty map entry.
    expect(map.has('microsoft.azure')).toBe(true)
    // The broken icon must never have been parsed — no warning about it.
    expect([...diagnostics.All].some((d) => d.uri === 'resources/broken.svg')).toBe(false)
})

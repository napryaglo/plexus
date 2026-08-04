import { test, expect } from 'vitest'

import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { discoverLibraries, loadLibrary, readIconSource } from '../library-loader.js'

function manifest(id: string): string {
    return JSON.stringify({
        id, version: '0.1.0', name: id, metaModel: { id: 'ea', version: '5' },
        classes: [{ id: `${id}.azure`, localId: 'azure', label: 'Azure', concept: 'location', template: `visuals/${id}.azure.mural` }],
        assets: [], docs: [], samples: [],
    })
}

test('a class icon path surfaces on the LoadedClass', async () => {
    const s = new FakeStorage('fake://libraries')
    await s.WriteText('microsoft/0.1.0/library.json', JSON.stringify({
        id: 'microsoft', version: '0.1.0', name: 'microsoft', metaModel: { id: 'ea', version: '5' },
        classes: [{ id: 'microsoft.azure', concept: 'location', icon: 'resources/azure.svg' }],
    }))
    const lib = await loadLibrary(s, 'microsoft', '0.1.0')
    expect(lib.classes[0]!.icon).toBe('resources/azure.svg')
})

test('readIconSource reads a class icon SVG, undefined when absent', async () => {
    const s = new FakeStorage('fake://libraries')
    await s.WriteText('microsoft/0.1.0/resources/azure.svg', '<svg/>')
    const lib = { id: 'microsoft', version: '0.1.0', name: 'm', metaModel: { id: 'ea', version: '5' }, classes: [], problems: [] }
    expect(await readIconSource(s, lib, { id: 'microsoft.azure', concept: 'location', icon: 'resources/azure.svg' })).toBe('<svg/>')
    expect(await readIconSource(s, lib, { id: 'x', concept: 'location' })).toBeUndefined()
})

test('discovers every published <id>/<version> and loads its classes', async () => {
    const b = new FakeStorage('fake://libraries')
    await b.WriteText('microsoft/0.1.0/library.json', manifest('microsoft'))
    await b.WriteText('microsoft/0.1.0/visuals/microsoft.azure.mural', 'TextBlock [ Text = $Display ]')
    await b.WriteText('aws/0.1.0/library.json', manifest('aws'))

    const libs = await discoverLibraries(b)
    expect(libs.map((l) => l.id).sort()).toEqual(['aws', 'microsoft'])
    const ms = libs.find((l) => l.id === 'microsoft')!
    expect(ms.classes[0]).toMatchObject({ id: 'microsoft.azure', concept: 'location', templatePath: 'visuals/microsoft.azure.mural' })
    expect(ms.problems).toEqual([])
})

test('a malformed manifest yields one error problem and no classes, not a throw', async () => {
    const b = new FakeStorage('fake://libraries')
    await b.WriteText('broken/0.1.0/library.json', '{ not json')
    const lib = await loadLibrary(b, 'broken', '0.1.0')
    expect(lib.classes).toEqual([])
    expect(lib.problems).toHaveLength(1)
    expect(lib.problems[0]).toMatchObject({ severity: 'error', uri: 'library.json' })
})

test('a class citing a missing template file records a warning but still loads', async () => {
    const b = new FakeStorage('fake://libraries')
    await b.WriteText('microsoft/0.1.0/library.json', manifest('microsoft'))   // template file absent
    const lib = await loadLibrary(b, 'microsoft', '0.1.0')
    expect(lib.classes).toHaveLength(1)
    expect(lib.problems).toEqual([{ severity: 'warning', uri: 'visuals/microsoft.azure.mural', message: expect.stringContaining('missing') }])
})

// ── loadLibraryPresentation ─────────────────────────────────────────────────
// Bake an artifact via the publisher so its shape stays in lockstep with the
// emitter, then assert the loader evals it into a class-keyed dictionary.
test('loadLibraryPresentation evals the compiled artifact into a class-keyed dictionary', async () => {
    const backend = new FakeStorage('fake://libraries')
    const proj = new FakeStorage('fake://proj')
    await proj.WriteText('resources/azure.svg', '<svg viewBox="0 0 16 16"><path d="M2 2 L14 2 L14 14 Z"/></svg>')
    const doc = { nodes: [{ id: 'microsoft.azure', tier: 'Instance', typeOf: 'location',
        attrs: { class: true, id: 'azure', label: 'Azure', icon: 'resources/azure.svg' } }], edges: [] } as any
    const { publishLibraryPresentation } = await import('../library-presentation-publisher.js')
    await publishLibraryPresentation(proj, backend, 'microsoft/0.1.0', doc)

    const { loadLibraryPresentation } = await import('../library-loader.js')
    const dict = await loadLibraryPresentation(backend, 'microsoft', '0.1.0')
    expect(dict).toBeDefined()
    expect(dict!.CanResolve('microsoft.azure')).toBe(true)
})

test('loadLibraryPresentation returns undefined when the bundle has no compiled presentation', async () => {
    const backend = new FakeStorage('fake://libraries')
    await backend.WriteText('microsoft/0.1.0/library.json', '{}')
    const { loadLibraryPresentation } = await import('../library-loader.js')
    expect(await loadLibraryPresentation(backend, 'microsoft', '0.1.0')).toBeUndefined()
})

test('loadLibraryPresentation evals a raster-icon artifact (ImageBrush/BitmapImage in ctx)', async () => {
    const backend = new FakeStorage('fake://libraries')
    const proj = new FakeStorage('fake://proj')
    const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
    await proj.WriteBytes('resources/aml.png', PNG)
    const doc = { nodes: [{ id: 'microsoft.aml', tier: 'Instance', typeOf: 'technology',
        attrs: { class: true, id: 'aml', label: 'Azure ML', icon: 'resources/aml.png' } }], edges: [] } as any
    const { publishLibraryPresentation } = await import('../library-presentation-publisher.js')
    await publishLibraryPresentation(proj, backend, 'microsoft/0.1.0', doc)

    const { loadLibraryPresentation } = await import('../library-loader.js')
    const dict = await loadLibraryPresentation(backend, 'microsoft', '0.1.0')
    expect(dict).toBeDefined()
    expect(dict!.CanResolve('microsoft.aml')).toBe(true)
})

import { test, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-lab/todl'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { publishLibraryPresentation } from '../library-presentation-publisher.js'

const DOC: TodlDocument = {
    nodes: [
        { id: 'microsoft.azure', tier: 'Instance', typeOf: 'location',
          attrs: { class: true, id: 'azure', label: 'Azure', icon: 'resources/azure.svg' } },
        { id: 'microsoft.aws', tier: 'Instance', typeOf: 'location', attrs: { class: true, id: 'aws', label: 'AWS' } },
    ],
    edges: [],
} as unknown as TodlDocument

const SVG = '<svg viewBox="0 0 16 16"><path d="M2 2 L14 2 L14 14 Z"/></svg>'
function project(withIcon = true): FakeStorage {
    const s = new FakeStorage('fake://proj')
    if (withIcon) void s.WriteText('resources/azure.svg', SVG)
    return s
}

test('writes a self-contained compiled artifact (geometry inlined, no include)', async () => {
    const dest = new FakeStorage('fake://backend')
    const res = await publishLibraryPresentation(project(), dest, 'microsoft/0.1.0', DOC)
    expect(res).toMatchObject({ ok: true, templates: 2, icons: 1 })
    expect(await dest.Exists('microsoft/0.1.0/presentation/presentation.compiled.json')).toBe(true)
    const art = JSON.parse(await dest.ReadText('microsoft/0.1.0/presentation/presentation.compiled.json'))
    expect(art.className).toBe('LibraryPresentation')
    expect(art.symbols).toContain('ResourceDictionary')
    expect(art.body).not.toContain('include ')
    // the compiled body carries a class-keyed template
    expect(art.body).toContain('microsoft.azure')
})

test('a referenced icon with no project file blocks publish (names the path, writes nothing)', async () => {
    const dest = new FakeStorage('fake://backend')
    const res = await publishLibraryPresentation(project(false), dest, 'microsoft/0.1.0', DOC)
    expect(res).toEqual({ ok: false, missing: ['resources/azure.svg'] })
    expect(await dest.Exists('microsoft/0.1.0/presentation/presentation.compiled.json')).toBe(false)
})

test('a model with no icons still bakes a valid artifact', async () => {
    const noIcons: TodlDocument = {
        nodes: [{ id: 'microsoft.aws', tier: 'Instance', typeOf: 'location', attrs: { class: true, id: 'aws', label: 'AWS' } }],
        edges: [],
    } as unknown as TodlDocument
    const dest = new FakeStorage('fake://backend')
    const res = await publishLibraryPresentation(new FakeStorage('fake://proj'), dest, 'microsoft/0.1.0', noIcons)
    expect(res).toMatchObject({ ok: true, icons: 0 })
    const art = JSON.parse(await dest.ReadText('microsoft/0.1.0/presentation/presentation.compiled.json'))
    expect(art.body).toContain('DataTemplate')
})

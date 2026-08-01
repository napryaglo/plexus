import { test, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-lab/todl'

import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { publishPresentation } from '../presentation-publisher.js'

const DOC: TodlDocument = {
    nodes: [
        { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: { label: 'Actor', icon: 'resources/actor.svg' } },
        { id: 'component', tier: 'Ontology', typeOf: 'concept', attrs: {} },
        { id: 'depends-on', tier: 'Ontology', typeOf: 'relationship', attrs: {} },
    ],
    edges: [],
} as unknown as TodlDocument

const SVG = '<svg viewBox="0 0 16 16"><path d="M2 2 L14 2 L14 14 Z"/></svg>'

function project(withIcon = true): FakeStorage {
    const s = new FakeStorage('fake://proj')
    if (withIcon) void s.WriteText('resources/actor.svg', SVG)
    return s
}

test('writes a self-contained compiled artifact, not raw .mu or SVGs', async () => {
    const dest = new FakeStorage('fake://backend')
    const res = await publishPresentation(project(), dest, 'ea/1.0.0', DOC)
    expect(res.ok).toBe(true)

    expect(await dest.Exists('ea/1.0.0/presentation/presentation.compiled.json')).toBe(true)
    expect(await dest.Exists('ea/1.0.0/presentation/presentation.generated.mu')).toBe(false)
    expect(await dest.Exists('ea/1.0.0/presentation/resources/actor.svg')).toBe(false)

    const art = JSON.parse(await dest.ReadText('ea/1.0.0/presentation/presentation.compiled.json'))
    expect(art.className).toBe('MetaModelPresentation')
    expect(art.symbols).toContain('MetaModelEntity')
    expect(art.symbols).toContain('ResourceDictionary')
    expect(typeof art.body).toBe('string')
    expect(art.body).not.toContain('include ')     // geometry inlined, no external include
})

test('reports template + icon counts', async () => {
    const dest = new FakeStorage('fake://backend')
    const res = await publishPresentation(project(), dest, 'ea/1.0.0', DOC)
    expect(res).toMatchObject({ ok: true, templates: 3, icons: 1 })
})

test('a referenced icon with no project file blocks publish (names the path, writes nothing)', async () => {
    const dest = new FakeStorage('fake://backend')
    const res = await publishPresentation(project(false), dest, 'ea/1.0.0', DOC)
    expect(res).toEqual({ ok: false, missing: ['resources/actor.svg'] })
    expect(await dest.Exists('ea/1.0.0/presentation/presentation.compiled.json')).toBe(false)
})

test('a model with no icons still publishes a valid artifact', async () => {
    const noIcons: TodlDocument = {
        nodes: [{ id: 'component', tier: 'Ontology', typeOf: 'concept', attrs: {} }], edges: [],
    } as unknown as TodlDocument
    const dest = new FakeStorage('fake://backend')
    const res = await publishPresentation(new FakeStorage('fake://proj'), dest, 'ea/1.0.0', noIcons)
    expect(res).toMatchObject({ ok: true, icons: 0 })
    const art = JSON.parse(await dest.ReadText('ea/1.0.0/presentation/presentation.compiled.json'))
    expect(art.body).toContain('DataTemplate')
})

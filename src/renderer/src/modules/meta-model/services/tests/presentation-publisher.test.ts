import { test, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-lab/todl'

import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { publishPresentation } from '../presentation-publisher.js'

// A hand-built compiled document (toJSON shape): one concept with an icon, one
// without, one relationship — avoids authoring icon-bearing TODL.
const DOC: TodlDocument = {
    nodes: [
        { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: { label: 'Actor', icon: 'resources/actor.svg' } },
        { id: 'component', tier: 'Ontology', typeOf: 'concept', attrs: {} },
        { id: 'depends-on', tier: 'Ontology', typeOf: 'relationship', attrs: {} },
    ],
    edges: [],
} as unknown as TodlDocument

function project(): FakeStorage
{
    const s = new FakeStorage('fake://proj')
    void s.WriteText('resources/actor.svg', '<svg>actor</svg>')
    void s.WriteText('presentation/custom.mu', 'resources Custom { }')
    return s
}

test('writes the generated dictionary source with a template per entity and the author merge', async () => {
    const dest = new FakeStorage('fake://backend')
    await publishPresentation(project(), dest, 'ea/1.0.0', DOC, ['Custom'])

    const src = await dest.ReadText('ea/1.0.0/presentation/presentation.generated.mu')
    expect(src).toContain('DataTemplate x:key="mm:actor"')
    expect(src).toContain('DataTemplate x:key="mm:component"')
    expect(src).toContain('DataTemplate x:key="mm:depends-on"')
    expect(src).toContain('merge Custom')
})

test('copies each declared icon SVG preserving its project-relative path', async () => {
    const dest = new FakeStorage('fake://backend')
    await publishPresentation(project(), dest, 'ea/1.0.0', DOC, [])
    expect(await dest.ReadText('ea/1.0.0/presentation/resources/actor.svg')).toBe('<svg>actor</svg>')
})

test('copies the project presentation/ overrides tree under overrides/', async () => {
    const dest = new FakeStorage('fake://backend')
    await publishPresentation(project(), dest, 'ea/1.0.0', DOC, ['Custom'])
    expect(await dest.ReadText('ea/1.0.0/presentation/overrides/custom.mu')).toBe('resources Custom { }')
})

test('reports template + icon counts', async () => {
    const dest = new FakeStorage('fake://backend')
    const stats = await publishPresentation(project(), dest, 'ea/1.0.0', DOC, [])
    expect(stats.templates).toBe(3)   // actor + component + depends-on
    expect(stats.icons).toBe(1)       // only actor.svg exists
})

test('a declared icon with no file is skipped, not fatal', async () => {
    const proj = new FakeStorage('fake://proj')   // no resources/actor.svg on disk
    const dest = new FakeStorage('fake://backend')
    const stats = await publishPresentation(proj, dest, 'ea/1.0.0', DOC, [])
    expect(stats.icons).toBe(0)
    expect(await dest.Exists('ea/1.0.0/presentation/resources/actor.svg')).toBe(false)
    // The generated source still shipped.
    expect(await dest.Exists('ea/1.0.0/presentation/presentation.generated.mu')).toBe(true)
})

test('no project presentation/ folder → no overrides dir, source still written', async () => {
    const proj = new FakeStorage('fake://proj')
    await proj.WriteText('resources/actor.svg', '<svg/>')
    const dest = new FakeStorage('fake://backend')
    await publishPresentation(proj, dest, 'ea/1.0.0', DOC, [])
    expect(await dest.Exists('ea/1.0.0/presentation/overrides')).toBe(false)
    expect(await dest.Exists('ea/1.0.0/presentation/presentation.generated.mu')).toBe(true)
})

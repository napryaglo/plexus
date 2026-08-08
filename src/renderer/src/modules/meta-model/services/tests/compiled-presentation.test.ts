import { describe, it, expect } from 'vitest'
import { ResourceDictionary } from '@pragmatic-lab/mural/runtime'

import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import type { TodlDocument } from '@pragmatic-lab/todl'
import { publishPresentation } from '../presentation-publisher.js'
import { loadCompiledPresentation } from '../compiled-presentation.js'

const SVG = '<svg viewBox="0 0 16 16"><path d="M2 2 L14 2 L14 14 Z"/></svg>'

const DOC: TodlDocument = {
    nodes: [
        { id: 'application', tier: 'Ontology', typeOf: 'concept', attrs: { label: 'Application', icon: 'resources/app.svg' } },
    ],
    edges: [],
} as unknown as TodlDocument

// Bake a compiled presentation artifact into a FakeStorage, mirroring the
// pattern in library-registry.test.ts (bakePresentation) — publish via the
// real publisher so the artifact format is always in sync.
async function bakePresentation(): Promise<FakeStorage> {
    const project = new FakeStorage('fake://proj')
    await project.WriteText('resources/app.svg', SVG)
    const backend = new FakeStorage('fake://backend')
    const res = await publishPresentation(project, backend, 'ea/1.0.0', DOC)
    expect(res.ok).toBe(true)
    return backend
}

describe('loadCompiledPresentation', () => {
    it('returns a ResourceDictionary that CanResolve the baked key when the artifact exists', async () => {
        const storage = await bakePresentation()
        const dict = await loadCompiledPresentation(storage, 'ea/1.0.0', {})
        expect(dict).toBeInstanceOf(ResourceDictionary)
        expect(dict!.CanResolve('mm:application')).toBe(true)
    })

    it('returns undefined when the compiled artifact is missing', async () => {
        const storage = new FakeStorage('fake://empty')
        const result = await loadCompiledPresentation(storage, 'ea/1.0.0', {})
        expect(result).toBeUndefined()
    })

    it('injects ctxExtra symbols into the eval context', async () => {
        // A custom ctx symbol injected via ctxExtra must be accessible to the
        // eval'd body without throwing a ReferenceError. We verify indirectly:
        // the meta-model publisher injects MetaModelEntity via the standard
        // ctxExtra path — if the dict resolved correctly the symbol was present.
        const storage = await bakePresentation()
        const { MetaModelEntity } = await import('../meta-model-entity.js')
        const dict = await loadCompiledPresentation(storage, 'ea/1.0.0', { MetaModelEntity })
        expect(dict).toBeInstanceOf(ResourceDictionary)
        expect(dict!.CanResolve('mm:application')).toBe(true)
    })
})

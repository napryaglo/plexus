import { describe, it, expect } from 'vitest'
import { DataTemplate } from '@pragmatic-lab/mural/basic'

import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import type { TodlDocument } from '@pragmatic-lab/todl'
import { publishPresentation } from '../presentation-publisher.js'
import { loadPresentation } from '../presentation-loader.js'

const DOC: TodlDocument = {
    nodes: [
        { id: 'application', tier: 'Ontology', typeOf: 'concept', attrs: { label: 'Application', icon: 'resources/app.svg' } },
    ],
    edges: [],
} as unknown as TodlDocument

async function publishFixture(): Promise<FakeStorage> {
    const project = new FakeStorage('fake://proj')
    await project.WriteText('resources/app.svg', '<svg viewBox="0 0 16 16"><path d="M2 2 L14 2 L14 14 Z"/></svg>')
    const backend = new FakeStorage('fake://meta-models')
    const res = await publishPresentation(project, backend, 'tech/0.1.0', DOC)
    expect(res.ok).toBe(true)
    return backend
}

describe('loadPresentation', () => {
    it('evaluates the compiled artifact into a dictionary that resolves mm:<id> with a baked icon', async () => {
        const backend = await publishFixture()
        // No SVG files exist in the backend — the geometry is baked into the artifact.
        expect(await backend.Exists('tech/0.1.0/presentation/resources/app.svg')).toBe(false)

        const dict = await loadPresentation(backend, 'tech/0.1.0')
        expect(dict.CanResolve('mm:application')).toBe(true)
        expect(dict.Resolve('mm:application')).toBeInstanceOf(DataTemplate)
    })

    it('throws a republish error when the compiled artifact is missing (old format)', async () => {
        const backend = new FakeStorage('fake://meta-models')
        await expect(loadPresentation(backend, 'x/0.0.0')).rejects.toThrow(/republish/i)
    })
})

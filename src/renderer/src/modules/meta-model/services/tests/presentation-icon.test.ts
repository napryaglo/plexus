import { test, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-lab/todl'
import { DataTemplate } from '@pragmatic-lab/mural/basic'
import type { Visual } from '@pragmatic-lab/mural/runtime'

import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { publishPresentation } from '../presentation-publisher.js'
import { loadPresentation } from '../presentation-loader.js'
import { MetaModelEntity } from '../meta-model-entity.js'

const DOC: TodlDocument = {
    nodes: [
        { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: { label: 'Actor', icon: 'resources/actor.svg' } },
    ],
    edges: [],
} as unknown as TodlDocument

function firstOfType(v: Visual | undefined, typeName: string): Visual | undefined {
    if (v === undefined) return undefined
    if (v.constructor.name === typeName) return v
    const kids = [
        ...((v as unknown as { visualChildren?: Visual[] }).visualChildren ?? []),
        ...((v as unknown as { logicalChildren?: Visual[] }).logicalChildren ?? []),
    ]
    for (const c of kids) { const r = firstOfType(c, typeName); if (r !== undefined) return r }
    return undefined
}

// The entity template's icon is a Shape whose Geometry is the included SVG,
// referenced by `@mm_icon_<id>`. Because the applied template is rendered OUTSIDE
// the presentation dictionary's resource scope (e.g. on the canvas or toolbox),
// that reference must be BAKED IN at compile (mural inlines a same-dictionary
// `@key`), not left as a runtime DynamicResource that would resolve to nothing.
// Guards the icon end to end: publish → load → apply → the Shape carries real geometry.
test('an applied entity template has its icon geometry baked in (resolves standalone)', async () => {
    const project = new FakeStorage('fake://proj')
    await project.WriteText('resources/actor.svg', '<svg viewBox="0 0 16 16"><path d="M2 2 L14 2 L14 14 Z"/></svg>')
    const backend = new FakeStorage('fake://meta-models')
    expect((await publishPresentation(project, backend, 'x/1.0.0', DOC)).ok).toBe(true)

    const dict = await loadPresentation(backend, 'x/1.0.0')
    const tmpl = dict.Resolve('mm:actor') as DataTemplate
    const entity = new MetaModelEntity()
    const root = tmpl.Apply(entity) as Visual

    const shape = firstOfType(root, 'Shape') as (Visual & { Geometry?: unknown }) | undefined
    expect(shape, 'template contains an icon Shape').toBeDefined()
    expect(shape!.Geometry, 'Shape.Geometry is baked in, not an unresolved DynamicResource').toBeDefined()
})

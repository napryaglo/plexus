import { test, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-lab/todl'

import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { deriveClasses, scanResources } from '../library-bundle.js'

// A hand-built model mirroring what the sample `microsoft` taxonomy compiles to
// (verified empirically): Ontology-tier concept/field/taxonomy DEFINITIONS plus
// two Instance-tier CLASS clabjects (attrs.class === true).
const MODEL: TodlDocument = {
    nodes: [
        { id: 'location',   tier: 'Ontology', typeOf: 'concept',  attrs: {} },
        { id: 'technology', tier: 'Ontology', typeOf: 'concept',  attrs: {} },
        { id: 'microsoft',  tier: 'Ontology', typeOf: 'taxonomy', attrs: {} },
        { id: 'microsoft.azure',        tier: 'Instance', typeOf: 'location',   attrs: { class: true, id: 'azure',        label: 'Azure' } },
        { id: 'microsoft.azure-openai', tier: 'Instance', typeOf: 'technology', attrs: { class: true, id: 'azure-openai', label: 'Azure OpenAI' } },
    ],
    edges: [],
}

test('derives only Instance-tier class clabjects, with localId/label/concept', () => {
    const classes = deriveClasses(MODEL)
    expect(classes).toEqual([
        { id: 'microsoft.azure',        localId: 'azure',        label: 'Azure',        concept: 'location' },
        { id: 'microsoft.azure-openai', localId: 'azure-openai', label: 'Azure OpenAI', concept: 'technology' },
    ])
})

test('ignores Ontology-tier definitions and non-class instances', () => {
    const model: TodlDocument = { nodes: [
        { id: 'x',     tier: 'Ontology', typeOf: 'concept',  attrs: {} },
        { id: 'lib.i', tier: 'Instance', typeOf: 'x',        attrs: { id: 'i' } },   // an instance, not a class
    ], edges: [] }
    expect(deriveClasses(model)).toEqual([])
})

test('binds resource files to classes by filename and lists bundle folders', async () => {
    const s = new FakeStorage('fake://lib')
    await s.WriteText('visuals/microsoft.azure.mural', '<template/>')
    await s.WriteText('thumbnails/microsoft.azure.png', 'PNGBYTES')
    await s.WriteText('docs/microsoft.azure.md', '# Azure')
    await s.WriteText('docs/README.md', '# Library')
    await s.WriteText('assets/logo.svg', '<svg/>')
    await s.WriteText('samples/demo.todl', 'sample')
    await s.WriteText('visuals/ghost.mural', '<template/>')   // orphan: unknown class

    const scanned = await scanResources(s, ['microsoft.azure', 'microsoft.azure-openai'])

    expect(scanned.byClass.get('microsoft.azure')).toEqual({
        template: 'visuals/microsoft.azure.mural',
        thumbnail: 'thumbnails/microsoft.azure.png',
        doc: 'docs/microsoft.azure.md',
    })
    expect(scanned.byClass.has('microsoft.azure-openai')).toBe(false)   // no files for it
    expect(scanned.assets).toEqual(['assets/logo.svg'])
    expect(scanned.docs.sort()).toEqual(['docs/README.md', 'docs/microsoft.azure.md'])
    expect(scanned.samples).toEqual(['samples/demo.todl'])
    expect(scanned.warnings).toEqual(['visuals/ghost.mural targets unknown class "ghost"'])
})

test('missing resource folders scan cleanly to empty', async () => {
    const scanned = await scanResources(new FakeStorage('fake://empty'), ['a'])
    expect(scanned.byClass.size).toBe(0)
    expect(scanned.assets).toEqual([])
    expect(scanned.warnings).toEqual([])
})

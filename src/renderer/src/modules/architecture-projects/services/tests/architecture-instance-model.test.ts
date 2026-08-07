import { test, expect } from 'vitest'
import { check, checkAgainst, toJSON, type TodlDocument } from '@pragmatic-lab/todl'

import { ArchInstanceModel } from '../architecture-instance-model.js'

const META = `namespace ea {
  concept Technology { label : string; }
  concept Component { label : string; realisedBy : Technology?; deployedTo : Technology[]; }
}`
const LIB = `namespace ms { taxonomy Stack : represents Technology {
  Technology AzureOpenai { label = "Azure OpenAI"; }
} }`

function bases(): TodlDocument[] {
    const metaDoc = toJSON(check([{ uri: 'ea.todl', text: META }]).model)
    const libDoc = toJSON(checkAgainst([metaDoc], [{ uri: 'ms.todl', text: LIB }]).model)
    return [metaDoc, libDoc]
}

test('load exposes only the own instances (not base concepts/terms)', () => {
    const src = `namespace app { Component gw { label = "Gateway"; } }`
    const model = ArchInstanceModel.load(bases(), src, 'app')
    expect(model.ownInstances()).toEqual(['gw'])
})

test('createInstance adds a fresh concept instance; setField + addRelationship mutate it', () => {
    const model = ArchInstanceModel.load(bases(), '', 'app')
    const id = model.createInstance('Component')
    expect(model.ownInstances()).toEqual([id])

    model.setField(id, 'label', 'API')
    model.addRelationship(id, 'realisedBy', 'Stack.AzureOpenai')

    const emitted = model.emit()
    expect(emitted).toContain(`Component ${id}`)
    expect(emitted).toContain('label = "API";')
    expect(emitted).toContain('realisedBy = Stack.AzureOpenai;')
})

test('remove drops the instance and its edges', () => {
    const model = ArchInstanceModel.load(bases(), '', 'app')
    const id = model.createInstance('Component')
    model.addRelationship(id, 'realisedBy', 'Stack.AzureOpenai')
    model.remove(id)
    expect(model.ownInstances()).toEqual([])
    expect(model.emit()).not.toContain('realisedBy')
})

test('referenceMembers returns the concept-typed fields whose type the target satisfies', () => {
    const model = ArchInstanceModel.load(bases(), '', 'app')
    const from = model.createInstance('Component')
    // 'Stack.AzureOpenai' is a technology term; component references technology
    // via realisedBy (single) and deployedTo (list); label:string is excluded.
    const names = model.referenceMembers(from, 'Stack.AzureOpenai').map((r) => r.name).sort()
    expect(names).toEqual(['deployedTo', 'realisedBy'])
})

test('load strips the model container node; ownInstances excludes it', () => {
    const src = `namespace app { model appModel : ea uses Stack { Component gw { label = "Gateway"; } } }`
    const model = ArchInstanceModel.load(bases(), src, 'app')
    expect(model.ownInstances()).toEqual(['gw'])   // 'appModel' container excluded
})

test('emit wraps concrete instances in a model block bound to the meta-model', () => {
    const model = ArchInstanceModel.load(bases(), '', 'app')
    const id = model.createInstance('Component')
    model.setField(id, 'label', 'API')

    const emitted = model.emit()
    expect(emitted).toContain('model appModel : ea')
    expect(emitted).toContain(`Component ${id}`)
})

test('changed fires on every mutation', () => {
    const model = ArchInstanceModel.load(bases(), '', 'app')
    let n = 0
    model.onChanged(() => { n++ })
    const id = model.createInstance('Component')
    model.setField(id, 'label', 'x')
    model.remove(id)
    expect(n).toBe(3)
})

test('createInstance generates a valid camelCase C-like id (no hyphen)', () => {
    const META2 = `namespace ea { concept Component { label : string; } }`
    const metaDoc = toJSON(check([{ uri: 'ea.todl', text: META2 }]).model)
    const m = ArchInstanceModel.load([metaDoc], '', 'app')
    const id = m.createInstance('ea.Component')
    expect(id).toBe('component1')
    expect(id).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/)
})

import { test, expect } from 'vitest'
import { check, checkAgainst, toJSON, type TodlDocument } from '@pragmatic-lab/todl'

import { ArchInstanceModel } from '../architecture-instance-model.js'

const META = `namespace ea {
  concept technology { label : string; }
  concept component { label : string; realised-by : technology?; deployed-to : technology[]; }
}`
const LIB = `namespace ms { taxonomy stack : represents technology {
  technology azure-openai { label = "Azure OpenAI"; }
} }`

function bases(): TodlDocument[] {
    const metaDoc = toJSON(check([{ uri: 'ea.todl', text: META }]).model)
    const libDoc = toJSON(checkAgainst([metaDoc], [{ uri: 'ms.todl', text: LIB }]).model)
    return [metaDoc, libDoc]
}

test('load exposes only the own instances (not base concepts/terms)', () => {
    const src = `namespace app { component gw { label = "Gateway"; } }`
    const model = ArchInstanceModel.load(bases(), src, 'app')
    expect(model.ownInstances()).toEqual(['gw'])
})

test('createInstance adds a fresh concept instance; setField + addRelationship mutate it', () => {
    const model = ArchInstanceModel.load(bases(), '', 'app')
    const id = model.createInstance('component')
    expect(model.ownInstances()).toEqual([id])

    model.setField(id, 'label', 'API')
    model.addRelationship(id, 'realised-by', 'stack.azure-openai')

    const emitted = model.emit()
    expect(emitted).toContain(`component ${id}`)
    expect(emitted).toContain('label = "API";')
    expect(emitted).toContain('realised-by = &stack.azure-openai;')
})

test('remove drops the instance and its edges', () => {
    const model = ArchInstanceModel.load(bases(), '', 'app')
    const id = model.createInstance('component')
    model.addRelationship(id, 'realised-by', 'stack.azure-openai')
    model.remove(id)
    expect(model.ownInstances()).toEqual([])
    expect(model.emit()).not.toContain('realised-by')
})

test('referenceMembers returns the concept-typed fields whose type the target satisfies', () => {
    const model = ArchInstanceModel.load(bases(), '', 'app')
    const from = model.createInstance('component')
    // 'stack.azure-openai' is a technology term; component references technology
    // via realised-by (single) and deployed-to (list); label:string is excluded.
    const names = model.referenceMembers(from, 'stack.azure-openai').map((r) => r.name).sort()
    expect(names).toEqual(['deployed-to', 'realised-by'])
})

test('load strips the model container node; ownInstances excludes it', () => {
    const src = `namespace app { model app-model : ea uses ms { component gw { label = "Gateway"; } } }`
    const model = ArchInstanceModel.load(bases(), src, 'app')
    expect(model.ownInstances()).toEqual(['gw'])   // 'app-model' container excluded
})

test('emit wraps concrete instances in a model block bound to the meta-model', () => {
    const model = ArchInstanceModel.load(bases(), '', 'app')
    const id = model.createInstance('component')
    model.setField(id, 'label', 'API')

    const emitted = model.emit()
    expect(emitted).toContain('model app-model : ea')
    expect(emitted).toContain(`component ${id}`)
})

test('changed fires on every mutation', () => {
    const model = ArchInstanceModel.load(bases(), '', 'app')
    let n = 0
    model.onChanged(() => { n++ })
    const id = model.createInstance('component')
    model.setField(id, 'label', 'x')
    model.remove(id)
    expect(n).toBe(3)
})

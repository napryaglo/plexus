import { test, expect } from 'vitest'
import { check, checkAgainst, toJSON, type TodlDocument } from '@pragmatic-lab/todl'

import { ArchInstanceModel } from '../architecture-instance-model.js'
import { InstanceNodeVM } from '../instance-node-vm.js'

const META = `namespace ea {
  concept Technology { label : string; }
  concept Component { label : string; realisedBy : Technology?; }
}`
const LIB = `namespace ms { taxonomy Stack : represents Technology {
  Technology azureOpenai { label = "Azure OpenAI"; }
} }`

function model(): ArchInstanceModel {
    const metaDoc = toJSON(check([{ uri: 'ea.todl', text: META }]).model)
    const libDoc = toJSON(checkAgainst([metaDoc], [{ uri: 'ms.todl', text: LIB }]).model)
    return ArchInstanceModel.load([metaDoc, libDoc] as TodlDocument[], '', 'app')
}

test('exposes Display + Concept from the node', () => {
    const m = model()
    const id = m.createInstance('component')
    m.setField(id, 'label', 'API')
    const vm = new InstanceNodeVM(m, id)
    expect(vm.Display).toBe('API')
    expect(vm.Concept).toBe('component')
})

test('SetField writes through to the model and updates the VM', () => {
    const m = model()
    const id = m.createInstance('component')
    const vm = new InstanceNodeVM(m, id)

    vm.SetField('label', 'Renamed')
    expect(vm.Display).toBe('Renamed')
    expect(m.node(id)?.attrs.label).toBe('Renamed')
})

test('ReferencedTerm reflects a relationship added to the model', () => {
    const m = model()
    const id = m.createInstance('component')
    const vm = new InstanceNodeVM(m, id)
    expect(vm.ReferencedTerm).toBe('')

    m.addRelationship(id, 'realised-by', 'stack.azure-openai')
    expect(vm.ReferencedTerm).toBe('stack.azure-openai')
})

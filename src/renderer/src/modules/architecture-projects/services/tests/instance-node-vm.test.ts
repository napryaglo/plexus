import { test, expect } from 'vitest'
import { check, checkAgainst, toJSON, type TodlDocument } from '@pragmatic-lab/todl'

import { ArchInstanceModel } from '../architecture-instance-model.js'
import { InstanceNodeVM } from '../instance-node-vm.js'
import { TodlVisualResolverKey } from '../../../diagram/services/todl-visual-resolver.js'

const META = `namespace ea {
  concept Technology { label : string; }
  concept Component { label : string; realisedBy : Technology?; }
}`
const LIB = `namespace ms { taxonomy Stack : represents Technology {
  Technology AzureOpenai { label = "Azure OpenAI"; }
} }`

function model(): ArchInstanceModel {
    const metaDoc = toJSON(check([{ uri: 'ea.todl', text: META }]).model)
    const libDoc = toJSON(checkAgainst([metaDoc], [{ uri: 'ms.todl', text: LIB }]).model)
    return ArchInstanceModel.load([metaDoc, libDoc] as TodlDocument[], '', 'app')
}

test('exposes Display + Concept from the node', () => {
    const m = model()
    const id = m.createInstance('Component')
    m.setField(id, 'label', 'API')
    const vm = new InstanceNodeVM(m, id)
    expect(vm.Display).toBe('API')
    expect(vm.Concept).toBe('Component')
})

test('SetField writes through to the model and updates the VM', () => {
    const m = model()
    const id = m.createInstance('Component')
    const vm = new InstanceNodeVM(m, id)

    vm.SetField('label', 'Renamed')
    expect(vm.Display).toBe('Renamed')
    expect(m.node(id)?.attrs.label).toBe('Renamed')
})

test('ReferencedTerm reflects a relationship added to the model', () => {
    const m = model()
    const id = m.createInstance('Component')
    const vm = new InstanceNodeVM(m, id)
    expect(vm.ReferencedTerm).toBe('')

    m.addRelationship(id, 'realisedBy', 'Stack.AzureOpenai')
    expect(vm.ReferencedTerm).toBe('Stack.AzureOpenai')
})

test('Descriptor uses the concept resolver when there is no referenced term', () => {
    const m = model()
    const id = m.createInstance('Component')
    const vm = new InstanceNodeVM(m, id)
    expect(vm.Descriptor?.ResolverKey).toBe(TodlVisualResolverKey)
    expect(vm.Descriptor?.Key).toBe('mm:Component')
})

test('Descriptor switches to the library resolver keyed on the referenced term', () => {
    const m = model()
    const id = m.createInstance('Component')
    const vm = new InstanceNodeVM(m, id)
    m.addRelationship(id, 'realisedBy', 'Stack.AzureOpenai')
    expect(vm.Descriptor?.ResolverKey).toBe(TodlVisualResolverKey)
    expect(vm.Descriptor?.Key).toBe('Stack.AzureOpenai')
})

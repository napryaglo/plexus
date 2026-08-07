import { test, expect } from 'vitest'
import { check, checkAgainst, toJSON, type TodlDocument } from '@pragmatic-lab/todl'

import { ArchInstanceModel } from '../architecture-instance-model.js'
import { resolveTermDrop } from '../drop-resolver.js'

const META = `namespace ea {
  concept Technology { label : string; }
  concept Component { label : string; realisedBy : Technology?; }
  concept Location { label : string; }
}`
const LIB = `namespace ms { taxonomy Stack : represents Technology {
  Technology AzureOpenai { label = "Azure OpenAI"; }
} }`

function model(): ArchInstanceModel {
    const metaDoc = toJSON(check([{ uri: 'ea.todl', text: META }]).model)
    const libDoc = toJSON(checkAgainst([metaDoc], [{ uri: 'ms.todl', text: LIB }]).model)
    return ArchInstanceModel.load([metaDoc, libDoc] as TodlDocument[], '', 'app')
}

test('resolves a technology term to the concept+member that can reference it', () => {
    expect(resolveTermDrop(model(), 'Stack.AzureOpenai')).toEqual([{ concept: 'Component', member: 'realisedBy' }])
})

test('an unknown term resolves to no targets', () => {
    expect(resolveTermDrop(model(), 'nonexistent.term')).toEqual([])
})

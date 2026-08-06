import { test, expect } from 'vitest'
import { check, checkAgainst, toJSON, type TodlDocument } from '@pragmatic-lab/todl'

import { ArchInstanceModel } from '../architecture-instance-model.js'
import { resolveTermDrop } from '../drop-resolver.js'

const META = `namespace ea {
  concept technology { label : string; }
  concept component { label : string; realised-by : technology?; }
  concept location { label : string; }
}`
const LIB = `namespace ms { taxonomy stack : represents technology {
  technology azure-openai { label = "Azure OpenAI"; }
} }`

function model(): ArchInstanceModel {
    const metaDoc = toJSON(check([{ uri: 'ea.todl', text: META }]).model)
    const libDoc = toJSON(checkAgainst([metaDoc], [{ uri: 'ms.todl', text: LIB }]).model)
    return ArchInstanceModel.load([metaDoc, libDoc] as TodlDocument[], '', 'app')
}

test('resolves a technology term to the concept+member that can reference it', () => {
    expect(resolveTermDrop(model(), 'stack.azure-openai')).toEqual([{ concept: 'component', member: 'realised-by' }])
})

test('an unknown term resolves to no targets', () => {
    expect(resolveTermDrop(model(), 'nonexistent.term')).toEqual([])
})

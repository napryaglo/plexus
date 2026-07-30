import { describe, it, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-lab/todl'
import { buildEntity } from '../meta-model-entity-builder.js'

const doc: TodlDocument = {
  nodes: [
    { id: 'application', tier: 'Ontology', typeOf: 'concept', attrs: {} },
    { id: 'application.id',   tier: 'Ontology', typeOf: 'field', attrs: { name: 'id',   type: 'identifier', cardinality: 0 } },
    { id: 'application.kind', tier: 'Ontology', typeOf: 'field', attrs: { name: 'kind', type: 'ApplicationKind', cardinality: 0 } },
    { id: 'actor',        tier: 'Ontology', typeOf: 'concept', attrs: { label: 'Human Actor' } },
  ],
  edges: [
    { kind: 'HasField', via: null, from: 'application', to: 'application.id' },
    { kind: 'HasField', via: null, from: 'application', to: 'application.kind' },
    { kind: 'HasField', via: null, from: 'application', to: 'missing.field' }, // dangling → skipped
  ],
}

describe('buildEntity', () => {
  it('resolves fields from HasField edges in order and humanizes a missing label', () => {
    const e = buildEntity(doc, 'application')
    expect(e.Id).toBe('application')
    expect(e.TypeOf).toBe('concept')
    expect(e.Label).toBe('Application')                 // attrs.label absent → humanize(id)
    expect(e.Fields.Count).toBe(2)                      // dangling edge skipped
    expect(e.Fields.Get(0)!.Name).toBe('id')
    expect(e.Fields.Get(1)!.Type).toBe('ApplicationKind')
  })

  it('prefers attrs.label when present', () => {
    const e = buildEntity(doc, 'actor')
    expect(e.Label).toBe('Human Actor')
    expect(e.Fields.Count).toBe(0)
  })
})

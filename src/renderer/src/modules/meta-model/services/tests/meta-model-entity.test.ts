import { describe, it, expect } from 'vitest'
import { MetaModelEntity, MetaModelField } from '../meta-model-entity.js'

describe('MetaModelEntity', () => {
  it('holds identity, attrs, and a live Fields collection', () => {
    const e = new MetaModelEntity()
    e.Id = 'application'; e.TypeOf = 'concept'; e.Label = 'Application'
    e.Attrs = { label: 'Application' }
    const f = new MetaModelField()
    f.Name = 'kind'; f.Type = 'ApplicationKind'; f.Cardinality = 0
    e.Fields.Add(f)

    expect(e.Id).toBe('application')
    expect(e.Label).toBe('Application')
    expect(e.Attrs.label).toBe('Application')
    expect(e.Fields.Count).toBe(1)
    expect(e.Fields.Get(0)!.Name).toBe('kind')
    expect(e.UITemplate).toBeUndefined()
  })
})

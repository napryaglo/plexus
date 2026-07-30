// meta-model-entity-builder.ts — project a MetaModelEntity (identity + own attrs
// + resolved fields) from a parsed model.json. Pure; no I/O. Fields are separate
// Ontology `field` nodes linked to the entity by `HasField` edges — a concept's
// own attrs are often empty, so the fields carry the substance.
import type { TodlDocument } from '@pragmatic-lab/todl'

import { MetaModelEntity, MetaModelField } from './meta-model-entity.js'
import { humanize } from './presentation-generator.js'

const HAS_FIELD = 'HasField'

export function buildEntity(doc: TodlDocument, entityId: string): MetaModelEntity
{
    const node = doc.nodes.find((n) => n.id === entityId)
    const entity = new MetaModelEntity()
    entity.Id = entityId
    entity.TypeOf = node?.typeOf ?? ''
    const attrs = (node?.attrs ?? {}) as Record<string, unknown>
    entity.Attrs = attrs
    entity.Label = typeof attrs['label'] === 'string' ? String(attrs['label']) : humanize(entityId)

    for (const edge of doc.edges)
    {
        if (edge.kind !== HAS_FIELD || edge.from !== entityId) continue
        const fieldNode = doc.nodes.find((n) => n.id === edge.to)
        if (fieldNode === undefined) continue
        const fa = fieldNode.attrs as Record<string, unknown>
        const field = new MetaModelField()
        field.Name = typeof fa['name'] === 'string' ? String(fa['name']) : fieldNode.id
        field.Type = typeof fa['type'] === 'string' ? String(fa['type']) : ''
        field.Cardinality = typeof fa['cardinality'] === 'number' ? (fa['cardinality'] as number) : 0
        entity.Fields.Add(field)
    }
    return entity
}

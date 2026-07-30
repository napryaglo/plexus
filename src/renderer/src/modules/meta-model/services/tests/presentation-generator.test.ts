import { test, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-lab/todl'

import { iconKey, humanize, ontologyEntities, distinctIcons } from '../presentation-generator.js'

function doc(nodes: TodlDocument['nodes']): TodlDocument { return { nodes, edges: [] } }

test('iconKey slugs an icon path to a stable identifier', () => {
    expect(iconKey('resources/actor-internal.svg')).toBe('mm_icon_actor_internal')
    expect(iconKey('resources/sub/role.service.svg')).toBe('mm_icon_role_service')
    expect(iconKey('a.svg')).toBe('mm_icon_a')
})

test('humanize title-cases an id split on - and .', () => {
    expect(humanize('app-component')).toBe('App Component')
    expect(humanize('actor')).toBe('Actor')
    expect(humanize('connector-type-style')).toBe('Connector Type Style')
})

test('ontologyEntities keeps concept/relationship/taxonomy/primitive, drops field + instances', () => {
    const m = doc([
        { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} },
        { id: 'depends-on', tier: 'Ontology', typeOf: 'relationship', attrs: {} },
        { id: 'actor-kind', tier: 'Ontology', typeOf: 'taxonomy', attrs: {} },
        { id: 'text', tier: 'Ontology', typeOf: 'primitive', attrs: {} },
        { id: 'actor.label', tier: 'Ontology', typeOf: 'field', attrs: {} },
        { id: 'actors.internal', tier: 'Instance', typeOf: 'actor', attrs: {} },
    ])
    expect(ontologyEntities(m).map((n) => n.id)).toEqual(['actor', 'depends-on', 'actor-kind', 'text'])
})

test('distinctIcons collects distinct attrs.icon across ALL nodes, sorted', () => {
    const m = doc([
        { id: 'a', tier: 'Instance', typeOf: 'x', attrs: { icon: 'resources/b.svg' } },
        { id: 'b', tier: 'Instance', typeOf: 'x', attrs: { icon: 'resources/a.svg' } },
        { id: 'c', tier: 'Instance', typeOf: 'x', attrs: { icon: 'resources/b.svg' } },   // dup
        { id: 'd', tier: 'Ontology', typeOf: 'concept', attrs: {} },
    ])
    expect(distinctIcons(m)).toEqual(['resources/a.svg', 'resources/b.svg'])
})

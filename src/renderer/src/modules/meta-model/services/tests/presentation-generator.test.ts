import { test, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-lab/todl'

import { iconKey, humanize, ontologyEntities, classEntities, distinctIcons, generatePresentationMu, resolveFacets } from '../presentation-generator.js'

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

test('generatePresentationMu emits includes, one keyed template per ontology entity, and author merges', () => {
    const m = doc([
        { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} },                                          // label-only
        { id: 'gateway', tier: 'Ontology', typeOf: 'concept', attrs: { icon: 'resources/gw.svg', label: 'API Gateway' } }, // icon+label
        { id: 'app.name', tier: 'Ontology', typeOf: 'field', attrs: {} },                                         // excluded
        { id: 'actors.internal', tier: 'Instance', typeOf: 'actor', attrs: { icon: 'resources/int.svg' } },       // icon source only
    ])
    const out = generatePresentationMu(m, ['MetaModelPresentationCustom'])

    // one include per distinct icon (gw + int)
    expect(out).toContain('include "resources/gw.svg" as mm_icon_gw')
    expect(out).toContain('include "resources/int.svg" as mm_icon_int')

    // exactly two entity templates (actor, gateway); the field + instance excluded
    expect(out.match(/DataTemplate x:key="mm:/g)?.length).toBe(2)
    expect(out).toContain('DataTemplate x:key="mm:actor"')
    expect(out).toContain('DataTemplate x:key="mm:gateway"')

    // label: attrs.label wins, else humanized id
    expect(out).toContain('Text = "API Gateway"')
    expect(out).toContain('Text = "Actor"')

    // gateway (has icon) renders an icon Shape; author merge trails
    expect(out).toContain('Geometry = @mm_icon_gw')
    expect(out).toContain('merge MetaModelPresentationCustom')
})

test('generatePresentationMu: no author dicts → no merge line; deterministic', () => {
    const m = doc([{ id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} }])
    const a = generatePresentationMu(m, [])
    const b = generatePresentationMu(m, [])
    expect(a).toBe(b)
    expect(a).not.toContain('merge ')
})

test('generatePresentationMu escapes quotes/backslashes in a label', () => {
    const m = doc([{ id: 'x', tier: 'Ontology', typeOf: 'concept', attrs: { label: 'A "quoted" \\ name' } }])
    expect(generatePresentationMu(m, [])).toContain('Text = "A \\"quoted\\" \\\\ name"')
})

test('resolveFacets: attr wins over annotation for icon and label', () => {
    const node = { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: { icon: 'a.svg', label: 'Attr' } } as unknown as import('@pragmatic-lab/todl').JsonNode
    expect(resolveFacets(node, { icon: { path: 'ann.svg' }, label: { text: 'Ann' } })).toEqual({ icon: 'a.svg', label: 'Attr' })
})

test('resolveFacets: annotation fallback when no attr present', () => {
    const node = { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} } as unknown as import('@pragmatic-lab/todl').JsonNode
    expect(resolveFacets(node, { icon: { path: 'ann.svg' }, label: { text: 'Ann' } })).toEqual({ icon: 'ann.svg', label: 'Ann' })
})

test('resolveFacets: humanize label and no icon when neither present', () => {
    const node = { id: 'app-component', tier: 'Ontology', typeOf: 'concept', attrs: {} } as unknown as import('@pragmatic-lab/todl').JsonNode
    expect(resolveFacets(node, {})).toEqual({ icon: undefined, label: 'App Component' })
})

test('distinctIcons unions attrs.icon and annotation icon-application paths, sorted', () => {
    const m = {
        nodes: [
            { id: 'a', tier: 'Ontology', typeOf: 'concept', attrs: { icon: 'resources/a.svg' } },
            { id: 'b@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/b.svg' } },
            { id: 'b@icon-dup', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/a.svg' } }, // dup
        ],
        edges: [],
    } as unknown as TodlDocument
    expect(distinctIcons(m)).toEqual(['resources/a.svg', 'resources/b.svg'])
})

test('generatePresentationMu bakes annotation-sourced icon/label, attr still wins', () => {
    const m = {
        nodes: [
            { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} },
            { id: 'actor@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/actor.svg' } },
            { id: 'actor@label', tier: 'Ontology', typeOf: 'label', attrs: { text: 'Human Actor' } },
            { id: 'gateway', tier: 'Ontology', typeOf: 'concept', attrs: { icon: 'resources/gw.svg', label: 'API Gateway' } },
            { id: 'gateway@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/ann-gw.svg' } },
        ],
        edges: [
            { kind: 'Annotated', via: null, from: 'actor', to: 'actor@icon' },
            { kind: 'Annotated', via: null, from: 'actor', to: 'actor@label' },
            { kind: 'Annotated', via: null, from: 'gateway', to: 'gateway@icon' },
        ],
    } as unknown as TodlDocument
    const out = generatePresentationMu(m, [])

    // actor: annotation icon + label baked into its template
    expect(out).toContain('include "resources/actor.svg" as mm_icon_actor')
    expect(out).toContain('Geometry = @mm_icon_actor')
    expect(out).toContain('Text = "Human Actor"')

    // gateway: attr wins for both; annotation icon still included by the union
    expect(out).toContain('Geometry = @mm_icon_gw')
    expect(out).toContain('Text = "API Gateway"')
    expect(out).toContain('include "resources/ann-gw.svg" as mm_icon_ann_gw')
})

test('classEntities returns Instance-tier class nodes only', () => {
    const m = doc([
        { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} },
        { id: 'actors.internal', tier: 'Instance', typeOf: 'actor', attrs: { class: true, id: 'internal' } },
        { id: 'web-app', tier: 'Instance', typeOf: 'component', attrs: { class: true, id: 'web-app' } },
        { id: 'storefront', tier: 'Instance', typeOf: 'component', attrs: {} },   // concrete, not a class
    ])
    expect(classEntities(m).map((n) => n.id)).toEqual(['actors.internal', 'web-app'])
})

test('generatePresentationMu emits an mm:<term> template with the term icon annotation', () => {
    const m: TodlDocument = {
        nodes: [
            { id: 'actors', tier: 'Ontology', typeOf: 'taxonomy', attrs: {} },
            { id: 'actors.internal', tier: 'Instance', typeOf: 'actor', attrs: { class: true, id: 'internal', label: 'Internal' } },
            { id: 'actors.internal@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/int.svg' } },
        ],
        edges: [
            { kind: 'Annotated', via: null, from: 'actors.internal', to: 'actors.internal@icon' },
        ],
    }
    const out = generatePresentationMu(m, [])

    expect(out).toContain('include "resources/int.svg" as mm_icon_int')
    expect(out).toContain('DataTemplate x:key="mm:actors.internal"')
    expect(out).toContain('Shape [ Geometry = @mm_icon_int')
})

test('a term without an icon annotation emits a label-only mm:<term> template', () => {
    const m = doc([
        { id: 'actors', tier: 'Ontology', typeOf: 'taxonomy', attrs: {} },
        { id: 'actors.partner', tier: 'Instance', typeOf: 'actor', attrs: { class: true, id: 'partner' } },
    ])
    const out = generatePresentationMu(m, [])
    expect(out).toContain('DataTemplate x:key="mm:actors.partner"')
    // no icon annotation → label-only; label falls back to humanize(full id)
    expect(out).toContain('Actors Partner')
})

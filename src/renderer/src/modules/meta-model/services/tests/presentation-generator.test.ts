import { test, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-lab/todl'

import { iconKey, humanize, ontologyEntities, classEntities, distinctIcons, generatePresentationAssets, isRasterIcon, resolveFacets, assignResourceKeys, resourceKeyFor, stampResourceKeys, buildIconIndex } from '../presentation-generator.js'

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

test('isRasterIcon detects bitmap extensions, not svg', () => {
    expect(isRasterIcon('resources/logo.png')).toBe(true)
    expect(isRasterIcon('resources/logo.JPG')).toBe(true)
    expect(isRasterIcon('resources/a.svg')).toBe(false)
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

test('classEntities returns Instance-tier class nodes only', () => {
    const m = doc([
        { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} },
        { id: 'actors.internal', tier: 'Instance', typeOf: 'actor', attrs: { class: true, id: 'internal' } },
        { id: 'web-app', tier: 'Instance', typeOf: 'component', attrs: { class: true, id: 'web-app' } },
        { id: 'storefront', tier: 'Instance', typeOf: 'component', attrs: {} },   // concrete, not a class
    ])
    expect(classEntities(m).map((n) => n.id)).toEqual(['actors.internal', 'web-app'])
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

// ── generatePresentationAssets — assets-only, no DataTemplates ────────────────

test('generatePresentationAssets emits icon includes only — no DataTemplates, no merges', () => {
    const m = doc([
        { id: 'app-component', tier: 'Ontology', typeOf: 'concept', attrs: { icon: 'resources/comp.svg' } },
        { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: { icon: 'resources/actor.svg' } },
    ])
    const out = generatePresentationAssets(m, 'MetaModelPresentation')
    expect(out).toMatch(/resources MetaModelPresentation \{/)
    expect(out).toContain('include "resources/actor.svg" as mm_icon_actor')
    expect(out).toContain('include "resources/comp.svg" as mm_icon_comp')
    expect(out).toMatch(/Embedded content \(base64\)/) // reserved seam
    expect(out).not.toContain('DataTemplate') // templates are author-owned now
    expect(out).not.toContain('merge ')       // author templates are inlined by the publisher, not merged
    // deterministic: actor include precedes comp include (sorted)
    expect(out.indexOf('mm_icon_actor')).toBeLessThan(out.indexOf('mm_icon_comp'))
})

test('generatePresentationAssets includes annotation-sourced icons', () => {
    const m = {
        nodes: [
            { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} },
            { id: 'actor@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/actor.svg' } },
        ],
        edges: [{ kind: 'Annotated', via: null, from: 'actor', to: 'actor@icon' }],
    } as unknown as TodlDocument
    const out = generatePresentationAssets(m, 'MetaModelPresentation')
    expect(out).toContain('include "resources/actor.svg" as mm_icon_actor')
    expect(out).not.toContain('DataTemplate')
})

test('generatePresentationAssets is deterministic', () => {
    const m = doc([{ id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} }])
    const a = generatePresentationAssets(m, 'LibraryPresentation')
    const b = generatePresentationAssets(m, 'LibraryPresentation')
    expect(a).toBe(b)
    expect(a).toMatch(/resources LibraryPresentation \{/)
})

test('assignResourceKeys gives distinct stems their base iconKey, sorted', () => {
    const m = doc([
        { id: 'a', tier: 'Instance', typeOf: 'x', attrs: { icon: 'resources/comp.svg' } },
        { id: 'b', tier: 'Instance', typeOf: 'x', attrs: { icon: 'resources/actor.svg' } },
    ])
    expect([...assignResourceKeys(m)]).toEqual([
        ['resources/actor.svg', 'mm_icon_actor'],
        ['resources/comp.svg', 'mm_icon_comp'],
    ])
})

test('assignResourceKeys suffixes colliding stems _2, _3 in sorted-path order', () => {
    const m = doc([
        { id: 'a', tier: 'Instance', typeOf: 'x', attrs: { icon: 'a/az.svg' } },
        { id: 'b', tier: 'Instance', typeOf: 'x', attrs: { icon: 'b/az.svg' } },
        { id: 'c', tier: 'Instance', typeOf: 'x', attrs: { icon: 'c/az.svg' } },
        { id: 'd', tier: 'Instance', typeOf: 'x', attrs: { icon: 'x/other.svg' } },
    ])
    const keys = assignResourceKeys(m)
    expect(keys.get('a/az.svg')).toBe('mm_icon_az')
    expect(keys.get('b/az.svg')).toBe('mm_icon_az_2')
    expect(keys.get('c/az.svg')).toBe('mm_icon_az_3')
    expect(keys.get('x/other.svg')).toBe('mm_icon_other')
})

test('resourceKeyFor returns the assigned (possibly suffixed) key', () => {
    const m = doc([
        { id: 'a', tier: 'Instance', typeOf: 'x', attrs: { icon: 'a/az.svg' } },
        { id: 'b', tier: 'Instance', typeOf: 'x', attrs: { icon: 'b/az.svg' } },
    ])
    expect(resourceKeyFor(m, 'a/az.svg')).toBe('mm_icon_az')
    expect(resourceKeyFor(m, 'b/az.svg')).toBe('mm_icon_az_2')
})

test('generatePresentationAssets suffixes colliding icon stems in its includes', () => {
    const m = doc([
        { id: 'a', tier: 'Instance', typeOf: 'x', attrs: { icon: 'a/az.svg' } },
        { id: 'b', tier: 'Instance', typeOf: 'x', attrs: { icon: 'b/az.svg' } },
    ])
    const out = generatePresentationAssets(m, 'MetaModelPresentation')
    expect(out).toContain('include "a/az.svg" as mm_icon_az')
    expect(out).toContain('include "b/az.svg" as mm_icon_az_2')
})

// ── buildIconIndex — entityKey → icon resource key ───────────────────────────

test('buildIconIndex maps each icon-bearing entity to its resource key under the prefix', () => {
    const m = doc([
        { id: 'service', tier: 'Ontology', typeOf: 'concept', attrs: { icon: 'resources/svc.svg' } },
        { id: 'db', tier: 'Instance', typeOf: 'component', attrs: { class: true, icon: 'resources/db.svg' } },
        { id: 'plain', tier: 'Ontology', typeOf: 'concept', attrs: {} },   // no icon → omitted
    ])
    const idx = buildIconIndex(m, 'mm:')
    expect(idx.get('mm:service')).toBe('mm_icon_svc')
    expect(idx.get('mm:db')).toBe('mm_icon_db')
    expect(idx.has('mm:plain')).toBe(false)
})

test('buildIconIndex applies an empty prefix for the library keyspace', () => {
    const m = doc([
        { id: 'service', tier: 'Ontology', typeOf: 'concept', attrs: { icon: 'resources/svc.svg' } },
    ])
    const idx = buildIconIndex(m, '')
    expect(idx.get('service')).toBe('mm_icon_svc')
})

test('stampResourceKeys writes the assigned key onto icon application nodes only', () => {
    const m = {
        nodes: [
            { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} },
            { id: 'actor@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'a/az.svg' } },
            { id: 'comp@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'b/az.svg' } },
            { id: 'raw', tier: 'Instance', typeOf: 'x', attrs: { icon: 'c/other.svg' } }, // raw attr, not an app
        ],
        edges: [],
    } as unknown as TodlDocument
    stampResourceKeys(m)
    const byId = (id: string) => m.nodes.find((n) => n.id === id)!.attrs as Record<string, unknown>
    expect(byId('actor@icon')['key']).toBe('mm_icon_az')
    expect(byId('comp@icon')['key']).toBe('mm_icon_az_2') // collision-aware, shares the assignment
    expect(byId('raw')['key']).toBeUndefined()            // raw attrs.icon node is not stamped
    expect(byId('actor')['key']).toBeUndefined()          // non-icon node untouched
})

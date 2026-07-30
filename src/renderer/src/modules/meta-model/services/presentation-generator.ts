// presentation-generator.ts — pure emitter for a meta-model's presentation
// resource dictionary. No I/O, no mural import; deterministic text only. All
// model/filesystem access lives in the factory that calls this.

import type { TodlDocument, JsonNode } from '@pragmatic-lab/todl'

// The ontology-tier typeOf values presented as first-class entities. `field`
// (concept attributes) is intentionally excluded.
export enum OntologyKind
{
    Concept = 'concept',
    Relationship = 'relationship',
    Taxonomy = 'taxonomy',
    Primitive = 'primitive',
}

const ONTOLOGY_KINDS = new Set<string>(Object.values(OntologyKind))

// Ontology-tier nodes that are presentable entities (concept/relationship/
// taxonomy/primitive), in model order.
export function ontologyEntities(model: TodlDocument): JsonNode[]
{
    return model.nodes.filter((n) => n.tier === 'Ontology' && ONTOLOGY_KINDS.has(n.typeOf))
}

// Distinct `attrs.icon` values across every node (Ontology + Instance), sorted —
// the SVGs the generated dictionary `include`s so they are available as geometry
// resources to generated templates and author templates alike.
export function distinctIcons(model: TodlDocument): string[]
{
    const set = new Set<string>()
    for (const n of model.nodes) {
        const icon = n.attrs['icon']
        if (typeof icon === 'string' && icon.length > 0) set.add(icon)
    }
    return [...set].sort()
}

// "resources/actor-internal.svg" → "mm_icon_actor_internal". Strips the
// directory + extension, lowercases, and replaces every non-identifier run with
// a single '_', so distinct paths yield distinct keys usable as a mural resource
// key (`@mm_icon_…`).
export function iconKey(path: string): string
{
    const stem = path.replace(/^.*\//, '').replace(/\.[^.]+$/, '')
    const slug = stem.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    return `mm_icon_${slug}`
}

// "app-component" → "App Component". Splits on '-'/'.'/'_' and title-cases each
// word. Used as the fallback label when an entity declares no attrs.label.
export function humanize(id: string): string
{
    return id.split(/[-._]/).filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
}

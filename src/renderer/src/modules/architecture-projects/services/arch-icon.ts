import type { Entity, Repository } from '@pragmatic-lab/todl'

// The entity key whose icon a bound canvas node should draw — an id the presentation
// registry's index (registry.iconKeyFor) maps to a baked resource key, the SAME index
// the toolbox tiles resolve through. Returns undefined when nothing carries an icon
// (→ the node falls back to its concept, i.e. the default glyph).
//
// "Has an icon" is detected by the `<id>@icon` annotation node the meta-model/library
// source declares (`annotate icon { path = … }`). We key on the annotation's presence,
// not its publish-time `key` attr: the project loads its bases from SOURCE, where the
// annotation carries only `path` (the `key` is stamped at publish, into the published
// model.json only). The resolver maps the returned id → resource key via the index.
//
// Precedence (design decision): a referenced term wins over the entity's own type. A
// dropped technology term becomes a `component` with `realised_by -> term`, and the
// node should show the term's icon (Front Door), not the bare concept's.
export function iconEntityKey(repo: Repository, entity: Entity): string | undefined
{
    const hasIcon = (id: string): boolean => {
        const path = repo.resolve(`${id}@icon`)?.attrs.get('path')
        return typeof path === 'string' && path.length > 0
    }

    // Referenced term first — in schema relationship order for determinism.
    for (const rel of entity.schema().relationships)
        for (const target of entity.refs(rel.name))
            if (hasIcon(target.id)) return target.id

    // Then the entity's own type/concept.
    const own = entity.type()?.id ?? entity.concept
    return hasIcon(own) ? own : undefined
}

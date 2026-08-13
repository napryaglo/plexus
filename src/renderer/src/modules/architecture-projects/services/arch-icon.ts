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
// Precedence: a referenced term wins over the entity's own type. When SEVERAL
// referenced terms carry icons, the winner is decided by PROPAGATION DIRECTION —
// a term that references another candidate term (its propagation source) outranks
// it — reproducibly from the saved refs, so a dropped technology (which back-fills
// its category) shows the technology icon regardless of schema order. Ties (no
// propagation link) fall back to schema order.
export function iconEntityKey(repo: Repository, entity: Entity): string | undefined
{
    const hasIcon = (id: string): boolean => {
        const path = repo.resolve(`${id}@icon`)?.attrs.get('path')
        return typeof path === 'string' && path.length > 0
    }

    // Filled, icon-bearing referenced terms, in schema relationship order.
    const candidates: string[] = []
    for (const rel of entity.schema().relationships)
        for (const target of entity.refs(rel.name))
            if (hasIcon(target.id)) candidates.push(target.id)

    if (candidates.length === 0) {
        const own = entity.type()?.id ?? entity.concept
        return hasIcon(own) ? own : undefined
    }
    if (candidates.length === 1) return candidates[0]

    // Rank by propagation direction: term A outranks B when A references B.
    const set = new Set(candidates)
    const refsOf = (id: string): Set<string> => {
        const s = new Set<string>()
        for (const [, targets] of repo.effectiveRelationships(id))
            for (const t of targets) s.add(t)
        return s
    }
    const outDegree = (term: string): number => {
        const refs = refsOf(term)
        let n = 0
        for (const other of set) if (other !== term && refs.has(other)) n++
        return n
    }
    // Highest out-degree (most "source") wins; ties keep schema order (first seen).
    let winner = candidates[0]
    let best = outDegree(winner)
    for (const term of candidates.slice(1)) {
        const d = outDegree(term)
        if (d > best) { winner = term; best = d }
    }
    return winner
}

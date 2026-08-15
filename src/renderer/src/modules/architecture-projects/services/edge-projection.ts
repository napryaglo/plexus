import type { Entity, Repository } from '@pragmatic-lab/todl'

// A stable, unique key for a projected connector: one per (from, member, to).
// Multi-member relationships between the same pair yield distinct keys.
export function edgeKey(from: string, member: string, to: string): string {
    return `${from}|${member}|${to}`
}

// The set of desired projected edges for a placed-node set: for each placed
// entity, each relationship member's targets that are ALSO placed and whose
// concept is framed by the scope. Returns `edgeKey` strings.
export function desiredEdges(
    repo: Repository,
    placed: ReadonlyMap<string, Entity>,
    scope: ReadonlySet<string>,
): Set<string> {
    const out = new Set<string>()
    const inScope = (concept: string): boolean =>
        repo.viewpointsFraming(concept).some((v) => scope.has(v))
    for (const [fromId, e] of placed) {
        for (const rel of repo.effectiveSchema(e.concept).relationships) {
            for (const target of e.refs(rel.name)) {
                if (!placed.has(target.id)) continue
                if (!inScope(target.concept)) continue
                out.add(edgeKey(fromId, rel.name, target.id))
            }
        }
    }
    return out
}

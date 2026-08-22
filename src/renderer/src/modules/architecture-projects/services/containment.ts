import { MetaKind, type Entity, type Repository } from '@pragmatic-lab/todl'

// Diagram containment metadata, derived from the meta-model. A containment
// relationship's refs project as visual NESTING (a child node inside a container
// node) instead of a connector; the ref lives on the CONTAINED entity and points
// at its container (`component --in--> location`). Both facts are read from the
// prelude annotations (`@container`, `@containment`) with sensible defaults so a
// meta-model that only names its member `in` needs no annotations at all.

// The default containment member name: a relationship called `in` is containment
// unless annotated otherwise.
export const CONTAINMENT_MEMBER_DEFAULT = 'in'

// A relationship member is a containment member when `<concept>.<member>` carries
// the `@containment` annotation OR (the default) its name is `in`.
export function isContainmentRelationship(repo: Repository, concept: string, member: string): boolean
{
    if (repo.resolve(`${concept}.${member}@containment`) !== undefined) return true
    return member === CONTAINMENT_MEMBER_DEFAULT
}

// Every concept declared in the repo (meta-kind `concept`).
function allConcepts(repo: Repository): string[]
{
    return repo.allNodes().filter((n) => n.typeOf === MetaKind.Concept).map((n) => n.id)
}

// The set of concepts that are the target of some containment relationship
// anywhere in the meta-model — i.e. the concepts that hold children by default.
// Cached per repository (the meta-model is immutable for a binding's lifetime).
const _targetCache = new WeakMap<Repository, Set<string>>()
function containmentTargets(repo: Repository): Set<string>
{
    const cached = _targetCache.get(repo)
    if (cached !== undefined) return cached
    const set = new Set<string>()
    for (const concept of allConcepts(repo))
        for (const rel of repo.effectiveSchema(concept).relationships)
            if (isContainmentRelationship(repo, concept, rel.name))
                for (const t of rel.targets) set.add(t)
    _targetCache.set(repo, set)
    return set
}

// A concept renders as a container when it carries the `@container` annotation OR
// (the default) it is the target of some containment relationship.
export function isContainerConcept(repo: Repository, concept: string): boolean
{
    if (repo.resolve(`${concept}@container`) !== undefined) return true
    return containmentTargets(repo).has(concept)
}

// The container an entity currently sits in: the first placed target of its first
// containment relationship. undefined when it has no containment ref (top level).
export function containmentParentOf(repo: Repository, entity: Entity): Entity | undefined
{
    for (const rel of entity.schema().relationships) {
        if (!isContainmentRelationship(repo, entity.concept, rel.name)) continue
        const targets = entity.refs(rel.name)
        if (targets.length > 0) return targets[0]
    }
    return undefined
}

// The containment member name for a concept — the first containment relationship
// on its schema, or the default `in`. The write-back path uses this to addRef /
// removeRef the right member when a node is nested / un-nested.
export function containmentMemberOf(repo: Repository, concept: string): string
{
    for (const rel of repo.effectiveSchema(concept).relationships)
        if (isContainmentRelationship(repo, concept, rel.name)) return rel.name
    return CONTAINMENT_MEMBER_DEFAULT
}

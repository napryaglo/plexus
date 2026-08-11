import { MetaKind, type Repository } from '@pragmatic-lab/todl'

// What a term-drop can create: a direct instance of a framed concept, or an
// instance of a concept X whose reference member m targets the dropped term's
// type (Phase-3 reference semantics).
export enum DropActionKind { Instance = 'instance', Reference = 'reference' }

export interface DropAction
{
    kind: DropActionKind
    concept: string     // X — the concept to instantiate
    member?: string     // m — reference member (Reference only)
    term?: string       // t — the dropped term id (Reference only)
    label: string       // chooser row text
}

// Candidate drop-actions for a dropped toolbox term. `descriptorKey` is the
// term id (library) or 'mm:'+id (meta-model); `scope` is the diagram's viewpoint
// set (all viewpoints in SP4b). Empty ⇒ reject; one ⇒ auto; many ⇒ chooser.
export function resolveDropActions(repo: Repository, descriptorKey: string, scope: ReadonlySet<string>): DropAction[]
{
    const termId = descriptorKey.startsWith('mm:') ? descriptorKey.slice(3) : descriptorKey
    const node = repo.resolve(termId)
    if (node === undefined) return []

    // C_t: the class it instantiates, else the concept its taxonomy represents, else its own typeOf.
    const ct = repo.classOf(termId) ?? repo.represents(node.typeOf)[0] ?? node.typeOf
    const accept = new Set<string>([ct, ...repo.supertypesOf(ct)])
    const framed = (concept: string): boolean => repo.viewpointsFraming(concept).some((v) => scope.has(v))

    const actions: DropAction[] = []
    if (framed(ct)) actions.push({ kind: DropActionKind.Instance, concept: ct, label: ct })

    for (const n of repo.allNodes()) {
        if (n.typeOf !== MetaKind.Concept) continue
        const x = n.id
        if (!framed(x)) continue
        for (const rel of repo.effectiveSchema(x).relationships) {
            if (rel.targets.some((t) => accept.has(t)))
                actions.push({ kind: DropActionKind.Reference, concept: x, member: rel.name, term: termId, label: `${x}  (${rel.name})` })
        }
    }
    return actions
}

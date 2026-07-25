import type { ArchInstanceModel } from './architecture-instance-model.js'

export interface DropTarget { concept: string; member: string }

// Every (concept, reference-field) pair where the concept has a field whose type
// the dropped term's concept is (or a subtype of). The canvas creates a concept
// instance of `concept` and sets `member = &term`. Concepts are `typeOf==='concept'`
// nodes; schema fields come from the derived repo (which carries the base edges
// that define them). One target ⇒ auto-create; several ⇒ chooser; none ⇒ reject.
export function resolveTermDrop(model: ArchInstanceModel, termId: string): DropTarget[]
{
    const repo = model.repository()
    const termConcept = repo.resolve(termId)?.typeOf
    if (termConcept === undefined) return []
    const compatible = new Set([termConcept, ...repo.supertypesOf(termConcept)])
    const out: DropTarget[] = []
    for (const n of repo.allNodes()) {
        if (n.typeOf !== 'concept') continue
        for (const f of repo.effectiveSchema(n.id).fields) {
            if (compatible.has(f.type)) out.push({ concept: n.id, member: f.name })
        }
    }
    return out
}

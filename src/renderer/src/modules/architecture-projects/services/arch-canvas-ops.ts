import type { ArchInstanceModel } from './architecture-instance-model.js'
import type { ArchDiagramDocument } from './arch-diagram-document.js'
import { resolveTermDrop } from './drop-resolver.js'

// Canvas edit operations expressed as pure functions over the model/document, so
// the drag-drop and connector-created handlers stay thin and the logic is
// unit-tested. Ambiguity (several candidate members) is resolved first-pick in v1;
// the caller surfaces the alternatives.

export type DropResult = { created: string } | { unresolved: true }

// Drop a library term at (x,y): create the concept instance that can reference it
// and wire the reference. Unresolved when no concept has a compatible member.
export function applyTermDrop(doc: ArchDiagramDocument, termId: string, x: number, y: number): DropResult
{
    const targets = resolveTermDrop(doc.Model, termId)
    if (targets.length === 0) return { unresolved: true }
    const t = targets[0]                                  // v1: first-pick; caller may offer a chooser
    const id = doc.Model.createInstance(t.concept)
    doc.Model.addRelationship(id, t.member, termId)
    doc.SetLayout(id, x, y)
    doc.AddNode(id)
    return { created: id }
}

export type ConnectResult = 'ok' | 'ambiguous' | 'none'

// Connect fromId → toId by setting the reference member that links them. 'none'
// when no member's type toId satisfies; 'ambiguous' when several (first is used).
export function applyConnect(model: ArchInstanceModel, fromId: string, toId: string): ConnectResult
{
    const members = model.referenceMembers(fromId, toId)
    if (members.length === 0) return 'none'
    model.addRelationship(fromId, members[0].name, toId)
    return members.length === 1 ? 'ok' : 'ambiguous'
}

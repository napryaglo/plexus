// annotation-projection.ts — project a target node's annotations from a compiled
// model.json. Walk the `Annotated` edges out of `targetId` to its `<target>@<Ann>`
// application nodes; key each by the application's `typeOf` (the annotation name);
// value = the application's scalar param attrs with the `namespace` provenance
// stamp removed. A target with no annotations → {}. Pure; no I/O. Shared by the
// concept path (buildEntity) and the package path (publish's manifest write).
import type { TodlDocument } from '@pragmatic-lab/todl'

const ANNOTATED = 'Annotated'
const NAMESPACE_ATTR = 'namespace'

export function projectAnnotations(
    doc: TodlDocument,
    targetId: string,
): Record<string, Record<string, unknown>>
{
    const out: Record<string, Record<string, unknown>> = {}
    for (const edge of doc.edges) {
        if (edge.kind !== ANNOTATED || edge.from !== targetId) continue
        const appNode = doc.nodes.find((n) => n.id === edge.to)
        if (appNode === undefined) continue
        const params: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(appNode.attrs as Record<string, unknown>)) {
            if (k === NAMESPACE_ATTR) continue
            params[k] = v
        }
        out[appNode.typeOf] = params
    }
    return out
}

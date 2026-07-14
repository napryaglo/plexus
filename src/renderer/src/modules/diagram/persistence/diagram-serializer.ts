import { ConnectorEndpoint, type DiagramDocument, PortSide } from '@pragmatic-lab/mural/framework'

// Serializes a DiagramDocument to/from a plain JSON `.diagram` file.
//
// The read direction (serialize) is pure and structural — it works against
// small interfaces the real Figure / Connector satisfy — so it unit-tests
// without the mural runtime. The write direction (build) reaches the real
// DiagramDocument's CreateNode / CreateConnector and is exercised in-app.
//
// v1 captures a node's kind + top-left position + stable id, and a connector's
// endpoint ids + optional cardinal port sides — enough to round-trip the
// editor's shapes-and-connectors scene. Text / style / size are template-
// derived and deferred.

export interface SerializedNode { id: string; kind: string; left: number; top: number }
export interface SerializedConnector { from: string; to: string; sourceSide?: string; targetSide?: string }
export interface SerializedDiagram
{
    version:    1
    title:      string
    nodes:      SerializedNode[]
    connectors: SerializedConnector[]
}

// A diagram node as serialization sees it — mural's Figure satisfies this. A
// Group (no Kind) is skipped.
interface NodeLike { Id?: string; Kind?: string; Left?: number; Top?: number }
interface EndpointLike { Node?: unknown; PortSide?: string }
interface ConnectorLike { Source?: EndpointLike; Target?: EndpointLike }

const CURRENT_VERSION = 1 as const

// Extract a serializable snapshot from a document's node/connector arrays.
// Figures missing an Id are assigned one (persisted back, so identity is stable
// across saves and matches the layout adapter's scheme). Only figures (those
// carrying Kind/Left/Top) become nodes; a connector becomes an entry only when
// both endpoint figures resolve.
export function serializeDiagram(
    title: string,
    nodes: readonly NodeLike[],
    connectors: readonly ConnectorLike[],
    idGen: (i: number) => string = (i) => `n${i}`,
): SerializedDiagram
{
    const idOf = new Map<object, string>()
    const outNodes: SerializedNode[] = []

    nodes.forEach((n, i) => {
        if (typeof n.Kind !== 'string') return   // skip Groups / non-figures
        if (n.Id === undefined || n.Id === '') n.Id = idGen(i)
        idOf.set(n as object, n.Id)
        outNodes.push({ id: n.Id, kind: n.Kind, left: n.Left ?? 0, top: n.Top ?? 0 })
    })

    const outConnectors: SerializedConnector[] = []
    for (const c of connectors) {
        const from = c.Source?.Node ? idOf.get(c.Source.Node as object) : undefined
        const to   = c.Target?.Node ? idOf.get(c.Target.Node as object) : undefined
        if (from === undefined || to === undefined) continue
        const entry: SerializedConnector = { from, to }
        if (c.Source?.PortSide) entry.sourceSide = c.Source.PortSide
        if (c.Target?.PortSide) entry.targetSide = c.Target.PortSide
        outConnectors.push(entry)
    }

    return { version: CURRENT_VERSION, title, nodes: outNodes, connectors: outConnectors }
}

// Serialize a live DiagramDocument to a pretty JSON string.
export function serializeToText(doc: DiagramDocument): string
{
    const nodes = doc.Nodes.ToArray() as unknown as NodeLike[]
    const connectors = doc.Connectors.ToArray() as unknown as ConnectorLike[]
    return JSON.stringify(serializeDiagram(doc.Title, nodes, connectors), null, 2)
}

// Parse + validate a `.diagram` file's text. Throws on malformed input or an
// unsupported version, so a bad file surfaces as an error rather than a
// silently-empty document.
export function parseDiagram(text: string): SerializedDiagram
{
    let raw: unknown
    try { raw = JSON.parse(text) } catch (e) { throw new Error(`Not a valid .diagram file: ${(e as Error).message}`) }
    const obj = raw as Partial<SerializedDiagram>
    if (obj === null || typeof obj !== 'object') throw new Error('Not a valid .diagram file: expected an object.')
    if (obj.version !== CURRENT_VERSION) throw new Error(`Unsupported .diagram version: ${String(obj.version)} (expected ${CURRENT_VERSION}).`)
    if (!Array.isArray(obj.nodes) || !Array.isArray(obj.connectors)) throw new Error('Malformed .diagram file: missing nodes/connectors.')
    return {
        version:    CURRENT_VERSION,
        title:      typeof obj.title === 'string' ? obj.title : 'Untitled Diagram',
        nodes:      obj.nodes as SerializedNode[],
        connectors: obj.connectors as SerializedConnector[],
    }
}

// Rebuild a document's scene from parsed data. Clears is out of scope — build
// into a fresh DiagramDocument. Node ids are restored so connectors relink;
// port sides restore when they name a valid cardinal.
export function buildIntoDocument(doc: DiagramDocument, data: SerializedDiagram): void
{
    doc.Title = data.title
    const byId = new Map<string, NodeLike>()
    for (const n of data.nodes) {
        const fig = doc.CreateNode(n.kind, n.left, n.top) as unknown as NodeLike | null
        if (fig === null) continue
        fig.Id = n.id
        byId.set(n.id, fig)
    }
    for (const c of data.connectors) {
        const src = byId.get(c.from)
        const tgt = byId.get(c.to)
        if (src === undefined || tgt === undefined) continue
        doc.CreateConnector(
            new ConnectorEndpoint({ Node: src as never, PortSide: toPortSide(c.sourceSide) }),
            new ConnectorEndpoint({ Node: tgt as never, PortSide: toPortSide(c.targetSide) }),
        )
    }
}

// Map a serialized side string ('N'|'S'|'E'|'W') back to the PortSide enum, or
// undefined when absent/unknown (the diagram then auto-picks a side).
function toPortSide(side: string | undefined): PortSide | undefined
{
    switch (side) {
        case 'N': return PortSide.N
        case 'S': return PortSide.S
        case 'E': return PortSide.E
        case 'W': return PortSide.W
        default:  return undefined
    }
}

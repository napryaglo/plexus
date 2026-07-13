import { Graph } from '@pragmatic-lab/fresco'

// A layout position from Fresco. Fresco's Point (X/Y) satisfies this;
// declared locally so the adapter's tests don't need mural's Point.
export interface PointLike { X: number; Y: number }

// Diagram <-> Fresco Graph adapter.
//
// Pure logic, deliberately decoupled from the mural framework: it works
// against small structural interfaces that the real mural Figure and
// Connector satisfy (Figure has Id/Left/Top; Connector has Source/Target
// with a .Node reference). This keeps the risk surface — identity
// mapping, coordinate conversion, drop diffing — unit-testable without
// the Electron/mural runtime.

// A diagram node, as far as layout cares. mural's Figure satisfies this.
export interface FigureLike
{
    Id:   string | undefined
    Left: number
    Top:  number
}

// A diagram connector. mural's Connector satisfies this (Source/Target
// are ConnectorEndpoint, whose .Node points at the endpoint figure).
export interface ConnectorLike
{
    Source?: { Node?: unknown }
    Target?: { Node?: unknown }
}

export interface ExtractResult
{
    graph: Graph
    index: Map<string, FigureLike>
}

// Builds a Fresco Graph from the diagram's figures and connectors.
// Figures missing an Id are assigned one (persisted back onto the figure
// so identity is stable across re-runs). `index` maps each id to its
// figure for writing positions back. A connector becomes an edge only
// when both endpoint figures resolve.
export function extract(
    nodes: FigureLike[],
    connectors: ConnectorLike[],
    idGen: (i: number) => string = (i) => `n${i}`,
): ExtractResult
{
    const graph = new Graph()
    const index = new Map<string, FigureLike>()
    const idOf = new Map<object, string>()

    nodes.forEach((fig, i) => {
        if (fig.Id === undefined || fig.Id === '') fig.Id = idGen(i)
        index.set(fig.Id, fig)
        idOf.set(fig as object, fig.Id)
        graph.AddNode(fig.Id)
    })

    for (const conn of connectors) {
        const from = conn.Source?.Node ? idOf.get(conn.Source.Node as object) : undefined
        const to   = conn.Target?.Node ? idOf.get(conn.Target.Node as object) : undefined
        if (from !== undefined && to !== undefined) graph.AddEdge(from, to)
    }

    return { graph, index }
}

export interface NodeSize { width: number; height: number }

// A resolved top-left position to write onto a figure.
export interface PositionSet { id: string; left: number; top: number }

// The result of running a layout: where each surviving node should go
// (as top-left corners) and which original nodes the transforms dropped.
export interface LayoutOutcome
{
    setPositions:  PositionSet[]
    droppedNodeIds: string[]
}

// Turns Fresco layout output into a diagram-space outcome.
//
// Fresco positions are node *centers*; mural figures are placed by their
// top-left corner (Left/Top), so each center is shifted by half the
// figure's size. `droppedNodeIds` are ids present before layout (in the
// index) but absent from the transformed graph — i.e. removed by a graph
// transform such as DropIsolatedNodes / FilterNodes.
export function computeOutcome(
    index: Map<string, FigureLike>,
    transformed: Graph,
    positions: Map<string, PointLike>,
    sizeOf: (fig: FigureLike) => NodeSize,
): LayoutOutcome
{
    const surviving = new Set(transformed.nodes.map((n) => n.Id))

    const setPositions: PositionSet[] = []
    for (const [id, pt] of positions) {
        const fig = index.get(id)
        if (!fig) continue
        const { width, height } = sizeOf(fig)
        setPositions.push({ id, left: pt.X - width / 2, top: pt.Y - height / 2 })
    }

    const droppedNodeIds = [...index.keys()].filter((id) => !surviving.has(id))
    return { setPositions, droppedNodeIds }
}

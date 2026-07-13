import { Graph } from '@pragmatic-lab/fresco'

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

import { type Connector, type ConnectorEndpoint, type DiagramDocument, PortSide } from '@pragmatic-tech-ai/mural/framework'
import { Point } from '@pragmatic-tech-ai/mural/runtime'

// Bug 1: an architecture connector is MODEL-DERIVED (IsDerived), so mural's
// .diagram serializer skips it — the model stores only from/to, with nowhere for
// the connector's PRESENTATION (pinned route waypoints, routing mode, pinned port
// sides) to live. Result: a manual route/port choice was lost on reopen because
// the connector re-derived with default routing.
//
// We persist that presentation in the document's opaque Metadata (the same
// travels-with-the-.diagram mechanism scenarios/viewpoints use), keyed by the
// connector's stable model EDGE KEY, and re-apply it when the binding projects the
// connector. Only user-meaningful bits are stored: PINNED (userAltered) waypoints,
// an explicit routing mode, and pinned port sides/indices — router-derived values
// (undefined) are left out so the router still owns the auto layout.
export const ARCH_CONNECTOR_VISUALS_KEY = 'arch.connectorVisuals'

interface EndpointVisual { portSide?: PortSide; portIndex?: number }
export interface ConnectorVisual
{
    waypoints?: Array<{ x: number; y: number; userAltered: boolean }>
    routingMode?: string
    source?: EndpointVisual
    target?: EndpointVisual
}

// The full edgeKey → visual map recorded on the document ({} when absent/invalid).
export function readConnectorVisuals(doc: DiagramDocument): Record<string, ConnectorVisual>
{
    const raw = doc.Metadata[ARCH_CONNECTOR_VISUALS_KEY]
    return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? raw as Record<string, ConnectorVisual>
        : {}
}

// Merge one connector's visual into the document metadata (or drop the key when
// the visual carries nothing user-meaningful). The caller persists by saving the
// document — this only updates the in-memory bag that the .diagram serializer reads.
export function writeConnectorVisual(doc: DiagramDocument, key: string, v: ConnectorVisual): void
{
    const all = { ...readConnectorVisuals(doc) }
    if (isEmptyVisual(v)) delete all[key]
    else all[key] = v
    doc.Metadata = { ...doc.Metadata, [ARCH_CONNECTOR_VISUALS_KEY]: all }
}

function endpointEmpty(e: EndpointVisual | undefined): boolean
{
    return e === undefined || (e.portSide === undefined && e.portIndex === undefined)
}
function isEmptyVisual(v: ConnectorVisual): boolean
{
    return (v.waypoints === undefined || v.waypoints.length === 0)
        && v.routingMode === undefined
        && endpointEmpty(v.source) && endpointEmpty(v.target)
}

// Read a connector's CURRENT presentation into a ConnectorVisual — only pinned
// waypoints and pinned port sides (router-derived state is omitted).
export function captureConnectorVisual(c: Connector): ConnectorVisual
{
    const wps = (c.Waypoints ?? [])
        .filter((w) => w.userAltered)
        .map((w) => ({ x: w.point.X, y: w.point.Y, userAltered: true }))
    const ep = (e: ConnectorEndpoint | undefined): EndpointVisual | undefined => {
        if (e === undefined) return undefined
        const out: EndpointVisual = {}
        if (e.PortSide !== undefined) out.portSide = e.PortSide
        if (e.PortIndex !== undefined) out.portIndex = e.PortIndex
        return endpointEmpty(out) ? undefined : out
    }
    const v: ConnectorVisual = {}
    if (wps.length > 0) v.waypoints = wps
    if (c.RoutingMode !== undefined && c.RoutingMode !== '') v.routingMode = c.RoutingMode
    const s = ep(c.Source); if (s !== undefined) v.source = s
    const t = ep(c.Target); if (t !== undefined) v.target = t
    return v
}

// Apply a saved visual onto a freshly-projected connector (before the listeners
// that capture edits are wired, so this restore doesn't echo back).
export function applyConnectorVisual(c: Connector, v: ConnectorVisual): void
{
    if (v.waypoints !== undefined && v.waypoints.length > 0)
        c.Waypoints = v.waypoints.map((w) => ({ point: new Point(w.x, w.y), userAltered: w.userAltered }))
    if (v.routingMode !== undefined) c.RoutingMode = v.routingMode
    if (v.source !== undefined && c.Source !== undefined) {
        if (v.source.portSide !== undefined) c.Source.PortSide = v.source.portSide
        if (v.source.portIndex !== undefined) c.Source.PortIndex = v.source.portIndex
    }
    if (v.target !== undefined && c.Target !== undefined) {
        if (v.target.portSide !== undefined) c.Target.PortSide = v.target.portSide
        if (v.target.portIndex !== undefined) c.Target.PortIndex = v.target.portIndex
    }
}

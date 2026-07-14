import { test, expect } from 'vitest'

import { serializeDiagram, parseDiagram, type SerializedDiagram } from '../diagram-serializer.js'

// Minimal fakes satisfying the serializer's structural node/connector shapes.
function node(id: string | undefined, kind: string, left: number, top: number) {
    return { Id: id as string | undefined, Kind: kind, Left: left, Top: top }
}

test('serializes figures with kind + top-left position', () => {
    const a = node('a', 'rectangle', 10, 20)
    const b = node('b', 'ellipse', 30, 40)
    const out = serializeDiagram('My Diagram', [a, b], [])
    expect(out.version).toBe(1)
    expect(out.title).toBe('My Diagram')
    expect(out.nodes).toEqual([
        { id: 'a', kind: 'rectangle', left: 10, top: 20 },
        { id: 'b', kind: 'ellipse', left: 30, top: 40 },
    ])
})

test('assigns and persists ids to figures missing one', () => {
    const a = node(undefined, 'rectangle', 0, 0)
    const out = serializeDiagram('t', [a], [])
    expect(a.Id).toBe('n0')                 // written back onto the figure
    expect(out.nodes[0].id).toBe('n0')
})

test('skips non-figure nodes (Groups have no Kind)', () => {
    const group = { Id: 'g', Left: 0, Top: 0 } as { Id?: string; Kind?: string; Left?: number; Top?: number }
    const fig = node('a', 'rectangle', 0, 0)
    const out = serializeDiagram('t', [group, fig], [])
    expect(out.nodes.map((n) => n.id)).toEqual(['a'])
})

test('serializes a connector by endpoint node ids, carrying port sides', () => {
    const a = node('a', 'rectangle', 0, 0)
    const b = node('b', 'ellipse', 100, 0)
    const conn = { Source: { Node: a, PortSide: 'S' }, Target: { Node: b, PortSide: 'N' } }
    const out = serializeDiagram('t', [a, b], [conn])
    expect(out.connectors).toEqual([{ from: 'a', to: 'b', sourceSide: 'S', targetSide: 'N' }])
})

test('drops connectors with an unresolved endpoint', () => {
    const a = node('a', 'rectangle', 0, 0)
    const conn = { Source: { Node: a }, Target: { Node: undefined } }
    const out = serializeDiagram('t', [a], [conn])
    expect(out.connectors).toEqual([])
})

test('round-trips through JSON text', () => {
    const a = node('a', 'rectangle', 5, 5)
    const b = node('b', 'heart', 50, 5)
    const conn = { Source: { Node: a }, Target: { Node: b } }
    const original = serializeDiagram('Round Trip', [a, b], [conn])
    const parsed = parseDiagram(JSON.stringify(original))
    expect(parsed).toEqual(original)
})

test('parseDiagram rejects an unsupported version', () => {
    expect(() => parseDiagram(JSON.stringify({ version: 99, title: 't', nodes: [], connectors: [] }))).toThrow(/version/)
})

test('parseDiagram rejects malformed JSON', () => {
    expect(() => parseDiagram('{ not json')).toThrow(/valid .diagram/)
})

test('parseDiagram defaults a missing title', () => {
    const data = { version: 1, nodes: [], connectors: [] } as unknown as SerializedDiagram
    expect(parseDiagram(JSON.stringify(data)).title).toBe('Untitled Diagram')
})

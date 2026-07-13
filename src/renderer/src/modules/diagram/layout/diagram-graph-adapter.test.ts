import { test, expect } from 'vitest'

import { extract } from './diagram-graph-adapter.js'

test('extract assigns stable ids to figures missing one and indexes them', () => {
    const a = { Id: undefined as string | undefined, Left: 0, Top: 0 }
    const b = { Id: 'kept', Left: 0, Top: 0 }
    const { graph, index } = extract([a, b], [])
    expect(a.Id).toBe('n0')            // assigned + persisted onto the figure
    expect(index.get('n0')).toBe(a)
    expect(index.get('kept')).toBe(b)
    expect(graph.nodes.map((n) => n.Id).sort()).toEqual(['kept', 'n0'])
})

test('extract builds edges from connector endpoint node references', () => {
    const a = { Id: 'a', Left: 0, Top: 0 }
    const b = { Id: 'b', Left: 0, Top: 0 }
    const conn = { Source: { Node: a }, Target: { Node: b } }
    const { graph } = extract([a, b], [conn])
    expect(graph.edges.map((e) => [e.From, e.To])).toEqual([['a', 'b']])
})

test('extract skips connectors with an unresolved endpoint', () => {
    const a = { Id: 'a', Left: 0, Top: 0 }
    const conn = { Source: { Node: a }, Target: { Node: undefined } }
    const { graph } = extract([a], [conn])
    expect(graph.edges.length).toBe(0)
})

test('extract skips connectors whose endpoint figure is not in the node set', () => {
    const a = { Id: 'a', Left: 0, Top: 0 }
    const stray = { Id: 'x', Left: 0, Top: 0 }   // not passed to extract
    const conn = { Source: { Node: a }, Target: { Node: stray } }
    const { graph } = extract([a], [conn])
    expect(graph.edges.length).toBe(0)
})

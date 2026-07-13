import { test, expect } from 'vitest'
import { Graph } from '@pragmatic-lab/fresco'

import { extract, computeOutcome } from './diagram-graph-adapter.js'

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

test('computeOutcome converts center points to top-left using node size', () => {
    const a = { Id: 'a', Left: 0, Top: 0 }
    const index = new Map([['a', a]])
    const transformed = new Graph(); transformed.AddNode('a')
    const positions = new Map([['a', { X: 100, Y: 50 }]])
    const outcome = computeOutcome(index, transformed, positions, () => ({ width: 40, height: 20 }))
    expect(outcome.setPositions).toEqual([{ id: 'a', left: 80, top: 40 }])
    expect(outcome.droppedNodeIds).toEqual([])
})

test('computeOutcome reports nodes dropped by transforms', () => {
    const a = { Id: 'a', Left: 0, Top: 0 }
    const b = { Id: 'b', Left: 0, Top: 0 }
    const index = new Map([['a', a], ['b', b]])
    const transformed = new Graph(); transformed.AddNode('a')   // b removed
    const positions = new Map([['a', { X: 10, Y: 10 }]])
    const outcome = computeOutcome(index, transformed, positions, () => ({ width: 0, height: 0 }))
    expect(outcome.droppedNodeIds).toEqual(['b'])
})

test('computeOutcome skips positions for ids not in the index', () => {
    const a = { Id: 'a', Left: 0, Top: 0 }
    const index = new Map([['a', a]])
    const transformed = new Graph(); transformed.AddNode('a'); transformed.AddNode('dummy')
    const positions = new Map([['a', { X: 0, Y: 0 }], ['dummy', { X: 5, Y: 5 }]])
    const outcome = computeOutcome(index, transformed, positions, () => ({ width: 0, height: 0 }))
    expect(outcome.setPositions.map((p) => p.id)).toEqual(['a'])
})

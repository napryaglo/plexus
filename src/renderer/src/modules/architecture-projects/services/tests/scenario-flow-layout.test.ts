import { describe, it, expect } from 'vitest'
import { layoutColumns, planScenarioDrop, type FlowEntity } from '../scenario-flow.js'

function ent(id: string, rels: Record<string, FlowEntity[]> = {}): FlowEntity {
  return { id, refs: (m) => rels[m] ?? [] }
}
function step(src: FlowEntity, dst: FlowEntity): FlowEntity {
  return ent('step', { src: [src], dst: [dst] })
}

describe('layoutColumns', () => {
  it('assigns longest-path columns for a diamond', () => {
    const col = layoutColumns(['a', 'b', 'c', 'd'], [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']])
    expect(col.get('a')).toBe(0)
    expect(col.get('b')).toBe(1)
    expect(col.get('c')).toBe(1)
    expect(col.get('d')).toBe(2)
  })

  it('breaks cycles so columns stay finite', () => {
    const col = layoutColumns(['a', 'b', 'c'], [['a', 'b'], ['b', 'c'], ['c', 'a']])
    expect(col.get('a')).toBe(0)
    expect(col.get('b')).toBe(1)
    expect(col.get('c')).toBe(2)   // back-edge c->a dropped from layering
  })
})

describe('planScenarioDrop', () => {
  const a = ent('a'), b = ent('b'), c = ent('c')
  const scenario = ent('sc', { sequences: [ent('s', { steps: [step(a, b), step(b, c)] })] })

  it('positions new nodes on the flow grid from the drop origin', () => {
    const plan = planScenarioDrop(scenario, new Set(), { x: 100, y: 50 }, { colDx: 200, rowDy: 120 })
    const byId = new Map(plan.nodes.map((n) => [n.id, n]))
    expect(byId.get('a')).toMatchObject({ left: 100, top: 50, isNew: true })   // col 0, row 0
    expect(byId.get('b')).toMatchObject({ left: 300, isNew: true })            // col 1
    expect(byId.get('c')).toMatchObject({ left: 500, isNew: true })            // col 2
    expect(plan.edges).toEqual([['a', 'b'], ['b', 'c']])
  })

  it('marks already-placed participants as not new', () => {
    const plan = planScenarioDrop(scenario, new Set(['a']), { x: 0, y: 0 })
    expect(plan.nodes.find((n) => n.id === 'a')!.isNew).toBe(false)
    expect(plan.nodes.find((n) => n.id === 'b')!.isNew).toBe(true)
  })
})

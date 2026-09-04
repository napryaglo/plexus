import { test, expect } from 'vitest'
import { Visibility } from '@pragmatic-tech-ai/mural/runtime'
import { unionOfNodeBounds, paintVisualTree, renderDiagramSvg } from '../diagram-svg-renderer.js'

// Minimal duck-typed Visual: paintVisualTree/renderDiagramSvg only read these
// public members, never anything that reparents (no SetTarget/set Content) — the
// regression this guards is passing a live, already-attached visual to a
// HeadlessTarget, which threw "Visual is already attached to a host".
function fakeVisual(
  rect: { X: number; Y: number },
  children: unknown[] = [],
  opts: { visible?: boolean; render?: () => void } = {},
): unknown {
  return {
    Visibility: opts.visible === false ? Visibility.Collapsed : Visibility.Visible,
    ArrangedRect: rect,
    Clip: undefined,
    ChildClip: undefined,
    visualChildren: children,
    Render: opts.render ?? ((): void => {}),
  }
}

// Rect field names verified against:
//   node_modules/@pragmatic-tech-ai/mural/dist/visual-engine/primitives.d.ts
// Constructor signature: new Rect(X, Y, Width, Height)
// Properties: .X, .Y, .Width, .Height (also exposes .Left/.Top/.Right/.Bottom as aliases)

test('unionOfNodeBounds unions Left/Top/BaseWidth/BaseHeight', () => {
  const nodes = [
    { Left: 10, Top: 10, BaseWidth: 20, BaseHeight: 20 }, // → (10,10)-(30,30)
    { Left: 40, Top: 5,  BaseWidth: 10, BaseHeight: 50 }, // → (40,5)-(50,55)
  ]
  const r = unionOfNodeBounds(nodes as never)
  expect(r.X).toBe(10);    expect(r.Y).toBe(5)
  expect(r.Width).toBe(40); expect(r.Height).toBe(50) // 50-10, 55-5
})

test('unionOfNodeBounds of empty is a zero rect', () => {
  const r = unionOfNodeBounds([] as never)
  expect(r.Width).toBe(0); expect(r.Height).toBe(0)
})

test('paintVisualTree walks children in place: translate around offset visuals, render each', () => {
  const calls: string[] = []
  const dc = {
    PushTransform: (): number => calls.push('pushT'),
    PushClip:      (): number => calls.push('pushC'),
    Pop:           (): number => calls.push('pop'),
  }
  const leaf = fakeVisual({ X: 10, Y: 10 }, [], { render: () => { calls.push('render:leaf') } })
  const root = fakeVisual({ X: 0, Y: 0 }, [leaf], { render: () => { calls.push('render:root') } })

  paintVisualTree(root as never, dc as never)

  // root at (0,0) → no translate; leaf at (10,10) → translate push/pop around it.
  expect(calls).toEqual(['render:root', 'pushT', 'render:leaf', 'pop'])
})

test('paintVisualTree skips collapsed visuals (and their subtree)', () => {
  const calls: string[] = []
  const dc = { PushTransform: (): void => {}, PushClip: (): void => {}, Pop: (): void => {} }
  const hiddenChild = fakeVisual({ X: 1, Y: 1 }, [], { render: () => { calls.push('render:hiddenChild') } })
  const hidden = fakeVisual({ X: 0, Y: 0 }, [hiddenChild], { visible: false, render: () => { calls.push('render:hidden') } })

  paintVisualTree(hidden as never, dc as never)

  expect(calls).toEqual([]) // nothing painted — the collapsed root short-circuits
})

test('renderDiagramSvg renders a live (attached-style) tree to <svg> without reparenting', () => {
  // A panel that would be "already attached" in the real app: a plain visual with
  // no host. paintVisualTree never reparents it, so this completes.
  const panel = fakeVisual({ X: 0, Y: 0 }, [fakeVisual({ X: 10, Y: 10 }, [])])
  const diagram = { SelectionCount: 0, ItemsPanelInstance: panel }
  const doc = {
    ActiveView: diagram,
    Nodes: [{ Left: 0, Top: 0, BaseWidth: 120, BaseHeight: 90 }],
  }

  const { svg, width, height } = renderDiagramSvg(doc as never)

  expect(svg.startsWith('<svg')).toBe(true)
  expect(width).toBe(120)
  expect(height).toBe(90)
})

test('renderDiagramSvg uses selection bounds when items are selected', () => {
  const panel = fakeVisual({ X: 0, Y: 0 }, [])
  const diagram = {
    SelectionCount: 2,
    SelectionLeft: 5, SelectionTop: 5, SelectionWidth: 40, SelectionHeight: 30,
    ItemsPanelInstance: panel,
  }
  const doc = { ActiveView: diagram, Nodes: [{ Left: 0, Top: 0, BaseWidth: 999, BaseHeight: 999 }] }

  const { width, height } = renderDiagramSvg(doc as never)

  expect(width).toBe(40) // selection wins over the full-node union
  expect(height).toBe(30)
})

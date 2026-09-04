import { test, expect } from 'vitest'
import { unionOfNodeBounds } from '../diagram-svg-renderer.js'

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

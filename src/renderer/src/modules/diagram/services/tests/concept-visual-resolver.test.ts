import { describe, it, expect } from 'vitest'
import type { Visual } from '@pragmatic-lab/mural/runtime'
import { VisualContext, ToolboxVisualDescriptor } from '@pragmatic-lab/mural/framework'
import { ConceptVisualResolver } from '../concept-visual-resolver.js'

const SVG = '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>'

function hasText(v: Visual): boolean {
  if (v.constructor.name === 'TextBlock') return true
  for (const c of [...v.logicalChildren, ...v.visualChildren]) if (hasText(c)) return true
  return false
}

describe('ConceptVisualResolver', () => {
  it('builds a visual from a registered icon and a default box otherwise', () => {
    const r = new ConceptVisualResolver()
    r.Register('actors.internal', SVG)
    const withIcon = r.Resolve(new ToolboxVisualDescriptor({} as never, 'actors.internal'), VisualContext.Tile)
    const withoutIcon = r.Resolve(new ToolboxVisualDescriptor({} as never, 'actors.unknown'), VisualContext.Tile)
    expect(withIcon).toBeDefined()
    expect(withoutIcon).toBeDefined()
    expect(withIcon).not.toBe(withoutIcon)
  })

  it('resolves figure-only visuals: neither the icon nor the default box carries a label', () => {
    const r = new ConceptVisualResolver()
    r.Register('actors.internal', SVG)
    const withIcon = r.Resolve(new ToolboxVisualDescriptor({} as never, 'actors.internal'), VisualContext.Tile)
    const withoutIcon = r.Resolve(new ToolboxVisualDescriptor({} as never, 'actors.unknown'), VisualContext.Tile)
    expect(hasText(withIcon)).toBe(false)
    expect(hasText(withoutIcon)).toBe(false)
  })

  it('is ready-now: listeners are no-ops', () => {
    const r = new ConceptVisualResolver()
    let fired = 0
    const cb = () => { fired++ }
    r.AddChangedListener(cb)
    r.RemoveChangedListener(cb)
    expect(fired).toBe(0)
  })
})

import { describe, it, expect } from 'vitest'
import { VisualContext, ToolboxVisualDescriptor } from '@pragmatic-lab/mural/framework'
import { ConceptVisualResolver } from '../concept-visual-resolver.js'

const SVG = '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>'

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

  it('is ready-now: listeners are no-ops', () => {
    const r = new ConceptVisualResolver()
    let fired = 0
    const cb = () => { fired++ }
    r.AddChangedListener(cb)
    r.RemoveChangedListener(cb)
    expect(fired).toBe(0)
  })
})

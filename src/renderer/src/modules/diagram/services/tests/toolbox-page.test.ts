import { describe, it, expect } from 'vitest'
import { ToolboxPage, ToolboxPageKind, TermTile } from '../toolbox-page.js'
import { DataTemplate } from '@pragmatic-lab/mural/basic'

describe('ToolboxPage', () => {
  it('carries a title, kind, and a live Items collection', () => {
    const p = new ToolboxPage('Actors', ToolboxPageKind.Taxonomy)
    expect(p.Title).toBe('Actors')
    expect(p.Kind).toBe(ToolboxPageKind.Taxonomy)
    const tile = new TermTile('actors.internal', 'Internal', 'actor', new DataTemplate(() => undefined as never))
    p.Items.Add(tile)
    expect(p.Items.Count).toBe(1)
  })

  it('TermTile drag payload carries the term id under the node-kind format', () => {
    const tile = new TermTile('actors.internal', 'Internal', 'actor', new DataTemplate(() => undefined as never))
    const payload = tile.BeginKindDragData!()
    expect(payload.data.Get('@pragmatic-lab/mural/node-kind')).toBe('actors.internal')  // TOOLBOX_NODE_KIND_FORMAT value
  })
})

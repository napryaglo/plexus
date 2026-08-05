import { describe, test, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-lab/todl'

import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { scaffoldAuthorStubs, META_MODEL_ROLE, LIBRARY_ROLE } from '../presentation-scaffold.js'

function doc(nodes: TodlDocument['nodes']): TodlDocument { return { nodes, edges: [] } }

describe('scaffoldAuthorStubs', () => {
  test('meta-model role: one stub per entity, bakes label + mm:<id> key + icon', async () => {
    const s = new FakeStorage()
    const m = doc([{ id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: { icon: 'resources/actor.svg', label: 'Actor' } }])
    const n = await scaffoldAuthorStubs(s, m, META_MODEL_ROLE, 'presentation')
    expect(n).toBe(1)
    const files = await s.List('presentation')
    expect(files.map((f) => f.Name)).toContain('actor.mu')
    const text = await s.ReadText('presentation/actor.mu')
    expect(text).toContain('DataTemplate x:key="mm:actor" [ DataType = MetaModelEntity ]')
    expect(text).toContain('Text = "Actor"')
    expect(text).toContain('@mm_icon_actor')
  })

  test('library role: binds $Display + class-id key', async () => {
    const s = new FakeStorage()
    const m = doc([{ id: 'lib.button', tier: 'Instance', typeOf: 'class', attrs: { class: true, icon: 'resources/b.svg' } }])
    await scaffoldAuthorStubs(s, m, LIBRARY_ROLE, 'presentation')
    const text = await s.ReadText('presentation/lib_button.mu')
    expect(text).toContain('DataTemplate x:key="lib.button" [ DataType = LibraryClassData ]')
    expect(text).toContain('Text = $Display')
    expect(text).toContain('Shape [ Geometry = @mm_icon_b') // vector icon → Shape geometry
  })

  test('raster icon → a Border filled with the ImageBrush, not a Shape', async () => {
    const s = new FakeStorage()
    const m = doc([{ id: 'lib.logo', tier: 'Instance', typeOf: 'class', attrs: { class: true, icon: 'resources/logo.png' } }])
    await scaffoldAuthorStubs(s, m, LIBRARY_ROLE, 'presentation')
    const text = await s.ReadText('presentation/lib_logo.mu')
    expect(text).not.toContain('Shape [')
    expect(text).toContain('Border [ Width = 16, Height = 16, Margin = (0,0,6,0), Background = @mm_icon_logo ]')
  })

  test('write-once: skips a key already declared in presentation/*.mu', async () => {
    const s = new FakeStorage()
    await s.WriteText('presentation/custom.mu', 'resources Custom { DataTemplate x:key="mm:actor" [ DataType = MetaModelEntity ] { } }')
    const m = doc([{ id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} }])
    const n = await scaffoldAuthorStubs(s, m, META_MODEL_ROLE, 'presentation')
    expect(n).toBe(0)
  })

  test('write-once: does not re-scaffold its own stub on a second run', async () => {
    const s = new FakeStorage()
    const m = doc([{ id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} }])
    expect(await scaffoldAuthorStubs(s, m, META_MODEL_ROLE, 'presentation')).toBe(1)
    expect(await scaffoldAuthorStubs(s, m, META_MODEL_ROLE, 'presentation')).toBe(0)
  })

  test('label-only stub when the entity resolves no icon', async () => {
    const s = new FakeStorage()
    const m = doc([{ id: 'partner', tier: 'Ontology', typeOf: 'concept', attrs: {} }])
    await scaffoldAuthorStubs(s, m, META_MODEL_ROLE, 'presentation')
    const text = await s.ReadText('presentation/partner.mu')
    expect(text).not.toContain('Shape [')
    expect(text).toContain('Text = "Partner"') // humanized fallback label
  })
})

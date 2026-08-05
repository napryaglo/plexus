import { describe, test, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-lab/todl'

import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { scaffoldAuthorStubs, META_MODEL_ROLE, LIBRARY_ROLE } from '../presentation-scaffold.js'

function doc(nodes: TodlDocument['nodes']): TodlDocument { return { nodes, edges: [] } }

describe('scaffoldAuthorStubs', () => {
  test('meta-model role: all templates land in ONE presentation/templates.mu', async () => {
    const s = new FakeStorage()
    const m = doc([
      { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: { icon: 'resources/actor.svg', label: 'Actor' } },
      { id: 'component', tier: 'Ontology', typeOf: 'concept', attrs: {} },
    ])
    const n = await scaffoldAuthorStubs(s, m, META_MODEL_ROLE, 'presentation')
    expect(n).toBe(2)
    // Exactly one file — not one per entity.
    const files = await s.List('presentation')
    expect(files.map((f) => f.Name)).toEqual(['templates.mu'])
    const text = await s.ReadText('presentation/templates.mu')
    // One resources block holding both templates.
    expect((text.match(/\bresources\b/g) ?? []).length).toBe(1)
    expect(text).toContain('resources MetaModelPresentationTemplates {')
    expect(text).toContain('DataTemplate x:key="mm:actor" [ DataType = MetaModelEntity ]')
    expect(text).toContain('DataTemplate x:key="mm:component" [ DataType = MetaModelEntity ]')
    expect(text).toContain('Text = "Actor"')
    expect(text).toContain('@mm_icon_actor')
  })

  test('library role: binds $Display + class-id key, vector icon → Shape', async () => {
    const s = new FakeStorage()
    const m = doc([{ id: 'lib.button', tier: 'Instance', typeOf: 'class', attrs: { class: true, icon: 'resources/b.svg' } }])
    await scaffoldAuthorStubs(s, m, LIBRARY_ROLE, 'presentation')
    const text = await s.ReadText('presentation/templates.mu')
    expect(text).toContain('resources LibraryPresentationTemplates {')
    expect(text).toContain('DataTemplate x:key="lib.button" [ DataType = LibraryClassData ]')
    expect(text).toContain('Text = $Display')
    expect(text).toContain('Shape [ Geometry = @mm_icon_b')
  })

  test('raster icon → a Border filled with the ImageBrush, not a Shape', async () => {
    const s = new FakeStorage()
    const m = doc([{ id: 'lib.logo', tier: 'Instance', typeOf: 'class', attrs: { class: true, icon: 'resources/logo.png' } }])
    await scaffoldAuthorStubs(s, m, LIBRARY_ROLE, 'presentation')
    const text = await s.ReadText('presentation/templates.mu')
    expect(text).not.toContain('Shape [')
    expect(text).toContain('Border [ Width = 16, Height = 16, Margin = (0,0,6,0), Background = @mm_icon_logo ]')
  })

  test('write-once: skips a key already declared in any presentation/*.mu', async () => {
    const s = new FakeStorage()
    await s.WriteText('presentation/custom.mu', 'resources Custom { DataTemplate x:key="mm:actor" [ DataType = MetaModelEntity ] { } }')
    const m = doc([{ id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} }])
    const n = await scaffoldAuthorStubs(s, m, META_MODEL_ROLE, 'presentation')
    expect(n).toBe(0)
    expect(await s.Exists('presentation/templates.mu')).toBe(false)
  })

  test('regeneration APPENDS a new entity without rewriting existing declarations', async () => {
    const s = new FakeStorage()
    const m1 = doc([{ id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: { label: 'Actor' } }])
    expect(await scaffoldAuthorStubs(s, m1, META_MODEL_ROLE, 'presentation')).toBe(1)

    // Author edits the existing template; then a new entity appears.
    const edited = (await s.ReadText('presentation/templates.mu')).replace('Text = "Actor"', 'Text = "MY ACTOR"')
    await s.WriteText('presentation/templates.mu', edited)

    const m2 = doc([
      { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: { label: 'Actor' } },
      { id: 'gateway', tier: 'Ontology', typeOf: 'concept', attrs: { label: 'Gateway' } },
    ])
    expect(await scaffoldAuthorStubs(s, m2, META_MODEL_ROLE, 'presentation')).toBe(1) // only the new one

    const text = await s.ReadText('presentation/templates.mu')
    expect(text).toContain('Text = "MY ACTOR"')                         // author edit preserved
    expect(text).toContain('DataTemplate x:key="mm:gateway"')           // new one appended
    expect((text.match(/DataTemplate/g) ?? []).length).toBe(2)
    expect((text.match(/\bresources\b/g) ?? []).length).toBe(1)         // still one block
  })

  test('label-only template when the entity resolves no icon', async () => {
    const s = new FakeStorage()
    const m = doc([{ id: 'partner', tier: 'Ontology', typeOf: 'concept', attrs: {} }])
    await scaffoldAuthorStubs(s, m, META_MODEL_ROLE, 'presentation')
    const text = await s.ReadText('presentation/templates.mu')
    expect(text).not.toContain('Shape [')
    expect(text).toContain('Text = "Partner"') // humanized fallback label
  })
})

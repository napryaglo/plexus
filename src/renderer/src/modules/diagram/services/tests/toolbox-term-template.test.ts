import { describe, it, expect } from 'vitest'
import type { Visual } from '@pragmatic-lab/mural/runtime'
import { DataTemplate } from '@pragmatic-lab/mural/basic'
import { LibraryRegistry } from '../../../library/services/library-registry.js'
import { resolveTermTemplate } from '../toolbox-term-template.js'

describe('resolveTermTemplate', () => {
  it('delegates to the LibraryRegistry when one is provided', () => {
    const sentinel = new DataTemplate(() => undefined as never)
    const fakeRegistry = { resolve: (_id: string, _concept: string) => sentinel } as unknown as LibraryRegistry
    expect(resolveTermTemplate(fakeRegistry, 'actors.internal', 'actor', 'Internal')).toBe(sentinel)
  })

  it('falls back to a text tile bearing the label when no registry', () => {
    const tmpl = resolveTermTemplate(undefined, 'actors.internal', 'actor', 'Internal')
    const v = tmpl.Apply({}) as Visual
    expect(v.constructor.name).toBe('TextBlock')
    expect((v as unknown as { Text: string }).Text).toBe('Internal')
  })
})

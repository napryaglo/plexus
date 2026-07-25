import { test, expect } from 'vitest'

import { buildCtx, compileTemplate, buildDefaultTemplate } from '../visual-library.js'

test('compiles a bare-element fragment into a DataTemplate that materialises a Visual with the data context', () => {
    const ctx = buildCtx()
    const tmpl = compileTemplate('TextBlock [ Text = $Display ]', ctx)
    const visual = tmpl.Apply({ Display: 'Azure' }) as { constructor: { name: string }; DataContext: unknown }
    expect(visual.constructor.name).toBe('TextBlock')
    expect(visual.DataContext).toEqual({ Display: 'Azure' })
})

test('buildDefaultTemplate returns a usable DataTemplate', () => {
    const tmpl = buildDefaultTemplate(buildCtx())
    expect(typeof tmpl.Apply).toBe('function')
})

test('a malformed fragment throws (caller catches and falls back)', () => {
    expect(() => compileTemplate('This is not valid mural [[[', buildCtx())).toThrow()
})

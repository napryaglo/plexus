import { test, expect, afterEach } from 'vitest'
import { Shape } from '@pragmatic-lab/mural/basic'
import type { Visual } from '@pragmatic-lab/mural/runtime'

import { buildCtx, compileTemplate, buildDefaultTemplate } from '../visual-library.js'
import { setIconResourceResolver } from '../../../diagram/services/icon-key-converter.js'

afterEach(() => setIconResourceResolver(undefined))

function hasType(v: Visual, ctor: Function): boolean {
    if (v instanceof ctor) return true
    for (const c of [...v.logicalChildren, ...v.visualChildren]) if (hasType(c, ctor)) return true
    return false
}

// True if any node in the tree is a TextBlock (a label). Figure-only visuals
// have none — the host draws the caption.
function hasText(v: Visual): boolean {
    if (v.constructor.name === 'TextBlock') return true
    for (const c of [...v.logicalChildren, ...v.visualChildren]) {
        if (hasText(c)) return true
    }
    return false
}

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

test('buildDefaultTemplate carries a Shape icon and no label', () => {
    setIconResourceResolver(() => ({}))   // any geometry
    const v = buildDefaultTemplate(buildCtx()).Apply({ IconKey: 'mm_icon_svc' }) as Visual
    expect(hasType(v, Shape)).toBe(true)
    expect(hasText(v)).toBe(false)
})

test('a malformed fragment throws (caller catches and falls back)', () => {
    expect(() => compileTemplate('This is not valid mural [[[', buildCtx())).toThrow()
})


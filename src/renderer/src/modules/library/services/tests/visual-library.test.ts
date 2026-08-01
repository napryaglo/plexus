import { test, expect } from 'vitest'
import { parseSvgIcon, Icon } from '@pragmatic-lab/mural/basic'
import type { Visual } from '@pragmatic-lab/mural/runtime'

import { buildCtx, compileTemplate, buildDefaultTemplate, buildIconTemplate } from '../visual-library.js'

const SVG = '<svg viewBox="0 0 10 10"><path d="M0 0 L10 0 L10 10 Z"/></svg>'

function findIcon(v: Visual): Icon | undefined {
    if (v instanceof Icon) return v
    for (const c of [...v.logicalChildren, ...v.visualChildren]) {
        const f = findIcon(c)
        if (f !== undefined) return f
    }
    return undefined
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

test('a malformed fragment throws (caller catches and falls back)', () => {
    expect(() => compileTemplate('This is not valid mural [[[', buildCtx())).toThrow()
})

test('buildIconTemplate applies a tree containing an Icon with the given Source', () => {
    const ctx = buildCtx()
    const iconDef = parseSvgIcon(SVG)
    const v = buildIconTemplate(iconDef, ctx).Apply({ Display: 'Azure' }) as Visual
    const icon = findIcon(v)
    expect(icon).toBeDefined()
    expect(icon!.Source).toBe(iconDef)
})

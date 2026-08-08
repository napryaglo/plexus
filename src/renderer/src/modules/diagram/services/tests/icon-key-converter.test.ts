import { test, expect, afterEach } from 'vitest'

import { IconKeyConverter, setIconResourceResolver, DEFAULT_ICON_KEY } from '../icon-key-converter.js'

afterEach(() => setIconResourceResolver(undefined))

test('resolves a known key through the active resolver', () => {
    const geom = {} as unknown
    setIconResourceResolver((k) => (k === 'mm_icon_svc' ? geom : k === DEFAULT_ICON_KEY ? {} : undefined))
    expect(new IconKeyConverter().convert('mm_icon_svc')).toBe(geom)
})

test('falls back to the default glyph for an empty key', () => {
    const dflt = {} as unknown
    setIconResourceResolver((k) => (k === DEFAULT_ICON_KEY ? dflt : undefined))
    expect(new IconKeyConverter().convert('')).toBe(dflt)
})

test('falls back to the default glyph for an unresolved key', () => {
    const dflt = {} as unknown
    setIconResourceResolver((k) => (k === DEFAULT_ICON_KEY ? dflt : undefined))
    expect(new IconKeyConverter().convert('nope')).toBe(dflt)
})

test('non-string input is treated as empty and falls back', () => {
    const dflt = {} as unknown
    setIconResourceResolver((k) => (k === DEFAULT_ICON_KEY ? dflt : undefined))
    expect(new IconKeyConverter().convert(undefined)).toBe(dflt)
})

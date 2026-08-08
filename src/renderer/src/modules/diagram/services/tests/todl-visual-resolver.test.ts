import { describe, it, expect, afterEach } from 'vitest'
import { Border, Shape, TextBlock } from '@pragmatic-lab/mural/basic'
import { VisualContext, ToolboxVisualDescriptor } from '@pragmatic-lab/mural/framework'
import type { Visual } from '@pragmatic-lab/mural/runtime'

import type { TodlPresentationRegistry } from '../todl-presentation-registry.js'
import { TodlVisualResolver, TodlVisualResolverKey } from '../todl-visual-resolver.js'
import { setIconResourceResolver } from '../icon-key-converter.js'

afterEach(() => setIconResourceResolver(undefined))

function hasType(v: Visual, ctor: Function): boolean {
    if (v instanceof ctor) return true
    for (const c of [...v.logicalChildren, ...v.visualChildren]) if (hasType(c, ctor)) return true
    return false
}

function desc(key: string): ToolboxVisualDescriptor {
    return new ToolboxVisualDescriptor(TodlVisualResolverKey, key)
}

// A registry stub exposing iconKeyFor + onChanged (the resolver's surface).
function fakeRegistry() {
    const listeners = new Set<(key: string) => void>()
    const index = new Map<string, string>([['mm:service', 'mm_icon_svc']])
    return {
        index,
        resolve: (k: string) => (k === 'mm_icon_svc' ? { tag: 'geom' } : undefined),
        iconKeyFor: (k: string) => index.get(k),
        onChanged: (cb: (key: string) => void) => { listeners.add(cb); return () => listeners.delete(cb) },
        fire(key: string) { for (const l of listeners) l(key) },
        listenerCount() { return listeners.size },
    }
}

describe('TodlVisualResolver', () => {
    it('exports a stable ServiceKey', () => {
        expect(TodlVisualResolverKey).toBeDefined()
    })

    it('resolves a known entity through the default template (a Border with a Shape icon), Tile → IsHitTestVisible=false', () => {
        const reg = fakeRegistry()
        setIconResourceResolver(reg.resolve)
        const r = new TodlVisualResolver(reg as unknown as TodlPresentationRegistry)
        const tile = r.Resolve(desc('mm:service'), VisualContext.Tile) as Border
        expect(tile).toBeInstanceOf(Border)
        expect(hasType(tile, Shape)).toBe(true)
        expect(hasType(tile, TextBlock)).toBe(false)   // figure only; host draws caption
        expect(tile.IsHitTestVisible).toBe(false)
    })

    it('does NOT force IsHitTestVisible=false in Figure context', () => {
        const reg = fakeRegistry()
        const r = new TodlVisualResolver(reg as unknown as TodlPresentationRegistry)
        const fig = r.Resolve(desc('mm:service'), VisualContext.Figure) as Border
        expect(fig.IsHitTestVisible).not.toBe(false)
    })

    it('an entity with no indexed icon still renders the default template (default glyph, no label)', () => {
        const reg = fakeRegistry()
        const r = new TodlVisualResolver(reg as unknown as TodlPresentationRegistry)
        const tile = r.Resolve(desc('unknown'), VisualContext.Tile)
        expect(tile).toBeInstanceOf(Border)
        expect(hasType(tile, TextBlock)).toBe(false)
    })

    it('bridges registry.onChanged: AddChangedListener delivers fired keys to the cb', () => {
        const reg = fakeRegistry()
        const r = new TodlVisualResolver(reg as unknown as TodlPresentationRegistry)
        const seen: string[] = []
        const cb = (k: string) => seen.push(k)
        r.AddChangedListener(cb)
        reg.fire('mm:service')
        expect(seen).toEqual(['mm:service'])
    })

    it('RemoveChangedListener unsubscribes the cb', () => {
        const reg = fakeRegistry()
        const r = new TodlVisualResolver(reg as unknown as TodlPresentationRegistry)
        const cb = (_k: string) => {}
        r.AddChangedListener(cb)
        r.RemoveChangedListener(cb)
        expect(reg.listenerCount()).toBe(0)
    })

    it('AddChangedListener is idempotent: registering the same cb twice subscribes once', () => {
        const reg = fakeRegistry()
        const r = new TodlVisualResolver(reg as unknown as TodlPresentationRegistry)
        const cb = (_k: string) => {}
        r.AddChangedListener(cb)
        r.AddChangedListener(cb)
        expect(reg.listenerCount()).toBe(1)
    })
})

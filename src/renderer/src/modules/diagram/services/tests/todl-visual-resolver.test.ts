import { describe, it, expect } from 'vitest'
import { Border } from '@pragmatic-lab/mural/basic'
import { VisualContext, ToolboxVisualDescriptor } from '@pragmatic-lab/mural/framework'
import type { Visual } from '@pragmatic-lab/mural/runtime'
import { buildCtx, compileTemplate } from '../../../library/services/visual-library.js'
import type { TodlPresentationRegistry } from '../todl-presentation-registry.js'
import { TodlVisualResolver, TodlVisualResolverKey } from '../todl-visual-resolver.js'

// True if any node in the visual tree is a TextBlock (a label). Figure-only visuals
// have none — the host draws the caption.
function hasText(v: Visual): boolean {
    if (v.constructor.name === 'TextBlock') return true
    for (const c of [...v.logicalChildren, ...v.visualChildren]) if (hasText(c)) return true
    return false
}

function desc(key: string): ToolboxVisualDescriptor {
    return new ToolboxVisualDescriptor(TodlVisualResolverKey, key)
}

function fakeRegistry() {
    const listeners = new Set<(key: string) => void>()
    const known = compileTemplate('Border []', buildCtx())
    return {
        known,
        listeners,
        resolve: (k: string) => k === 'k1' ? known : undefined,
        onChanged: (cb: (key: string) => void) => { listeners.add(cb); return () => listeners.delete(cb) },
        fire(key: string) { for (const l of listeners) l(key) },
        listenerCount() { return listeners.size },
    }
}

describe('TodlVisualResolver', () => {
    it('exports a stable ServiceKey', () => {
        expect(TodlVisualResolverKey).toBeDefined()
    })

    it('resolves a known key and forces IsHitTestVisible=false in Tile context', () => {
        const reg = fakeRegistry()
        const r = new TodlVisualResolver(reg as unknown as TodlPresentationRegistry)
        const tile = r.Resolve(desc('k1'), VisualContext.Tile) as Border
        expect(tile).toBeDefined()
        expect(tile.IsHitTestVisible).toBe(false)
    })

    it('resolves a known key and does NOT force IsHitTestVisible=false in Figure context', () => {
        const reg = fakeRegistry()
        const r = new TodlVisualResolver(reg as unknown as TodlPresentationRegistry)
        const fig = r.Resolve(desc('k1'), VisualContext.Figure) as Border
        expect(fig).toBeDefined()
        expect(fig.IsHitTestVisible).not.toBe(false)
    })

    it('falls back to the default box for an unknown key (no TextBlock in tree)', () => {
        const reg = fakeRegistry()
        const r = new TodlVisualResolver(reg as unknown as TodlPresentationRegistry)
        const tile = r.Resolve(desc('k2'), VisualContext.Tile)
        expect(tile).toBeDefined()
        expect(hasText(tile)).toBe(false)
    })

    it('bridges registry.onChanged: AddChangedListener delivers fired keys to the cb', () => {
        const reg = fakeRegistry()
        const r = new TodlVisualResolver(reg as unknown as TodlPresentationRegistry)
        const seen: string[] = []
        const cb = (k: string) => seen.push(k)
        r.AddChangedListener(cb)
        reg.fire('k1')
        expect(seen).toEqual(['k1'])
    })

    it('RemoveChangedListener unsubscribes the cb from registry.onChanged', () => {
        const reg = fakeRegistry()
        const r = new TodlVisualResolver(reg as unknown as TodlPresentationRegistry)
        const seen: string[] = []
        const cb = (k: string) => seen.push(k)
        r.AddChangedListener(cb)
        reg.fire('k1')
        r.RemoveChangedListener(cb)
        expect(reg.listenerCount()).toBe(0)
        reg.fire('k1')
        expect(seen).toEqual(['k1'])
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

import { test, expect } from 'vitest'
import { Application, ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { Border, DataTemplate } from '@pragmatic-lab/mural/basic'

import type { PresentationSource } from '../todl-presentation-registry.js'
import { TodlPresentationRegistry } from '../todl-presentation-registry.js'

// Minimal fake DataTemplate factory — each call returns a new template so identity
// comparisons work between different keys/sources.
const tmpl = (name: string) => new DataTemplate(() => { const b = new Border(); b.Tag = name; return b })

// Fake PresentationSource — synchronously returns a Map of key→template.
const src = (id: string, entries: [string, DataTemplate][]): PresentationSource => ({
    id,
    load: async () => new Map(entries),
})

test('after registerSource + discover, resolve returns each source template; unknown key → undefined', async () => {
    const provider = new ServiceProvider()
    const registry = new TodlPresentationRegistry(provider)

    const t1 = tmpl('k1')
    const t2 = tmpl('k2')
    registry.registerSource(src('a', [['k1', t1]]))
    registry.registerSource(src('b', [['k2', t2]]))

    await registry.discover()

    expect(registry.resolve('k1')).toBe(t1)
    expect(registry.resolve('k2')).toBe(t2)
    expect(registry.resolve('nope')).toBeUndefined()
})

test('onChanged fires once per aggregated key after discover', async () => {
    const provider = new ServiceProvider()
    const registry = new TodlPresentationRegistry(provider)

    const t1 = tmpl('k1')
    const t2 = tmpl('k2')
    const t3 = tmpl('k3')
    registry.registerSource(src('a', [['k1', t1], ['k2', t2]]))
    registry.registerSource(src('b', [['k3', t3]]))

    const fired: string[] = []
    registry.onChanged((key) => fired.push(key))

    await registry.discover()

    expect(fired).toContain('k1')
    expect(fired).toContain('k2')
    expect(fired).toContain('k3')
})

test('registerSource is idempotent by id — registering the same id twice does not double entries', async () => {
    const provider = new ServiceProvider()
    const registry = new TodlPresentationRegistry(provider)

    const t1 = tmpl('k1')
    const t2 = tmpl('k1-updated')
    // Register 'a' twice — the second call should overwrite, not duplicate.
    registry.registerSource(src('a', [['k1', t1]]))
    registry.registerSource(src('a', [['k1', t2]]))

    const fired: string[] = []
    registry.onChanged((key) => fired.push(key))

    await registry.discover()

    // Only one source 'a' should have run — exactly one k1 entry, with the last value.
    expect(registry.resolve('k1')).toBe(t2)
    // Only one notification for k1 (not duplicated).
    expect(fired.filter((k) => k === 'k1').length).toBe(1)
})

test('onChanged returns an unsubscribe function that stops further notifications', async () => {
    const provider = new ServiceProvider()
    const registry = new TodlPresentationRegistry(provider)

    registry.registerSource(src('a', [['k1', tmpl('k1')]]))

    const fired: string[] = []
    const unsub = registry.onChanged((key) => fired.push(key))

    await registry.discover()
    expect(fired).toContain('k1')

    unsub()
    fired.length = 0

    await registry.discover()
    expect(fired).toHaveLength(0)
})

test('a second discover re-runs sources and swaps — new entries resolve correctly', async () => {
    const provider = new ServiceProvider()
    const registry = new TodlPresentationRegistry(provider)

    const t1 = tmpl('k1-v1')
    const t1v2 = tmpl('k1-v2')
    let version = 0
    const dynamicSrc: PresentationSource = {
        id: 'dynamic',
        load: async () => {
            version++
            return new Map([['k1', version === 1 ? t1 : t1v2]])
        },
    }
    registry.registerSource(dynamicSrc)

    await registry.discover()
    expect(registry.resolve('k1')).toBe(t1)

    await registry.discover()
    expect(registry.resolve('k1')).toBe(t1v2)
})

test('populating N keys fires O(1) app-resource notifications, not one per key', async () => {
    const prior = Application.current
    try {
        const app = new Application()
        Application.current = app

        const provider = new ServiceProvider()
        const registry = new TodlPresentationRegistry(provider)

        const N = 10
        const entries: [string, DataTemplate][] = Array.from({ length: N }, (_, i) => [`key${i}`, tmpl(`key${i}`)])
        registry.registerSource(src('big', entries))

        let general = 0, style = 0
        app.Resources.Subscribe(() => { general++ })
        app.Resources.SubscribeStyle(() => { style++ })

        await registry.discover()
        expect(general).toBeLessThan(N)   // O(1): one swap, not one per key

        const afterFirst = general
        const afterFirstStyle = style

        await registry.discover()
        expect(general - afterFirst).toBe(1)          // exactly one general notification for the swap
        expect(style - afterFirstStyle).toBe(1)       // one structural style signal
    } finally {
        Application.current = prior
    }
})

import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { ViewportService, type IViewportSource } from '../viewport-service.js'

// A fake window: lets the test push a new height and fire the resize callback.
function fakeSource(initial: number): IViewportSource & { push(h: number): void }
{
    let h = initial
    const cbs = new Set<() => void>()
    return {
        height: () => h,
        subscribe: (cb) => { cbs.add(cb); return () => cbs.delete(cb) },
        push: (next: number) => { h = next; for (const cb of cbs) cb() },
    }
}

test('Height reflects the source at construction', () => {
    const provider = new ServiceProvider()
    const svc = new ViewportService(provider, fakeSource(900))
    expect(svc.Height).toBe(900)
})

test('Height updates and Subscribe fires when the source resizes', () => {
    const provider = new ServiceProvider()
    const source = fakeSource(900)
    const svc = new ViewportService(provider, source)
    let notified = 0
    svc.Subscribe(() => { notified += 1 })
    source.push(600)
    expect(svc.Height).toBe(600)
    expect(notified).toBe(1)
})

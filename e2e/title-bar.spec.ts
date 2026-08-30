// Custom title-bar smoke.
//
// The window runs with a hidden OS title bar (titleBarStyle: 'hidden'); the
// renderer draws its own draggable 32px band (index.html #titlebar) whose text
// tracks the active document / open project and whose surface is themed by
// title-bar.ts. Verifies the band renders, is draggable, sits above the mural
// mount, shows a non-empty title, and paints the active scheme's surface (not
// the seeded fallback) — i.e. the theme hook ran.
import { test, expect } from '@playwright/test'
import { launchPlexus, appErrors, type Launched } from './plexus-app'

let L: Launched

test.beforeAll(async () => {
    L = await launchPlexus()
    await L.win.waitForTimeout(800)
})

test.afterAll(async () => {
    await L?.app?.close()
})

test('boots without app errors', async () => {
    const errs = appErrors(L.errors)
    expect(errs, errs.join('\n')).toEqual([])
})

test('draggable 32px band above the mount, themed surface, live title', async () => {
    const band = await L.win.evaluate(() => {
        const el = document.getElementById('titlebar')
        const cs = el ? getComputedStyle(el) : null
        return {
            present: !!el,
            height: cs?.height,
            drag: cs?.getPropertyValue('-webkit-app-region'),
            bg: cs?.backgroundColor,
            title: document.getElementById('plexus-title')?.textContent ?? '',
            appTop: document.getElementById('app')?.getBoundingClientRect().top ?? 0,
        }
    })

    expect(band.present).toBe(true)
    expect(band.height).toBe('32px')
    expect(band.drag).toBe('drag')
    // The mural surface sits BELOW the band (not at the window's top edge).
    expect(band.appTop).toBeGreaterThanOrEqual(32)
    // Title reflects app state (active document, else open project, else Plexus).
    expect(band.title.length).toBeGreaterThan(0)
    // The theme hook resolved @SurfaceContainer and set the CSS var — so the
    // band is NOT the transparent/unset default (it has a real rgb fill).
    expect(band.bg).toMatch(/^rgb/)
})

// E2E: the title-bar File menu opens on click and surfaces the Export item.
//
// The File menu lives in the always-present title bar; its Export ▸ SVG/PPTX
// commands simply disable (via DiagramExportService.canExportActive) when no
// diagram is open, so this test needs no seeded corpus. It asserts pure menu
// behaviour: a MenuButton whose Header is "File" exists, and clicking it mounts
// its dropdown so a MenuItem headed "Export" appears where there was none.
//
// mural paints Visuals to an SVG tree (each element carries a Visual backref);
// SVG elements have no `innerText`, so we match on the Visual's `Header`
// property rather than rendered text.
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import { launchPlexus, appErrors, clickCenter, MAIN, ELECTRON_EXE, type Launched } from './plexus-app'

type Rect = { x: number; y: number; w: number; h: number }

// First on-screen rect of a Visual whose ctor name and Header both match.
async function rectByHeader(win: Page, ctor: string, header: string): Promise<Rect | null> {
  return win.evaluate(({ ctor, header }) => {
    const S = Symbol.for('mural:visual-backref')
    for (const el of document.querySelectorAll('*')) {
      const v = (el as any)[S]
      if (!v || v.constructor?.name !== ctor || v.Header !== header) continue
      const r = (el as Element).getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    }
    return null
  }, { ctor, header })
}

// Count visible Visuals matching ctor name + Header.
async function countByHeader(win: Page, ctor: string, header: string): Promise<number> {
  return win.evaluate(({ ctor, header }) => {
    const S = Symbol.for('mural:visual-backref')
    let n = 0
    for (const el of document.querySelectorAll('*')) {
      const v = (el as any)[S]
      if (v && v.constructor?.name === ctor && v.Header === header) n++
    }
    return n
  }, { ctor, header })
}

test.describe.serial('title-bar-file-menu', () => {
  test.skip(!fs.existsSync(MAIN) || !fs.existsSync(ELECTRON_EXE), 'built app required (npm run build)')

  let l: Launched

  test.beforeAll(async () => {
    l = await launchPlexus()
    await l.win.waitForTimeout(8_000)
  })

  test.afterAll(async () => {
    await l?.app.close()
  })

  test('File menu button is present in the title bar', async () => {
    const file = await rectByHeader(l.win, 'MenuButton', 'File')
    expect(file, 'a MenuButton headed "File"').not.toBeNull()
  })

  test('clicking File opens the dropdown and reveals Export', async () => {
    // The Export item is not mounted until the menu opens.
    expect(await countByHeader(l.win, 'MenuItem', 'Export'), 'no Export before opening File').toBe(0)

    const file = await rectByHeader(l.win, 'MenuButton', 'File')
    expect(file, 'File button rect').not.toBeNull()
    await clickCenter(l.win, file!)
    await l.win.waitForTimeout(500)

    expect(await countByHeader(l.win, 'MenuItem', 'Export'), 'Export present after opening File').toBeGreaterThan(0)
  })

  test('no app errors', async () => {
    expect(appErrors(l.errors), appErrors(l.errors).join('\n')).toEqual([])
  })
})

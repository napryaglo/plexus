// E2E: right-clicking an architecture node shows the SHARED diagram context menu
// (Copy/Cut/Align/Export/Format) plus a node-only "Open Wiki" item — not the bare
// Open-Wiki menu it used to swap in. Guards the ArchNodeVM.HostDocument wiring:
// the menu's $ActiveView-bound items must resolve their Command through the node.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { launchPlexus, seedSession, rectsForCtor, clickCenter, MAIN, type Launched } from './plexus-app'

const CORPUS = process.env.PLEXUS_TEST_CORPUS ?? 'c:/Users/Eugene/Projects/architecture-agent/plexus_test_projects'
const RELS = ['meta-models/tech-architecture', 'libraries/microsoft', 'libraries/aws', 'architecures/test_architecture']

test.describe.serial('arch-node-context-menu', () => {
  test.skip(!fs.existsSync(MAIN) || !fs.existsSync(path.join(CORPUS, RELS[3])), 'requires built app + test corpus')

  let l: Launched
  let copyRoot: string
  let restore: () => void

  test.beforeAll(async () => {
    copyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plexus-archmenu-'))
    for (const r of RELS) fs.cpSync(path.join(CORPUS, r), path.join(copyRoot, r), { recursive: true })
    restore = seedSession(RELS.map((r) => path.join(copyRoot, r)))
    l = await launchPlexus()
    await l.win.waitForTimeout(12_000)
    const navs = await rectsForCtor(l.win, 'NavigationItem')
    if (navs[1]) await clickCenter(l.win, navs[1])
    await l.win.waitForTimeout(1500)
    await l.win.evaluate(async () => {
      const S = Symbol.for('mural:visual-backref')
      let ex: any
      for (const el of document.querySelectorAll('*')) { const dc = (el as any)[S]?.DataContext; if (dc && typeof dc.OpenFileInProject === 'function') { ex = dc; break } }
      const proj = ex?.OpenProjects?.ToArray?.().find((p: any) => (p?.Folder ?? '').toLowerCase().includes('test_architecture'))
      if (proj) await ex.OpenFileInProject(proj.Folder, 'diagram-2.diagram', 0, 0)
    })
    await l.win.waitForTimeout(5000)
  })

  test.afterAll(async () => {
    restore?.()
    await l?.app.close()
    if (copyRoot) fs.rmSync(copyRoot, { recursive: true, force: true })
  })

  test('right-click node shows the full diagram menu + gated Open Wiki', async () => {
    const node = await l.win.evaluate(() => {
      const S = Symbol.for('mural:visual-backref')
      for (const el of document.querySelectorAll('*')) {
        const dc = (el as any)[S]?.DataContext
        if (dc?.constructor?.name === 'ArchNodeVM') {
          const r = (el as Element).getBoundingClientRect()
          if (r.width > 4 && r.height > 4) return { x: r.x, y: r.y, w: r.width, h: r.height, hasWiki: !!dc.HasWiki, hasHostDoc: !!dc.HostDocument }
        }
      }
      return null
    })
    expect(node, 'an arch node figure').not.toBeNull()
    expect(node!.hasHostDoc, 'node has its HostDocument set by the binding').toBe(true)

    await l.win.mouse.click(node!.x + node!.w / 2, node!.y + node!.h / 2, { button: 'right' })
    await l.win.waitForTimeout(600)

    const menu = await l.win.evaluate(() => {
      const S = Symbol.for('mural:visual-backref')
      const items: Record<string, { visible: boolean; hasCmd: boolean }> = {}
      for (const el of document.querySelectorAll('*')) {
        const v = (el as any)[S]
        if (v?.constructor?.name !== 'MenuItem') continue
        const r = (el as Element).getBoundingClientRect()
        items[String(v.Header)] = { visible: r.width > 0 && r.height > 0, hasCmd: !!v.Command }
      }
      return items
    })

    // Full diagram menu is present on the node (not the bare Open-Wiki menu).
    expect(menu['Copy'], 'Copy present').toBeTruthy()
    expect(menu['Export'], 'Export present').toBeTruthy()
    expect(menu['Format Shape'], 'Format Shape present').toBeTruthy()
    // $ActiveView resolved through the node's HostDocument alias (Command bound).
    expect(menu['Copy'].hasCmd, 'Copy Command resolved via HostDocument').toBe(true)
    // Open Wiki exists, visible iff the node has a wiki.
    expect(menu['Open Wiki'], 'Open Wiki item present').toBeTruthy()
    expect(menu['Open Wiki'].visible, 'Open Wiki visibility tracks HasWiki').toBe(node!.hasWiki)
  })
})

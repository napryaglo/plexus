// Live check of every Size & Position sub-editor in the diagram Format-Shape
// inspector. Opens a corpus diagram, selects a shape, opens the Format Shape
// inspector's Size & Position page, then drives each field's committed value
// and asserts the selected figure's geometry actually changes.
//
// This is the end-to-end guard for the `$$` (TemplateBinding) two-way fix:
// each field is `SpinEdit [ Value = $$WidthValue ]` etc., so a committed edit
// must flow field -> SizePositionControl DP -> Diagram.SelectedShape* ->
// Figure. With the old one-way `$$` the figure would not move and these
// assertions would fail.
import { test, expect } from '@playwright/test'
import { launchPlexus, seedSession, corpusAvailable, rectsForCtor, clickCenter, appErrors, type Launched } from './plexus-app'

// SpinEdit DOM order inside the Size & Position template.
const SPIN = { Height: 0, Width: 1, Rotation: 2, ScaleHeight: 3, ScaleWidth: 4, Horizontal: 5, Vertical: 6 } as const

async function canvasFigs(l: Launched) {
    return (await rectsForCtor(l.win, 'Figure')).filter((f) => f.w > 60).sort((a, b) => a.y - b.y || a.x - b.x)
}

// Live introspection of the selected shape + the editor's control state.
function readState(l: Launched) {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any, ctl: any
        const spins: any[] = []
        const combos: any[] = []
        let sw: any
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (!v) continue
            const n = v.constructor?.name
            if (n === 'Diagram') diagram = v
            else if (n === 'SizePositionControl') ctl = v
            else if (n === 'SpinEdit' && !spins.includes(v)) spins.push(v)
            else if (n === 'Switch' && !sw) sw = v
            else if (n === 'ComboBox' && !combos.includes(v)) combos.push(v)
        }
        const sel = diagram?.SelectedItems?.[0]
        const fromCombos = combos.filter((c) => c.SelectedItem === 'Top Left Corner' || c.SelectedItem === 'Center')
        return {
            fig: sel ? { L: sel.Left, T: sel.Top, W: sel.Width, H: sel.Height, R: sel.Rotation } : null,
            spins: spins.map((s) => s.Value),
            lock: ctl?.LockAspectRatio ?? null,
            positionFrom: ctl?.PositionFrom ?? null,
            fromComboCount: fromCombos.length,
        }
    })
}

// Commit a value into the Nth SpinEdit (its Value DP is the $$ binding target,
// exactly what a typed-and-committed edit writes).
function setSpin(l: Launched, index: number, value: number) {
    return l.win.evaluate(({ index, value }) => {
        const S = Symbol.for('mural:visual-backref')
        const spins: any[] = []
        for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v?.constructor?.name === 'SpinEdit' && !spins.includes(v)) spins.push(v) }
        spins[index].Value = value
    }, { index, value })
}

function setSwitch(l: Launched, checked: boolean) {
    return l.win.evaluate((checked) => {
        const S = Symbol.for('mural:visual-backref')
        for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v?.constructor?.name === 'Switch') { v.IsChecked = checked; return } }
    }, checked)
}

function setFromCombo(l: Launched, label: string) {
    return l.win.evaluate((label) => {
        const S = Symbol.for('mural:visual-backref')
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (v?.constructor?.name === 'ComboBox' && (v.SelectedItem === 'Top Left Corner' || v.SelectedItem === 'Center')) { v.SelectedItem = label; return }
        }
    }, label)
}

test.describe.serial('Size & Position sub-editors drive the selected shape', () => {
    let l: Launched
    let restore: () => void
    const near = (a: number, b: number, eps = 0.6) => Math.abs(a - b) <= eps

    test.beforeAll(async () => {
        test.skip(!corpusAvailable(), 'built app (out/) or test corpus not available')
        restore = seedSession()
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)

        // 1. open the project explorer, wheel the virtualized tree until the
        //    diagram file renders, then open it.
        const navs = await rectsForCtor(l.win, 'NavigationItem')
        if (navs[1]) await clickCenter(l.win, navs[1])
        await l.win.waitForTimeout(1200)
        const scrollX = navs[1]!.x + navs[1]!.w + 120
        for (let i = 0; i < 14; i++) {
            if (await l.win.getByText('diagram.diagram', { exact: true }).count()) break
            await l.win.mouse.move(scrollX, 300)
            await l.win.mouse.wheel(0, 400)
            await l.win.waitForTimeout(250)
        }
        let figs: Awaited<ReturnType<typeof canvasFigs>> = []
        for (let attempt = 0; attempt < 3 && figs.length === 0; attempt++) {
            const dd = l.win.getByText('diagram.diagram', { exact: true }).first()
            await dd.scrollIntoViewIfNeeded().catch(() => {})
            await dd.dblclick({ timeout: 4000 }).catch(() => {})
            await l.win.waitForTimeout(3500)
            figs = await canvasFigs(l)
        }
        expect(figs.length, 'diagram opened with canvas figures').toBeGreaterThan(0)

        // 2. select a shape, right-click it → Format Shape (opens the inspector).
        const fig = figs[0]!
        await clickCenter(l.win, fig)
        await l.win.waitForTimeout(800)
        await l.win.mouse.click(fig.x + fig.w / 2, fig.y + fig.h / 2, { button: 'right' })
        await l.win.waitForTimeout(800)
        const clickText = async (text: string): Promise<boolean> => {
            const bb = await l.win.getByText(text, { exact: false }).first().boundingBox().catch(() => null)
            if (!bb) return false
            await l.win.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2)
            return true
        }
        expect(await clickText('Format Shape'), 'Format Shape menu item clicked').toBe(true)
        await l.win.waitForTimeout(1200)

        // 3. switch to the Size & Position page.
        expect(await clickText('Size & Position'), 'Size & Position page tab clicked').toBe(true)
        await l.win.waitForTimeout(1000)

        const spins = await rectsForCtor(l.win, 'SpinEdit')
        expect(spins.length, 'seven Size/Position spin editors present').toBe(7)
    })

    test.afterAll(async () => { await l.app.close().catch(() => {}); restore?.() })

    test('Width field resizes the shape horizontally', async () => {
        await setSpin(l, SPIN.Width, 140)
        await l.win.waitForTimeout(300)
        const st = await readState(l)
        expect(near(st.fig!.W, 140), `W=${st.fig!.W}`).toBe(true)
    })

    test('Height field resizes the shape vertically', async () => {
        await setSpin(l, SPIN.Height, 110)
        await l.win.waitForTimeout(300)
        const st = await readState(l)
        expect(near(st.fig!.H, 110), `H=${st.fig!.H}`).toBe(true)
    })

    test('Rotation field rotates the shape', async () => {
        await setSpin(l, SPIN.Rotation, 30)
        await l.win.waitForTimeout(300)
        const st = await readState(l)
        expect(near(st.fig!.R, 30), `R=${st.fig!.R}`).toBe(true)
    })

    test('Horizontal position field moves the shape in X', async () => {
        await setSpin(l, SPIN.Horizontal, 250)
        await l.win.waitForTimeout(300)
        const st = await readState(l)
        expect(near(st.fig!.L, 250), `L=${st.fig!.L}`).toBe(true)
    })

    test('Vertical position field moves the shape in Y', async () => {
        await setSpin(l, SPIN.Vertical, 333)
        await l.win.waitForTimeout(300)
        const st = await readState(l)
        expect(near(st.fig!.T, 333), `T=${st.fig!.T}`).toBe(true)
    })

    test('Scale Width field scales width off the base size', async () => {
        // base width is 80 (from the diagram file); 50% -> 40.
        await setSpin(l, SPIN.ScaleWidth, 50)
        await l.win.waitForTimeout(300)
        const st = await readState(l)
        expect(near(st.fig!.W, 40), `W=${st.fig!.W}`).toBe(true)
    })

    test('Scale Height field scales height off the base size', async () => {
        // base height 80; 125% -> 100.
        await setSpin(l, SPIN.ScaleHeight, 125)
        await l.win.waitForTimeout(300)
        const st = await readState(l)
        expect(near(st.fig!.H, 100), `H=${st.fig!.H}`).toBe(true)
    })

    test('Lock aspect ratio links width and height', async () => {
        // reset to a clean square, then lock and widen — height must follow.
        await setSpin(l, SPIN.Width, 100)
        await setSpin(l, SPIN.Height, 100)
        await l.win.waitForTimeout(200)
        await setSwitch(l, true)
        await l.win.waitForTimeout(200)
        expect((await readState(l)).lock, 'lock switch is on').toBe(true)
        await setSpin(l, SPIN.Width, 200)
        await l.win.waitForTimeout(300)
        const st = await readState(l)
        expect(near(st.fig!.W, 200), `W=${st.fig!.W}`).toBe(true)
        expect(near(st.fig!.H, 200, 2), `linked H=${st.fig!.H}`).toBe(true)
        await setSwitch(l, false) // release for later tests
        await l.win.waitForTimeout(200)
    })

    test('Position "From" combo writes back the anchor; Center anchors by centre', async () => {
        const before = await readState(l)
        expect(before.fromComboCount, 'two From combos present').toBe(2)
        // Establish a clean, known geometry (Top-Left anchor) so the anchor math
        // is unambiguous: 100x100 shape whose left edge sits at x=200.
        await setSpin(l, SPIN.ScaleWidth, 100)
        await setSpin(l, SPIN.ScaleHeight, 100)
        await setSpin(l, SPIN.Width, 100)
        await setSpin(l, SPIN.Height, 100)
        await setSpin(l, SPIN.Horizontal, 200)
        await l.win.waitForTimeout(300)
        const clean = await readState(l)
        expect(near(clean.fig!.L, 200) && near(clean.fig!.W, 100), `clean L=${clean.fig!.L} W=${clean.fig!.W}`).toBe(true)

        // The combo binds SelectedItem = $$SelectedFromLabel (two-way): choosing
        // Center flips the control's PositionFrom.
        await setFromCombo(l, 'Center')
        await l.win.waitForTimeout(300)
        const mid = await readState(l)
        expect(String(mid.positionFrom).toLowerCase(), `positionFrom=${mid.positionFrom}`).toContain('center')

        // Under Center, the Horizontal field positions the shape's CENTRE:
        // Left = Horizontal - Width/2. With W=100, Horizontal=300 -> Left=250.
        await setSpin(l, SPIN.Horizontal, 300)
        await l.win.waitForTimeout(300)
        const st = await readState(l)
        expect(near(st.fig!.L, 300 - st.fig!.W / 2, 1), `L=${st.fig!.L}, W=${st.fig!.W}`).toBe(true)
    })

    test('no renderer errors while driving the editor', async () => {
        expect(appErrors(l.errors), appErrors(l.errors).join('\n')).toEqual([])
    })
})

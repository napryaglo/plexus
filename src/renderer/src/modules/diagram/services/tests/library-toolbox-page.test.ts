import { describe, it, expect } from 'vitest'
import { LibraryToolboxPage } from '../library-toolbox-page.js'

describe('LibraryToolboxPage', () => {
    it('reconciles items on a library change without clearing, and carries its ref as Context', () => {
        const terms = [{ id: 't1', label: 'One' }]
        let changeCb: (() => void) | undefined
        const page = new LibraryToolboxPage('lib@1.0.0', 'lib:lib', 'Lib', {
            termsFor: () => terms,
            onLibrariesChanged: (cb) => { changeCb = cb; return () => {} },
        })
        page.attach()
        expect(page.Items.ToArray().map((i) => i.Id)).toEqual(['term:t1'])
        expect(page.Context).toBe('lib@1.0.0')

        const first = page.Items.Get(0)
        const events: string[] = []
        page.Items.Subscribe((e) => events.push(e.kind))
        terms.push({ id: 't2', label: 'Two' })
        changeCb!()                                  // a library changed
        expect(page.Items.ToArray().map((i) => i.Id)).toEqual(['term:t1', 'term:t2'])
        expect(page.Items.Get(0)).toBe(first)        // t1 kept its instance
        expect(events).not.toContain('cleared')
    })

    it('detach stops further updates', () => {
        const terms = [{ id: 't1', label: 'One' }]
        let changeCb: (() => void) | undefined
        const page = new LibraryToolboxPage('lib@1.0.0', 'lib:lib', 'Lib', {
            termsFor: () => terms,
            onLibrariesChanged: (cb) => { changeCb = cb; return () => { changeCb = undefined } },
        })
        page.attach()
        page.detach()
        expect(changeCb).toBeUndefined()
    })
})

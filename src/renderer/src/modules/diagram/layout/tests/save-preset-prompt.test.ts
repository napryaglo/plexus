import { describe, test } from 'vitest'
import assert from 'node:assert/strict'

import { SavePresetPromptModel } from '../save-preset-prompt.js'

// The dialog content VM: a name field + Confirm/Cancel that close with the
// typed name (or undefined). Tested directly via the `close` callback.
describe('SavePresetPromptModel', () => {

    test('starts with the initial name', () => {
        const m = new SavePresetPromptModel('Wide', () => {})
        assert.equal(m.Name, 'Wide')
        assert.equal(m.CanConfirm, true)
    })

    test('confirm closes with the trimmed name', () => {
        let closed: string | undefined = 'sentinel'
        const m = new SavePresetPromptModel('', (n) => { closed = n })
        m.Name = '  Tall  '
        m.ConfirmCommand.Execute(undefined)
        assert.equal(closed, 'Tall')
    })

    test('cancel closes with undefined', () => {
        let closed: string | undefined = 'sentinel'
        const m = new SavePresetPromptModel('x', (n) => { closed = n })
        m.CancelCommand.Execute(undefined)
        assert.equal(closed, undefined)
    })

    test('CanConfirm is false for an empty or blank name; confirm is a no-op then', () => {
        let called = false
        const m = new SavePresetPromptModel('', () => { called = true })
        assert.equal(m.CanConfirm, false)
        m.Name = '   '
        assert.equal(m.CanConfirm, false)
        m.ConfirmCommand.Execute(undefined)
        assert.equal(called, false)
    })
})

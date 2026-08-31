import { describe, it, expect } from 'vitest'
import { SavePromptModel, SavePromptResult, promptSave } from '../save-prompt-model.js'

describe('SavePromptModel', () => {
    it('each command closes with the matching result', () => {
        const seen: SavePromptResult[] = []
        const m = new SavePromptModel('Save changes?', 'Save', "Don't Save", (r) => seen.push(r))
        m.SaveCommand.Execute(undefined)
        m.DontSaveCommand.Execute(undefined)
        m.CancelCommand.Execute(undefined)
        expect(seen).toEqual([SavePromptResult.Save, SavePromptResult.DontSave, SavePromptResult.Cancel])
    })

    it('exposes label + message DPs the template binds', () => {
        const m = new SavePromptModel('Msg', 'Save', 'Discard', () => {})
        expect(m.Message).toBe('Msg')
        expect(m.SaveLabel).toBe('Save')
        expect(m.DontSaveLabel).toBe('Discard')
    })
})

describe('promptSave', () => {
    it('returns Cancel when there is no DialogService (headless/test)', async () => {
        expect(await promptSave(undefined, { title: 'T', message: 'M' })).toBe(SavePromptResult.Cancel)
    })

    it('maps a scrim-dismissed (undefined) result to Cancel', async () => {
        const dialogs = { Show: async () => undefined, Close: () => {} } as never
        expect(await promptSave(dialogs, { title: 'T', message: 'M' })).toBe(SavePromptResult.Cancel)
    })

    it('resolves the value the model closed with', async () => {
        const dialogs = { Show: async () => SavePromptResult.Save, Close: () => {} } as never
        expect(await promptSave(dialogs, { title: 'T', message: 'M' })).toBe(SavePromptResult.Save)
    })
})

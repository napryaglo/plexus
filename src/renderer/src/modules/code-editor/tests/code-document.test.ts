import { test, expect } from 'vitest'
import { ObservableCollection } from '@pragmatic-lab/mural/runtime'

import { CodeDocument } from '../code-document.js'
import type { ICodeFile } from '../code-file.js'

// An in-memory ICodeFile — the document's ctor load() reads through it.
function codeFile(id: string, text = ''): ICodeFile & { written?: string }
{
    const f = {
        id,
        read: () => Promise.resolve(text),
        write(t: string) { f.written = t; return Promise.resolve() },
    } as ICodeFile & { written?: string }
    return f
}

test('Diagnostics defaults to an empty ObservableCollection', () => {
    const doc = new CodeDocument(codeFile('a.todl'))
    expect(doc.Diagnostics).toBeInstanceOf(ObservableCollection)
    expect(doc.Diagnostics.Count).toBe(0)
})

test('language is derived from the extension', () => {
    expect(new CodeDocument(codeFile('a.ts')).Language).toBe('typescript')
    expect(new CodeDocument(codeFile('a.todl')).Language).toBe('todl')
    expect(new CodeDocument(codeFile('a.unknown')).Language).toBe('plaintext')
})

test('Save writes Content through the file and clears dirty', async () => {
    const file = codeFile('a.todl')
    const doc = new CodeDocument(file)
    doc.Content = 'concept Thing;'
    expect(doc.IsDirty).toBe(true)
    await doc.Save()
    expect(file.written).toBe('concept Thing;')
    expect(doc.IsDirty).toBe(false)
})

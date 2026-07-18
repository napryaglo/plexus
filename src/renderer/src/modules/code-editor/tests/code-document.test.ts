import { test, expect } from 'vitest'
import { ObservableCollection } from '@pragmatic-lab/mural/runtime'

import { CodeDocument } from '../code-document.js'
import type { FileSystemService } from '../../../services/file-system/file-system-service.js'

// A fake FileSystemService whose ReadText resolves empty — the document's ctor
// load() runs but seeds no text (this file exercises the Diagnostics channel).
const fakeFs = { ReadText: () => Promise.resolve('') } as unknown as FileSystemService

test('Diagnostics defaults to an empty ObservableCollection', () => {
    const doc = new CodeDocument('a.todl', fakeFs)
    expect(doc.Diagnostics).toBeInstanceOf(ObservableCollection)
    expect(doc.Diagnostics.Count).toBe(0)
})

test('language is derived from the extension', () => {
    expect(new CodeDocument('a.ts', fakeFs).Language).toBe('typescript')
    expect(new CodeDocument('a.unknown', fakeFs).Language).toBe('plaintext')
})

import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { ContentHostService, DocumentsContentHostService } from '@pragmatic-lab/mural/framework'

import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { CodeDocument } from '../../../code-editor/code-document.js'
import { StorageCodeFile } from '../../../code-editor/code-file.js'
import { EditorSeverity } from '../../../code-editor/editor-diagnostic.js'
import {
    MetaModelValidationService,
    validateSources,
    overlaySources,
} from '../meta-model-validation-service.js'

// Verified-clean / erroring TODL (see the empirical probe in the factory test).
const CONCEPTS = 'namespace d { concept model { label : string; } concept component { label : string; } }'
const EA = 'namespace d { meta-model ea { name = "EA"; version = 1; root-concept = model; top-level-concepts = [ component ]; } }'
const BAD = 'namespace d { concept { label : string; } }'   // missing name → syntax error

// ── pure core ──

test('validateSources localizes a syntax error to its own file, leaving others clean', () => {
    const byUri = validateSources([
        { uri: 'a.todl', text: BAD },
        { uri: 'b.todl', text: CONCEPTS },
    ])
    expect(byUri.get('a.todl')!.length).toBe(1)
    expect(byUri.get('a.todl')![0]?.severity).toBe(EditorSeverity.Error)
    expect(byUri.get('b.todl')!.length).toBe(0)
})

test('validateSources returns empty per-file entries for a clean cross-file project', () => {
    const byUri = validateSources([
        { uri: 'concepts.todl', text: CONCEPTS },
        { uri: 'ea.todl', text: EA },   // references model/component defined in the other file
    ])
    expect(byUri.get('concepts.todl')).toEqual([])
    expect(byUri.get('ea.todl')).toEqual([])
})

test('overlaySources prefers open buffers and adds open-only files', () => {
    const merged = overlaySources(
        [{ uri: 'a.todl', text: 'old' }, { uri: 'b.todl', text: 'stored' }],
        [{ id: 'a.todl', text: 'edited' }, { id: 'c.todl', text: 'new' }],
    )
    const byUri = new Map(merged.map((s) => [s.uri, s.text]))
    expect(byUri.get('a.todl')).toBe('edited')   // open buffer wins
    expect(byUri.get('b.todl')).toBe('stored')   // stored-only kept
    expect(byUri.get('c.todl')).toBe('new')      // open-only added
})

// ── service integration (real content host, diagnostics distributed to docs) ──

function env(): { service: MetaModelValidationService; host: DocumentsContentHostService }
{
    const provider = new ServiceProvider()
    const host = new DocumentsContentHostService(provider)
    provider.registerInstance(ContentHostService.Key, host)
    return { service: new MetaModelValidationService(provider), host }
}

test('validates two projects independently and distributes to each doc; clears on fix', async () => {
    const { service, host } = env()
    // Two separate projects (storages), each with one open .todl document.
    const sA = new FakeStorage('A'); await sA.WriteText('a.todl', BAD)
    const sB = new FakeStorage('B'); await sB.WriteText('b.todl', CONCEPTS)

    const a = new CodeDocument(new StorageCodeFile(sA, 'a.todl'))
    const b = new CodeDocument(new StorageCodeFile(sB, 'b.todl'))
    a.Content = BAD              // seed the live buffers deterministically
    b.Content = CONCEPTS
    host.Open(a)
    host.Open(b)

    service.AttachDocument(a, sA)
    service.AttachDocument(b, sB)
    await service.Revalidate()

    expect(a.Diagnostics.Count).toBe(1)   // project A's error localizes to A's doc
    expect(b.Diagnostics.Count).toBe(0)   // project B is clean

    a.Content = 'namespace d { concept task { label : string; } }'   // fix project A
    await service.Revalidate()
    expect(a.Diagnostics.Count).toBe(0)

    service.Dispose()
})

test('validateSources surfaces a TODL throw as a project-level error, not a crash', () => {
    // Two files each defining `model` makes TODL throw (duplicate node) rather
    // than emit a diagnostic; the pass must still return, marking every file.
    const byUri = validateSources([
        { uri: 'a.todl', text: CONCEPTS },
        { uri: 'b.todl', text: CONCEPTS },
    ])
    expect(byUri.get('a.todl')!.length).toBe(1)
    expect(byUri.get('b.todl')!.length).toBe(1)
    expect(byUri.get('a.todl')![0]?.message).toMatch(/validation failed/i)
})

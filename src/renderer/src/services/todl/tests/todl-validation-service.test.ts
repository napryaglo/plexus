import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { ContentHostService, DocumentsContentHostService } from '@pragmatic-lab/mural/framework'
import { check, toJSON } from '@pragmatic-lab/todl'

import { FakeStorage } from '../../storage/tests/fake-storage.js'
import { StorageProviderRegistry } from '../../storage/storage-provider-registry.js'
import { PROJECT_MANIFEST_FILENAME } from '../../projects/project-factory.js'
import { META_MODELS_BACKEND_ID } from '../../../modules/meta-model/services/meta-models-backend.js'
import { CodeDocument } from '../../../modules/code-editor/code-document.js'
import { StorageCodeFile } from '../../../modules/code-editor/code-file.js'
import { EditorSeverity } from '../../../modules/code-editor/editor-diagnostic.js'
import { DiagnosticsService } from '../../diagnostics/diagnostics-service.js'
import { DiagnosticSeverity } from '../../diagnostics/diagnostic.js'
import {
    TodlValidationService,
    validateSources,
    overlaySources,
} from '../todl-validation-service.js'

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

// ── base-aware validation ──

// A meta-model base: a component concept with a taxonomy-typed `category` field,
// plus the taxonomy. A usage that names a NON-existent taxonomy term errors only
// when the base is present (without it, `component` is an unresolved placeholder
// with no schema, so the value goes unchecked).
const META = `namespace ea {
  concept category { label : string; }
  concept component { category : component-category; }
  taxonomy component-category : represents category { term platform-api { label = "API"; } }
}`
const BAD_USAGE = 'namespace u { component c { category = component-category.ghost; } }'

test('validateSources uses the given bases (a bad taxonomy value errors only against the base)', () => {
    const base = toJSON(check([{ uri: 'ea.todl', text: META }]).model)
    const withBase = validateSources([{ uri: 'u.todl', text: BAD_USAGE }], [base])
    const without = validateSources([{ uri: 'u.todl', text: BAD_USAGE }])
    expect(withBase.get('u.todl')!.length).toBeGreaterThan(0)   // base resolves component's schema → value checked
    expect(without.get('u.todl')!.length).toBe(0)               // no base → under-validated
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

function env(): { service: TodlValidationService; host: DocumentsContentHostService; diagnostics: DiagnosticsService }
{
    const provider = new ServiceProvider()
    const host = new DocumentsContentHostService(provider)
    provider.registerInstance(ContentHostService.Key, host)
    const diagnostics = new DiagnosticsService(provider)
    provider.registerInstance(DiagnosticsService.Key, diagnostics)
    return { service: new TodlValidationService(provider), host, diagnostics }
}

test('validates a project with no open editor and publishes to the store', async () => {
    const { service, diagnostics } = env()
    const proj = new FakeStorage('proj')
    await proj.WriteText('a.todl', BAD)
    await proj.WriteText('b.todl', CONCEPTS)

    service.AttachProject('/proj', 'Proj', proj)   // no AttachDocument — no editor open
    await service.Revalidate()

    // a.todl has the syntax error; b.todl is clean; all published under project /proj.
    const forA = diagnostics.ForUri('a.todl')
    expect(forA.length).toBe(1)
    expect(forA[0]!.projectId).toBe('/proj')
    expect(forA[0]!.projectName).toBe('Proj')
    expect(forA[0]!.owner).toBe('todl')
    expect(forA[0]!.severity).toBe(DiagnosticSeverity.Error)
    expect(diagnostics.ForUri('b.todl')).toEqual([])
})

test('DetachProject clears the project\'s diagnostics from the store', async () => {
    const { service, diagnostics } = env()
    const proj = new FakeStorage('proj')
    await proj.WriteText('a.todl', BAD)
    service.AttachProject('/proj', 'Proj', proj)
    await service.Revalidate()
    expect(diagnostics.ForUri('a.todl').length).toBe(1)

    service.DetachProject(proj)
    expect(diagnostics.All.Count).toBe(0)
})

test('validates two projects independently and distributes to each doc; clears on fix', async () => {
    const { service, host, diagnostics } = env()
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
    service.AttachProject('A', 'A', sA)
    service.AttachProject('B', 'B', sB)
    await service.Revalidate()

    expect(diagnostics.ForUri('a.todl').length).toBe(1)   // project A's error localizes to A's doc
    expect(diagnostics.ForUri('b.todl').length).toBe(0)   // project B is clean

    a.Content = 'namespace d { concept task { label : string; } }'   // fix project A
    await service.Revalidate()
    expect(diagnostics.ForUri('a.todl').length).toBe(0)

    service.Dispose()
})

// ── base cache + ClearBaseCache (the Refresh-Bases contract) ──

// A clean library source (no cross-refs) so the only diagnostic in play is the
// unresolved-base binding error — present while ea@1 is unpublished, gone once
// it is published AND the cache is cleared.
const CLEAN_LIB = 'namespace u { concept widget { label : string; } }'

function baseEnv(): { service: TodlValidationService; host: DocumentsContentHostService; meta: FakeStorage; diagnostics: DiagnosticsService }
{
    const provider = new ServiceProvider()
    const host = new DocumentsContentHostService(provider)
    provider.registerInstance(ContentHostService.Key, host)
    const registry = new StorageProviderRegistry(provider)
    const meta = new FakeStorage('fake://meta-models')
    registry.Register(META_MODELS_BACKEND_ID, () => meta)
    provider.registerInstance(StorageProviderRegistry.Key, registry)
    const diagnostics = new DiagnosticsService(provider)
    provider.registerInstance(DiagnosticsService.Key, diagnostics)
    return { service: new TodlValidationService(provider), host, meta, diagnostics }
}

test('bases are cached until ClearBaseCache, then a republished base is re-resolved', async () => {
    const { service, host, meta, diagnostics } = baseEnv()
    // A library project bound to ea@1, which is NOT published yet.
    const proj = new FakeStorage('proj')
    await proj.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'library', metaModel: { id: 'ea', version: '1' } }))
    await proj.WriteText('u.todl', CLEAN_LIB)
    const doc = new CodeDocument(new StorageCodeFile(proj, 'u.todl'))
    doc.Content = CLEAN_LIB
    host.Open(doc)
    service.AttachDocument(doc, proj)
    service.AttachProject('proj', 'proj', proj)

    const projLevelCount = (): number => [...diagnostics.All].filter((d) => d.uri === null).length

    await service.Revalidate()
    expect(projLevelCount()).toBe(1)   // unresolved-base binding error

    // Publish ea@1, but do NOT clear the cache — the stale "not published" result stands.
    await meta.WriteText('ea/1/model.json', JSON.stringify(toJSON(check([{ uri: 'ea.todl', text: META }]).model)))
    await service.Revalidate()
    expect(projLevelCount()).toBe(1)   // still cached

    // Refresh Bases: drop this project's cache → the base resolves, error clears.
    service.ClearBaseCache(proj)
    await service.Revalidate()
    expect(projLevelCount()).toBe(0)

    service.Dispose()
})

test('an unresolved base surfaces as a project-level (null-uri) diagnostic in the store', async () => {
    const { service, diagnostics } = baseEnv()
    const proj = new FakeStorage('proj')
    await proj.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'library', metaModel: { id: 'ea', version: '1' } }))
    await proj.WriteText('u.todl', CLEAN_LIB)
    service.AttachProject('/proj', 'Proj', proj)
    await service.Revalidate()

    const projLevel = [...diagnostics.All].filter((d) => d.uri === null)
    expect(projLevel.length).toBe(1)
    expect(projLevel[0]!.message).toMatch(/unresolved base/i)
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

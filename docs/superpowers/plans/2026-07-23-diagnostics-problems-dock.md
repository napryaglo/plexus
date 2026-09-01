# Diagnostics & Problems Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface TODL compilation/publishing errors in a source-agnostic diagnostics store feeding an always-visible, navigable Problems dock in the shell's bottom Status region.

**Architecture:** A root-scoped `DiagnosticsService` is the single source of truth for every diagnostic, keyed by `(owner, projectId)`. `TodlValidationService` becomes a producer that validates each open project whole (on project-open and on edits) and publishes the full diagnostic set. The Monaco editor and a `ProblemsService`-backed dock both consume from the store. Publish routes failures into the dock.

**Tech Stack:** TypeScript, Electron, `@pragmatic-tech-ai/mural` (UI framework + runtime: `Model`, `ObservableCollection`, `ServiceBase`, `ServiceKey`, `RelayCommand`, `.mu` templates), `@pragmatic-tech-ai/todl` (validation), Monaco editor, Vitest.

## Global Constraints

- Every test file lives in a `tests/` subfolder next to the code it exercises (e.g. `src/renderer/src/services/diagnostics/tests/diagnostics-service.test.ts`), never beside the source. Vitest globs `src/**/*.test.ts`.
- Use real TypeScript `enum`s, never string-literal union types (project rule).
- No relative `../src` imports into the framework — consume `@pragmatic-tech-ai/mural` / `@pragmatic-tech-ai/todl` from the package.
- Diagnostic positions are 1-based; `endColumn` is exclusive (Monaco + TODL convention).
- `projectId` is the project's `Project.RootPath` (the only stable identity); `projectName` is `Project.Name`.
- The producer id ("owner") for TODL diagnostics is the string `"todl"`.
- Follow existing file style: 4-space indent, `.js` import suffixes on local imports, DP-backed model properties via `Model.RegisterProperty`.

**Verify commands** (run from `Plexus/`):
- Typecheck: `npm run typecheck`
- A single test file: `npx vitest run src/renderer/src/services/diagnostics/tests/diagnostics-service.test.ts`

---

## File Structure

**New files:**
- `src/renderer/src/services/diagnostics/diagnostic.ts` — the `Diagnostic` / `DiagnosticSeverity` / `DiagnosticSpan` types + `toEditorDiagnostic()` projection.
- `src/renderer/src/services/diagnostics/diagnostics-service.ts` — the `DiagnosticsService` store.
- `src/renderer/src/services/diagnostics/tests/diagnostic.test.ts`
- `src/renderer/src/services/diagnostics/tests/diagnostics-service.test.ts`
- `src/renderer/src/modules/problems/problems-service.ts` — grouped view + counts + expand + navigation.
- `src/renderer/src/modules/problems/tests/problems-service.test.ts`
- `src/renderer/src/modules/problems/problems.module.mu` — Status-region `.ShellControls:` contribution.
- `src/renderer/src/modules/problems/problems.resources.mu` — `DataTemplate[ProblemsService]` + row templates.

**Modified files:**
- `src/renderer/src/services/todl/todl-validation-service.ts` — publish to `DiagnosticsService`; project registry (`AttachProject`/`DetachProject`); base problems as project-level.
- `src/renderer/src/services/todl/tests/todl-validation-service.test.ts` — assert against the store.
- `src/renderer/src/modules/meta-model/services/todl-document-factory.ts` — wire the open doc's `Diagnostics` from `DiagnosticsService.SubscribeUri`.
- `src/renderer/src/modules/code-editor/code-editor.ts` — add `RevealSpan`.
- `src/renderer/src/modules/code-editor/code-document.ts` — expose the reveal request path (a `RevealSpan` DP the editor honors).
- `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts` — `AttachProject`/`DetachProject` on open/close; publish routing (expand dock).
- `src/renderer/src/app.mu` — register `DiagnosticsService`; add `ProblemsModule`; merge `ProblemsResources`.

---

## Task 1: Diagnostic model + projection

**Files:**
- Create: `src/renderer/src/services/diagnostics/diagnostic.ts`
- Test: `src/renderer/src/services/diagnostics/tests/diagnostic.test.ts`

**Interfaces:**
- Produces: `enum DiagnosticSeverity { Error, Warning, Info, Hint }`; `interface DiagnosticSpan { startLine; startColumn; endLine; endColumn }`; `interface Diagnostic { owner: string; projectId: string; projectName: string; uri: string | null; message: string; severity: DiagnosticSeverity; span: DiagnosticSpan | null; code?: string }`; `function toEditorDiagnostic(d: Diagnostic): EditorDiagnostic`.
- Consumes: `EditorDiagnostic`, `EditorSeverity` from `../../modules/code-editor/editor-diagnostic.js`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/services/diagnostics/tests/diagnostic.test.ts`:

```ts
import { test, expect } from 'vitest'
import { EditorSeverity } from '../../../modules/code-editor/editor-diagnostic.js'
import { DiagnosticSeverity, toEditorDiagnostic, type Diagnostic } from '../diagnostic.js'

const spanned: Diagnostic = {
    owner: 'todl', projectId: '/p', projectName: 'P', uri: 'a.todl',
    message: 'bad', severity: DiagnosticSeverity.Warning,
    span: { startLine: 3, startColumn: 5, endLine: 3, endColumn: 9 },
}

test('toEditorDiagnostic copies span + maps severity', () => {
    const e = toEditorDiagnostic(spanned)
    expect(e).toEqual({
        severity: EditorSeverity.Warning, message: 'bad',
        startLine: 3, startColumn: 5, endLine: 3, endColumn: 9,
    })
})

test('toEditorDiagnostic collapses a null span to document start', () => {
    const projLevel: Diagnostic = { ...spanned, span: null, severity: DiagnosticSeverity.Error }
    const e = toEditorDiagnostic(projLevel)
    expect(e).toEqual({
        severity: EditorSeverity.Error, message: 'bad',
        startLine: 1, startColumn: 1, endLine: 1, endColumn: 2,
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/services/diagnostics/tests/diagnostic.test.ts`
Expected: FAIL — `Cannot find module '../diagnostic.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/src/services/diagnostics/diagnostic.ts`:

```ts
import { EditorSeverity, type EditorDiagnostic } from '../../modules/code-editor/editor-diagnostic.js'

// The canonical, source-agnostic diagnostic. Producers (e.g. the TODL validator)
// publish these to the DiagnosticsService; the Problems dock and the editor
// consume them. Richer than EditorDiagnostic: it carries which project and file
// (or none, for a project-level problem like an unresolved base binding) and
// which producer emitted it ("owner"), so the store can replace a producer's
// slice atomically.
export enum DiagnosticSeverity { Error, Warning, Info, Hint }

// 1-based line/column; endColumn is exclusive (Monaco + TODL convention).
export interface DiagnosticSpan
{
    startLine:   number
    startColumn: number
    endLine:     number
    endColumn:   number
}

export interface Diagnostic
{
    owner:       string                 // producer id, e.g. "todl"
    projectId:   string                 // Project.RootPath — the open project's identity
    projectName: string                 // Project.Name — for the dock's group header
    uri:         string | null          // project-relative file; null ⇒ project-level
    message:     string
    severity:    DiagnosticSeverity
    span:        DiagnosticSpan | null   // null for project-level diagnostics
    code?:       string                 // reserved rule id (unused in v1)
}

const EDITOR_SEVERITY: Record<DiagnosticSeverity, EditorSeverity> = {
    [DiagnosticSeverity.Error]:   EditorSeverity.Error,
    [DiagnosticSeverity.Warning]: EditorSeverity.Warning,
    [DiagnosticSeverity.Info]:    EditorSeverity.Info,
    [DiagnosticSeverity.Hint]:    EditorSeverity.Hint,
}

// Project the canonical diagnostic down to the editor's host-neutral shape. A
// null span (a project-level diagnostic) collapses to the document start, the
// same convention the validator already used for unattributed diagnostics.
export function toEditorDiagnostic(d: Diagnostic): EditorDiagnostic
{
    const span = d.span ?? { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 }
    return {
        severity:    EDITOR_SEVERITY[d.severity],
        message:     d.message,
        startLine:   span.startLine,
        startColumn: span.startColumn,
        endLine:     span.endLine,
        endColumn:   span.endColumn,
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/services/diagnostics/tests/diagnostic.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/services/diagnostics/diagnostic.ts src/renderer/src/services/diagnostics/tests/diagnostic.test.ts
git commit -m "feat(diagnostics): canonical Diagnostic type + editor projection"
```

---

## Task 2: DiagnosticsService store

**Files:**
- Create: `src/renderer/src/services/diagnostics/diagnostics-service.ts`
- Test: `src/renderer/src/services/diagnostics/tests/diagnostics-service.test.ts`

**Interfaces:**
- Consumes: `Diagnostic` from `./diagnostic.js`; `ServiceBase`, `ServiceKey`, `ObservableCollection`, `IServiceProvider` from `@pragmatic-tech-ai/mural/runtime`.
- Produces:
  - `class DiagnosticsService extends ServiceBase` with `static readonly Key`.
  - `Publish(owner: string, projectId: string, diagnostics: readonly Diagnostic[]): void` — replaces the whole `(owner, projectId)` slice.
  - `ClearProject(projectId: string): void` — drops all owners' slices for a project.
  - `readonly All: ObservableCollection<Diagnostic>` — the flat live set (dock binds a grouped view over it).
  - `ForUri(uri: string): Diagnostic[]` — current snapshot for a file.
  - `SubscribeUri(uri: string, listener: (diags: Diagnostic[]) => void): () => void` — reactive per-file feed; fires immediately with the current snapshot, then on every change.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/services/diagnostics/tests/diagnostics-service.test.ts`:

```ts
import { test, expect, vi } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DiagnosticsService } from '../diagnostics-service.js'
import { DiagnosticSeverity, type Diagnostic } from '../diagnostic.js'

function diag(over: Partial<Diagnostic>): Diagnostic
{
    return {
        owner: 'todl', projectId: '/p', projectName: 'P', uri: 'a.todl',
        message: 'm', severity: DiagnosticSeverity.Error, span: null, ...over,
    }
}

function svc(): DiagnosticsService { return new DiagnosticsService(new ServiceProvider()) }

test('Publish replaces the whole (owner, project) slice', () => {
    const s = svc()
    s.Publish('todl', '/p', [diag({ uri: 'a.todl' }), diag({ uri: 'b.todl' })])
    expect(s.All.Count).toBe(2)
    s.Publish('todl', '/p', [diag({ uri: 'a.todl' })])   // republish: b's diagnostic is gone
    expect(s.All.Count).toBe(1)
    expect(s.ForUri('b.todl')).toEqual([])
})

test('Publish keeps other owners and other projects intact', () => {
    const s = svc()
    s.Publish('todl', '/p', [diag({ uri: 'a.todl' })])
    s.Publish('todl', '/q', [diag({ projectId: '/q', uri: 'a.todl' })])
    s.Publish('lint', '/p', [diag({ owner: 'lint', uri: 'a.todl' })])
    expect(s.All.Count).toBe(3)
    s.Publish('todl', '/p', [])                          // clear only todl@/p
    expect(s.All.Count).toBe(2)
})

test('ClearProject drops all owners for that project only', () => {
    const s = svc()
    s.Publish('todl', '/p', [diag({ uri: 'a.todl' })])
    s.Publish('lint', '/p', [diag({ owner: 'lint', uri: 'a.todl' })])
    s.Publish('todl', '/q', [diag({ projectId: '/q', uri: 'a.todl' })])
    s.ClearProject('/p')
    expect(s.All.Count).toBe(1)
    expect(s.All.Get(0)!.projectId).toBe('/q')
})

test('ForUri returns only that file\'s diagnostics', () => {
    const s = svc()
    s.Publish('todl', '/p', [diag({ uri: 'a.todl' }), diag({ uri: 'b.todl' }), diag({ uri: null })])
    expect(s.ForUri('a.todl').length).toBe(1)
    expect(s.ForUri('b.todl').length).toBe(1)
    expect(s.ForUri('a.todl')[0]!.uri).toBe('a.todl')
})

test('SubscribeUri fires immediately then on each change; unsubscribe stops it', () => {
    const s = svc()
    const seen: number[] = []
    const listener = vi.fn((d: Diagnostic[]) => seen.push(d.length))
    const unsub = s.SubscribeUri('a.todl', listener)
    expect(seen).toEqual([0])                             // immediate empty snapshot
    s.Publish('todl', '/p', [diag({ uri: 'a.todl' })])
    expect(seen).toEqual([0, 1])
    unsub()
    s.Publish('todl', '/p', [])                           // no further calls after unsub
    expect(seen).toEqual([0, 1])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/services/diagnostics/tests/diagnostics-service.test.ts`
Expected: FAIL — `Cannot find module '../diagnostics-service.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/src/services/diagnostics/diagnostics-service.ts`:

```ts
import { ServiceBase, ServiceKey, ObservableCollection, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { Diagnostic } from './diagnostic.js'

// The single, source-agnostic store for every diagnostic in the app. Producers
// (the TODL validator today; diagram/other validators later) Publish the whole
// diagnostic set for one (owner, project) key at a time; the store replaces that
// slice atomically, so a producer's re-run naturally drops the problems it no
// longer reports. Consumers — the Problems dock (grouped over All) and the code
// editor (per-uri) — subscribe. It knows nothing about TODL.
export class DiagnosticsService extends ServiceBase
{
    public static readonly Key = new ServiceKey<DiagnosticsService>('DiagnosticsService')

    // Slices keyed "owner projectId" → that producer's diagnostics for that
    // project. The flat `All` collection is rebuilt from the slices on each change
    // so bindings over it stay live.
    private readonly slices = new Map<string, Diagnostic[]>()
    private readonly all = new ObservableCollection<Diagnostic>()
    private readonly uriListeners = new Map<string, Set<(d: Diagnostic[]) => void>>()

    constructor(provider: IServiceProvider) { super(provider) }

    public get All(): ObservableCollection<Diagnostic> { return this.all }

    private static sliceKey(owner: string, projectId: string): string { return `${owner} ${projectId}` }

    // Replace all diagnostics for one (owner, project). Empty array clears the slice.
    public Publish(owner: string, projectId: string, diagnostics: readonly Diagnostic[]): void
    {
        const key = DiagnosticsService.sliceKey(owner, projectId)
        if (diagnostics.length === 0) this.slices.delete(key)
        else this.slices.set(key, [...diagnostics])
        this.rebuild()
    }

    // Drop every owner's slice for a project (on project close).
    public ClearProject(projectId: string): void
    {
        let changed = false
        for (const key of [...this.slices.keys()]) {
            if (key.endsWith(` ${projectId}`)) { this.slices.delete(key); changed = true }
        }
        if (changed) this.rebuild()
    }

    // Current snapshot for a file.
    public ForUri(uri: string): Diagnostic[]
    {
        const out: Diagnostic[] = []
        for (const list of this.slices.values()) for (const d of list) if (d.uri === uri) out.push(d)
        return out
    }

    // Reactive per-file feed: fires immediately with the current snapshot, then on
    // every subsequent change. Returns an unsubscribe thunk.
    public SubscribeUri(uri: string, listener: (diags: Diagnostic[]) => void): () => void
    {
        let set = this.uriListeners.get(uri)
        if (set === undefined) { set = new Set(); this.uriListeners.set(uri, set) }
        set.add(listener)
        listener(this.ForUri(uri))
        return () => {
            const s = this.uriListeners.get(uri)
            if (s === undefined) return
            s.delete(listener)
            if (s.size === 0) this.uriListeners.delete(uri)
        }
    }

    // Recompute the flat All collection from the slices and notify per-uri listeners.
    private rebuild(): void
    {
        this.all.Clear()
        for (const list of this.slices.values()) for (const d of list) this.all.Add(d)
        for (const [uri, set] of this.uriListeners) {
            const snapshot = this.ForUri(uri)
            for (const l of set) l(snapshot)
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/services/diagnostics/tests/diagnostics-service.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/services/diagnostics/diagnostics-service.ts src/renderer/src/services/diagnostics/tests/diagnostics-service.test.ts
git commit -m "feat(diagnostics): source-agnostic DiagnosticsService store"
```

---

## Task 3: TodlValidationService becomes a producer (+ project registry, app.mu registration)

Adds whole-project validation independent of open editors and dual-writes diagnostics to the store while keeping the existing per-doc squiggle writes (so nothing breaks mid-plan; Task 4 removes the per-doc writes).

**Files:**
- Modify: `src/renderer/src/services/todl/todl-validation-service.ts`
- Modify: `src/renderer/src/services/todl/tests/todl-validation-service.test.ts`
- Modify: `src/renderer/src/app.mu` (register `DiagnosticsService`)

**Interfaces:**
- Consumes: `DiagnosticsService` (`./`-relative from todl folder: `../diagnostics/diagnostics-service.js`), `Diagnostic`, `DiagnosticSeverity` from `../diagnostics/diagnostic.js`.
- Produces (new public methods on `TodlValidationService`):
  - `AttachProject(projectId: string, projectName: string, storage: IStorage): void` — register an open project so it validates whole, even with no editor open.
  - `DetachProject(storage: IStorage): void` — unregister; clears its base cache and its diagnostics from the store.

- [ ] **Step 1: Write the failing test**

In `src/renderer/src/services/todl/tests/todl-validation-service.test.ts`, add these imports at the top (after the existing imports):

```ts
import { DiagnosticsService } from '../../diagnostics/diagnostics-service.js'
import { DiagnosticSeverity } from '../../diagnostics/diagnostic.js'
```

Then change the two env builders to register a `DiagnosticsService` and return it, and add new tests. Replace the existing `env()` function with:

```ts
function env(): { service: TodlValidationService; host: DocumentsContentHostService; diagnostics: DiagnosticsService }
{
    const provider = new ServiceProvider()
    const host = new DocumentsContentHostService(provider)
    provider.registerInstance(ContentHostService.Key, host)
    const diagnostics = new DiagnosticsService(provider)
    provider.registerInstance(DiagnosticsService.Key, diagnostics)
    return { service: new TodlValidationService(provider), host, diagnostics }
}
```

Add a new test that exercises whole-project validation with NO open editor:

```ts
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
```

Add a base-problem test in `baseEnv` style — first update `baseEnv()` to register + return a `DiagnosticsService`:

```ts
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
```

Note: the existing tests that assert `doc.Diagnostics.Count` still pass in this task because we keep the per-doc writes (dual-write). But those tests attach documents without `AttachProject`; update them so the doc's project is registered. In the existing test `'validates two projects independently…'`, add after the two `AttachDocument` calls:

```ts
    service.AttachProject('A', 'A', sA)
    service.AttachProject('B', 'B', sB)
```

And in `'bases are cached until ClearBaseCache…'`, after `service.AttachDocument(doc, proj)` add:

```ts
    service.AttachProject('proj', 'proj', proj)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/services/todl/tests/todl-validation-service.test.ts`
Expected: FAIL — `service.AttachProject is not a function` (and `DiagnosticsService` import resolves).

- [ ] **Step 3: Write minimal implementation**

In `src/renderer/src/services/todl/todl-validation-service.ts`:

3a. Add imports near the top (after the existing `import type { BaseBindings }` line):

```ts
import { DiagnosticsService } from '../diagnostics/diagnostics-service.js'
import { DiagnosticSeverity, type Diagnostic, type DiagnosticSpan } from '../diagnostics/diagnostic.js'
```

3b. Add a severity map from TODL `Severity` to `DiagnosticSeverity` (below the existing `SEVERITY_MAP`):

```ts
const CANON_SEVERITY: Record<string, DiagnosticSeverity> = {
    [Severity.Error]:   DiagnosticSeverity.Error,
    [Severity.Warning]: DiagnosticSeverity.Warning,
}
```

3c. Add an `openProjects` registry field and a `TODL_OWNER` const. Inside the class, after the `tracked` map declaration add:

```ts
    // Open projects (storage → identity), registered by the explorer on project
    // open. This is the unit of validation: a project validates whole even with
    // no editor open. Tracked docs only overlay live buffers + trigger passes.
    private readonly openProjects = new Map<IStorage, { projectId: string; projectName: string }>()
```

And add near the top of the file (module scope, next to `DEBOUNCE_MS`):

```ts
const TODL_OWNER = 'todl'
```

3d. Add the `diagnostics` accessor next to the existing `host` getter:

```ts
    private get diagnostics(): DiagnosticsService | undefined
    {
        return this.Provider.get(DiagnosticsService.Key)
    }
```

3e. Add the public `AttachProject` / `DetachProject` methods (after `ClearBaseCache`):

```ts
    // Register an open project so it validates whole (independent of open editors).
    // Idempotent; schedules a pass so the dock is populated on project open.
    public AttachProject(projectId: string, projectName: string, storage: IStorage): void
    {
        this.openProjects.set(storage, { projectId, projectName })
        this.scheduleRevalidate()
    }

    // Unregister a project on close: drop its base cache and its diagnostics.
    public DetachProject(storage: IStorage): void
    {
        const info = this.openProjects.get(storage)
        this.openProjects.delete(storage)
        this.baseCache.delete(storage)
        if (info !== undefined) this.diagnostics?.ClearProject(info.projectId)
    }
```

3f. Add a helper to convert an `EditorDiagnostic`'s span to a `DiagnosticSpan` and build a canonical `Diagnostic`. But the mapping is cleaner directly from the TODL diagnostics. Add a module-scope helper that maps one TODL `Diagnostic` to a canonical `Diagnostic` given project identity (place it beside `diagnosticToEditor`):

```ts
// Map a spanned TODL diagnostic to a canonical Diagnostic for a project. A null
// span (unattributed / whole-model) becomes a project-level diagnostic (uri null).
export function diagnosticToCanonical(
    d: Diagnostic_TODL, projectId: string, projectName: string,
): Diagnostic
{
    const span: DiagnosticSpan | null = d.span
        ? { startLine: d.span.start.line, startColumn: d.span.start.column,
            endLine: d.span.end.line, endColumn: d.span.end.column }
        : null
    return {
        owner: TODL_OWNER, projectId, projectName,
        uri: d.span?.uri ?? null,
        message: d.message,
        severity: CANON_SEVERITY[d.severity] ?? DiagnosticSeverity.Error,
        span,
    }
}
```

Because the file already imports `Diagnostic` from `@pragmatic-tech-ai/todl` under that name, alias the TODL import to avoid a name clash. Change the existing top import line:

```ts
import { checkAgainst, Severity, type Diagnostic, type SourceFile, type TodlDocument } from '@pragmatic-tech-ai/todl'
```
to:
```ts
import { checkAgainst, Severity, type Diagnostic as Diagnostic_TODL, type SourceFile, type TodlDocument } from '@pragmatic-tech-ai/todl'
```
and update the two existing references to the TODL diagnostic type in this file (`diagnosticToEditor(d: Diagnostic)` and `let diagnostics: readonly Diagnostic[]` inside `validateSources`) to use `Diagnostic_TODL`.

3g. Replace the `Revalidate()` method body so it iterates `openProjects` (not tracked-doc storages), publishes canonical diagnostics to the store, AND keeps the existing per-doc `EditorDiagnostic` writes:

```ts
    public async Revalidate(): Promise<void>
    {
        // Group tracked (open) docs by their storage for buffer overlay + squiggles.
        const docsByStorage = new Map<IStorage, CodeDocument[]>()
        for (const [doc, { storage }] of this.tracked) {
            const list = docsByStorage.get(storage)
            if (list === undefined) docsByStorage.set(storage, [doc])
            else list.push(doc)
        }

        for (const [storage, { projectId, projectName }] of this.openProjects) {
            const { bases, problems } = await this.basesFor(storage)
            const stored = await collectTodlSources(storage)
            const docs = docsByStorage.get(storage) ?? []
            const open = docs.map((d) => ({ id: d.Id, text: d.Content }))
            const sources = overlaySources(stored, open)

            // Canonical diagnostics for the store (every file in the project).
            const canonical: Diagnostic[] = []
            try {
                for (const d of checkAgainst(bases, sources).diagnostics) {
                    canonical.push(diagnosticToCanonical(d, projectId, projectName))
                }
            } catch (e) {
                const message = `Validation failed: ${(e as Error).message}`
                for (const s of sources) {
                    canonical.push({
                        owner: TODL_OWNER, projectId, projectName, uri: s.uri,
                        message, severity: DiagnosticSeverity.Error, span: null,
                    })
                }
            }
            if (problems.length > 0) {
                canonical.push({
                    owner: TODL_OWNER, projectId, projectName, uri: null,
                    message: `Unresolved base: ${problems.join('; ')}.`,
                    severity: DiagnosticSeverity.Error, span: null,
                })
            }
            this.diagnostics?.Publish(TODL_OWNER, projectId, canonical)

            // Keep per-doc squiggles working (dual-write; removed in Task 4).
            const byUri = validateSources(sources, bases)
            const bindingError = problems.length > 0
                ? { severity: EditorSeverity.Error, message: `Unresolved base: ${problems.join('; ')}.`,
                    startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 }
                : undefined
            for (const doc of docs) {
                const target = doc.Diagnostics
                target.Clear()
                if (bindingError !== undefined) target.Add(bindingError)
                for (const dg of byUri.get(doc.Id) ?? []) target.Add(dg)
            }
        }
    }
```

3h. So a project with open docs but not yet AttachProject'd still validates (defensive), have `AttachDocument` register a placeholder project when its storage is unknown — but per the flow the explorer always AttachProjects first. To keep the invariant simple and avoid orphan passes, no change to `AttachDocument` is needed; docs whose storage has no `openProjects` entry are simply skipped by `Revalidate`. (The existing tests updated in Step 1 add the matching `AttachProject` calls.)

3i. In `Dispose()`, also clear `openProjects`. Change the body to add:

```ts
        this.openProjects.clear()
```
(alongside the existing `this.baseCache.clear()`).

3j. Register `DiagnosticsService` in `src/renderer/src/app.mu`. Add the import near the `TodlValidationService` import:

```ts
import DiagnosticsService from "./services/diagnostics/diagnostics-service.js"
```
and in the `.services:` block, add it just before `TodlValidationService`:

```ts
        // Source-agnostic diagnostics store — the single sink the TODL validator
        // publishes to and the Problems dock + editor consume from.
        DiagnosticsService
        // Shared base-aware TODL validator (meta-model / library / architecture).
        TodlValidationService
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/services/todl/tests/todl-validation-service.test.ts`
Expected: PASS (existing tests + 3 new tests).

Then: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/services/todl/todl-validation-service.ts src/renderer/src/services/todl/tests/todl-validation-service.test.ts src/renderer/src/app.mu
git commit -m "feat(diagnostics): TodlValidationService publishes whole-project diagnostics to the store"
```

---

## Task 4: Editor consumes diagnostics from the store; add RevealSpan

Flips the editor's squiggle source from validator-pushes-into-doc to doc-subscribes-to-store, and adds a reveal path for dock navigation.

**Files:**
- Modify: `src/renderer/src/services/todl/todl-validation-service.ts` (remove per-doc writes)
- Modify: `src/renderer/src/services/todl/tests/todl-validation-service.test.ts` (assert against store instead of doc)
- Modify: `src/renderer/src/modules/meta-model/services/todl-document-factory.ts` (wire doc ← store)
- Modify: `src/renderer/src/modules/code-editor/code-document.ts` (add `RevealRequest` DP)
- Modify: `src/renderer/src/modules/code-editor/code-editor.ts` (honor `RevealRequest`)

**Interfaces:**
- Consumes: `DiagnosticsService.SubscribeUri`, `toEditorDiagnostic` from `../../../services/diagnostics/diagnostic.js`.
- Produces: `CodeDocument.RequestReveal(line: number, column: number): void`; the editor reveals + selects on that request.

- [ ] **Step 1: Update the validation-service test to assert against the store**

In `todl-validation-service.test.ts`, the existing `'validates two projects independently and distributes to each doc; clears on fix'` test asserts `a.Diagnostics.Count`. Because the validator no longer writes docs, rewrite its assertions to read the store. Replace the assertion lines:

```ts
    expect(a.Diagnostics.Count).toBe(1)   // project A's error localizes to A's doc
    expect(b.Diagnostics.Count).toBe(0)   // project B is clean

    a.Content = 'namespace d { concept task { label : string; } }'   // fix project A
    await service.Revalidate()
    expect(a.Diagnostics.Count).toBe(0)
```
with:
```ts
    expect(diagnostics.ForUri('a.todl').length).toBe(1)   // project A's error localizes to A's doc
    expect(diagnostics.ForUri('b.todl').length).toBe(0)   // project B is clean

    a.Content = 'namespace d { concept task { label : string; } }'   // fix project A
    await service.Revalidate()
    expect(diagnostics.ForUri('a.todl').length).toBe(0)
```
(The `env()` builder already returns `diagnostics`; destructure it: change `const { service, host } = env()` to `const { service, host, diagnostics } = env()`.)

Similarly, in `'bases are cached until ClearBaseCache…'`, replace the three `doc.Diagnostics.Count` assertions with store reads via a null-uri project-level check. Change `const { service, host, meta } = baseEnv()` to `const { service, host, meta, diagnostics } = baseEnv()` and replace:
```ts
    expect(doc.Diagnostics.Count).toBe(1)   // unresolved-base binding error
```
with (there is one project-level diagnostic while unpublished):
```ts
    expect([...diagnostics.All].filter((d) => d.uri === null).length).toBe(1)
```
and the two later `expect(doc.Diagnostics.Count).toBe(1)` / `.toBe(0)` with the same `filter((d) => d.uri === null).length` pattern (`1`, then `0`).

- [ ] **Step 2: Remove the per-doc write block from Revalidate**

In `todl-validation-service.ts`, delete the entire "Keep per-doc squiggles working (dual-write; removed in Task 4)" block from `Revalidate()` (from `const byUri = validateSources(sources, bases)` through the closing of the `for (const doc of docs)` loop). Keep the canonical publish. `validateSources`, `diagnosticToEditor`, `overlaySources` remain exported (still used by unit tests + the doc-factory subscription path uses `toEditorDiagnostic` instead).

- [ ] **Step 3: Run the validation-service test to verify it passes**

Run: `npx vitest run src/renderer/src/services/todl/tests/todl-validation-service.test.ts`
Expected: PASS.

- [ ] **Step 4: Add the RevealRequest DP to CodeDocument**

In `src/renderer/src/modules/code-editor/code-document.ts`, add a DP + method. After the `DiagnosticsKey` declaration add:

```ts
    // A one-shot reveal request (line/column, 1-based) the editor honors to scroll
    // to + select a span — used by the Problems dock to navigate to a diagnostic.
    // The editor listens for changes; the value is a monotonically-updated tuple so
    // repeated reveals to the same position still fire.
    public static readonly RevealRequestKey = Model.RegisterProperty<{ line: number; column: number; seq: number } | undefined>(
        CodeDocument, 'RevealRequest', undefined, MetaData.None)
```

Add a getter + method near the other getters:

```ts
    public get RevealRequest(): { line: number; column: number; seq: number } | undefined
    { return this.get_property_value(CodeDocument.RevealRequestKey) }

    private revealSeq = 0

    public RequestReveal(line: number, column: number): void
    {
        this.revealSeq += 1
        this.set_property_value(CodeDocument.RevealRequestKey, { line, column, seq: this.revealSeq })
    }
```

- [ ] **Step 5: Honor RevealRequest in the editor + add the Monaco reveal**

In `src/renderer/src/modules/code-editor/code-editor.ts`, bind the new property and act on it. In the property-binding setup where `Text`/`Language`/`Diagnostics` are bound, add a binding for `RevealRequest`; and in the `OnPropertyChanged`-style handler (where `Language` is handled, around line 171), add a branch:

```ts
            else if (descriptor.Name === 'RevealRequest') {
                const req = newValue as { line: number; column: number } | undefined
                if (req !== undefined) this.revealSpan(req.line, req.column)
            }
```

Add the private method (near the editor field usage):

```ts
    private revealSpan(line: number, column: number): void
    {
        if (this.editor === undefined) return
        const range = new monaco.Range(line, column, line, column)
        this.editor.revealRangeInCenter(range, monaco.editor.ScrollType.Smooth)
        this.editor.setSelection(range)
        this.editor.focus()
    }
```

(Confirm `monaco` is already imported at the top of `code-editor.ts` — it is, as `import * as monaco from 'monaco-editor'`.)

- [ ] **Step 6: Wire the open doc's Diagnostics from the store in the doc factory**

In `src/renderer/src/modules/meta-model/services/todl-document-factory.ts`, replace the `openFile` body so the doc mirrors the store's per-uri feed. Add imports:

```ts
import { DiagnosticsService } from '../../../services/diagnostics/diagnostics-service.js'
import { toEditorDiagnostic } from '../../../services/diagnostics/diagnostic.js'
```

Change `openFile` to subscribe the doc to the store and unsubscribe on close:

```ts
    public async openFile(storage: IStorage, path: string): Promise<IDocument>
    {
        const doc = new CodeDocument(new StorageCodeFile(storage, path))
        this.Provider.get(TodlValidationService.Key)?.AttachDocument(doc, storage)

        // Mirror the store's per-file diagnostics into the doc's Diagnostics
        // collection (the editor binds it → Monaco squiggles). Single source of
        // truth is the DiagnosticsService; the validator only publishes there.
        const diagnostics = this.Provider.get(DiagnosticsService.Key)
        if (diagnostics !== undefined) {
            const unsub = diagnostics.SubscribeUri(doc.Id, (diags) => {
                doc.Diagnostics.Clear()
                for (const d of diags) doc.Diagnostics.Add(toEditorDiagnostic(d))
            })
            const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
            const hostUnsub = host?.OpenDocuments.Subscribe((change) => {
                if ((change.kind === 'removed' && change.items.includes(doc))
                    || change.kind === 'cleared') { unsub(); hostUnsub?.() }
            })
        }
        return doc
    }
```

Add the needed imports for `ContentHostService` / `DocumentsContentHostService` at the top if not present:

```ts
import { ContentHostService, type DocumentsContentHostService } from '@pragmatic-tech-ai/mural/framework'
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npx vitest run src/renderer/src/services/todl src/renderer/src/services/diagnostics`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/services/todl/todl-validation-service.ts src/renderer/src/services/todl/tests/todl-validation-service.test.ts src/renderer/src/modules/meta-model/services/todl-document-factory.ts src/renderer/src/modules/code-editor/code-document.ts src/renderer/src/modules/code-editor/code-editor.ts
git commit -m "feat(diagnostics): editor consumes diagnostics from the store; add reveal-span navigation"
```

---

## Task 5: Project lifecycle wiring (AttachProject / DetachProject)

**Files:**
- Modify: `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts`

**Interfaces:**
- Consumes: `TodlValidationService.AttachProject/DetachProject` (Task 3), resolved via `this.Provider.get(TodlValidationService.Key)`.

This task is UI-service wiring in a heavy service; verification is typecheck + manual smoke (there is no lightweight unit harness for `ProjectExplorerService`).

- [ ] **Step 1: Attach a project to the validator on open**

In `project-explorer-service.ts`, in `addOpenProject()` (the method that constructs `OpenProject` and adds it to `OpenProjects`), after `this.OpenProjects.Add(op)` add:

```ts
        this.Provider.get(TodlValidationService.Key)?.AttachProject(op.Project.RootPath, op.Project.Name, op.Storage)
```

Confirm `TodlValidationService` is imported at the top of the file; if not, add:

```ts
import { TodlValidationService } from '../../../services/todl/todl-validation-service.js'
```

- [ ] **Step 2: Detach on close**

In `closeProject()`, before `this.OpenProjects.Remove(op)` add:

```ts
        this.Provider.get(TodlValidationService.Key)?.DetachProject(op.Storage)
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Manual smoke (documented, not automated)**

Run the app: `npm run dev`. Open a meta-model or library project that has a `.todl` file with a deliberate syntax error, WITHOUT opening the file. Confirm (after the dock lands in Task 7) the error is counted. For now, add a temporary `console.log` in `AttachProject` to confirm it fires on open and `DetachProject` on close, then remove it.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/project-explorer/services/project-explorer-service.ts
git commit -m "feat(diagnostics): validate projects on open, clear on close"
```

---

## Task 6: ProblemsService (grouped view + counts + expand + navigation)

**Files:**
- Create: `src/renderer/src/modules/problems/problems-service.ts`
- Test: `src/renderer/src/modules/problems/tests/problems-service.test.ts`

**Interfaces:**
- Consumes: `DiagnosticsService` (`../../services/diagnostics/diagnostics-service.js`), `Diagnostic`, `DiagnosticSeverity`; `CodeEditorService.OpenFile`; `RelayCommand`, `Model`, `ObservableCollection`, `ServiceBase`, `ServiceKey`, `ICommand`, `MetaData`.
- Produces:
  - `class ProblemsRow extends Model` — a flat dock row: `Kind` (`ProblemRowKind.ProjectHeader | FileHeader | Diagnostic`), `Label`, `Detail` (e.g. `line:col`), `Severity`, `Icon`-select fields, plus `ProjectId`/`Uri`/`Line`/`Column` for navigation.
  - `class ProblemsService extends ServiceBase` with `static readonly Key`; observable `Rows: ObservableCollection<ProblemsRow>`, `ErrorCount: number`, `WarningCount: number`, `IsExpanded: boolean`; `ToggleCommand: ICommand`; `Expand(): void`; `ActivateRow(row: ProblemsRow): void` (opens file + requests reveal).

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/modules/problems/tests/problems-service.test.ts`:

```ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DiagnosticsService } from '../../../services/diagnostics/diagnostics-service.js'
import { DiagnosticSeverity, type Diagnostic } from '../../../services/diagnostics/diagnostic.js'
import { ProblemsService, ProblemRowKind } from '../problems-service.js'

function diag(over: Partial<Diagnostic>): Diagnostic
{
    return {
        owner: 'todl', projectId: '/p', projectName: 'P', uri: 'a.todl',
        message: 'm', severity: DiagnosticSeverity.Error,
        span: { startLine: 2, startColumn: 3, endLine: 2, endColumn: 4 }, ...over,
    }
}

function env(): { store: DiagnosticsService; problems: ProblemsService }
{
    const provider = new ServiceProvider()
    const store = new DiagnosticsService(provider)
    provider.registerInstance(DiagnosticsService.Key, store)
    const problems = new ProblemsService(provider)
    return { store, problems }
}

test('counts errors and warnings across the store', () => {
    const { store, problems } = env()
    store.Publish('todl', '/p', [
        diag({ uri: 'a.todl', severity: DiagnosticSeverity.Error }),
        diag({ uri: 'a.todl', severity: DiagnosticSeverity.Warning }),
    ])
    expect(problems.ErrorCount).toBe(1)
    expect(problems.WarningCount).toBe(1)
})

test('single project: file headers, no project header', () => {
    const { store, problems } = env()
    store.Publish('todl', '/p', [diag({ uri: 'a.todl' }), diag({ uri: 'b.todl' })])
    const kinds = [...problems.Rows].map((r) => r.Kind)
    expect(kinds).not.toContain(ProblemRowKind.ProjectHeader)
    expect(kinds.filter((k) => k === ProblemRowKind.FileHeader).length).toBe(2)
    expect(kinds.filter((k) => k === ProblemRowKind.Diagnostic).length).toBe(2)
})

test('multi-project: a project header per project', () => {
    const { store, problems } = env()
    store.Publish('todl', '/p', [diag({ projectId: '/p', projectName: 'P', uri: 'a.todl' })])
    store.Publish('todl', '/q', [diag({ projectId: '/q', projectName: 'Q', uri: 'a.todl' })])
    const headers = [...problems.Rows].filter((r) => r.Kind === ProblemRowKind.ProjectHeader)
    expect(headers.map((h) => h.Label).sort()).toEqual(['P', 'Q'])
})

test('project-level (null-uri) diagnostic groups under a Project bucket', () => {
    const { store, problems } = env()
    store.Publish('todl', '/p', [diag({ uri: null, message: 'Unresolved base: ea@1.' })])
    const fileHeaders = [...problems.Rows].filter((r) => r.Kind === ProblemRowKind.FileHeader)
    expect(fileHeaders.map((h) => h.Label)).toContain('Project')
})

test('IsExpanded starts collapsed; ToggleCommand flips it; Expand forces open', () => {
    const { problems } = env()
    expect(problems.IsExpanded).toBe(false)
    problems.ToggleCommand.Execute(undefined)
    expect(problems.IsExpanded).toBe(true)
    problems.ToggleCommand.Execute(undefined)
    expect(problems.IsExpanded).toBe(false)
    problems.Expand()
    expect(problems.IsExpanded).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/problems/tests/problems-service.test.ts`
Expected: FAIL — `Cannot find module '../problems-service.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/src/modules/problems/problems-service.ts`:

```ts
import {
    Model, MetaData, ObservableCollection, ServiceBase, ServiceKey, RelayCommand,
    type ICommand, type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'
import { DiagnosticsService } from '../../services/diagnostics/diagnostics-service.js'
import { DiagnosticSeverity, type Diagnostic } from '../../services/diagnostics/diagnostic.js'
import { CodeEditorService } from '../code-editor/code-editor-service.js'

// The three kinds of flat row the dock renders (a flattened tree: project → file
// → diagnostic). The template switches its chrome on Kind.
export enum ProblemRowKind { ProjectHeader, FileHeader, Diagnostic }

const PROJECT_BUCKET = 'Project'   // label for the null-uri (project-level) group

// One row in the dock. A Model so the .mu template binds $Label / $Detail / etc.
export class ProblemsRow extends Model
{
    public static readonly KindKey = Model.RegisterProperty<ProblemRowKind>(
        ProblemsRow, 'Kind', ProblemRowKind.Diagnostic, MetaData.None)
    public static readonly LabelKey = Model.RegisterProperty<string>(ProblemsRow, 'Label', '', MetaData.None)
    public static readonly DetailKey = Model.RegisterProperty<string>(ProblemsRow, 'Detail', '', MetaData.None)
    public static readonly SeverityKey = Model.RegisterProperty<DiagnosticSeverity>(
        ProblemsRow, 'Severity', DiagnosticSeverity.Error, MetaData.None)
    public static readonly IsErrorKey = Model.RegisterProperty<boolean>(ProblemsRow, 'IsError', false, MetaData.None)
    public static readonly ProjectIdKey = Model.RegisterProperty<string>(ProblemsRow, 'ProjectId', '', MetaData.None)
    public static readonly UriKey = Model.RegisterProperty<string | null>(ProblemsRow, 'Uri', null, MetaData.None)
    public static readonly LineKey = Model.RegisterProperty<number>(ProblemsRow, 'Line', 1, MetaData.None)
    public static readonly ColumnKey = Model.RegisterProperty<number>(ProblemsRow, 'Column', 1, MetaData.None)

    constructor(init: {
        kind: ProblemRowKind; label: string; detail?: string; severity?: DiagnosticSeverity;
        projectId?: string; uri?: string | null; line?: number; column?: number
    })
    {
        super()
        this.set_property_value(ProblemsRow.KindKey, init.kind)
        this.set_property_value(ProblemsRow.LabelKey, init.label)
        this.set_property_value(ProblemsRow.DetailKey, init.detail ?? '')
        this.set_property_value(ProblemsRow.SeverityKey, init.severity ?? DiagnosticSeverity.Error)
        this.set_property_value(ProblemsRow.IsErrorKey, (init.severity ?? DiagnosticSeverity.Error) === DiagnosticSeverity.Error)
        this.set_property_value(ProblemsRow.ProjectIdKey, init.projectId ?? '')
        this.set_property_value(ProblemsRow.UriKey, init.uri ?? null)
        this.set_property_value(ProblemsRow.LineKey, init.line ?? 1)
        this.set_property_value(ProblemsRow.ColumnKey, init.column ?? 1)
    }

    public get Kind(): ProblemRowKind { return this.get_property_value(ProblemsRow.KindKey) }
    public get Label(): string { return this.get_property_value(ProblemsRow.LabelKey) }
    public get ProjectId(): string { return this.get_property_value(ProblemsRow.ProjectIdKey) }
    public get Uri(): string | null { return this.get_property_value(ProblemsRow.UriKey) }
    public get Line(): number { return this.get_property_value(ProblemsRow.LineKey) }
    public get Column(): number { return this.get_property_value(ProblemsRow.ColumnKey) }
}

// A grouped, observable view over the DiagnosticsService, rendered in the shell's
// Status region as the Problems dock. Rebuilds its flat Rows whenever the store
// changes; exposes rolled-up counts, an expand toggle, and row activation
// (open file + reveal the span).
export class ProblemsService extends ServiceBase
{
    public static readonly Key = new ServiceKey<ProblemsService>('ProblemsService')

    public static readonly RowsKey = Model.RegisterProperty<ObservableCollection<ProblemsRow>>(
        ProblemsService, 'Rows', undefined as unknown as ObservableCollection<ProblemsRow>, MetaData.None)
    public static readonly ErrorCountKey = Model.RegisterProperty<number>(ProblemsService, 'ErrorCount', 0, MetaData.None)
    public static readonly WarningCountKey = Model.RegisterProperty<number>(ProblemsService, 'WarningCount', 0, MetaData.None)
    public static readonly IsExpandedKey = Model.RegisterProperty<boolean>(ProblemsService, 'IsExpanded', false, MetaData.None)
    public static readonly ToggleCommandKey = Model.RegisterProperty<ICommand>(
        ProblemsService, 'ToggleCommand', undefined as unknown as ICommand, MetaData.None)

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.set_property_value(ProblemsService.RowsKey, new ObservableCollection<ProblemsRow>())
        this.set_property_value(ProblemsService.ToggleCommandKey,
            new RelayCommand(() => { this.IsExpanded = !this.IsExpanded }))
        const store = provider.get(DiagnosticsService.Key)
        store?.All.Subscribe(() => this.rebuild())
        this.rebuild()
    }

    public get Rows(): ObservableCollection<ProblemsRow> { return this.get_property_value(ProblemsService.RowsKey) }
    public get ErrorCount(): number { return this.get_property_value(ProblemsService.ErrorCountKey) }
    public get WarningCount(): number { return this.get_property_value(ProblemsService.WarningCountKey) }
    public get IsExpanded(): boolean { return this.get_property_value(ProblemsService.IsExpandedKey) }
    public set IsExpanded(v: boolean) { this.set_property_value(ProblemsService.IsExpandedKey, v) }
    public get ToggleCommand(): ICommand { return this.get_property_value(ProblemsService.ToggleCommandKey) }

    public Expand(): void { this.IsExpanded = true }

    // Open the row's file and scroll to its span (project-level rows do nothing).
    public ActivateRow(row: ProblemsRow): void
    {
        if (row.Uri === null) return
        const editor = this.Provider.get(CodeEditorService.Key)
        editor?.OpenFile(row.Uri)
        // The reveal is best-effort; the CodeDocument exposes RequestReveal and the
        // editor honors it. The open path dedupes to the existing tab.
        const doc = editor?.DocumentFor(row.Uri)
        doc?.RequestReveal(row.Line, row.Column)
    }

    private rebuild(): void
    {
        const store = this.Provider.get(DiagnosticsService.Key)
        const all: Diagnostic[] = store ? [...store.All] : []

        let errors = 0, warnings = 0
        for (const d of all) {
            if (d.severity === DiagnosticSeverity.Error) errors += 1
            else if (d.severity === DiagnosticSeverity.Warning) warnings += 1
        }
        this.set_property_value(ProblemsService.ErrorCountKey, errors)
        this.set_property_value(ProblemsService.WarningCountKey, warnings)

        // Group project → file (null-uri under a "Project" bucket), stable-ordered.
        const byProject = new Map<string, { name: string; byFile: Map<string, Diagnostic[]> }>()
        for (const d of all) {
            let proj = byProject.get(d.projectId)
            if (proj === undefined) { proj = { name: d.projectName, byFile: new Map() }; byProject.set(d.projectId, proj) }
            const fileKey = d.uri ?? PROJECT_BUCKET
            const list = proj.byFile.get(fileKey)
            if (list === undefined) proj.byFile.set(fileKey, [d]); else list.push(d)
        }

        const rows = this.Rows
        rows.Clear()
        const multiProject = byProject.size > 1
        for (const [projectId, proj] of byProject) {
            if (multiProject) rows.Add(new ProblemsRow({ kind: ProblemRowKind.ProjectHeader, label: proj.name }))
            for (const [fileKey, diags] of proj.byFile) {
                const fileLabel = fileKey === PROJECT_BUCKET ? PROJECT_BUCKET : fileNameOf(fileKey)
                rows.Add(new ProblemsRow({ kind: ProblemRowKind.FileHeader, label: fileLabel, detail: `${diags.length}` }))
                for (const d of diags) {
                    rows.Add(new ProblemsRow({
                        kind: ProblemRowKind.Diagnostic,
                        label: d.message,
                        detail: d.span ? `${d.span.startLine}:${d.span.startColumn}` : '',
                        severity: d.severity,
                        projectId,
                        uri: d.uri,
                        line: d.span?.startLine ?? 1,
                        column: d.span?.startColumn ?? 1,
                    }))
                }
            }
        }
    }
}

function fileNameOf(path: string): string
{
    const parts = path.split(/[\\/]/)
    return parts[parts.length - 1] || path
}
```

Note: `ActivateRow` calls `editor?.DocumentFor(row.Uri)`. Verify `CodeEditorService` exposes a way to get the open `CodeDocument` for a path; if the method is named differently, adapt. If no such accessor exists, add one to `code-editor-service.ts`:

```ts
    // The open document for a path, if any (used to drive a reveal after OpenFile).
    public DocumentFor(path: string): CodeDocument | undefined { return this.open.get(path) }
```
(`this.open` is the `Map<string, CodeDocument>` the service already keeps; confirm its name from Task-2 exploration of `code-editor-service.ts`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/problems/tests/problems-service.test.ts`
Expected: PASS (5 tests).

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/problems/problems-service.ts src/renderer/src/modules/problems/tests/problems-service.test.ts src/renderer/src/modules/code-editor/code-editor-service.ts
git commit -m "feat(problems): grouped ProblemsService view with counts, expand, navigation"
```

---

## Task 7: Problems dock UI + publish routing

**Files:**
- Create: `src/renderer/src/modules/problems/problems.resources.mu`
- Create: `src/renderer/src/modules/problems/problems.module.mu`
- Modify: `src/renderer/src/app.mu` (register module + service + merge resources)
- Modify: `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts` (publish routing)

**Interfaces:**
- Consumes: `ProblemsService` (Task 6), the shell's `ShellControlDefinition` StatusBar contribution, `DataTemplate[ProblemsService]`.

UI + integration task; verification is typecheck + manual smoke.

- [ ] **Step 1: Write the dock template**

Create `src/renderer/src/modules/problems/problems.resources.mu`:

```mu
// problems.resources.mu — the Problems dock (Status-region) view.
//
// DataTemplate[ProblemsService] renders a collapsed summary cell (error/warning
// counts) that expands into a scrollable, grouped list of ProblemsRow items. The
// ShellControlDefinition in problems.module.mu places it in the StatusBar region
// with DataContext = ProblemsService (always visible, document-independent).

import ProblemsService from "./problems-service.js"

resources {
    // Collapsed summary + expandable list. The summary button toggles IsExpanded;
    // the list is shown only when expanded.
    DataTemplate x:key="ProblemsDock" [ DataType = ProblemsService ] {
        StackPanel [ Orientation = Vertical, VerticalAlignment = Bottom ] {
            // Expanded list — grouped rows. Height-capped, vertically scrollable.
            Border x:name="Panel"
                [ Visibility  = Collapsed,
                  Background   = @Surface,
                  BorderBrush  = @OutlineVariant,
                  BorderThickness = (0,1,0,0),
                  MaxHeight    = 220 ] {
                ScrollViewer [ HorizontalScrollEnabled = false ] {
                    ItemsControl [ ItemsSource = $Rows, ItemsPanel = @VerticalStackPanel ]
                }
            }
            // Collapsed summary cell — a toggle that reveals the panel.
            Button [ Command = $ToggleCommand, HorizontalAlignment = Left, Padding = (8,2,8,2) ] {
                StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {
                    Border [ Width = 8, Height = 8, CornerRadius = (4), Background = #f44336, Margin = (0,0,4,0), VerticalAlignment = Center ]
                    TextBlock [ Text = $ErrorCount, FontSize = 11, Foreground = @OnSurfaceVariant, Margin = (0,0,10,0), VerticalAlignment = Center ]
                    Border [ Width = 8, Height = 8, CornerRadius = (4), Background = #ff9800, Margin = (0,0,4,0), VerticalAlignment = Center ]
                    TextBlock [ Text = $WarningCount, FontSize = 11, Foreground = @OnSurfaceVariant, VerticalAlignment = Center ]
                }
            }
        }
        when ( $IsExpanded ) {
            Panel.Visibility = Visible;
        }
    }

    // One row: project header / file header / diagnostic — chrome switches on Kind.
    // A diagnostic row is a button that activates navigation via the service.
    DataTemplate [ DataType = ProblemsRow ] {
        TextBlock
            [ Text       = $Label,
              FontSize   = 11,
              Margin     = (12,1,8,1),
              Foreground = @OnSurface ]
    }
}
```

Note on row activation: wiring per-row click to `ProblemsService.ActivateRow(row)` requires a command on the row or an ambient command. Keep v1 simple — render rows as text (above). If the framework's `ItemsControl` supports an item-click command binding to the parent service, add it in a follow-up; otherwise add a `RelayCommand` field to `ProblemsRow` that closes over the service. This is a deliberate v1 scope line (navigation-by-click), logged here rather than silently dropped.

- [ ] **Step 2: Write the module contribution**

Create `src/renderer/src/modules/problems/problems.module.mu`:

```mu
// problems.module.mu — the Problems dock module.
//
// Registers the ProblemsService and contributes a StatusBar-region ShellControl
// that renders it via the @ProblemsDock template. DataContext = ProblemsService
// makes the cell always-visible and document-independent (the shell resolves the
// root service as the template's data context — see toolbar-service.SyncStatusItems).

import ProblemsService from "./problems-service.js"

module ProblemsModule [ Name = "Problems" ] {
    .services: {
        ProblemsService
    }

    .ShellControls: {
        ShellControlDefinition
            [ Template    = @ProblemsDock,
              DataContext = ProblemsService,
              Region      = StatusBar,
              Alignment   = End ]
    }
}
```

- [ ] **Step 3: Register in app.mu**

In `src/renderer/src/app.mu`:

Add the module import beside the other module imports:
```ts
import ProblemsModule from "./modules/problems/problems.module.mu.js"
```
Add the resources import beside the other resource imports:
```ts
import ProblemsResources from "./modules/problems/problems.resources.mu.js"
```
Add `ProblemsModule` to the `.modules:` block (after `AgentChatModule`):
```ts
        ProblemsModule
```
Add the merge in the `resources:` block (near the other `merge` lines):
```ts
        // Problems dock (DataTemplate[ProblemsService] + ProblemsRow rows).
        merge ProblemsResources
```

(`DiagnosticsService` was already registered in Task 3. `ProblemsService` is registered by the module's `.services:` block, which is root-scoped — consistent with the other module services.)

- [ ] **Step 4: Publish routing — expand the dock on failure**

In `project-explorer-service.ts`, change `publishProject()` to refresh validation, then expand the dock when the publish is blocked:

```ts
    private async publishProject(op: OpenProject): Promise<void>
    {
        if (!isPublishable(op.Factory)) { this.Status = "This project type can't be published."; return }
        // Refresh diagnostics so the dock reflects the exact state publish sees.
        const validator = this.Provider.get(TodlValidationService.Key)
        validator?.ClearBaseCache(op.Storage)
        await validator?.Revalidate()
        try {
            const result = await op.Factory.publish(op.Project, op.Storage, this.Provider)
            this.Status = result.message
            if (!result.ok) this.Provider.get(ProblemsService.Key)?.Expand()
        } catch (e) {
            this.Status = `Publish failed: ${(e as Error).message}`
            this.Provider.get(ProblemsService.Key)?.Expand()
        }
    }
```

Add the import at the top:
```ts
import { ProblemsService } from '../../problems/problems-service.js'
```

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build` (compiles `.mu` templates)
Expected: build succeeds; `problems.resources.mu.js` and `problems.module.mu.js` are generated.

- [ ] **Step 6: Manual smoke (documented)**

Run `npm run dev`:
1. Open a meta-model project with a `.todl` syntax error. Without opening the file, confirm the Status-bar dock shows a red error count > 0.
2. Click the summary cell → the panel expands and lists the file with the error message and `line:col`.
3. Fix the error in the editor → the count drops to 0 live (250ms debounce).
4. Trigger Publish on a project with an error → status reads a blocked message and the dock auto-expands.
5. Open a second project; confirm project headers appear grouping each project's problems.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/modules/problems/problems.module.mu src/renderer/src/modules/problems/problems.resources.mu src/renderer/src/app.mu src/renderer/src/modules/project-explorer/services/project-explorer-service.ts
git commit -m "feat(problems): Status-region dock + publish routes failures into it"
```

---

## Self-Review

**Spec coverage:**
- DiagnosticsService source-agnostic store → Task 1 (types) + Task 2 (store). ✓
- Continuous whole-project validation on project-open, no editor needed → Task 3 (`AttachProject`, `Revalidate` iterates `openProjects`) + Task 5 (wired to open/close). ✓
- All open projects, grouped project → file → Task 6 (`rebuild` grouping, multi-project headers). ✓
- Publish routes into the dock → Task 7 Step 4. ✓
- Bottom Status-region dock, always visible → Task 7 (`ShellControlDefinition` `DataContext`/`Region=StatusBar`, verified via `SyncStatusItems`). ✓
- Monaco consumes from the store; squiggles preserved → Task 4 (doc ← `SubscribeUri`, dual-write removed). ✓
- Span-less base-binding diagnostics as project-level → Task 3 (null-uri publish) + Task 6 (Project bucket). ✓
- Navigation (open file + reveal span) → Task 4 (`RevealRequest` + `revealSpan`) + Task 6 (`ActivateRow`). ✓
- Multi-project close clears only that group → Task 2 (`ClearProject`) + Task 3 (`DetachProject`) + Task 5. ✓
- Tests in `tests/` subfolders, enums not string unions → all tasks. ✓

**Placeholder scan:** No TBD/TODO. Two explicit v1 scope lines are logged, not hidden: (a) per-row click-to-navigate wiring in Task 7 Step 1 (the service method `ActivateRow` is fully implemented and unit-testable; only the `.mu` click binding is deferred if the framework needs a per-row command); (b) the `code` field reserved on `Diagnostic`.

**Type consistency:** `Diagnostic`/`DiagnosticSeverity`/`DiagnosticSpan` defined in Task 1, used identically in Tasks 2/3/6. `AttachProject(projectId, projectName, storage)` defined in Task 3, called with the same argument order in Task 5. `SubscribeUri(uri, listener)` defined in Task 2, consumed in Tasks 4 and 6. `RequestReveal(line, column)` defined in Task 4, called in Task 6. `Publish(owner, projectId, diagnostics)` consistent across Tasks 2/3/7. `TODL_OWNER = "todl"` matches the `owner` assertions in tests.

**Open risk flagged for the implementer:** Task 6's `CodeEditorService.DocumentFor` and the private `this.open` map name are assumed from exploration; confirm the exact member name in `code-editor-service.ts` and adapt. Task 4's binding of a new DP (`RevealRequest`) in `code-editor.ts` must follow that file's existing property-binding mechanism (it binds `Text`/`Language`/`Diagnostics` — mirror that exact pattern).

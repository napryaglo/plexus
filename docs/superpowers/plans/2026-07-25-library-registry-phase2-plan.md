# Library Registry (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover published library bundles, compile each class's `.mural` template into a live `DataTemplate`, expose them through a `LibraryRegistry` resolver, and surface everything in a Libraries browse panel that renders each class through its template.

**Architecture:** Three units — a headless bundle loader (`library-loader.ts`), a mount+resolve service (`library-registry.ts` + `visual-library.ts`) that compiles `.mural` at runtime and merges the templates into `Application.Resources`, and a nav-capability browse panel (`libraries-panel-service.ts` + `library.resources.mu`). Failures report to the Problems dock via `DiagnosticsService`.

**Tech Stack:** TypeScript, Electron renderer, `@pragmatic-tech-ai/mural` (`compiler.instantiate`, `basic.DataTemplate`, `runtime.ResourceDictionary`/`Application`), Vitest, `FakeStorage`.

## Global Constraints

- **Every test file lives in a `tests/` subfolder** next to its source.
- **Enums over string-literal unions** in our own code.
- **Verified contracts (do not re-derive):**
  - `instantiate(source, ctx)` from `@pragmatic-tech-ai/mural/compiler`: a **bare-element** root (e.g. `TextBlock [ Text = $Display ]`) compiles as a fragment and returns a **zero-arg factory** `() => Visual`. There is **no `Fragment` keyword**. `ctx = { ...runtime, ...basic, ...visualEngine }`.
  - `DataTemplate` (from `@pragmatic-tech-ai/mural/basic`): `new DataTemplate(factory, dataType?)`; `Apply(data)` calls `factory(data)` and does **not** set `DataContext` — the factory must.
  - `Visual` has a settable `DataContext`.
  - `ContentPresenter.ContentTemplate` is a `DataTemplate | undefined` DP (`@pragmatic-tech-ai/mural/basic`).
  - Imports: `Visual, ResourceDictionary, Application, ServiceBase, ServiceKey, Model, MetaData, ObservableCollection, type IServiceProvider` ← `@pragmatic-tech-ai/mural/runtime`; `DataTemplate, type DataTemplateFactory, Border, TextBlock, ContentPresenter` ← `@pragmatic-tech-ai/mural/basic`; `instantiate` ← `@pragmatic-tech-ai/mural/compiler`.
  - `DiagnosticsService.Publish(owner, projectId, Diagnostic[])`; `Diagnostic = { owner, projectId, projectName, uri: string|null, message, severity, span: null }`; `DiagnosticSeverity.{Error,Warning}` (`../../../services/diagnostics/*`).
  - Libraries backend: `ensureLibrariesBackend(provider): IStorage`, layout `<id>/<version>/{library.json, visuals/<classId>.mural, …}`.
- **Bundle manifest (Phase 1):** `library.json = { id, version, name, description?, metaModel, classes: { id, localId?, label?, concept, template?, thumbnail?, doc? }[], assets, docs, samples }`.
- Single test file: `npx vitest run <path>`; full suite `npx vitest run`; markup compile `npm run compile:mu`; `npm run typecheck`.

---

## File Structure

- **Create** `src/renderer/src/modules/library/services/library-loader.ts` — loader types + `discoverLibraries`/`loadLibrary`/`readTemplateSource` (headless).
- **Create** `src/renderer/src/modules/library/services/visual-library.ts` — `buildCtx`, `compileTemplate`, `buildDefaultTemplate`.
- **Create** `src/renderer/src/modules/library/services/library-registry.ts` — `LibraryRegistry` service (mount, resolve, refresh, diagnostics).
- **Create** `src/renderer/src/modules/library/services/libraries-panel-service.ts` — `LibrariesPanelService` + `LibraryRow`/`ClassRow`/`ClassData` models.
- **Create** `src/renderer/src/modules/library/library.resources.mu` — panel DataTemplates.
- **Create** `src/renderer/src/icons/libraries.svg`.
- **Modify** `library.module.mu` (register registry + panel service, add Libraries capability), `plexus-icons.mu` (icon), `app.mu` (merge resources), `package.json` (compile:mu).
- **Tests:** one `tests/*.test.ts` per new service file (Tasks 1–4).

---

## Task 1: Bundle loader (headless)

**Files:**
- Create: `src/renderer/src/modules/library/services/library-loader.ts`
- Test: `src/renderer/src/modules/library/services/tests/library-loader.test.ts`

**Interfaces:**
- Consumes: `IStorage` (`List`, `ReadText`, `Exists`).
- Produces: types `LoadedClass`, `LoadedLibrary`, `LoadProblem` (see code) and
  `discoverLibraries(backend): Promise<LoadedLibrary[]>`,
  `loadLibrary(backend, id, version): Promise<LoadedLibrary>`,
  `readTemplateSource(backend, lib, cls): Promise<string | undefined>`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/modules/library/services/tests/library-loader.test.ts`:

```ts
import { test, expect } from 'vitest'

import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { discoverLibraries, loadLibrary } from '../library-loader.js'

function manifest(id: string): string {
    return JSON.stringify({
        id, version: '0.1.0', name: id, metaModel: { id: 'ea', version: '5' },
        classes: [{ id: `${id}.azure`, localId: 'azure', label: 'Azure', concept: 'location', template: `visuals/${id}.azure.mural` }],
        assets: [], docs: [], samples: [],
    })
}

test('discovers every published <id>/<version> and loads its classes', async () => {
    const b = new FakeStorage('fake://libraries')
    await b.WriteText('microsoft/0.1.0/library.json', manifest('microsoft'))
    await b.WriteText('microsoft/0.1.0/visuals/microsoft.azure.mural', 'TextBlock [ Text = $Display ]')
    await b.WriteText('aws/0.1.0/library.json', manifest('aws'))

    const libs = await discoverLibraries(b)
    expect(libs.map((l) => l.id).sort()).toEqual(['aws', 'microsoft'])
    const ms = libs.find((l) => l.id === 'microsoft')!
    expect(ms.classes[0]).toMatchObject({ id: 'microsoft.azure', concept: 'location', templatePath: 'visuals/microsoft.azure.mural' })
    expect(ms.problems).toEqual([])
})

test('a malformed manifest yields one error problem and no classes, not a throw', async () => {
    const b = new FakeStorage('fake://libraries')
    await b.WriteText('broken/0.1.0/library.json', '{ not json')
    const lib = await loadLibrary(b, 'broken', '0.1.0')
    expect(lib.classes).toEqual([])
    expect(lib.problems).toHaveLength(1)
    expect(lib.problems[0]).toMatchObject({ severity: 'error', uri: 'library.json' })
})

test('a class citing a missing template file records a warning but still loads', async () => {
    const b = new FakeStorage('fake://libraries')
    await b.WriteText('microsoft/0.1.0/library.json', manifest('microsoft'))   // template file absent
    const lib = await loadLibrary(b, 'microsoft', '0.1.0')
    expect(lib.classes).toHaveLength(1)
    expect(lib.problems).toEqual([{ severity: 'warning', uri: 'visuals/microsoft.azure.mural', message: expect.stringContaining('missing') }])
})
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-loader.test.ts`
Expected: FAIL — `../library-loader.js` does not exist.

- [ ] **Step 3: Implement the loader**

Create `src/renderer/src/modules/library/services/library-loader.ts`:

```ts
import type { IStorage } from '../../../services/storage/storage.js'

export interface LoadProblem { uri: string | null; message: string; severity: 'error' | 'warning' }

export interface LoadedClass
{
    id:            string
    localId?:      string
    label?:        string
    concept:       string
    templatePath?: string
    thumbnailPath?: string
    docPath?:      string
}

export interface LoadedLibrary
{
    id:        string
    version:   string
    name:      string
    metaModel: { id: string; version: string }
    classes:   LoadedClass[]
    problems:  LoadProblem[]
}

// Every published <id>/<version> under the backend, loaded. Directory layout is
// the Phase-1 publish layout: root dirs are ids, each id's dirs are versions.
export async function discoverLibraries(backend: IStorage): Promise<LoadedLibrary[]>
{
    const out: LoadedLibrary[] = []
    const ids = (await backend.List('')).filter((e) => e.IsDirectory).map((e) => e.Name).sort()
    for (const id of ids) {
        const versions = (await backend.List(id)).filter((e) => e.IsDirectory).map((e) => e.Name).sort()
        for (const version of versions) out.push(await loadLibrary(backend, id, version))
    }
    return out
}

// Load one library's manifest into a LoadedLibrary. A malformed/unreadable
// manifest yields empty classes + one error problem (never throws). A class that
// cites a template/thumbnail/doc file with no file on disk records a warning.
export async function loadLibrary(backend: IStorage, id: string, version: string): Promise<LoadedLibrary>
{
    const base = `${id}/${version}`
    const problems: LoadProblem[] = []
    let manifest: {
        id: string; version: string; name: string
        metaModel: { id: string; version: string }
        classes: Array<{ id: string; localId?: string; label?: string; concept: string; template?: string; thumbnail?: string; doc?: string }>
    }
    try {
        manifest = JSON.parse(await backend.ReadText(`${base}/library.json`))
    } catch (e) {
        return { id, version, name: id, metaModel: { id: '', version: '' }, classes: [],
                 problems: [{ severity: 'error', uri: 'library.json', message: `Library manifest is invalid: ${(e as Error).message}` }] }
    }

    const classes: LoadedClass[] = []
    for (const c of manifest.classes ?? []) {
        const cls: LoadedClass = { id: c.id, concept: c.concept }
        if (c.localId !== undefined) cls.localId = c.localId
        if (c.label !== undefined) cls.label = c.label
        for (const [field, path] of [['templatePath', c.template], ['thumbnailPath', c.thumbnail], ['docPath', c.doc]] as const) {
            if (path === undefined) continue
            if (await backend.Exists(`${base}/${path}`)) (cls as Record<string, unknown>)[field] = path
            else problems.push({ severity: 'warning', uri: path, message: `Referenced resource is missing: ${path}` })
        }
        classes.push(cls)
    }
    return { id: manifest.id, version: manifest.version, name: manifest.name, metaModel: manifest.metaModel, classes, problems }
}

// Read a class's template source on demand; undefined if absent/unreadable.
export async function readTemplateSource(backend: IStorage, lib: LoadedLibrary, cls: LoadedClass): Promise<string | undefined>
{
    if (cls.templatePath === undefined) return undefined
    try { return await backend.ReadText(`${lib.id}/${lib.version}/${cls.templatePath}`) }
    catch { return undefined }
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-loader.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/library/services/library-loader.ts src/renderer/src/modules/library/services/tests/library-loader.test.ts
git commit -m "feat(library): bundle loader — discover + load published library.json"
```

---

## Task 2: Runtime template compilation (`visual-library.ts`)

**Files:**
- Create: `src/renderer/src/modules/library/services/visual-library.ts`
- Test: `src/renderer/src/modules/library/services/tests/visual-library.test.ts`

**Interfaces:**
- Consumes: `instantiate` (compiler), `DataTemplate`/`DataTemplateFactory` (basic), `Visual` (runtime).
- Produces: `buildCtx(): Record<string, unknown>`, `compileTemplate(source, ctx): DataTemplate`, `buildDefaultTemplate(ctx): DataTemplate`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/modules/library/services/tests/visual-library.test.ts`:

```ts
import { test, expect } from 'vitest'

import { buildCtx, compileTemplate, buildDefaultTemplate } from '../visual-library.js'

test('compiles a bare-element fragment into a DataTemplate that materialises a Visual with the data context', () => {
    const ctx = buildCtx()
    const tmpl = compileTemplate('TextBlock [ Text = $Display ]', ctx)
    const visual = tmpl.Apply({ Display: 'Azure' }) as { constructor: { name: string }; DataContext: unknown }
    expect(visual.constructor.name).toBe('TextBlock')
    expect(visual.DataContext).toEqual({ Display: 'Azure' })
})

test('buildDefaultTemplate returns a usable DataTemplate', () => {
    const tmpl = buildDefaultTemplate(buildCtx())
    expect(typeof tmpl.Apply).toBe('function')
})

test('a malformed fragment throws (caller catches and falls back)', () => {
    expect(() => compileTemplate('This is not valid mural [[[', buildCtx())).toThrow()
})
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/visual-library.test.ts`
Expected: FAIL — `../visual-library.js` does not exist.

- [ ] **Step 3: Implement**

Create `src/renderer/src/modules/library/services/visual-library.ts`:

```ts
import { instantiate } from '@pragmatic-tech-ai/mural/compiler'
import * as muralRuntime from '@pragmatic-tech-ai/mural/runtime'
import * as muralBasic from '@pragmatic-tech-ai/mural/basic'
import * as muralEngine from '@pragmatic-tech-ai/mural/visual-engine'
import { DataTemplate, type DataTemplateFactory } from '@pragmatic-tech-ai/mural/basic'
import type { Visual } from '@pragmatic-tech-ai/mural/runtime'

// The runtime symbol table instantiate() destructures the fragment's referenced
// symbols from. Built once per registry.
export function buildCtx(): Record<string, unknown>
{
    return { ...muralRuntime, ...muralBasic, ...muralEngine }
}

// Compile a `.mural` fragment (a bare-element root) into a DataTemplate. instantiate
// returns a zero-arg factory that builds the fragment's visual; we wrap it so the
// host's Content becomes the visual's DataContext (bindings like $Display resolve
// against it). Throws (via instantiate) if the source can't compile.
export function compileTemplate(source: string, ctx: Record<string, unknown>): DataTemplate
{
    const factory = instantiate(source, ctx) as () => Visual
    const wrapped: DataTemplateFactory = (data) => {
        const v = factory() as Visual & { DataContext: unknown }
        v.DataContext = data
        return v
    }
    return new DataTemplate(wrapped)
}

// The always-installed default visual — a labelled box for any class without its
// own template. Authored as a fragment so it goes through the same compile path.
// $Display is the class's display string (see ClassData).
const DEFAULT_SOURCE =
      'Border [ Background = @SurfaceContainerHigh, CornerRadius = 6, Padding = (10,6,10,6) ] {'
    + ' TextBlock [ Text = $Display, Foreground = @OnSurface ] }'

export function buildDefaultTemplate(ctx: Record<string, unknown>): DataTemplate
{
    return compileTemplate(DEFAULT_SOURCE, ctx)
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/visual-library.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/library/services/visual-library.ts src/renderer/src/modules/library/services/tests/visual-library.test.ts
git commit -m "feat(library): runtime .mural fragment compilation + default template"
```

---

## Task 3: `LibraryRegistry` service (mount, resolve, refresh, diagnostics)

**Files:**
- Create: `src/renderer/src/modules/library/services/library-registry.ts`
- Test: `src/renderer/src/modules/library/services/tests/library-registry.test.ts`

**Interfaces:**
- Consumes: `library-loader` (`discoverLibraries`, `readTemplateSource`, `LoadedLibrary`, `LoadProblem`), `visual-library` (`buildCtx`, `compileTemplate`, `buildDefaultTemplate`), `ensureLibrariesBackend`, `DiagnosticsService`, `Application`/`ResourceDictionary`/`DataTemplate`.
- Produces: `class LibraryRegistry extends ServiceBase` with `static Key`, `async refresh(): Promise<LoadedLibrary[]>`, `resolve(classId: string, concept: string): DataTemplate`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/modules/library/services/tests/library-registry.test.ts`:

```ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { DiagnosticsService } from '../../../../services/diagnostics/diagnostics-service.js'
import { DiagnosticSeverity } from '../../../../services/diagnostics/diagnostic.js'
import { LIBRARIES_BACKEND_ID } from '../libraries-backend.js'
import { LibraryRegistry } from '../library-registry.js'

// Seed is SYNCHRONOUS: FakeStorage.WriteText sets its map synchronously, so every
// file is present before refresh() lists the backend (an async seed with awaits
// would race the first List). Matches the meta-models-service test pattern.
function env(seed: (b: FakeStorage) => void): { provider: ServiceProvider; diagnostics: DiagnosticsService } {
    const provider = new ServiceProvider()
    const registry = new StorageProviderRegistry(provider)
    const backend = new FakeStorage('fake://libraries')
    registry.Register(LIBRARIES_BACKEND_ID, () => backend)
    provider.registerInstance(StorageProviderRegistry.Key, registry)
    const diagnostics = new DiagnosticsService(provider)
    provider.registerInstance(DiagnosticsService.Key, diagnostics)
    seed(backend)
    return { provider, diagnostics }
}

function manifest(id: string, template = `visuals/${id}.azure.mural`): string {
    return JSON.stringify({
        id, version: '0.1.0', name: id, metaModel: { id: 'ea', version: '5' },
        classes: [{ id: `${id}.azure`, localId: 'azure', label: 'Azure', concept: 'location', template }],
        assets: [], docs: [], samples: [],
    })
}

test('mounts a class template so resolve returns it, and the default otherwise', async () => {
    const { provider } = env((b) => {
        void b.WriteText('microsoft/0.1.0/library.json', manifest('microsoft'))
        void b.WriteText('microsoft/0.1.0/visuals/microsoft.azure.mural', 'TextBlock [ Text = $Display ]')
    })
    const reg = new LibraryRegistry(provider)
    await reg.refresh()

    const mounted = reg.resolve('microsoft.azure', 'location')
    const fallback = reg.resolve('nobody.here', 'location')
    expect(mounted).not.toBe(fallback)          // class template, not the default
    expect(fallback).toBe(reg.resolve('also.missing', 'x'))   // the single shared default
})

test('a class template that fails to compile falls back to default and reports an error to the Problems store', async () => {
    const { provider, diagnostics } = env((b) => {
        void b.WriteText('microsoft/0.1.0/library.json', manifest('microsoft'))
        void b.WriteText('microsoft/0.1.0/visuals/microsoft.azure.mural', 'not valid mural [[[')
    })
    const reg = new LibraryRegistry(provider)
    await reg.refresh()

    expect(reg.resolve('microsoft.azure', 'location')).toBe(reg.resolve('x.y', 'z'))   // fell back to default
    const errs = [...diagnostics.All].filter((d) => d.owner === 'libraries' && d.severity === DiagnosticSeverity.Error)
    expect(errs.some((d) => d.uri === 'visuals/microsoft.azure.mural')).toBe(true)
    expect(errs[0].projectId).toBe('library:microsoft@0.1.0')
})
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-registry.test.ts`
Expected: FAIL — `../library-registry.js` does not exist.

- [ ] **Step 3: Implement**

Create `src/renderer/src/modules/library/services/library-registry.ts`:

```ts
import { Application, ResourceDictionary, ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { DataTemplate } from '@pragmatic-tech-ai/mural/basic'

import { ensureLibrariesBackend } from './libraries-backend.js'
import { discoverLibraries, readTemplateSource, type LoadedLibrary, type LoadProblem } from './library-loader.js'
import { buildCtx, compileTemplate, buildDefaultTemplate } from './visual-library.js'
import { DiagnosticsService } from '../../../services/diagnostics/diagnostics-service.js'
import { DiagnosticSeverity, type Diagnostic } from '../../../services/diagnostics/diagnostic.js'

const OWNER = 'libraries'

// Loads published library bundles, compiles each class's .mural template into a
// live DataTemplate, and resolves a class id → its template (or the default).
// The compiled templates also merge into Application.Resources (string-keyed by
// class id) so Phase 3's canvas can resolve them by key. Load/compile failures
// report to the Problems dock, one slice per library (auto-clears on re-publish).
export class LibraryRegistry extends ServiceBase
{
    public static readonly Key = new ServiceKey<LibraryRegistry>('LibraryRegistry')

    private readonly ctx = buildCtx()
    private readonly libraryVisuals = new ResourceDictionary()
    private readonly defaultTemplate: DataTemplate
    private merged = false

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.defaultTemplate = buildDefaultTemplate(this.ctx)
    }

    // class id → its template if mounted, else the single shared default. `concept`
    // is accepted for a future per-concept default tier (unused today).
    public resolve(classId: string, _concept: string): DataTemplate
    {
        const t = this.libraryVisuals.Resolve(classId)
        return (t as DataTemplate | undefined) ?? this.defaultTemplate
    }

    // Discover + (re)mount every published library; republish diagnostics. Returns
    // the loaded set for the panel.
    public async refresh(): Promise<LoadedLibrary[]>
    {
        this.ensureMerged()
        const backend = ensureLibrariesBackend(this.Provider)
        const libs = await discoverLibraries(backend)
        for (const lib of libs) {
            const problems: LoadProblem[] = [...lib.problems]
            for (const cls of lib.classes) {
                const source = await readTemplateSource(backend, lib, cls)
                if (source === undefined) continue
                try {
                    this.libraryVisuals.Set(cls.id, compileTemplate(source, this.ctx))
                } catch (e) {
                    problems.push({ severity: 'error', uri: cls.templatePath ?? null,
                                    message: `Template for ${cls.id} failed to compile: ${(e as Error).message}` })
                }
            }
            this.publish(lib, problems)
        }
        return libs
    }

    // Merge the library-visuals dictionary into the app resources once (guarded:
    // Application.current may be absent in headless tests, where resolve() still
    // works off the owned dictionary).
    private ensureMerged(): void
    {
        if (this.merged) return
        Application.current?.Resources.AddMergedDictionary(this.libraryVisuals)
        this.merged = true
    }

    private publish(lib: LoadedLibrary, problems: readonly LoadProblem[]): void
    {
        const diagnostics = this.Provider.get(DiagnosticsService.Key)
        if (diagnostics === undefined) return
        const projectId = `library:${lib.id}@${lib.version}`
        const projectName = `${lib.name} (${lib.id}@${lib.version})`
        const diags: Diagnostic[] = problems.map((p) => ({
            owner: OWNER, projectId, projectName, uri: p.uri, message: p.message,
            severity: p.severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning, span: null,
        }))
        diagnostics.Publish(OWNER, projectId, diags)   // empty array clears the slice
    }
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-registry.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/library/services/library-registry.ts src/renderer/src/modules/library/services/tests/library-registry.test.ts
git commit -m "feat(library): LibraryRegistry mounts templates, resolves, reports to Problems"
```

---

## Task 4: `LibrariesPanelService` + row models

**Files:**
- Create: `src/renderer/src/modules/library/services/libraries-panel-service.ts`
- Test: `src/renderer/src/modules/library/services/tests/libraries-panel-service.test.ts`

**Interfaces:**
- Consumes: `LibraryRegistry` (`refresh`, `resolve`), `Model`/`ObservableCollection`/`ServiceBase`, `IActivatable`, `DataTemplate`.
- Produces: `ClassData` (`Model` with `Display`/`Label`/`LocalId`/`Concept`), `ClassRow` (`Model` with `Data`/`Template`), `LibraryRow` (`Model` with `Name`/`Classes`), `LibrariesPanelService` (`static Key`, `Libraries`, `IsEmpty`, `OnActivated`, `Reload(): Promise<void>`).

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/modules/library/services/tests/libraries-panel-service.test.ts`:

```ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { LIBRARIES_BACKEND_ID } from '../libraries-backend.js'
import { LibraryRegistry } from '../library-registry.js'
import { LibrariesPanelService } from '../libraries-panel-service.js'

// Synchronous seed (see the registry test) so all files exist before Reload lists.
function providerWith(seed: (b: FakeStorage) => void): ServiceProvider {
    const provider = new ServiceProvider()
    const registry = new StorageProviderRegistry(provider)
    const backend = new FakeStorage('fake://libraries')
    registry.Register(LIBRARIES_BACKEND_ID, () => backend)
    provider.registerInstance(StorageProviderRegistry.Key, registry)
    provider.registerInstance(LibraryRegistry.Key, new LibraryRegistry(provider))
    seed(backend)
    return provider
}

test('builds a LibraryRow per library with a ClassRow (template resolved) per class', async () => {
    const provider = providerWith((b) => {
        void b.WriteText('microsoft/0.1.0/library.json', JSON.stringify({
            id: 'microsoft', version: '0.1.0', name: 'Microsoft', metaModel: { id: 'ea', version: '5' },
            classes: [{ id: 'microsoft.azure', localId: 'azure', label: 'Azure', concept: 'location', template: 'visuals/microsoft.azure.mural' }],
            assets: [], docs: [], samples: [],
        }))
        void b.WriteText('microsoft/0.1.0/visuals/microsoft.azure.mural', 'TextBlock [ Text = $Display ]')
    })
    const svc = new LibrariesPanelService(provider)
    await svc.Reload()

    expect(svc.IsEmpty).toBe(false)
    expect(svc.Libraries.Count).toBe(1)
    const lib = svc.Libraries.Get(0)
    expect(lib.Name).toContain('Microsoft')
    expect(lib.Classes.Count).toBe(1)
    const row = lib.Classes.Get(0)
    expect(row.Data.Display).toBe('Azure')
    expect(typeof row.Template.Apply).toBe('function')
})

test('IsEmpty is true when nothing is published', async () => {
    const svc = new LibrariesPanelService(providerWith(() => {}))
    await svc.Reload()
    expect(svc.IsEmpty).toBe(true)
    expect(svc.Libraries.Count).toBe(0)
})
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/libraries-panel-service.test.ts`
Expected: FAIL — `../libraries-panel-service.js` does not exist.

- [ ] **Step 3: Implement**

Create `src/renderer/src/modules/library/services/libraries-panel-service.ts`:

```ts
import { MetaData, Model, ObservableCollection, ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { IActivatable } from '@pragmatic-tech-ai/mural/framework'
import type { DataTemplate } from '@pragmatic-tech-ai/mural/basic'

import { LibraryRegistry } from './library-registry.js'

// The data context a class's mounted template binds to ($Display etc.).
export class ClassData extends Model
{
    public static readonly DisplayKey = Model.RegisterProperty<string>(ClassData, 'Display', '', MetaData.None)
    public static readonly LabelKey   = Model.RegisterProperty<string>(ClassData, 'Label', '', MetaData.None)
    public static readonly LocalIdKey = Model.RegisterProperty<string>(ClassData, 'LocalId', '', MetaData.None)
    public static readonly ConceptKey = Model.RegisterProperty<string>(ClassData, 'Concept', '', MetaData.None)

    constructor(display: string, label: string, localId: string, concept: string)
    {
        super()
        this.set_property_value(ClassData.DisplayKey, display)
        this.set_property_value(ClassData.LabelKey, label)
        this.set_property_value(ClassData.LocalIdKey, localId)
        this.set_property_value(ClassData.ConceptKey, concept)
    }

    public get Display(): string { return this.get_property_value(ClassData.DisplayKey) }
}

// One class row: its data context + the DataTemplate to render it with.
export class ClassRow extends Model
{
    public static readonly DataKey     = Model.RegisterProperty<ClassData>(ClassRow, 'Data', undefined as unknown as ClassData, MetaData.None)
    public static readonly TemplateKey = Model.RegisterProperty<DataTemplate>(ClassRow, 'Template', undefined as unknown as DataTemplate, MetaData.None)

    constructor(data: ClassData, template: DataTemplate)
    {
        super()
        this.set_property_value(ClassRow.DataKey, data)
        this.set_property_value(ClassRow.TemplateKey, template)
    }

    public get Data(): ClassData { return this.get_property_value(ClassRow.DataKey) }
    public get Template(): DataTemplate { return this.get_property_value(ClassRow.TemplateKey) }
}

// One library: header + its class rows.
export class LibraryRow extends Model
{
    public static readonly NameKey    = Model.RegisterProperty<string>(LibraryRow, 'Name', '', MetaData.None)
    public static readonly ClassesKey = Model.RegisterProperty<ObservableCollection<ClassRow>>(
        LibraryRow, 'Classes', undefined as unknown as ObservableCollection<ClassRow>, MetaData.None)

    constructor(name: string, classes: ObservableCollection<ClassRow>)
    {
        super()
        this.set_property_value(LibraryRow.NameKey, name)
        this.set_property_value(LibraryRow.ClassesKey, classes)
    }

    public get Name(): string { return this.get_property_value(LibraryRow.NameKey) }
    public get Classes(): ObservableCollection<ClassRow> { return this.get_property_value(LibraryRow.ClassesKey) }
}

// The Libraries capability's panel content: browses all published libraries,
// each class rendered through its mounted template (via LibraryRegistry).
export class LibrariesPanelService extends ServiceBase implements IActivatable
{
    public static readonly Key = new ServiceKey<LibrariesPanelService>('LibrariesPanelService')

    public static readonly LibrariesKey = Model.RegisterProperty<ObservableCollection<LibraryRow>>(
        LibrariesPanelService, 'Libraries', undefined as unknown as ObservableCollection<LibraryRow>, MetaData.None)
    public static readonly IsEmptyKey = Model.RegisterProperty<boolean>(LibrariesPanelService, 'IsEmpty', false, MetaData.None)

    private reloadSeq = 0

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.set_property_value(LibrariesPanelService.LibrariesKey, new ObservableCollection<LibraryRow>())
        void this.Reload()
    }

    public get Libraries(): ObservableCollection<LibraryRow> { return this.get_property_value(LibrariesPanelService.LibrariesKey) }
    public get IsEmpty(): boolean { return this.get_property_value(LibrariesPanelService.IsEmptyKey) }

    public OnActivated(): void { void this.Reload() }

    public async Reload(): Promise<void>
    {
        const seq = ++this.reloadSeq
        const registry = this.Provider.getRequired(LibraryRegistry.Key)
        const libs = await registry.refresh()
        if (seq !== this.reloadSeq) return

        const rows = this.Libraries
        rows.Clear()
        for (const lib of libs) {
            const classRows = new ObservableCollection<ClassRow>()
            for (const cls of lib.classes) {
                const display = cls.label ?? cls.localId ?? cls.id
                const data = new ClassData(display, cls.label ?? '', cls.localId ?? '', cls.concept)
                classRows.Add(new ClassRow(data, registry.resolve(cls.id, cls.concept)))
            }
            rows.Add(new LibraryRow(`${lib.name}  ·  ${lib.version}`, classRows))
        }
        this.set_property_value(LibrariesPanelService.IsEmptyKey, rows.Count === 0)
    }
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/libraries-panel-service.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/library/services/libraries-panel-service.ts src/renderer/src/modules/library/services/tests/libraries-panel-service.test.ts
git commit -m "feat(library): LibrariesPanelService builds library/class rows from the registry"
```

---

## Task 5: Wire the panel + registry into the app

**Files:**
- Create: `src/renderer/src/modules/library/library.resources.mu`, `src/renderer/src/icons/libraries.svg`
- Modify: `src/renderer/src/modules/library/library.module.mu`, `src/renderer/src/plexus-icons.mu`, `src/renderer/src/app.mu`, `package.json`

No unit test — verified by `compile:mu` + `typecheck` + full suite.

- [ ] **Step 1: Create the Libraries icon**

Create `src/renderer/src/icons/libraries.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect x="3"  y="4" width="4" height="16" fill="currentColor"/>
  <rect x="9"  y="4" width="4" height="16" fill="currentColor"/>
  <rect x="15" y="7" width="4" height="13" fill="currentColor" transform="rotate(-12 17 13)"/>
</svg>
```

- [ ] **Step 2: Register the icon**

In `src/renderer/src/plexus-icons.mu`, after the `meta-models.svg` line, add:

```
    include "icons/libraries.svg"                as Libraries
```

- [ ] **Step 3: Create the panel resources**

Create `src/renderer/src/modules/library/library.resources.mu`:

```
// library.resources.mu — view resources for the Libraries capability panel
// (LibrariesPanelService). Merged app-global by app.mu. Browses published
// libraries; each class renders through its mounted template via a
// ContentPresenter whose ContentTemplate is the registry-resolved DataTemplate.

import LibrariesPanelService from "./services/libraries-panel-service.js"
import LibraryRow from "./services/libraries-panel-service.js"
import ClassRow from "./services/libraries-panel-service.js"

resources LibraryResources {
    DataTemplate [ DataType = LibrariesPanelService ] {
        StackPanel [ Orientation = Vertical, Margin = (12,12,12,12) ] {
            ItemsControl [ ItemsSource = $Libraries, ItemsPanel = @VerticalStackPanel ]
            TextBlock [ Style = @BodyMedium, Text = "No published libraries yet.",
                        Foreground = @OnSurfaceVariant, TextWrapping = Wrap,
                        Visibility = $IsEmpty << ToVisibility ]
        }
    }

    DataTemplate [ DataType = LibraryRow ] {
        StackPanel [ Orientation = Vertical, Margin = (0,4,0,8) ] {
            TextBlock [ Style = @BodyMedium, Text = $Name, Foreground = @OnSurface ]
            ItemsControl [ ItemsSource = $Classes, ItemsPanel = @VerticalStackPanel, Margin = (12,4,0,0) ]
        }
    }

    DataTemplate [ DataType = ClassRow ] {
        ContentPresenter [ Content = $Data, ContentTemplate = $Template, Margin = (0,3,0,3) ]
    }
}
```

- [ ] **Step 4: Register the registry + panel service + capability**

In `src/renderer/src/modules/library/library.module.mu`, replace the imports + module body:

```
import LibraryProjectFactory from "./services/library-project-factory.js"
import LibraryRegistry from "./services/library-registry.js"
import LibrariesPanelService from "./services/libraries-panel-service.js"

module LibraryModule [ Name = "Library" ] {
    .services: {
        LibraryProjectFactory
        LibraryRegistry
        LibrariesPanelService
    }

    Capability [ Name = "Libraries", Icon = @Libraries, ServiceKey = LibrariesPanelService ]

    .projectFactories: {
        ProjectFactoryDefinition
            [ Type        = "library",
              Title       = "Library Project",
              Description = "Author a technology library (taxonomy) against a meta-model.",
              Factory     = LibraryProjectFactory ]
    }
}
```

- [ ] **Step 5: Merge the panel resources in app.mu**

In `src/renderer/src/app.mu`, add an import next to the other module resource imports (after `MetaModelResources`):

```
// Libraries capability panel (DataTemplate[LibrariesPanelService] + rows).
import LibraryResources from "./modules/library/library.resources.mu.js"
```

And in the `resources { … }` block, after `merge MetaModelResources`:

```
        // Libraries capability panel (DataTemplate[LibrariesPanelService] + rows).
        merge LibraryResources
```

- [ ] **Step 6: Add the resources file to compile:mu**

In `package.json`, in the `compile:mu` script, after `.../library/library.module.mu` add:

```
 src/renderer/src/modules/library/library.resources.mu
```

- [ ] **Step 7: Compile, typecheck, and run the full suite**

Run: `npm run compile:mu`
Expected: "compiled N files" with no error (N increases by 1).

Run: `npm run typecheck`
Expected: no errors.

Run: `npx vitest run`
Expected: all tests pass (previous count + the four new files' tests).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/modules/library/library.resources.mu src/renderer/src/icons/libraries.svg \
        src/renderer/src/modules/library/library.module.mu src/renderer/src/plexus-icons.mu \
        src/renderer/src/app.mu package.json
git commit -m "feat(library): Libraries browse panel — capability, resources, wiring"
```

---

## Definition of done

- A `LibraryRegistry` service discovers published bundles, compiles each class's `.mural` template at runtime into a `DataTemplate` (merged into `Application.Resources`, string-keyed by class id), and `resolve(classId, concept)` returns the class template or the shared default.
- The Libraries rail entry lists published libraries → classes, each rendered through its resolved template (default box when untemplated), empty-state when nothing is published, re-scanning on activation.
- Load/compile failures appear in the Problems dock under a per-library group and auto-clear on re-publish.
- Full Vitest suite green; `npm run compile:mu` and `npm run typecheck` clean.

## Notes for the implementer

- **Headless mounting:** in tests there is no `Application.current`, so `resolve()` reads the registry's own `ResourceDictionary` and the merge-to-app is null-guarded. Don't "fix" this by requiring an Application.
- **`@`-theme refs in the default template** (`@SurfaceContainerHigh`, `@OnSurface`) resolve lazily against the app resource chain at render time; they compile fine headless and are only realised in the running app. Test fragments deliberately avoid `@` refs.
- **Live smoke (not automated):** `npm run dev`, publish a library that has a `visuals/<classId>.mural`, open the **Libraries** rail entry, confirm the class renders via its template (and an untemplated one shows the default box), and that a deliberately-broken `.mural` shows up in the Problems dock.
```

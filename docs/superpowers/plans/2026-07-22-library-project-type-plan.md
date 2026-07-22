# Library Project Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the `library` project type (authored against a meta-model, published to a dedicated libraries backend, validated via TODL `checkAgainst`), plus the shared base-resolution + base-aware validation machinery SP4 reuses, a New-Project meta-model picker, and a Refresh-Bases command.

**Architecture:** A "consuming project" declares `BaseBindings` (meta-model, and later libraries); `resolveBases` reads their compiled `model.json` from the backends; the renamed base-aware `TodlValidationService` validates any project via `checkAgainst(bases, sources)` (meta-model = `[]`, unchanged). `LibraryProjectFactory` mirrors `MetaModelProjectFactory` with a meta-model-bound publish. The New-Project dialog gains a meta-model picker for library projects.

**Tech Stack:** TypeScript (renderer), mural, `.mu` compiled via `npm run compile:mu`, Vitest, `@pragmatic-lab/todl` (`checkAgainst` from SP3).

## Global Constraints

- Every test file in a `tests/` subfolder next to its source.
- Real TS enums; no new string-literal union types.
- Commits authored `Eugene Napryaglo <evgen.napryaglo@gmail.com>`; message ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Do NOT stage `src/renderer/src/modules/ontologies/services/ontologies-service.ts`.
- `.mu.js` are gitignored build artifacts — regenerate with `npm run compile:mu`; do not commit them.
- Preserve behavior for meta-model projects: `validateSources(s)` ≡ `validateSources(s, [])`; `checkAgainst([], s)` ≡ `check(s)`.
- Verify from `Plexus/`: `npm test`, `npm run typecheck`, `npm run compile:mu`.

---

## Task 1: Libraries backend

**Files:**
- Create: `src/renderer/src/modules/library/services/libraries-backend.ts`
- Test: `src/renderer/src/modules/library/services/tests/libraries-backend.test.ts`

**Interfaces:**
- Produces: `LIBRARIES_BACKEND_ID = 'libraries'`; `ensureLibrariesBackend(provider: IServiceProvider): IStorage`.

- [ ] **Step 1: Test** — port `meta-models-backend.test.ts` verbatim, swapping names/id/root to `libraries`. (Read the existing test first; mirror its structure: registers once, idempotent, rooted at `<userData>/libraries`.)

- [ ] **Step 2: Run — fail** (`npx vitest run src/renderer/src/modules/library/services/tests/libraries-backend.test.ts`).

- [ ] **Step 3: Implement** — copy `meta-models-backend.ts` verbatim, renaming `META_MODELS_BACKEND_ID`→`LIBRARIES_BACKEND_ID='libraries'`, `ensureMetaModelsBackend`→`ensureLibrariesBackend`, and the root segment `meta-models`→`libraries`. Same imports (`StorageProviderRegistry`, `LocalFileStorage`, `FileSystemService`, `EnvironmentService`, `IStorage`).

- [ ] **Step 4: Run — pass.**

- [ ] **Step 5: Commit** `feat(library): add libraries backend (<userData>/libraries)`.

---

## Task 2: Base bindings + resolver

**Files:**
- Create: `src/renderer/src/services/projects/base-binding.ts`
- Create: `src/renderer/src/services/projects/base-resolver.ts`
- Test: `src/renderer/src/services/projects/tests/base-resolver.test.ts`

**Interfaces:**
- Produces:
  - `base-binding.ts`: `interface BaseRef { id: string; version: string }`; `interface BaseBindings { metaModel?: BaseRef; libraries?: readonly BaseRef[] }`.
  - `base-resolver.ts`: `async function resolveBases(provider: IServiceProvider, bindings: BaseBindings): Promise<{ bases: TodlDocument[]; problems: string[] }>`.

- [ ] **Step 1: Write `base-binding.ts`** (types only, no test needed — exercised via resolver):

```ts
// A reference to a published base model, by publish id + version. The compiled
// artifact lives at `<id>/<version>/model.json` in its backend.
export interface BaseRef { id: string; version: string }

// The base models a consuming project is authored against. A meta-model project
// declares none; a library declares a meta-model; an architecture declares a
// meta-model plus libraries.
export interface BaseBindings {
  metaModel?: BaseRef
  libraries?: readonly BaseRef[]
}
```

- [ ] **Step 2: Test `base-resolver.ts`** — create `tests/base-resolver.test.ts`:

```ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { check, toJSON } from '@pragmatic-lab/todl'

import { StorageProviderRegistry } from '../../storage/storage-provider-registry.js'
import { FakeStorage } from '../../storage/tests/fake-storage.js'
import { META_MODELS_BACKEND_ID } from '../../../modules/meta-model/services/meta-models-backend.js'
import { LIBRARIES_BACKEND_ID } from '../../../modules/library/services/libraries-backend.js'
import { resolveBases } from '../base-resolver.js'

const CONCEPTS = 'namespace d { concept model { label : string; } concept location { label : string; } }'

// A provider whose meta-models + libraries backends resolve to inspectable
// FakeStorages (pre-registered so the ensure* Has-check finds them).
function env(): { provider: ServiceProvider; meta: FakeStorage; libs: FakeStorage } {
  const provider = new ServiceProvider()
  const registry = new StorageProviderRegistry(provider)
  const meta = new FakeStorage('fake://meta-models')
  const libs = new FakeStorage('fake://libraries')
  registry.Register(META_MODELS_BACKEND_ID, () => meta)
  registry.Register(LIBRARIES_BACKEND_ID, () => libs)
  provider.registerInstance(StorageProviderRegistry.Key, registry)
  return { provider, meta, libs }
}

test('resolveBases reads a bound meta-model model.json', async () => {
  const { provider, meta } = env()
  await meta.WriteText('ea/5/model.json', JSON.stringify(toJSON(check([{ uri: 'c.todl', text: CONCEPTS }]).model)))
  const { bases, problems } = await resolveBases(provider, { metaModel: { id: 'ea', version: '5' } })
  expect(problems).toEqual([])
  expect(bases.length).toBe(1)
  expect(bases[0].nodes.some((n) => n.id === 'location')).toBe(true)
})

test('a missing base is reported in problems, not thrown', async () => {
  const { provider } = env()
  const { bases, problems } = await resolveBases(provider, { metaModel: { id: 'ghost', version: '1' } })
  expect(bases).toEqual([])
  expect(problems.length).toBe(1)
  expect(problems[0]).toMatch(/ghost/)
})

test('no bindings resolves to empty', async () => {
  const { provider } = env()
  const { bases, problems } = await resolveBases(provider, {})
  expect(bases).toEqual([])
  expect(problems).toEqual([])
})
```

- [ ] **Step 3: Run — fail** (`resolveBases` missing).

- [ ] **Step 4: Implement `base-resolver.ts`:**

```ts
import type { IServiceProvider } from '@pragmatic-lab/mural/runtime'
import type { TodlDocument } from '@pragmatic-lab/todl'

import type { IStorage } from '../storage/storage.js'
import { ensureMetaModelsBackend } from '../../modules/meta-model/services/meta-models-backend.js'
import { ensureLibrariesBackend } from '../../modules/library/services/libraries-backend.js'
import type { BaseBindings, BaseRef } from './base-binding.js'

// Resolve a project's declared bases into parsed TodlDocuments, meta-model first
// then libraries (a stable order; checkAgainst dedups any overlap). A binding
// whose compiled model.json is missing/unreadable is collected in `problems`
// (so validation can say "meta-model not published") rather than thrown.
export async function resolveBases(
  provider: IServiceProvider,
  bindings: BaseBindings,
): Promise<{ bases: TodlDocument[]; problems: string[] }> {
  const bases: TodlDocument[] = []
  const problems: string[] = []

  const read = async (backend: IStorage, ref: BaseRef, kind: string): Promise<void> => {
    const path = `${ref.id}/${ref.version}/model.json`
    try {
      bases.push(JSON.parse(await backend.ReadText(path)) as TodlDocument)
    } catch {
      problems.push(`${kind} "${ref.id}@${ref.version}" is not published`)
    }
  }

  if (bindings.metaModel !== undefined) {
    await read(ensureMetaModelsBackend(provider), bindings.metaModel, 'meta-model')
  }
  for (const lib of bindings.libraries ?? []) {
    await read(ensureLibrariesBackend(provider), lib, 'library')
  }
  return { bases, problems }
}
```

- [ ] **Step 5: Run — pass.**

- [ ] **Step 6: Commit** `feat(projects): add BaseBindings + resolveBases (reads compiled bases from backends)`.

---

## Task 3: Rename + relocate the validator; make it base-aware

Rename `MetaModelValidationService` → `TodlValidationService`, move to `src/renderer/src/services/todl/`, register root-scoped in `app.mu`, and make it validate via `checkAgainst(resolveBases(project), sources)` with a per-storage base cache + `ClearBaseCache`.

**Files:**
- Create: `src/renderer/src/services/todl/todl-validation-service.ts` (moved + renamed + base-aware)
- Create: `src/renderer/src/services/todl/tests/todl-validation-service.test.ts` (moved + extended)
- Delete: `src/renderer/src/modules/meta-model/services/meta-model-validation-service.ts` + its test
- Modify: `src/renderer/src/modules/meta-model/services/todl-document-factory.ts` (import + `.Key`)
- Modify: `src/renderer/src/modules/meta-model/meta-model.module.mu` (drop the service reg + import)
- Modify: `src/renderer/src/app.mu` (add `TodlValidationService` to `.services:`)

**Interfaces:**
- Consumes: `resolveBases` (Task 2); `checkAgainst` (`@pragmatic-lab/todl`); `PROJECT_MANIFEST_FILENAME`, `type BaseBindings` (Task 2 / project-factory).
- Produces: `class TodlValidationService` (static `Key`), `AttachDocument(doc, storage)`, `Revalidate()`, `ClearBaseCache(storage?)`; `validateSources(sources, bases?)`.

- [ ] **Step 1: Move the file** — `git mv src/renderer/src/modules/meta-model/services/meta-model-validation-service.ts src/renderer/src/services/todl/todl-validation-service.ts` and `git mv` its test to `src/renderer/src/services/todl/tests/todl-validation-service.test.ts`. Fix relative import depths in both (now under `services/todl/` — `../../` reaches `services/`, `../../../modules/` reaches modules).

- [ ] **Step 2: Rename the class + Key** in the moved file: `MetaModelValidationService` → `TodlValidationService`, `new ServiceKey<TodlValidationService>('TodlValidationService')`. Update the moved test's imports + `new TodlValidationService(...)`.

- [ ] **Step 3: Add the `bases` param to `validateSources`** (default `[]`, switch to `checkAgainst`):

```ts
import { checkAgainst, Severity, type Diagnostic, type SourceFile, type TodlDocument } from '@pragmatic-lab/todl'

export function validateSources(sources: SourceFile[], bases: TodlDocument[] = []): Map<string, EditorDiagnostic[]> {
  const byUri = new Map<string, EditorDiagnostic[]>()
  for (const s of sources) byUri.set(s.uri, [])
  let diagnostics: readonly Diagnostic[]
  try {
    diagnostics = checkAgainst(bases, sources).diagnostics
  } catch (e) {
    const message = `Validation failed: ${(e as Error).message}`
    for (const uri of byUri.keys()) byUri.set(uri, [wholeFileError(message)])
    return byUri
  }
  // ... unchanged span-grouping loop ...
  return byUri
}
```

Keep the existing `check` import only if still used; otherwise replace with `checkAgainst`. (`checkAgainst([], s)` ≡ `check(s)`, so the existing tests pass unchanged.)

- [ ] **Step 4: Base cache + manifest read in `Revalidate`** — add a per-storage cache and resolve bases from the project manifest:

```ts
import { resolveBases } from '../projects/base-resolver.js'
import { PROJECT_MANIFEST_FILENAME } from '../projects/project-factory.js'
import type { BaseBindings } from '../projects/base-binding.js'

// (field) private readonly baseCache = new Map<IStorage, { bases: TodlDocument[]; problems: string[] }>()

private async basesFor(storage: IStorage): Promise<{ bases: TodlDocument[]; problems: string[] }> {
  const cached = this.baseCache.get(storage)
  if (cached !== undefined) return cached
  let bindings: BaseBindings = {}
  try {
    const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as BaseBindings
    bindings = { metaModel: manifest.metaModel, libraries: manifest.libraries }
  } catch { /* no manifest / not a consuming project → no bases */ }
  const resolved = await resolveBases(this.Provider, bindings)
  this.baseCache.set(storage, resolved)
  return resolved
}

// Drop cached bases (all, or one storage) so the next Revalidate re-resolves.
public ClearBaseCache(storage?: IStorage): void {
  if (storage === undefined) this.baseCache.clear()
  else this.baseCache.delete(storage)
}
```

In `Revalidate`, for each `[storage, docs]` group, `const { bases, problems } = await this.basesFor(storage)`, then `validateSources(overlaySources(stored, open), bases)`, and if `problems.length > 0` prepend a `wholeFileError('…not published…')` (join problems) to every doc's list.

- [ ] **Step 5: Update `TodlDocumentFactory`** — import `{ TodlValidationService } from '../../../services/todl/todl-validation-service.js'` and `this.Provider.get(TodlValidationService.Key)?.AttachDocument(doc, storage)`.

- [ ] **Step 6: Update `meta-model.module.mu`** — remove the `import MetaModelValidationService …` line and its `.services:` entry (the validator is now root-registered in app.mu). Keep `MetaModelProjectFactory` + `TodlDocumentFactory`.

- [ ] **Step 7: Register in `app.mu`** — add `TodlValidationService` to `.services:` (import at top: `import TodlValidationService from "./services/todl/todl-validation-service.js"`; unlike framework services it needs a local import, mirroring `CodeEditorService`).

- [ ] **Step 8: Extend the moved test** — add a base-aware case: `validateSources(librarySource, [metaModelBase])` yields no error where `validateSources(librarySource)` leaves the meta-model refs under-validated. Keep all original cases (they now exercise `bases=[]`).

- [ ] **Step 9: compile:mu, typecheck, full test.** `npm run compile:mu && npm run typecheck && npm test` — all green. The moved validation test + all meta-model tests pass; the factory resolves the renamed service.

- [ ] **Step 10: Commit** `refactor(todl): rename MetaModelValidationService → base-aware TodlValidationService (root service)`.

---

## Task 4: `IProjectFactory.createProject` binding param + `LibraryProjectFactory`

**Files:**
- Modify: `src/renderer/src/services/projects/project-factory.ts` (createProject signature + optional `requiresMetaModel`)
- Create: `src/renderer/src/modules/library/services/library-project-factory.ts`
- Test: `src/renderer/src/modules/library/services/tests/library-project-factory.test.ts`

**Interfaces:**
- Produces: `IProjectFactory.createProject(storage, name, bindings?: BaseBindings)`, optional `readonly requiresMetaModel?: boolean`; `class LibraryProjectFactory` (type `library`, `requiresMetaModel=true`, publish via `checkAgainst`).

- [ ] **Step 1: Widen `IProjectFactory`** in `project-factory.ts`:

```ts
import type { BaseBindings } from './base-binding.js'
// ...
export interface IProjectFactory {
  readonly formats: readonly ProjectFileFormat[]
  // True when creating this project type needs a meta-model base chosen up front
  // (the New-Project dialog shows a meta-model picker). Absent ⇒ false.
  readonly requiresMetaModel?: boolean
  createProject(storage: IStorage, name: string, bindings?: BaseBindings): Promise<Project>
  openProject(storage: IStorage): Promise<Project>
  saveProject(project: Project, storage: IStorage): Promise<void>
}
```

Existing factories (`MetaModelProjectFactory`, `ArchitectureProjectFactory`) keep `createProject(storage, name)` — assignable (fewer params). No change needed there.

- [ ] **Step 2: Test `LibraryProjectFactory`** — mirror `meta-model-project-factory.test.ts` (create writes a `library` manifest with `id`/`libVersion`; open tags `.todl` nodes; publish against a fake meta-models backend + fake libraries backend). Create `tests/library-project-factory.test.ts`:

```ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { fromJSON, check, toJSON } from '@pragmatic-lab/todl'

import { PROJECT_MANIFEST_FILENAME } from '../../../../services/projects/project-factory.js'
import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { META_MODELS_BACKEND_ID } from '../../../meta-model/services/meta-models-backend.js'
import { LIBRARIES_BACKEND_ID } from '../libraries-backend.js'
import { LibraryProjectFactory } from '../library-project-factory.js'

function factory(): LibraryProjectFactory { return new LibraryProjectFactory(new ServiceProvider()) }

// A meta-model with the concepts a library references, published to a fake
// meta-models backend; plus a fake libraries backend to receive the publish.
const META = 'namespace ea { concept location { label : string; } concept technology { label : string; } }'
function publishEnv(): { provider: ServiceProvider; meta: FakeStorage; libs: FakeStorage } {
  const provider = new ServiceProvider()
  const registry = new StorageProviderRegistry(provider)
  const meta = new FakeStorage('fake://meta-models')
  const libs = new FakeStorage('fake://libraries')
  registry.Register(META_MODELS_BACKEND_ID, () => meta)
  registry.Register(LIBRARIES_BACKEND_ID, () => libs)
  provider.registerInstance(StorageProviderRegistry.Key, registry)
  return { provider, meta, libs }
}
async function seedMeta(meta: FakeStorage): Promise<void> {
  await meta.WriteText('ea/5/model.json', JSON.stringify(toJSON(check([{ uri: 'm.todl', text: META }]).model)))
}

const LIB = `namespace lib { taxonomy microsoft : represents location, technology {
  location azure { label = "Azure"; }
  technology azure-openai { label = "Azure OpenAI"; }
} }`

test('createProject writes a library manifest with a publish identity + binding', async () => {
  const storage = new FakeStorage('fake://Acme')
  const project = await factory().createProject(storage, 'Acme Lib', { metaModel: { id: 'ea', version: '5' } })
  expect(project.Type).toBe('library')
  const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
  expect(manifest.type).toBe('library')
  expect(manifest.id).toBe('acme-lib')
  expect(manifest.libVersion).toBe('0.1.0')
  expect(manifest.metaModel).toEqual({ id: 'ea', version: '5' })
})

test('requiresMetaModel is true', () => {
  expect(factory().requiresMetaModel).toBe(true)
})

test('publish validates against the bound meta-model and writes the compiled library', async () => {
  const storage = new FakeStorage('fake://Acme')
  const f = factory()
  await f.createProject(storage, 'microsoft', { metaModel: { id: 'ea', version: '5' } })
  await storage.WriteText('microsoft.todl', LIB)
  const { provider, meta, libs } = publishEnv()
  await seedMeta(meta)
  const result = await f.publish(await f.openProject(storage), storage, provider)
  expect(result.ok).toBe(true)
  expect(await libs.Exists('microsoft/0.1.0/model.json')).toBe(true)
  const doc = JSON.parse(await libs.ReadText('microsoft/0.1.0/model.json'))
  expect(() => fromJSON(doc)).not.toThrow()
  expect(await libs.Exists('microsoft/0.1.0/src/microsoft.todl')).toBe(true)
})

test('publish is blocked when the bound meta-model is not published', async () => {
  const storage = new FakeStorage('fake://Acme')
  const f = factory()
  await f.createProject(storage, 'microsoft', { metaModel: { id: 'ghost', version: '1' } })
  await storage.WriteText('microsoft.todl', LIB)
  const { provider, libs } = publishEnv()
  const result = await f.publish(await f.openProject(storage), storage, provider)
  expect(result.ok).toBe(false)
  expect(libs.size).toBe(0)
})
```

- [ ] **Step 3: Run — fail.**

- [ ] **Step 4: Implement `library-project-factory.ts`** — copy `meta-model-project-factory.ts` as the template and adapt:
  - `ProjectType = 'library'`; `public readonly requiresMetaModel = true`.
  - Manifest: `interface LibraryManifest extends ProjectManifestEnvelope { id: string; libVersion: string; metaModel?: BaseRef }`.
  - `createProject(storage, name, bindings?)`: `{ type, name, version: 1, id: slugify(name), libVersion: '0.1.0', metaModel: bindings?.metaModel }` (omit `metaModel` when absent via conditional spread).
  - `openProject`/`saveProject`/`buildProject`/`populate`: same as meta-model (`.todl` nodes kind `'todl'`).
  - `publish(project, storage, provider)`:

```ts
const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as LibraryManifest
if (manifest.metaModel === undefined) return { ok: false, message: 'Set a meta-model binding before publishing.' }
const { bases, problems } = await resolveBases(provider, { metaModel: manifest.metaModel })
if (problems.length > 0) return { ok: false, message: `Publish blocked: ${problems.join('; ')}.` }
const sources = await collectTodlSources(storage)
if (sources.length === 0) return { ok: false, message: 'Nothing to publish — the project has no .todl files.' }
const { model, diagnostics } = checkAgainst(bases, sources)
const errors = diagnostics.filter((d) => d.severity === Severity.Error)
if (errors.length > 0) return { ok: false, message: `Publish blocked: ${errors.length} error(s). Fix them first.` }
const dest = ensureLibrariesBackend(provider)
const base = `${manifest.id}/${manifest.libVersion}`
await dest.WriteText(`${base}/model.json`, JSON.stringify(toJSON(model), null, 2))
for (const s of sources) await dest.WriteText(`${base}/src/${s.uri}`, s.text)
return { ok: true, message: `Published ${manifest.id}@${manifest.libVersion} (${sources.length} file(s)).` }
```

  Imports: `checkAgainst, toJSON, Severity` from `@pragmatic-lab/todl`; `resolveBases` from base-resolver; `ensureLibrariesBackend` from `./libraries-backend.js`; `type BaseRef`/`BaseBindings` from base-binding; `collectTodlSources`, `extname`, `joinRel` from the meta-model module's `todl-sources.js` (reuse — `import { collectTodlSources, extname, joinRel } from '../../meta-model/services/todl-sources.js'`).

- [ ] **Step 5: Run — pass. Typecheck.**

- [ ] **Step 6: Commit** `feat(library): add LibraryProjectFactory (meta-model-bound publish via checkAgainst)`.

---

## Task 5: Library module + app wiring

**Files:**
- Create: `src/renderer/src/modules/library/library.module.mu` (+ regenerate `.mu.js`)
- Modify: `src/renderer/src/app.mu` (+ regenerate `.mu.js`) — add `LibraryModule` to `.modules:` (TodlValidationService added in Task 3)

- [ ] **Step 1: Write `library.module.mu`:**

```
import LibraryProjectFactory from "./services/library-project-factory.js"

module LibraryModule [ Name = "Library" ] {
    .services: {
        LibraryProjectFactory
    }

    .projectFactories: {
        ProjectFactoryDefinition
            [ Type        = "library",
              Title       = "Library Project",
              Description = "Author a technology library (taxonomy) against a meta-model.",
              Factory     = LibraryProjectFactory ]
    }
}
```

- [ ] **Step 2: Add to `app.mu`** — `import LibraryModule from "./modules/library/library.module.mu.js"` and add `LibraryModule` to `.modules:`.

- [ ] **Step 3: compile:mu, typecheck, full test** — all green; the `library` type now appears in New Project (unbound picker until Task 6).

- [ ] **Step 4: Commit** `feat(library): register LibraryModule + library project type`.

---

## Task 6: New-Project meta-model picker

**Files:**
- Modify: `src/renderer/src/services/projects/new-project-dialog-model.ts` (result field, picker props, `MetaModelChoice`, `RequiresMetaModel` on choice)
- Modify: `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts` (`typeChoices`, `newProject`, `createProjectAt`)
- Modify: `src/renderer/src/modules/project-explorer/project-explorer.resources.mu` (+ regenerate) — meta-model combo
- Test: extend `src/renderer/src/services/projects/tests/new-project-dialog-model.test.ts` (create if absent)

**Interfaces:**
- Produces: `NewProjectResult.metaModel?: BaseRef`; `ProjectTypeChoice.RequiresMetaModel`; `NewProjectDialogModel(choices, fs, validate, close, metaModels)` with `MetaModels`, `SelectedMetaModel`, `ShowMetaModelPicker`.

- [ ] **Step 1: Read** `new-project-dialog-model.ts` fully (it's the dialog model; the Explore report has its shape). Then write/extend the test asserting: (a) selecting a `RequiresMetaModel` choice sets `ShowMetaModelPicker` and blocks `CanConfirm` until `SelectedMetaModel` is set; (b) `confirm()` yields `result.metaModel`; (c) a non-requiring type never blocks on it. Run — fail.

- [ ] **Step 2: Implement dialog changes:**
  - `NewProjectResult` gains `metaModel?: BaseRef` (import `BaseRef`).
  - `ProjectTypeChoice` gains `RequiresMetaModel: boolean` DP (default false), set via constructor or setter.
  - Add `MetaModelChoice extends Model` with a `Ref: BaseRef` and `Label` (`${id} @ ${version}`).
  - `NewProjectDialogModel` constructor gains `metaModels: readonly BaseRef[]`; build `MetaModels: ObservableCollection<MetaModelChoice>`. Add `SelectedMetaModel: MetaModelChoice | undefined` DP and `ShowMetaModelPicker: boolean` DP.
  - `select(c)` sets `ShowMetaModelPicker = c.RequiresMetaModel` and `recompute()`.
  - `recompute()` `CanConfirm = name && location && type && (!ShowMetaModelPicker || SelectedMetaModel)`.
  - `confirm()` includes `metaModel: this.ShowMetaModelPicker ? this.SelectedMetaModel?.Ref : undefined`.
  - When `ShowMetaModelPicker` and `MetaModels` empty, set `Error = 'Publish a meta-model first.'`.

- [ ] **Step 3: Implement explorer changes:**
  - `typeChoices()`: resolve each factory (`resolveFactory(d.Type)`), read `requiresMetaModel`, set on the choice.
  - `newProject()`: enumerate published meta-models — `const meta = ensureMetaModelsBackend(this.Provider); const refs: BaseRef[] = []; for (const id of await meta.List('')) if (id.IsDirectory) for (const v of await meta.List(id.Name)) if (v.IsDirectory) refs.push({ id: id.Name, version: v.Name })` — and pass `refs` to the dialog.
  - `createProjectAt(type, name, folder, metaModel?)`: forward `factory.createProject(storage, name, metaModel ? { metaModel } : undefined)`; update `newProject`'s call to pass `result.metaModel`.

- [ ] **Step 4: Template** — in `project-explorer.resources.mu`, add under the Name/Location block a meta-model row (label + `ComboBox [ ItemsSource = $MetaModels, SelectedItem = $SelectedMetaModel ]`) with visibility bound to `$ShowMetaModelPicker`. Confirm the mural visibility attribute (`IsVisible` or `Visibility`) against an existing template; if none binds visibility, gate via a `Border` whose `IsVisible = $ShowMetaModelPicker`. The combo shows `MetaModelChoice.Label` (set an `ItemTemplate` or rely on `ToString`/`Label` display per the ChoiceSettingRow precedent).

- [ ] **Step 5: compile:mu, typecheck, full test.** Explorer + dialog tests green.

- [ ] **Step 6: Commit** `feat(project-explorer): New-Project meta-model picker for library projects`.

---

## Task 7: Refresh-Bases command

**Files:**
- Modify: `src/renderer/src/services/projects/open-project.ts` (add `RefreshBasesCommand`)
- Modify: `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts` (wire it)
- Modify: `src/renderer/src/modules/project-explorer/project-explorer.resources.mu` (+ regenerate) — menu item
- Test: extend the explorer test — refresh clears the cache → next validate re-resolves.

- [ ] **Step 1: Read** `open-project.ts` to see how `PublishCommand`/`CloseCommand` are defined; add a `RefreshBasesCommand: ICommand | undefined` DP the same way.

- [ ] **Step 2: Test** — in the validation service test (Task 3 location), add: seed a base, `Revalidate` (caches), change the fake backend's `model.json`, `Revalidate` again → unchanged (cache), `ClearBaseCache(storage)` → `Revalidate` → reflects the new base. Run — fail if `ClearBaseCache` behavior missing (it exists from Task 3; this asserts the caching contract).

- [ ] **Step 3: Wire the command** in the explorer where per-project commands are built (near Publish/Close): `op.RefreshBasesCommand = new RelayCommand(() => { this.Provider.get(TodlValidationService.Key)?.ClearBaseCache(op.Storage); void this.Provider.get(TodlValidationService.Key)?.Revalidate() })`. Import `TodlValidationService`.

- [ ] **Step 4: Template** — add a "Refresh Bases" context-menu item bound to `$RefreshBasesCommand` alongside the existing project menu items.

- [ ] **Step 5: compile:mu, typecheck, full test.**

- [ ] **Step 6: Commit** `feat(project-explorer): Refresh Bases command re-resolves a project's published bases`.

---

## Definition of Done

- `npm test`, `npm run typecheck`, `npm run compile:mu` all pass.
- `library` project type: create (with meta-model picker) → author `.todl` with live `checkAgainst` squiggles against the bound meta-model → publish to `<userData>/libraries/<id>/<libVersion>/`.
- `TodlValidationService` is the shared, base-aware, root-scoped validator; meta-model projects behave identically (`bases=[]`).
- `resolveBases` + `BaseBindings` + the `createProject` binding param + the picker are in place for SP4 to reuse.
- Refresh-Bases re-resolves after a republish.
- The stray `ontologies-service.ts` was never staged.

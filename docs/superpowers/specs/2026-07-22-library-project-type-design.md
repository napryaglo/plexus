# Library Project Type + Libraries Backend

**Date:** 2026-07-22
**Status:** ✅ Finished
**Repo:** Plexus (renderer) + consumes TODL `checkAgainst` (SP3, published)
**Arc:** Sub-project 2 of 4 (architecture-model loading). Adds the `library`
project type and the shared **base-resolution + base-aware validation**
machinery that SP4 (architecture) reuses.

## Principle

A **library** is a `.todl` file authoring a multi-representation taxonomy
(`taxonomy microsoft : represents location, technology { … }`) whose terms
reference concepts and base-taxonomy terms defined in a **meta-model**. It is not
self-contained: validating or compiling it needs the meta-model as a base — via
TODL's `checkAgainst(bases, sources)` (SP3). So a library project declares which
meta-model it targets; publish resolves that meta-model's compiled artifact and
validates the library against it before writing to a dedicated libraries backend.

Meta-model projects, library projects, and (SP4) architecture projects are all
"consuming projects": a project declares zero-or-more **base** models, and both
live validation and publish validate its sources via `checkAgainst(bases, …)`.
A meta-model declares no base (`bases = []`, so `checkAgainst` ≡ `check`); a
library declares one meta-model; an architecture declares a meta-model + libraries.

## Components

### 1. Libraries backend

`src/renderer/src/modules/library/services/libraries-backend.ts`, mirroring
`meta-models-backend.ts`:

- `LIBRARIES_BACKEND_ID = 'libraries'`
- `ensureLibrariesBackend(provider): IStorage` — lazily registers a
  `LocalFileStorage` rooted at `<userData>/libraries` on the shared
  `StorageProviderRegistry`. App-global, rooted once.

### 2. Base binding on the manifest

A shared manifest shape for a project's declared bases, in
`src/renderer/src/services/projects/base-binding.ts`:

```ts
export interface BaseRef { id: string; version: string }   // version = the published modelVersion

export interface BaseBindings {
  metaModel?: BaseRef              // the meta-model a project is authored against
  libraries?: readonly BaseRef[]  // additional library bases (architecture only; SP4)
}
```

The library manifest extends `ProjectManifestEnvelope` with `id`, `libVersion`
(its own publish identity, like the meta-model's `id`/`modelVersion`) and
`metaModel?: BaseRef` (its base).

### 3. Base resolver (shared)

`src/renderer/src/services/projects/base-resolver.ts`:

```ts
export async function resolveBases(provider: IServiceProvider, bindings: BaseBindings): Promise<TodlDocument[]>
```

Reads each bound base's compiled `model.json` and returns the parsed
`TodlDocument`s in a stable order (meta-model first, then libraries):

- `metaModel` → `ensureMetaModelsBackend(provider)` → `ReadText(`${id}/${version}/model.json`)` → `JSON.parse`.
- each `libraries[i]` → `ensureLibrariesBackend(provider)` → same shape.
- A missing/unreadable base is skipped and reported via a returned diagnostics
  channel, so validation can surface "meta-model not published" rather than
  silently under-validating. Signature returns `{ bases, problems }` where
  `problems: string[]` names each unresolved binding.

Final shape:

```ts
export async function resolveBases(
  provider: IServiceProvider, bindings: BaseBindings,
): Promise<{ bases: TodlDocument[]; problems: string[] }>
```

### 4. Base-aware validation

`MetaModelValidationService.Revalidate` currently groups tracked docs by their
project `IStorage` and validates each group with `check(sources)`. Change the
per-storage step to:

1. Read the project manifest from that storage (`project.plexus`) and extract its
   `BaseBindings` (a meta-model project has none).
2. `resolveBases(provider, bindings)` → `{ bases, problems }`, cached per storage
   (invalidated on nothing in v1 — bases change only on republish; a manual
   refresh is a follow-up).
3. `checkAgainst(bases, overlaySources(stored, open))` instead of `check(...)`.
4. If `problems` is non-empty, attach a whole-file warning ("meta-model
   `<id>@<version>` is not published") to each of the project's open docs, in
   addition to the `checkAgainst` diagnostics.

`validateSources(sources)` gains a `bases` parameter (default `[]`), so its
existing behavior — and every meta-model test — is preserved: `checkAgainst([], s)`
≡ `check(s)`. The service is no longer meta-model-specific, so it is **renamed
`TodlValidationService` and relocated** to a shared home,
`src/renderer/src/services/todl/todl-validation-service.ts`, and registered
root-scoped in `app.mu` `.services:` (like `ProjectFactoryRegistry`) rather than
in the meta-model module. Its three consumers update accordingly:
`TodlDocumentFactory` (import + `AttachDocument` via the new `.Key`), the
meta-model module `.mu` (drops the service registration), and the test file
(moved to `services/todl/tests/`). A **manual refresh** is added: a public
`ClearBaseCache()` that drops the per-storage resolved-bases cache and
re-validates, wired to a per-project "Refresh Bases" command (see §7).

### 5. Library project factory

`src/renderer/src/modules/library/services/library-project-factory.ts` —
`LibraryProjectFactory`, `ProjectType='library'`, `formats=[.todl]`,
`implements IProjectFactory, IPublishableProjectFactory`. Mirrors
`MetaModelProjectFactory` for lifecycle; `.todl` files edit through SP1's
`TodlDocumentFactory` (resolved by extension — no new editor). Manifest:

```ts
interface LibraryManifest extends ProjectManifestEnvelope {
  id: string            // publish identity, slugify(name)
  libVersion: string    // published version, default '0.1.0'
  metaModel?: BaseRef   // the meta-model this library targets
}
```

`createProject` receives the chosen binding through a new **optional** parameter
on `IProjectFactory`:

```ts
createProject(storage: IStorage, name: string, bindings?: BaseBindings): Promise<Project>
```

Existing factories ignore the extra arg (fewer-params is assignable in TS — no
change to `MetaModelProjectFactory` / `ArchitectureProjectFactory`).
`LibraryProjectFactory.createProject` writes `metaModel: bindings?.metaModel`
into the manifest. The binding is chosen in the New-Project dialog (§6a).

`publish(project, storage, provider)`:

1. Read the manifest; if no `metaModel` binding → `{ ok: false, message: 'Set a
   meta-model binding first.' }`.
2. `resolveBases(provider, { metaModel })`; if `problems` → block with a message.
3. `collectTodlSources(storage)`; if empty → block.
4. `checkAgainst(bases, sources)`; if any `Severity.Error` → block with the count.
5. Write `toJSON(model)` (the full merged graph — SP3's dedup makes full-graph
   library artifacts composable) to
   `ensureLibrariesBackend(provider)` under `${id}/${libVersion}/model.json`, plus
   each source under `${id}/${libVersion}/src/${uri}`. Return `{ ok: true, … }`.

### 6. New-Project meta-model picker

`NewProjectResult` gains `metaModel?: BaseRef`. `NewProjectDialogModel`:

- Gains a constructor param `metaModels: readonly BaseRef[]` (the published
  meta-models, supplied by the explorer — the dialog has no provider).
- Exposes `MetaModels: ObservableCollection<MetaModelChoice>` (a small `Model`
  wrapping a `BaseRef` with a `Label` like `"ea @ 5"`), `SelectedMetaModel`, and
  a derived `ShowMetaModelPicker: boolean`.
- `ProjectTypeChoice` gains `RequiresMetaModel: boolean`. On type-select,
  `ShowMetaModelPicker = SelectedType.RequiresMetaModel`.
- `CanConfirm` additionally requires a selected meta-model **when**
  `ShowMetaModelPicker`. `confirm()` sets `result.metaModel` from
  `SelectedMetaModel` when the type requires it.

The explorer:

- `typeChoices()` resolves each factory and reads an optional
  `readonly requiresMetaModel?: boolean` on `IProjectFactory`
  (`LibraryProjectFactory` sets it `true`), stamping `RequiresMetaModel` on the
  choice.
- `newProject()` enumerates published meta-models —
  `ensureMetaModelsBackend(provider).List('')` (dirs = ids) → for each id
  `List(id)` (dirs = versions) → `BaseRef[]` — and passes them to the dialog.
- `createProjectAt` forwards `result.metaModel` as
  `factory.createProject(storage, name, result.metaModel ? { metaModel: result.metaModel } : undefined)`.

Template (`project-explorer.resources.mu`): a `ComboBox`
(`ItemsSource = $MetaModels`, `SelectedItem = $SelectedMetaModel`) under a "Meta-model"
label, its visibility bound to `$ShowMetaModelPicker`, following the existing
`ChoiceSettingRow` combo pattern. When a library type is selected and no
meta-model is published, `CanConfirm` stays false and `Error` reads
"Publish a meta-model first."

### 7. Refresh Bases command

`OpenProject` gains a `RefreshBasesCommand` (context menu, "Refresh Bases"). It
calls `TodlValidationService.ClearBaseCache(storage)` then `Revalidate()`, so a
freshly (re)published meta-model/library is picked up without reopening the
project. Wired in `wireNodes`/project-command setup alongside Publish/Close.

### 8. Library module + wiring

`src/renderer/src/modules/library/library.module.mu` (+ compiled `.mu.js`):
registers `LibraryProjectFactory` in `.services:` and a `.projectFactories:`
entry (`Type="library"`, `Factory=LibraryProjectFactory`). No `.documents:` —
`.todl` editing comes from the meta-model module's `TodlDocumentFactory`. Add
`LibraryModule` to `app.mu`'s `.modules:`.

## Data flow

Author a library `.todl` → the validation service reads the project's `metaModel`
binding, resolves the compiled meta-model from the meta-models backend, and shows
`checkAgainst` squiggles live. Publish re-runs `checkAgainst`; if clean, the full
merged model + sources land in `<userData>/libraries/<id>/<libVersion>/`, ready
for SP4's architecture resolver to consume alongside the meta-model.

## Testing

- **Libraries backend:** `ensureLibrariesBackend` registers once (idempotent) and
  roots at `<userData>/libraries` (fake env + registry, mirror the meta-models
  backend test).
- **Base resolver:** given a fake meta-models backend holding `ea/5/model.json`,
  `resolveBases(_, { metaModel: { id: 'ea', version: '5' } })` returns that parsed
  `TodlDocument`; a missing binding target is reported in `problems`, not thrown.
- **Base-aware validation:** `validateSources(sources, bases)` with a meta-model
  base makes a library source validate clean, where `validateSources(sources)`
  (no base) leaves it under-validated — proving the base flows through. `bases`
  defaulting to `[]` keeps every existing meta-model validation test green.
- **Library factory lifecycle:** create writes a `library` manifest with
  `id`/`libVersion`; open scans `.todl` nodes; mirror the meta-model factory tests.
- **Library publish:** against a fake meta-models backend (holding a compiled EA)
  and a fake libraries backend, publishing a clean library writes
  `microsoft/0.1.0/model.json` (a round-trippable `TodlDocument`) + its sources;
  a library with an error, or an unresolved meta-model binding, is blocked and
  writes nothing.
- **Explorer/meta-model regression:** meta-model projects (no binding) validate
  and publish exactly as before.

## Testing (picker / rename / refresh)

- **Type choice flag:** `typeChoices()` stamps `RequiresMetaModel=true` on the
  library choice (factory flag), `false` on meta-model/architecture.
- **Dialog picker:** with `metaModels=[{id:'ea',version:'5'}]`, selecting the
  library type shows the picker and `CanConfirm` is false until a meta-model is
  chosen; `confirm()` yields `result.metaModel = {id:'ea',version:'5'}`. A
  meta-model type never requires a pick.
- **createProject binding:** `LibraryProjectFactory.createProject(s, name, {metaModel})`
  writes the binding into the manifest; called with no bindings, `metaModel` is absent.
- **Rename parity:** the relocated `TodlValidationService` passes the ported
  validation test verbatim (behavior unchanged for meta-model projects).
- **Refresh:** `ClearBaseCache(storage)` drops the cache so the next
  `Revalidate` re-resolves bases (fake backend whose content changes between
  passes proves the cache is cleared).

## Consequences / out of scope

- SP4 (architecture project: `metaModel` + `libraries` bindings) reuses
  `resolveBases`, base-aware validation, the `bindings` create param, and the
  picker (its `RequiresMetaModel` choice + a libraries multi-select) directly.
- Delta (non-full-graph) library artifacts remain unnecessary (SP3 dedup).

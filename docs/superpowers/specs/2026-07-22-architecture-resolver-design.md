# Architecture Resolver (SP4) — Design

**Status:** ✅ Finished
**Date:** 2026-07-22
**Depends on:** SP1 (editor/project separation), SP2 (library project type — base bindings, `resolveBases`, base-aware `TodlValidationService`, New-Project meta-model picker, Refresh-Bases), SP3 (`@pragmatic-lab/todl` `checkAgainst`).

## Goal

Turn the `architecture` project type into a terminal TODL-authoring project that binds a **meta-model** and a **set of libraries**, reusing SP2's base-resolution + base-aware validation machinery so its instance-tier `.todl` model gets live `checkAgainst([metaModel, ...libraries], sources)` squiggles.

## Decisions (locked)

- **Authors `.todl`.** The architecture project's files are instance-tier TODL — the architecture model. Its `formats` swap from `.diagram` to `.todl` outright; `.diagram` visualization is out of scope (deferred to a later sub-project).
- **Binds meta-model + libraries.** `BaseBindings = { metaModel?, libraries? }` — the architecture project uses both fields (the library project used only `metaModel`).
- **No publish (terminal).** Architecture is the end of the chain; it consumes bases but produces nothing others bind to. The factory does **not** implement `IPublishableProjectFactory`, so the Publish context-menu item stays hidden (gated by `isPublishable`). No architectures backend.
- **Multi-select libraries in New Project.** The New-Project dialog gains a libraries checklist (multi-select, optional — zero libraries is valid) shown alongside the meta-model single-select (required).
- **Checklist UI.** The libraries picker is an `ItemsControl` of checkbox rows over a `LibraryChoice` model (each with an `IsSelected` DP), mirroring the existing `ProjectTypeChoice` items pattern — declarative, testable, no dependency on mural `ListBox` multi-selection.

## Architecture & Data Flow

```
New Project
  └─ pick type "architecture"
       ├─ meta-model single-select  (required — reused from SP2)
       └─ libraries multi-select checklist  (optional — new)
  └─ createProject(storage, name, { metaModel, libraries })
       └─ writes manifest { type:"architecture", name, version, metaModel?, libraries? }
Open / edit a .todl
  └─ TodlDocumentFactory (resolved by extension) attaches the doc to TodlValidationService
       └─ basesFor(storage): reads manifest.metaModel + manifest.libraries
            └─ resolveBases(provider, { metaModel, libraries })
                 ├─ ensureMetaModelsBackend → <id>/<version>/model.json
                 └─ ensureLibrariesBackend  → <id>/<version>/model.json  (per library)
       └─ checkAgainst([metaModel, ...libraries], sources) → live squiggles
Refresh Bases (already wired, gated on requiresMetaModel)
  └─ ClearBaseCache(storage) + Revalidate → picks up a republished base
```

The validator already reads `manifest.libraries` and `resolveBases` already loads a `libraries[]` array (both landed in SP2 and are covered by `base-resolver.test.ts`). So once the architecture manifest carries `metaModel` + `libraries`, live validation of the full base set works with no validator change.

## Units That Change

### 1. `IProjectFactory` + `NewProjectResult`
`src/renderer/src/services/projects/project-factory.ts`
- Add `readonly offersLibraries?: boolean` to `IProjectFactory` — when true, the New-Project dialog shows the libraries checklist. Absent ⇒ false. (Existing factories unaffected — the field is optional.)

`src/renderer/src/services/projects/new-project-dialog-model.ts`
- `NewProjectResult` gains `libraries?: readonly BaseRef[]`.

### 2. `ArchitectureProjectFactory`
`src/renderer/src/modules/architecture-repository/services/architecture-project-factory.ts`
- `formats` → `[{ extension: '.todl', kind: 'todl', displayName: 'TODL Definition' }]`.
- `public readonly requiresMetaModel = true`, `public readonly offersLibraries = true`.
- `ArchitectureManifest extends ProjectManifestEnvelope { metaModel?: BaseRef; libraries?: readonly BaseRef[] }`.
- `createProject(storage, name, bindings?: BaseBindings)` persists `metaModel` (when present) + `libraries` (when non-empty) via conditional spread; `saveProject` preserves them.
- `populate` marks `.todl` nodes openable (kind `'todl'`); `.diagram`/other → `'file'`.
- Does **not** implement `IPublishableProjectFactory` (no `publish`).

### 3. New-Project dialog model
`src/renderer/src/services/projects/new-project-dialog-model.ts`
- New `LibraryChoice extends Model`: `readonly Ref: BaseRef`, `Label` (`${id} @ ${version}`), `IsSelected: boolean` DP (default false), `toString()` → `Label`.
- `NewProjectDialogModel` constructor gains a `libraries: readonly BaseRef[] = []` param (after `metaModels`); builds `Libraries: ObservableCollection<LibraryChoice>`.
- `ShowLibrariesPicker: boolean` DP — set in `select(choice)` from `choice.offersLibraries` (a new `offersLibraries` flag on `ProjectTypeChoice`, plumbed like `RequiresMetaModel`).
- `SelectedLibraries` getter: the `LibraryChoice`s whose `IsSelected` is true, mapped to their `Ref`.
- `confirm()` includes `libraries: this.ShowLibrariesPicker ? this.SelectedLibraries : undefined` (omit when empty via the existing conditional-spread style, or pass `[]` — pick: **omit when the picker is hidden; include the array (possibly empty) when shown**).
- Libraries are optional: `recompute()`'s `CanConfirm` is unaffected by the libraries selection (zero libraries is valid).
- `ProjectTypeChoice` gains an `offersLibraries` constructor param + `OffersLibraries` DP (mirrors `requiresMetaModel`/`RequiresMetaModel`).

### 4. Explorer wiring
`src/renderer/src/modules/project-explorer/services/project-explorer-service.ts`
- `typeChoices()` reads `factory.offersLibraries` onto each `ProjectTypeChoice` (alongside `requiresMetaModel`).
- New `publishedLibraries(): Promise<BaseRef[]>` mirroring `publishedMetaModels()` but over `ensureLibrariesBackend(this.Provider)`.
- `newProject()` passes `await this.publishedLibraries()` as the dialog's 6th arg; forwards `result.libraries` to `createProjectAt`.
- `createProjectAt(type, name, folder, metaModel?, libraries?)` forwards `factory.createProject(storage, name, (metaModel || libraries?.length) ? { metaModel, libraries } : undefined)`.

### 5. Template
`src/renderer/src/modules/project-explorer/project-explorer.resources.mu`
- Below the meta-model combo, a libraries checklist: `Border [ Visibility = $ShowLibrariesPicker << ToVisibility ]` wrapping a label + `ItemsControl [ ItemsSource = $Libraries, ItemsPanel = @VerticalStackPanel ]`, with a `DataTemplate [ DataType = LibraryChoice ]` = a row pairing a `Switch [ IsChecked = $IsSelected ]` with a `TextBlock [ Text = $Label ]`. (`Switch`'s two-way `IsChecked` is proven in `layout-inspector.resources.mu` — `Switch [ IsChecked = $Value ]`; no `CheckBox` control exists.)

## Error Handling

- A missing/unpublished bound base (meta-model or any library) surfaces through the existing validator path: `resolveBases` collects it in `problems`, and `Revalidate` prepends a whole-file "Unresolved base: …" diagnostic. No new handling needed.
- New Project with no published meta-models: the existing "Publish a meta-model first." guard fires (architecture `requiresMetaModel`). No published libraries is fine — the checklist is simply empty and zero libraries is valid.

## Testing

- **Factory** (`tests/architecture-project-factory.test.ts`): `createProject(storage, name, { metaModel, libraries })` writes both into the manifest; `requiresMetaModel` + `offersLibraries` are true; `isPublishable(factory)` is false; `openProject` tags `.todl` nodes `'todl'`.
- **Dialog model** (extend `tests/new-project-dialog-model.test.ts`): an `offersLibraries` type shows the libraries picker; toggling `LibraryChoice.IsSelected` flows into `confirm().libraries`; confirming with zero libraries yields `libraries: []` (picker shown) and still requires the meta-model; a non-offering type omits `libraries`.
- **Validation**: the `[metaModel, ...libraries]` resolution path is already covered by `base-resolver.test.ts` (the `libraries[]` arm) and the base-aware `todl-validation-service.test.ts`; no new validator test required.

## Global Constraints

- Every test file in a `tests/` subfolder next to its source.
- Real TS enums; no new string-literal union types.
- Commits authored `Eugene Napryaglo <evgen.napryaglo@gmail.com>`; message ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Do NOT stage `src/renderer/src/modules/ontologies/services/ontologies-service.ts`.
- `.mu.js` are gitignored build artifacts — regenerate with `npm run compile:mu`; do not commit them. `library.module.mu` established that new `.mu` files must be added to the `compile:mu` file list in `package.json`.
- Verify from `Plexus/`: `npm test`, `npm run typecheck`, `npm run compile:mu`.

## Definition of Done

- `npm test`, `npm run typecheck`, `npm run compile:mu` all pass.
- Creating an `architecture` project shows the meta-model single-select + the libraries multi-select; the chosen `{ metaModel, libraries }` is written to the manifest.
- Authoring a `.todl` in an architecture project gets live `checkAgainst` squiggles against the meta-model **and** the bound libraries.
- Architecture is not publishable (no Publish item); Refresh-Bases re-resolves after a republish.
- `ontologies-service.ts` was never staged.
```

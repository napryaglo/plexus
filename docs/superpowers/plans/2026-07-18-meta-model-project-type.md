# Meta-model Project Type — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a "meta-model" Plexus project type — author + whole-project
live-validate `.todl` in Monaco (inline squiggles), publish compiled
`TodlDocument` JSON + sources into a meta-models storage backend.

**Spec:** `docs/superpowers/specs/2026-07-18-meta-model-project-type-design.md`
(carries the code-level detail; tasks reference it rather than duplicating).

**Tech Stack:** TypeScript (ESM, strict), mural runtime/framework, Monaco,
`@pragmatic-tech-ai/todl@^0.1.0`, Vitest.

## Global Constraints

- `@pragmatic-tech-ai/todl@^0.1.0` in `dependencies` (done — installed from Verdaccio).
- Every test file in a `tests/` subfolder next to its source. Vitest; no
  Monaco/DOM in tests — pure functions + services against `FakeStorage`.
- Real TS enums for fixed value sets (`EditorSeverity`). Named constants for the
  `todl` language id and `"meta-model"` type string.
- TODL API: `check(sources: SourceFile[]) → { model, diagnostics }`;
  `toJSON(model) → TodlDocument`; `Severity.Error === 'error'`; `SourceFile =
  { uri, text }`; `Diagnostic.span: SourceSpan | null` with 1-based
  `start/end` `{ line, column }`, end exclusive.
- mural observation: `Model.AddPropertyChangedListener(key, cb)` /
  `RemovePropertyChangedListener`; `ObservableCollection.Subscribe(listener) →
  unsubscribe` with `CollectionChange { kind: 'inserted'|'removed'|…, items }`.

---

### Task 1: Generic diagnostics channel (code-editor module)

**Files:**
- Create: `src/renderer/src/modules/code-editor/editor-diagnostic.ts`
- Create: `src/renderer/src/modules/code-editor/tests/editor-diagnostic.test.ts`
- Modify: `src/renderer/src/modules/code-editor/code-document.ts` (add `Diagnostics` DP)
- Create: `src/renderer/src/modules/code-editor/tests/code-document.test.ts`

**Produces:** `EditorSeverity` enum; `EditorDiagnostic` interface (severity +
1-based `startLine/startColumn/endLine/endColumn` + message); `toMarkers(diags)
→ monaco.editor.IMarkerData[]` (severity map Error→8/Warning→4/Info→2/Hint→1);
`CodeDocument.DiagnosticsKey` + `Diagnostics` getter (empty `ObservableCollection`
by default).

- [ ] Write failing tests: `toMarkers` maps each severity + copies the range 1:1;
      `CodeDocument.Diagnostics` defaults to an empty collection.
- [ ] Run: `npx vitest run editor-diagnostic code-document` → fails.
- [ ] Implement `editor-diagnostic.ts` + the `Diagnostics` DP.
- [ ] Run tests → pass.
- [ ] Commit.

### Task 2: Meta-models backend (meta-model module)

**Files:**
- Create: `src/renderer/src/modules/meta-model/services/meta-models-backend.ts`
- Create: `src/renderer/src/modules/meta-model/services/tests/meta-models-backend.test.ts`

**Produces:** `META_MODELS_BACKEND_ID = 'meta-models'`;
`ensureMetaModelsBackend(provider) → IStorage` — lazily registers the backend
(rooted `<UserDataDirectory>/meta-models` via `EnvironmentService` +
`FileSystemService`/`LocalFileStorage`) on the `StorageProviderRegistry`
(idempotent via `Has`), returns `registry.Create(id, '')`.

- [ ] Failing test: given a provider with a `StorageProviderRegistry` + fake
      `EnvironmentService`/`FileSystemService`, first call registers the backend
      (`registry.Has` true after) and returns an `IStorage`; second call does not
      re-register.
- [ ] Run → fails. Implement. Run → pass. Commit.

### Task 3: `MetaModelProjectFactory` (meta-model module)

**Files:**
- Create: `src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts`
- Create: `src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts`

**Consumes:** Task 2 (`ensureMetaModelsBackend`), TODL `check`/`toJSON`.
**Produces:** class implementing `IProjectFactory` + `IPublishableProjectFactory`
(Task 6 interface); `ProjectType = 'meta-model'`; format
`{ '.todl', 'todl', 'TODL Definition' }`; `MetaModelManifest { id, modelVersion }`;
`collectTodlSources(storage) → SourceFile[]`; `slugify(name)`. Registers its
storage with `MetaModelValidationService` (Task 4) on open/create.

- [ ] Failing tests (mirror `diagram-project-factory.test.ts`, `FakeStorage`):
      createProject writes a manifest with `type:'meta-model'`, `id=slugify(name)`,
      `modelVersion:'0.1.0'`; openProject tags `.todl` nodes `'todl'` + hides
      manifest; newFile writes `.todl`; openFile returns a `CodeDocument`
      (Language `'todl'`); publish of a clean 2-file project writes
      `<id>/<ver>/model.json` (`fromJSON` round-trips) + each source under `src/`;
      publish with a syntax error writes nothing and returns `{ ok:false }`.
- [ ] Run → fails. Implement. Run → pass. Commit.

*Note:* factory→validation-service registration is a no-op-safe call (guarded by
`provider.get`), so Task 3 tests pass without Task 4 present; wire fully in Task 4.

### Task 4: `MetaModelValidationService` (meta-model module)

**Files:**
- Create: `src/renderer/src/modules/meta-model/services/meta-model-validation-service.ts`
- Create: `src/renderer/src/modules/meta-model/services/tests/meta-model-validation-service.test.ts`

**Consumes:** Task 1 (`EditorDiagnostic`), Task 3 (`CodeDocument`s), `check`.
**Produces:** service with `SetProject(storage)`; subscribes to
`DocumentsContentHostService.OpenDocuments`; hooks each open `.todl`
`CodeDocument.Content` on a ~250 ms debounce; a pure `validateSources(sources) →
Map<uri, EditorDiagnostic[]>` (spanned `Diagnostic` → `EditorDiagnostic`,
`Severity` → `EditorSeverity`, null span → 1:1); distributes each open doc's
slice into its `Diagnostics` collection.

- [ ] Failing tests (pure core, injectable "now"/synchronous flush): a concept
      defined in file A referenced in file B yields no diagnostic; a syntax error
      in A localizes to A only (B clean); re-running with fixed text clears A.
- [ ] Run → fails. Implement (extract `validateSources` as the tested pure unit;
      the debounce/subscription wrapper is thin). Run → pass. Commit.

### Task 5: Explorer generalization (shared)

**Files:**
- Modify: `src/renderer/src/services/projects/project.ts` (`ProjectNodeKind` += `'todl'`)
- Modify: `src/renderer/src/services/projects/project-factory.ts`
  (`PublishResult`, `IPublishableProjectFactory`, `isPublishable`)
- Modify: `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts`
  (format-driven `openNode`; `NewDiagramCommand`→`NewFileCommand`/`newFile`;
  `PublishCommand`/`publish`)
- Modify: `src/renderer/src/modules/project-explorer/project-explorer.resources.mu`
  (`$NewDiagramCommand`→`$NewFileCommand`; add a Publish `PanelButton`)
- Create/extend: `src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts`

**Produces:** the shared interfaces + a generic explorer. Diagram behavior
unchanged.

- [ ] Failing tests: `openNode` opens a `'todl'` node (a fake publishable factory
      declaring that format) via `openFile`, and a plain `'file'` via OS;
      `newFile` creates the active factory's first format; `publish` delegates
      only when `isPublishable`, surfacing the message.
- [ ] Run → fails. Implement. Run → pass.
- [ ] Recompile markup (`npm run compile:mu`) after the `.mu` edit. Commit.

### Task 6: CodeEditor markers + todl language (code-editor + meta-model)

**Files:**
- Modify: `src/renderer/src/modules/code-editor/code-editor.ts` (bind `$Diagnostics`;
  apply `setModelMarkers` on change)
- Modify: `src/renderer/src/modules/code-editor/code-document.ts`
  (`LANGUAGE_BY_EXT.todl = 'todl'`)
- Create: `src/renderer/src/modules/meta-model/todl-language.ts`
  (`registerTodlLanguage()` — minimal Monaco language id + Monarch tokenizer)

**Produces:** view wiring (no unit tests — Monaco/DOM; verified by typecheck +
manual run). `registerTodlLanguage` is idempotent.

- [ ] Implement; bind `Diagnostics` in `CodeEditor` ctor via `DataContextBinding`;
      on `Diagnostics` change + collection change, call
      `monaco.editor.setModelMarkers(this.editor.getModel(), 'todl', toMarkers(...))`.
- [ ] `npm run typecheck` → clean. Commit.

### Task 7: Module wiring + verification

**Files:**
- Create: `src/renderer/src/modules/meta-model/meta-model.module.mu`
- Modify: `src/renderer/src/app.mu` (import + `.modules:` + call `registerTodlLanguage`
  from bootstrap, or register on module load)
- Modify: `package.json` `compile:mu` (add the module `.mu`)

- [ ] Add the module (services: factory + validation; `.projectFactories:`
      `Type="meta-model"`). If `ShellModule` requires a Capability, add a minimal
      "Meta-models" published-browser capability (fallback only).
- [ ] `npm run compile:mu` → compiles. `npm run typecheck` → clean.
      `npm test` → all green. Commit.

---

## Self-Review

- **Spec coverage:** Components 1–5 + module wiring all mapped to Tasks 1–7.
- **Placeholders:** none; the fallback capability is an explicit contingency.
- **Type consistency:** `EditorDiagnostic`/`toMarkers` (T1) consumed by T4/T6;
  `IPublishableProjectFactory`/`PublishResult` (T5) implemented by T3; `'todl'`
  `ProjectNodeKind` (T5) produced by T3's `openProject` and consumed by the
  explorer's format-driven routing.

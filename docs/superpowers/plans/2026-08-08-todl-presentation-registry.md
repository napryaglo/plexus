# TodlPresentationRegistry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** One `TodlPresentationRegistry` + one `TodlVisualResolver` resolve the visuals of all published TODL packages (libraries + meta-models); meta-model terms/nodes render from their published presentation like library classes; the meta-model drawer is removed.

**Architecture:** A source-driven registry owns one app-global aggregate `ResourceDictionary`. Each `PresentationSource.load()` returns a `key → DataTemplate` map with its own precedence resolved. The single resolver looks up `descriptor.Key` in the aggregate, else a figure-only default box. Key strings encode the source (`classId` for libraries, `mm:<id>` for meta-models).

**Tech Stack:** TypeScript, mural runtime/basic/framework, Vitest.

## Global Constraints

- Every test file in a `tests/` subfolder next to its source.
- Real enums, never string-literal unions.
- Render through templates/bindings only.
- mural resolves merged dictionaries **last-merged-wins**; precedence lives INSIDE each source map, never across dictionaries.
- Eager + detached-build-then-swap + `StyleParticipating = false` for app-global merges (O(1) notifications).
- Commit/push only when asked; branch first.
- Figure-only visuals; captions owned by hosts (unchanged from prior work).

---

### Task 1: Shared `loadCompiledPresentation`

**Files:**
- Create: `src/renderer/src/modules/meta-model/services/compiled-presentation.ts`
- Modify: `.../meta-model/services/presentation-loader.ts`, `.../library/services/library-loader.ts`
- Test: `.../meta-model/services/tests/compiled-presentation.test.ts`

**Produces:** `loadCompiledPresentation(storage: IStorage, base: string, ctxExtra: Record<string, unknown>): Promise<ResourceDictionary | undefined>` — reads `<base>/presentation/presentation.compiled.json`, evals it, returns the dict; `undefined` if the file is absent.

- [ ] **Step 1** — Test: bake a tiny artifact into a `FakeStorage` (reuse the `bakePresentation` helper shape from `library-registry.test.ts`), assert `loadCompiledPresentation` returns a `ResourceDictionary` that `CanResolve` the baked key; and returns `undefined` for a missing file.
- [ ] **Step 2** — Run, expect FAIL (module absent).
- [ ] **Step 3** — Implement: move the `JSON.parse` + `new Function` eval body (currently duplicated in `loadPresentation`/`loadLibraryPresentation`) here; `ctx = { ...MuralRuntime, ...MuralEngine, ...MuralBasic, ...MuralFramework, ...ctxExtra }`; return `undefined` on read failure.
- [ ] **Step 4** — Rewrite `loadPresentation` to `loadCompiledPresentation(storage, base, { MetaModelEntity })` and throw the friendly message when it returns `undefined`. Rewrite `loadLibraryPresentation` to `loadCompiledPresentation(backend, `${id}/${version}`, { LibraryClassData })`.
- [ ] **Step 5** — Run the new test + existing `library-registry` / `presentation-loader` consumers; expect PASS.

---

### Task 2: `TodlPresentationRegistry` + `PresentationSource`

**Files:**
- Create: `src/renderer/src/modules/diagram/services/todl-presentation-registry.ts`
- Test: `.../diagram/services/tests/todl-presentation-registry.test.ts`

**Produces:**
```ts
export interface PresentationSource { id: string; load(): Promise<Map<string, DataTemplate>> }
export class TodlPresentationRegistry extends ServiceBase {
  static readonly Key: ServiceKey<TodlPresentationRegistry>
  registerSource(src: PresentationSource): void        // idempotent by src.id
  async discover(): Promise<void>
  resolve(key: string): DataTemplate | undefined
  onChanged(cb: (key: string) => void): () => void
}
```

- [ ] **Step 1** — Test with two fake sources returning `Map` of `key→DataTemplate` (use `new DataTemplate(() => new Border())` or `compileTemplate`): after `discover()`, `resolve(k)` returns each source's template; unknown key → `undefined`; `onChanged` fires for every aggregated key; a second `discover()` re-runs sources and swaps. With an `Application`, assert app-resource notifications are O(1) (one general swap), mirroring the `library-registry` O(1) test.
- [ ] **Step 2** — Run, expect FAIL.
- [ ] **Step 3** — Implement: hold `sources: Map<string, PresentationSource>`, an owned `aggregate` dict + `merged` tracker. `discover()`: `for (const s of sources) merge s.load()'s entries into a detached dict (StyleParticipating=false)`, `ReplaceMergedDictionary(this.merged, next)`, set owned refs, fire `onChanged(key)` for each key. `resolve` off the owned aggregate. Skip empty swaps like `LibraryRegistry`.
- [ ] **Step 4** — Run, expect PASS.

---

### Task 3: `TodlVisualResolver`

**Files:**
- Create: `src/renderer/src/modules/diagram/services/todl-visual-resolver.ts`
- Test: `.../diagram/services/tests/todl-visual-resolver.test.ts`

**Consumes:** `TodlPresentationRegistry`. **Produces:** `TodlVisualResolverKey: ServiceKey<IToolboxVisualResolver>` + `class TodlVisualResolver implements IToolboxVisualResolver` (ctor takes the registry).

- [ ] **Step 1** — Test: a registry stub whose `resolve(key)` returns a known template for `'k1'` and `undefined` for `'k2'`. `Resolve(desc('k1'), Tile)` → the template's visual, `IsHitTestVisible === false`; `Resolve(desc('k2'), Tile)` → the default box (no `TextBlock`, figure-only); `AddChangedListener` bridges `registry.onChanged` (a fired key reaches the cb); `RemoveChangedListener` unsubscribes.
- [ ] **Step 2** — Run, expect FAIL.
- [ ] **Step 3** — Implement per the spec (`registry.resolve(descriptor.Key) ?? default`, `.Apply({})`, Tile → `IsHitTestVisible=false`; default via `buildDefaultTemplate(buildCtx())`); bridge `onChanged` with an unsub `Map` like `LibraryClassVisualResolver`.
- [ ] **Step 4** — Run, expect PASS.

---

### Task 4: `LibraryPresentationSource`

**Files:**
- Create: `src/renderer/src/modules/library/services/library-presentation-source.ts`
- Test: `.../library/services/tests/library-presentation-source.test.ts`

**Consumes:** `LibraryRegistry` (for discovered `LoadedLibrary[]`), the libraries backend, `DiagnosticsService`. **Produces:** `class LibraryPresentationSource implements PresentationSource` (`id = 'library'`).

- [ ] **Step 1** — Port the resolution-behavior assertions from `library-registry.test.ts`: `load()` returns a map where a class with an authored `.mural` maps to its compiled template; a class with only a baked presentation maps to the presentation template; **authored overrides presentation** for the same id; a class with neither is absent from the map (→ resolver default). Compile failure publishes a Problem and omits the key. Legacy loose-SVG icon only when no baked presentation covers the class.
- [ ] **Step 2** — Run, expect FAIL.
- [ ] **Step 3** — Implement: `load()` = for each `LoadedLibrary` (from `registry.discover()` or a passed list), `loadCompiledPresentation` → seed the map with its entries; then for each class eager-compile authored `.mural` / legacy icon (the moved `compileClassInto` logic) into the map, **overriding** presentation. Publish compile Problems via `DiagnosticsService` (same slice keys as today).
- [ ] **Step 4** — Run, expect PASS.

---

### Task 5: Slim `LibraryRegistry` to metadata

**Files:**
- Modify: `.../library/services/library-registry.ts`
- Test: `.../library/services/tests/library-registry.test.ts`

- [ ] **Step 1** — Rewrite the registry test: `discover()` returns `LoadedLibrary[]` with discovery Problems (missing template → warning), and NO longer compiles/resolves (drop all `resolve()` assertions — they now live in `library-presentation-source.test.ts`). Keep `delete` + empty cases.
- [ ] **Step 2** — Run, expect FAIL.
- [ ] **Step 3** — Remove `resolve`, `presentationVisuals`/`libraryVisuals`/`presentationMerged`/`libraryMerged`, `compileClassInto`, the app-global merges, `onChanged`/`listeners`, `defaultTemplate`, `ctx`, and the visual imports. Keep `discover()` (scan + slices + discovery Problems), `delete`, `publish*`. `discover()` no longer touches `Application.Resources`.
- [ ] **Step 4** — Run the registry test + `libraries-panel-service.test` (panel only needs metadata); expect PASS. Typecheck to catch dangling refs.

---

### Task 6: `MetaModelPresentationSource`

**Files:**
- Create: `src/renderer/src/modules/meta-model/services/meta-model-presentation-source.ts`
- Test: `.../meta-model/services/tests/meta-model-presentation-source.test.ts`

**Consumes:** the meta-models backend. **Produces:** `class MetaModelPresentationSource implements PresentationSource` (`id = 'meta-model'`).

- [ ] **Step 1** — Test: bake a meta-model presentation (an `mm:<id>` template) into a `FakeStorage` under `<id>/<version>/presentation/…`; `load()` returns a map with `mm:<id>` → its template; a base with no artifact contributes nothing (no throw).
- [ ] **Step 2** — Run, expect FAIL.
- [ ] **Step 3** — Implement: `scanPublishedModels(backend)` → for each `<id>/<version>` `loadCompiledPresentation(backend, base, { MetaModelEntity })` → copy its entries into the map.
- [ ] **Step 4** — Run, expect PASS.

---

### Task 7: Wire the single resolver, registry, sources, descriptors

**Files:**
- Modify: `.../diagram/services/register-arch-toolbox-adapters.ts`, `.../diagram/services/diagram-panel-services.ts`, `.../library/services/library-tree-node.ts`, `.../architecture-projects/services/instance-node-vm.ts`, `.../architecture-projects/services/arch-diagram-document-factory.ts`, the module `.services:` block (`diagram.module.mu` or shared) to register `TodlPresentationRegistry`.
- Tests: `.../diagram/services/tests/register-arch-toolbox-adapters.test.ts`, `.../diagram/services/tests/toolbox-service-populate.test.ts`, `library-tree-node.test.ts`, `instance-node-vm.test.ts`.

**Interfaces:** all descriptors use `TodlVisualResolverKey`. Key = `classId` (library) / `'mm:' + id` (meta-model term, bare concept).

- [ ] **Step 1** — Update tests: `registerArchToolboxAdapters` registers `TodlVisualResolverKey` (+ drop factory) and both sources into `TodlPresentationRegistry` (idempotent); it no longer registers the two old resolvers. `contributeTaxonomy` emits descriptors with `TodlVisualResolverKey` and key `isLibrary ? term.id : 'mm:'+term.id`, no icon `Register`. `LibraryTreeNode.leaf` descriptor = `(TodlVisualResolverKey, termId)`. `InstanceNodeVM`: referenced term → `(TodlVisualResolverKey, term)`, bare concept → `(TodlVisualResolverKey, 'mm:'+concept)`.
- [ ] **Step 2** — Run, expect FAIL.
- [ ] **Step 3** — Implement the wiring. `registerArchToolboxAdapters(services)` returns `void` (no ConceptResolver to hand back); construct `TodlPresentationRegistry` if absent, register the library + meta-model sources, register `TodlVisualResolver`. `ToolboxService.reload()` and `ArchDiagramDocumentFactory.openFile` call `TodlPresentationRegistry.discover()` (in addition to `LibraryRegistry.discover()` for panel metadata where needed). Register `TodlPresentationRegistry` in the diagram module `.services:`.
- [ ] **Step 4** — `npm run compile:mu` (module/resource edits) + run the updated tests; expect PASS.

---

### Task 8: Remove the drawer stack

**Files:**
- Modify: `.../meta-model/meta-model.resources.mu`, `.../meta-model/services/meta-models-service.ts`, `.../meta-model/services/meta-model-entity.ts`
- Delete: `.../meta-model/services/meta-model-entity-builder.ts`, `.../meta-model/services/meta-model-converters.ts`, and their tests
- Test: `.../meta-model/services/tests/meta-models-service.test.ts`

- [ ] **Step 1** — Update `meta-models-service.test.ts`: drop drawer assertions (`openEntity`/`DrawerEntity`/`dictCache`); assert `reload()` still builds the tree and (new) triggers `TodlPresentationRegistry.discover()` (spy/fake registry in the provider).
- [ ] **Step 2** — Run, expect FAIL.
- [ ] **Step 3** — Delete the `SideSheet` block + `MetaModelFieldTemplate` from `meta-model.resources.mu` (keep the tree + empty state + node template + context menu). In `MetaModelsService` remove `DrawerEntity`/`IsDrawerOpen` DPs, `openEntity`, `dictCache`, `loadPresentation` import; `openEntity` wiring in `buildCatalog`’s activate callback becomes a no-op or is dropped; `reload()` calls the registry’s `discover()`. Trim `MetaModelEntity` to `export class MetaModelEntity {}`. Delete `meta-model-entity-builder`, `MetaModelField`, `meta-model-converters` + tests.
- [ ] **Step 4** — `npm run compile:mu` + run the meta-model tests + typecheck; expect PASS.

---

### Task 8b: Verify buildEntity is not otherwise used

- [ ] Grep `buildEntity`, `MetaModelField`, `IsNullToVisibility`, `UITemplate`, `.Fields`, `.Annotations` across non-test `src`. If any live reference remains outside the drawer, stop and reconcile (e.g. a projection reused elsewhere) before deleting. (Publisher/scaffold use `MetaModelEntity` only as the DataType symbol — safe.)

---

### Task 9: Delete the two old resolvers

**Files:**
- Delete: `.../diagram/services/library-class-visual-resolver.ts`, `.../diagram/services/concept-visual-resolver.ts` + their tests
- Modify: any importer (host render tests reference `LibraryClassVisualResolverKey`), `library-tree-node.ts`, `instance-node-vm.ts` imports.

- [ ] **Step 1** — Grep `LibraryClassVisualResolver`, `ConceptVisualResolver` across `src`; update every importer to `TodlVisualResolverKey`. Update the three host render tests (`toolbox-tile-render`, `instance-node-render`, `library-preview-render`) if they import a deleted key.
- [ ] **Step 2** — Delete the two resolver files + their tests.
- [ ] **Step 3** — Typecheck; fix dangling imports.

---

### Finish

- [ ] `npm run compile:mu` — exit 0.
- [ ] `npm run typecheck` — clean.
- [ ] `npm test` — green (no fails; skips unchanged).
- [ ] `npm run build` — exit 0.
- [ ] Grep: no `LibraryClassVisualResolver`, `ConceptVisualResolver`, `DrawerEntity`, `openEntity`, `dictCache`, `buildEntity` remain.
- [ ] REQUIRED SUB-SKILL: superpowers:finishing-a-development-branch.

## Self-review notes

- Spec coverage: shared loader (T1), registry (T2), resolver (T3), library source (T4), library slim-down (T5), meta-model source (T6), wiring/descriptors (T7), drawer removal (T8/8b), old-resolver deletion (T9). All spec sections covered.
- Precedence: authored > presentation lives inside `LibraryPresentationSource.load()`'s single map (T4) — never cross-dictionary. ✓
- Type consistency: single `TodlVisualResolverKey` everywhere; `PresentationSource.load(): Promise<Map<string, DataTemplate>>` consumed identically by T2/T4/T6.

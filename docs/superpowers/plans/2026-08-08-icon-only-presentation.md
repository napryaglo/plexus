# Icon-only Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-entity presentation DataTemplates with one Plexus default template whose icon is bound from the entity's `icon` annotation resource key through a converter, and delete all template scaffolding.

**Architecture:** Publish emits assets-only (`presentation.compiled.json` = icon geometries keyed by resource key) plus a flat `icon-index.json` (`entityKey → resourceKey`). `TodlPresentationRegistry` merges every package's asset dict app-global and builds one `entityKey → resourceKey` index. `TodlVisualResolver` always returns the single default template, applied with `{ IconKey: registry.iconKeyFor(descriptor.Key) }`; the template's `Shape [ Geometry = $IconKey << IconKeyConverter ]` resolves the geometry from app resources, or a shipped default glyph. Descriptor sites are unchanged. Host still draws the caption.

**Tech Stack:** TypeScript, mural (`@pragmatic-lab/mural`), vitest, `.mu` markup compiled via `compileTemplate`/`instantiate`.

## Global Constraints

- Every test file lives in a `tests/` subfolder next to its source (`src/.../services/tests/x.test.ts`), never beside the source.
- Use real TS enums, never string-literal union / template-literal types.
- Render through templates/bindings only — no hardcoded visual chrome in TS; the visual comes from the compiled fragment.
- Commit after each task. Do NOT push. Branch off `main` first (`git checkout -b feat/icon-only-presentation`).
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- `entityKey` namespace (must match existing descriptor keys): library term/class → `<id>`; meta-model entity → `mm:<id>`.
- Verify with `npm test`, `npm run typecheck` at task end; the FULL build (`npm run build`) only at final review.

---

### Task 1: Icon-index generator (pure)

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/presentation-generator.ts`
- Test: `src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts` (add cases; file exists)

**Interfaces:**
- Produces: `buildIconIndex(doc: TodlDocument, prefix: string): Map<string, string>` — for every presentable entity (`ontologyEntities` + `classEntities`) that resolves an icon, maps `prefix + entity.id → resourceKeyFor(doc, icon)`. `prefix` is `''` (library) or `'mm:'` (meta-model). Entities without an icon are omitted.
- Consumes: existing `ontologyEntities`, `classEntities`, `resolveFacets`, `resourceKeyFor`, `assignResourceKeys` from the same file; `projectAnnotations` from `@pragmatic-lab/todl`.

- [ ] **Step 1: Write the failing test**

```ts
// in presentation-generator.test.ts
import { buildIconIndex } from '../presentation-generator.js'
// Build a minimal doc: one concept `service` with annotate icon { path = "resources/svc.svg" },
// one taxonomy term `db` with attrs.icon = "resources/db.svg", one concept `plain` with no icon.
// (Reuse the test's existing doc-building helper / fixture shape used by other cases in this file.)

it('maps each icon-bearing entity to its resource key under the prefix', () => {
    const idx = buildIconIndex(doc, 'mm:')
    expect(idx.get('mm:service')).toBe('mm_icon_svc')
    expect(idx.get('mm:db')).toBe('mm_icon_db')
    expect(idx.has('mm:plain')).toBe(false)
})

it('applies an empty prefix for the library keyspace', () => {
    const idx = buildIconIndex(doc, '')
    expect(idx.get('service')).toBe('mm_icon_svc')
})
```

- [ ] **Step 2: Run it — expect FAIL** (`buildIconIndex` undefined).
  Run: `npm test -- presentation-generator`

- [ ] **Step 3: Implement**

```ts
// presentation-generator.ts
import { projectAnnotations } from '@pragmatic-lab/todl'

// entityKey (prefix + id) → icon resource key, for every presentable entity that
// resolves an icon. prefix is '' (library keyspace) or 'mm:' (meta-model keyspace),
// matching the descriptor keys the resolver looks up. Icon-less entities omitted.
export function buildIconIndex(doc: TodlDocument, prefix: string): Map<string, string>
{
    const out = new Map<string, string>()
    for (const n of [...ontologyEntities(doc), ...classEntities(doc)]) {
        const { icon } = resolveFacets(n, projectAnnotations(doc, n.id))
        if (icon === undefined) continue
        out.set(prefix + n.id, resourceKeyFor(doc, icon))
    }
    return out
}
```

- [ ] **Step 4: Run test — expect PASS.**
- [ ] **Step 5: Commit** (`feat: add buildIconIndex presentation generator`).

---

### Task 2: Default-icon app resource

**Files:**
- Modify: `src/renderer/src/modules/diagram/diagram.resources.mu` (add a geometry resource `PlexusDefaultIcon`)
- Test: `src/renderer/src/modules/diagram/services/tests/default-icon-resource.test.ts` (create)

**Interfaces:**
- Produces: an app-global resource keyed `PlexusDefaultIcon` resolving to a `Geometry` (a generic glyph, e.g. a rounded-square or simple "box" path). It lives in `diagram.resources.mu`, which is already merged into `Application.Resources` (see `toolbox-tile-render.test.ts:19` `AddMergedDictionary(DiagramResources.Clone())`).

Notes: use an inline SVG path geometry the `.mu` compiler bakes. Pick a neutral generic icon (e.g. a filled rounded rectangle or a simple cube outline). Keep it a `Geometry` resource so `Shape [ Geometry = @PlexusDefaultIcon ]` works.

- [ ] **Step 1: Write the failing test**

```ts
// default-icon-resource.test.ts
import { Application } from '@pragmatic-lab/mural/runtime'
import { DiagramResources } from '../../diagram.resources.mu.js' // match how other tests import the compiled dict

it('ships a resolvable PlexusDefaultIcon geometry', () => {
    const app = new Application()   // match the harness other render tests use to get an Application
    app.Resources.AddMergedDictionary(DiagramResources.Clone())
    expect(app.Resources.CanResolve('PlexusDefaultIcon')).toBe(true)
    expect(app.Resources.Resolve('PlexusDefaultIcon')).toBeDefined()
})
```
(Mirror the exact Application/DiagramResources import + construction used in `toolbox-tile-render.test.ts`.)

- [ ] **Step 2: Run — expect FAIL** (key absent).
- [ ] **Step 3: Add the resource** to `diagram.resources.mu` inside the existing `resources DiagramResources { … }` block:

```
    // Fallback glyph for any entity whose icon annotation resolves nothing.
    Geometry x:key="PlexusDefaultIcon" [ Data = "M4 4 h16 v16 h-16 z" ]
```
(Use whatever geometry markup form `diagram.resources.mu` already uses for baked paths; the exact `Data`/path syntax must match the compiler. If a `Shape`/path resource is the established form, follow that form.)

- [ ] **Step 4: Compile + run** (`npm run compile:mu` if required by the harness, then `npm test -- default-icon-resource`) — expect PASS.
- [ ] **Step 5: Commit** (`feat: ship PlexusDefaultIcon fallback glyph resource`).

---

### Task 3: IconKeyConverter

**Files:**
- Create: `src/renderer/src/modules/diagram/services/icon-key-converter.ts`
- Test: `src/renderer/src/modules/diagram/services/tests/icon-key-converter.test.ts`

**Interfaces:**
- Produces:
  - `class IconKeyConverter { convert(key: unknown): unknown }` — resolves `key` (a resource-key string) to a `Geometry` via the active resource resolver; on empty/unresolved key returns the `PlexusDefaultIcon` resource; if even that is absent returns `undefined`.
  - `setIconResourceResolver(fn: ((key: string) => unknown) | undefined): void` — module-level override used headless / to bridge the registry. Default resolver reads `Application.current?.Resources.Resolve(key)`.
- Consumes: `Application` from `@pragmatic-lab/mural/runtime`.

Rationale: markup instantiates converters zero-arg, so the converter reads a module-scoped resolver (settable) rather than constructor injection. Task 8 points the resolver at `registry.resolveAsset`.

- [ ] **Step 1: Write the failing test**

```ts
// icon-key-converter.test.ts
import { IconKeyConverter, setIconResourceResolver } from '../icon-key-converter.js'

afterEach(() => setIconResourceResolver(undefined))

it('resolves a known key through the active resolver', () => {
    const geom = {} as unknown
    setIconResourceResolver((k) => (k === 'mm_icon_svc' ? geom : k === 'PlexusDefaultIcon' ? {} : undefined))
    expect(new IconKeyConverter().convert('mm_icon_svc')).toBe(geom)
})

it('falls back to PlexusDefaultIcon for an empty key', () => {
    const dflt = {} as unknown
    setIconResourceResolver((k) => (k === 'PlexusDefaultIcon' ? dflt : undefined))
    expect(new IconKeyConverter().convert('')).toBe(dflt)
})

it('falls back to PlexusDefaultIcon for an unresolved key', () => {
    const dflt = {} as unknown
    setIconResourceResolver((k) => (k === 'PlexusDefaultIcon' ? dflt : undefined))
    expect(new IconKeyConverter().convert('nope')).toBe(dflt)
})
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement**

```ts
// icon-key-converter.ts
import { Application } from '@pragmatic-lab/mural/runtime'

const DEFAULT_ICON_KEY = 'PlexusDefaultIcon'

let resolver: ((key: string) => unknown) | undefined

// Override the resource resolver (headless tests, or bridge to the registry's
// owned aggregate). undefined restores the default Application.Resources lookup.
export function setIconResourceResolver(fn: ((key: string) => unknown) | undefined): void
{
    resolver = fn
}

function resolve(key: string): unknown
{
    if (resolver !== undefined) return resolver(key)
    return Application.current?.Resources.Resolve(key)
}

// Binding converter: icon resource-key string → its Geometry, or the shipped
// default glyph when the key is empty or resolves nothing. Instantiated zero-arg
// by markup (`$IconKey << IconKeyConverter`).
export class IconKeyConverter
{
    public convert(key: unknown): unknown
    {
        const k = typeof key === 'string' ? key : ''
        const hit = k === '' ? undefined : resolve(k)
        return hit ?? resolve(DEFAULT_ICON_KEY)
    }
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** (`feat: add IconKeyConverter with default-glyph fallback`).

---

### Task 4: Icon-bearing default template

**Files:**
- Modify: `src/renderer/src/modules/library/services/visual-library.ts`
- Test: `src/renderer/src/modules/library/services/tests/visual-library.test.ts`

**Interfaces:**
- `buildDefaultTemplate(ctx)` now compiles an icon-bearing fragment; `buildCtx()` additionally exports `IconKeyConverter` so `<< IconKeyConverter` resolves during `instantiate`.
- `buildIconTemplate` / `ICON_SOURCE` / `findIcon` are STILL PRESENT after this task (removed in Task 9) so `LibraryPresentationSource` keeps compiling. Only `DEFAULT_SOURCE` + `buildCtx` change here.

- [ ] **Step 1: Update the test** — the default template must contain a `Shape` (icon carrier) and NO `TextBlock`, and applying it with `{ IconKey }` must not throw:

```ts
import { Shape, TextBlock } from '@pragmatic-lab/mural/basic'
import { buildCtx, buildDefaultTemplate } from '../visual-library.js'
import { setIconResourceResolver } from '../../../diagram/services/icon-key-converter.js'

afterEach(() => setIconResourceResolver(undefined))

it('default template carries a Shape icon and no label', () => {
    setIconResourceResolver(() => ({}))    // any geometry
    const v = buildDefaultTemplate(buildCtx()).Apply({ IconKey: 'mm_icon_svc' })
    expect(hasType(v, Shape)).toBe(true)   // depth-first walk helper (mirror existing test util)
    expect(hasType(v, TextBlock)).toBe(false)
})
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** in `visual-library.ts`:

```ts
import { IconKeyConverter } from '../../diagram/services/icon-key-converter.js'

export function buildCtx(): Record<string, unknown>
{
    return { ...muralRuntime, ...muralBasic, ...muralEngine, IconKeyConverter }
}

// The always-installed default visual: a neutral figure-only box whose Shape draws
// the entity's icon geometry, resolved from the bound IconKey via IconKeyConverter
// (empty/unknown key → shipped default glyph). NO label — the host draws the caption.
const DEFAULT_SOURCE =
      'Border [ Background = @SurfaceContainerHigh, CornerRadius = 6, Padding = (10,6,10,6) ] {'
    + ' Shape [ Geometry = $IconKey << IconKeyConverter, Fill = @OnSurface, Width = 16, Height = 16 ] }'
```
(Leave `buildIconTemplate`/`ICON_SOURCE`/`findIcon` intact for now.)

- [ ] **Step 4: Run — expect PASS.** Also run `npm test` broadly to confirm the resolver's current `Apply({})` path (IconKey undefined → default glyph) still passes existing resolver tests.
- [ ] **Step 5: Commit** (`feat: default template renders icon via IconKeyConverter binding`).

---

### Task 5: Meta-model publisher — assets + icon-index, no scaffolding

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/presentation-publisher.ts`
- Modify: `src/renderer/src/modules/meta-model/services/presentation-generator.ts` (export a small assets-only source builder if needed)
- Test: `src/renderer/src/modules/meta-model/services/tests/presentation-publisher.test.ts`

**Interfaces:**
- `publishPresentation(project, dest, base, doc)` now: (a) writes `presentation/presentation.compiled.json` = compiled ASSET dict only (icon includes, no author inners); (b) writes `presentation/icon-index.json` = `JSON.stringify(Object.fromEntries(buildIconIndex(doc, 'mm:')))`. Return `{ ok: true; icons: number }` (drop `templates`). Missing-icon still blocks (`{ ok:false; missing }`).
- Remove: `scaffoldAuthorStubs` call, `readAuthorTemplates`/author-inner usage. Build the compile source via `combinedSource(doc, DICT_NAME, [])` (empty author inners) or a dedicated assets-only builder.

- [ ] **Step 1: Update tests** — assert the compiled artifact has NO `DataTemplate` in `body`, `icon-index.json` exists with `mm:`-prefixed keys, and no `presentation/templates.mu` is written:

```ts
const res = await publishPresentation(project, dest, base, doc)
expect(res).toEqual({ ok: true, icons: 2 })
const art = JSON.parse(await dest.ReadText(`${base}/presentation/presentation.compiled.json`))
expect(art.body).not.toMatch(/\bDataTemplate\b/)
const idx = JSON.parse(await dest.ReadText(`${base}/presentation/icon-index.json`))
expect(idx['mm:service']).toBe('mm_icon_svc')
expect(await project.Exists(`presentation/templates.mu`)).toBe(false)
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — delete the `scaffoldAuthorStubs` import+call and the `readAuthorTemplates`/`author.inners` usage; set `const source = combinedSource(doc, DICT_NAME, [])`; write the index:

```ts
import { buildIconIndex } from './presentation-generator.js'
// … after writing the compiled artifact:
await dest.WriteText(
    `${base}/${PRESENTATION_DIR}/icon-index.json`,
    JSON.stringify(Object.fromEntries(buildIconIndex(doc, 'mm:'))),
)
return { ok: true, icons: svgByPath.size }
```
Update `PublishPresentationResult` to drop `templates`.

- [ ] **Step 4: Run — expect PASS** (`npm test -- presentation-publisher`).
- [ ] **Step 5: Commit** (`feat: meta-model publish emits assets + icon-index, no scaffolding`).

---

### Task 6: Library publisher — assets + icon-index, no scaffolding

**Files:**
- Modify: `src/renderer/src/modules/library/services/library-presentation-publisher.ts`
- Test: `src/renderer/src/modules/library/services/tests/library-presentation-publisher.test.ts`

**Interfaces:** Same shape as Task 5 but library keyspace: `buildIconIndex(doc, '')`, `icon-index.json` keyed by bare `<id>`. Return drops `templates`. Remove `scaffoldAuthorStubs`/author-inner usage.

- [ ] **Step 1: Update tests** — mirror Task 5 assertions: no `DataTemplate` in `body`, `icon-index.json` with bare-id keys, no `templates.mu` written.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — same edits as Task 5 against the library publisher; `buildIconIndex(doc, '')`.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** (`feat: library publish emits assets + icon-index, no scaffolding`).

---

### Task 7: Remove scaffolding from factories + delete presentation-scaffold

**Files:**
- Modify: `src/renderer/src/modules/library/services/library-project-factory.ts` (drop line 24 import + line 216 call)
- Modify: `src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts` (drop line 22 import + line 181 call)
- Delete: `src/renderer/src/modules/meta-model/services/presentation-scaffold.ts`
- Delete: `src/renderer/src/modules/meta-model/services/tests/presentation-scaffold.test.ts`
- Modify: `src/renderer/src/modules/meta-model/services/presentation-publisher.ts` — remove now-unused exports `readAuthorTemplates`, `combinedSource`'s author-inner path if fully unused after Tasks 5/6 (keep `combinedSource` if still called with `[]`; if you inlined an assets-only builder, remove `readAuthorTemplates`/`extractResourcesInner`).

**Interfaces:**
- Consumes: nothing new. This task only removes dead scaffolding.
- Verify no remaining importers of `presentation-scaffold.js` (grep) before deleting.

- [ ] **Step 1:** Grep `presentation-scaffold` across `src/` — confirm only the four sites above reference it. Fix/expect zero other importers.
- [ ] **Step 2:** Remove the imports + calls in both factories; delete `presentation-scaffold.ts` + its test; prune now-unused publisher helpers.
- [ ] **Step 3: Run** `npm run typecheck` — expect clean (no dangling imports).
- [ ] **Step 4: Run** `npm test` — expect green (factory tests must no longer assert scaffolded `templates.mu`; update any that do).
- [ ] **Step 5: Commit** (`refactor: delete presentation template scaffolding`).

---

### Task 8: Cutover — registry contract + both sources + resolver

**Files:**
- Modify: `src/renderer/src/modules/diagram/services/todl-presentation-registry.ts`
- Modify: `src/renderer/src/modules/meta-model/services/meta-model-presentation-source.ts`
- Modify: `src/renderer/src/modules/library/services/library-presentation-source.ts`
- Modify: `src/renderer/src/modules/diagram/services/todl-visual-resolver.ts`
- Tests: the `tests/` files beside each (rewrite as noted)

**Interfaces (atomic — these change together):**
- `interface PresentationContribution { assets: ResourceDictionary; iconKeys: Map<string, string> }`
- `interface PresentationSource { id: string; load(): Promise<PresentationContribution> }`
- Registry: `discover()` merges each contribution's `assets` into the app-global aggregate (existing `ReplaceMergedDictionary` + `StyleParticipating=false` + skip-empty-swap) and unions `iconKeys` into `private index: Map<string,string>`. New: `iconKeyFor(entityKey: string): string | undefined` (reads `index`); `resolveAsset(resourceKey: string): unknown` (reads owned aggregate). REMOVE `resolve(key): DataTemplate`. `onChanged` still fires once per changed entity key — fire for the union of `iconKeys` keys (so presenters re-resolve). Bridge the converter: at end of `discover()` call `setIconResourceResolver((k) => this.aggregate.Resolve(k))` (headless-safe) — import from `icon-key-converter.js`.
- `TodlVisualResolver.Resolve(descriptor, context)`: `this.defaultTemplate.Apply({ IconKey: this.registry.iconKeyFor(descriptor.Key) ?? '' })`; Tile → `IsHitTestVisible=false`. Drop the `registry.resolve` template lookup. `AddChangedListener`/`RemoveChangedListener` bridge unchanged.

- [ ] **Step 1: Registry test** — rewrite `todl-presentation-registry.test.ts`:

```ts
// A fake source contributing assets + iconKeys.
function src(id, entries /* [resourceKey, geom][] */, keys /* [entityKey, resourceKey][] */) {
    return { id, load: async () => {
        const assets = new ResourceDictionary()
        for (const [k, v] of entries) assets.Set(k, v)
        return { assets, iconKeys: new Map(keys) }
    } }
}

it('merges assets app-global and indexes icon keys', async () => {
    const reg = new TodlPresentationRegistry(provider)
    reg.registerSource(src('a', [['mm_icon_svc', {}]], [['mm:service', 'mm_icon_svc']]))
    await reg.discover()
    expect(reg.iconKeyFor('mm:service')).toBe('mm_icon_svc')
    expect(reg.resolveAsset('mm_icon_svc')).toBeDefined()
    expect(reg.iconKeyFor('mm:missing')).toBeUndefined()
})

it('fires onChanged once per entity key across sources', async () => { /* dedupe assertion, exact count */ })
```

- [ ] **Step 2: Implement registry** — replace the `Map<string,DataTemplate>` aggregation with: build `next` (assets) + `nextIndex` (iconKeys) from all sources; swap `next` app-global (same skip-empty rule but keyed on `next.Entries` count OR the union asset-key set); store `this.aggregate = next`, `this.index = nextIndex`; `setIconResourceResolver((k) => this.aggregate.Resolve(k))`; fire `onChanged` for each entity key in `nextIndex`. Add `iconKeyFor`/`resolveAsset`; delete `resolve`.

- [ ] **Step 3: Source tests + impl** — rewrite both sources to return `PresentationContribution`:
  - `MetaModelPresentationSource.load()`: for each `<id>/<version>`: `assets = (await loadCompiledPresentation(backend, base, {})) ?? new ResourceDictionary()` merged into a running dict; read `icon-index.json` (`JSON.parse`) into the running `iconKeys` map. No `MetaModelEntity` symbol.
  - `LibraryPresentationSource.load()`: same per library; **delete** the authored-`.mural` (`readTemplateSource`/`compileTemplate`) and legacy-icon (`readIconSource`/`buildIconTemplate`) branches and the `LibraryClassData` seed. Keep publishing any cheap missing-asset Problems (optional) but drop template-compile Problems.
  - Provide a helper to read+parse `icon-index.json` (missing file → empty map).
  - Tests: fixtures now write `presentation.compiled.json` (asset dict) + `icon-index.json`; assert `load()` returns merged assets + the expected `iconKeys`.

- [ ] **Step 4: Resolver test + impl** — rewrite `todl-visual-resolver.test.ts`: a fake registry with `iconKeyFor`/`onChanged`; assert `Resolve(desc('mm:service'), Tile)` applies the default template with the mapped IconKey and forces `IsHitTestVisible=false`; unknown key → default template with empty IconKey (still a `Shape`, no `TextBlock`). Implement the new `Resolve`.

- [ ] **Step 5: Run** `npm run typecheck` then `npm test` — expect green across registry, both sources, resolver, and the three host render tests (`toolbox-tile-render`, `instance-node-render`, `library-preview-render`) which now render the icon default template.
- [ ] **Step 6: Commit** (`feat: resolve visuals via app-global assets + icon-key index`).

---

### Task 9: Remove dead code

**Files:**
- Modify: `src/renderer/src/modules/library/services/visual-library.ts` — delete `buildIconTemplate`, `ICON_SOURCE`, `findIcon`, and the now-unused `Icon`/`IconDefinition`/`parseSvgIcon` imports.
- Modify: `src/renderer/src/modules/meta-model/services/compiled-presentation.ts` — `ctxExtra` now always `{}` at call sites; keep the param or simplify signature (drop `ctxExtra` if no caller passes symbols).
- Modify/trim: `src/renderer/src/modules/meta-model/services/meta-model-entity.ts` and `src/renderer/src/modules/library/services/library-class-data.ts` — delete if no longer imported anywhere (grep); otherwise leave.
- Modify: `src/renderer/src/modules/library/services/library-loader.ts` — remove `readTemplateSource`/`readIconSource` if now unused (grep first).
- Tests: delete tests that exercised removed functions (`buildIconTemplate`, authored/legacy tiers); update `visual-library.test.ts`.

**Interfaces:** Pure removal. Nothing new produced.

- [ ] **Step 1:** Grep each symbol (`buildIconTemplate`, `readTemplateSource`, `readIconSource`, `LibraryClassData`, `MetaModelEntity`, `loadCompiledPresentation` ctxExtra callers) to confirm zero remaining users before deleting.
- [ ] **Step 2:** Delete the dead code + their tests; fix imports.
- [ ] **Step 3: Run** `npm run typecheck` — expect clean.
- [ ] **Step 4: Run** `npm test` — expect green.
- [ ] **Step 5: Commit** (`refactor: remove dead per-entity template code`).

---

## Final review

- Whole-branch review (most-capable model) against this plan + the spec.
- Then `npm run build` (exit 0), full `npm test` green.
- Then superpowers:finishing-a-development-branch (Option 1: merge to `main` locally, per the standing pattern) — but present the menu; the merge decision is the user's.

## Self-review notes

- **Spec coverage:** assets-only publish (T5/T6), icon-index (T1/T5/T6), registry merge+index (T8), converter+default glyph (T2/T3), one default template (T4), resolver cutover + unchanged descriptors (T8), scaffolding deleted (T7), authored/legacy removed (T8/T9). ✓
- **Green-at-each-task:** T1–T4 additive; T5–T7 change publish artifacts (self-contained tests); T8 is the atomic runtime cutover (contract+sources+resolver compile together); T9 removes now-dead code. Between T4 and T8 the resolver's `Apply({})` yields `IconKey=undefined` → default glyph, still green.
- **Type consistency:** `PresentationContribution { assets, iconKeys }` is the single contract used by registry + both sources; `iconKeyFor`/`resolveAsset` names match across registry, resolver, and converter bridge; `buildIconIndex(doc, prefix)` prefix values (`''`, `'mm:'`) match descriptor keyspaces.

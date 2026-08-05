# Unified Presentation Assets Emitter + Author-Owned Templates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the meta-model and library presentation generators emit only the icon/embedded-asset dictionary (no `DataTemplate`s) via one shared emitter; move per-entity template generation to a write-once author-stub scaffolder; keep a plain-label fallback.

**Architecture:** One shared `generatePresentationAssets(doc, authorDicts, dictName)` replaces both `generatePresentationMu` and `generateLibraryPresentationMu`. A new role-parameterised `presentation-scaffold.ts` writes one editable author stub per entity into `presentation/*.mu`, write-once (keyed on the `x:key`s already declared there). Each factory's `writePresentation` scaffolds, then emits assets. Resolution + `presentation/` merge are unchanged.

**Tech Stack:** TypeScript, Vitest. Design doc: `docs/superpowers/specs/2026-08-05-unified-presentation-assets-design.md`.

## Global Constraints

- Every test file lives in a `tests/` subfolder next to its source (`src/.../services/tests/foo.test.ts`).
- Run a single test file with `npx vitest run <path>` (from `Plexus/`).
- Use real `enum`s, never string-literal unions.
- The generated `.mu` is deterministic: icons sorted, entities in model order.
- Do **not** change the `resources <Name>` block identifier per domain (`MetaModelPresentation`, `LibraryPresentation`) — the compiled-dict loader contract depends on it. Unification is at the *code* level; `dictName` is a parameter.
- Never overwrite an existing `presentation/*.mu` file.
- Emit a commented seam for future base64 embedded content; do not implement it.

---

### Task 1: Unified asset emitter

Replace the two template-emitting generators with one asset-only emitter. Keep the shared helpers (`distinctIcons`, `iconKey`, `resolveFacets`, `humanize`, `isRasterIcon`).

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/presentation-generator.ts`
- Test: `src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`

**Interfaces:**
- Produces: `generatePresentationAssets(doc: TodlDocument, authorOverrideDicts: readonly string[], dictName: string): string` — icons + author `merge`s + embedded seam, no `DataTemplate`s.
- Produces (moved here): `isRasterIcon(path: string): boolean`.
- Keeps exported: `distinctIcons`, `iconKey`, `resolveFacets`, `humanize`, `ontologyEntities`, `classEntities`, `OntologyKind`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { generatePresentationAssets } from '../presentation-generator.js'

// Minimal fake TodlDocument: only `nodes` with tier/typeOf/attrs are read.
function doc(nodes: any[]): any { return { nodes } }

describe('generatePresentationAssets', () => {
  test('emits icon includes + merges, no DataTemplates', () => {
    const model = doc([
      { id: 'app-component', tier: 'Ontology', typeOf: 'concept', attrs: { icon: 'resources/comp.svg' } },
      { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: { icon: 'resources/actor.svg' } },
    ])
    const out = generatePresentationAssets(model, ['AuthorA'], 'MetaModelPresentation')
    assert.match(out, /resources MetaModelPresentation \{/)
    assert.match(out, /include "resources\/actor\.svg" as mm_icon_actor/)
    assert.match(out, /include "resources\/comp\.svg" as mm_icon_comp/)
    assert.match(out, /merge AuthorA/)
    assert.match(out, /Embedded content \(base64\)/)      // reserved seam
    assert.doesNotMatch(out, /DataTemplate/)              // no templates
    // deterministic: actor include precedes comp include (sorted)
    assert.ok(out.indexOf('mm_icon_actor') < out.indexOf('mm_icon_comp'))
  })

  test('no author dicts → no merge block', () => {
    const out = generatePresentationAssets(doc([]), [], 'LibraryPresentation')
    assert.match(out, /resources LibraryPresentation \{/)
    assert.doesNotMatch(out, /merge /)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`
Expected: FAIL — `generatePresentationAssets` is not exported.

- [ ] **Step 3: Implement the emitter**

In `presentation-generator.ts`: delete `entityTemplate` and the `templates` assembly from the old `generatePresentationMu`; add `isRasterIcon` (moved from the library module); add:

```ts
// Emit the presentation ASSET dictionary: one geometry per distinct icon,
// the author `merge` block (author templates live in presentation/*.mu), and
// a reserved seam for future base64 embedded content. No DataTemplates —
// entity/class visuals are author-owned (see presentation-scaffold.ts).
export function generatePresentationAssets(
    doc: TodlDocument,
    authorOverrideDicts: readonly string[],
    dictName: string,
): string
{
    const includes = distinctIcons(doc).map((p) => `    include "${p}" as ${iconKey(p)}`)
    const merges = authorOverrideDicts.map((d) => `    merge ${d}`)

    const lines: string[] = [
        '// presentation.generated.mu — AUTOGENERATED. Do not edit.',
        '// Regenerated from the compiled model. Author templates live in presentation/*.mu.',
        '',
        `resources ${dictName} {`,
        '',
        '    // --- Icons: one geometry per distinct icon referenced by the model. ---',
        ...includes,
        '',
        '    // --- Embedded content (base64) — reserved for future assets. ---',
    ]
    if (merges.length > 0) {
        lines.push('', '    // --- Author templates (merged; author keys win). ---', ...merges)
    }
    lines.push('}', '')
    return lines.join('\n')
}

// A raster (bitmap) icon path — baked as an ImageBrush vs an SVG Shape geometry.
export function isRasterIcon(path: string): boolean
{
    return /\.(png|jpe?g|webp|gif)$/i.test(path)
}
```

Remove `generatePresentationMu` and `entityTemplate`. Keep `resolveFacets`/`humanize` (used by the scaffolder, Task 2).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/presentation-generator.ts src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts
git commit -m "feat(presentation): unified asset-only emitter (no DataTemplates)"
```

---

### Task 2: Write-once author-stub scaffolder

Move the old per-entity template bodies into a scaffolder that writes editable author stubs, only for keys not already present in `presentation/*.mu`.

**Files:**
- Create: `src/renderer/src/modules/meta-model/services/presentation-scaffold.ts`
- Test: `src/renderer/src/modules/meta-model/services/tests/presentation-scaffold.test.ts`

**Interfaces:**
- Consumes: `IStorage` (`.List(dir)`, `.ReadText(path)`, `.WriteText(path, text)`), `TodlDocument`, `resolveFacets`, `iconKey`, `isRasterIcon`, `humanize` from Task 1; `projectAnnotations` from `./annotation-projection.js`; `ontologyEntities`/`classEntities`.
- Produces:
  - `enum PresentationRoleKind { MetaModel = 'meta-model', Library = 'library' }`
  - `interface PresentationRole { kind: PresentationRoleKind; entities(doc: TodlDocument): JsonNode[]; key(n: JsonNode): string; dataType: string; labelExpr(doc: TodlDocument, n: JsonNode): string }`
  - `const META_MODEL_ROLE: PresentationRole`, `const LIBRARY_ROLE: PresentationRole`
  - `async function scaffoldAuthorStubs(storage: IStorage, doc: TodlDocument, role: PresentationRole, dir: string): Promise<number>` — writes missing stubs, returns count written.

Role bodies (verbatim from the current generators):
- Meta-model: `key = mm:<id>`, `dataType = 'MetaModelEntity'`, label baked: `Text = "<resolveFacets.label>"`.
- Library: `key = <id>`, `dataType = 'LibraryClassData'`, label bound: `Text = $Display`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { scaffoldAuthorStubs, META_MODEL_ROLE, LIBRARY_ROLE } from '../presentation-scaffold.js'

class FakeStorage {
  files = new Map<string, string>()
  dirs = new Set<string>(['presentation'])
  async List(dir: string) {
    if (!this.dirs.has(dir)) throw new Error('no dir')
    return [...this.files.keys()]
      .filter((p) => p.startsWith(dir + '/'))
      .map((p) => ({ Name: p.slice(dir.length + 1), IsDirectory: false }))
  }
  async ReadText(p: string) { return this.files.get(p) ?? '' }
  async WriteText(p: string, t: string) { this.files.set(p, t) }
}
function doc(nodes: any[]): any { return { nodes } }

describe('scaffoldAuthorStubs', () => {
  test('writes one stub per entity, meta-model role bakes label + mm:<id> key', async () => {
    const s = new FakeStorage() as any
    const model = doc([{ id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: { icon: 'resources/actor.svg', label: 'Actor' } }])
    const n = await scaffoldAuthorStubs(s, model, META_MODEL_ROLE, 'presentation')
    assert.equal(n, 1)
    const written = [...s.files.values()].join('\n')
    assert.match(written, /DataTemplate x:key="mm:actor" \[ DataType = MetaModelEntity \]/)
    assert.match(written, /Text = "Actor"/)
    assert.match(written, /@mm_icon_actor/)
  })

  test('library role binds $Display + class-id key', async () => {
    const s = new FakeStorage() as any
    const model = doc([{ id: 'lib.button', tier: 'Instance', typeOf: 'class', attrs: { class: true, icon: 'resources/b.svg' } }])
    await scaffoldAuthorStubs(s, model, LIBRARY_ROLE, 'presentation')
    const written = [...s.files.values()].join('\n')
    assert.match(written, /DataTemplate x:key="lib\.button" \[ DataType = LibraryClassData \]/)
    assert.match(written, /Text = \$Display/)
  })

  test('write-once: does not re-scaffold a key already declared in presentation/*.mu', async () => {
    const s = new FakeStorage() as any
    s.files.set('presentation/custom.mu', 'resources Custom { DataTemplate x:key="mm:actor" [ DataType = MetaModelEntity ] { } }')
    const model = doc([{ id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} }])
    const n = await scaffoldAuthorStubs(s, model, META_MODEL_ROLE, 'presentation')
    assert.equal(n, 0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-scaffold.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the scaffolder**

```ts
// presentation-scaffold.ts — write-once author-template stubs. One editable
// DataTemplate per entity, written into presentation/*.mu ONLY for keys not
// already declared there, so author edits/consolidations survive regeneration.
import type { IStorage } from '...'          // same IStorage the factories use
import type { TodlDocument, JsonNode } from '@pragmatic-lab/todl'

import { ontologyEntities, classEntities, resolveFacets, iconKey, isRasterIcon } from './presentation-generator.js'
import { projectAnnotations } from './annotation-projection.js'

export enum PresentationRoleKind { MetaModel = 'meta-model', Library = 'library' }

export interface PresentationRole {
    kind: PresentationRoleKind
    entities(doc: TodlDocument): JsonNode[]
    key(n: JsonNode): string
    dataType: string
    labelExpr(doc: TodlDocument, n: JsonNode): string   // a mural attribute value, e.g. '"Actor"' or '$Display'
}

export const META_MODEL_ROLE: PresentationRole = {
    kind: PresentationRoleKind.MetaModel,
    entities: (doc) => [...ontologyEntities(doc), ...classEntities(doc)],
    key: (n) => `mm:${n.id}`,
    dataType: 'MetaModelEntity',
    labelExpr: (doc, n) => `"${escapeMu(resolveFacets(n, projectAnnotations(doc, n.id)).label)}"`,
}

export const LIBRARY_ROLE: PresentationRole = {
    kind: PresentationRoleKind.Library,
    entities: (doc) => classEntities(doc),
    key: (n) => n.id,
    dataType: 'LibraryClassData',
    labelExpr: () => '$Display',
}

// Slug an id into a filesystem-safe stem + identifier (reuse iconKey's rules).
function slug(id: string): string {
    return id.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}
function escapeMu(s: string): string { return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') }

// The x:key values already declared across presentation/*.mu.
async function existingKeys(storage: IStorage, dir: string): Promise<Set<string>> {
    const keys = new Set<string>()
    let entries
    try { entries = await storage.List(dir) } catch { return keys }
    for (const e of entries) {
        if (e.IsDirectory || !e.Name.endsWith('.mu')) continue
        const text = await storage.ReadText(`${dir}/${e.Name}`)
        for (const m of text.matchAll(/x:key="([^"]+)"/g)) keys.add(m[1])
    }
    return keys
}

function stubMu(role: PresentationRole, doc: TodlDocument, n: JsonNode): string {
    const key = role.key(n)
    const { icon } = resolveFacets(n, projectAnnotations(doc, n.id))
    const label = `TextBlock [ Text = ${role.labelExpr(doc, n)}, Foreground = @OnSurface ]`
    const iconEl = icon === undefined ? undefined
        : isRasterIcon(icon)
            ? `Border [ Width = 16, Height = 16, Margin = (0,0,6,0), Background = @${iconKey(icon)} ]`
            : `Shape [ Geometry = @${iconKey(icon)}, Fill = @OnSurface, Width = 16, Height = 16, Margin = (0,0,6,0) ]`
    const inner = iconEl === undefined ? `            ${label}`
        : [`            StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {`,
           `                ${iconEl}`,
           `                ${label}`,
           `            }`].join('\n')
    return [
        `// AUTHOR STUB — edit freely; regeneration will not overwrite this file.`,
        `resources Pres_${slug(n.id)} {`,
        `    DataTemplate x:key="${key}" [ DataType = ${role.dataType} ] {`,
        `        Border [ Background = @SurfaceContainerHigh, CornerRadius = 6, Padding = (8,6,8,6) ] {`,
        inner,
        `        }`,
        `    }`,
        `}`,
        ``,
    ].join('\n')
}

export async function scaffoldAuthorStubs(
    storage: IStorage, doc: TodlDocument, role: PresentationRole, dir: string,
): Promise<number> {
    const have = await existingKeys(storage, dir)
    let written = 0
    for (const n of role.entities(doc)) {
        if (have.has(role.key(n))) continue
        await storage.WriteText(`${dir}/${slug(n.id)}.mu`, stubMu(role, doc, n))
        have.add(role.key(n))
        written++
    }
    return written
}
```

(Resolve the real `IStorage` import path from the factories — they already import it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-scaffold.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/presentation-scaffold.ts src/renderer/src/modules/meta-model/services/tests/presentation-scaffold.test.ts
git commit -m "feat(presentation): write-once author-stub scaffolder"
```

---

### Task 3: Wire the meta-model factory

Scaffold stubs, then emit assets; update the publish message.

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts`
- Test: `src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts` (add a case; create the file if absent)

**Interfaces:**
- Consumes: `generatePresentationAssets` (Task 1), `scaffoldAuthorStubs` + `META_MODEL_ROLE` (Task 2).

- [ ] **Step 1: Write the failing test** — a `regeneratePresentation` over a fake storage with one concept writes both `presentation.generated.mu` (icons, no `DataTemplate`) and a `presentation/<slug>.mu` stub.

```ts
// Arrange a FakeStorage with one .todl that compiles to a concept with an icon,
// run factory.regeneratePresentation(storage), then assert:
//   - storage has 'presentation.generated.mu' matching /resources MetaModelPresentation/ and NOT /DataTemplate/
//   - storage has a 'presentation/<slug>.mu' file matching /DataTemplate x:key="mm:/
// (Reuse the compile helpers the existing factory tests use; if none exist,
//  drive writePresentation via a small seam or test scaffoldAuthorStubs+emitter
//  composition directly.)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Update imports (drop `generatePresentationMu`, add `generatePresentationAssets`, `scaffoldAuthorStubs`, `META_MODEL_ROLE`). Change `writePresentation`:

```ts
private async writePresentation(storage: IStorage, doc: TodlDocument): Promise<void>
{
    await scaffoldAuthorStubs(storage, doc, META_MODEL_ROLE, MetaModelProjectFactory.PRESENTATION_DIR)
    const authorDicts = await this.scanAuthorDicts(storage)
    const source = generatePresentationAssets(doc, authorDicts, 'MetaModelPresentation')
    await storage.WriteText(MetaModelProjectFactory.PRESENTATION_FILE, source)
}
```

In `publish()`, the message references `pres.templates` — see Task 5 for the count-source change; here just ensure the message reads e.g. `presentation: ${pres.icons} icon(s), ${pres.templates} author template(s)`.

- [ ] **Step 4: Run test** — Run the file; Expected: PASS. Then `npx vitest run` (full suite) to catch fallout.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts
git commit -m "feat(presentation): meta-model factory scaffolds stubs + emits assets"
```

---

### Task 4: Wire the library factory; delete the library generator

**Files:**
- Modify: `src/renderer/src/modules/library/services/library-project-factory.ts`
- Delete: `src/renderer/src/modules/library/services/library-presentation-generator.ts` (and its test, if any)
- Test: `src/renderer/src/modules/library/services/tests/library-project-factory.test.ts` (add a case)

**Interfaces:** consumes `generatePresentationAssets`, `scaffoldAuthorStubs`, `LIBRARY_ROLE`.

- [ ] **Step 1: Write the failing test** — library `regeneratePresentation` writes an icons-only `presentation.generated.mu` (`resources LibraryPresentation`, no `DataTemplate`) plus a `presentation/<slug>.mu` stub with `DataType = LibraryClassData` and `Text = $Display`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-project-factory.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Replace the `generateLibraryPresentationMu` import with the shared trio; update `writePresentation`:

```ts
private async writePresentation(storage: IStorage, doc: TodlDocument): Promise<void>
{
    await scaffoldAuthorStubs(storage, doc, LIBRARY_ROLE, LibraryProjectFactory.PRESENTATION_DIR)
    const authorDicts = await this.scanAuthorDicts(storage)
    await storage.WriteText(
        LibraryProjectFactory.PRESENTATION_FILE,
        generatePresentationAssets(doc, authorDicts, 'LibraryPresentation'))
}
```

Delete `library-presentation-generator.ts`. Grep for any remaining `generateLibraryPresentationMu` / `isRasterIcon` imports from that module and repoint to `presentation-generator.js`.

- [ ] **Step 4: Run test** — file, then full `npx vitest run`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(presentation): library factory uses shared emitter; remove library generator"
```

---

### Task 5: Publish counts + fallback verification

Make the publish `templates` count reflect author-supplied templates, and confirm consumers degrade to the plain-label fallback when a key is unresolved.

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/presentation-publisher.ts`
- Modify: `src/renderer/src/modules/library/services/library-presentation-publisher.ts`
- Read/verify: `diagram/services/toolbox-term-template.ts`, `library/services/library-registry.ts` (`resolve` → `defaultTemplate`), the meta-model drawer `mm:<id>` resolution (`meta-model.resources.mu` + whatever fills `MetaModelEntity.UITemplate`).
- Test: extend the publisher tests.

**Interfaces:** `publishPresentation` / `publishLibraryPresentation` return `{ ok, missing, templates, icons }`. `templates` now = count of `DataTemplate` occurrences across compiled `presentation/*.mu` (author + scaffolded), not from the generated dict.

- [ ] **Step 1: Write the failing test** — a publish over a model whose compiled presentation has icons + N author stubs returns `templates === N`, `icons === <distinct icons>`, and the generated dict contributes zero templates.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-publisher.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — adjust the publishers to count templates from the author dicts / compiled output rather than the generated dict; keep the missing-icon gate unchanged.

- [ ] **Step 4: Verify fallback (no code unless a gap is found)** — trace: `LibraryRegistry.resolve` returns `defaultTemplate` on miss (present); `resolveTermTemplate` returns a `TextBlock` tile when the registry is undefined/misses (present); the meta-model drawer/toolbox path must not throw when `mm:<id>` is unresolved — if it can, add a fallback to a plain label box. Add a focused test for whichever path could error.

- [ ] **Step 5: Run + Commit**

Run: `npx vitest run` (full suite). Expected: PASS.

```bash
git add -A
git commit -m "feat(presentation): author-template publish counts + fallback verification"
```

---

## Self-review

- **Spec coverage:** unified emitter (T1), scaffolder write-once (T2), both factories wired (T3/T4), composition unchanged (T3/T4 keep `scanAuthorDicts` + merge), fallback + counts (T5), embedded seam (T1), `library-presentation-generator.ts` removed (T4). Covered.
- **Type consistency:** `generatePresentationAssets(doc, authorDicts, dictName)` and `scaffoldAuthorStubs(storage, doc, role, dir)` signatures used identically across tasks; `PresentationRole` fields (`entities`/`key`/`dataType`/`labelExpr`) consistent.
- **Placeholders:** the only "verify/read" step is T5 Step 4, which is a deliberate trace-then-test (fallbacks already exist per exploration); it adds code only on a found gap.
- **Deviation from spec:** dict block name stays per-domain (`MetaModelPresentation`/`LibraryPresentation`) rather than unified to `Presentation`, to preserve the loader contract — noted in Global Constraints.

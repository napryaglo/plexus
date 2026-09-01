# Library Presentation Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `library` project type the same presentation DX as meta-models — a `regeneratePresentation` capability (unlocking the already-wired "Generate Presentation" menu), a compiled artifact baked into the bundle at publish, and runtime loading that makes the generated templates each class's default rendering (authored `visuals/<id>.mural` still overrides).

**Architecture:** A new library-specific emitter reuses the meta-model's shared icon/label helpers but emits class-id-keyed `DataTemplate`s binding `$Display`. The `LibraryProjectFactory` gains the presentation capability + a publish step that bakes `presentation.compiled.json` into the bundle. `LibraryRegistry` loads that artifact and tiers `resolve()` as authored → presentation → default. Backward compatible: bundles without the artifact keep today's behavior.

**Tech Stack:** TypeScript, Plexus renderer (mural framework), TODL compiler, vitest.

## Global Constraints

- **Every test file lives in a `tests/` subfolder** next to the code it exercises (e.g. `library/services/tests/library-presentation-generator.test.ts`).
- **Use real enums, never string-literal unions.**
- **Reuse, don't fork:** import the shared emitter helpers (`distinctIcons`, `iconKey`, `resolveFacets`, `classEntities`) and the `CompiledPresentation` type from `meta-model/services/*` — do not redeclare them.
- **Backward compatible:** a library bundle with no `presentation/presentation.compiled.json` must render exactly as today.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Test runner: `npx vitest run <path>` for a single file; `npm run typecheck` for types.

---

### Task 1: Library presentation emitter

**Files:**
- Create: `src/renderer/src/modules/library/services/library-presentation-generator.ts`
- Test: `src/renderer/src/modules/library/services/tests/library-presentation-generator.test.ts`

**Interfaces:**
- Consumes: `distinctIcons(model)`, `iconKey(path)`, `resolveFacets(node, annotations)`, `classEntities(model)` from `../../meta-model/services/presentation-generator.js`; `projectAnnotations(doc, id)` from `../../meta-model/services/annotation-projection.js`; `JsonNode`, `TodlDocument` from `@pragmatic-tech-ai/todl`.
- Produces: `generateLibraryPresentationMu(model: TodlDocument, authorOverrideDicts: readonly string[]): string`.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-tech-ai/todl'
import { generateLibraryPresentationMu } from '../library-presentation-generator.js'

// Two Instance-tier classes (attrs.class === true): one with an icon, one without.
const DOC: TodlDocument = {
    nodes: [
        { id: 'microsoft.azure', tier: 'Instance', typeOf: 'location',
          attrs: { class: true, id: 'azure', label: 'Azure', icon: 'resources/azure.svg' } },
        { id: 'microsoft.aws', tier: 'Instance', typeOf: 'location',
          attrs: { class: true, id: 'aws', label: 'AWS' } },
    ],
    edges: [],
} as unknown as TodlDocument

test('emits a resources block with one include per icon and a class-keyed template per class', () => {
    const mu = generateLibraryPresentationMu(DOC, [])
    expect(mu).toContain('resources LibraryPresentation {')
    // one include for the single distinct icon, keyed by iconKey('resources/azure.svg')
    expect(mu).toContain('include "resources/azure.svg" as mm_icon_azure')
    // class-keyed templates (string key = class id)
    expect(mu).toContain('DataTemplate x:key="microsoft.azure"')
    expect(mu).toContain('DataTemplate x:key="microsoft.aws"')
})

test('the iconful class emits a Shape geometry + $Display label; the icon-less class is label-only', () => {
    const mu = generateLibraryPresentationMu(DOC, [])
    // iconful branch
    expect(mu).toContain('Shape [ Geometry = @mm_icon_azure')
    expect(mu).toContain('Text = $Display')
    // icon-less branch: no Shape between the aws template's braces
    const awsBlock = mu.slice(mu.indexOf('x:key="microsoft.aws"'))
    const awsTemplate = awsBlock.slice(0, awsBlock.indexOf('}\n    }') + 1)
    expect(awsTemplate).not.toContain('Shape [')
    expect(awsTemplate).toContain('Text = $Display')
})

test('author override dictionaries are merged last; none → no merge line', () => {
    expect(generateLibraryPresentationMu(DOC, ['LibraryPresentationCustom']))
        .toContain('merge LibraryPresentationCustom')
    expect(generateLibraryPresentationMu(DOC, [])).not.toContain('merge ')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-presentation-generator.test.ts`
Expected: FAIL — module not found / `generateLibraryPresentationMu` not defined.

- [ ] **Step 3: Write the emitter**

```ts
// library-presentation-generator.ts — pure emitter for a library's presentation
// resource dictionary. Mirrors meta-model/services/presentation-generator.ts but
// emits class-id-keyed templates binding $Display (the canvas supplies per-instance
// display data), reusing that module's shared icon/label helpers. No I/O.
import type { TodlDocument, JsonNode } from '@pragmatic-tech-ai/todl'

import { distinctIcons, iconKey, resolveFacets, classEntities } from '../../meta-model/services/presentation-generator.js'
import { projectAnnotations } from '../../meta-model/services/annotation-projection.js'

// Emit the library presentation resource dictionary source. Deterministic: icons
// sorted, classes in model order, one `include` per distinct icon.
// `authorOverrideDicts` are compiled-dictionary identifiers to `merge` last.
export function generateLibraryPresentationMu(model: TodlDocument, authorOverrideDicts: readonly string[]): string
{
    const includes = distinctIcons(model).map((p) => `    include "${p}" as ${iconKey(p)}`)
    const templates = classEntities(model).map((n) => classTemplate(model, n))
    const merges = authorOverrideDicts.map((d) => `    merge ${d}`)

    const lines: string[] = [
        '// presentation.generated.mu — AUTOGENERATED. Do not edit.',
        '// Regenerated from the compiled model. Author customisation goes in presentation/*.mu.',
        '',
        'resources LibraryPresentation {',
        '',
        '    // --- Icons: one geometry per distinct icon referenced by a class. ---',
        ...includes,
        '',
        '    // --- Class templates: one per instantiable class, keyed by class id. ---',
        ...templates,
    ]
    if (merges.length > 0) {
        lines.push('', '    // --- Author overrides (merged last; author keys win). ---', ...merges)
    }
    lines.push('}', '')
    return lines.join('\n')
}

// One class's DataTemplate, keyed by its (qualified) class id so
// LibraryRegistry.resolve(classId) finds it. Icon+label when the class resolves an
// icon, else label-only. The label is BOUND ($Display) — the canvas supplies the
// class instance's display string — not baked, the one divergence from the
// meta-model generator.
function classTemplate(doc: TodlDocument, n: JsonNode): string
{
    const { icon } = resolveFacets(n, projectAnnotations(doc, n.id))
    const labelBlock = 'TextBlock [ Text = $Display, Foreground = @OnSurface ]'

    const body = (icon !== undefined)
        ? [
            '            StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {',
            `                Shape [ Geometry = @${iconKey(icon)}, Fill = @OnSurface, Width = 16, Height = 16, Margin = (0,0,6,0) ]`,
            `                ${labelBlock}`,
            '            }',
          ]
        : [`            ${labelBlock}`]

    return [
        `    DataTemplate x:key="${n.id}" {`,
        '        Border [ Background = @SurfaceContainerHigh, CornerRadius = 6, Padding = (10,6,10,6) ] {',
        ...body,
        '        }',
        '    }',
    ].join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-presentation-generator.test.ts`
Expected: PASS. Then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/library/services/library-presentation-generator.ts src/renderer/src/modules/library/services/tests/library-presentation-generator.test.ts
git commit -m "$(cat <<'EOF'
feat(library): emitter for the library presentation dictionary

Class-id-keyed DataTemplates binding $Display, reusing the meta-model's
shared icon/label helpers.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `regeneratePresentation` capability on the factory

**Files:**
- Modify: `src/renderer/src/modules/library/services/library-project-factory.ts`
- Test: `src/renderer/src/modules/library/services/tests/library-project-factory.test.ts` (extend)

**Interfaces:**
- Consumes: `generateLibraryPresentationMu` (Task 1); `IPresentationProjectFactory` from `../../../services/projects/project-factory.js`; `resolveBases` from `../../../services/projects/base-resolver.js`; `collectTaxonomySources` from `../../meta-model/services/todl-sources.js`; `checkAgainst, toJSON, Severity` from `@pragmatic-tech-ai/todl`; `IStorage`, `StorageEntry`, `compareStorageEntries` (compareStorageEntries already imported).
- Produces: `LibraryProjectFactory.regeneratePresentation(storage: IStorage): Promise<void>`; private `writePresentation(storage, doc)`, `scanAuthorDicts(storage)`.

- [ ] **Step 1: Write the failing tests** (append to `library-project-factory.test.ts`)

```ts
// regeneratePresentation resolves the bound meta-model, so it needs the publishEnv
// provider + a seeded meta-model. `factoryWith(provider)` builds a factory on it.
function factoryWith(provider: ServiceProvider): LibraryProjectFactory { return new LibraryProjectFactory(provider) }

test('regeneratePresentation writes presentation.generated.mu with a template per class + author merge', async () => {
  const storage = new FakeStorage('fake://Acme')
  const { provider, meta } = publishEnv()
  await seedMeta(meta)
  const f = factoryWith(provider)
  await f.createProject(storage, 'microsoft', { metaModel: { id: 'ea', version: '5' } })
  await storage.WriteText('microsoft.todl', LIB)
  await storage.WriteText('presentation/custom.mu', 'resources LibraryPresentationCustom { }')

  await f.regeneratePresentation(storage)

  const out = await storage.ReadText('presentation.generated.mu')
  expect(out).toContain('resources LibraryPresentation {')
  expect(out).toContain('DataTemplate x:key="lib.microsoft.azure"')       // qualified class id from LIB
  expect(out).toContain('merge LibraryPresentationCustom')
})

test('regeneratePresentation is a no-op when the project has no .todl sources', async () => {
  const storage = new FakeStorage('fake://Empty')
  const { provider, meta } = publishEnv()
  await seedMeta(meta)
  const f = factoryWith(provider)
  await f.createProject(storage, 'empty', { metaModel: { id: 'ea', version: '5' } })

  await f.regeneratePresentation(storage)

  expect(await storage.Exists('presentation.generated.mu')).toBe(false)
})

test('regeneratePresentation is a no-op when a .todl has a compile error', async () => {
  const storage = new FakeStorage('fake://Acme')
  const { provider, meta } = publishEnv()
  await seedMeta(meta)
  const f = factoryWith(provider)
  await f.createProject(storage, 'microsoft', { metaModel: { id: 'ea', version: '5' } })
  await storage.WriteText('bad.todl', 'namespace lib { taxonomy microsoft : represents nonesuch { } }')

  await f.regeneratePresentation(storage)

  expect(await storage.Exists('presentation.generated.mu')).toBe(false)
})
```

> **Note on the expected key** (`lib.microsoft.azure`): confirm the qualified class id `deriveClasses(doc)` produces for the `LIB` fixture by logging it once during implementation, and match the assertion to it. The `LIB` taxonomy is `namespace lib { taxonomy microsoft { location azure … } }`; use whatever `n.id` the compiled model carries for `azure`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-project-factory.test.ts`
Expected: FAIL — `regeneratePresentation` is not a function.

- [ ] **Step 3: Implement the capability**

In `library-project-factory.ts`:

1. Add imports:
```ts
import { checkAgainst, toJSON, Severity, type TodlDocument } from '@pragmatic-tech-ai/todl'   // extend existing todl import
import { type IPresentationProjectFactory } from '../../../services/projects/project-factory.js'   // add to existing import list
import { compareStorageEntries, type IStorage, type StorageEntry } from '../../../services/storage/storage.js'   // add StorageEntry
import { generateLibraryPresentationMu } from './library-presentation-generator.js'
```

2. Add `IPresentationProjectFactory` to the `implements` clause:
```ts
export class LibraryProjectFactory extends ServiceBase
    implements IProjectFactory, IPublishableProjectFactory, IProducerProjectFactory, IPresentationProjectFactory
```

3. Add the constants + methods (place near `publish`):
```ts
    // The autogenerated presentation dictionary + the folder of author overrides
    // it merges. Only the generated file is ever written by this factory.
    private static readonly PRESENTATION_FILE = 'presentation.generated.mu'
    private static readonly PRESENTATION_DIR = 'presentation'

    // Capability entry point (the "Generate Presentation" command): compile the
    // library's taxonomy .todl against its bound meta-model, then write the
    // presentation dictionary. No .todl / unresolvable base / TODL error → no-op
    // (leave any existing file untouched; the Problems dock surfaces the reasons).
    public async regeneratePresentation(storage: IStorage): Promise<void>
    {
        const sources = await collectTaxonomySources(storage)
        if (sources.length === 0) return
        const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as LibraryManifest
        if (manifest.metaModel === undefined) return
        const { bases, problems } = await resolveBases(this.Provider, { metaModel: manifest.metaModel })
        if (problems.length > 0) return
        const { model, diagnostics } = checkAgainst(bases, sources)
        if (diagnostics.some((d) => d.severity === Severity.Error)) return
        await this.writePresentation(storage, toJSON(model))
    }

    // Write presentation.generated.mu from an already-compiled document. Scans the
    // presentation/ folder for author dictionaries to merge (by their resources
    // block name). Shared by regeneratePresentation and publish.
    private async writePresentation(storage: IStorage, doc: TodlDocument): Promise<void>
    {
        const authorDicts = await this.scanAuthorDicts(storage)
        await storage.WriteText(LibraryProjectFactory.PRESENTATION_FILE, generateLibraryPresentationMu(doc, authorDicts))
    }

    // The `resources <Name>` identifiers declared in presentation/*.mu (one
    // dictionary per file, by convention). Missing folder → []. Sorted.
    private async scanAuthorDicts(storage: IStorage): Promise<string[]>
    {
        let entries: readonly StorageEntry[]
        try { entries = await storage.List(LibraryProjectFactory.PRESENTATION_DIR) }
        catch { return [] }
        const names: string[] = []
        for (const e of entries) {
            if (e.IsDirectory || !e.Name.endsWith('.mu')) continue
            const text = await storage.ReadText(`${LibraryProjectFactory.PRESENTATION_DIR}/${e.Name}`)
            const m = /\bresources\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(text)
            if (m) names.push(m[1])
        }
        return names.sort()
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-project-factory.test.ts`
Expected: PASS. Then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/library/services/library-project-factory.ts src/renderer/src/modules/library/services/tests/library-project-factory.test.ts
git commit -m "$(cat <<'EOF'
feat(library): regeneratePresentation capability (unlocks the menu)

LibraryProjectFactory now implements IPresentationProjectFactory: compile
taxonomy .todl against the bound meta-model and write presentation.generated.mu.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Library presentation publisher (compiled artifact)

**Files:**
- Create: `src/renderer/src/modules/library/services/library-presentation-publisher.ts`
- Test: `src/renderer/src/modules/library/services/tests/library-presentation-publisher.test.ts`

**Interfaces:**
- Consumes: `generateLibraryPresentationMu` (Task 1); `distinctIcons` from `../../meta-model/services/presentation-generator.js`; `CompiledPresentation` type from `../../meta-model/services/presentation-publisher.js`; `compile, DEFAULT_SYMBOLS, svgToGeometryJs, type IncludeResolver, type IncludeResolution` from `@pragmatic-tech-ai/mural/compiler`; `IStorage`; `TodlDocument`.
- Produces: `publishLibraryPresentation(project: IStorage, dest: IStorage, base: string, doc: TodlDocument): Promise<PublishLibraryPresentationResult>` where `PublishLibraryPresentationResult = { ok: true; templates: number; icons: number } | { ok: false; missing: string[] }`.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { publishLibraryPresentation } from '../library-presentation-publisher.js'

const DOC: TodlDocument = {
    nodes: [
        { id: 'microsoft.azure', tier: 'Instance', typeOf: 'location',
          attrs: { class: true, id: 'azure', label: 'Azure', icon: 'resources/azure.svg' } },
        { id: 'microsoft.aws', tier: 'Instance', typeOf: 'location', attrs: { class: true, id: 'aws', label: 'AWS' } },
    ],
    edges: [],
} as unknown as TodlDocument

const SVG = '<svg viewBox="0 0 16 16"><path d="M2 2 L14 2 L14 14 Z"/></svg>'
function project(withIcon = true): FakeStorage {
    const s = new FakeStorage('fake://proj')
    if (withIcon) void s.WriteText('resources/azure.svg', SVG)
    return s
}

test('writes a self-contained compiled artifact (geometry inlined, no include)', async () => {
    const dest = new FakeStorage('fake://backend')
    const res = await publishLibraryPresentation(project(), dest, 'microsoft/0.1.0', DOC)
    expect(res).toMatchObject({ ok: true, templates: 2, icons: 1 })
    expect(await dest.Exists('microsoft/0.1.0/presentation/presentation.compiled.json')).toBe(true)
    const art = JSON.parse(await dest.ReadText('microsoft/0.1.0/presentation/presentation.compiled.json'))
    expect(art.className).toBe('LibraryPresentation')
    expect(art.symbols).toContain('ResourceDictionary')
    expect(art.body).not.toContain('include ')
    // the compiled body carries a class-keyed template
    expect(art.body).toContain('microsoft.azure')
})

test('a referenced icon with no project file blocks publish (names the path, writes nothing)', async () => {
    const dest = new FakeStorage('fake://backend')
    const res = await publishLibraryPresentation(project(false), dest, 'microsoft/0.1.0', DOC)
    expect(res).toEqual({ ok: false, missing: ['resources/azure.svg'] })
    expect(await dest.Exists('microsoft/0.1.0/presentation/presentation.compiled.json')).toBe(false)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-presentation-publisher.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the publisher**

```ts
// library-presentation-publisher.ts — compile the library's presentation once and
// bake it into the bundle as presentation.compiled.json (geometry inlined, imports
// stripped), mirroring meta-model/services/presentation-publisher.ts. A referenced
// icon with no project file blocks publish (nothing written). Author overrides are
// intentionally ignored (the compiled artifact merges nothing).
import type { TodlDocument } from '@pragmatic-tech-ai/todl'
import {
    compile, DEFAULT_SYMBOLS, svgToGeometryJs,
    type IncludeResolver, type IncludeResolution,
} from '@pragmatic-tech-ai/mural/compiler'

import type { IStorage } from '../../../services/storage/storage.js'
import type { CompiledPresentation } from '../../meta-model/services/presentation-publisher.js'
import { distinctIcons } from '../../meta-model/services/presentation-generator.js'
import { generateLibraryPresentationMu } from './library-presentation-generator.js'

const PRESENTATION_DIR = 'presentation'
const COMPILED_FILE = 'presentation.compiled.json'
const VISUAL_ENGINE = '@pragmatic-tech-ai/mural/visual-engine'

export type PublishLibraryPresentationResult =
    | { ok: true; templates: number; icons: number }
    | { ok: false; missing: string[] }

export async function publishLibraryPresentation(
    project: IStorage, dest: IStorage, base: string, doc: TodlDocument,
): Promise<PublishLibraryPresentationResult>
{
    const svgByPath = new Map<string, string>()
    const missing: string[] = []
    for (const path of distinctIcons(doc)) {
        try { svgByPath.set(path, await project.ReadText(path)) }
        catch { missing.push(path) }
    }
    if (missing.length > 0) return { ok: false, missing }

    const source = generateLibraryPresentationMu(doc, [])   // no author-override merges

    const include: IncludeResolver = (path, ctx): IncludeResolution => {
        const text = svgByPath.get(path)
        if (text === undefined) throw new Error(`presentation include not pre-read: ${path}`)
        const { valueJs, names } = svgToGeometryJs(text)
        return { entries: [{ key: ctx.key ?? path, valueJs }], imports: [{ module: VISUAL_ENGINE, names: [...names] }] }
    }
    const result = compile(source, { include, symbols: DEFAULT_SYMBOLS })

    const names = new Set<string>()
    for (const set of result.imports.values()) for (const n of set) names.add(n)
    const className = result.resourcesBlocks?.[0]?.name
    if (className === undefined) throw new Error('library presentation compile produced no resources block')

    const body = result.js.split('\n').filter((l) => !/^import\b.*\bfrom\b/.test(l)).join('\n').trim()
    const artifact: CompiledPresentation = { body, symbols: [...names].sort(), className }
    await dest.WriteText(`${base}/${PRESENTATION_DIR}/${COMPILED_FILE}`, JSON.stringify(artifact))

    const templates = doc.nodes.filter((n) => n.tier === 'Instance' && n.attrs['class'] === true).length
    return { ok: true, templates, icons: svgByPath.size }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-presentation-publisher.test.ts`
Expected: PASS. Then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/library/services/library-presentation-publisher.ts src/renderer/src/modules/library/services/tests/library-presentation-publisher.test.ts
git commit -m "$(cat <<'EOF'
feat(library): bake presentation.compiled.json at publish

publishLibraryPresentation compiles the library presentation (geometry inlined,
imports stripped) into the bundle; a missing icon blocks publish.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Wire the publisher into `LibraryProjectFactory.publish`

**Files:**
- Modify: `src/renderer/src/modules/library/services/library-project-factory.ts`
- Test: `src/renderer/src/modules/library/services/tests/library-project-factory.test.ts` (extend)

**Interfaces:**
- Consumes: `publishLibraryPresentation` (Task 3); `writePresentation` (Task 2, private).
- Produces: `publish` now bakes the compiled presentation into the bundle, refreshes the project's `presentation.generated.mu`, blocks on a missing icon, and reports template/icon counts.

- [ ] **Step 1: Write the failing tests** (append)

```ts
test('publish bakes presentation.compiled.json into the bundle and refreshes the project file', async () => {
  const storage = new FakeStorage('fake://Acme')
  const { provider, meta, libs } = publishEnv()
  await seedMeta(meta)
  const f = factoryWith(provider)
  await f.createProject(storage, 'microsoft', { metaModel: { id: 'ea', version: '5' } })
  await storage.WriteText('microsoft.todl', LIB)

  const result = await f.publish(await f.openProject(storage), storage, provider)
  expect(result.ok).toBe(true)
  expect(await libs.Exists('microsoft/0.1.0/presentation/presentation.compiled.json')).toBe(true)
  expect(await storage.Exists('presentation.generated.mu')).toBe(true)   // project file refreshed
})

test('publish blocks when a class references an icon with no project file', async () => {
  const storage = new FakeStorage('fake://Acme')
  const { provider, meta, libs } = publishEnv()
  await seedMeta(meta)
  const f = factoryWith(provider)
  await f.createProject(storage, 'microsoft', { metaModel: { id: 'ea', version: '5' } })
  // a taxonomy whose class carries an icon annotation but no on-disk svg
  await storage.WriteText('microsoft.todl',
    'namespace lib { taxonomy microsoft : represents location { location azure { label = "Azure"; @icon("resources/azure.svg"); } } }')

  const result = await f.publish(await f.openProject(storage), storage, provider)
  expect(result.ok).toBe(false)
  expect(result.message).toMatch(/icon/i)
  expect(await libs.Exists('microsoft/0.1.0/model.json')).toBe(false)   // nothing written
})
```

> **Note:** confirm the `@icon(...)` annotation syntax against an existing library/meta-model `.todl` fixture that carries an icon; adjust the fixture to whatever the codebase uses (grep `@icon` under `src`/test fixtures). The behavioral assertion (missing icon → `ok:false`, nothing written) is the contract.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-project-factory.test.ts`
Expected: FAIL — no `presentation.compiled.json`; publish currently succeeds with a missing icon.

- [ ] **Step 3: Implement**

Add the import:
```ts
import { publishLibraryPresentation } from './library-presentation-publisher.js'
```

In `publish`, after the `compileToDocument` block that yields `doc` (and its error guard) and BEFORE writing `model.json`, insert:
```ts
        // Bake the compiled presentation first — a missing icon blocks the publish
        // before anything is written to the backend.
        const dest = ensureLibrariesBackend(provider)
        const base = `${manifest.id}/${manifest.libVersion}`
        const pres = await publishLibraryPresentation(storage, dest, base, doc)
        if (!pres.ok)
            return { ok: false, message: `Publish blocked: missing icon file(s): ${pres.missing.join(', ')}.` }
```
Then reuse the existing `dest`/`base` (remove the later duplicate `const dest = ensureLibrariesBackend(provider)` / `const base = …` lines that currently sit just before `model.json` is written — they are now declared above). After the resource-folder copy loop and before `return`, refresh the project file + fold the counts into the message:
```ts
        await this.writePresentation(storage, doc)
        // ... existing warn string ...
        return {
            ok: true,
            message: `Published ${manifest.id}@${manifest.libVersion} — `
                + `${classes.length} class(es), ${sources.length} source(s), ${copied} resource file(s), `
                + `presentation: ${pres.templates} template(s), ${pres.icons} icon(s)${warn}.`,
        }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-project-factory.test.ts`
Expected: PASS (all existing publish tests still green — the compiled artifact is additive). Then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/library/services/library-project-factory.ts src/renderer/src/modules/library/services/tests/library-project-factory.test.ts
git commit -m "$(cat <<'EOF'
feat(library): publish bakes the presentation + refreshes the project file

publish now writes presentation.compiled.json into the bundle, blocks on a
missing icon, refreshes presentation.generated.mu, and reports the counts.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Loader for the compiled library presentation

**Files:**
- Modify: `src/renderer/src/modules/library/services/library-loader.ts`
- Test: `src/renderer/src/modules/library/services/tests/library-loader.test.ts` (extend)

**Interfaces:**
- Consumes: `CompiledPresentation` from `../../meta-model/services/presentation-publisher.js`; mural runtime/basic/framework/engine namespaces; `ResourceDictionary` from `@pragmatic-tech-ai/mural/runtime`; `IStorage`.
- Produces: `loadLibraryPresentation(backend: IStorage, id: string, version: string): Promise<ResourceDictionary | undefined>`.

- [ ] **Step 1: Write the failing test** (append to `library-loader.test.ts`; reuse its FakeStorage/backend setup pattern)

```ts
import { loadLibraryPresentation } from '../library-loader.js'
// A minimal compiled artifact: a resources class with one class-keyed DataTemplate.
// Build it by compiling through the publisher in a helper, OR inline a known-good
// CompiledPresentation. Prefer generating it via publishLibraryPresentation into a
// FakeStorage so the artifact stays in lockstep with the emitter.

test('loadLibraryPresentation evals the compiled artifact into a class-keyed dictionary', async () => {
    const backend = new FakeStorage('fake://libraries')
    // bake an artifact via the publisher (Task 3) so the shapes match exactly
    const proj = new FakeStorage('fake://proj')
    await proj.WriteText('resources/azure.svg', '<svg viewBox="0 0 16 16"><path d="M2 2 L14 2 L14 14 Z"/></svg>')
    const doc = { nodes: [{ id: 'microsoft.azure', tier: 'Instance', typeOf: 'location',
        attrs: { class: true, id: 'azure', label: 'Azure', icon: 'resources/azure.svg' } }], edges: [] } as any
    const { publishLibraryPresentation } = await import('../library-presentation-publisher.js')
    await publishLibraryPresentation(proj, backend, 'microsoft/0.1.0', doc)

    const dict = await loadLibraryPresentation(backend, 'microsoft', '0.1.0')
    expect(dict).toBeDefined()
    expect(dict!.CanResolve('microsoft.azure')).toBe(true)
})

test('loadLibraryPresentation returns undefined when the bundle has no compiled presentation', async () => {
    const backend = new FakeStorage('fake://libraries')
    await backend.WriteText('microsoft/0.1.0/library.json', '{}')
    expect(await loadLibraryPresentation(backend, 'microsoft', '0.1.0')).toBeUndefined()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-loader.test.ts`
Expected: FAIL — `loadLibraryPresentation` not exported.

- [ ] **Step 3: Implement** (append to `library-loader.ts`)

```ts
import * as MuralRuntime from '@pragmatic-tech-ai/mural/runtime'
import * as MuralBasic from '@pragmatic-tech-ai/mural/basic'
import * as MuralFramework from '@pragmatic-tech-ai/mural/framework'
import * as MuralEngine from '@pragmatic-tech-ai/mural/visual-engine'
import { ResourceDictionary } from '@pragmatic-tech-ai/mural/runtime'
import type { CompiledPresentation } from '../../meta-model/services/presentation-publisher.js'

// Load a library's baked presentation (class-keyed DataTemplates, geometry inlined)
// by evaluating the compiled artifact — no parse, no compile, no SVG read. Returns
// undefined when the bundle predates the feature (no artifact). Mirrors the
// meta-model's presentation-loader, minus the MetaModelEntity ctx symbol.
const COMPILED = 'presentation/presentation.compiled.json'

export async function loadLibraryPresentation(backend: IStorage, id: string, version: string): Promise<ResourceDictionary | undefined>
{
    let raw: string
    try { raw = await backend.ReadText(`${id}/${version}/${COMPILED}`) }
    catch { return undefined }
    const { body, symbols, className } = JSON.parse(raw) as CompiledPresentation
    const ctx: Record<string, unknown> = { ...MuralRuntime, ...MuralEngine, ...MuralBasic, ...MuralFramework }
    const destructure = symbols.length > 0 ? `const { ${symbols.join(', ')} } = _ctx;\n` : ''
    const bodyR = body.replace(/^export class /gm, 'class ')
    const fn = new Function('_ctx', `${destructure}${bodyR}\nreturn ${className}.Clone();`)
    return fn(ctx) as ResourceDictionary
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-loader.test.ts`
Expected: PASS. Then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/library/services/library-loader.ts src/renderer/src/modules/library/services/tests/library-loader.test.ts
git commit -m "$(cat <<'EOF'
feat(library): loader for the baked presentation dictionary

loadLibraryPresentation evals presentation.compiled.json into a class-keyed
ResourceDictionary; undefined for pre-feature bundles.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `LibraryRegistry` consumes the presentation dictionary

**Files:**
- Modify: `src/renderer/src/modules/library/services/library-registry.ts`
- Test: `src/renderer/src/modules/library/services/tests/library-registry.test.ts` (extend)

**Interfaces:**
- Consumes: `loadLibraryPresentation` (Task 5); `ResourceDictionary` from `@pragmatic-tech-ai/mural/runtime`.
- Produces: a new `resolve` tiering — authored `visuals/*.mural` → presentation template → default box — and a `presentationVisuals` dictionary merged into `Application.Resources`.

- [ ] **Step 1: Write the failing tests** (append to `library-registry.test.ts`)

Add a helper that seeds a bundle WITH a baked presentation (reuse the publisher), then:

```ts
test('a class with an icon resolves to its presentation template (non-default) after discover, no lazy wait', async () => {
    const backend = new FakeStorage('fake://libraries')
    // seed manifest + baked presentation for an iconful class with NO authored .mural
    const proj = new FakeStorage('fake://proj')
    void proj.WriteText('resources/azure.svg', SVG)
    const doc = { nodes: [{ id: 'microsoft.azure', tier: 'Instance', typeOf: 'location',
        attrs: { class: true, id: 'azure', label: 'Azure', icon: 'resources/azure.svg' } }], edges: [] } as any
    const { publishLibraryPresentation } = await import('../library-presentation-publisher.js')
    await publishLibraryPresentation(proj, backend, 'microsoft/0.1.0', doc)
    void backend.WriteText('microsoft/0.1.0/library.json', iconManifest('resources/azure.svg'))   // no template field

    const { provider } = envWith(backend)   // env() variant that registers `backend`
    const reg = new LibraryRegistry(provider)
    await reg.discover()
    // presentation tier resolves immediately — not the shared default
    expect(reg.resolve('microsoft.azure', 'location')).not.toBe(reg.resolve('nobody', 'x'))
})

test('an authored template still overrides the presentation template', async () => {
    const backend = new FakeStorage('fake://libraries')
    const proj = new FakeStorage('fake://proj')
    void proj.WriteText('resources/azure.svg', SVG)
    const doc = { nodes: [{ id: 'microsoft.azure', tier: 'Instance', typeOf: 'location',
        attrs: { class: true, id: 'azure', label: 'Azure', icon: 'resources/azure.svg' } }], edges: [] } as any
    const { publishLibraryPresentation } = await import('../library-presentation-publisher.js')
    await publishLibraryPresentation(proj, backend, 'microsoft/0.1.0', doc)
    void backend.WriteText('microsoft/0.1.0/library.json', iconManifest('resources/azure.svg', 'visuals/microsoft.azure.mural'))
    void backend.WriteText('microsoft/0.1.0/visuals/microsoft.azure.mural', 'TextBlock [ Text = $Display ]')

    const { provider } = envWith(backend)
    const reg = new LibraryRegistry(provider)
    await reg.discover()
    const presTemplate = reg.resolve('microsoft.azure', 'location')
    await whenCompiled(reg, 'microsoft.azure')
    // after the authored .mural compiles, resolve returns a DIFFERENT (authored) template
    expect(reg.resolve('microsoft.azure', 'location')).not.toBe(presTemplate)
})
```

> `envWith(backend)` is a small refactor of the existing `env(seed)` helper so a pre-populated backend can be injected (the current `env` builds its own FakeStorage). Extract the provider-wiring into `envWith(backend)` and have `env(seed)` call it. Keep existing tests working.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-registry.test.ts`
Expected: FAIL — iconful class currently resolves to the default until a lazy compile; presentation tier not consulted.

- [ ] **Step 3: Implement**

In `library-registry.ts`:

1. Imports:
```ts
import { discoverLibraries, loadLibraryPresentation, readTemplateSource, readIconSource, type LoadedClass, type LoadedLibrary, type LoadProblem } from './library-loader.js'
```

2. Fields (near `libraryVisuals`):
```ts
    // Baked per-library presentation templates (class-keyed), aggregated. Cleared
    // and repopulated on each discover(); merged into the app resources so the
    // canvas resolves every class by key, not just authored ones.
    private readonly presentationVisuals = new ResourceDictionary()
```

3. In `ensureMerged`, also merge the presentation dictionary:
```ts
        Application.current?.Resources.AddMergedDictionary(this.libraryVisuals)
        Application.current?.Resources.AddMergedDictionary(this.presentationVisuals)
```

4. In `discover()`, after `this.attempted.clear()` and before/after the loop, rebuild the presentation aggregate:
```ts
        this.presentationVisuals.Clear()
        // inside the per-library loop, after indexing classes:
        const pres = await loadLibraryPresentation(backend, lib.id, lib.version)
        if (pres !== undefined) for (const [k, v] of pres.Entries()) this.presentationVisuals.Set(k, v)
```

5. Rewrite `resolve` to tier authored → presentation → default:
```ts
    public resolve(classId: string, _concept: string): DataTemplate
    {
        const authored = this.libraryVisuals.Resolve(classId)
        if (authored !== undefined) return authored as DataTemplate
        // schedule the lazy authored/icon compile if this class has one to build
        if (this.classIndex.has(classId) && !this.attempted.has(classId) && !this.inFlight.has(classId)) {
            this.inFlight.add(classId)
            void this.compileClass(classId)
        }
        const pres = this.presentationVisuals.Resolve(classId)
        if (pres !== undefined) return pres as DataTemplate
        return this.defaultTemplate
    }
```

6. In `compileClass`, gate the legacy icon-template branch so it only runs when there is NO baked presentation for the class (otherwise the presentation supplies the iconful default):
```ts
                } else if (cls.icon !== undefined && !this.presentationVisuals.CanResolve(cls.id)) {
                    // ... existing readIconSource + buildIconTemplate block unchanged ...
                }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-registry.test.ts`
Expected: PASS, including all existing tests (a bundle with no baked presentation still exercises the default/icon fallback unchanged). Then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/library/services/library-registry.ts src/renderer/src/modules/library/services/tests/library-registry.test.ts
git commit -m "$(cat <<'EOF'
feat(library): resolve classes through the baked presentation

LibraryRegistry loads each bundle's presentation.compiled.json and tiers
resolve() as authored .mural -> presentation template -> default box; the
legacy icon path is the fallback for pre-feature bundles.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Emitter (Component 1) → Task 1. Factory capability (Component 2) → Task 2. Publish bake (Component 3) → Tasks 3–4. Runtime consumption (Component 4) → Tasks 5–6. All four components covered.
- "Missing icon blocks publish" → Task 4 test. "Backward compatible" → Task 6 (existing tests + fallback gate). "Author overrides ignored in artifact" → Task 3 (`generateLibraryPresentationMu(doc, [])`). "Label bound not baked" → Task 1 (`Text = $Display`).

**Placeholder scan:** Two tasks carry explicit "confirm the exact value" notes (the qualified class id for the `LIB` fixture in Task 2; the `@icon(...)` annotation syntax in Task 4). These are lookups against existing fixtures, not unresolved design — the behavioral assertions are concrete. `envWith` refactor in Task 6 is specified.

**Type consistency:** `generateLibraryPresentationMu(model, authorOverrideDicts)` — same signature used in Tasks 1/3/2. `CompiledPresentation { body, symbols, className }` — reused, not redeclared (Tasks 3, 5). `publishLibraryPresentation(project, dest, base, doc)` — same call in Task 4. `loadLibraryPresentation(backend, id, version)` — same in Tasks 5, 6. `resolve(classId, _concept)` signature unchanged (Task 6).

## Notes for the implementer

- The `LIB` taxonomy fixture's compiled class id (used in Task 2's key assertion and Task 3/5/6 docs) must match `deriveClasses`/`classEntities` output — verify once by logging `toJSON(model).nodes` for the fixture.
- Do NOT touch the meta-model presentation path or the Project Explorer menu wiring — the `canGeneratePresentation` guard already lights up once Task 2 adds `regeneratePresentation`.
- Run the full suite (`npm test`) before finishing; the registry/loader changes are the only ones that touch shared runtime state.

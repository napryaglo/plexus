# Pre-compiled Meta-Model Presentation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile a meta-model's presentation once at publish into a self-contained `presentation.compiled.json` (SVG geometry inlined) that the loader evaluates directly, replacing the raw `.mu` + separate SVGs that were re-compiled every load.

**Architecture:** At publish, `compile(generatedMu, { include: bakeSvgGeometry, symbols })` inlines each icon's geometry into the compiled resources body; we persist `{ body, symbols, className }`. At load, `new Function('_ctx', destructure + body + 'return C.Clone()')(ctx)` rebuilds the `ResourceDictionary` with no parse, no compile, no SVG reads. Compiled-only (old publishes get a clear "republish" error); a missing icon blocks publish.

**Tech Stack:** TypeScript, Vitest, `@pragmatic-tech-ai/mural/compiler` (`compile`, `DEFAULT_SYMBOLS`, `svgToGeometryJs`), `FakeStorage`.

## Global Constraints

- Compiled artifact path: `<base>/presentation/presentation.compiled.json`, shape `{ body: string; symbols: string[]; className: string }`.
- `body` = `compile().js` with the leading `import … from "…";` lines removed (still begins `export class …`); `symbols` = sorted unique union of `compile().imports` values; `className` = `resourcesBlocks[0].name`.
- Loader ctx = `{ ...MuralRuntime, ...MuralEngine, ...MuralBasic, ...MuralFramework, MetaModelEntity }`; compile `symbols` = `new Map([...DEFAULT_SYMBOLS, ['MetaModelEntity', './meta-model-entity.js']])`.
- Author-override `merge` is out of scope: the compiled artifact is generated with **no** author dicts (`generatePresentationMu(doc, [])`). The project-side `.mu` is unchanged.
- A referenced icon SVG missing from the project **blocks publish** (message names the paths); nothing is written to the backend on a block.
- The project-side `writePresentation` (`presentation.generated.mu` in the project) is unchanged.
- Tests in `tests/` subfolders, Vitest. Run one file: `npx vitest run <path>`. Typecheck: `npm run typecheck`.

---

### Task 1: Publish a compiled presentation artifact (+ block on missing icon)

**Files:**
- Rewrite: `src/renderer/src/modules/meta-model/services/presentation-publisher.ts`.
- Modify: `src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts:92-127` (publish call site).
- Test: `src/renderer/src/modules/meta-model/services/tests/presentation-publisher.test.ts` (rewrite), `src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts` (update the backend-payload test).

**Interfaces:**
- Consumes: `generatePresentationMu(doc, [])`, `distinctIcons(doc)`, `ontologyEntities(doc)` (existing); `compile`, `DEFAULT_SYMBOLS`, `svgToGeometryJs` from `@pragmatic-tech-ai/mural/compiler`.
- Produces:
  - `interface CompiledPresentation { body: string; symbols: string[]; className: string }` (exported).
  - `publishPresentation(project: IStorage, dest: IStorage, base: string, doc: TodlDocument): Promise<PublishPresentationResult>` where
    `type PublishPresentationResult = { ok: true; templates: number; icons: number } | { ok: false; missing: string[] }`.

- [ ] **Step 1: Write the failing publisher tests**

Replace the body of `presentation-publisher.test.ts` with:

```ts
import { test, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-tech-ai/todl'

import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { publishPresentation } from '../presentation-publisher.js'

const DOC: TodlDocument = {
    nodes: [
        { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: { label: 'Actor', icon: 'resources/actor.svg' } },
        { id: 'component', tier: 'Ontology', typeOf: 'concept', attrs: {} },
        { id: 'depends-on', tier: 'Ontology', typeOf: 'relationship', attrs: {} },
    ],
    edges: [],
} as unknown as TodlDocument

const SVG = '<svg viewBox="0 0 16 16"><path d="M2 2 L14 2 L14 14 Z"/></svg>'

function project(withIcon = true): FakeStorage {
    const s = new FakeStorage('fake://proj')
    if (withIcon) void s.WriteText('resources/actor.svg', SVG)
    return s
}

test('writes a self-contained compiled artifact, not raw .mu or SVGs', async () => {
    const dest = new FakeStorage('fake://backend')
    const res = await publishPresentation(project(), dest, 'ea/1.0.0', DOC)
    expect(res.ok).toBe(true)

    expect(await dest.Exists('ea/1.0.0/presentation/presentation.compiled.json')).toBe(true)
    expect(await dest.Exists('ea/1.0.0/presentation/presentation.generated.mu')).toBe(false)
    expect(await dest.Exists('ea/1.0.0/presentation/resources/actor.svg')).toBe(false)

    const art = JSON.parse(await dest.ReadText('ea/1.0.0/presentation/presentation.compiled.json'))
    expect(art.className).toBe('MetaModelPresentation')
    expect(art.symbols).toContain('MetaModelEntity')
    expect(art.symbols).toContain('ResourceDictionary')
    expect(typeof art.body).toBe('string')
    expect(art.body).not.toContain('include ')     // geometry inlined, no external include
})

test('reports template + icon counts', async () => {
    const dest = new FakeStorage('fake://backend')
    const res = await publishPresentation(project(), dest, 'ea/1.0.0', DOC)
    expect(res).toMatchObject({ ok: true, templates: 3, icons: 1 })
})

test('a referenced icon with no project file blocks publish (names the path, writes nothing)', async () => {
    const dest = new FakeStorage('fake://backend')
    const res = await publishPresentation(project(false), dest, 'ea/1.0.0', DOC)
    expect(res).toEqual({ ok: false, missing: ['resources/actor.svg'] })
    expect(await dest.Exists('ea/1.0.0/presentation/presentation.compiled.json')).toBe(false)
})

test('a model with no icons still publishes a valid artifact', async () => {
    const noIcons: TodlDocument = {
        nodes: [{ id: 'component', tier: 'Ontology', typeOf: 'concept', attrs: {} }], edges: [],
    } as unknown as TodlDocument
    const dest = new FakeStorage('fake://backend')
    const res = await publishPresentation(new FakeStorage('fake://proj'), dest, 'ea/1.0.0', noIcons)
    expect(res).toMatchObject({ ok: true, icons: 0 })
    const art = JSON.parse(await dest.ReadText('ea/1.0.0/presentation/presentation.compiled.json'))
    expect(art.body).toContain('DataTemplate')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-publisher.test.ts`
Expected: FAIL — publisher still writes raw `.mu`/SVGs and returns bare stats.

- [ ] **Step 3: Rewrite `presentation-publisher.ts`**

```ts
import type { TodlDocument } from '@pragmatic-tech-ai/todl'
import {
    compile, DEFAULT_SYMBOLS, svgToGeometryJs,
    type IncludeResolver, type IncludeResolution,
} from '@pragmatic-tech-ai/mural/compiler'

import type { IStorage } from '../../../services/storage/storage.js'
import { generatePresentationMu, distinctIcons, ontologyEntities } from './presentation-generator.js'

const PRESENTATION_DIR = 'presentation'
const COMPILED_FILE = 'presentation.compiled.json'
const VISUAL_ENGINE = '@pragmatic-tech-ai/mural/visual-engine'

// The self-contained, evaluable presentation payload written into the backend.
// `body` is the compiled resources class (geometry inlined, imports stripped);
// `symbols` are the names the loader destructures from its ctx; `className` is
// the resources block to instantiate.
export interface CompiledPresentation { body: string; symbols: string[]; className: string }

export type PublishPresentationResult =
    | { ok: true; templates: number; icons: number }
    | { ok: false; missing: string[] }

// Compile the meta-model's presentation once and write it into `dest` under
// `<base>/presentation/presentation.compiled.json`. Icon SVGs are read from the
// project and baked into the compiled body via svgToGeometryJs — the artifact
// has no external file dependency. A referenced icon with no project file blocks
// the publish (nothing is written). Author overrides are intentionally ignored
// (the compiled artifact merges nothing).
export async function publishPresentation(
    project: IStorage, dest: IStorage, base: string, doc: TodlDocument,
): Promise<PublishPresentationResult>
{
    // Pre-read every referenced icon SVG (compiler include resolution is sync).
    const svgByPath = new Map<string, string>()
    const missing: string[] = []
    for (const path of distinctIcons(doc)) {
        try { svgByPath.set(path, await project.ReadText(path)) }
        catch { missing.push(path) }
    }
    if (missing.length > 0) return { ok: false, missing }

    const source = generatePresentationMu(doc, [])   // no author-override merges

    const include: IncludeResolver = (path, ctx): IncludeResolution => {
        const text = svgByPath.get(path)
        if (text === undefined) throw new Error(`presentation include not pre-read: ${path}`)
        const { valueJs, names } = svgToGeometryJs(text)
        return {
            entries: [{ key: ctx.key ?? path, valueJs }],
            imports: [{ module: VISUAL_ENGINE, names: [...names] }],
        }
    }
    const symbols = new Map([...DEFAULT_SYMBOLS, ['MetaModelEntity', './meta-model-entity.js']])
    const result = compile(source, { include, symbols })

    const names = new Set<string>()
    for (const set of result.imports.values()) for (const n of set) names.add(n)
    const className = result.resourcesBlocks?.[0]?.name
    if (className === undefined) throw new Error('presentation compile produced no resources block')

    const body = result.js.split('\n').filter((l) => !/^import\b.*\bfrom\b/.test(l)).join('\n').trim()
    const artifact: CompiledPresentation = { body, symbols: [...names].sort(), className }
    await dest.WriteText(`${base}/${PRESENTATION_DIR}/${COMPILED_FILE}`, JSON.stringify(artifact))

    return { ok: true, templates: ontologyEntities(doc).length, icons: svgByPath.size }
}
```

- [ ] **Step 4: Run the publisher tests to verify they pass**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-publisher.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the factory to the new result (compile first, block atomically)**

In `meta-model-project-factory.ts`, the publish method currently writes `model.json`/`src`/`manifest.json`, then `writePresentation`, then calls `publishPresentation` with `authorDicts`. Reorder so the presentation compiles **first** (a block writes nothing). Replace the block from the `const doc = toJSON(model)` line through the `return { ok: true, … }`:

```ts
        const doc = toJSON(model)
        const dest = ensureMetaModelsBackend(provider)
        const base = `${manifest.id}/${manifest.modelVersion}`

        // Compile the presentation first — a missing icon blocks the publish
        // before anything is written to the backend.
        const pres = await publishPresentation(storage, dest, base, doc)
        if (!pres.ok)
            return { ok: false, message: `Publish blocked: missing icon file(s): ${pres.missing.join(', ')}.` }

        await dest.WriteText(`${base}/model.json`, JSON.stringify(doc, null, 2))
        for (const s of sources) await dest.WriteText(`${base}/src/${s.uri}`, s.text)
        const PACKAGE_NODE = 'package'
        const manifestFile: MetaModelManifestFile = {
            id: manifest.id, version: manifest.modelVersion, name: manifest.name ?? manifest.id,
            annotations: projectAnnotations(doc, PACKAGE_NODE),
        }
        await dest.WriteText(`${base}/manifest.json`, JSON.stringify(manifestFile, null, 2))
        await this.writePresentation(storage, doc)
        return {
            ok: true,
            message: `Published ${manifest.id}@${manifest.modelVersion} (${sources.length} file(s), `
                + `presentation: ${pres.templates} template(s), ${pres.icons} icon(s)).`,
        }
```

(The old `const authorDicts = await this.scanAuthorDicts(storage)` line before the `publishPresentation` call is removed — `writePresentation` still computes its own author dicts internally. `scanAuthorDicts` remains, used by `writePresentation`.)

- [ ] **Step 6: Update the factory's backend-payload test**

In `meta-model-project-factory.test.ts`, the test `'publish ships the presentation payload into the backend'` (around line 216) asserts the backend has `presentation.generated.mu` + `overrides/custom.mu`. Replace those assertions with the compiled artifact (keep the rest of the test — the project must have the icon SVG so publish isn't blocked). Change the payload assertions to:

```ts
    // Compiled presentation shipped to the backend (self-contained, no raw .mu).
    expect(await dest.Exists('acme/0.1.0/presentation/presentation.compiled.json')).toBe(true)
    expect(await dest.Exists('acme/0.1.0/presentation/presentation.generated.mu')).toBe(false)
    // Result message reports the presentation counts.
    expect(result.message).toMatch(/presentation:/)
```

If this test's model declares any icon, ensure the project seeds that SVG file (else publish now blocks); if it declares none, no seeding is needed. Leave the project-side tests (`regeneratePresentation…`, `publish also (re)writes presentation.generated.mu into the project`) unchanged.

- [ ] **Step 7: Run the meta-model suite + typecheck**

Run: `npx vitest run src/renderer/src/modules/meta-model`
Expected: PASS.
Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/presentation-publisher.ts src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts src/renderer/src/modules/meta-model/services/tests/presentation-publisher.test.ts src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts
git commit -m "feat(meta-model): publish a self-contained compiled presentation artifact"
```

---

### Task 2: Load the compiled presentation artifact

**Files:**
- Rewrite: `src/renderer/src/modules/meta-model/services/presentation-loader.ts`.
- Test: `src/renderer/src/modules/meta-model/services/tests/presentation-loader.test.ts` (rewrite as a round-trip).

**Interfaces:**
- Consumes: `CompiledPresentation` (Task 1); `publishPresentation` (Task 1) in the test.
- Produces: `loadPresentation(storage: IStorage, base: string): Promise<ResourceDictionary>` (same signature/return).

- [ ] **Step 1: Write the failing round-trip test**

Replace the body of `presentation-loader.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { DataTemplate } from '@pragmatic-tech-ai/mural/basic'

import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import type { TodlDocument } from '@pragmatic-tech-ai/todl'
import { publishPresentation } from '../presentation-publisher.js'
import { loadPresentation } from '../presentation-loader.js'

const DOC: TodlDocument = {
    nodes: [
        { id: 'application', tier: 'Ontology', typeOf: 'concept', attrs: { label: 'Application', icon: 'resources/app.svg' } },
    ],
    edges: [],
} as unknown as TodlDocument

async function publishFixture(): Promise<FakeStorage> {
    const project = new FakeStorage('fake://proj')
    await project.WriteText('resources/app.svg', '<svg viewBox="0 0 16 16"><path d="M2 2 L14 2 L14 14 Z"/></svg>')
    const backend = new FakeStorage('fake://meta-models')
    const res = await publishPresentation(project, backend, 'tech/0.1.0', DOC)
    expect(res.ok).toBe(true)
    return backend
}

describe('loadPresentation', () => {
    it('evaluates the compiled artifact into a dictionary that resolves mm:<id> with a baked icon', async () => {
        const backend = await publishFixture()
        // No SVG files exist in the backend — the geometry is baked into the artifact.
        expect(await backend.Exists('tech/0.1.0/presentation/resources/app.svg')).toBe(false)

        const dict = await loadPresentation(backend, 'tech/0.1.0')
        expect(dict.CanResolve('mm:application')).toBe(true)
        expect(dict.Resolve('mm:application')).toBeInstanceOf(DataTemplate)
    })

    it('throws a republish error when the compiled artifact is missing (old format)', async () => {
        const backend = new FakeStorage('fake://meta-models')
        await expect(loadPresentation(backend, 'x/0.0.0')).rejects.toThrow(/republish/i)
    })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-loader.test.ts`
Expected: FAIL — the loader still reads `presentation.generated.mu`, which no longer exists.

- [ ] **Step 3: Rewrite `presentation-loader.ts`**

```ts
// presentation-loader.ts — load a published presentation at runtime by evaluating
// the pre-compiled artifact (see presentation-publisher.ts). The artifact's body
// is a compiled `resources` class with all icon geometry inlined, so there is no
// parse, no compile, and no SVG read at load — just a `new Function` eval with the
// mural runtime supplied via ctx (mirrors the compiler's own instantiate()).
import * as MuralRuntime from '@pragmatic-tech-ai/mural/runtime'
import * as MuralBasic from '@pragmatic-tech-ai/mural/basic'
import * as MuralFramework from '@pragmatic-tech-ai/mural/framework'
import * as MuralEngine from '@pragmatic-tech-ai/mural/visual-engine'
import { ResourceDictionary } from '@pragmatic-tech-ai/mural/runtime'

import type { IStorage } from '../../../services/storage/storage.js'
import { MetaModelEntity } from './meta-model-entity.js'
import type { CompiledPresentation } from './presentation-publisher.js'

const COMPILED = 'presentation/presentation.compiled.json'

export async function loadPresentation(storage: IStorage, base: string): Promise<ResourceDictionary>
{
    let raw: string
    try { raw = await storage.ReadText(`${base}/${COMPILED}`) }
    catch {
        throw new Error('This meta-model was published in an older format — republish it to view its presentation.')
    }
    const { body, symbols, className } = JSON.parse(raw) as CompiledPresentation

    const ctx: Record<string, unknown> = {
        ...MuralRuntime, ...MuralEngine, ...MuralBasic, ...MuralFramework, MetaModelEntity,
    }
    const destructure = symbols.length > 0 ? `const { ${symbols.join(', ')} } = _ctx;\n` : ''
    const bodyR = body.replace(/^export class /gm, 'class ')
    const fn = new Function('_ctx', `${destructure}${bodyR}\nreturn ${className}.Clone();`)
    return fn(ctx) as ResourceDictionary
}
```

- [ ] **Step 4: Run the loader test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-loader.test.ts`
Expected: PASS (2 tests). This proves the full publish→load round-trip with **no** SVG files present at load.

- [ ] **Step 5: Run the full meta-model suite + typecheck**

Run: `npx vitest run src/renderer/src/modules/meta-model`
Expected: PASS.
Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/presentation-loader.ts src/renderer/src/modules/meta-model/services/tests/presentation-loader.test.ts
git commit -m "feat(meta-model): load presentation by evaluating the compiled artifact"
```

---

## Notes for the implementer

- The load eval mirrors mural's own `instantiate` resources-path exactly (`compiler/compile.js`): destructure imported names from ctx, `export class`→`class`, `return <Name>.Clone()`. The only difference is we run it on a **stored** body instead of re-compiling source.
- `symbols` (from `compile().imports`) lists every name the body references; the loader ctx (`MuralRuntime`/`Engine`/`Basic`/`Framework` + `MetaModelEntity`) supplies them — the same ctx the old loader used, so coverage is unchanged.
- Author-override `merge` is deliberately dropped from the compiled artifact (`generatePresentationMu(doc, [])`). It was already unwired at load; wiring overrides is a separate effort.
- A meta-model published before this change has no `presentation.compiled.json`; opening its drawer throws the republish error by design. Republishing produces the artifact.

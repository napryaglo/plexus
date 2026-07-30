# Meta-model Presentation Publish (Sub-project A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `MetaModelProjectFactory.publish` so a published meta-model carries a self-contained presentation payload (generated `mm:<id>` source + author overrides + icon SVGs) under `<id>/<version>/presentation/` in the meta-models backend.

**Architecture:** A new pure-ish `presentation-publisher.ts` unit does the layout (writes the generated source via the existing `generatePresentationMu`, recursively copies the project's `presentation/` overrides, and copies each `distinctIcons(doc)` SVG preserving its path) over two `IStorage`s. `publish` calls it after the existing `model.json` + `src/` writes. Everything is `IStorage`-based, so a full flow is unit-testable with `FakeStorage` and no renderer.

**Tech Stack:** TypeScript, `@pragmatic-lab/mural` (`IStorage`), `@pragmatic-lab/todl` (`TodlDocument`), Vitest.

## Global Constraints

- All backend writes flow through `IStorage` (rooted, project-relative paths) — no absolute paths, no raw filesystem.
- Enums over string-literal unions; every test file lives in a `tests/` subfolder next to its source.
- Do not regress the existing publish contract: `model.json` + `src/<uri>` still written; the project's own `presentation.generated.mu` still written by `writePresentation`; a source error still blocks publish and writes nothing.
- Backend layout (the contract sub-project B will read):
  `<id>/<version>/presentation/presentation.generated.mu`, `.../presentation/overrides/<project presentation/ tree>`, `.../presentation/<iconPath>` per icon.
- Work on branch `meta-model-presentation-publish`.

---

## Task 1: `presentation-publisher.ts` — the payload writer

**Files:**
- Create: `src/renderer/src/modules/meta-model/services/presentation-publisher.ts`
- Test: `src/renderer/src/modules/meta-model/services/tests/presentation-publisher.test.ts`

**Interfaces:**
- Consumes: `IStorage`, `StorageEntry` from `../../../services/storage/storage.js`; `generatePresentationMu`, `distinctIcons`, `ontologyEntities` from `./presentation-generator.js`; `TodlDocument` from `@pragmatic-lab/todl`.
- Produces:
  - `interface PresentationPublishStats { templates: number; icons: number }`
  - `async function publishPresentation(project: IStorage, dest: IStorage, base: string, doc: TodlDocument, authorDicts: readonly string[]): Promise<PresentationPublishStats>`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/modules/meta-model/services/tests/presentation-publisher.test.ts`:

```ts
import { test, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-lab/todl'

import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { publishPresentation } from '../presentation-publisher.js'

// A hand-built compiled document (toJSON shape): one concept with an icon, one
// without, one relationship — avoids authoring icon-bearing TODL.
const DOC: TodlDocument = {
    nodes: [
        { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: { label: 'Actor', icon: 'resources/actor.svg' } },
        { id: 'component', tier: 'Ontology', typeOf: 'concept', attrs: {} },
        { id: 'depends-on', tier: 'Ontology', typeOf: 'relationship', attrs: {} },
    ],
    edges: [],
} as unknown as TodlDocument

function project(): FakeStorage
{
    const s = new FakeStorage('fake://proj')
    void s.WriteText('resources/actor.svg', '<svg>actor</svg>')
    void s.WriteText('presentation/custom.mu', 'resources Custom { }')
    return s
}

test('writes the generated dictionary source with a template per entity and the author merge', async () => {
    const dest = new FakeStorage('fake://backend')
    await publishPresentation(project(), dest, 'ea/1.0.0', DOC, ['Custom'])

    const src = await dest.ReadText('ea/1.0.0/presentation/presentation.generated.mu')
    expect(src).toContain('DataTemplate x:key="mm:actor"')
    expect(src).toContain('DataTemplate x:key="mm:component"')
    expect(src).toContain('DataTemplate x:key="mm:depends-on"')
    expect(src).toContain('merge Custom')
})

test('copies each declared icon SVG preserving its project-relative path', async () => {
    const dest = new FakeStorage('fake://backend')
    await publishPresentation(project(), dest, 'ea/1.0.0', DOC, [])
    expect(await dest.ReadText('ea/1.0.0/presentation/resources/actor.svg')).toBe('<svg>actor</svg>')
})

test('copies the project presentation/ overrides tree under overrides/', async () => {
    const dest = new FakeStorage('fake://backend')
    await publishPresentation(project(), dest, 'ea/1.0.0', DOC, ['Custom'])
    expect(await dest.ReadText('ea/1.0.0/presentation/overrides/custom.mu')).toBe('resources Custom { }')
})

test('reports template + icon counts', async () => {
    const dest = new FakeStorage('fake://backend')
    const stats = await publishPresentation(project(), dest, 'ea/1.0.0', DOC, [])
    expect(stats.templates).toBe(3)   // actor + component + depends-on
    expect(stats.icons).toBe(1)       // only actor.svg exists
})

test('a declared icon with no file is skipped, not fatal', async () => {
    const proj = new FakeStorage('fake://proj')   // no resources/actor.svg on disk
    const dest = new FakeStorage('fake://backend')
    const stats = await publishPresentation(proj, dest, 'ea/1.0.0', DOC, [])
    expect(stats.icons).toBe(0)
    expect(await dest.Exists('ea/1.0.0/presentation/resources/actor.svg')).toBe(false)
    // The generated source still shipped.
    expect(await dest.Exists('ea/1.0.0/presentation/presentation.generated.mu')).toBe(true)
})

test('no project presentation/ folder → no overrides dir, source still written', async () => {
    const proj = new FakeStorage('fake://proj')
    await proj.WriteText('resources/actor.svg', '<svg/>')
    const dest = new FakeStorage('fake://backend')
    await publishPresentation(proj, dest, 'ea/1.0.0', DOC, [])
    expect(await dest.Exists('ea/1.0.0/presentation/overrides')).toBe(false)
    expect(await dest.Exists('ea/1.0.0/presentation/presentation.generated.mu')).toBe(true)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-publisher.test.ts`
Expected: FAIL — cannot find module `../presentation-publisher.js`.

- [ ] **Step 3: Implement the publisher**

Create `src/renderer/src/modules/meta-model/services/presentation-publisher.ts`:

```ts
import type { TodlDocument } from '@pragmatic-lab/todl'

import type { IStorage, StorageEntry } from '../../../services/storage/storage.js'
import { generatePresentationMu, distinctIcons, ontologyEntities } from './presentation-generator.js'

// The project folder holding author-written override dictionaries; copied
// verbatim into the backend so the generated `merge <Name>` lines resolve.
const OVERRIDES_SRC_DIR = 'presentation'
// The self-contained presentation folder written into the backend base.
const PRESENTATION_DIR = 'presentation'
const GENERATED_FILE = 'presentation.generated.mu'
const OVERRIDES_DEST_DIR = 'overrides'

export interface PresentationPublishStats { templates: number; icons: number }

// Write a published model's presentation payload into `dest` under
// `<base>/presentation/`: the generated dictionary source, the project's
// override tree, and each declared icon SVG (path preserved). Pure I/O over two
// IStorages — no renderer, no compilation. `authorDicts` are the override
// `resources <Name>` identifiers the generated source should `merge`.
export async function publishPresentation(
    project: IStorage, dest: IStorage, base: string,
    doc: TodlDocument, authorDicts: readonly string[],
): Promise<PresentationPublishStats>
{
    const root = `${base}/${PRESENTATION_DIR}`

    // 1. Generated dictionary source (identical to the project-side output).
    const source = generatePresentationMu(doc, authorDicts)
    await dest.WriteText(`${root}/${GENERATED_FILE}`, source)

    // 2. Author overrides tree (verbatim). Missing folder → nothing copied.
    await copyTree(project, OVERRIDES_SRC_DIR, dest, `${root}/${OVERRIDES_DEST_DIR}`)

    // 3. Icons — copy each declared SVG, preserving its project-relative path so
    //    an include-resolver rooted at `<root>` finds it. A missing file is an
    //    authoring gap: skip it (non-fatal) and leave it out of the count.
    let icons = 0
    for (const iconPath of distinctIcons(doc))
    {
        try
        {
            const svg = await project.ReadText(iconPath)
            await dest.WriteText(`${root}/${iconPath}`, svg)
            icons++
        }
        catch { /* missing asset — skip */ }
    }

    return { templates: ontologyEntities(doc).length, icons }
}

// Recursively copy every file under `srcDir` in `from` to `destDir` in `to`,
// preserving structure. A missing `srcDir` (List throws) copies nothing.
// Text copy suffices — presentation assets are .mu / .svg (UTF-8).
async function copyTree(from: IStorage, srcDir: string, to: IStorage, destDir: string): Promise<void>
{
    let entries: readonly StorageEntry[]
    try { entries = await from.List(srcDir) }
    catch { return }
    for (const e of entries)
    {
        const srcPath = srcDir === '' ? e.Name : `${srcDir}/${e.Name}`
        const destPath = `${destDir}/${e.Name}`
        if (e.IsDirectory) await copyTree(from, srcPath, to, destPath)
        else await to.WriteText(destPath, await from.ReadText(srcPath))
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-publisher.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/presentation-publisher.ts \
        src/renderer/src/modules/meta-model/services/tests/presentation-publisher.test.ts
git commit -m "$(cat <<'EOF'
feat(meta-model): presentation-publisher writes the backend presentation payload

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: wire `publishPresentation` into `MetaModelProjectFactory.publish`

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts`
- Test: `src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts` (append)

**Interfaces:**
- Consumes: `publishPresentation`, `PresentationPublishStats` from `./presentation-publisher.js` (Task 1); the factory's existing private `scanAuthorDicts(storage)`.
- Produces: an updated `publish` whose backend output includes the `presentation/` payload and whose result message reports the presentation counts.

- [ ] **Step 1: Write the failing test**

Append to `src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts`:

```ts
test('publish ships the presentation payload into the backend', async () => {
    const storage = new FakeStorage('fake://Acme')
    const f = factory()
    await f.createProject(storage, 'Acme')
    await storage.WriteText('concepts.todl', CONCEPTS)
    await storage.WriteText('ea.todl', EA)
    // an author override dictionary under presentation/
    await storage.WriteText('presentation/custom.mu', 'resources MetaModelPresentationCustom { }')

    const { provider, dest } = publishEnv()
    const project = await f.openProject(storage)
    const result = await f.publish(project, storage, provider)

    expect(result.ok).toBe(true)
    // Generated dictionary shipped to the backend with the per-entity templates.
    const src = await dest.ReadText('acme/0.1.0/presentation/presentation.generated.mu')
    expect(src).toContain('DataTemplate x:key="mm:model"')
    expect(src).toContain('merge MetaModelPresentationCustom')
    // Author override copied under overrides/.
    expect(await dest.ReadText('acme/0.1.0/presentation/overrides/custom.mu'))
        .toBe('resources MetaModelPresentationCustom { }')
    // Result message reports the presentation counts.
    expect(result.message).toMatch(/presentation:/)
    // Existing contract intact.
    expect(await dest.Exists('acme/0.1.0/model.json')).toBe(true)
    expect(await dest.Exists('acme/0.1.0/src/concepts.todl')).toBe(true)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts -t "ships the presentation payload"`
Expected: FAIL — `acme/0.1.0/presentation/presentation.generated.mu` does not exist (publish doesn't write it yet).

- [ ] **Step 3: Import the publisher**

In `meta-model-project-factory.ts`, add to the imports near the existing `generatePresentationMu` import:

```ts
import { publishPresentation } from './presentation-publisher.js'
```

- [ ] **Step 4: Call `publishPresentation` from `publish`**

In `publish`, the current tail is:

```ts
        const doc = toJSON(model)
        const dest = ensureMetaModelsBackend(provider)
        const base = `${manifest.id}/${manifest.modelVersion}`
        await dest.WriteText(`${base}/model.json`, JSON.stringify(doc, null, 2))
        for (const s of sources) await dest.WriteText(`${base}/src/${s.uri}`, s.text)
        // Keep the project's presentation dictionary current with what was published.
        await this.writePresentation(storage, doc)
        return { ok: true, message: `Published ${manifest.id}@${manifest.modelVersion} (${sources.length} file(s)).` }
```

Replace from `await this.writePresentation(...)` onward with:

```ts
        // Keep the project's presentation dictionary current with what was published.
        await this.writePresentation(storage, doc)
        // Ship a self-contained presentation payload into the backend so a
        // consumer can instantiate the entity templates (sub-project B).
        const authorDicts = await this.scanAuthorDicts(storage)
        const pres = await publishPresentation(storage, dest, base, doc, authorDicts)
        return {
            ok: true,
            message: `Published ${manifest.id}@${manifest.modelVersion} (${sources.length} file(s), `
                + `presentation: ${pres.templates} template(s), ${pres.icons} icon(s)).`,
        }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts -t "ships the presentation payload"`
Expected: PASS.

- [ ] **Step 6: Run the full factory test file (no regressions)**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts`
Expected: PASS (all existing tests plus the new one). Confirms `model.json` + `src/`, the project-side `presentation.generated.mu`, and the publish-blocked-on-error behavior are intact.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts \
        src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts
git commit -m "$(cat <<'EOF'
feat(meta-model): publish ships the presentation payload to the backend

publish now writes <id>/<version>/presentation/ (generated dictionary source,
author overrides, icon SVGs) via publishPresentation, and reports the template +
icon counts in its result message.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole Plexus suite**

Run: `npm test`
Expected: green — no existing test depended on the old publish message wording or backend layout. (If a test asserted the exact old message string, update it to match the new suffix; none is expected to.)

- [ ] **Step 2: Confirm branch state**

Run: `git log --oneline -3`
Expected: the Task 1 and Task 2 commits on top of the spec commit on `meta-model-presentation-publish`.

---

## Self-Review Notes

- **Spec coverage:** backend layout → Task 1 (`publishPresentation` writes `presentation/` + `overrides/` + icons); "ship source not JS" → Task 1 uses `generatePresentationMu` source, no compile; publish-message suffix → Task 2 Step 4; recursive copy → Task 1 `copyTree`; missing-icon non-fatal → Task 1 test + impl; no-`presentation/`-folder → Task 1 test + `copyTree` catch; don't-regress contract → Task 2 Step 6 + Task 3.
- **Type consistency:** `publishPresentation(project, dest, base, doc, authorDicts)` and `PresentationPublishStats { templates, icons }` are identical across Task 1 (definition), its tests, and Task 2 (call site). `scanAuthorDicts` returns `string[]` (existing factory method) → passed as `authorDicts`.
- **Accessor:** tests use `FakeStorage.ReadText/WriteText/Exists/List` (verified in the fake) and `ObservableCollection` is not involved here.
- **No placeholders:** every code step is complete and runnable.

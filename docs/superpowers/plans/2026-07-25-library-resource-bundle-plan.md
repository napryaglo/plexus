# Library Resource Bundle (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `LibraryProjectFactory.publish` emit a complete resource bundle — the compiled TODL, a `library.json` manifest describing the library's instantiable classes, and the project's `visuals/` `assets/` `docs/` `samples/` `thumbnails/` folders — into the libraries backend.

**Architecture:** Two pure helpers (a taxonomy-source collector that excludes `samples/`, and a `library-bundle.ts` module that derives classes from the compiled model + scans resource folders) feed an extended `publish` that assembles `library.json` and copies the resource folders alongside the existing `model.json` + `src/`.

**Tech Stack:** TypeScript, Electron (renderer), `@pragmatic-tech-ai/todl` (compiler), Vitest, in-memory `FakeStorage` test double.

## Global Constraints

- **Every test file lives in a `tests/` subfolder** next to the code it exercises.
- **Enums over string-literal unions** in our own code. (Exception, by necessity: `JsonNode.tier` and `attrs.class` arrive as raw JSON — `toJSON` emits the `Tier` enum by *member name* — so we compare `n.tier === "Instance"` against that JSON string; this is reading foreign data, not defining a type.)
- **Publish blocks only on TODL `Severity.Error`.** Resource problems (orphans) are non-blocking warnings surfaced in the `PublishResult.message`.
- **Resources bind to a class by filename convention:** stem = the class's qualified id (`visuals/<classId>.mural`, `thumbnails/<classId>.png`, `docs/<classId>.md`).
- **`samples/` is excluded** from the taxonomy compile.
- Verified fixture: the sample `microsoft` taxonomy compiles to two `Instance`-tier `class===true` nodes — `microsoft.azure` (typeOf `location`, attrs `{class:true,id:"azure",label:"Azure"}`) and `microsoft.azure-openai` (typeOf `technology`, attrs `{class:true,id:"azure-openai",label:"Azure OpenAI"}`).
- Run a single test file with `npx vitest run <path>`; the full suite with `npx vitest run`.

---

## File Structure

- **Create** `src/renderer/src/modules/library/services/library-bundle.ts` — manifest types (`PublishedClass`, `LibraryBundleManifest`) + pure helpers `deriveClasses(model)` and `scanResources(storage, classIds)`.
- **Modify** `src/renderer/src/modules/meta-model/services/todl-sources.ts` — add `collectTaxonomySources(storage, excludeDirs)`.
- **Modify** `src/renderer/src/modules/library/services/library-project-factory.ts` — extend `publish`; add a `description?` field to `LibraryManifest`; add `copyResourceFolder` + `isTextResource`.
- **Create** `src/renderer/src/modules/meta-model/services/tests/todl-sources.test.ts`.
- **Create** `src/renderer/src/modules/library/services/tests/library-bundle.test.ts`.
- **Modify** `src/renderer/src/modules/library/services/tests/library-project-factory.test.ts` — add bundle-publish tests.

---

## Task 1: Taxonomy source collector (excludes `samples/`)

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/todl-sources.ts`
- Test: `src/renderer/src/modules/meta-model/services/tests/todl-sources.test.ts` (create)

**Interfaces:**
- Consumes: `IStorage` (`List`, `ReadText`), existing `joinRel`/`extname` in the same file, TODL `SourceFile` (`{ uri, text }`).
- Produces: `collectTaxonomySources(storage: IStorage, excludeDirs?: readonly string[]): Promise<SourceFile[]>` — every `.todl` except those under the named top-level folders (default `['samples']`).

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/modules/meta-model/services/tests/todl-sources.test.ts`:

```ts
import { test, expect } from 'vitest'

import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { collectTaxonomySources } from '../todl-sources.js'

test('collects every .todl except those under excluded top-level folders', async () => {
    const s = new FakeStorage('fake://lib')
    await s.WriteText('microsoft.todl', 'a')
    await s.WriteText('sub/more.todl', 'b')
    await s.WriteText('samples/demo.todl', 'c')          // excluded by default
    await s.WriteText('assets/logo.svg', '<svg/>')       // not a .todl

    const uris = (await collectTaxonomySources(s)).map((f) => f.uri).sort()
    expect(uris).toEqual(['microsoft.todl', 'sub/more.todl'])
})

test('a custom excludeDirs list overrides the default', async () => {
    const s = new FakeStorage('fake://lib')
    await s.WriteText('samples/demo.todl', 'c')
    await s.WriteText('scratch/x.todl', 'd')

    const uris = (await collectTaxonomySources(s, ['scratch'])).map((f) => f.uri).sort()
    expect(uris).toEqual(['samples/demo.todl'])   // samples now included; scratch excluded
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/todl-sources.test.ts`
Expected: FAIL — `collectTaxonomySources` is not exported.

- [ ] **Step 3: Add the collector**

Append to `src/renderer/src/modules/meta-model/services/todl-sources.ts` (after `collectTodlSources`):

```ts
// Collect every `.todl` EXCEPT those under the given TOP-LEVEL folders (default
// `samples/`, which holds example instances that must never enter the taxonomy
// compile). A top-level directory whose name is in excludeDirs is skipped whole;
// nested folders of the same name are not special. `collectTodlSources` above
// stays the unfiltered walk it is today.
export async function collectTaxonomySources(
    storage: IStorage,
    excludeDirs: readonly string[] = ['samples'],
): Promise<SourceFile[]>
{
    const exclude = new Set(excludeDirs)
    const out: SourceFile[] = []
    async function walk(dir: string): Promise<void>
    {
        for (const e of await storage.List(dir)) {
            if (dir === '' && e.IsDirectory && exclude.has(e.Name)) continue
            const path = joinRel(dir, e.Name)
            if (e.IsDirectory) await walk(path)
            else if (extname(e.Name) === '.todl') out.push({ uri: path, text: await storage.ReadText(path) })
        }
    }
    await walk('')
    return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/todl-sources.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/todl-sources.ts src/renderer/src/modules/meta-model/services/tests/todl-sources.test.ts
git commit -m "feat(library): taxonomy source collector that excludes samples/"
```

---

## Task 2: `deriveClasses` + manifest types

**Files:**
- Create: `src/renderer/src/modules/library/services/library-bundle.ts`
- Test: `src/renderer/src/modules/library/services/tests/library-bundle.test.ts` (create)

**Interfaces:**
- Consumes: `TodlDocument` from `@pragmatic-tech-ai/todl` (`{ nodes: JsonNode[]; edges }`, `JsonNode = { id, tier, typeOf, attrs }`).
- Produces:
  - `interface PublishedClass { id: string; localId?: string; label?: string; concept: string; template?: string; thumbnail?: string; doc?: string }`
  - `interface LibraryBundleManifest { id; version; name; description?; metaModel: {id;version}; classes: PublishedClass[]; assets: string[]; docs: string[]; samples: string[] }`
  - `deriveClasses(model: TodlDocument): PublishedClass[]` — the `Instance`-tier `attrs.class===true` clabjects.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/modules/library/services/tests/library-bundle.test.ts`:

```ts
import { test, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-tech-ai/todl'

import { deriveClasses } from '../library-bundle.js'

// A hand-built model mirroring what the sample `microsoft` taxonomy compiles to
// (verified empirically): Ontology-tier concept/field/taxonomy DEFINITIONS plus
// two Instance-tier CLASS clabjects (attrs.class === true).
const MODEL: TodlDocument = {
    nodes: [
        { id: 'location',   tier: 'Ontology', typeOf: 'concept',  attrs: {} },
        { id: 'technology', tier: 'Ontology', typeOf: 'concept',  attrs: {} },
        { id: 'microsoft',  tier: 'Ontology', typeOf: 'taxonomy', attrs: {} },
        { id: 'microsoft.azure',        tier: 'Instance', typeOf: 'location',   attrs: { class: true, id: 'azure',        label: 'Azure' } },
        { id: 'microsoft.azure-openai', tier: 'Instance', typeOf: 'technology', attrs: { class: true, id: 'azure-openai', label: 'Azure OpenAI' } },
    ],
    edges: [],
}

test('derives only Instance-tier class clabjects, with localId/label/concept', () => {
    const classes = deriveClasses(MODEL)
    expect(classes).toEqual([
        { id: 'microsoft.azure',        localId: 'azure',        label: 'Azure',        concept: 'location' },
        { id: 'microsoft.azure-openai', localId: 'azure-openai', label: 'Azure OpenAI', concept: 'technology' },
    ])
})

test('ignores Ontology-tier definitions and non-class instances', () => {
    const model: TodlDocument = { nodes: [
        { id: 'x',     tier: 'Ontology', typeOf: 'concept',  attrs: {} },
        { id: 'lib.i', tier: 'Instance', typeOf: 'x',        attrs: { id: 'i' } },   // an instance, not a class
    ], edges: [] }
    expect(deriveClasses(model)).toEqual([])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-bundle.test.ts`
Expected: FAIL — `../library-bundle.js` does not exist.

- [ ] **Step 3: Create the module with types + `deriveClasses`**

Create `src/renderer/src/modules/library/services/library-bundle.ts`:

```ts
import type { TodlDocument } from '@pragmatic-tech-ai/todl'

// One instantiable class a published library provides — a palette item. Derived
// from the compiled model's Instance-tier clabjects; resource paths are attached
// later (present only when the conventionally-named file exists).
export interface PublishedClass
{
    id:         string     // qualified class NodeId, e.g. "microsoft.azure"
    localId?:   string     // attrs.id, the short name, e.g. "azure"
    label?:     string     // attrs.label, if present, e.g. "Azure"
    concept:    string     // node.typeOf — the meta-model concept it realises, e.g. "location"
    template?:  string     // "visuals/<id>.mural"    — present only if the file exists
    thumbnail?: string     // "thumbnails/<id>.png"   — present only if the file exists
    doc?:       string     // "docs/<id>.md"          — present only if the file exists
}

// The library.json bundle manifest — the index a consumer reads to discover and
// mount a published library. `classes` are the palette items; `assets`/`docs`/
// `samples` list every file under those bundle folders.
export interface LibraryBundleManifest
{
    id:          string
    version:     string
    name:        string
    description?: string
    metaModel:   { id: string; version: string }
    classes:     PublishedClass[]
    assets:      string[]
    docs:        string[]
    samples:     string[]
}

// The instantiable classes a library provides: Instance-tier clabjects
// (`attrs.class === true`), each simultaneously an instance of a meta concept and
// a class for further instantiation. `tier` is compared to the literal "Instance"
// because toJSON emits the Tier enum by member name; `attrs.class` is a boolean
// scalar. Ontology-tier concept/field/taxonomy definitions are NOT classes.
export function deriveClasses(model: TodlDocument): PublishedClass[]
{
    const out: PublishedClass[] = []
    for (const n of model.nodes) {
        if (n.tier !== 'Instance' || n.attrs.class !== true) continue
        const cls: PublishedClass = { id: n.id, concept: n.typeOf }
        if (typeof n.attrs.id === 'string') cls.localId = n.attrs.id
        if (typeof n.attrs.label === 'string') cls.label = n.attrs.label
        out.push(cls)
    }
    return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-bundle.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/library/services/library-bundle.ts src/renderer/src/modules/library/services/tests/library-bundle.test.ts
git commit -m "feat(library): library-bundle types + deriveClasses from compiled model"
```

---

## Task 3: `scanResources` — bind files to classes + list bundle folders

**Files:**
- Modify: `src/renderer/src/modules/library/services/library-bundle.ts`
- Test: `src/renderer/src/modules/library/services/tests/library-bundle.test.ts` (extend)

**Interfaces:**
- Consumes: `IStorage` (`List`), the class ids from `deriveClasses`.
- Produces: `scanResources(storage: IStorage, classIds: readonly string[]): Promise<ScannedResources>` where
  `interface ScannedResources { byClass: Map<string, { template?: string; thumbnail?: string; doc?: string }>; assets: string[]; docs: string[]; samples: string[]; warnings: string[] }`.

- [ ] **Step 1: Write the failing test**

Append to `src/renderer/src/modules/library/services/tests/library-bundle.test.ts`:

```ts
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { scanResources } from '../library-bundle.js'

test('binds resource files to classes by filename and lists bundle folders', async () => {
    const s = new FakeStorage('fake://lib')
    await s.WriteText('visuals/microsoft.azure.mural', '<template/>')
    await s.WriteText('thumbnails/microsoft.azure.png', 'PNGBYTES')
    await s.WriteText('docs/microsoft.azure.md', '# Azure')
    await s.WriteText('docs/README.md', '# Library')
    await s.WriteText('assets/logo.svg', '<svg/>')
    await s.WriteText('samples/demo.todl', 'sample')
    await s.WriteText('visuals/ghost.mural', '<template/>')   // orphan: unknown class

    const scanned = await scanResources(s, ['microsoft.azure', 'microsoft.azure-openai'])

    expect(scanned.byClass.get('microsoft.azure')).toEqual({
        template: 'visuals/microsoft.azure.mural',
        thumbnail: 'thumbnails/microsoft.azure.png',
        doc: 'docs/microsoft.azure.md',
    })
    expect(scanned.byClass.has('microsoft.azure-openai')).toBe(false)   // no files for it
    expect(scanned.assets).toEqual(['assets/logo.svg'])
    expect(scanned.docs.sort()).toEqual(['docs/README.md', 'docs/microsoft.azure.md'])
    expect(scanned.samples).toEqual(['samples/demo.todl'])
    expect(scanned.warnings).toEqual(['visuals/ghost.mural targets unknown class "ghost"'])
})

test('missing resource folders scan cleanly to empty', async () => {
    const scanned = await scanResources(new FakeStorage('fake://empty'), ['a'])
    expect(scanned.byClass.size).toBe(0)
    expect(scanned.assets).toEqual([])
    expect(scanned.warnings).toEqual([])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-bundle.test.ts`
Expected: FAIL — `scanResources` is not exported.

- [ ] **Step 3: Add `scanResources`**

Append to `src/renderer/src/modules/library/services/library-bundle.ts` (add the `IStorage` import at the top):

```ts
import type { IStorage } from '../../../services/storage/storage.js'
```

```ts
export interface ScannedResources
{
    byClass:  Map<string, { template?: string; thumbnail?: string; doc?: string }>
    assets:   string[]
    docs:     string[]
    samples:  string[]
    warnings: string[]
}

// Scan the reserved resource folders and bind files to classes by filename
// convention (stem = class id): visuals/<id>.mural, thumbnails/<id>.png,
// docs/<id>.md attach to a known class; every asset/doc/sample file is also
// listed for the bundle manifest. A visuals/thumbnails file whose stem is not a
// known class id is an orphan — warned, never fatal. Folders are listed flat
// (Phase 1 assumes no nesting inside them); a missing folder lists as empty.
export async function scanResources(
    storage: IStorage,
    classIds: readonly string[],
): Promise<ScannedResources>
{
    const known = new Set(classIds)
    const byClass = new Map<string, { template?: string; thumbnail?: string; doc?: string }>()
    const warnings: string[] = []

    const ensure = (id: string): { template?: string; thumbnail?: string; doc?: string } => {
        let e = byClass.get(id)
        if (e === undefined) { e = {}; byClass.set(id, e) }
        return e
    }
    const files = async (dir: string): Promise<string[]> => {
        const names: string[] = []
        for (const e of await storage.List(dir)) if (!e.IsDirectory) names.push(e.Name)
        return names
    }
    const stem = (name: string): string => {
        const i = name.lastIndexOf('.')
        return i > 0 ? name.slice(0, i) : name
    }

    for (const name of await files('visuals')) {
        if (!name.endsWith('.mural')) continue
        const id = stem(name)
        if (known.has(id)) ensure(id).template = `visuals/${name}`
        else warnings.push(`visuals/${name} targets unknown class "${id}"`)
    }
    for (const name of await files('thumbnails')) {
        const id = stem(name)
        if (known.has(id)) ensure(id).thumbnail = `thumbnails/${name}`
        else warnings.push(`thumbnails/${name} targets unknown class "${id}"`)
    }
    for (const name of await files('docs')) {
        const id = stem(name)
        if (name.endsWith('.md') && known.has(id)) ensure(id).doc = `docs/${name}`
    }

    const assets  = (await files('assets')).map((n) => `assets/${n}`)
    const docs    = (await files('docs')).map((n) => `docs/${n}`)
    const samples = (await files('samples')).map((n) => `samples/${n}`)
    return { byClass, assets, docs, samples, warnings }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-bundle.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/library/services/library-bundle.ts src/renderer/src/modules/library/services/tests/library-bundle.test.ts
git commit -m "feat(library): scanResources binds resource files to classes + lists folders"
```

---

## Task 4: Extend `publish` to write the bundle

**Files:**
- Modify: `src/renderer/src/modules/library/services/library-project-factory.ts`
- Test: `src/renderer/src/modules/library/services/tests/library-project-factory.test.ts` (extend)

**Interfaces:**
- Consumes: `collectTaxonomySources` (Task 1), `deriveClasses` / `scanResources` / `LibraryBundleManifest` (Tasks 2–3), existing `resolveBases`, `ensureLibrariesBackend`, `checkAgainst`/`toJSON`/`Severity`.
- Produces: an extended `publish` that writes `model.json`, `library.json`, `src/*.todl`, and copies `visuals/ assets/ docs/ samples/ thumbnails/` under `<id>/<libVersion>/`; returns a `PublishResult` summarizing counts + orphan warnings.

- [ ] **Step 1: Write the failing test**

Append to `src/renderer/src/modules/library/services/tests/library-project-factory.test.ts` (the file already imports `fromJSON, check, toJSON`, `FakeStorage`, `publishEnv`, `seedMeta`, `LIB`, `factory`):

```ts
test('publish writes library.json with the derived classes + resource paths, and copies the folders', async () => {
  const storage = new FakeStorage('fake://Acme')
  const f = factory()
  await f.createProject(storage, 'microsoft', { metaModel: { id: 'ea', version: '5' } })
  await storage.WriteText('microsoft.todl', LIB)
  await storage.WriteText('visuals/microsoft.azure.mural', '<template/>')
  await storage.WriteText('thumbnails/microsoft.azure.png', 'PNGBYTES')
  await storage.WriteText('docs/microsoft.azure.md', '# Azure')
  await storage.WriteText('assets/logo.svg', '<svg/>')
  await storage.WriteText('samples/demo.todl', 'sample instance')

  const { provider, meta, libs } = publishEnv()
  await seedMeta(meta)
  const result = await f.publish(await f.openProject(storage), storage, provider)

  expect(result.ok).toBe(true)

  const bundle = JSON.parse(await libs.ReadText('microsoft/0.1.0/library.json'))
  expect(bundle.id).toBe('microsoft')
  expect(bundle.version).toBe('0.1.0')
  expect(bundle.metaModel).toEqual({ id: 'ea', version: '5' })
  expect(bundle.classes.map((c: { id: string }) => c.id).sort())
      .toEqual(['microsoft.azure', 'microsoft.azure-openai'])
  const azure = bundle.classes.find((c: { id: string }) => c.id === 'microsoft.azure')
  expect(azure).toMatchObject({
      localId: 'azure', label: 'Azure', concept: 'location',
      template: 'visuals/microsoft.azure.mural',
      thumbnail: 'thumbnails/microsoft.azure.png',
      doc: 'docs/microsoft.azure.md',
  })
  expect(bundle.assets).toEqual(['assets/logo.svg'])
  expect(bundle.samples).toEqual(['samples/demo.todl'])

  // Resource folders copied into the bundle.
  expect(await libs.Exists('microsoft/0.1.0/visuals/microsoft.azure.mural')).toBe(true)
  expect(await libs.Exists('microsoft/0.1.0/assets/logo.svg')).toBe(true)
  expect(await libs.Exists('microsoft/0.1.0/samples/demo.todl')).toBe(true)
})

test('samples/*.todl is excluded from the compiled model', async () => {
  const storage = new FakeStorage('fake://Acme')
  const f = factory()
  await f.createProject(storage, 'microsoft', { metaModel: { id: 'ea', version: '5' } })
  await storage.WriteText('microsoft.todl', LIB)
  await storage.WriteText('samples/demo.todl', 'namespace boom { this is not valid todl }')

  const { provider, meta, libs } = publishEnv()
  await seedMeta(meta)
  const result = await f.publish(await f.openProject(storage), storage, provider)

  // Would fail to compile if samples/ were included; it is excluded, so publish succeeds.
  expect(result.ok).toBe(true)
  // The invalid sample is still copied verbatim into the bundle (as a resource).
  expect(await libs.Exists('microsoft/0.1.0/samples/demo.todl')).toBe(true)
})

test('an orphan visual is a non-blocking warning', async () => {
  const storage = new FakeStorage('fake://Acme')
  const f = factory()
  await f.createProject(storage, 'microsoft', { metaModel: { id: 'ea', version: '5' } })
  await storage.WriteText('microsoft.todl', LIB)
  await storage.WriteText('visuals/ghost.mural', '<template/>')

  const { provider, meta } = publishEnv()
  await seedMeta(meta)
  const result = await f.publish(await f.openProject(storage), storage, provider)

  expect(result.ok).toBe(true)
  expect(result.message).toContain('warning')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-project-factory.test.ts`
Expected: FAIL — no `library.json` written (`ReadText` rejects) / `publish` still uses the old flow.

- [ ] **Step 3: Update the imports and `LibraryManifest`**

In `src/renderer/src/modules/library/services/library-project-factory.ts`, change the todl-sources import to bring in the taxonomy collector, add the bundle import, and add a `description?` field to the manifest.

Replace:
```ts
import { collectTodlSources, extname, joinRel } from '../../meta-model/services/todl-sources.js'
```
with:
```ts
import { collectTaxonomySources, extname, joinRel } from '../../meta-model/services/todl-sources.js'
import { deriveClasses, scanResources, type LibraryBundleManifest } from './library-bundle.js'
```

In the `LibraryManifest` interface add the optional description:
```ts
interface LibraryManifest extends ProjectManifestEnvelope
{
    id:          string           // stable publish identity, defaults to slugify(name)
    libVersion:  string           // published version, defaults to '0.1.0'
    metaModel?:  BaseRef          // the meta-model this library is authored against
    description?: string          // optional human description, carried into library.json
}
```

- [ ] **Step 4: Replace the `publish` method body**

Replace the entire existing `publish(...)` method with:

```ts
    // Validate every taxonomy `.todl` (samples/ excluded) against the bound
    // meta-model; if clean, emit model.json + library.json + the sources, and copy
    // the resource folders (visuals/assets/docs/samples/thumbnails) into the
    // libraries backend under `<id>/<libVersion>/`.
    public async publish(_project: Project, storage: IStorage, provider: IServiceProvider): Promise<PublishResult>
    {
        const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as LibraryManifest
        if (manifest.metaModel === undefined)
            return { ok: false, message: 'Set a meta-model binding before publishing.' }

        const { bases, problems } = await resolveBases(provider, { metaModel: manifest.metaModel })
        if (problems.length > 0) return { ok: false, message: `Publish blocked: ${problems.join('; ')}.` }

        const sources = await collectTaxonomySources(storage)
        if (sources.length === 0) return { ok: false, message: 'Nothing to publish — the project has no .todl files.' }

        const { model, diagnostics } = checkAgainst(bases, sources)
        const errors = diagnostics.filter((d) => d.severity === Severity.Error)
        if (errors.length > 0)
            return { ok: false, message: `Publish blocked: ${errors.length} error(s). Fix them first.` }

        const doc = toJSON(model)
        const classes = deriveClasses(doc)
        const scanned = await scanResources(storage, classes.map((c) => c.id))
        for (const c of classes) {
            const r = scanned.byClass.get(c.id)
            if (r?.template) c.template = r.template
            if (r?.thumbnail) c.thumbnail = r.thumbnail
            if (r?.doc) c.doc = r.doc
        }

        const bundle: LibraryBundleManifest = {
            id: manifest.id,
            version: manifest.libVersion,
            name: manifest.name ?? manifest.id,
            ...(manifest.description !== undefined ? { description: manifest.description } : {}),
            metaModel: manifest.metaModel,
            classes,
            assets: scanned.assets,
            docs: scanned.docs,
            samples: scanned.samples,
        }

        const dest = ensureLibrariesBackend(provider)
        const base = `${manifest.id}/${manifest.libVersion}`
        await dest.WriteText(`${base}/model.json`, JSON.stringify(doc, null, 2))
        await dest.WriteText(`${base}/library.json`, JSON.stringify(bundle, null, 2))
        for (const s of sources) await dest.WriteText(`${base}/src/${s.uri}`, s.text)

        let copied = 0
        for (const folder of ['visuals', 'assets', 'docs', 'samples', 'thumbnails'])
            copied += await this.copyResourceFolder(storage, dest, folder, base)

        const warn = scanned.warnings.length > 0
            ? ` (${scanned.warnings.length} warning(s): ${scanned.warnings.join('; ')})`
            : ''
        return {
            ok: true,
            message: `Published ${manifest.id}@${manifest.libVersion} — `
                + `${classes.length} class(es), ${sources.length} source(s), ${copied} resource file(s)${warn}.`,
        }
    }

    // Recursively copy one resource folder from the project storage into the
    // bundle at `<destBase>/<folder>/…`. Text formats (.mural/.md/.todl) copy as
    // text; everything else (images) as bytes. A missing folder lists as empty, so
    // this is a no-op when the project doesn't use that folder.
    private async copyResourceFolder(src: IStorage, dest: IStorage, folder: string, destBase: string): Promise<number>
    {
        let count = 0
        const walk = async (dir: string): Promise<void> => {
            for (const e of await src.List(dir)) {
                const rel = `${dir}/${e.Name}`
                if (e.IsDirectory) { await walk(rel); continue }
                const destPath = `${destBase}/${rel}`
                if (isTextResource(e.Name)) await dest.WriteText(destPath, await src.ReadText(rel))
                else await dest.WriteBytes(destPath, await src.ReadBytes(rel))
                count++
            }
        }
        await walk(folder)
        return count
    }
```

Add this module-level helper near the bottom `// ── helpers ──` section:

```ts
// Text resource formats copy as text; all others (images) as bytes.
function isTextResource(name: string): boolean
{
    const ext = extname(name)
    return ext === '.mural' || ext === '.md' || ext === '.todl'
}
```

- [ ] **Step 5: Run the targeted tests to verify they pass**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-project-factory.test.ts`
Expected: PASS — the 4 original tests plus the 3 new ones.

- [ ] **Step 6: Run the full suite + typecheck**

Run: `npx vitest run`
Expected: all tests pass (existing count + the new files).

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/modules/library/services/library-project-factory.ts src/renderer/src/modules/library/services/tests/library-project-factory.test.ts
git commit -m "feat(library): publish emits library.json bundle + copies resource folders"
```

---

## Definition of done

- `LibraryProjectFactory.publish` writes `model.json`, `library.json`, `src/*.todl`, and copies `visuals/ assets/ docs/ samples/ thumbnails/` into `<userData>/libraries/<id>/<libVersion>/`.
- `library.json` lists the derived classes (Instance-tier clabjects) with per-class `template`/`thumbnail`/`doc` paths and the `assets`/`docs`/`samples` file lists.
- `samples/` is excluded from the compile; orphan visuals warn but don't block.
- Full Vitest suite green; `npm run typecheck` clean.
- The three existing `library-project-factory` publish tests still pass unchanged.

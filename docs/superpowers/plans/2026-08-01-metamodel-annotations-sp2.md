# Meta-Model Annotations SP2 (Plexus projection + manifest) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the annotations SP1 compiled into `model.json` consumable in Plexus — a bindable `Annotations` bag on `MetaModelEntity`, and a `manifest.json` package descriptor written at publish and read back by a thin loader.

**Architecture:** One shared pure helper (`projectAnnotations`) walks the `Annotated` graph edges out of a target node. The concept path feeds it into a new `Annotations` property on `MetaModelEntity` inside the existing `buildEntity` projection; the package path feeds it into a `manifest.json` written during publish and read by a never-throws loader mirroring `library.json` / `library-loader`. No canvas/instance code is touched; no TODL/emit changes.

**Tech Stack:** TypeScript (strict ESM), `@pragmatic-lab/mural/runtime` (`Model`/`RegisterProperty`), `@pragmatic-lab/todl` (`TodlDocument` type only), Vitest.

## Global Constraints

- Plexus consumes `@pragmatic-lab/todl` **0.5.0** (already bumped in `7d466a5`) — no further TODL/emit changes; SP2 is pure consumption of the compiled `model.json`.
- **Wire-string constants, not TODL enum imports.** Consume serialized values via local named constants (as `meta-model-entity-builder.ts` does with `const HAS_FIELD = 'HasField'`). Exact values: annotation edge kind `'Annotated'`, package node id `'package'`, provenance attr `'namespace'`.
- **Bag shape is a nested `Record`:** `Record<string, Record<string, unknown>>`, keyed by annotation name → its scalar param values, with the `namespace` provenance attr stripped.
- **Loader never throws:** a malformed/missing manifest returns a safe default (`name: id`, `annotations: {}`) plus one error problem.
- Every test file lives in a `tests/` subfolder next to its source (Vitest globs `src/**/*.test.ts`).
- Run a single test file with `npx vitest run <path>`; the whole suite with `npm test`.
- Do not touch the `$Type` canvas instance hop or any template that reads annotations (SP3). No non-scalar param handling.

## File Structure

- **Create** `src/renderer/src/modules/meta-model/services/annotation-projection.ts` — the pure `projectAnnotations(doc, targetId)` helper. Sole responsibility: the `Annotated`-edge graph walk. Consumed by the entity builder (concept) and the publish path (package).
- **Modify** `src/renderer/src/modules/meta-model/services/meta-model-entity.ts` — add the `Annotations` registered property to `MetaModelEntity`.
- **Modify** `src/renderer/src/modules/meta-model/services/meta-model-entity-builder.ts` — populate `entity.Annotations` via the helper.
- **Create** `src/renderer/src/modules/meta-model/services/meta-model-manifest-loader.ts` — the `MetaModelManifestFile` type + `loadMetaModelManifest`. Sole responsibility: the published package descriptor's shape and its never-throws read.
- **Modify** `src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts` — write `manifest.json` in `publish()`.
- **Test** files alongside each in `tests/` subfolders.

---

### Task 1: `projectAnnotations` — the shared graph-walk helper

**Files:**
- Create: `src/renderer/src/modules/meta-model/services/annotation-projection.ts`
- Test: `src/renderer/src/modules/meta-model/services/tests/annotation-projection.test.ts`

**Interfaces:**
- Consumes: `TodlDocument` (type only) from `@pragmatic-lab/todl` — `{ nodes: Array<{ id: string; tier: string; typeOf: string; attrs: Record<string, unknown> }>; edges: Array<{ kind: string; via: string | null; from: string; to: string }> }`.
- Produces: `export function projectAnnotations(doc: TodlDocument, targetId: string): Record<string, Record<string, unknown>>` — used by Tasks 2 and 4.

- [ ] **Step 1: Write the failing test**

Create `tests/annotation-projection.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-lab/todl'
import { projectAnnotations } from '../annotation-projection.js'

const doc: TodlDocument = {
  nodes: [
    { id: 'actor',          tier: 'Ontology', typeOf: 'concept',  attrs: { label: 'Human Actor' } },
    { id: 'actor@icon',     tier: 'Ontology', typeOf: 'icon',     attrs: { path: 'icons/actor.svg', namespace: 'acme' } },
    { id: 'actor@category', tier: 'Ontology', typeOf: 'category', attrs: { name: 'actors', order: 1, namespace: 'acme' } },
    { id: 'bare',           tier: 'Ontology', typeOf: 'concept',  attrs: {} },
    { id: 'package',        tier: 'Ontology', typeOf: 'package',  attrs: {} },
    { id: 'package@author', tier: 'Ontology', typeOf: 'author',   attrs: { name: 'Acme Corp', namespace: 'acme' } },
  ],
  edges: [
    { kind: 'Annotated', via: null, from: 'actor',   to: 'actor@icon' },
    { kind: 'Annotated', via: null, from: 'actor',   to: 'actor@category' },
    { kind: 'Annotated', via: null, from: 'actor',   to: 'missing@ghost' }, // dangling → skipped
    { kind: 'Annotated', via: null, from: 'package', to: 'package@author' },
    { kind: 'HasField',  via: null, from: 'actor',   to: 'actor.name' },    // non-annotation edge ignored
  ],
} as unknown as TodlDocument

describe('projectAnnotations', () => {
  it('keys annotations by name and strips the namespace provenance attr', () => {
    expect(projectAnnotations(doc, 'actor')).toEqual({
      icon: { path: 'icons/actor.svg' },
      category: { name: 'actors', order: 1 },
    })
  })
  it('returns {} for a target with no annotations', () => {
    expect(projectAnnotations(doc, 'bare')).toEqual({})
  })
  it('projects the package node annotations the same way', () => {
    expect(projectAnnotations(doc, 'package')).toEqual({ author: { name: 'Acme Corp' } })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/annotation-projection.test.ts`
Expected: FAIL — cannot resolve `../annotation-projection.js` / `projectAnnotations` is not a function.

- [ ] **Step 3: Write the implementation**

Create `annotation-projection.ts`:

```ts
// annotation-projection.ts — project a target node's annotations from a compiled
// model.json. Walk the `Annotated` edges out of `targetId` to its `<target>@<Ann>`
// application nodes; key each by the application's `typeOf` (the annotation name);
// value = the application's scalar param attrs with the `namespace` provenance
// stamp removed. A target with no annotations → {}. Pure; no I/O. Shared by the
// concept path (buildEntity) and the package path (publish's manifest write).
import type { TodlDocument } from '@pragmatic-lab/todl'

const ANNOTATED = 'Annotated'
const NAMESPACE_ATTR = 'namespace'

export function projectAnnotations(
    doc: TodlDocument,
    targetId: string,
): Record<string, Record<string, unknown>>
{
    const out: Record<string, Record<string, unknown>> = {}
    for (const edge of doc.edges) {
        if (edge.kind !== ANNOTATED || edge.from !== targetId) continue
        const appNode = doc.nodes.find((n) => n.id === edge.to)
        if (appNode === undefined) continue
        const params: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(appNode.attrs as Record<string, unknown>)) {
            if (k === NAMESPACE_ATTR) continue
            params[k] = v
        }
        out[appNode.typeOf] = params
    }
    return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/annotation-projection.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/annotation-projection.ts \
        src/renderer/src/modules/meta-model/services/tests/annotation-projection.test.ts
git commit -m "feat: projectAnnotations helper — walk Annotated edges to a nested Record"
```

---

### Task 2: `MetaModelEntity.Annotations` + `buildEntity` projection

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/meta-model-entity.ts:33-54`
- Modify: `src/renderer/src/modules/meta-model/services/meta-model-entity-builder.ts:1-34`
- Test: `src/renderer/src/modules/meta-model/services/tests/meta-model-entity-builder.test.ts`

**Interfaces:**
- Consumes: `projectAnnotations(doc, targetId)` from Task 1.
- Produces: `MetaModelEntity.Annotations: Record<string, Record<string, unknown>>` (get/set), populated by `buildEntity`. The drawer and generated presentation bind to it as `$Annotations.<ann>.<param>`.

- [ ] **Step 1: Write the failing test**

Append to `tests/meta-model-entity-builder.test.ts` (inside the existing `describe('buildEntity', …)` block, after the last `it`):

```ts
  it('projects a concept\'s annotations into a nested Annotations bag, stripping namespace', () => {
    const annotated: TodlDocument = {
      nodes: [
        { id: 'actor',      tier: 'Ontology', typeOf: 'concept',  attrs: { label: 'Human Actor' } },
        { id: 'actor@icon', tier: 'Ontology', typeOf: 'icon',     attrs: { path: 'icons/actor.svg', namespace: 'acme' } },
        { id: 'plain',      tier: 'Ontology', typeOf: 'concept',  attrs: {} },
      ],
      edges: [
        { kind: 'Annotated', via: null, from: 'actor', to: 'actor@icon' },
      ],
    } as unknown as TodlDocument

    expect(buildEntity(annotated, 'actor').Annotations).toEqual({ icon: { path: 'icons/actor.svg' } })
    expect(buildEntity(annotated, 'plain').Annotations).toEqual({})
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-entity-builder.test.ts`
Expected: FAIL — `.Annotations` is `undefined` (property not yet registered / not populated).

- [ ] **Step 3: Add the `Annotations` property to `MetaModelEntity`**

In `meta-model-entity.ts`, after the `PresentationKey` declaration (line 38-39) add a new key, and after the `Presentation` get/set (line 56-57) add the accessors:

```ts
    public static readonly AnnotationsKey = Model.RegisterProperty<Record<string, Record<string, unknown>>>(
        MetaModelEntity, 'Annotations', {}, MetaData.None)
```

```ts
    public get Annotations(): Record<string, Record<string, unknown>> { return this.get_property_value(MetaModelEntity.AnnotationsKey) }
    public set Annotations(v: Record<string, Record<string, unknown>>) { this.set_property_value(MetaModelEntity.AnnotationsKey, v) }
```

- [ ] **Step 4: Populate it in `buildEntity`**

In `meta-model-entity-builder.ts`, add the import (after line 8):

```ts
import { projectAnnotations } from './annotation-projection.js'
```

and, immediately before `return entity` (after the `HasField` loop, line 33), add:

```ts
    entity.Annotations = projectAnnotations(doc, entityId)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-entity-builder.test.ts`
Expected: PASS (the two existing `it`s plus the new one).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/meta-model-entity.ts \
        src/renderer/src/modules/meta-model/services/meta-model-entity-builder.ts \
        src/renderer/src/modules/meta-model/services/tests/meta-model-entity-builder.test.ts
git commit -m "feat: project concept annotations into MetaModelEntity.Annotations"
```

---

### Task 3: `manifest.json` shape + never-throws loader

**Files:**
- Create: `src/renderer/src/modules/meta-model/services/meta-model-manifest-loader.ts`
- Test: `src/renderer/src/modules/meta-model/services/tests/meta-model-manifest-loader.test.ts`

**Interfaces:**
- Consumes: `IStorage` from `../../../services/storage/storage.js` (`ReadText(path): Promise<string>`, rejects on missing); `FakeStorage` from `../../../../services/storage/tests/fake-storage.js` for the test.
- Produces:
  - `export interface MetaModelManifestFile { id: string; version: string; name: string; description?: string; annotations: Record<string, Record<string, unknown>> }` — imported by Task 4.
  - `export interface ManifestProblem { uri: string | null; message: string; severity: 'error' | 'warning' }`
  - `export interface LoadedMetaModelManifest extends MetaModelManifestFile { problems: ManifestProblem[] }`
  - `export async function loadMetaModelManifest(backend: IStorage, id: string, version: string): Promise<LoadedMetaModelManifest>` — used by Task 4's test.

- [ ] **Step 1: Write the failing test**

Create `tests/meta-model-manifest-loader.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { loadMetaModelManifest } from '../meta-model-manifest-loader.js'

describe('loadMetaModelManifest', () => {
  it('round-trips a written manifest', async () => {
    const backend = new FakeStorage('fake://meta-models')
    const file = { id: 'ea', version: '0.1.0', name: 'EA', annotations: { author: { name: 'Acme' } } }
    await backend.WriteText('ea/0.1.0/manifest.json', JSON.stringify(file))

    const loaded = await loadMetaModelManifest(backend, 'ea', '0.1.0')
    expect(loaded.id).toBe('ea')
    expect(loaded.version).toBe('0.1.0')
    expect(loaded.name).toBe('EA')
    expect(loaded.annotations).toEqual({ author: { name: 'Acme' } })
    expect(loaded.problems).toEqual([])
  })

  it('returns a safe default with an error problem on malformed JSON', async () => {
    const backend = new FakeStorage('fake://meta-models')
    await backend.WriteText('ea/0.1.0/manifest.json', '{ not json')

    const loaded = await loadMetaModelManifest(backend, 'ea', '0.1.0')
    expect(loaded.name).toBe('ea')            // safe default = id
    expect(loaded.annotations).toEqual({})
    expect(loaded.problems.length).toBe(1)
    expect(loaded.problems[0]!.severity).toBe('error')
  })

  it('returns a safe default when the manifest file is missing', async () => {
    const backend = new FakeStorage('fake://meta-models')
    const loaded = await loadMetaModelManifest(backend, 'ea', '0.1.0')
    expect(loaded.name).toBe('ea')
    expect(loaded.annotations).toEqual({})
    expect(loaded.problems.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-manifest-loader.test.ts`
Expected: FAIL — cannot resolve `../meta-model-manifest-loader.js`.

- [ ] **Step 3: Write the implementation**

Create `meta-model-manifest-loader.ts`:

```ts
// meta-model-manifest-loader.ts — the published meta-model package descriptor and
// its never-throws read. manifest.json is a DISTINCT artifact from the project's
// on-disk envelope (project.plexus / MetaModelManifest); it mirrors library.json:
// identity plus the package-level annotations projected from the model graph, so
// Plexus can understand a package without parsing model.json.
import type { IStorage } from '../../../services/storage/storage.js'

export interface MetaModelManifestFile
{
    id:           string
    version:      string
    name:         string
    description?: string
    annotations:  Record<string, Record<string, unknown>>
}

// Local copy of library-loader's LoadProblem, so this module does not depend on
// the library module.
export interface ManifestProblem { uri: string | null; message: string; severity: 'error' | 'warning' }

export interface LoadedMetaModelManifest extends MetaModelManifestFile
{
    problems: ManifestProblem[]
}

// Load a published meta-model's manifest.json. A malformed or unreadable manifest
// yields a safe default (name = id, no annotations) plus one error problem — never
// throws, mirroring library-loader's loadLibrary.
export async function loadMetaModelManifest(
    backend: IStorage, id: string, version: string,
): Promise<LoadedMetaModelManifest>
{
    const base = `${id}/${version}`
    let file: MetaModelManifestFile
    try {
        file = JSON.parse(await backend.ReadText(`${base}/manifest.json`))
    } catch (e) {
        return {
            id, version, name: id, annotations: {},
            problems: [{ severity: 'error', uri: 'manifest.json',
                         message: `Meta-model manifest is invalid: ${(e as Error).message}` }],
        }
    }
    const loaded: LoadedMetaModelManifest = {
        id: file.id, version: file.version, name: file.name,
        annotations: file.annotations ?? {}, problems: [],
    }
    if (file.description !== undefined) loaded.description = file.description
    return loaded
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-manifest-loader.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/meta-model-manifest-loader.ts \
        src/renderer/src/modules/meta-model/services/tests/meta-model-manifest-loader.test.ts
git commit -m "feat: meta-model manifest shape + never-throws loader"
```

---

### Task 4: Write `manifest.json` at publish

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts:1-19,90-117`
- Test: `src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts`

**Interfaces:**
- Consumes: `projectAnnotations(doc, 'package')` from Task 1; `MetaModelManifestFile` type + `loadMetaModelManifest` from Task 3; the existing `publish(project, storage, provider)` flow (writes `model.json` then `src/…` under `<id>/<modelVersion>/` in the meta-models backend `dest`).
- Produces: a `<id>/<modelVersion>/manifest.json` file next to `model.json`, carrying identity + package annotations.

- [ ] **Step 1: Write the failing test**

In `tests/meta-model-project-factory.test.ts`, add an import at the top (next to the existing imports):

```ts
import { loadMetaModelManifest } from '../meta-model-manifest-loader.js'
```

Add a module-level fixture next to the existing `CONCEPTS` / `EA` / `BAD` consts:

```ts
// A clean package with a declared annotation applied at package level (0.5.0).
const PKG_ANN = 'namespace d { annotation author { name : string; } package { annotate author { name = "Acme Corp"; } } concept widget { label : string; } }'
```

Add the test (after the existing `'publish writes compiled model + sources for a clean project'` test):

```ts
test('publish writes a manifest.json with identity + package annotations', async () => {
    const storage = new FakeStorage('fake://Acme')
    const f = factory()
    await f.createProject(storage, 'Acme')
    await storage.WriteText('defs.todl', PKG_ANN)

    const { provider, dest } = publishEnv()
    const project = await f.openProject(storage)
    const result = await f.publish(project, storage, provider)

    expect(result.ok).toBe(true)
    expect(await dest.Exists('acme/0.1.0/manifest.json')).toBe(true)

    const m = await loadMetaModelManifest(dest, 'acme', '0.1.0')
    expect(m.id).toBe('acme')
    expect(m.version).toBe('0.1.0')
    expect(m.name).toBe('Acme')
    expect(m.annotations).toEqual({ author: { name: 'Acme Corp' } })
    expect(m.problems).toEqual([])
})

test('publish writes a manifest with empty annotations for a package-less model', async () => {
    const storage = new FakeStorage('fake://Acme')
    const f = factory()
    await f.createProject(storage, 'Acme')
    await storage.WriteText('concepts.todl', CONCEPTS)
    await storage.WriteText('ea.todl', EA)

    const { provider, dest } = publishEnv()
    const project = await f.openProject(storage)
    await f.publish(project, storage, provider)

    const m = await loadMetaModelManifest(dest, 'acme', '0.1.0')
    expect(m.annotations).toEqual({})
    expect(m.problems).toEqual([])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts`
Expected: FAIL — `acme/0.1.0/manifest.json` does not exist (publish does not yet write it).

- [ ] **Step 3: Add the imports to the factory**

In `meta-model-project-factory.ts`, add to the imports (after line 19, the `publishPresentation` import):

```ts
import { projectAnnotations } from './annotation-projection.js'
import type { MetaModelManifestFile } from './meta-model-manifest-loader.js'
```

- [ ] **Step 4: Write the manifest in `publish()`**

In `publish()`, immediately after the source-copy loop (line 105, `for (const s of sources) await dest.WriteText(\`${base}/src/${s.uri}\`, s.text)`) insert:

```ts
        // Ship a thin package descriptor (identity + package-level annotations)
        // so Plexus can understand the package without parsing model.json.
        const PACKAGE_NODE = 'package'
        const manifestFile: MetaModelManifestFile = {
            id: manifest.id, version: manifest.modelVersion, name: manifest.name ?? manifest.id,
            annotations: projectAnnotations(doc, PACKAGE_NODE),
        }
        await dest.WriteText(`${base}/manifest.json`, JSON.stringify(manifestFile, null, 2))
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts`
Expected: PASS (all existing tests plus the two new ones). In particular, `'publish is blocked … writes nothing'` must still pass (`dest.size === 0`) — the manifest write sits after the error gate, so a blocked publish writes nothing.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts \
        src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts
git commit -m "feat: write meta-model manifest.json (identity + package annotations) at publish"
```

---

### Task 5: Full-suite + typecheck verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS — no regressions in the meta-model module or elsewhere.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` (if absent, `npx tsc -p tsconfig.json --noEmit`)
Expected: clean — the new `Annotations` property, the helper, the loader, and the factory import all type-check.

- [ ] **Step 3: Finish the branch**

Announce and use **superpowers:finishing-a-development-branch** to verify tests, present the merge/PR/keep options, and clean up.

---

## Self-Review

**Spec coverage:**
- §1.1 concept `Annotations` bag → Tasks 1 + 2. ✓
- §1.2 `manifest.json` write + loader → Tasks 3 (loader) + 4 (write). ✓
- §3.A shared `projectAnnotations` helper → Task 1. ✓
- §3.B `MetaModelEntity.Annotations` property → Task 2. ✓
- §3.C `buildEntity` one-line projection → Task 2. ✓
- §3.D `MetaModelManifestFile` + write at publish → Tasks 3 (type) + 4 (write). ✓
- §3.E `loadMetaModelManifest` never-throws loader → Task 3. ✓
- §5 error handling (dangling edge skipped, malformed manifest safe default, blocked-publish writes nothing) → Task 1 dangling test, Task 3 malformed/missing tests, Task 4 note in Step 5. ✓
- §6 testing (projection, entity-builder, loader) → Tasks 1–4 tests. ✓
- §2 out-of-scope ($Type hop, non-scalar) → not implemented; Global Constraints forbids. ✓

**Placeholder scan:** No TBD/TODO; every code step carries real code and a concrete run/assert. ✓

**Type consistency:** `projectAnnotations(doc, targetId): Record<string, Record<string, unknown>>` used identically in Tasks 1, 2, 4. `MetaModelManifestFile` fields (`id`/`version`/`name`/`description?`/`annotations`) declared in Task 3 and populated in Task 4 (`version: manifest.modelVersion`). `Annotations` property name matches across entity, builder, and tests. Wire-string constants (`'Annotated'`, `'package'`, `'namespace'`) consistent. ✓

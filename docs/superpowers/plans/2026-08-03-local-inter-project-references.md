# Local Inter-Project References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a producer project (meta-model or library) is open, a consuming project resolves that base from the producer's live-compiled saved source instead of the published registry — no publish round-trip while co-editing.

**Architecture:** A new `WorkspaceBaseResolver` service owns the rule "prefer an open sibling producer's live-compiled document; else read the published artifact." Authoring/validation base-resolution routes through it (`TodlLanguageClient.basesFor`, `ArchDiagramDocumentFactory.openFile`); publish stays strict (published-only). Producer factories gain a `compileToDocument` capability — the same compile pipeline publish uses — that the resolver invokes for open siblings. Reactivity refreshes a producer's transitive dependents on its save (Signal A, via `ProjectExplorerService.RefreshProjects`) and on open/close (Signal B, via the resolver's `OpenProjects` subscription).

**Tech Stack:** Plexus renderer — TypeScript (ESM, strict), mural runtime (`ServiceBase`, `ServiceKey`, `ObservableCollection`), vitest. `@pragmatic-tech-ai/todl` (`check`, `checkAgainst`, `toJSON`, `Severity`, `TodlDocument`). Design doc: `docs/superpowers/specs/2026-08-03-local-inter-project-references-design.md`.

## Global Constraints

- Real TypeScript enums, never string-literal / template-literal union types.
- Every test file lives in a `tests/` subfolder next to its source.
- **Pipeline parity:** local resolution runs the same compile code publish runs (via `compileToDocument`) — no divergent compile logic.
- **Publish stays strict:** `publish()` resolves bases from the published registry only (`resolveBases`), never from open siblings.
- **Match by `id`, ignore version;** kind must match (`metaModel` → meta-model producer, `libraries` entry → library producer); a project never resolves against itself.
- **Saved-on-disk only:** compilation reads `collectTodlSources` / `collectTaxonomySources` (last-saved files), not editor buffers.
- TODL (`@pragmatic-tech-ai/todl`) is unchanged — this is entirely Plexus-side.
- Presentation (icons/geometry, library `library.json` bundles) is out of scope; local resolution covers only the base `TodlDocument` (`model.json` equivalent).

---

### Task 1: Producer capability + `compileToDocument`

Extract each producer factory's "collect sources → compile → toJSON" core into a reusable `compileToDocument`, used by both `publish()` (strict bases) and (later) the resolver (workspace bases). Add the `IProducerProjectFactory` capability + `isProducer` guard mirroring the existing `IPublishableProjectFactory` / `isPublishable` pattern.

**Files:**
- Modify: `src/renderer/src/services/projects/project-factory.ts` (add capability + guard + `ProducerKind` enum)
- Modify: `src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts`
- Modify: `src/renderer/src/modules/library/services/library-project-factory.ts`
- Test: `src/renderer/src/modules/meta-model/services/tests/meta-model-compile-to-document.test.ts` (create)
- Test: `src/renderer/src/modules/library/services/tests/library-compile-to-document.test.ts` (create)

**Interfaces:**
- Produces: `enum ProducerKind { MetaModel = 'meta-model', Library = 'library' }`; `interface IProducerProjectFactory { readonly producerKind: ProducerKind; compileToDocument(storage: IStorage, bases: TodlDocument[], provider: IServiceProvider): Promise<{ doc: TodlDocument; problems: string[] }> }`; `function isProducer(factory: IProjectFactory): factory is IProjectFactory & IProducerProjectFactory`. Consumed by Task 2.

- [ ] **Step 1: Add the capability to `project-factory.ts`.** Append after `canGeneratePresentation` (end of file), and add the `TodlDocument` type import at the top:

In the imports block at the top of `project-factory.ts`, add:

```ts
import type { TodlDocument } from '@pragmatic-tech-ai/todl'
```

Append at end of file:

```ts
// The producer kinds — a project type that publishes a base other projects
// consume. Values match the corresponding factory `ProjectType` strings.
export enum ProducerKind
{
    MetaModel = 'meta-model',
    Library   = 'library',
}

// Optional capability a producer factory (meta-model, library) implements:
// compile the project's sources into its base TodlDocument — exactly as publish
// would, given already-resolved bases. `problems` carries compile-error messages
// so callers decide whether to block (publish) or surface (the workspace
// resolver). Publish and the WorkspaceBaseResolver share this one pipeline.
export interface IProducerProjectFactory
{
    readonly producerKind: ProducerKind
    compileToDocument(
        storage: IStorage,
        bases: TodlDocument[],
        provider: IServiceProvider,
    ): Promise<{ doc: TodlDocument; problems: string[] }>
}

// Type guard: does this factory produce a consumable base?
export function isProducer(factory: IProjectFactory): factory is IProjectFactory & IProducerProjectFactory
{
    return typeof (factory as Partial<IProducerProjectFactory>).compileToDocument === 'function'
}
```

- [ ] **Step 2: Write the failing test** `src/renderer/src/modules/meta-model/services/tests/meta-model-compile-to-document.test.ts`:

```ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { PROJECT_MANIFEST_FILENAME } from '../../../../services/projects/project-factory.js'
import { MetaModelProjectFactory } from '../meta-model-project-factory.js'

async function project(text: string): Promise<FakeStorage>
{
    const s = new FakeStorage('C:/mm')
    await s.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'meta-model', id: 'ea', modelVersion: '0.1.0' }))
    await s.WriteText('concepts.todl', text)
    return s
}

test('compileToDocument returns a document with the compiled nodes and no problems', async () => {
    const factory = new MetaModelProjectFactory(new ServiceProvider())
    const storage = await project('namespace d { concept location { label : string; } }')
    const { doc, problems } = await factory.compileToDocument(storage, [], new ServiceProvider())
    expect(problems).toEqual([])
    expect(doc.nodes.some((n) => n.id === 'location')).toBe(true)
})

test('compileToDocument reports compile errors as problems', async () => {
    const factory = new MetaModelProjectFactory(new ServiceProvider())
    // `ghost` is an undefined supertype → a TODL error.
    const storage = await project('namespace d { concept location : ghost { label : string; } }')
    const { problems } = await factory.compileToDocument(storage, [], new ServiceProvider())
    expect(problems.length).toBeGreaterThan(0)
})
```

- [ ] **Step 3: Run it to confirm it fails** — `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-compile-to-document.test.ts`. Expected: FAIL, `compileToDocument is not a function`.

- [ ] **Step 4: Implement `compileToDocument` on `MetaModelProjectFactory`.** Change the top import from `check` to also import `checkAgainst`, and implement the capability. In `meta-model-project-factory.ts`:

Change:
```ts
import { check, toJSON, Severity, type TodlDocument } from '@pragmatic-tech-ai/todl'
```
to:
```ts
import { check, checkAgainst, toJSON, Severity, type TodlDocument } from '@pragmatic-tech-ai/todl'
```

Add `ProducerKind`, `IProducerProjectFactory` to the `project-factory.js` import list, and add `IProducerProjectFactory` to the `implements` clause:
```ts
export class MetaModelProjectFactory extends ServiceBase
    implements IProjectFactory, IPublishableProjectFactory, IPresentationProjectFactory, IProducerProjectFactory
```

Add the member (place it just above `publish`):
```ts
    public readonly producerKind = ProducerKind.MetaModel

    // Compile every `.todl` into the base document, exactly as publish does.
    // A meta-model has no bases of its own, so callers pass `bases` (usually []).
    public async compileToDocument(
        storage: IStorage,
        bases: TodlDocument[],
        _provider: IServiceProvider,
    ): Promise<{ doc: TodlDocument; problems: string[] }>
    {
        const sources = await collectTodlSources(storage)
        const { model, diagnostics } = checkAgainst(bases, sources)
        const problems = diagnostics
            .filter((d) => d.severity === Severity.Error)
            .map((d) => d.message)
        return { doc: toJSON(model), problems }
    }
```

- [ ] **Step 5: Refactor meta-model `publish` to reuse it.** Replace the compile block in `publish` (the `check(sources)` + errors-filter + `toJSON(model)` lines) so publish shares the same pipeline. Change:
```ts
        const { model, diagnostics } = check(sources)
        const errors = diagnostics.filter((d) => d.severity === Severity.Error)
        if (errors.length > 0)
            return { ok: false, message: `Publish blocked: ${errors.length} error(s). Fix them first.` }

        const doc = toJSON(model)
```
to:
```ts
        const { doc, problems } = await this.compileToDocument(storage, [], provider)
        if (problems.length > 0)
            return { ok: false, message: `Publish blocked: ${problems.length} error(s). Fix them first.` }
```
(The unused `check` import can stay or be removed; if TypeScript/lint flags it as unused, remove `check` from the import.)

- [ ] **Step 6: Run the meta-model test to confirm it passes** — `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-compile-to-document.test.ts`. Expected: PASS.

- [ ] **Step 7: Write the failing library test** `src/renderer/src/modules/library/services/tests/library-compile-to-document.test.ts`:

```ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { check, toJSON } from '@pragmatic-tech-ai/todl'

import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { PROJECT_MANIFEST_FILENAME } from '../../../../services/projects/project-factory.js'
import { LibraryProjectFactory } from '../library-project-factory.js'

// The base meta-model defines `category`; the library extends it.
const META = 'namespace ea { concept category { label : string; } }'

async function libraryProject(text: string): Promise<FakeStorage>
{
    const s = new FakeStorage('C:/lib')
    await s.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(
        { type: 'library', id: 'acme', libVersion: '0.1.0', metaModel: { id: 'ea', version: '0.1.0' } }))
    await s.WriteText('terms.todl', text)
    return s
}

// A library source that extends a base concept — resolves only when the base is present.
const LIB = 'namespace acme { concept special : category { label : string; } }'

test('compileToDocument compiles the library sources against the given base', async () => {
    const factory = new LibraryProjectFactory(new ServiceProvider())
    const base = toJSON(check([{ uri: 'ea.todl', text: META }]).model)
    const storage = await libraryProject(LIB)
    const { doc, problems } = await factory.compileToDocument(storage, [base], new ServiceProvider())
    expect(problems).toEqual([])
    expect(doc.nodes.some((n) => n.id === 'special')).toBe(true)
})

test('compileToDocument reports errors when the base is absent (extends is unresolved)', async () => {
    const factory = new LibraryProjectFactory(new ServiceProvider())
    const storage = await libraryProject(LIB)
    const { problems } = await factory.compileToDocument(storage, [], new ServiceProvider())
    expect(problems.length).toBeGreaterThan(0)
})
```

Note: `collectTaxonomySources` may scope which files it reads (it excludes `samples/`). `terms.todl` at the project root is included; if the test shows zero sources, move the file out of any excluded folder (it is already at root, so this should be fine).

- [ ] **Step 8: Run it to confirm it fails** — `npx vitest run src/renderer/src/modules/library/services/tests/library-compile-to-document.test.ts`. Expected: FAIL, `compileToDocument is not a function`.

- [ ] **Step 9: Implement `compileToDocument` on `LibraryProjectFactory`.** In `library-project-factory.ts` add `ProducerKind`, `IProducerProjectFactory`, and `type TodlDocument` to imports (the `@pragmatic-tech-ai/todl` import already has `checkAgainst, toJSON, Severity` — add `type TodlDocument`). Add `IProducerProjectFactory` to `implements`. Add the member above `publish`:

```ts
    public readonly producerKind = ProducerKind.Library

    // Compile the taxonomy sources (samples/ excluded) against the given bases,
    // exactly as publish does. `bases` is the resolved meta-model (+ any libs).
    public async compileToDocument(
        storage: IStorage,
        bases: TodlDocument[],
        _provider: IServiceProvider,
    ): Promise<{ doc: TodlDocument; problems: string[] }>
    {
        const sources = await collectTaxonomySources(storage)
        const { model, diagnostics } = checkAgainst(bases, sources)
        const problems = diagnostics
            .filter((d) => d.severity === Severity.Error)
            .map((d) => d.message)
        return { doc: toJSON(model), problems }
    }
```

- [ ] **Step 10: Refactor library `publish` to reuse it.** Replace the compile block in library `publish`:
```ts
        const { model, diagnostics } = checkAgainst(bases, sources)
        const errors = diagnostics.filter((d) => d.severity === Severity.Error)
        if (errors.length > 0)
            return { ok: false, message: `Publish blocked: ${errors.length} error(s). Fix them first.` }

        const doc = toJSON(model)
```
with:
```ts
        const { doc, problems: compileProblems } = await this.compileToDocument(storage, bases, provider)
        if (compileProblems.length > 0)
            return { ok: false, message: `Publish blocked: ${compileProblems.length} error(s). Fix them first.` }
```
(`sources` is still collected above for the `src/` copy + count; leave that. If `checkAgainst`/`Severity` become unused in the file after this, leave them — `checkAgainst` is now used by `compileToDocument`; remove `Severity` only if the compiler flags it unused.)

- [ ] **Step 11: Run both new tests + the existing factory tests** — `npx vitest run src/renderer/src/modules/meta-model src/renderer/src/modules/library`. Expected: all PASS (publish behavior unchanged).

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(projects): compileToDocument producer capability, shared by publish"
```

---

### Task 2: `WorkspaceBaseResolver` — local-first base resolution

The service that resolves a consumer's bases, preferring an open producer's live-compiled document over the published artifact. Recursive (a producer's own bases resolve through the same path), cycle-guarded, self-excluding. No caller rewiring yet — that is Task 3.

**Files:**
- Create: `src/renderer/src/services/projects/workspace-base-resolver.ts`
- Modify: `src/renderer/src/app.mu` (register the service)
- Modify: `src/renderer/src/main.js` (eagerly resolve so its `OpenProjects` subscription is live before session restore)
- Test: `src/renderer/src/services/projects/tests/workspace-base-resolver.test.ts` (create)

**Interfaces:**
- Consumes: `ProducerKind`, `isProducer`, `IProducerProjectFactory.compileToDocument` (Task 1); `ProjectExplorerService.OpenProjects` (`ObservableCollection<OpenProject>`); `OpenProject.Storage` / `.Factory`; `ensureMetaModelsBackend` / `ensureLibrariesBackend`; `PROJECT_MANIFEST_FILENAME`; `BaseRef`.
- Produces: `class WorkspaceBaseResolver` with `static readonly Key`; `ResolveForStorage(consumerStorage: IStorage): Promise<{ bases: TodlDocument[]; problems: string[] }>`; `producedIdOf(storage): string | undefined`; `dependentsOf(id: string): OpenProject[]`; `RefreshDependentsOfIds(ids: readonly string[]): Promise<void>` (used by Task 4). Consumed by Tasks 3 and 4.

- [ ] **Step 1: Write the failing test** `src/renderer/src/services/projects/tests/workspace-base-resolver.test.ts`:

```ts
import { test, expect } from 'vitest'
import { ServiceProvider, ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'
import { check, toJSON, type TodlDocument } from '@pragmatic-tech-ai/todl'

import { StorageProviderRegistry } from '../../storage/storage-provider-registry.js'
import { FakeStorage } from '../../storage/tests/fake-storage.js'
import { META_MODELS_BACKEND_ID } from '../../../modules/meta-model/services/meta-models-backend.js'
import { LIBRARIES_BACKEND_ID } from '../../../modules/library/services/libraries-backend.js'
import { ProjectExplorerService } from '../../../modules/project-explorer/services/project-explorer-service.js'
import { PROJECT_MANIFEST_FILENAME, ProducerKind, type IProjectFactory, type IProducerProjectFactory } from '../project-factory.js'
import { Project, ProjectNode } from '../project.js'
import { OpenProject } from '../open-project.js'
import { WorkspaceBaseResolver } from '../workspace-base-resolver.js'

// A producer factory whose compileToDocument returns a canned document built
// from the given TODL text, so the test controls the "live" output.
function producer(kind: ProducerKind, text: string): IProjectFactory & IProducerProjectFactory
{
    return {
        formats: [],
        producerKind: kind,
        compileToDocument: async (_s, bases) => ({
            doc: toJSON(check([{ uri: 'p.todl', text }]).model),
            problems: [],
        }),
    } as unknown as IProjectFactory & IProducerProjectFactory
}

async function openProject(
    kind: string, id: string, version: string, factory: IProjectFactory,
    bindings?: { metaModel?: { id: string; version: string }; libraries?: { id: string; version: string }[] },
): Promise<OpenProject>
{
    const storage = new FakeStorage(`C:/${id}`)
    const verKey = kind === 'meta-model' ? 'modelVersion' : 'libVersion'
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(
        { type: kind, id, [verKey]: version, ...bindings }))
    return new OpenProject(new Project(kind, id, `C:/${id}`, new ProjectNode(id, '', 'folder')), factory, storage)
}

// A provider with published backends + a fake explorer holding the given projects.
function env(open: OpenProject[]): { provider: ServiceProvider; meta: FakeStorage; libs: FakeStorage }
{
    const provider = new ServiceProvider()
    const registry = new StorageProviderRegistry(provider)
    const meta = new FakeStorage('fake://meta-models')
    const libs = new FakeStorage('fake://libraries')
    registry.Register(META_MODELS_BACKEND_ID, () => meta)
    registry.Register(LIBRARIES_BACKEND_ID, () => libs)
    provider.registerInstance(StorageProviderRegistry.Key, registry)
    const collection = new ObservableCollection<OpenProject>()
    for (const op of open) collection.Add(op)
    provider.registerInstance(ProjectExplorerService.Key, { OpenProjects: collection } as unknown as ProjectExplorerService)
    return { provider, meta, libs }
}

const hasNode = (bases: TodlDocument[], id: string): boolean => bases.some((b) => b.nodes.some((n) => n.id === id))

test('prefers an open producer\'s live document over the published artifact', async () => {
    const mm = await openProject('meta-model', 'ea', '0.1.0',
        producer(ProducerKind.MetaModel, 'namespace ea { concept live-concept { label : string; } }'))
    const { provider, meta } = env([mm])
    // Published copy has a DIFFERENT node, so we can tell which was used.
    await meta.WriteText('ea/0.1.0/model.json', JSON.stringify(toJSON(check([{ uri: 'x.todl', text: 'namespace ea { concept published-concept { label : string; } }' }]).model)))

    const consumer = new FakeStorage('C:/arch')
    await consumer.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'architecture', metaModel: { id: 'ea', version: '0.1.0' } }))

    const resolver = new WorkspaceBaseResolver(provider)
    const { bases, problems } = await resolver.ResolveForStorage(consumer)
    expect(hasNode(bases, 'live-concept')).toBe(true)
    expect(hasNode(bases, 'published-concept')).toBe(false)
    expect(problems).toEqual([])
})

test('falls back to the published artifact when the producer is not open', async () => {
    const { provider, meta } = env([])
    await meta.WriteText('ea/0.1.0/model.json', JSON.stringify(toJSON(check([{ uri: 'x.todl', text: 'namespace ea { concept published-concept { label : string; } }' }]).model)))
    const consumer = new FakeStorage('C:/arch')
    await consumer.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'architecture', metaModel: { id: 'ea', version: '0.1.0' } }))

    const resolver = new WorkspaceBaseResolver(provider)
    const { bases } = await resolver.ResolveForStorage(consumer)
    expect(hasNode(bases, 'published-concept')).toBe(true)
})

test('an id match on a different version uses local and notes it in problems', async () => {
    const mm = await openProject('meta-model', 'ea', '0.2.0',
        producer(ProducerKind.MetaModel, 'namespace ea { concept live-concept { label : string; } }'))
    const { provider } = env([mm])
    const consumer = new FakeStorage('C:/arch')
    await consumer.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'architecture', metaModel: { id: 'ea', version: '0.1.0' } }))

    const resolver = new WorkspaceBaseResolver(provider)
    const { bases, problems } = await resolver.ResolveForStorage(consumer)
    expect(hasNode(bases, 'live-concept')).toBe(true)
    expect(problems.some((p) => p.includes('0.1.0') && p.includes('0.2.0'))).toBe(true)
})

test('resolves recursively: architecture -> library -> meta-model, all local, meta-model first', async () => {
    const mm = await openProject('meta-model', 'ea', '0.1.0',
        producer(ProducerKind.MetaModel, 'namespace ea { concept mm-node { label : string; } }'))
    const lib = await openProject('library', 'acme', '0.1.0',
        producer(ProducerKind.Library, 'namespace acme { concept lib-node { label : string; } }'),
        { metaModel: { id: 'ea', version: '0.1.0' } })
    const { provider } = env([mm, lib])
    const consumer = new FakeStorage('C:/arch')
    await consumer.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(
        { type: 'architecture', metaModel: { id: 'ea', version: '0.1.0' }, libraries: [{ id: 'acme', version: '0.1.0' }] }))

    const resolver = new WorkspaceBaseResolver(provider)
    const { bases } = await resolver.ResolveForStorage(consumer)
    expect(hasNode(bases, 'mm-node')).toBe(true)
    expect(hasNode(bases, 'lib-node')).toBe(true)
    // meta-model first (stable order the language server expects)
    const mmIdx = bases.findIndex((b) => b.nodes.some((n) => n.id === 'mm-node'))
    const libIdx = bases.findIndex((b) => b.nodes.some((n) => n.id === 'lib-node'))
    expect(mmIdx).toBeLessThan(libIdx)
})

test('a producer editing its own source does not resolve against itself', async () => {
    // A library that (pathologically) lists itself as a library binding.
    const lib = await openProject('library', 'acme', '0.1.0',
        producer(ProducerKind.Library, 'namespace acme { concept lib-node { label : string; } }'),
        { libraries: [{ id: 'acme', version: '0.1.0' }] })
    const { provider, libs } = env([lib])
    await libs.WriteText('acme/0.1.0/model.json', JSON.stringify(toJSON(check([{ uri: 'x.todl', text: 'namespace acme { concept published-lib { label : string; } }' }]).model)))

    const resolver = new WorkspaceBaseResolver(provider)
    const { bases } = await resolver.ResolveForStorage(lib.Storage)
    // Self-excluded → its self-binding falls back to published.
    expect(hasNode(bases, 'published-lib')).toBe(true)
})

test('a local producer with compile errors surfaces problems and still returns its document', async () => {
    const failing = {
        formats: [], producerKind: ProducerKind.MetaModel,
        compileToDocument: async () => ({ doc: toJSON(check([{ uri: 'p.todl', text: 'namespace ea { concept partial { label : string; } }' }]).model), problems: ['boom'] }),
    } as unknown as IProjectFactory & IProducerProjectFactory
    const mm = await openProject('meta-model', 'ea', '0.1.0', failing)
    const { provider } = env([mm])
    const consumer = new FakeStorage('C:/arch')
    await consumer.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'architecture', metaModel: { id: 'ea', version: '0.1.0' } }))

    const resolver = new WorkspaceBaseResolver(provider)
    const { bases, problems } = await resolver.ResolveForStorage(consumer)
    expect(hasNode(bases, 'partial')).toBe(true)
    expect(problems.some((p) => p.includes('boom'))).toBe(true)
})
```

- [ ] **Step 2: Run it to confirm it fails** — `npx vitest run src/renderer/src/services/projects/tests/workspace-base-resolver.test.ts`. Expected: FAIL, cannot find `../workspace-base-resolver.js`.

- [ ] **Step 3: Implement the resolver** `src/renderer/src/services/projects/workspace-base-resolver.ts`:

```ts
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { TodlDocument } from '@pragmatic-tech-ai/todl'

import type { IStorage } from '../storage/storage.js'
import { ProjectExplorerService } from '../../modules/project-explorer/services/project-explorer-service.js'
import { ensureMetaModelsBackend } from '../../modules/meta-model/services/meta-models-backend.js'
import { ensureLibrariesBackend } from '../../modules/library/services/libraries-backend.js'
import { TodlLanguageClient } from '../todl/todl-language-client.js'
import type { OpenProject } from './open-project.js'
import type { BaseRef } from './base-binding.js'
import { PROJECT_MANIFEST_FILENAME, ProducerKind, isProducer } from './project-factory.js'

// The normalized manifest fields the resolver reads (modelVersion/libVersion
// unified to `version`).
interface ProjManifest
{
    type:       string
    id?:        string
    version?:   string
    metaModel?: BaseRef
    libraries?: readonly BaseRef[]
}

// A snapshot of the open set, rebuilt when OpenProjects changes: producers keyed
// by `<kind>:<id>` (+ their version), and every project's outbound binding ids.
interface Snapshot
{
    producers: Map<string, { project: OpenProject; version: string | undefined }>
    consumers: { project: OpenProject; producedId: string | undefined; refIds: Set<string> }[]
}

// Resolves a project's bases local-first: an open producer (meta-model/library)
// whose manifest id matches a binding is compiled live (via its factory's
// compileToDocument) instead of read from the published registry. Recursive
// (a producer's own bases resolve the same way), cycle-guarded, self-excluding.
// Publish does NOT use this — it stays on resolveBases (published only).
export class WorkspaceBaseResolver extends ServiceBase
{
    public static readonly Key = new ServiceKey<WorkspaceBaseResolver>('WorkspaceBaseResolver')

    private snapshot: Snapshot | undefined
    private previousProducerKeys = new Set<string>()

    constructor(provider: IServiceProvider)
    {
        super(provider)
        // Signal B: rebuild the snapshot and refresh dependents whose resolution
        // could have flipped when the open set changes (open/close). Subscribed
        // once here; the explorer exists by the time this service is resolved.
        const explorer = this.Provider.get(ProjectExplorerService.Key)
        explorer?.OpenProjects.Subscribe(() => { this.snapshot = undefined; void this.onOpenSetChanged() })
    }

    // Resolve a consumer's declared bases, preferring open producers.
    public async ResolveForStorage(consumerStorage: IStorage): Promise<{ bases: TodlDocument[]; problems: string[] }>
    {
        return this.resolveBindingsOf(consumerStorage, new Set<IStorage>([consumerStorage]))
    }

    // The producer id this storage publishes, or undefined if it is not a producer.
    public producedIdOf(storage: IStorage): string | undefined
    {
        const snap = this.snapshot
        if (snap === undefined) return undefined
        for (const c of snap.consumers) if (c.project.Storage === storage) return c.producedId
        return undefined
    }

    // Open projects whose bindings reference `id` (direct dependents).
    public dependentsOf(id: string): OpenProject[]
    {
        const snap = this.snapshot
        if (snap === undefined) return []
        return snap.consumers.filter((c) => c.refIds.has(id)).map((c) => c.project)
    }

    // Refresh (revalidate) every open project that transitively depends on any of
    // the given producer ids, via the language client's per-storage base refresh.
    public async RefreshDependentsOfIds(ids: readonly string[]): Promise<void>
    {
        await this.ensureSnapshot()
        const client = this.Provider.get(TodlLanguageClient.Key)
        const seenIds = new Set<string>()
        const toRefresh = new Set<IStorage>()
        const queue = [...ids]
        while (queue.length > 0)
        {
            const id = queue.shift()!
            if (seenIds.has(id)) continue
            seenIds.add(id)
            for (const dep of this.dependentsOf(id))
            {
                toRefresh.add(dep.Storage)
                const depId = this.producedIdOf(dep.Storage)
                if (depId !== undefined) queue.push(depId)
            }
        }
        for (const storage of toRefresh) await client?.RefreshBases(storage)
    }

    // ── internals ──

    private async resolveBindingsOf(
        storage: IStorage, visited: Set<IStorage>,
    ): Promise<{ bases: TodlDocument[]; problems: string[] }>
    {
        const manifest = await this.readManifest(storage)
        const bases: TodlDocument[] = []
        const problems: string[] = []
        if (manifest?.metaModel !== undefined)
            await this.resolveOne(manifest.metaModel, ProducerKind.MetaModel, storage, visited, bases, problems)
        for (const lib of manifest?.libraries ?? [])
            await this.resolveOne(lib, ProducerKind.Library, storage, visited, bases, problems)
        return { bases, problems }
    }

    private async resolveOne(
        ref: BaseRef, kind: ProducerKind, consumerStorage: IStorage,
        visited: Set<IStorage>, bases: TodlDocument[], problems: string[],
    ): Promise<void>
    {
        const producer = await this.findOpenProducer(kind, ref.id)
        if (producer !== undefined && producer.Storage !== consumerStorage
            && !visited.has(producer.Storage) && isProducer(producer.Factory))
        {
            visited.add(producer.Storage)
            const child = await this.resolveBindingsOf(producer.Storage, visited)
            problems.push(...child.problems)
            const compiled = await producer.Factory.compileToDocument(producer.Storage, child.bases, this.Provider)
            for (const p of compiled.problems) problems.push(`local ${kind} "${ref.id}" — ${p}`)
            const pv = (await this.readManifest(producer.Storage))?.version
            if (pv !== undefined && pv !== ref.version)
                problems.push(`using local "${ref.id}" (open project) — binding requests @${ref.version}, project is @${pv}`)
            bases.push(compiled.doc)
            return
        }
        if (producer !== undefined && visited.has(producer.Storage))
            problems.push(`cyclic local reference to "${ref.id}"; using published`)
        // Published fallback — mirrors resolveBases' inner read().
        const backend = kind === ProducerKind.MetaModel
            ? ensureMetaModelsBackend(this.Provider)
            : ensureLibrariesBackend(this.Provider)
        try {
            bases.push(JSON.parse(await backend.ReadText(`${ref.id}/${ref.version}/model.json`)) as TodlDocument)
        } catch {
            problems.push(`${kind} "${ref.id}@${ref.version}" is not published`)
        }
    }

    private async findOpenProducer(kind: ProducerKind, id: string): Promise<OpenProject | undefined>
    {
        const snap = await this.ensureSnapshot()
        return snap.producers.get(`${kind}:${id}`)?.project
    }

    private async ensureSnapshot(): Promise<Snapshot>
    {
        if (this.snapshot !== undefined) return this.snapshot
        const explorer = this.Provider.getRequired(ProjectExplorerService.Key)
        const producers = new Map<string, { project: OpenProject; version: string | undefined }>()
        const consumers: Snapshot['consumers'] = []
        for (const op of explorer.OpenProjects.ToArray())
        {
            const m = await this.readManifest(op.Storage)
            if (m === undefined) continue
            let producedId: string | undefined
            if ((m.type === ProducerKind.MetaModel || m.type === ProducerKind.Library) && m.id !== undefined)
            {
                producers.set(`${m.type}:${m.id}`, { project: op, version: m.version })
                producedId = m.id
            }
            const refIds = new Set<string>()
            if (m.metaModel?.id !== undefined) refIds.add(m.metaModel.id)
            for (const l of m.libraries ?? []) if (l.id !== undefined) refIds.add(l.id)
            consumers.push({ project: op, producedId, refIds })
        }
        this.snapshot = { producers, consumers }
        return this.snapshot
    }

    private async readManifest(storage: IStorage): Promise<ProjManifest | undefined>
    {
        try {
            const m = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as {
                type: string; id?: string; modelVersion?: string; libVersion?: string
                metaModel?: BaseRef; libraries?: readonly BaseRef[]
            }
            return { type: m.type, id: m.id, version: m.modelVersion ?? m.libVersion, metaModel: m.metaModel, libraries: m.libraries }
        } catch {
            return undefined
        }
    }

    // Signal B: on open/close, refresh dependents of any producer id that
    // appeared or disappeared (their resolution flips local<->published).
    private async onOpenSetChanged(): Promise<void>
    {
        const snap = await this.ensureSnapshot()
        const now = new Set(snap.producers.keys())
        const changedIds: string[] = []
        for (const key of now) if (!this.previousProducerKeys.has(key)) changedIds.push(key.split(':')[1]!)
        for (const key of this.previousProducerKeys) if (!now.has(key)) changedIds.push(key.split(':')[1]!)
        this.previousProducerKeys = now
        if (changedIds.length > 0) await this.RefreshDependentsOfIds(changedIds)
    }
}

export default WorkspaceBaseResolver
```

- [ ] **Step 4: Run the resolver test to confirm it passes** — `npx vitest run src/renderer/src/services/projects/tests/workspace-base-resolver.test.ts`. Expected: all PASS.

- [ ] **Step 5: Register the service in `app.mu`.** Add the import near the other service imports (after `TodlLanguageClient` at line ~127):

```
import WorkspaceBaseResolver from "./services/projects/workspace-base-resolver.js"
```

Add it to the `.services:` block, right after `TodlLanguageClient` (line ~222):

```
        // Local-first base resolution: a consuming project resolves a base from
        // an open sibling producer's live source instead of the published
        // registry. Eagerly resolved in main.js so its OpenProjects subscription
        // (dependent refresh on open/close) is live before session restore.
        WorkspaceBaseResolver
```

- [ ] **Step 6: Eagerly resolve it in `main.js`.** Add the import near the other service imports and resolve it in the eager-services block (alongside `ProjectRescanService`, before `explorer.RestoreSession()`):

```js
import { WorkspaceBaseResolver } from './services/projects/workspace-base-resolver.js'
```
```js
    app.Services.get(WorkspaceBaseResolver.Key)
```

- [ ] **Step 7: Typecheck** — `npx tsc --noEmit -p tsconfig.web.json` (or the project's `npm run typecheck` if defined). Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(projects): WorkspaceBaseResolver — local-first base resolution"
```

---

### Task 3: Route authoring callers through the resolver

Point the two authoring/validation base-resolution sites at `WorkspaceBaseResolver`. Publish is untouched (stays on `resolveBases`).

**Files:**
- Modify: `src/renderer/src/services/todl/todl-language-client.ts` (`basesFor`)
- Modify: `src/renderer/src/modules/architecture-repository/services/arch-diagram-document-factory.ts` (`openFile`)
- Test: `src/renderer/src/services/todl/tests/todl-language-client-workspace-bases.test.ts` (create)

**Interfaces:**
- Consumes: `WorkspaceBaseResolver.ResolveForStorage` (Task 2).
- Behavior unchanged from callers' view (`{ bases, problems }`), but bases now prefer open siblings.

- [ ] **Step 1: Write the failing test** `src/renderer/src/services/todl/tests/todl-language-client-workspace-bases.test.ts`. This asserts `basesFor` (exercised via the public `AttachProject` path is heavy; instead test the seam directly) prefers the resolver. Since `basesFor` is private, test through a thin public probe is not available — assert the resolver is consulted by checking the client calls `WorkspaceBaseResolver`. Use a stub resolver registered under its Key:

```ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { toJSON, check } from '@pragmatic-tech-ai/todl'

import { FakeStorage } from '../../storage/tests/fake-storage.js'
import { WorkspaceBaseResolver } from '../../projects/workspace-base-resolver.js'
import { TodlLanguageClient } from '../todl-language-client.js'

test('basesFor resolves through WorkspaceBaseResolver (local-first), not resolveBases directly', async () => {
    const provider = new ServiceProvider()
    const doc = toJSON(check([{ uri: 'p.todl', text: 'namespace ea { concept via-resolver { label : string; } }' }]).model)
    let called = false
    provider.registerInstance(WorkspaceBaseResolver.Key, {
        ResolveForStorage: async () => { called = true; return { bases: [doc], problems: [] } },
    } as unknown as WorkspaceBaseResolver)

    const client = new TodlLanguageClient(provider)
    const storage = new FakeStorage('C:/arch')
    // basesFor is private; exercise it via the exposed test-safe path.
    const { bases } = await client.BasesForTesting(storage)
    expect(called).toBe(true)
    expect(bases[0]!.nodes.some((n) => n.id === 'via-resolver')).toBe(true)
})
```

- [ ] **Step 2: Run it to confirm it fails** — `npx vitest run src/renderer/src/services/todl/tests/todl-language-client-workspace-bases.test.ts`. Expected: FAIL (`BasesForTesting` undefined).

- [ ] **Step 3: Rewire `basesFor` and expose a test seam.** In `todl-language-client.ts`, replace the body of `basesFor` so it delegates to the resolver, and add a thin public wrapper for testing. Change the import — remove the now-unused `resolveBases` import and the manifest read; add the resolver import:

Remove:
```ts
import { resolveBases } from '../projects/base-resolver.js'
```
Add:
```ts
import { WorkspaceBaseResolver } from '../projects/workspace-base-resolver.js'
```

Replace the whole `basesFor` method:
```ts
  private async basesFor(storage: IStorage): Promise<{ bases: TodlDocument[]; problems: string[] }> {
    const cached = this.baseCache.get(storage)
    if (cached !== undefined) return cached
    const resolved = await this.Provider.getRequired(WorkspaceBaseResolver.Key).ResolveForStorage(storage)
    this.baseCache.set(storage, resolved)
    return resolved
  }

  // Test seam for basesFor (private). Not used in production.
  public BasesForTesting(storage: IStorage): Promise<{ bases: TodlDocument[]; problems: string[] }> {
    return this.basesFor(storage)
  }
```
(If `PROJECT_MANIFEST_FILENAME` / `BaseBindings` imports become unused in this file, remove them.)

- [ ] **Step 4: Run the client test to confirm it passes** — `npx vitest run src/renderer/src/services/todl/tests/todl-language-client-workspace-bases.test.ts`. Expected: PASS.

- [ ] **Step 5: Rewire the arch diagram factory.** In `arch-diagram-document-factory.ts`, replace the `resolveBases` call in `openFile` and delete the now-unused `bindings` helper + imports. Change:
```ts
        const { bases } = await resolveBases(this.Provider, await this.bindings(storage))
```
to:
```ts
        const { bases } = await this.Provider.getRequired(WorkspaceBaseResolver.Key).ResolveForStorage(storage)
```
Remove the `resolveBases` import, the `BaseBindings` import, the `PROJECT_MANIFEST_FILENAME` import, and the private `bindings` method; add:
```ts
import { WorkspaceBaseResolver } from '../../../services/projects/workspace-base-resolver.js'
```

- [ ] **Step 6: Run the architecture module tests + typecheck** — `npx vitest run src/renderer/src/modules/architecture-repository` then `npx tsc --noEmit -p tsconfig.web.json`. Expected: PASS + clean. (The arch diagram document tests construct bases directly and should be unaffected; if any test relied on the removed `bindings`, update it to register a stub `WorkspaceBaseResolver` returning the expected bases.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(todl): route authoring base resolution through WorkspaceBaseResolver"
```

---

### Task 4: Reactivity — refresh dependents on producer save (Signal A)

Signal B (open/close) is already wired in Task 2's constructor. This task wires Signal A: when a producer's source changes on disk, refresh its transitive dependents. The funnel is `ProjectExplorerService.RefreshProjects` (used by both the external file-watch rescan and the agent refresh path).

**Files:**
- Modify: `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts` (`RefreshProjects`)
- Test: `src/renderer/src/modules/project-explorer/services/tests/refresh-dependents.test.ts` (create)

**Interfaces:**
- Consumes: `WorkspaceBaseResolver.producedIdOf`, `WorkspaceBaseResolver.RefreshDependentsOfIds` (Task 2).

- [ ] **Step 1: Write the failing test** `src/renderer/src/modules/project-explorer/services/tests/refresh-dependents.test.ts`. Verify that after `RefreshProjects([producerFolder])`, the resolver is asked to refresh that producer's dependents. Register a stub resolver capturing the ids:

```ts
import { test, expect, vi } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { WorkspaceBaseResolver } from '../../../../services/projects/workspace-base-resolver.js'
import { ProjectExplorerService } from '../project-explorer-service.js'

test('RefreshProjects refreshes the transitive dependents of each refreshed producer', async () => {
    const provider = new ServiceProvider()
    const refreshed: string[][] = []
    provider.registerInstance(WorkspaceBaseResolver.Key, {
        producedIdOf: () => 'ea',
        RefreshDependentsOfIds: async (ids: string[]) => { refreshed.push([...ids]) },
    } as unknown as WorkspaceBaseResolver)

    // A minimal explorer: stub the machinery RefreshProjects touches so only the
    // dependent-refresh addition is under test.
    const explorer = Object.create(ProjectExplorerService.prototype) as ProjectExplorerService
    // @ts-expect-error inject the provider ServiceBase would hold
    explorer.Provider = provider
    const op = { Storage: {}, Name: 'EA' } as unknown as { Storage: object; Name: string }
    // findByFolder + rescan are private; stub them so RefreshProjects reaches the new code.
    ;(explorer as unknown as { findByFolder: (f: string) => unknown }).findByFolder = () => op
    ;(explorer as unknown as { rescan: (op: unknown) => Promise<void> }).rescan = async () => {}

    await explorer.RefreshProjects(['C:/ea'])
    expect(refreshed).toContainEqual(['ea'])
})
```

- [ ] **Step 2: Run it to confirm it fails** — `npx vitest run src/renderer/src/modules/project-explorer/services/tests/refresh-dependents.test.ts`. Expected: FAIL (no dependent refresh happens; `refreshed` stays empty).

- [ ] **Step 3: Wire Signal A into `RefreshProjects`.** In `project-explorer-service.ts`, import the resolver at the top:
```ts
import { WorkspaceBaseResolver } from '../../../services/projects/workspace-base-resolver.js'
```
Extend `RefreshProjects` (currently ends after the per-folder rescan + `RefreshBases` loop) to collect the refreshed producers' ids and fan out to dependents. Replace the method body:
```ts
    public async RefreshProjects(folders: readonly string[]): Promise<void>
    {
        const client = this.Provider.get(TodlLanguageClient.Key)
        const resolver = this.Provider.get(WorkspaceBaseResolver.Key)
        const producerIds: string[] = []
        for (const folder of folders)
        {
            const op = this.findByFolder(folder)
            if (op === undefined) continue
            await this.rescan(op)   // also resyncs the server's document set
            await client?.RefreshBases(op.Storage)
            const id = resolver?.producedIdOf(op.Storage)
            if (id !== undefined) producerIds.push(id)
        }
        if (resolver !== undefined && producerIds.length > 0)
            await resolver.RefreshDependentsOfIds(producerIds)
    }
```

- [ ] **Step 4: Run the test to confirm it passes** — `npx vitest run src/renderer/src/modules/project-explorer/services/tests/refresh-dependents.test.ts`. Expected: PASS.

- [ ] **Step 5: Full suite + typecheck** — `npx vitest run` and `npx tsc --noEmit -p tsconfig.web.json`. Expected: all PASS + clean. Investigate any regression rather than re-baselining.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(projects): refresh dependents when a producer's source changes"
```

---

## Self-Review

- **Spec coverage:**
  - §1 WorkspaceBaseResolver + producer index → Task 2.
  - §2 recursive "compute what publish would write" + cycle guard → Task 2 (`resolveBindingsOf`/`resolveOne`, `visited`).
  - §3 `compileToDocument` shared by publish + resolver → Task 1.
  - §4 semantics (id-match/version-info, kind-match, self-exclusion, saved-on-disk, local-with-errors, publish-strict) → Task 1 (publish untouched) + Task 2 (tests 1,3,4,5,6).
  - §5 reactivity: Signal A → Task 4; Signal B → Task 2 constructor + `onOpenSetChanged`.
  - §6 callers routed (basesFor, arch diagram) → Task 3; publish NOT routed → Task 1 keeps `resolveBases` in publish.
  - Non-goals (no solution file, no explicit refs, no editor-buffer, no presentation) → nothing added for them; local resolution returns only the `model.json` `TodlDocument`.
- **Placeholder scan:** every code step has concrete code; no TBD/"handle errors"/"similar to". Test inputs are concrete TODL strings.
- **Type consistency:** `ProducerKind` (Task 1) used in Task 2's index keys + resolveOne; `compileToDocument(storage, bases, provider): { doc, problems }` identical across Tasks 1–2; `ResolveForStorage`/`producedIdOf`/`dependentsOf`/`RefreshDependentsOfIds` signatures identical across Tasks 2–4; `readManifest` unifies `modelVersion`/`libVersion` → `version` (matching the two manifest shapes verified in the factories).
- **Known risk flagged for the implementer:** the three test seams that reach private methods (`BasesForTesting`, and the `findByFolder`/`rescan` stubs in Task 4) are the brittlest points — if the harness disallows `Object.create`-based construction of `ProjectExplorerService`, extract the fan-out into a small standalone function `refreshProducerDependents(provider, folders)` and test that directly instead. Note this at Task 4 Step 1.
- **Ordering:** Task 2 registers the service before Task 3 depends on it; Task 4 depends on Task 2's `producedIdOf`/`RefreshDependentsOfIds`. Tasks are in dependency order.

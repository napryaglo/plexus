# ArchitectureModelService Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one app-scoped `ArchitectureModelService` holding a `Map<project.RootPath, ArchModel>` — one live viewpoint-scoped architecture model per open architecture project, composed from the project's published bases plus all its `.todl` files.

**Architecture:** `ArchModel` wraps a `ModelDraft` (from `@pragmatic-tech-ai/todl`) and exposes viewpoints, entity CRUD, an `onChanged` signal, and `save()` (multi-file round-trip via `toTodlByFile`). `ArchitectureModelService` builds each project's `ArchModel` lazily (`WorkspaceBaseResolver.ResolveForStorage` for bases + `collectTodlSources` for sources + `ModelDraft.fromSources`), caches it by `Project.RootPath`, and drops it when the project closes (subscribing to `ProjectExplorerService.OpenProjects`).

**Tech Stack:** TypeScript, `@pragmatic-tech-ai/todl@^0.23.0`, `@pragmatic-tech-ai/mural/runtime` (ServiceBase/ServiceKey/ServiceProvider/ObservableCollection), Vitest.

## Global Constraints

- Dependency floor: `@pragmatic-tech-ai/todl@^0.23.0` (already installed). Import `ModelDraft`, `Repository`, `graphFromJSON`, `toJSON`, `load`, `parse`, `type TodlDocument`, `type SourceFile`, `type Entity` from the package root `@pragmatic-tech-ai/todl` — never a `../src`/deep path.
- Use real TypeScript enums, never string-literal unions.
- Every test file lives in a `tests/` subfolder next to its source (`services/tests/`).
- Key the model map on `project.RootPath` (stable string), never the mutable `Project` object.
- No hardcoded chrome / no relative mural `../src` imports — mural comes from `@pragmatic-tech-ai/mural/runtime`.
- Storage paths are project-relative POSIX (`/`); `.todl` source `uri`s from `collectTodlSources` double as `toTodlByFile` home keys and as `WriteText` paths.
- Commit after each task. Commit messages end with a trailing line:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Run the suite with `npm test` from `c:\Users\Eugene\Projects\architecture-agent\Plexus`.

## Verified external signatures (do not re-derive)

From `@pragmatic-tech-ai/todl` (package root exports):
- `ModelDraft.fromSources(bases: readonly Repository[], sources: readonly { uri: string; text: string }[], opts: { namespace: string }): ModelDraft`
- `ModelDraft#model: Repository` (getter) · `ownInstances(): Entity[]` · `create(concept: string, id: string, home?: string): Entity` · `setField(id: string, name: string, value: Scalar): void` · `addRef(from: string, member: string, to: string): void` · `removeRef(from: string, member: string, to: string): void` · `remove(id: string): void` · `toTodlByFile(): Map<string, string>`
- `Repository#viewpoints(): string[]` · `frames(viewpoint: string): string[]` · `viewpointsFraming(concept: string): string[]` (subtype-aware) · `resolve(id: string): Node | undefined`
- `new Repository(graph?: Graph)` · `graphFromJSON(doc: TodlDocument): Graph` · `toJSON(model: Repository): TodlDocument`
- `load(sources: SourceFile[]): { model: Repository; diagnostics: Diagnostic[] }`
- `check(sources: SourceFile[]): { model: Repository; diagnostics: Diagnostic[] }`
- `parse(source: string, uri?: string): { namespace: { path: string; ... }; diagnostics: Diagnostic[] }`
- `Entity`: `{ readonly id: string; readonly concept: string; readonly tier: Tier; field(name): Scalar|undefined; ref(member): Entity|undefined; ... }`

From `@pragmatic-tech-ai/mural/runtime`:
- `class ServiceBase { constructor(provider: IServiceProvider); protected readonly Provider: IServiceProvider }` (existing services call `super(provider)` then `this.Provider.get(Key)`).
- `class ServiceKey<T> { constructor(description: string) }`
- `IServiceProvider`: `get<T>(token): T | undefined` · `getRequired<T>(token): T`
- `ServiceProvider` (test double host): `registerInstance<T>(token, instance): this` · `get` · `getRequired`
- `ObservableCollection<T>`: `constructor(initial?: readonly T[])` · `ToArray(): T[]` · `Add(item)` · `Remove(item): boolean` · `Subscribe(listener: () => void): () => void` (returns unsubscribe; the listener is a generic change callback — NOT add/remove-specific)

From Plexus:
- `WorkspaceBaseResolver` (`src/renderer/src/services/projects/workspace-base-resolver.ts`): `static readonly Key = new ServiceKey<WorkspaceBaseResolver>('WorkspaceBaseResolver')` · `ResolveForStorage(storage: IStorage): Promise<{ bases: TodlDocument[]; problems: string[] }>`
- `collectTodlSources(storage: IStorage): Promise<SourceFile[]>` (`src/renderer/src/modules/meta-model/services/todl-sources.ts`) — `SourceFile = { uri: string; text: string }`
- `ProjectExplorerService` (`src/renderer/src/modules/project-explorer/services/project-explorer-service.ts`): `static readonly Key` · `get OpenProjects(): ObservableCollection<OpenProject>`
- `OpenProject` (`src/renderer/src/modules/project-explorer/services/open-project.ts`): `.Project: Project` · `.Storage: IStorage`
- `Project` (`src/renderer/src/services/projects/project.ts`): `get RootPath(): string` · `get Name(): string` · `get Type(): string`
- `IStorage` (`src/renderer/src/services/storage/storage.ts`): `WriteText(path, content): Promise<void>` · `ReadText(path): Promise<string>` · `List(path): Promise<readonly StorageEntry[]>` · `Root: string`
- `FakeStorage` (`src/renderer/src/services/storage/tests/fake-storage.ts`): `new FakeStorage(root = 'fake://project')`, implements `IStorage`.

## Shared test fixtures (used verbatim across tasks)

These compile clean against `@pragmatic-tech-ai/todl@0.23.0` (verified from the TODL viewpoint/merge test suite). The meta-model is built into a base `TodlDocument`; the model is two same-id `.todl` files each conforming to a different viewpoint.

```ts
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'

// Meta-model (ontology base): concepts + two viewpoints. No prelude names used,
// so load() (which does NOT inject the prelude) resolves everything.
const MM = `namespace archmm {
  concept Component {}
  concept Node {}
  viewpoint ComponentView : frames Component
  viewpoint DeploymentView : frames Node, Component
}`

// Two model files, same namespace + same model id "Arch", each conforms a viewpoint.
const fileA = { uri: 'model-a.todl', text: `namespace archmm {
  model Arch : archmm conforms ComponentView { Component web {} }
}` }
const fileB = { uri: 'model-b.todl', text: `namespace archmm {
  model Arch : archmm conforms DeploymentView { Node host {} }
}` }

// Build a ModelDraft the way the service will (base repo from meta-model doc).
function buildDraft(): ModelDraft {
  const mmDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
  const baseRepo = new Repository(graphFromJSON(mmDoc))
  return ModelDraft.fromSources([baseRepo], [fileA, fileB], { namespace: 'archmm' })
}
```

Expected shape once composed: `draft.ownInstances()` → two entities `web` (concept `Component`) and `host` (concept `Node`); `draft.model.viewpoints()` → `['ComponentView', 'DeploymentView']`; `draft.model.frames('ComponentView')` → `['Component']`; `draft.model.frames('DeploymentView')` → `['Node', 'Component']`.

---

### Task 1: `ArchModel` read surface

**Files:**
- Create: `src/renderer/src/modules/architecture-projects/services/arch-model.ts`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-model.test.ts`

**Interfaces:**
- Consumes: `ModelDraft`, `Repository`, `type Entity` from `@pragmatic-tech-ai/todl`; `type IStorage` from `../../../services/storage/storage.js`.
- Produces: `export interface Viewpoint { id: string; framedConcepts: string[]; members: Entity[] }` and `export class ArchModel` with `constructor(draft: ModelDraft, storage: IStorage, namespace: string)`, `readonly namespace: string`, `viewpoints(): Viewpoint[]`, `entities(): Entity[]`, `repository(): Repository`. Tasks 2 consumes this same class (adds methods).

- [ ] **Step 1: Write the failing test**

```ts
// tests/arch-model.test.ts
import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { ArchModel } from '../arch-model.js'

const MM = `namespace archmm {
  concept Component {}
  concept Node {}
  viewpoint ComponentView : frames Component
  viewpoint DeploymentView : frames Node, Component
}`
const fileA = { uri: 'model-a.todl', text: `namespace archmm {
  model Arch : archmm conforms ComponentView { Component web {} }
}` }
const fileB = { uri: 'model-b.todl', text: `namespace archmm {
  model Arch : archmm conforms DeploymentView { Node host {} }
}` }

function buildModel(): ArchModel {
  const mmDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
  const baseRepo = new Repository(graphFromJSON(mmDoc))
  const draft = ModelDraft.fromSources([baseRepo], [fileA, fileB], { namespace: 'archmm' })
  return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

test('namespace + entities expose the composed own instances', () => {
  const m = buildModel()
  expect(m.namespace).toBe('archmm')
  expect(m.entities().map((e) => e.id).sort()).toEqual(['host', 'web'])
})

test('viewpoints() lists framed concepts and subtype-aware members', () => {
  const m = buildModel()
  const vps = new Map(m.viewpoints().map((v) => [v.id, v]))
  expect([...vps.keys()].sort()).toEqual(['ComponentView', 'DeploymentView'])
  expect(vps.get('ComponentView')!.framedConcepts).toEqual(['Component'])
  expect(vps.get('ComponentView')!.members.map((e) => e.id)).toEqual(['web'])
  // DeploymentView frames Node + Component, so both host and web are members.
  expect(vps.get('DeploymentView')!.members.map((e) => e.id).sort()).toEqual(['host', 'web'])
})

test('repository() returns the composed working repository', () => {
  const m = buildModel()
  expect(m.repository().resolve('Arch')?.typeOf).toBe('model')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-model.test.ts`
Expected: FAIL — `ArchModel` not found / has no `arch-model.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// arch-model.ts
import type { ModelDraft, Repository, Entity } from '@pragmatic-tech-ai/todl'
import type { IStorage } from '../../../services/storage/storage.js'

// One viewpoint's projection over the model: the concepts it frames and the
// entities visible through it (an entity is a member when its concept is framed
// by this viewpoint, subtype-aware via Repository.viewpointsFraming).
export interface Viewpoint
{
    id: string
    framedConcepts: string[]
    members: Entity[]
}

// A live, per-project architecture model. Wraps a ModelDraft (bases ∪ own
// instances) and projects it through the meta-model's viewpoints. Read surface
// only in Task 1; mutation + save arrive in Task 2.
export class ArchModel
{
    public constructor(
        protected readonly draft: ModelDraft,
        protected readonly storage: IStorage,
        public readonly namespace: string,
    ) {}

    public entities(): Entity[]
    {
        return this.draft.ownInstances()
    }

    public repository(): Repository
    {
        return this.draft.model
    }

    public viewpoints(): Viewpoint[]
    {
        const repo = this.draft.model
        const ents = this.entities()
        return repo.viewpoints().map((id) => ({
            id,
            framedConcepts: repo.frames(id),
            members: ents.filter((e) => repo.viewpointsFraming(e.concept).includes(id)),
        }))
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-model.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/services/arch-model.ts src/renderer/src/modules/architecture-projects/services/tests/arch-model.test.ts
git commit -m "feat(arch): ArchModel read surface — viewpoints, entities, repository"
```

---

### Task 2: `ArchModel` mutation, `onChanged`, and `save`

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-model.ts`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-model-mutation.test.ts`

**Interfaces:**
- Consumes: the Task 1 `ArchModel` (same file), `ModelDraft#create/setField/addRef/remove/toTodlByFile`, `IStorage#WriteText/ReadText`, `check` + `parse` from `@pragmatic-tech-ai/todl`.
- Produces: adds `create(concept: string, id: string, homeUri?: string): Entity`, `setField(id: string, name: string, value: string): void`, `addRef(from: string, member: string, to: string): void`, `remove(id: string): void`, `onChanged(cb: () => void): () => void`, `save(): Promise<void>` to `ArchModel`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/arch-model-mutation.test.ts
import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft, check } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { ArchModel } from '../arch-model.js'

const MM = `namespace archmm {
  concept Component {}
  concept Node {}
  viewpoint ComponentView : frames Component
  viewpoint DeploymentView : frames Node, Component
}`
const fileA = { uri: 'model-a.todl', text: `namespace archmm {
  model Arch : archmm conforms ComponentView { Component web {} }
}` }
const fileB = { uri: 'model-b.todl', text: `namespace archmm {
  model Arch : archmm conforms DeploymentView { Node host {} }
}` }

function buildModel(storage = new FakeStorage('fake://Arch')): ArchModel {
  const mmDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
  const baseRepo = new Repository(graphFromJSON(mmDoc))
  const draft = ModelDraft.fromSources([baseRepo], [fileA, fileB], { namespace: 'archmm' })
  return new ArchModel(draft, storage, 'archmm')
}

test('create adds an own entity into its home file and fires onChanged', () => {
  const m = buildModel()
  let fired = 0
  m.onChanged(() => { fired++ })
  m.create('Component', 'api', 'model-a.todl')
  expect(m.entities().map((e) => e.id).sort()).toEqual(['api', 'host', 'web'])
  expect(fired).toBe(1)
})

test('onChanged unsubscribe stops further notifications', () => {
  const m = buildModel()
  let fired = 0
  const off = m.onChanged(() => { fired++ })
  m.setField('web', 'label', 'Web')
  off()
  m.setField('web', 'label', 'Web2')
  expect(fired).toBe(1)
})

test('save writes each home file and the result recompiles clean', async () => {
  const storage = new FakeStorage('fake://Arch')
  const m = buildModel(storage)
  m.create('Component', 'api', 'model-a.todl')
  await m.save()
  const a = await storage.ReadText('model-a.todl')
  const b = await storage.ReadText('model-b.todl')
  expect(a).toContain('api')
  // Round-trip: the emitted model files recompile against the meta-model base
  // with no reference/validation errors.
  const mmDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
  const { checkAgainst } = await import('@pragmatic-tech-ai/todl')
  const diags = checkAgainst([mmDoc], [{ uri: 'model-a.todl', text: a }, { uri: 'model-b.todl', text: b }]).diagnostics
  expect(diags.filter((d) => d.severity === 'error')).toEqual([])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-model-mutation.test.ts`
Expected: FAIL — `m.onChanged`/`m.create`/`m.save` are not functions.

- [ ] **Step 3: Write minimal implementation**

Add to `arch-model.ts` (inside the class; add the imports for the `Scalar` type is unnecessary — values are strings here):

```ts
    // Subscribers notified after any mutation, so SP4 diagrams can refresh.
    // ModelDraft has no events; ArchModel owns them.
    private readonly listeners = new Set<() => void>()

    public onChanged(cb: () => void): () => void
    {
        this.listeners.add(cb)
        return () => { this.listeners.delete(cb) }
    }

    private fire(): void
    {
        for (const cb of this.listeners) cb()
    }

    // Create an own instance. homeUri routes it to a source file for save();
    // viewpoint→file routing (first-suitable) is SP4's concern.
    public create(concept: string, id: string, homeUri?: string): Entity
    {
        const e = this.draft.create(concept, id, homeUri)
        this.fire()
        return e
    }

    public setField(id: string, name: string, value: string): void
    {
        this.draft.setField(id, name, value)
        this.fire()
    }

    public addRef(from: string, member: string, to: string): void
    {
        this.draft.addRef(from, member, to)
        this.fire()
    }

    public remove(id: string): void
    {
        this.draft.remove(id)
        this.fire()
    }

    // Persist every home file the draft partitions its own delta into.
    public async save(): Promise<void>
    {
        for (const [uri, text] of this.draft.toTodlByFile())
            await this.storage.WriteText(uri, text)
    }
```

Add `Entity` is already imported from Task 1. Change the `Entity` import to include what `create` returns (already present).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-model-mutation.test.ts`
Expected: PASS (3 tests). If the round-trip test surfaces a `Diagnostic.severity` enum mismatch, compare against `Severity.Error` from `@pragmatic-tech-ai/todl` instead of the string `'error'` — import `Severity` and use `d.severity === Severity.Error`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/services/arch-model.ts src/renderer/src/modules/architecture-projects/services/tests/arch-model-mutation.test.ts
git commit -m "feat(arch): ArchModel mutation, onChanged signal, multi-file save"
```

---

### Task 3: `ArchitectureModelService` — build, cache, peek, close

**Files:**
- Create: `src/renderer/src/modules/architecture-projects/services/architecture-model-service.ts`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/architecture-model-service.test.ts`

**Interfaces:**
- Consumes: `ServiceBase`, `ServiceKey`, `type IServiceProvider` from `@pragmatic-tech-ai/mural/runtime`; `ModelDraft`, `Repository`, `graphFromJSON`, `parse`, `type TodlDocument`, `type SourceFile` from `@pragmatic-tech-ai/todl`; `WorkspaceBaseResolver` (`../../../services/projects/workspace-base-resolver.js`); `collectTodlSources` (`../../meta-model/services/todl-sources.js`); `type OpenProject` (`../../project-explorer/services/open-project.js`); `ArchModel` (`./arch-model.js`).
- Produces: `export class ArchitectureModelService extends ServiceBase` with `static readonly Key`, `modelFor(op: OpenProject): Promise<ArchModel>`, `peek(rootPath: string): ArchModel | undefined`, `close(rootPath: string): void`. Task 4 consumes the same class (adds the lifecycle subscription).

- [ ] **Step 1: Write the failing test**

```ts
// tests/architecture-model-service.test.ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { load, toJSON, type TodlDocument } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { WorkspaceBaseResolver } from '../../../../services/projects/workspace-base-resolver.js'
import { Project, ProjectNode } from '../../../../services/projects/project.js'
import { ArchitectureModelService } from '../architecture-model-service.js'

const MM = `namespace archmm {
  concept Component {}
  concept Node {}
  viewpoint ComponentView : frames Component
  viewpoint DeploymentView : frames Node, Component
}`

// A fake OpenProject: only .Project + .Storage are read by the service.
function fakeOpenProject(storage: FakeStorage) {
  const project = new Project('architecture', 'Acme', storage.Root, new ProjectNode('Acme', '', 'folder'))
  return { Project: project, Storage: storage } as unknown as import('../../../project-explorer/services/open-project.js').OpenProject
}

// A provider whose WorkspaceBaseResolver returns the meta-model as the base doc.
function providerWithBase(baseDoc: TodlDocument): ServiceProvider {
  const provider = new ServiceProvider()
  provider.registerInstance(WorkspaceBaseResolver.Key, {
    ResolveForStorage: async () => ({ bases: [baseDoc], problems: [] }),
  } as unknown as WorkspaceBaseResolver)
  return provider
}

async function seededStorage(): Promise<FakeStorage> {
  const storage = new FakeStorage('fake://Acme')
  await storage.WriteText('model-a.todl', `namespace archmm {\n  model Arch : archmm conforms ComponentView { Component web {} }\n}`)
  await storage.WriteText('model-b.todl', `namespace archmm {\n  model Arch : archmm conforms DeploymentView { Node host {} }\n}`)
  return storage
}

test('modelFor composes bases + all .todl files into one ArchModel', async () => {
  const baseDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
  const service = new ArchitectureModelService(providerWithBase(baseDoc))
  const storage = await seededStorage()
  const model = await service.modelFor(fakeOpenProject(storage))
  expect(model.namespace).toBe('archmm')
  expect(model.entities().map((e) => e.id).sort()).toEqual(['host', 'web'])
  expect(model.viewpoints().map((v) => v.id).sort()).toEqual(['ComponentView', 'DeploymentView'])
})

test('modelFor is idempotent — a second call returns the cached instance', async () => {
  const baseDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
  const service = new ArchitectureModelService(providerWithBase(baseDoc))
  const op = fakeOpenProject(await seededStorage())
  const first = await service.modelFor(op)
  const second = await service.modelFor(op)
  expect(second).toBe(first)
})

test('peek returns the cached model; close drops it', async () => {
  const baseDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
  const service = new ArchitectureModelService(providerWithBase(baseDoc))
  const op = fakeOpenProject(await seededStorage())
  await service.modelFor(op)
  expect(service.peek(op.Project.RootPath)).toBeDefined()
  service.close(op.Project.RootPath)
  expect(service.peek(op.Project.RootPath)).toBeUndefined()
})

test('namespace derives from the first .todl file', async () => {
  const baseDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
  const service = new ArchitectureModelService(providerWithBase(baseDoc))
  const model = await service.modelFor(fakeOpenProject(await seededStorage()))
  expect(model.namespace).toBe('archmm')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/architecture-model-service.test.ts`
Expected: FAIL — `ArchitectureModelService` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// architecture-model-service.ts
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ModelDraft, Repository, graphFromJSON, parse, type SourceFile } from '@pragmatic-tech-ai/todl'

import { WorkspaceBaseResolver } from '../../../services/projects/workspace-base-resolver.js'
import { collectTodlSources } from '../../meta-model/services/todl-sources.js'
import type { OpenProject } from '../../project-explorer/services/open-project.js'
import { ArchModel } from './arch-model.js'

// App-scoped: one live ArchModel per open architecture project, keyed by the
// project's stable RootPath. Built lazily from the project's resolved bases
// (meta-model + libraries) plus every .todl file in its storage, composed via
// ModelDraft.fromSources. Dropped when the project closes (Task 4 wires that).
export class ArchitectureModelService extends ServiceBase
{
    public static readonly Key = new ServiceKey<ArchitectureModelService>('ArchitectureModelService')

    private readonly models = new Map<string, ArchModel>()

    public constructor(provider: IServiceProvider) { super(provider) }

    // Lazy build + cache. Idempotent: a second call returns the cached model.
    public async modelFor(op: OpenProject): Promise<ArchModel>
    {
        const key = op.Project.RootPath
        const cached = this.models.get(key)
        if (cached !== undefined) return cached

        const resolver = this.Provider.getRequired(WorkspaceBaseResolver.Key)
        const { bases } = await resolver.ResolveForStorage(op.Storage)
        const sources = await collectTodlSources(op.Storage)
        const namespace = deriveNamespace(sources, op.Project.Name)
        const baseRepos = bases.map((d) => new Repository(graphFromJSON(d)))
        const draft = ModelDraft.fromSources(baseRepos, sources, { namespace })

        const model = new ArchModel(draft, op.Storage, namespace)
        this.models.set(key, model)
        return model
    }

    public peek(rootPath: string): ArchModel | undefined
    {
        return this.models.get(rootPath)
    }

    public close(rootPath: string): void
    {
        this.models.delete(rootPath)
    }
}

// The project's model namespace is the namespace the first .todl file declares;
// with no sources, fall back to the project name.
function deriveNamespace(sources: readonly SourceFile[], fallback: string): string
{
    const first = sources[0]
    if (first === undefined) return fallback
    return parse(first.text, first.uri).namespace.path || fallback
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/architecture-model-service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/services/architecture-model-service.ts src/renderer/src/modules/architecture-projects/services/tests/architecture-model-service.test.ts
git commit -m "feat(arch): ArchitectureModelService build/cache/peek/close + namespace derivation"
```

---

### Task 4: Project-close lifecycle wiring + `app.mu` registration

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/architecture-model-service.ts`
- Modify: `src/renderer/src/app.mu`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/architecture-model-service-lifecycle.test.ts`

**Interfaces:**
- Consumes: `ProjectExplorerService` (`../../project-explorer/services/project-explorer-service.js`), `ObservableCollection` from `@pragmatic-tech-ai/mural/runtime`, the Task 3 `ArchitectureModelService`.
- Produces: constructor now subscribes to `ProjectExplorerService.OpenProjects` and calls `close(rootPath)` for any cached project no longer open.

- [ ] **Step 1: Write the failing test**

```ts
// tests/architecture-model-service-lifecycle.test.ts
import { test, expect } from 'vitest'
import { ServiceProvider, ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'
import { load, toJSON } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { WorkspaceBaseResolver } from '../../../../services/projects/workspace-base-resolver.js'
import { ProjectExplorerService } from '../../../project-explorer/services/project-explorer-service.js'
import { Project, ProjectNode } from '../../../../services/projects/project.js'
import { ArchitectureModelService } from '../architecture-model-service.js'

const MM = `namespace archmm {
  concept Component {}
  viewpoint ComponentView : frames Component
}`

function fakeOpenProject(storage: FakeStorage) {
  const project = new Project('architecture', 'Acme', storage.Root, new ProjectNode('Acme', '', 'folder'))
  return { Project: project, Storage: storage } as unknown as import('../../../project-explorer/services/open-project.js').OpenProject
}

test('removing an open project drops its cached model', async () => {
  const open = new ObservableCollection<any>()
  const explorer = { OpenProjects: open } as unknown as ProjectExplorerService
  const baseDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)

  const provider = new ServiceProvider()
  provider.registerInstance(WorkspaceBaseResolver.Key, {
    ResolveForStorage: async () => ({ bases: [baseDoc], problems: [] }),
  } as unknown as WorkspaceBaseResolver)
  provider.registerInstance(ProjectExplorerService.Key, explorer)

  const storage = new FakeStorage('fake://Acme')
  await storage.WriteText('m.todl', `namespace archmm {\n  model Arch : archmm conforms ComponentView { Component web {} }\n}`)
  const op = fakeOpenProject(storage)
  open.Add(op)

  const service = new ArchitectureModelService(provider)
  await service.modelFor(op)
  expect(service.peek(op.Project.RootPath)).toBeDefined()

  open.Remove(op)                                   // fires the collection listener
  expect(service.peek(op.Project.RootPath)).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/architecture-model-service-lifecycle.test.ts`
Expected: FAIL — the model is still cached after `open.Remove(op)` (no subscription yet).

- [ ] **Step 3: Write minimal implementation**

Add the import and extend the constructor in `architecture-model-service.ts`:

```ts
import { ProjectExplorerService } from '../../project-explorer/services/project-explorer-service.js'
```

```ts
    public constructor(provider: IServiceProvider)
    {
        super(provider)
        // Drop a project's model when it leaves the open set. Subscribe is a
        // generic change callback, so diff the live RootPaths against the cache
        // (mirrors WorkspaceBaseResolver's OpenProjects.Subscribe pattern).
        const explorer = this.Provider.get(ProjectExplorerService.Key)
        explorer?.OpenProjects.Subscribe(() => {
            const live = new Set(explorer.OpenProjects.ToArray().map((op) => op.Project.RootPath))
            for (const key of [...this.models.keys()])
                if (!live.has(key)) this.close(key)
        })
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/architecture-model-service-lifecycle.test.ts`
Expected: PASS.

- [ ] **Step 5: Register the service in `app.mu`**

In `src/renderer/src/app.mu`, inside the `.services:` block, add `ArchitectureModelService` on its own line immediately after `WorkspaceBaseResolver`:

```mu
    .services: {
        ...
        WorkspaceBaseResolver
        ArchitectureModelService
        ...
    }
```

The `.mu` compiler resolves the bare class name via its static `.Key`. Listing it here eagerly constructs it at startup (like `WorkspaceBaseResolver`), so the OpenProjects subscription is live for the whole session.

- [ ] **Step 6: Verify the whole app still compiles and the suite is green**

Run these from `c:\Users\Eugene\Projects\architecture-agent\Plexus`:
- `npm run compile:mu` — Expected: clean, no new errors.
- `npm run typecheck:web` — Expected: clean.
- `npm test` — Expected: all prior tests plus the new suites pass.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/services/architecture-model-service.ts src/renderer/src/modules/architecture-projects/services/tests/architecture-model-service-lifecycle.test.ts src/renderer/src/app.mu
git commit -m "feat(arch): drop cached model on project close; register ArchitectureModelService in app.mu"
```

---

## Notes for the implementer

- **`Project`/`ProjectNode` constructors:** the service tests build `new Project('architecture', 'Acme', storage.Root, new ProjectNode('Acme', '', 'folder'))`. If the real `Project` constructor arity differs, read `src/renderer/src/services/projects/project.ts` and adjust the test construction — the production code only reads `op.Project.RootPath`/`.Name`, so any construction that sets those is fine.
- **`ProjectNode` import path:** `../../../../services/projects/project.js` exports both `Project` and `ProjectNode` (confirmed in `architecture-project-factory.ts`). If `ProjectNode` lives elsewhere, follow the factory's import.
- **Diagnostic severity:** if the Task 2 round-trip assertion `d.severity === 'error'` fails to typecheck or match, import `Severity` from `@pragmatic-tech-ai/todl` and compare `d.severity === Severity.Error`.
- **Do NOT** implement diagram binding, viewpoint selection on new-diagram, read-filtering by frames, or write-routing (viewpoint→home file) — those are SP4.
```

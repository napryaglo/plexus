# Arch Diagram Binding (SP4a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a `.diagram` opens inside an architecture project, bind its already-placed nodes to the project's `ArchModel` entities and keep them in sync; retire the seeded demo canvas.

**Architecture:** A per-document `ArchDiagramBinding` maps each mural `Figure` whose `Figure.Id` equals a model entity id to that entity, syncs its label, and removes it when the entity is deleted. An app-scoped `ArchDiagramBindingService` observes `DocumentsContentHostService.OpenDocuments`, attaches a binding to each opened `DiagramDocument` in an architecture project, and disposes it on close. The generic `DiagramDocument`/`DiagramDocumentFactory` are untouched — the binding is a pure external observer.

**Tech Stack:** TypeScript, `@pragmatic-tech-ai/mural/framework` (`DiagramDocument`, `Figure`, `ContentHostService`/`DocumentsContentHostService`, `IDocument`), `@pragmatic-tech-ai/mural/runtime` (`ServiceBase`/`ServiceKey`/`ObservableCollection`), `@pragmatic-tech-ai/todl@^0.23.0` (`Entity`), Vitest.

## Global Constraints

- `@pragmatic-tech-ai/todl@^0.23.0` (already installed). Import `Entity` from `@pragmatic-tech-ai/todl`.
- Import mural types from `@pragmatic-tech-ai/mural/framework` and `@pragmatic-tech-ai/mural/runtime` — never a relative `../src` path.
- Real TypeScript enums, never string-literal unions.
- Every test file lives in a `tests/` subfolder next to its source.
- Do NOT modify the generic `DiagramDocument` or `DiagramDocumentFactory`. The only diagram-module change allowed is adding a read-only getter to `FileDiagramStorage`.
- Commit after each task. Commit messages end with a trailing line:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Run the suite with `npm test` from `c:\Users\Eugene\Projects\architecture-agent\Plexus`.

## Verified surfaces (do not re-derive)

- `DiagramDocument` (`@pragmatic-tech-ai/mural/framework`): `new DiagramDocument(storage?)` · `get Nodes(): ObservableCollection<Figure | Group>` · `CreateNode(kind: string, x: number, y: number): Figure | null` · `DeleteNodes(items: readonly unknown[]): void` · `get Storage(): DiagramStorage | undefined` · `Save()` / `Load()`. Built-in kinds `'rectangle'`/`'ellipse'` work headless; an unknown kind returns `null`.
- `Figure` (`@pragmatic-tech-ai/mural/framework`): `get/set Id(): string | undefined` · `get/set LabelText(): string` · `get/set Left/Top(): number` · `get/set Kind(): string`. `CreateNode` auto-assigns `.Id`; set your own `.Id` **after** the call and it sticks.
- `DocumentsContentHostService` (`@pragmatic-tech-ai/mural/framework`): resolved via `this.Provider.getRequired(ContentHostService.Key) as DocumentsContentHostService`. `get OpenDocuments(): ObservableCollection<IDocument>`. `IDocument = { readonly Id; readonly Title; readonly IsDirty; Save() }`.
- `ObservableCollection<T>`: `ToArray(): T[]` · `Add(item)` · `Remove(item): boolean` · `Subscribe(listener: () => void): () => void`.
- `FileDiagramStorage` (`src/renderer/src/modules/diagram/persistence/file-diagram-storage.ts`): `constructor(public Path: string, private readonly storage: IStorage, seed: string | null)`; implements mural's `DiagramStorage`. Needs a `get ProjectStorage(): IStorage` getter (Task 2).
- `ArchModel` (`src/renderer/src/modules/architecture-projects/services/arch-model.ts`, SP3): `entities(): Entity[]` · `onChanged(cb: () => void): () => void` · `setField(id, name, value: string): void` · `remove(id: string): void` · `repository(): Repository`.
- `Entity` (`@pragmatic-tech-ai/todl`): `{ readonly id: string; readonly concept: string; field(name: string): Scalar | undefined }`.
- `ArchitectureModelService` (SP3): `static readonly Key` · `modelFor(op: OpenProject): Promise<ArchModel>`.
- `ProjectExplorerService`: `static readonly Key` · `get OpenProjects(): ObservableCollection<OpenProject>`.
- `OpenProject` (`src/renderer/src/services/projects/open-project.ts`): `.Project: Project` · `.Storage: IStorage`. `Project.Type: string` (architecture projects = `'architecture'`).

## Shared test fixture (used in Tasks 1 & 2)

Reuses the SP3 fixture — compiles clean against `todl@0.23.0`.

```ts
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

function buildModel(storage = new FakeStorage('fake://Arch')): ArchModel {
    const mmDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
    const baseRepo = new Repository(graphFromJSON(mmDoc))
    const draft = ModelDraft.fromSources([baseRepo], [fileA, fileB], { namespace: 'archmm' })
    return new ArchModel(draft, storage, 'archmm')
}
```

The model has own instances `web` (concept `Component`) and `host` (concept `Node`). Neither declares a `label`/`name` field, so `displayLabel` falls back to the id until `setField(..., 'label', ...)` is called.

---

### Task 1: `ArchDiagramBinding`

**Files:**
- Create: `src/renderer/src/modules/architecture-projects/services/arch-diagram-binding.ts`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-diagram-binding.test.ts`

**Interfaces:**
- Consumes: `ArchModel` (SP3), `DiagramDocument`/`Figure` (mural framework), `Entity` (todl).
- Produces: `export class ArchDiagramBinding { constructor(doc: DiagramDocument, model: ArchModel); attach(): void; dispose(): void }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/arch-diagram-binding.test.ts
import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { DiagramDocument, Figure } from '@pragmatic-tech-ai/mural/framework'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBinding } from '../arch-diagram-binding.js'

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

// Add a Figure to a doc and give it a specific Id (CreateNode auto-assigns one).
function addFigure(doc: DiagramDocument, id: string): Figure {
    const f = doc.CreateNode('rectangle', 0, 0)
    if (f === null) throw new Error('CreateNode returned null')
    f.Id = id
    return f
}

test('attach binds figures whose Id is an entity and labels them; unknown figures untouched', () => {
    const model = buildModel()
    const doc = new DiagramDocument()
    const web = addFigure(doc, 'web')
    const ghost = addFigure(doc, 'ghost')
    ghost.LabelText = 'freeform'
    const host = addFigure(doc, 'host')

    new ArchDiagramBinding(doc, model).attach()

    expect(web.LabelText).toBe('web')     // id fallback (no label/name field)
    expect(host.LabelText).toBe('host')
    expect(ghost.LabelText).toBe('freeform')   // not an entity — left as-is
})

test('model label change re-syncs the bound figure; delete removes its figure', () => {
    const model = buildModel()
    const doc = new DiagramDocument()
    const web = addFigure(doc, 'web')
    const host = addFigure(doc, 'host')
    const binding = new ArchDiagramBinding(doc, model)
    binding.attach()

    model.setField('web', 'label', 'Web App')
    expect(web.LabelText).toBe('Web App')

    model.remove('host')
    const ids = doc.Nodes.ToArray().filter((n): n is Figure => n instanceof Figure).map((f) => f.Id)
    expect(ids).toContain('web')
    expect(ids).not.toContain('host')
})

test('dispose stops further syncing', () => {
    const model = buildModel()
    const doc = new DiagramDocument()
    const web = addFigure(doc, 'web')
    const binding = new ArchDiagramBinding(doc, model)
    binding.attach()
    model.setField('web', 'label', 'First')
    expect(web.LabelText).toBe('First')

    binding.dispose()
    model.setField('web', 'label', 'Second')
    expect(web.LabelText).toBe('First')   // no longer updating
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-diagram-binding.test.ts`
Expected: FAIL — `ArchDiagramBinding` module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// arch-diagram-binding.ts
import { DiagramDocument, Figure } from '@pragmatic-tech-ai/mural/framework'
import type { Entity } from '@pragmatic-tech-ai/todl'
import type { ArchModel } from './arch-model.js'

// Binds a single opened diagram to a project's ArchModel: mural Figures whose
// Id is a model entity id are tracked and labelled from the entity; on model
// change their labels re-sync and figures whose entity was deleted are removed.
// Figures whose Id matches no entity are freeform shapes and left untouched.
// SP4a owns identity + label + orphan removal only; visuals/Kind belong to
// whoever created the node (SP4b's drop).
export class ArchDiagramBinding
{
    private off: (() => void) | undefined
    private readonly bound = new Map<string, Figure>()   // entityId -> figure

    public constructor(
        private readonly doc: DiagramDocument,
        private readonly model: ArchModel,
    ) {}

    public attach(): void
    {
        const byId = new Map(this.model.entities().map((e) => [e.id, e]))
        for (const node of this.doc.Nodes.ToArray()) {
            if (!(node instanceof Figure)) continue
            const id = node.Id
            if (id === undefined) continue
            const entity = byId.get(id)
            if (entity === undefined) continue
            this.bound.set(id, node)
            node.LabelText = displayLabel(entity)
        }
        this.off = this.model.onChanged(() => this.refresh())
    }

    private refresh(): void
    {
        const byId = new Map(this.model.entities().map((e) => [e.id, e]))
        for (const [id, figure] of [...this.bound]) {
            const entity = byId.get(id)
            if (entity === undefined) {
                this.doc.DeleteNodes([figure])
                this.bound.delete(id)
            } else {
                figure.LabelText = displayLabel(entity)
            }
        }
    }

    public dispose(): void
    {
        this.off?.()
        this.off = undefined
    }
}

// An entity's display label: its `label`, else `name`, else its id.
function displayLabel(entity: Entity): string
{
    const v = entity.field('label') ?? entity.field('name')
    return v !== undefined ? String(v) : entity.id
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-diagram-binding.test.ts`
Expected: PASS (3 tests). If `setField('web','label',...)` does not surface via `entity.field('label')` (schema-gated), that is a real todl bug — stop and report; do not weaken the test.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/services/arch-diagram-binding.ts src/renderer/src/modules/architecture-projects/services/tests/arch-diagram-binding.test.ts
git commit -m "feat(arch): ArchDiagramBinding — bind diagram figures to model entities"
```

---

### Task 2: `FileDiagramStorage.ProjectStorage` getter + `ArchDiagramBindingService`

**Files:**
- Modify: `src/renderer/src/modules/diagram/persistence/file-diagram-storage.ts` (add getter)
- Create: `src/renderer/src/modules/architecture-projects/services/arch-diagram-binding-service.ts`
- Modify: `src/renderer/src/app.mu` (register the service)
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-diagram-binding-service.test.ts`

**Interfaces:**
- Consumes: `ContentHostService.Key`/`DocumentsContentHostService`/`DiagramDocument`/`IDocument` (mural framework), `FileDiagramStorage` (+ new `ProjectStorage` getter), `ProjectExplorerService`, `type OpenProject`, `ArchitectureModelService` (SP3), `ArchDiagramBinding` (Task 1).
- Produces: `export class ArchDiagramBindingService extends ServiceBase { static readonly Key }`.

- [ ] **Step 1: Add the `ProjectStorage` getter to `FileDiagramStorage`**

In `file-diagram-storage.ts`, add a getter exposing the backing project storage (the field is otherwise private). Place it right after the constructor:

```ts
    // The project IStorage this diagram is persisted through — used by the
    // architecture-projects binding to match a diagram to its owning project.
    public get ProjectStorage(): IStorage
    {
        return this.storage
    }
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/arch-diagram-binding-service.test.ts
import { test, expect } from 'vitest'
import { ServiceProvider, ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService, DiagramDocument, Figure, type IDocument } from '@pragmatic-tech-ai/mural/framework'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { FileDiagramStorage } from '../../../diagram/persistence/file-diagram-storage.js'
import { ProjectExplorerService } from '../../../project-explorer/services/project-explorer-service.js'
import { ArchitectureModelService } from '../architecture-model-service.js'
import { Project, ProjectNode } from '../../../../services/projects/project.js'
import type { OpenProject } from '../../../../services/projects/open-project.js'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBindingService } from '../arch-diagram-binding-service.js'

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

function buildModel(storage: FakeStorage): ArchModel {
    const mmDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(mmDoc))], [fileA, fileB], { namespace: 'archmm' })
    return new ArchModel(draft, storage, 'archmm')
}

function diagramFor(projStorage: FakeStorage): DiagramDocument {
    const store = new FileDiagramStorage('view.diagram', projStorage, null)
    const doc = new DiagramDocument(store)
    const f = doc.CreateNode('rectangle', 0, 0)!
    f.Id = 'web'
    return doc
}

// A ServiceProvider wired with a fake host, explorer (one architecture project),
// and a prebuilt ArchModel. `type` selects the project type.
function wire(projStorage: FakeStorage, model: ArchModel, type = 'architecture') {
    const open = new ObservableCollection<IDocument>()
    const host = { OpenDocuments: open } as unknown as import('@pragmatic-tech-ai/mural/framework').DocumentsContentHostService
    const project = new Project(type, 'Acme', projStorage.Root, new ProjectNode('Acme', '', 'folder'))
    const op = { Project: project, Storage: projStorage } as unknown as OpenProject
    const explorer = { OpenProjects: new ObservableCollection<OpenProject>([op]) } as unknown as ProjectExplorerService
    const modelSvc = { modelFor: async () => model } as unknown as ArchitectureModelService

    const provider = new ServiceProvider()
    provider.registerInstance(ContentHostService.Key, host as unknown as ContentHostService)
    provider.registerInstance(ProjectExplorerService.Key, explorer)
    provider.registerInstance(ArchitectureModelService.Key, modelSvc)
    return { provider, open }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

test('opening an architecture diagram attaches a binding (figure label syncs)', async () => {
    const projStorage = new FakeStorage('fake://Acme')
    const model = buildModel(projStorage)
    const { provider, open } = wire(projStorage, model)
    new ArchDiagramBindingService(provider)          // subscribes in ctor

    const doc = diagramFor(projStorage)
    open.Add(doc)
    await tick()

    const web = doc.Nodes.ToArray().find((n): n is Figure => n instanceof Figure && n.Id === 'web')!
    expect(web.LabelText).toBe('web')                // proves attach() ran
    model.setField('web', 'label', 'Bound')
    expect(web.LabelText).toBe('Bound')              // proves onChanged wired
})

test('closing the document disposes its binding', async () => {
    const projStorage = new FakeStorage('fake://Acme')
    const model = buildModel(projStorage)
    const { provider, open } = wire(projStorage, model)
    new ArchDiagramBindingService(provider)

    const doc = diagramFor(projStorage)
    open.Add(doc)
    await tick()
    const web = doc.Nodes.ToArray().find((n): n is Figure => n instanceof Figure && n.Id === 'web')!

    open.Remove(doc)                                 // close → dispose
    model.setField('web', 'label', 'AfterClose')
    expect(web.LabelText).toBe('web')                // detached: no update
})

test('a non-architecture project diagram is not attached', async () => {
    const projStorage = new FakeStorage('fake://Plain')
    const model = buildModel(projStorage)
    const { provider, open } = wire(projStorage, model, 'diagram')   // not architecture
    new ArchDiagramBindingService(provider)

    const doc = diagramFor(projStorage)
    open.Add(doc)
    await tick()
    const web = doc.Nodes.ToArray().find((n): n is Figure => n instanceof Figure && n.Id === 'web')!
    model.setField('web', 'label', 'X')
    expect(web.LabelText).toBe('web')                // never bound
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-diagram-binding-service.test.ts`
Expected: FAIL — `ArchDiagramBindingService` module not found.

- [ ] **Step 4: Write minimal implementation**

```ts
// arch-diagram-binding-service.ts
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService, DiagramDocument, type DocumentsContentHostService, type IDocument } from '@pragmatic-tech-ai/mural/framework'

import { FileDiagramStorage } from '../../diagram/persistence/file-diagram-storage.js'
import { ProjectExplorerService } from '../../project-explorer/services/project-explorer-service.js'
import type { OpenProject } from '../../../services/projects/open-project.js'
import { ArchitectureModelService } from './architecture-model-service.js'
import { ArchDiagramBinding } from './arch-diagram-binding.js'

// App-scoped observer: watches the open-documents set and, for each opened
// DiagramDocument whose owning project is an architecture project, attaches an
// ArchDiagramBinding against that project's ArchModel; disposes it on close.
// The generic diagram is untouched — a standalone diagram simply has no binding.
export class ArchDiagramBindingService extends ServiceBase
{
    public static readonly Key = new ServiceKey<ArchDiagramBindingService>('ArchDiagramBindingService')

    private readonly bindings = new Map<IDocument, ArchDiagramBinding>()
    private readonly attaching = new Set<IDocument>()

    public constructor(provider: IServiceProvider)
    {
        super(provider)
        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        host?.OpenDocuments.Subscribe(() => { void this.sync(host) })
    }

    private async sync(host: DocumentsContentHostService): Promise<void>
    {
        const current = new Set(host.OpenDocuments.ToArray())

        // Closed documents: dispose + forget.
        for (const [doc, binding] of [...this.bindings]) {
            if (!current.has(doc)) {
                binding.dispose()
                this.bindings.delete(doc)
            }
        }

        // Newly opened architecture diagrams: attach.
        for (const doc of current) {
            if (this.bindings.has(doc) || this.attaching.has(doc)) continue
            if (!(doc instanceof DiagramDocument)) continue
            const op = this.projectFor(doc)
            if (op === undefined) continue
            this.attaching.add(doc)
            try {
                const model = await this.Provider.getRequired(ArchitectureModelService.Key).modelFor(op)
                if (host.OpenDocuments.ToArray().includes(doc)) {
                    const binding = new ArchDiagramBinding(doc, model)
                    binding.attach()
                    this.bindings.set(doc, binding)
                }
            } finally {
                this.attaching.delete(doc)
            }
        }
    }

    // The architecture OpenProject that owns this diagram's storage, if any.
    private projectFor(doc: DiagramDocument): OpenProject | undefined
    {
        const store = doc.Storage
        if (!(store instanceof FileDiagramStorage)) return undefined
        const explorer = this.Provider.get(ProjectExplorerService.Key)
        if (explorer === undefined) return undefined
        for (const op of explorer.OpenProjects.ToArray()) {
            if (op.Storage === store.ProjectStorage && op.Project.Type === 'architecture') return op
        }
        return undefined
    }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-diagram-binding-service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Register the service in `app.mu` and eager-resolve it in `main.js`**

In `src/renderer/src/app.mu`, add the import next to `ArchitectureModelService`:

```mu
import ArchDiagramBindingService from "./modules/architecture-projects/services/arch-diagram-binding-service.js"
```

and list it in the `.services:` block immediately after `ArchitectureModelService`:

```mu
        ArchitectureModelService
        ArchDiagramBindingService
```

In `src/renderer/src/main.js`, add the import (next to the other service imports) and eager-resolve it right after the `WorkspaceBaseResolver` line (~line 70), so its OpenDocuments subscription is live from boot:

```js
import { ArchDiagramBindingService } from './modules/architecture-projects/services/arch-diagram-binding-service.js'
```

```js
    // Arch diagram binding: construct now so it observes opened documents and
    // binds architecture diagrams to their ArchModel from boot.
    app.Services.get(ArchDiagramBindingService.Key)
```

- [ ] **Step 7: Verify compile + typecheck**

Run from the Plexus root:
- `npm run compile:mu` — Expected: clean, `app.mu → app.mu.js` recompiles.
- `npm run typecheck:web` — Expected: clean.
- `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-diagram-binding-service.test.ts` — Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/modules/diagram/persistence/file-diagram-storage.ts src/renderer/src/modules/architecture-projects/services/arch-diagram-binding-service.ts src/renderer/src/modules/architecture-projects/services/tests/arch-diagram-binding-service.test.ts src/renderer/src/app.mu src/renderer/src/main.js
git commit -m "feat(arch): ArchDiagramBindingService — attach bindings to opened architecture diagrams"
```

(`app.mu.js` is generated and gitignored — do not add it.)

---

### Task 3: Retire the seeded demo canvas

**Files:**
- Modify: `src/renderer/src/modules/diagram/services/diagram-workspace-service.ts`
- Test: `src/renderer/src/modules/diagram/services/tests/diagram-workspace-service.test.ts`

**Interfaces:**
- Consumes: `DiagramWorkspaceService` (its `Document` is still used by `layout-pipeline-service.ts` and opened by `main.js` — keep the service and its `Document`; remove only the sample scene).
- Produces: a `DiagramWorkspaceService` whose `Document` opens empty (no seeded shapes/connectors).

- [ ] **Step 1: Write the failing test**

```ts
// tests/diagram-workspace-service.test.ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DiagramWorkspaceService } from '../diagram-workspace-service.js'

test('the workspace document opens empty — no seeded demo canvas', () => {
    const svc = new DiagramWorkspaceService(new ServiceProvider())
    expect(svc.Document.Nodes.Count).toBe(0)
    expect(svc.Document.Connectors.Count).toBe(0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/diagram/services/tests/diagram-workspace-service.test.ts`
Expected: FAIL — `Nodes.Count` is 5 (the seeded shapes).

- [ ] **Step 3: Remove the seed**

In `diagram-workspace-service.ts`:
1. Delete the `private seed(doc)` method (the whole block that calls `CreateNode`/`CreateConnector`/sets `Status`).
2. Remove the `this.seed(doc)` call in the constructor, so it reads:

```ts
    constructor(provider: IServiceProvider)
    {
        super(provider)

        const doc = new DiagramDocument()
        doc.Title = 'Untitled Diagram'
        this.set_property_value(DiagramWorkspaceService.DocumentKey, doc)
    }
```

3. Remove the now-unused `ConnectorEndpoint` import from the `@pragmatic-tech-ai/mural/framework` import (keep `DiagramDocument`).
4. Update the class doc-comment: replace the "seeds a small scene" / "same shapes and connectors the demo bootstrap places" wording with a note that the document opens empty (the seeded demo was retired in SP4a).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/diagram/services/tests/diagram-workspace-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Full verification**

Run from the Plexus root:
- `npm run compile:mu` — Expected: clean.
- `npm run typecheck:web` — Expected: clean (no dangling `ConnectorEndpoint`/`seed` references).
- `npm test` — Expected: all suites pass (prior + the three new SP4a suites).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/modules/diagram/services/diagram-workspace-service.ts src/renderer/src/modules/diagram/services/tests/diagram-workspace-service.test.ts
git commit -m "feat(arch): retire the seeded demo canvas — workspace document opens empty"
```

---

## Notes for the implementer

- **`Project`/`ProjectNode` construction in tests:** `new Project(type, name, rootPath, root)` and `new ProjectNode(name, path, kind)` (mirrors `architecture-project-factory.ts`). Only `op.Project.Type`, `op.Storage` are read by the service.
- **`setField` → `field` round-trip:** Task 1/2 assert `entity.field('label')` reflects a `setField('web','label',...)`. This is core todl `ModelDraft` behavior. If it does not hold, stop and report — it is a real defect, not something to work around in the test.
- **Async attach timing:** the service attaches after awaiting `modelFor`; tests await one macrotask (`setTimeout(_,0)`) before asserting. Do not assert synchronously after `open.Add(doc)`.
- **Do NOT** implement drop write-routing, viewpoint→home-file resolution, the viewpoint picker, `{scene, arch}` persistence, or read-filtering — those are SP4b/SP4c.
- **`app.mu.js` is generated** by `compile:mu` and is **gitignored** — never `git add` it; just run `compile:mu` so the local build is current.

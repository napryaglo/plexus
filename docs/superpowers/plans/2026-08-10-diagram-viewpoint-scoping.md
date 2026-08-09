# Diagram Viewpoint Scoping (SP4c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An architecture diagram selects which viewpoints it reads/writes; the selection persists in the project manifest and narrows the drop/read scope (real read-filter).

**Architecture:** Per-diagram selected viewpoints live in the architecture manifest keyed by the diagram's path. `ArchDiagramBinding` carries the scope (default all); the drop factory reads it (read-filter). A modal picker sets the initial selection at creation (via an optional explorer participant seam); an Inspector toggle panel re-scopes an open diagram.

**Tech Stack:** TypeScript, `@pragmatic-lab/todl@^0.23.0`, `@pragmatic-lab/mural/{framework,runtime}`, Vitest.

## Global Constraints

- `@pragmatic-lab/todl@^0.23.0` (installed). Real enums; no relative `../src` mural imports; every test in a `tests/` subfolder.
- `PROJECT_MANIFEST_FILENAME = 'project.plexus'` (from `services/projects/project-factory.js`).
- `app.mu.js` is generated and **gitignored** — never `git add` it; add any new `.mu` to the `compile:mu` list in `package.json`.
- The generic `DiagramDocument`/`DiagramDocumentFactory` stay untouched; the `INewFileParticipant` seam is optional (no-op when absent).
- Read-filter narrows the drop scope only; placed figures are never hidden. A diagram with no manifest entry scopes to **all** viewpoints.
- Commit after each task; messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Run the suite with `npm test` from the Plexus root; UI tasks also run `npm run compile:mu` + `npm run typecheck:web`.

## Verified surfaces (do not re-derive)

- `ArchitectureManifest` (`architecture-project-factory.ts`): `{ type: string; name?: string; version: number; metaModel?: BaseRef; libraries?: readonly BaseRef[] }`. `openProject`/`saveProject` JSON-read/write `PROJECT_MANIFEST_FILENAME`.
- `IStorage`: `ReadText(path): Promise<string>` · `WriteText(path, content): Promise<void>` · `Exists(path): Promise<boolean>`.
- `ArchModel`: `viewpoints(): { id: string; framedConcepts: string[]; members: Entity[] }[]` · `repository()` · `notifyChanged()`.
- `ArchDiagramBinding`: `constructor(doc, model)` · `attach()` · `dispose()` · `public readonly model`. Private `bound`, `off`.
- `ArchDiagramBindingService`: `bindings: Map<IDocument, ArchDiagramBinding>` (private) · `modelForDocument(doc): ArchModel | undefined`. Attach path builds a binding from `FileDiagramStorage.Path` + `op.Storage`.
- `FileDiagramStorage`: `Path: string` · `ProjectStorage: IStorage`.
- `ArchInstanceDropFactory.CreateDropped`: computes `const scope = new Set(model.viewpoints().map(v => v.id))` then `resolveDropActions(model.repository(), Descriptor.Key, scope)`; `apply(model, context, action)` recomputes the same scope.
- `ProjectExplorerService.newFileIn(op, folder, format)`: `const path = await factory.newFile(op.Storage, name)` → refresh tree → `await this.openDocument(op, path, factory)` (line ~465).
- `ContentHostService.Key` resolves `DocumentsContentHostService` (`ActiveDocument`, `OpenDocuments.Subscribe`).
- Popup pattern (SP4b `chooser.resources.mu`): `MenuButton [IsOpen, Template=@Popup, TriggerTemplate=@Trigger]`; popup `Template[TargetType=MenuButton] { MenuPopupHost PART_PopupHost { ClickAwayScrim PART_Scrim; Border PART_PopupContainer { ScrollViewer { ItemsControl [ItemsSource=$Rows, ItemsPanel=@Panel] } } } }`.

---

### Task 1: Manifest viewpoints helper

**Files:**
- Create: `src/renderer/src/modules/architecture-projects/services/diagram-viewpoints.ts`
- Modify: `src/renderer/src/modules/architecture-projects/services/architecture-project-factory.ts` (add `diagrams?` to the manifest interface)
- Test: `src/renderer/src/modules/architecture-projects/services/tests/diagram-viewpoints.test.ts`

**Interfaces:**
- Consumes: `IStorage`, `PROJECT_MANIFEST_FILENAME`.
- Produces: `readDiagramViewpoints(storage: IStorage, path: string): Promise<string[] | undefined>`; `writeDiagramViewpoints(storage: IStorage, path: string, viewpoints: string[]): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/diagram-viewpoints.test.ts
import { test, expect } from 'vitest'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { PROJECT_MANIFEST_FILENAME } from '../../../../services/projects/project-factory.js'
import { readDiagramViewpoints, writeDiagramViewpoints } from '../diagram-viewpoints.js'

async function seeded(): Promise<FakeStorage> {
    const s = new FakeStorage('fake://Acme')
    await s.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({
        type: 'architecture', name: 'Acme', version: 1,
        metaModel: { id: 'ea', version: '5' }, libraries: [{ id: 'aws', version: '2' }],
    }))
    return s
}

test('write then read round-trips a diagram’s viewpoints', async () => {
    const s = await seeded()
    await writeDiagramViewpoints(s, 'deploy.diagram', ['DeploymentView'])
    expect(await readDiagramViewpoints(s, 'deploy.diagram')).toEqual(['DeploymentView'])
})

test('write preserves the other manifest fields', async () => {
    const s = await seeded()
    await writeDiagramViewpoints(s, 'deploy.diagram', ['DeploymentView'])
    const m = JSON.parse(await s.ReadText(PROJECT_MANIFEST_FILENAME))
    expect(m.name).toBe('Acme')
    expect(m.metaModel).toEqual({ id: 'ea', version: '5' })
    expect(m.libraries).toEqual([{ id: 'aws', version: '2' }])
})

test('reading an absent diagram path returns undefined', async () => {
    const s = await seeded()
    expect(await readDiagramViewpoints(s, 'nope.diagram')).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/diagram-viewpoints.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

```ts
// diagram-viewpoints.ts
import { PROJECT_MANIFEST_FILENAME } from '../../../services/projects/project-factory.js'
import type { IStorage } from '../../../services/storage/storage.js'

// The per-diagram viewpoint selection lives in the architecture manifest under
// `diagrams[<project-relative diagram path>].viewpoints`. Read-modify-write so
// the meta-model / libraries / name bindings are preserved.
interface ManifestWithDiagrams
{
    diagrams?: { [path: string]: { viewpoints: string[] } }
    [k: string]: unknown
}

export async function readDiagramViewpoints(storage: IStorage, path: string): Promise<string[] | undefined>
{
    const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as ManifestWithDiagrams
    return manifest.diagrams?.[path]?.viewpoints
}

export async function writeDiagramViewpoints(storage: IStorage, path: string, viewpoints: string[]): Promise<void>
{
    const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as ManifestWithDiagrams
    const diagrams = manifest.diagrams ?? {}
    diagrams[path] = { viewpoints }
    manifest.diagrams = diagrams
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))
}
```

- [ ] **Step 4: Add `diagrams?` to `ArchitectureManifest`**

In `architecture-project-factory.ts`, extend the `ArchitectureManifest` interface so `openProject`/`saveProject` (which JSON round-trip the whole object) preserve it:

```ts
interface ArchitectureManifest extends ProjectManifestEnvelope
{
    metaModel?: BaseRef
    libraries?: readonly BaseRef[]
    diagrams?: { [path: string]: { viewpoints: string[] } }   // per-diagram viewpoint selection (SP4c)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/diagram-viewpoints.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/services/diagram-viewpoints.ts src/renderer/src/modules/architecture-projects/services/architecture-project-factory.ts src/renderer/src/modules/architecture-projects/services/tests/diagram-viewpoints.test.ts
git commit -m "feat(arch): per-diagram viewpoint selection in the project manifest"
```

---

### Task 2: Per-diagram scope on the binding + service

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-diagram-binding.ts`
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-diagram-binding-service.ts`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-diagram-binding-scope.test.ts`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-diagram-binding-service-scope.test.ts`

**Interfaces:**
- Consumes: `readDiagramViewpoints`/`writeDiagramViewpoints` (Task 1), `FileDiagramStorage.Path/ProjectStorage`.
- Produces on `ArchDiagramBinding`: `setScope(viewpoints: string[]): void`; `scopeSet(): Set<string>`. On `ArchDiagramBindingService`: `scopeForDocument(doc: IDocument): Set<string> | undefined`; `setDocumentScope(doc: IDocument, viewpoints: string[]): Promise<void>`.

- [ ] **Step 1: Write the failing binding test**

```ts
// tests/arch-diagram-binding-scope.test.ts
import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-lab/todl'
import { DiagramDocument } from '@pragmatic-lab/mural/framework'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBinding } from '../arch-diagram-binding.js'

const MM = `namespace archmm {
  concept component {}
  viewpoint ComponentView : frames component
  viewpoint DeploymentView : frames component
}`
function model(): ArchModel {
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))], [], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

test('scopeSet defaults to all viewpoints when unset', () => {
    const b = new ArchDiagramBinding(new DiagramDocument(), model())
    expect([...b.scopeSet()].sort()).toEqual(['ComponentView', 'DeploymentView'])
})

test('setScope narrows the scope', () => {
    const b = new ArchDiagramBinding(new DiagramDocument(), model())
    b.setScope(['ComponentView'])
    expect([...b.scopeSet()]).toEqual(['ComponentView'])
})
```

- [ ] **Step 2: Run it — Expected FAIL** (`setScope`/`scopeSet` undefined).

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-diagram-binding-scope.test.ts`

- [ ] **Step 3: Add scope to `ArchDiagramBinding`**

Add a field + methods (place after the `bound` field / near `dispose`):

```ts
    private scope: string[] = []

    // Replace the diagram's selected-viewpoint scope (empty = all).
    public setScope(viewpoints: string[]): void
    {
        this.scope = [...viewpoints]
    }

    // The scope as a set; empty falls back to every viewpoint the model declares.
    public scopeSet(): Set<string>
    {
        return this.scope.length > 0
            ? new Set(this.scope)
            : new Set(this.model.viewpoints().map((v) => v.id))
    }
```

- [ ] **Step 4: Run the binding test — Expected PASS.**

- [ ] **Step 5: Write the failing service test**

```ts
// tests/arch-diagram-binding-service-scope.test.ts
import { test, expect } from 'vitest'
import { ServiceProvider, ObservableCollection } from '@pragmatic-lab/mural/runtime'
import { ContentHostService, DiagramDocument, type IDocument, type DocumentsContentHostService } from '@pragmatic-lab/mural/framework'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-lab/todl'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { FileDiagramStorage } from '../../../diagram/persistence/file-diagram-storage.js'
import { WorkspaceBaseResolver } from '../../../../services/projects/workspace-base-resolver.js'
import { ProjectExplorerService } from '../../../project-explorer/services/project-explorer-service.js'
import { ArchitectureModelService } from '../architecture-model-service.js'
import { Project, ProjectNode } from '../../../../services/projects/project.js'
import { PROJECT_MANIFEST_FILENAME } from '../../../../services/projects/project-factory.js'
import type { OpenProject } from '../../../../services/projects/open-project.js'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBindingService } from '../arch-diagram-binding-service.js'

const MM = `namespace archmm {
  concept component {}
  viewpoint ComponentView : frames component
  viewpoint DeploymentView : frames component
}`
function buildModel(storage: FakeStorage): ArchModel {
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))], [], { namespace: 'archmm' })
    return new ArchModel(draft, storage, 'archmm')
}
const tick = () => new Promise((r) => setTimeout(r, 0))

async function scenario(seedScope?: string[]) {
    const storage = new FakeStorage('fake://Acme')
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({
        type: 'architecture', name: 'Acme', version: 1,
        ...(seedScope ? { diagrams: { 'v.diagram': { viewpoints: seedScope } } } : {}),
    }))
    const model = buildModel(storage)
    const open = new ObservableCollection<IDocument>()
    const host = { OpenDocuments: open } as unknown as DocumentsContentHostService
    const project = new Project('architecture', 'Acme', storage.Root, new ProjectNode('Acme', '', 'folder'))
    const op = { Project: project, Storage: storage } as unknown as OpenProject
    const explorer = { OpenProjects: new ObservableCollection<OpenProject>([op]) } as unknown as ProjectExplorerService

    const provider = new ServiceProvider()
    provider.registerInstance(ContentHostService.Key, host as unknown as ContentHostService)
    provider.registerInstance(WorkspaceBaseResolver.Key, { ResolveForStorage: async () => ({ bases: [], problems: [] }) } as unknown as WorkspaceBaseResolver)
    provider.registerInstance(ProjectExplorerService.Key, explorer)
    provider.registerInstance(ArchitectureModelService.Key, { modelFor: async () => model } as unknown as ArchitectureModelService)

    const doc = new DiagramDocument(new FileDiagramStorage('v.diagram', storage, null))
    const svc = new ArchDiagramBindingService(provider)
    open.Add(doc)
    await tick()
    return { svc, doc, storage, model }
}

test('attach reads the manifest scope', async () => {
    const { svc, doc } = await scenario(['ComponentView'])
    expect([...svc.scopeForDocument(doc)!]).toEqual(['ComponentView'])
})

test('no manifest entry defaults to all viewpoints', async () => {
    const { svc, doc } = await scenario()
    expect([...svc.scopeForDocument(doc)!].sort()).toEqual(['ComponentView', 'DeploymentView'])
})

test('setDocumentScope updates the binding and persists to the manifest', async () => {
    const { svc, doc, storage } = await scenario()
    await svc.setDocumentScope(doc, ['DeploymentView'])
    expect([...svc.scopeForDocument(doc)!]).toEqual(['DeploymentView'])
    const m = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
    expect(m.diagrams['v.diagram'].viewpoints).toEqual(['DeploymentView'])
})
```

- [ ] **Step 6: Run it — Expected FAIL.**

- [ ] **Step 7: Wire scope into `ArchDiagramBindingService`**

The attach path currently builds `new ArchDiagramBinding(doc, model); binding.attach()`. After `attach()`, read + apply the manifest scope. Add the import and, in the attach block (right after `binding.attach()`), insert:

```ts
                const store = doc.Storage
                if (store instanceof FileDiagramStorage) {
                    const vps = await readDiagramViewpoints(store.ProjectStorage, store.Path)
                    if (vps !== undefined) binding.setScope(vps)
                }
```

Add the two public methods (near `modelForDocument`):

```ts
    // The selected-viewpoint scope of an attached architecture diagram.
    public scopeForDocument(doc: IDocument): Set<string> | undefined
    {
        return this.bindings.get(doc)?.scopeSet()
    }

    // Narrow (or widen) a diagram's scope: update the binding, persist to the
    // manifest, and re-notify so any live view refreshes.
    public async setDocumentScope(doc: IDocument, viewpoints: string[]): Promise<void>
    {
        const binding = this.bindings.get(doc)
        if (binding === undefined) return
        binding.setScope(viewpoints)
        const store = doc.Storage
        if (store instanceof FileDiagramStorage) await writeDiagramViewpoints(store.ProjectStorage, store.Path, viewpoints)
        binding.model.notifyChanged()
    }
```

Imports to add: `import { readDiagramViewpoints, writeDiagramViewpoints } from './diagram-viewpoints.js'`. `doc.Storage` for a `DiagramDocument` is typed `DiagramStorage | undefined`; the `instanceof FileDiagramStorage` guard narrows it. If `binding.setScope`/`scopeSet` aren't visible on the private-map value type, they are public on `ArchDiagramBinding` — no cast needed.

- [ ] **Step 8: Run both scope tests — Expected PASS.**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-diagram-binding-scope.test.ts src/renderer/src/modules/architecture-projects/services/tests/arch-diagram-binding-service-scope.test.ts`

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/services/arch-diagram-binding.ts src/renderer/src/modules/architecture-projects/services/arch-diagram-binding-service.ts src/renderer/src/modules/architecture-projects/services/tests/arch-diagram-binding-scope.test.ts src/renderer/src/modules/architecture-projects/services/tests/arch-diagram-binding-service-scope.test.ts
git commit -m "feat(arch): per-diagram viewpoint scope on the binding (read from manifest)"
```

---

### Task 3: Read-filter in the drop factory

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-instance-drop-factory.ts`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-instance-drop-factory-scope.test.ts`

**Interfaces:**
- Consumes: `ArchDiagramBindingService.scopeForDocument` (Task 2).
- Produces: the drop uses the diagram's scope instead of all viewpoints; `apply` takes the scope as a parameter.

- [ ] **Step 1: Write the failing test**

```ts
// tests/arch-instance-drop-factory-scope.test.ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { DiagramDocument, Figure, type ToolboxDropContext } from '@pragmatic-lab/mural/framework'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-lab/todl'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBindingService } from '../arch-diagram-binding-service.js'
import { DropCandidateChooserService } from '../drop-candidate-chooser-service.js'
import { ArchInstanceDropFactory } from '../arch-instance-drop-factory.js'

// `component` framed only by ComponentView; `node` only by DeploymentView.
const MM = `namespace archmm {
  concept technology {}
  concept component { relationship realisedBy -> technology; }
  concept node { relationship hosts -> technology; }
  viewpoint ComponentView : frames component
  viewpoint DeploymentView : frames node
  taxonomy Stack : represents technology { term azure {} }
}`
function buildModel(storage: FakeStorage): ArchModel {
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))], [], { namespace: 'archmm' })
    return new ArchModel(draft, storage, 'archmm')
}
function wire(doc: DiagramDocument, model: ArchModel, scope: Set<string>) {
    const provider = new ServiceProvider()
    provider.registerInstance(ArchDiagramBindingService.Key, {
        modelForDocument: (d: unknown) => (d === doc ? model : undefined),
        scopeForDocument: (d: unknown) => (d === doc ? scope : undefined),
    } as unknown as ArchDiagramBindingService)
    provider.registerInstance(DropCandidateChooserService.Key, new DropCandidateChooserService(provider))
    return provider
}
function ctx(doc: DiagramDocument, key: string): ToolboxDropContext {
    return { Descriptor: { Key: key }, Position: { X: 1, Y: 2 }, Diagram: {}, Mutator: doc } as unknown as ToolboxDropContext
}

test('a term is droppable only under a selected viewpoint', () => {
    const storage = new FakeStorage('fake://Acme')
    const model = buildModel(storage)
    const doc = new DiagramDocument()
    // Scope = ComponentView only. azure (type technology) is referenced by
    // component (ComponentView) AND node (DeploymentView); only component is in scope.
    const factory = new ArchInstanceDropFactory(wire(doc, model, new Set(['ComponentView'])))
    const result = factory.CreateDropped(ctx(doc, 'Stack.azure')) as Figure
    expect(result).toBeInstanceOf(Figure)
    expect(model.entities().map((e) => e.concept)).toEqual(['component'])   // node was out of scope
})

test('empty-scope diagram (DeploymentView only, no component/technology framed there for component) rejects an out-of-scope-only term', () => {
    const storage = new FakeStorage('fake://Acme')
    const model = buildModel(storage)
    const doc = new DiagramDocument()
    // Scope = a viewpoint that frames nothing referencing technology except node.
    // Drop of a term only referenced by component (not framed here) → still node is framed → creates node.
    const factory = new ArchInstanceDropFactory(wire(doc, model, new Set(['DeploymentView'])))
    factory.CreateDropped(ctx(doc, 'Stack.azure'))
    expect(model.entities().map((e) => e.concept)).toEqual(['node'])
})
```

- [ ] **Step 2: Run it — Expected FAIL** (drop still uses all viewpoints, so the first test finds 2+ candidates → chooser → no single entity, or the wrong concept).

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-instance-drop-factory-scope.test.ts`

- [ ] **Step 3: Read the scope from the binding service**

In `arch-instance-drop-factory.ts`, change `CreateDropped` to source the scope from the service and thread it into `apply`:

```ts
    public CreateDropped(context: ToolboxDropContext): unknown | null
    {
        const doc = context.Mutator as unknown as IDocument
        const bindingSvc = this.provider.get(ArchDiagramBindingService.Key)
        const model = bindingSvc?.modelForDocument(doc)
        if (model === undefined) {
            return context.Mutator.CreateNode(context.Descriptor.Key, context.Position.X, context.Position.Y) ?? null
        }

        const scope = bindingSvc?.scopeForDocument(doc) ?? new Set(model.viewpoints().map((v) => v.id))
        const actions = resolveDropActions(model.repository(), context.Descriptor.Key, scope)
        if (actions.length === 0) return null
        if (actions.length === 1) return this.apply(model, context, scope, actions[0])

        this.provider.getRequired(DropCandidateChooserService.Key).Show(actions, (chosen) => { this.apply(model, context, scope, chosen) })
        return null
    }
```

Change `apply` to accept the scope:

```ts
    private apply(model: ArchModel, context: ToolboxDropContext, scope: Set<string>, action: DropAction): Figure | null
    {
        const vp = [...model.repository().viewpointsFraming(action.concept)].find((v) => scope.has(v))
        if (vp === undefined) return null
        // …unchanged: createInViewpoint / addRef / CreateNode fallback / notifyChanged / save …
```

- [ ] **Step 4: Run it — Expected PASS.** Also re-run the existing `arch-instance-drop-factory.test.ts` to confirm no regression (its `wire` fake has no `scopeForDocument`, so the drop falls back to all viewpoints — still valid).

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-instance-drop-factory-scope.test.ts src/renderer/src/modules/architecture-projects/services/tests/arch-instance-drop-factory.test.ts`

If the existing factory test fails because `scopeForDocument` is now called on its fake, add `scopeForDocument: () => undefined` to that test's fake binding-service (documented fallback to all viewpoints).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/services/arch-instance-drop-factory.ts src/renderer/src/modules/architecture-projects/services/tests/arch-instance-drop-factory-scope.test.ts src/renderer/src/modules/architecture-projects/services/tests/arch-instance-drop-factory.test.ts
git commit -m "feat(arch): drop read-filter — scope candidates to the diagram's viewpoints"
```

---

### Task 4: On-open viewpoint toggle panel (live-smoke UI)

**Files:**
- Create: `src/renderer/src/modules/architecture-projects/services/diagram-viewpoint-scope-service.ts`
- Create: `src/renderer/src/modules/architecture-projects/services/viewpoint-scope.resources.mu`
- Modify: `src/renderer/src/app.mu` (register + merge + mount) and `package.json` (compile:mu list)
- Test: `src/renderer/src/modules/architecture-projects/services/tests/diagram-viewpoint-scope-service.test.ts`

**Interfaces:**
- Consumes: `ContentHostService` (`ActiveDocument`), `ArchDiagramBindingService` (`modelForDocument`/`scopeForDocument`/`setDocumentScope`).
- Produces: `DiagramViewpointScopeService` with `Rows: ObservableCollection<ViewpointToggleRow>` + `refresh()`; `ViewpointToggleRow extends Model { Label; IsSelected; ToggleCommand }`.

- [ ] **Step 1: Write the failing test (service logic)**

```ts
// tests/diagram-viewpoint-scope-service.test.ts
import { test, expect } from 'vitest'
import { ServiceProvider, type ICommand } from '@pragmatic-lab/mural/runtime'
import { ContentHostService, DiagramDocument, type DocumentsContentHostService } from '@pragmatic-lab/mural/framework'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-lab/todl'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBindingService } from '../arch-diagram-binding-service.js'
import { DiagramViewpointScopeService, ViewpointToggleRow } from '../diagram-viewpoint-scope-service.js'

const MM = `namespace archmm {
  concept component {}
  viewpoint ComponentView : frames component
  viewpoint DeploymentView : frames component
}`
function buildModel() {
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))], [], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

function wire(doc: DiagramDocument, model: ArchModel, scope: Set<string>) {
    const calls: Array<[unknown, string[]]> = []
    const provider = new ServiceProvider()
    const host = { ActiveDocument: doc } as unknown as DocumentsContentHostService
    provider.registerInstance(ContentHostService.Key, host as unknown as ContentHostService)
    provider.registerInstance(ArchDiagramBindingService.Key, {
        modelForDocument: (d: unknown) => (d === doc ? model : undefined),
        scopeForDocument: (d: unknown) => (d === doc ? scope : undefined),
        setDocumentScope: async (d: unknown, vps: string[]) => { calls.push([d, vps]) },
    } as unknown as ArchDiagramBindingService)
    return { provider, calls }
}

test('refresh lists the project viewpoints with correct IsSelected', () => {
    const doc = new DiagramDocument()
    const model = buildModel()
    const { provider } = wire(doc, model, new Set(['ComponentView']))
    const svc = new DiagramViewpointScopeService(provider)
    svc.refresh()
    const rows = svc.Rows.ToArray()
    expect(rows.map((r: ViewpointToggleRow) => r.Label).sort()).toEqual(['ComponentView', 'DeploymentView'])
    expect(rows.find((r) => r.Label === 'ComponentView')!.IsSelected).toBe(true)
    expect(rows.find((r) => r.Label === 'DeploymentView')!.IsSelected).toBe(false)
})

test('toggling a row calls setDocumentScope with the new selected set', () => {
    const doc = new DiagramDocument()
    const model = buildModel()
    const { provider, calls } = wire(doc, model, new Set(['ComponentView']))
    const svc = new DiagramViewpointScopeService(provider)
    svc.refresh()
    const deployment = svc.Rows.ToArray().find((r) => r.Label === 'DeploymentView')!
    ;(deployment.ToggleCommand as ICommand).Execute(undefined)
    // Selecting DeploymentView (already-on ComponentView stays) → both selected.
    expect(calls).toHaveLength(1)
    expect([...calls[0][1]].sort()).toEqual(['ComponentView', 'DeploymentView'])
})
```

- [ ] **Step 2: Run it — Expected FAIL** (module not found).

- [ ] **Step 3: Write the service**

```ts
// diagram-viewpoint-scope-service.ts
import {
    MetaData, Model, ObservableCollection, RelayCommand, ServiceBase, ServiceKey,
    type ICommand, type IServiceProvider,
} from '@pragmatic-lab/mural/runtime'
import { ContentHostService, type DocumentsContentHostService, type IDocument } from '@pragmatic-lab/mural/framework'
import { ArchDiagramBindingService } from './arch-diagram-binding-service.js'

// One viewpoint toggle for the active diagram.
export class ViewpointToggleRow extends Model
{
    public static readonly LabelKey = Model.RegisterProperty<string>(ViewpointToggleRow, 'Label', '', MetaData.None)
    public static readonly IsSelectedKey = Model.RegisterProperty<boolean>(ViewpointToggleRow, 'IsSelected', false, MetaData.None)
    public static readonly ToggleCommandKey = Model.RegisterProperty<ICommand | undefined>(ViewpointToggleRow, 'ToggleCommand', undefined, MetaData.None)

    public constructor(label: string, isSelected: boolean, toggle: ICommand)
    {
        super()
        this.set_property_value(ViewpointToggleRow.LabelKey, label)
        this.set_property_value(ViewpointToggleRow.IsSelectedKey, isSelected)
        this.set_property_value(ViewpointToggleRow.ToggleCommandKey, toggle)
    }

    public get Label(): string { return this.get_property_value(ViewpointToggleRow.LabelKey) }
    public get IsSelected(): boolean { return this.get_property_value(ViewpointToggleRow.IsSelectedKey) }
    public get ToggleCommand(): ICommand | undefined { return this.get_property_value(ViewpointToggleRow.ToggleCommandKey) }
}

// Inspector panel: the active architecture diagram's viewpoint toggles. Toggling
// a row flips its membership in the diagram's scope and persists via the binding
// service. Rebuilt when the active document changes (call refresh()).
export class DiagramViewpointScopeService extends ServiceBase
{
    public static readonly Key = new ServiceKey<DiagramViewpointScopeService>('DiagramViewpointScopeService')

    public static readonly RowsKey = Model.RegisterProperty<ObservableCollection<ViewpointToggleRow>>(
        DiagramViewpointScopeService, 'Rows', undefined as unknown as ObservableCollection<ViewpointToggleRow>, MetaData.None)

    public constructor(provider: IServiceProvider)
    {
        super(provider)
        this.set_property_value(DiagramViewpointScopeService.RowsKey, new ObservableCollection<ViewpointToggleRow>())
        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        // Rebuild when the active document changes (the shell re-reads Rows via the panel template).
        host?.OpenDocuments.Subscribe(() => this.refresh())
    }

    public get Rows(): ObservableCollection<ViewpointToggleRow> { return this.get_property_value(DiagramViewpointScopeService.RowsKey) }

    public refresh(): void
    {
        const rows = this.Rows
        rows.Clear()
        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        const doc = host?.ActiveDocument
        const bindingSvc = this.Provider.get(ArchDiagramBindingService.Key)
        if (doc === undefined || bindingSvc === undefined) return
        const model = bindingSvc.modelForDocument(doc)
        const scope = bindingSvc.scopeForDocument(doc)
        if (model === undefined || scope === undefined) return

        for (const vp of model.viewpoints()) {
            const id = vp.id
            rows.Add(new ViewpointToggleRow(id, scope.has(id), new RelayCommand(() => this.toggle(doc, id))))
        }
    }

    private toggle(doc: IDocument, id: string): void
    {
        const bindingSvc = this.Provider.getRequired(ArchDiagramBindingService.Key)
        const scope = bindingSvc.scopeForDocument(doc) ?? new Set<string>()
        const next = new Set(scope)
        if (next.has(id)) next.delete(id); else next.add(id)
        void bindingSvc.setDocumentScope(doc, [...next])
        this.refresh()
    }
}
```

- [ ] **Step 4: Run it — Expected PASS (2 tests).**

- [ ] **Step 5: Write `viewpoint-scope.resources.mu`**

```mu
// viewpoint-scope.resources.mu — the active arch diagram's viewpoint toggles,
// shown in the Inspector region. A row per project viewpoint; the checkbox binds
// IsSelected and the ToggleCommand flips + persists the scope.

import DiagramViewpointScopeService from "./diagram-viewpoint-scope-service.js"
import ViewpointToggleRow from "./diagram-viewpoint-scope-service.js"

resources ViewpointScopeResources {

    ItemsPanelTemplate x:key="ViewpointScopeListPanel" {
        StackPanel [ Orientation = Vertical ]
    }

    DataTemplate [ DataType = ViewpointToggleRow ] {
        CheckBox [ IsChecked = $IsSelected, Command = $ToggleCommand, Margin = (8,3,8,3) ] {
            TextBlock [ Text = $Label ]
        }
    }

    // Inspector-region panel for the active architecture diagram.
    DataTemplate [ DataType = DiagramViewpointScopeService ] {
        DockPanel [ Margin = (8,8,8,8) ] {
            TextBlock [ DockPanel.Dock = Top, Text = "Viewpoints", Margin = (0,0,0,6) ]
            ItemsControl [ ItemsSource = $Rows, ItemsPanel = @ViewpointScopeListPanel ]
        }
    }
}
```

- [ ] **Step 6: Register + mount in `app.mu`; extend `compile:mu`**

1. Add imports beside the other architecture services:
   `import DiagramViewpointScopeService from "./modules/architecture-projects/services/diagram-viewpoint-scope-service.js"`
   `import ViewpointScopeResources from "./modules/architecture-projects/services/viewpoint-scope.resources.mu.js"`
2. `.services:` — add `DiagramViewpointScopeService` after `DropCandidateChooserService`.
3. `resources:` — add `merge ViewpointScopeResources` after `merge ChooserResources`.
4. Mount in the Inspector region: add a body child to `EditorShell x:root { }` bound to the service, mirroring how the layout-inspector mounts an Inspector panel. Read `layout-inspector.resources.mu` + how it is placed, and add:
   `ContentControl [ Shell.Region = Inspector, Content = $service(DiagramViewpointScopeService) ]`
   (If EditorShell auto-populates the Inspector from a registered service list rather than a body child, follow that mechanism instead — mirror the layout inspector exactly.)
5. In `package.json` `compile:mu`, add `src/renderer/src/modules/architecture-projects/services/viewpoint-scope.resources.mu` before `diagram.resources.mu`.

- [ ] **Step 7: Verify compile + typecheck + tests**

- `npm run compile:mu` — Expected: clean (23→24 files).
- `npm run typecheck:web` — Expected: clean.
- `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/diagram-viewpoint-scope-service.test.ts` — Expected: PASS.

If the Inspector mount markup does not compile, revert only the `app.mu` mount body child (keep the service + resources + registration) and note the panel mount as a live-smoke follow-up — do not block the suite.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/services/diagram-viewpoint-scope-service.ts src/renderer/src/modules/architecture-projects/services/viewpoint-scope.resources.mu src/renderer/src/modules/architecture-projects/services/tests/diagram-viewpoint-scope-service.test.ts src/renderer/src/app.mu package.json
git commit -m "feat(arch): Inspector viewpoint-toggle panel for the active diagram"
```

---

### Task 5: Creation-time viewpoint picker + explorer participant seam (live-smoke UI)

**Files:**
- Create: `src/renderer/src/services/documents/new-file-participant.ts` (seam)
- Create: `src/renderer/src/modules/architecture-projects/services/arch-new-diagram-participant.ts`
- Modify: `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts` (call the participant)
- Modify: `src/renderer/src/app.mu` (register the participant under the seam key)
- Test: `src/renderer/src/services/documents/tests/new-file-participant.test.ts`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-new-diagram-participant.test.ts`

**Interfaces:**
- Consumes: `writeDiagramViewpoints` (Task 1), `ArchitectureModelService.modelFor` (for the project's viewpoints), the SP4b chooser popup pattern for a modal multi-select.
- Produces: `interface INewFileParticipant { OnCreated(op: OpenProject, path: string): Promise<void> }` + `NewFileParticipantKey`; `ArchNewDiagramParticipant`.

- [ ] **Step 1: Write the seam + its test**

```ts
// services/documents/tests/new-file-participant.test.ts
import { test, expect } from 'vitest'
import { NewFileParticipantKey, type INewFileParticipant } from '../new-file-participant.js'

test('the seam key is a ServiceKey and a participant satisfies the interface', () => {
    const p: INewFileParticipant = { OnCreated: async () => {} }
    expect(NewFileParticipantKey.description).toBe('NewFileParticipant')
    expect(typeof p.OnCreated).toBe('function')
})
```

```ts
// services/documents/new-file-participant.ts
import { ServiceKey } from '@pragmatic-lab/mural/runtime'
import type { OpenProject } from '../projects/open-project.js'

// Optional post-new-file hook the ProjectExplorer calls after creating a file
// (before opening it). A no-op when unregistered — keeps the generic explorer
// decoupled from project-type-specific creation behavior (e.g. the architecture
// viewpoint picker).
export interface INewFileParticipant
{
    OnCreated(op: OpenProject, path: string): Promise<void>
}

export const NewFileParticipantKey = new ServiceKey<INewFileParticipant>('NewFileParticipant')
```

- [ ] **Step 2: Run the seam test — verify FAIL then PASS** after writing the file.

Run: `npx vitest run src/renderer/src/services/documents/tests/new-file-participant.test.ts`

- [ ] **Step 3: Call the participant in `newFileIn`**

In `project-explorer-service.ts`, import the seam and, in `newFileIn` between `factory.newFile` and `openDocument` (after the tree refresh, before `await this.openDocument(op, path, factory)`), insert:

```ts
            await this.Provider.get(NewFileParticipantKey)?.OnCreated(op, path)
```

Imports: `import { NewFileParticipantKey } from '../../../services/documents/new-file-participant.js'`. (`this.Provider` is the `ServiceBase` provider — the explorer extends `ServiceBase`.)

- [ ] **Step 4: Write the `ArchNewDiagramParticipant` test**

```ts
// modules/architecture-projects/services/tests/arch-new-diagram-participant.test.ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-lab/todl'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { PROJECT_MANIFEST_FILENAME } from '../../../../services/projects/project-factory.js'
import { ArchitectureModelService } from '../architecture-model-service.js'
import { DiagramViewpointPickerService } from '../arch-new-diagram-participant.js'
import { ArchNewDiagramParticipant } from '../arch-new-diagram-participant.js'
import { Project, ProjectNode } from '../../../../services/projects/project.js'
import { ArchModel } from '../arch-model.js'
import type { OpenProject } from '../../../../services/projects/open-project.js'

const MM = `namespace archmm {
  concept component {}
  viewpoint ComponentView : frames component
  viewpoint DeploymentView : frames component
}`
function buildModel(storage: FakeStorage): ArchModel {
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))], [], { namespace: 'archmm' })
    return new ArchModel(draft, storage, 'archmm')
}
function op(storage: FakeStorage, type = 'architecture'): OpenProject {
    const project = new Project(type, 'Acme', storage.Root, new ProjectNode('Acme', '', 'folder'))
    return { Project: project, Storage: storage } as unknown as OpenProject
}

test('for an architecture .diagram, the picked viewpoints are written to the manifest', async () => {
    const storage = new FakeStorage('fake://Acme')
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'architecture', name: 'Acme', version: 1 }))
    const model = buildModel(storage)
    const provider = new ServiceProvider()
    provider.registerInstance(ArchitectureModelService.Key, { modelFor: async () => model } as unknown as ArchitectureModelService)
    // Deterministic picker: choose DeploymentView.
    provider.registerInstance(DiagramViewpointPickerService.Key, { pick: async () => ['DeploymentView'] } as unknown as DiagramViewpointPickerService)

    await new ArchNewDiagramParticipant(provider).OnCreated(op(storage), 'x.diagram')

    const m = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
    expect(m.diagrams['x.diagram'].viewpoints).toEqual(['DeploymentView'])
})

test('a non-architecture project is ignored', async () => {
    const storage = new FakeStorage('fake://Plain')
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'diagram', name: 'Plain', version: 1 }))
    const provider = new ServiceProvider()
    await new ArchNewDiagramParticipant(provider).OnCreated(op(storage, 'diagram'), 'x.diagram')
    const m = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
    expect('diagrams' in m).toBe(false)
})

test('a non-.diagram path is ignored', async () => {
    const storage = new FakeStorage('fake://Acme')
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'architecture', name: 'Acme', version: 1 }))
    const provider = new ServiceProvider()
    await new ArchNewDiagramParticipant(provider).OnCreated(op(storage), 'notes.todl')
    const m = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
    expect('diagrams' in m).toBe(false)
})
```

- [ ] **Step 5: Run it — Expected FAIL** (module not found).

- [ ] **Step 6: Write `arch-new-diagram-participant.ts` (participant + picker service)**

```ts
// arch-new-diagram-participant.ts
import {
    MetaData, Model, ObservableCollection, RelayCommand, ServiceBase, ServiceKey,
    type ICommand, type IServiceProvider,
} from '@pragmatic-lab/mural/runtime'
import type { INewFileParticipant } from '../../../services/documents/new-file-participant.js'
import type { OpenProject } from '../../../services/projects/open-project.js'
import { ArchitectureModelService } from './architecture-model-service.js'
import { writeDiagramViewpoints } from './diagram-viewpoints.js'

// A modal multi-select of the project's viewpoints. pick() resolves the chosen
// ids (or undefined on cancel). The .mu picker template binds $Rows / $IsOpen /
// $ConfirmCommand against this service. Adapts the SP4b chooser popup.
export class PickerRow extends Model
{
    public static readonly LabelKey = Model.RegisterProperty<string>(PickerRow, 'Label', '', MetaData.None)
    public static readonly IsSelectedKey = Model.RegisterProperty<boolean>(PickerRow, 'IsSelected', false, MetaData.None)
    public constructor(label: string) { super(); this.set_property_value(PickerRow.LabelKey, label) }
    public get Label(): string { return this.get_property_value(PickerRow.LabelKey) }
    public get IsSelected(): boolean { return this.get_property_value(PickerRow.IsSelectedKey) }
    public set IsSelected(v: boolean) { this.set_property_value(PickerRow.IsSelectedKey, v) }
}

export class DiagramViewpointPickerService extends ServiceBase
{
    public static readonly Key = new ServiceKey<DiagramViewpointPickerService>('DiagramViewpointPickerService')

    public static readonly IsOpenKey = Model.RegisterProperty<boolean>(DiagramViewpointPickerService, 'IsOpen', false, MetaData.None)
    public static readonly RowsKey = Model.RegisterProperty<ObservableCollection<PickerRow>>(
        DiagramViewpointPickerService, 'Rows', undefined as unknown as ObservableCollection<PickerRow>, MetaData.None)
    public static readonly ConfirmCommandKey = Model.RegisterProperty<ICommand | undefined>(DiagramViewpointPickerService, 'ConfirmCommand', undefined, MetaData.None)

    private resolve: ((v: string[] | undefined) => void) | undefined

    public constructor(provider: IServiceProvider)
    {
        super(provider)
        this.set_property_value(DiagramViewpointPickerService.RowsKey, new ObservableCollection<PickerRow>())
        this.set_property_value(DiagramViewpointPickerService.ConfirmCommandKey, new RelayCommand(() => this.confirm()))
    }

    public get IsOpen(): boolean { return this.get_property_value(DiagramViewpointPickerService.IsOpenKey) }
    public get Rows(): ObservableCollection<PickerRow> { return this.get_property_value(DiagramViewpointPickerService.RowsKey) }
    public get ConfirmCommand(): ICommand | undefined { return this.get_property_value(DiagramViewpointPickerService.ConfirmCommandKey) }

    public pick(viewpoints: string[]): Promise<string[] | undefined>
    {
        const rows = this.Rows
        rows.Clear()
        for (const v of viewpoints) rows.Add(new PickerRow(v))
        this.set_property_value(DiagramViewpointPickerService.IsOpenKey, true)
        return new Promise((res) => { this.resolve = res })
    }

    private confirm(): void
    {
        const chosen = this.Rows.ToArray().filter((r) => r.IsSelected).map((r) => r.Label)
        this.set_property_value(DiagramViewpointPickerService.IsOpenKey, false)
        this.resolve?.(chosen)
        this.resolve = undefined
    }
}

// The architecture-projects new-file participant: for a new `.diagram` in an
// architecture project, pick viewpoints and record them in the manifest.
export class ArchNewDiagramParticipant extends ServiceBase implements INewFileParticipant
{
    public static readonly Key = new ServiceKey<ArchNewDiagramParticipant>('ArchNewDiagramParticipant')

    public constructor(provider: IServiceProvider) { super(provider) }

    public async OnCreated(op: OpenProject, path: string): Promise<void>
    {
        if (op.Project.Type !== 'architecture' || !path.toLowerCase().endsWith('.diagram')) return
        const model = await this.Provider.getRequired(ArchitectureModelService.Key).modelFor(op)
        const viewpoints = model.viewpoints().map((v) => v.id)
        if (viewpoints.length === 0) return
        const picker = this.Provider.getRequired(DiagramViewpointPickerService.Key)
        const chosen = await picker.pick(viewpoints)
        if (chosen !== undefined && chosen.length > 0) await writeDiagramViewpoints(op.Storage, path, chosen)
    }
}
```

- [ ] **Step 7: Run the participant test — Expected PASS (3 tests).**

- [ ] **Step 8: Register the participant + picker in `app.mu` + a picker template**

1. Imports: `DiagramViewpointPickerService`, `ArchNewDiagramParticipant`, and (later) a `PickerResources`.
2. `.services:` — add `DiagramViewpointPickerService`, and register the participant under the seam key:
   `ArchNewDiagramParticipant -> NewFileParticipant`
   (mirror the existing `ElectronSettingsStore -> SettingsStoreKey` service→key binding in `app.mu`; the seam key `NewFileParticipantKey` is `'NewFileParticipant'`).
3. Add a `picker.resources.mu` next to the service defining the modal: mirror `chooser.resources.mu` (MenuButton + MenuPopupHost) but with a checkbox list `DataTemplate[DataType=PickerRow]` (`CheckBox [ IsChecked = $IsSelected ] { TextBlock [ Text = $Label ] }`) and a confirm button (`Button [ Command = $ConfirmCommand ] { TextBlock [ Text = "Create" ] }`), plus the `DataTemplate[DataType=DiagramViewpointPickerService]` host bound to `$IsOpen`. Merge it and mount it as a canvas/shell overlay like the chooser. Add the new `.mu` to the `compile:mu` list.

- [ ] **Step 9: Verify compile + typecheck + full suite**

- `npm run compile:mu` — Expected: clean.
- `npm run typecheck:web` — Expected: clean.
- `npm test` — Expected: all suites pass (prior + the SP4c suites).

If the picker `.mu` overlay/mount does not compile, revert only that markup + its merge/mount (keep the participant, picker service, and registration) and record the picker rendering as a live-smoke follow-up — the manifest write is fully covered by the headless participant test.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/services/documents/new-file-participant.ts src/renderer/src/services/documents/tests/new-file-participant.test.ts src/renderer/src/modules/architecture-projects/services/arch-new-diagram-participant.ts src/renderer/src/modules/architecture-projects/services/tests/arch-new-diagram-participant.test.ts src/renderer/src/modules/project-explorer/services/project-explorer-service.ts src/renderer/src/app.mu package.json
git commit -m "feat(arch): creation-time viewpoint picker via new-file participant seam"
```

---

## Live-GUI smoke (manual, after the suite is green)

`npm run dev`, open an architecture project (meta-model with ≥2 viewpoints):
1. Create a `.diagram` → the picker lists the viewpoints; confirm → the manifest records them.
2. Open it → the Inspector viewpoint panel reflects the selection; toggle a viewpoint → the manifest updates and drops re-scope.
3. Drop a term framed only by an unselected viewpoint → rejected; select that viewpoint → the same drop now creates.

## Notes for the implementer

- **Read-filter is drop-scope only** (Tasks 2–3). Do NOT hide/remove placed figures when the scope narrows, and do NOT filter the toolbox palette — those are out of scope.
- **UI mounts (Tasks 4–5)** are the only unverifiable-until-run parts. Prefer mirroring existing mounts (layout-inspector for the panel; `chooser.resources.mu` for the picker overlay) and rely on `compile:mu` + the live-smoke step. If a mount won't compile, ship the service + registration and defer the mount, keeping the suite green.
- **`app.mu.js`** is generated/gitignored — never `git add` it.

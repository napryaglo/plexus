# Arch Diagram Drop-Routing (SP4b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dropping a toolbox term onto an architecture diagram creates a routed, viewpoint-conforming model entity + a bound `Figure`, following Phase-3 reference semantics, with a chooser popup when several candidates exist.

**Architecture:** A pure resolver turns a dropped term into candidate `(X, m)` drop-actions from the meta-model schema. `ArchModel` gains viewpoint→file routing (`createInViewpoint`). `ArchDiagramBinding` rescans on model change so drop-created figures bind. `ArchInstanceDropFactory` orchestrates: resolve → 0 reject / 1 auto / many chooser → create + ref + Figure + save. A `DropCandidateChooserService` popup (adapting the Problems dock) handles the many case.

**Tech Stack:** TypeScript, `@pragmatic-lab/todl@^0.23.0` (`Repository`, `MetaKind`, `Entity`), `@pragmatic-lab/mural/framework` (`DiagramDocument`, `Figure`, `IToolboxDropFactory`, `ToolboxDropContext`), `@pragmatic-lab/mural/runtime` (`ServiceBase`/`ServiceKey`/`RelayCommand`/`ObservableCollection`/`Model`), Vitest.

## Global Constraints

- `@pragmatic-lab/todl@^0.23.0` (installed). Import `Repository`, `MetaKind`, `type Entity` from `@pragmatic-lab/todl`.
- Real TypeScript enums (`DropActionKind`), never string-literal unions.
- Every test file lives in a `tests/` subfolder next to its source.
- No relative `../src` mural imports — use `@pragmatic-lab/mural/{framework,runtime}`.
- `app.mu.js` is generated and **gitignored** — run `compile:mu` but never `git add` it.
- Standalone (non-architecture) diagrams must keep working: the drop falls back to a plain `CreateNode` when there is no `ArchModel`.
- Commit after each task; messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Run the suite with `npm test` from `c:\Users\Eugene\Projects\architecture-agent\Plexus`.

## Verified surfaces (do not re-derive)

- `Repository` (`@pragmatic-lab/todl`): `allNodes(): Node[]` (`Node = { id, tier, typeOf, attrs: Map<string,Scalar> }`) · `resolve(id): Node | undefined` · `classOf(leaf): NodeId | null` · `represents(taxonomy): NodeId[]` · `supertypesOf(concept): NodeId[]` · `viewpointsFraming(concept): NodeId[]` · `effectiveSchema(concept): { relationships: { name: string; target: NodeId; cardinality }[] }`. `MetaKind.Concept === 'concept'`.
- `ModelDraft` (SP2b): `create(concept, id, home?): Entity` · `setField(id, name, value): void` · `addRef(from, member, to): void` · `homeOf(id): string | undefined` · `toTodlByFile(): Map<string,string>` · `ownInstances(): Entity[]`. `create` does NOT stamp `conforms`.
- `ArchModel` (SP3/SP4a): `entities()` · `viewpoints()` · `repository()` · `setField` · `addRef` · `save()` · `onChanged(cb): () => void` · `create(concept, id, home?)`. Protected: `draft`, `fire()`.
- `ArchDiagramBinding` (SP4a): `constructor(doc: DiagramDocument, model: ArchModel)` · `attach()` · `dispose()`. Private `bound: Map<string, Figure>`, `off`.
- `ArchDiagramBindingService` (SP4a): `bindings: Map<IDocument, ArchDiagramBinding>` (private).
- `ArchInstanceDropFactory` (`arch-instance-drop-factory.ts`): plain class implementing `IToolboxDropFactory`; `ArchInstanceDropFactoryKey = new ServiceKey<IToolboxDropFactory>('ArchInstanceDropFactory')`; registered in `register-arch-toolbox-adapters.ts` via `services.registerInstance(ArchInstanceDropFactoryKey, new ArchInstanceDropFactory())`.
- `ToolboxDropContext` (`@pragmatic-lab/mural/framework`): `{ Descriptor: { Key: string }, Position: { X: number; Y: number }, Diagram, Mutator: DiagramMutator }`. `Mutator.CreateNode(kind, x, y): unknown | null`. The `Mutator` is the `DiagramDocument`.
- `Figure` (`@pragmatic-lab/mural/framework`): `get/set Id(): string | undefined` · `get/set LabelText(): string` · `get/set Kind(): string`.
- Problems popup pattern (`problems-service.ts` / `problems.resources.mu`): `MenuButton [ IsOpen=$IsOpen, Template=@Popup, TriggerTemplate=@Trigger ]`; popup `Template [ TargetType=MenuButton ] { MenuPopupHost PART_PopupHost { ClickAwayScrim PART_Scrim; Border PART_PopupContainer { ScrollViewer { ItemsControl [ ItemsSource=$Rows, ItemsPanel=@ListPanel ] } } } }`; rows are `Model`s with `Label` + a `Command`; `ItemsPanelTemplate { VirtualizingStackPanel [ Orientation=Vertical, ItemHeight=28 ] }`.

## Shared meta-model fixture (Tasks 1, 2, 5)

Compiles clean via `load()` (no prelude needed — empty concepts + `relationship -> target` + taxonomy terms).

```ts
const MM = `namespace archmm {
  concept technology {}
  concept component { relationship realisedBy -> technology; }
  concept node { relationship hosts -> component; }
  viewpoint ComponentView : frames component
  viewpoint DeploymentView : frames node, component
  taxonomy Stack : represents technology { term azure {} }
  taxonomy Kinds : represents component { term webKind {} }
  taxonomy Ghosts : represents technology { term orphan {} }
}`
// NOTE: `orphan`/`azure` are type `technology`; `technology` is framed by NO viewpoint,
// so a term of type technology yields only REFERENCE candidates (never an Instance action).
```

Expected `resolveDropActions` over this model with `scope = {ComponentView, DeploymentView}`:
- `azure` (type `technology`) → reference candidates from framed concepts whose member targets `technology`: `component.realisedBy` → **1 action** (auto). (`node`/`service` don't target technology.)
- `webKind` (type `component`, framed) → **Instance(component)** + reference candidates targeting `component`: `node.hosts` → **2 actions** (chooser).
- `orphan` (type `technology`) → same as `azure` → `component.realisedBy` → 1 action. To get a true **reject (0)**, drop a term whose type is framed by nothing AND unreferenced — see the resolver test, which adds an isolated concept for that.

---

### Task 1: `arch-drop-resolver` — candidate resolution (pure, headless)

**Files:**
- Create: `src/renderer/src/modules/architecture-projects/services/arch-drop-resolver.ts`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-drop-resolver.test.ts`

**Interfaces:**
- Consumes: `Repository`, `MetaKind` from `@pragmatic-lab/todl`.
- Produces: `export enum DropActionKind { Instance='instance', Reference='reference' }`; `export interface DropAction { kind: DropActionKind; concept: string; member?: string; term?: string; label: string }`; `export function resolveDropActions(repo: Repository, descriptorKey: string, scope: ReadonlySet<string>): DropAction[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/arch-drop-resolver.test.ts
import { test, expect } from 'vitest'
import { load } from '@pragmatic-lab/todl'
import { resolveDropActions, DropActionKind } from '../arch-drop-resolver.js'

const MM = `namespace archmm {
  concept technology {}
  concept component { relationship realisedBy -> technology; }
  concept node { relationship hosts -> component; }
  concept lonely {}
  viewpoint ComponentView : frames component
  viewpoint DeploymentView : frames node, component
  taxonomy Stack : represents technology { term azure {} }
  taxonomy Kinds : represents component { term webKind {} }
  taxonomy Solo : represents lonely { term hermit {} }
}`

function repo() { return load([{ uri: 'mm.todl', text: MM }]).model }
const scope = new Set(['ComponentView', 'DeploymentView'])

test('a library term (type technology) yields the single reference candidate that targets it', () => {
    const actions = resolveDropActions(repo(), 'azure', scope)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ kind: DropActionKind.Reference, concept: 'component', member: 'realisedBy', term: 'azure' })
})

test('a term whose type is a framed concept yields an Instance action plus reference candidates (chooser)', () => {
    const actions = resolveDropActions(repo(), 'mm:webKind', scope)   // 'mm:' prefix stripped
    const kinds = actions.map((a) => `${a.kind}:${a.concept}${a.member ? '.' + a.member : ''}`)
    expect(kinds).toContain('instance:component')     // C_t = component, framed → direct instance
    expect(kinds).toContain('reference:node.hosts')   // node.hosts targets component
    expect(actions.length).toBe(2)
})

test('a term framed by nothing and unreferenced yields no candidates (reject)', () => {
    // hermit is type `lonely`; lonely is framed by no viewpoint and no framed
    // concept has a member targeting lonely → 0 actions.
    expect(resolveDropActions(repo(), 'hermit', scope)).toEqual([])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-drop-resolver.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// arch-drop-resolver.ts
import { MetaKind, type Repository } from '@pragmatic-lab/todl'

// What a term-drop can create: a direct instance of a framed concept, or an
// instance of a concept X whose reference member m targets the dropped term's
// type (Phase-3 reference semantics).
export enum DropActionKind { Instance = 'instance', Reference = 'reference' }

export interface DropAction
{
    kind: DropActionKind
    concept: string     // X — the concept to instantiate
    member?: string     // m — reference member (Reference only)
    term?: string       // t — the dropped term id (Reference only)
    label: string       // chooser row text
}

// Candidate drop-actions for a dropped toolbox term. `descriptorKey` is the
// term id (library) or 'mm:'+id (meta-model); `scope` is the diagram's viewpoint
// set (all viewpoints in SP4b). Empty ⇒ reject; one ⇒ auto; many ⇒ chooser.
export function resolveDropActions(repo: Repository, descriptorKey: string, scope: ReadonlySet<string>): DropAction[]
{
    const termId = descriptorKey.startsWith('mm:') ? descriptorKey.slice(3) : descriptorKey
    const node = repo.resolve(termId)
    if (node === undefined) return []

    // C_t: the class it instantiates, else the concept its taxonomy represents, else its own typeOf.
    const ct = repo.classOf(termId) ?? repo.represents(node.typeOf)[0] ?? node.typeOf
    const accept = new Set<string>([ct, ...repo.supertypesOf(ct)])
    const framed = (concept: string): boolean => repo.viewpointsFraming(concept).some((v) => scope.has(v))

    const actions: DropAction[] = []
    if (framed(ct)) actions.push({ kind: DropActionKind.Instance, concept: ct, label: ct })

    for (const n of repo.allNodes()) {
        if (n.typeOf !== MetaKind.Concept) continue
        const x = n.id
        if (!framed(x)) continue
        for (const rel of repo.effectiveSchema(x).relationships) {
            if (accept.has(rel.target))
                actions.push({ kind: DropActionKind.Reference, concept: x, member: rel.name, term: termId, label: `${x}  (${rel.name})` })
        }
    }
    return actions
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-drop-resolver.test.ts`
Expected: PASS (3 tests). If `represents`/`effectiveSchema` return unexpected shapes, print `repo.allNodes().map(n => [n.id, n.typeOf])` to inspect — do not weaken assertions.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/services/arch-drop-resolver.ts src/renderer/src/modules/architecture-projects/services/tests/arch-drop-resolver.test.ts
git commit -m "feat(arch): drop candidate resolver — term → (X,m) actions"
```

---

### Task 2: `ArchModel` viewpoint→file routing primitives (headless)

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-model.ts`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-model-routing.test.ts`

**Interfaces:**
- Consumes: `ModelDraft.homeOf/create/setField`, `repository()`.
- Produces on `ArchModel`: `homeOf(id: string): string | undefined`; `homeForViewpoint(vp: string): string`; `createInViewpoint(concept: string, vp: string): Entity`; `notifyChanged(): void`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/arch-model-routing.test.ts
import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft, checkAgainst, Severity } from '@pragmatic-lab/todl'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { ArchModel } from '../arch-model.js'

const MM = `namespace archmm {
  concept technology {}
  concept component { relationship realisedBy -> technology; }
  viewpoint ComponentView : frames component
  taxonomy Stack : represents technology { term azure {} }
}`

function mmDoc() { return toJSON(load([{ uri: 'mm.todl', text: MM }]).model) }

function emptyModel(): ArchModel {
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(mmDoc()))], [], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

test('createInViewpoint homes the entity in the viewpoint file, stamps conforms, and round-trips', async () => {
    const m = emptyModel()
    const e = m.createInViewpoint('component', 'ComponentView')
    expect(e.concept).toBe('component')
    expect(m.homeOf(e.id)).toBe('componentview.todl')
    const files = new Map(m['draft'].toTodlByFile())   // access via bracket for the test
    const text = files.get('componentview.todl')!
    expect(text).toContain('conforms ComponentView')
    expect(text).toContain(e.id)
    // Round-trips clean against the meta-model base.
    const diags = checkAgainst([mmDoc()], [{ uri: 'componentview.todl', text }]).diagnostics
    expect(diags.filter((d) => d.severity === Severity.Error)).toEqual([])
})

test('uniqueId disambiguates a taken id; a second createInViewpoint reuses the same file', () => {
    const m = emptyModel()
    const a = m.createInViewpoint('component', 'ComponentView')
    const b = m.createInViewpoint('component', 'ComponentView')
    expect(a.id).toBe('component')
    expect(b.id).toBe('component2')
    expect(m.homeForViewpoint('ComponentView')).toBe('componentview.todl')   // reuses a's file
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-model-routing.test.ts`
Expected: FAIL — `createInViewpoint` is not a function.

- [ ] **Step 3: Write minimal implementation**

Add to `arch-model.ts` (inside the class). Also add `import type { Entity } from '@pragmatic-lab/todl'` if not already imported (it is, from SP4a).

```ts
    // The home file (source uri) an own entity round-trips to.
    public homeOf(id: string): string | undefined
    {
        return this.draft.homeOf(id)
    }

    // The file that conforms to `vp`: an existing own entity's home whose
    // `conforms` attr is `vp`, else a fresh `<vp>.todl` (lowercased).
    public homeForViewpoint(vp: string): string
    {
        for (const e of this.entities()) {
            if (this.repository().resolve(e.id)?.attrs.get('conforms') === vp) {
                const h = this.draft.homeOf(e.id)
                if (h !== undefined) return h
            }
        }
        return `${vp.toLowerCase()}.todl`
    }

    // Create a new own instance of `concept`, routed to `vp`'s file and stamped
    // `conforms = vp` so toTodlByFile emits that file's `conforms vp` header.
    public createInViewpoint(concept: string, vp: string): Entity
    {
        const id = this.uniqueId(concept)
        const e = this.draft.create(concept, id, this.homeForViewpoint(vp))
        this.draft.setField(id, 'conforms', vp)
        this.fire()
        return e
    }

    // Re-fire the change signal (used by the drop after wiring a Figure so the
    // binding rescans and binds the new node).
    public notifyChanged(): void
    {
        this.fire()
    }

    // A model-unique id: the lowercased concept, then `concept2`, `concept3`, …
    private uniqueId(concept: string): string
    {
        const base = concept.toLowerCase()
        if (this.repository().resolve(base) === undefined) return base
        let i = 2
        while (this.repository().resolve(base + i) !== undefined) i++
        return base + i
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-model-routing.test.ts`
Expected: PASS (2 tests). If `draft` is not accessible via `m['draft']` in the test, add a temporary `repository()`-based assertion instead — but `draft` is `protected`, which TS allows via bracket access in the same compilation. If `setField(id,'conforms',...)` throws for a marker attr, report it (it should be a plain attr write).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/services/arch-model.ts src/renderer/src/modules/architecture-projects/services/tests/arch-model-routing.test.ts
git commit -m "feat(arch): ArchModel.createInViewpoint — viewpoint→file routing + conforms stamp"
```

---

### Task 3: `ArchDiagramBinding` — rescan on change (binds drop-created figures)

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-diagram-binding.ts`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-diagram-binding-rescan.test.ts`

**Interfaces:**
- Consumes: the SP4a binding.
- Produces: `attach()` binds figures present now AND figures added later (bound on the next model change); `model` is exposed as `public readonly` for `ArchDiagramBindingService.modelForDocument`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/arch-diagram-binding-rescan.test.ts
import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-lab/todl'
import { DiagramDocument, Figure } from '@pragmatic-lab/mural/framework'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBinding } from '../arch-diagram-binding.js'

const MM = `namespace archmm {
  concept component {}
  viewpoint ComponentView : frames component
}`
function buildModel(): ArchModel {
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))], [], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

test('a figure added after attach is bound + labelled on the next model change', () => {
    const model = buildModel()
    const doc = new DiagramDocument()
    const binding = new ArchDiagramBinding(doc, model)
    binding.attach()

    // Simulate a drop: create the entity, add a figure, set its Id, notify.
    const e = model.createInViewpoint('component', 'ComponentView')
    const fig = doc.CreateNode('rectangle', 0, 0)!
    fig.Id = e.id
    model.notifyChanged()

    expect(fig.LabelText).toBe(e.id)     // bound via rescan (no label field → id)

    // Deleting the entity removes the figure.
    model.remove(e.id)
    expect(doc.Nodes.ToArray().filter((n): n is Figure => n instanceof Figure).map((f) => f.Id)).not.toContain(e.id)
})

test('model is exposed for the binding service', () => {
    const model = buildModel()
    const binding = new ArchDiagramBinding(new DiagramDocument(), model)
    expect(binding.model).toBe(model)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-diagram-binding-rescan.test.ts`
Expected: FAIL — `binding.model` undefined and/or the post-attach figure not labelled (SP4a bound only at attach time).

- [ ] **Step 3: Rewrite the binding to rescan on change**

Replace the body of `arch-diagram-binding.ts` with the rescan design (keep the `displayLabel` helper). Note the constructor now exposes `model` as `public readonly`:

```ts
// arch-diagram-binding.ts
import { DiagramDocument, Figure } from '@pragmatic-lab/mural/framework'
import type { Entity } from '@pragmatic-lab/todl'
import type { ArchModel } from './arch-model.js'

// Binds an opened diagram to a project's ArchModel. On every model change it
// rescans doc.Nodes: Figures whose Id is a live entity are tracked + labelled
// (this binds drop-created figures too, since the drop fires notifyChanged after
// setting Figure.Id); tracked figures whose entity was deleted are removed.
// Figures whose Id matches no entity are freeform shapes, left untouched.
export class ArchDiagramBinding
{
    private off: (() => void) | undefined
    private readonly bound = new Map<string, Figure>()   // entityId -> figure

    public constructor(
        private readonly doc: DiagramDocument,
        public readonly model: ArchModel,
    ) {}

    public attach(): void
    {
        this.rescan()
        this.off = this.model.onChanged(() => this.rescan())
    }

    private rescan(): void
    {
        const byId = new Map(this.model.entities().map((e) => [e.id, e]))
        // Bind + label every figure that maps to a live entity.
        for (const node of this.doc.Nodes.ToArray()) {
            if (!(node instanceof Figure)) continue
            const id = node.Id
            if (id === undefined) continue
            const entity = byId.get(id)
            if (entity === undefined) continue
            this.bound.set(id, node)
            node.LabelText = displayLabel(entity)
        }
        // Remove tracked figures whose entity is gone.
        for (const [id, figure] of [...this.bound]) {
            if (!byId.has(id)) {
                this.doc.DeleteNodes([figure])
                this.bound.delete(id)
            }
        }
    }

    public dispose(): void
    {
        this.off?.()
        this.off = undefined
    }
}

function displayLabel(entity: Entity): string
{
    const v = entity.field('label') ?? entity.field('name')
    return v !== undefined ? String(v) : entity.id
}
```

- [ ] **Step 4: Run both binding test files**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-diagram-binding.test.ts src/renderer/src/modules/architecture-projects/services/tests/arch-diagram-binding-rescan.test.ts`
Expected: PASS — the SP4a tests still pass (rescan is a superset of attach+refresh) and the new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/services/arch-diagram-binding.ts src/renderer/src/modules/architecture-projects/services/tests/arch-diagram-binding-rescan.test.ts
git commit -m "feat(arch): ArchDiagramBinding rescans on change — binds drop-created figures"
```

---

### Task 4: `DropCandidateChooserService` + popup (service headless; template live-smoke)

**Files:**
- Create: `src/renderer/src/modules/architecture-projects/services/drop-candidate-chooser-service.ts`
- Create: `src/renderer/src/modules/architecture-projects/services/chooser.resources.mu`
- Modify: `src/renderer/src/app.mu` (register the service + merge the resources + mount the popup host)
- Test: `src/renderer/src/modules/architecture-projects/services/tests/drop-candidate-chooser-service.test.ts`

**Interfaces:**
- Consumes: `DropAction` (Task 1), `RelayCommand`/`Model`/`ObservableCollection` (mural runtime).
- Produces: `class DropCandidateChooserService extends ServiceBase { static readonly Key; Show(candidates: DropAction[], onPick: (a: DropAction) => void): void; readonly IsOpen; readonly Rows }`; `class ChooserRow extends Model { Label; Command }`.

- [ ] **Step 1: Write the failing test (service logic only — the template is live-smoke)**

```ts
// tests/drop-candidate-chooser-service.test.ts
import { test, expect } from 'vitest'
import { ServiceProvider, type ICommand } from '@pragmatic-lab/mural/runtime'
import { DropActionKind, type DropAction } from '../arch-drop-resolver.js'
import { DropCandidateChooserService, ChooserRow } from '../drop-candidate-chooser-service.js'

const a: DropAction = { kind: DropActionKind.Reference, concept: 'component', member: 'realisedBy', term: 'azure', label: 'component  (realisedBy)' }
const b: DropAction = { kind: DropActionKind.Instance, concept: 'component', label: 'component' }

test('Show builds a row per candidate and opens the popup', () => {
    const svc = new DropCandidateChooserService(new ServiceProvider())
    svc.Show([a, b], () => {})
    expect(svc.IsOpen).toBe(true)
    expect(svc.Rows.ToArray().map((r: ChooserRow) => r.Label)).toEqual([a.label, b.label])
})

test('invoking a row command picks that candidate and closes the popup', () => {
    const svc = new DropCandidateChooserService(new ServiceProvider())
    let picked: DropAction | undefined
    svc.Show([a, b], (chosen) => { picked = chosen })
    const row = svc.Rows.ToArray()[1]
    ;(row.Command as ICommand).Execute(undefined)
    expect(picked).toBe(b)
    expect(svc.IsOpen).toBe(false)
    expect(svc.Rows.ToArray()).toHaveLength(0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/drop-candidate-chooser-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the service**

```ts
// drop-candidate-chooser-service.ts
import {
    MetaData, Model, ObservableCollection, RelayCommand, ServiceBase, ServiceKey,
    type ICommand, type IServiceProvider,
} from '@pragmatic-lab/mural/runtime'
import type { DropAction } from './arch-drop-resolver.js'

// One selectable candidate row. A Model so the .mu template binds $Label / $Command.
export class ChooserRow extends Model
{
    public static readonly LabelKey = Model.RegisterProperty<string>(ChooserRow, 'Label', '', MetaData.None)
    public static readonly CommandKey = Model.RegisterProperty<ICommand | undefined>(ChooserRow, 'Command', undefined, MetaData.None)

    public constructor(label: string, command: ICommand)
    {
        super()
        this.set_property_value(ChooserRow.LabelKey, label)
        this.set_property_value(ChooserRow.CommandKey, command)
    }

    public get Label(): string { return this.get_property_value(ChooserRow.LabelKey) }
    public get Command(): ICommand | undefined { return this.get_property_value(ChooserRow.CommandKey) }
}

// App-scoped popup for the multi-candidate drop case: Show() lists the candidates
// and invokes onPick with the chosen one (click-away leaves it unchosen). The
// .mu chooser.resources popup binds $IsOpen / $Rows against this service.
export class DropCandidateChooserService extends ServiceBase
{
    public static readonly Key = new ServiceKey<DropCandidateChooserService>('DropCandidateChooserService')

    public static readonly IsOpenKey = Model.RegisterProperty<boolean>(DropCandidateChooserService, 'IsOpen', false, MetaData.None)
    public static readonly RowsKey = Model.RegisterProperty<ObservableCollection<ChooserRow>>(
        DropCandidateChooserService, 'Rows', undefined as unknown as ObservableCollection<ChooserRow>, MetaData.None)

    public constructor(provider: IServiceProvider)
    {
        super(provider)
        this.set_property_value(DropCandidateChooserService.RowsKey, new ObservableCollection<ChooserRow>())
    }

    public get IsOpen(): boolean { return this.get_property_value(DropCandidateChooserService.IsOpenKey) }
    public get Rows(): ObservableCollection<ChooserRow> { return this.get_property_value(DropCandidateChooserService.RowsKey) }

    public Show(candidates: DropAction[], onPick: (a: DropAction) => void): void
    {
        const rows = this.Rows
        rows.Clear()
        for (const action of candidates) {
            const row = new ChooserRow(action.label, new RelayCommand(() => { this.close(); onPick(action) }))
            rows.Add(row)
        }
        this.set_property_value(DropCandidateChooserService.IsOpenKey, true)
    }

    private close(): void
    {
        this.set_property_value(DropCandidateChooserService.IsOpenKey, false)
        this.Rows.Clear()
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/drop-candidate-chooser-service.test.ts`
Expected: PASS (2 tests). If `RelayCommand.Execute` is named differently, mirror `problems-service.ts`'s `RelayCommand` usage.

- [ ] **Step 5: Write the popup template `chooser.resources.mu`**

Mirror the Problems popup skeleton, minus the toolbar. The `MenuButton` face is a zero-size hidden trigger; the popup lists `$Rows`. Its `DataContext` is the service (mounted in app.mu, Step 6).

```mu
// The drop-candidate chooser: a hidden MenuButton whose popup lists the
// candidate (X,m) actions for an ambiguous term-drop. IsOpen / Rows bind the
// DropCandidateChooserService (its DataContext at the mount site).
resources {

    ItemsPanelTemplate x:key="ChooserListPanel" {
        VirtualizingStackPanel [ Orientation = Vertical, ItemHeight = 28 ]
    }

    // A candidate row: a full-width button that invokes its pick Command.
    DataTemplate [ DataType = ChooserRow ] {
        Button [ Command = $Command, HorizontalAlignment = Stretch, MinWidth = 220, Padding = (10,4,10,4) ] {
            TextBlock [ Text = $Label, HorizontalAlignment = Left ]
        }
    }

    // The popup control template: preserves the MenuButton popup contract.
    Template x:key="ChooserPopup" [ TargetType = MenuButton ] {
        MenuPopupHost x:name="PART_PopupHost" {
            ClickAwayScrim x:name="PART_Scrim" [ BorderThickness = (0) ]
            Border x:name="PART_PopupContainer"
                [ Background = @SurfaceContainerHigh, BorderBrush = @OutlineVariant, BorderThickness = (1),
                  CornerRadius = @ShapeSmall, MinWidth = 240 ] {
                ScrollViewer [ MaxHeight = 320, HorizontalScrollEnabled = false ] {
                    ItemsControl [ ItemsSource = $Rows, ItemsPanel = @ChooserListPanel ]
                }
            }
        }
    }

    // A near-invisible trigger (the popup floats from here). Kept tiny so it does
    // not occupy layout; IsOpen is driven by the service, not by clicking it.
    Template x:key="ChooserTrigger" [ TargetType = MenuButton ] {
        Button x:name="PART_Trigger" [ Width = 1, Height = 1, Opacity = 0 ]
    }

    // The mount: a MenuButton bound to the chooser service. Placed as an overlay
    // in the shell so its popup can appear over any content.
    DataTemplate x:key="DropChooserHost" [ DataType = DropCandidateChooserService ] {
        MenuButton
            [ IsOpen          = $IsOpen,
              Template        = @ChooserPopup,
              TriggerTemplate = @ChooserTrigger,
              HorizontalAlignment = Left, VerticalAlignment = Top ]
    }
}
```

- [ ] **Step 6: Register the service + mount the host in `app.mu`**

In `app.mu`:
1. Add the import beside the other architecture-projects services:
   `import DropCandidateChooserService from "./modules/architecture-projects/services/drop-candidate-chooser-service.js"`
2. Add `DropCandidateChooserService` to the `.services:` block (after `ArchDiagramBindingService`).
3. Merge the chooser resources: add `merge ChooserResources` (import it: `import ChooserResources from "./modules/architecture-projects/services/chooser.resources.mu.js"`) into the app's `resources:` block, alongside the other `merge` entries.
4. Mount the host overlay: in the shell's content/overlay region markup, add a `ContentControl [ Content = $service(DropCandidateChooserService), ContentTemplate = @DropChooserHost ]` (mirror how the Problems dock is placed via a ShellControlDefinition referencing its service Key). If the shell has no free overlay slot, place the `ContentControl` at the end of the root `DockPanel`/`Grid` in `app.mu` so the floating popup can overlay the canvas.

- [ ] **Step 7: Compile + typecheck**

Run:
- `npm run compile:mu` — Expected: clean (`chooser.resources.mu` + `app.mu` compile).
- `npm run typecheck:web` — Expected: clean.
- `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/drop-candidate-chooser-service.test.ts` — Expected: PASS.

If `merge`/`$service`/overlay mounting differs from what the shell expects, consult `problems.resources.mu` + how `app.mu` merges/places the Problems dock and mirror it exactly. The popup's on-screen behavior (position, click-away) is verified in the live-smoke step, not here.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/services/drop-candidate-chooser-service.ts src/renderer/src/modules/architecture-projects/services/chooser.resources.mu src/renderer/src/modules/architecture-projects/services/tests/drop-candidate-chooser-service.test.ts src/renderer/src/app.mu
git commit -m "feat(arch): DropCandidateChooserService + popup for ambiguous term-drops"
```

---

### Task 5: Wire `ArchInstanceDropFactory` (routing + Figure + save)

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-instance-drop-factory.ts`
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-diagram-binding-service.ts` (add `modelForDocument`)
- Modify: `src/renderer/src/modules/diagram/services/register-arch-toolbox-adapters.ts` (pass provider)
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-instance-drop-factory.test.ts`

**Interfaces:**
- Consumes: `resolveDropActions` (Task 1), `ArchModel.createInViewpoint/addRef/save/notifyChanged/repository/viewpoints` (Task 2), `ArchDiagramBindingService.modelForDocument`, `DropCandidateChooserService.Show`.
- Produces: `ArchInstanceDropFactory` constructed with a `ServiceProvider`; full `CreateDropped`.

- [ ] **Step 1: Add `modelForDocument` to `ArchDiagramBindingService`**

```ts
    // The ArchModel bound to an open document, if it is an attached architecture
    // diagram. Used by the drop factory to route a term-drop.
    public modelForDocument(doc: IDocument): ArchModel | undefined
    {
        return this.bindings.get(doc)?.model
    }
```

Add `import type { ArchModel } from './arch-model.js'` to that file if not present.

- [ ] **Step 2: Write the failing test**

```ts
// tests/arch-instance-drop-factory.test.ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { DiagramDocument, Figure, type ToolboxDropContext } from '@pragmatic-lab/mural/framework'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-lab/todl'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBindingService } from '../arch-diagram-binding-service.js'
import { DropCandidateChooserService } from '../drop-candidate-chooser-service.js'
import { ArchInstanceDropFactory } from '../arch-instance-drop-factory.js'

const MM = `namespace archmm {
  concept technology {}
  concept component { relationship realisedBy -> technology; }
  viewpoint ComponentView : frames component
  taxonomy Stack : represents technology { term azure {} }
}`
function buildModel(storage: FakeStorage): ArchModel {
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))], [], { namespace: 'archmm' })
    return new ArchModel(draft, storage, 'archmm')
}

// A provider whose ArchDiagramBindingService maps `doc` → `model`.
function wire(doc: DiagramDocument, model: ArchModel | undefined) {
    const provider = new ServiceProvider()
    provider.registerInstance(ArchDiagramBindingService.Key, { modelForDocument: (d: unknown) => (d === doc ? model : undefined) } as unknown as ArchDiagramBindingService)
    provider.registerInstance(DropCandidateChooserService.Key, new DropCandidateChooserService(provider))
    return provider
}

function ctx(doc: DiagramDocument, key: string): ToolboxDropContext {
    return { Descriptor: { Key: key }, Position: { X: 5, Y: 6 }, Diagram: {}, Mutator: doc } as unknown as ToolboxDropContext
}

test('a single-candidate drop creates the routed entity + a bound Figure', () => {
    const storage = new FakeStorage('fake://Acme')
    const model = buildModel(storage)
    const doc = new DiagramDocument()
    const factory = new ArchInstanceDropFactory(wire(doc, model))

    const result = factory.CreateDropped(ctx(doc, 'azure')) as Figure
    expect(result).toBeInstanceOf(Figure)
    // Entity created: a component that references azure via realisedBy.
    const comp = model.entities().find((e) => e.concept === 'component')!
    expect(comp).toBeDefined()
    expect(result.Id).toBe(comp.id)
})

test('a no-candidate drop returns null and mutates nothing', () => {
    const storage = new FakeStorage('fake://Acme')
    const model = buildModel(storage)
    const doc = new DiagramDocument()
    const factory = new ArchInstanceDropFactory(wire(doc, model))
    const before = model.entities().length
    expect(factory.CreateDropped(ctx(doc, 'nonesuch'))).toBeNull()
    expect(model.entities().length).toBe(before)
})

test('a non-architecture document falls back to a plain CreateNode', () => {
    const doc = new DiagramDocument()
    const factory = new ArchInstanceDropFactory(wire(doc, undefined))   // no model
    const result = factory.CreateDropped(ctx(doc, 'rectangle')) as Figure
    expect(result).toBeInstanceOf(Figure)
    expect(result.Kind).toBe('rectangle')
})
```

- [ ] **Step 3: Rewrite `arch-instance-drop-factory.ts`**

```ts
import { ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { Figure, type IDocument, type IToolboxDropFactory, type ToolboxDropContext } from '@pragmatic-lab/mural/framework'

import { resolveDropActions, DropActionKind, type DropAction } from './arch-drop-resolver.js'
import { ArchDiagramBindingService } from './arch-diagram-binding-service.js'
import { DropCandidateChooserService } from './drop-candidate-chooser-service.js'
import type { ArchModel } from './arch-model.js'

export const ArchInstanceDropFactoryKey = new ServiceKey<IToolboxDropFactory>('ArchInstanceDropFactory')

// Drops a toolbox term onto a diagram. For an architecture diagram it routes the
// drop through the project's ArchModel (Phase-3 semantics): resolve candidate
// (X,m) actions from the meta-model schema — 0 reject, 1 auto, many chooser —
// then create the routed entity, wire the reference, materialize a bound Figure,
// and persist. A standalone diagram (no ArchModel) falls back to a plain shape.
export class ArchInstanceDropFactory implements IToolboxDropFactory
{
    public constructor(private readonly provider: IServiceProvider) {}

    public CreateDropped(context: ToolboxDropContext): unknown | null
    {
        const doc = context.Mutator as unknown as IDocument
        const model = this.provider.get(ArchDiagramBindingService.Key)?.modelForDocument(doc)
        if (model === undefined) {
            // Standalone diagram: keep the old generic behavior.
            return context.Mutator.CreateNode(context.Descriptor.Key, context.Position.X, context.Position.Y) ?? null
        }

        const scope = new Set(model.viewpoints().map((v) => v.id))
        const actions = resolveDropActions(model.repository(), context.Descriptor.Key, scope)
        if (actions.length === 0) return null
        if (actions.length === 1) return this.apply(model, context, actions[0])

        this.provider.getRequired(DropCandidateChooserService.Key).Show(actions, (chosen) => { this.apply(model, context, chosen) })
        return null
    }

    // Create the entity for `action`, wire any reference, materialize the bound
    // Figure, and persist. Returns the Figure (null if no framing viewpoint).
    private apply(model: ArchModel, context: ToolboxDropContext, action: DropAction): Figure | null
    {
        const scope = new Set(model.viewpoints().map((v) => v.id))
        const vp = [...model.repository().viewpointsFraming(action.concept)].find((v) => scope.has(v))
        if (vp === undefined) return null

        const entity = model.createInViewpoint(action.concept, vp)
        if (action.kind === DropActionKind.Reference && action.member !== undefined && action.term !== undefined)
            model.addRef(entity.id, action.member, action.term)

        const fig = context.Mutator.CreateNode(context.Descriptor.Key, context.Position.X, context.Position.Y) as Figure | null
        if (fig !== null) fig.Id = entity.id
        model.notifyChanged()      // rescan binds + labels the new figure
        void model.save()          // persist the .todl (fire-and-forget)
        return fig
    }
}
```

- [ ] **Step 4: Pass the provider in `register-arch-toolbox-adapters.ts`**

Change the registration:

```ts
    if (!services.has(ArchInstanceDropFactoryKey))
    {
        services.registerInstance(ArchInstanceDropFactoryKey, new ArchInstanceDropFactory(services))
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-instance-drop-factory.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Full verification**

Run from the Plexus root:
- `npm run compile:mu` — Expected: clean.
- `npm run typecheck:web` — Expected: clean.
- `npm test` — Expected: all suites pass (prior + the five new SP4b suites).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/services/arch-instance-drop-factory.ts src/renderer/src/modules/architecture-projects/services/arch-diagram-binding-service.ts src/renderer/src/modules/diagram/services/register-arch-toolbox-adapters.ts src/renderer/src/modules/architecture-projects/services/tests/arch-instance-drop-factory.test.ts
git commit -m "feat(arch): wire term-drop routing through ArchModel + chooser"
```

---

## Live-GUI smoke (manual, after the suite is green)

Run the app (`npm run dev`), open an architecture project with a meta-model + a library, open a `.diagram`, and:
1. Drag a library term whose type has exactly one referencing member → a node appears with the term's icon; the `.todl` gains a routed entity in the viewpoint file.
2. Drag a term with several candidates → the chooser popup lists them; picking one creates the node; click-away cancels.
3. Confirm a standalone (non-architecture) diagram still drops plain shapes.

Report anything the headless tests can't cover (popup position, icon correctness, click-away).

## Notes for the implementer

- **`ToolboxDropContext` shape in tests** is faked via `as unknown as ToolboxDropContext`; only `Descriptor.Key`, `Position`, `Mutator` are read.
- **`apply` recomputes `scope`** rather than threading it — cheap and avoids passing state through the chooser callback.
- **Do NOT** narrow `scope` to a diagram's selected viewpoints, persist selected viewpoints, or add the `instance` annotation — those are SP4c.
- **Chooser mount (Task 4 Step 6)** is the one piece the suite can't prove; mirror the Problems dock's `app.mu` placement exactly and rely on the live-smoke step.

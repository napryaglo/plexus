# Architecture Canvas (Phase 3, Part 2 — Canvas) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Put the Phase-3 headless core (`ArchInstanceModel` + `.todl` emitter + `InstanceNodeVM`, already built) on a concept-aware canvas: drop a bound-library **term** to create a meta-model concept instance that references it, render each node via the term's library template, connect nodes to set reference members, and persist to a `.archdiagram` (layout) + emitted `.todl` (semantics).

**Architecture:** An `ArchDiagramDocument` (an `IDocument`) holds an `ArchInstanceModel` + a layout map; its editor is a `DataTemplate[ArchDiagramDocument]` hosting an `ArchDiagram` (a Plexus `Diagram` subclass) whose nodes are `InstanceNodeVM`s rendered through `Figure.Content`/`ContentTemplate` = `LibraryRegistry.resolve(term)`. A term palette drags `plexus/class-ref`; the drop and connector-created handlers mutate the model; Save emits `.todl` (validated by the existing `TodlValidationService`) + writes `.archdiagram`.

**Tech Stack:** TypeScript, Electron renderer, `@pragmatic-lab/mural/framework` (`Diagram`, `Figure`, `DiagramDocument` patterns, `ItemDroppedArgs`, `ConnectorCreatedArgs`), `@pragmatic-lab/todl`, `LibraryRegistry` (Phase 2), Vitest, `FakeStorage`.

## Global Constraints (verified against the real APIs)

- **Every test file lives in a `tests/` subfolder.** Enums over string-literal unions in our code.
- **Core (already built, do not re-implement):** `ArchInstanceModel` (`load(bases, source, ns)`, `ownInstances()`, `node(id)`, `document`, `createInstance(concept)`, `setField`, `addRelationship(from, member, to)`, `removeRelationship`, `remove`, `repository()`, `referenceMembers(fromId, toId): FieldSchema[]`, `emit()`, `onChanged`), `emitInstances(own, ns)`, `InstanceNodeVM(model, id)` (`Display`/`Concept`/`ReferencedTerm`/`SetField`/`Dispose`). All in `src/renderer/src/modules/architecture-repository/services/`.
- **TODL facts:** concepts are nodes with `typeOf === 'concept'`; a term is referenced (not `instanceof`'d); schema fields require base **edges** in the derived repo (the model includes them). `resolveBases(provider, {metaModel, libraries})` yields base `TodlDocument[]`.
- **Mural seams (no framework changes):** `Diagram` bound via `ItemsSource = $Nodes, Connectors = $Connectors, DropReceiver = $Self` (see `diagram.resources.mu`); `Diagram.GetContainerForItemOverride(item)` returns a `Figure`/`Group` directly else wraps+binds `DataContext`; `Figure extends ContentControl` (`Content`/`ContentTemplate` DPs); `Diagram.AddItemDroppedListener((a:{Data:DataObject, Position:Point})=>…)`; `Diagram.AddConnectorCreatedListener((a:{Source:ConnectorEndpoint, Target:ConnectorEndpoint})=>…)` where an endpoint carries `.Node` (a `Figure`); `IDocument = { Id, Title, IsDirty, Save() }`.
- **Document-factory pattern:** `IDocumentFactory { openFile(storage,path), saveFile(document), newFile(storage,name) }` registered via a module `.documents:` entry keyed by extension (see `DiagramDocumentFactory`, `TodlDocumentFactory`).
- Run one test: `npx vitest run <path>`; full suite `npx vitest run`; markup `npm run compile:mu`; types `npm run typecheck`; live check `npm run dev`.
- **Visual/integration tasks that can't be unit-tested end in a live `npm run dev` smoke gate** — that is the deliverable's verification, not a skipped test.

## File Structure

- Create `…/architecture-repository/services/drop-resolver.ts` — `resolveTermDrop(model, termId)` (headless).
- Create `…/architecture-repository/services/arch-diagram-document.ts` — `ArchDiagramDocument` (IDocument) + layout I/O.
- Create `…/architecture-repository/services/arch-diagram-document-factory.ts` — `ArchDiagramDocumentFactory`.
- Create `…/architecture-repository/services/arch-diagram.ts` — `ArchDiagram extends Diagram`.
- Create `…/architecture-repository/services/arch-terms-palette-service.ts` — bound-library term palette + drop/connector handlers.
- Create `…/architecture-repository/architecture-repository.resources.mu` — `DataTemplate[ArchDiagramDocument]` + Figure content template + palette templates.
- Create `…/icons/arch-diagram.svg`.
- Modify `architecture-repository.module.mu` (.documents + .services), `app.mu` (merge resources), `plexus-icons.mu`, `package.json` (compile:mu).

---

## Task 1: Term-drop resolver (headless)

**Files:** Create `…/services/drop-resolver.ts`; Test `…/services/tests/drop-resolver.test.ts`.

**Interfaces:**
- Consumes: `ArchInstanceModel.repository()`.
- Produces: `interface DropTarget { concept: string; member: string }` and `resolveTermDrop(model: ArchInstanceModel, termId: string): DropTarget[]` — every `(concept, referenceField)` where a concept has a field whose type the term's concept satisfies. One ⇒ auto-create; several ⇒ chooser; none ⇒ reject.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'vitest'
import { check, checkAgainst, toJSON, type TodlDocument } from '@pragmatic-lab/todl'
import { ArchInstanceModel } from '../architecture-instance-model.js'
import { resolveTermDrop } from '../drop-resolver.js'

const META = `namespace ea {
  concept technology { label : string; }
  concept component { label : string; realised-by : technology?; }
  concept location { label : string; }
}`
const LIB = `namespace ms { taxonomy stack : represents technology {
  technology azure-openai { label = "Azure OpenAI"; }
} }`
function model(): ArchInstanceModel {
    const metaDoc = toJSON(check([{ uri: 'ea.todl', text: META }]).model)
    const libDoc = toJSON(checkAgainst([metaDoc], [{ uri: 'ms.todl', text: LIB }]).model)
    return ArchInstanceModel.load([metaDoc, libDoc] as TodlDocument[], '', 'app')
}

test('resolves a technology term to the concept+member that can reference it', () => {
    expect(resolveTermDrop(model(), 'stack.azure-openai')).toEqual([{ concept: 'component', member: 'realised-by' }])
})

test('a term no concept references resolves to no targets', () => {
    // Nothing has a `location`-typed field, so dropping a location term is unhandled.
    // (Add a location term via a second taxonomy in a fuller fixture; here assert the empty case.)
    expect(resolveTermDrop(model(), 'nonexistent.term')).toEqual([])
})
```

- [ ] **Step 2: Run — expect FAIL** (`../drop-resolver.js` missing).
Run: `npx vitest run src/renderer/src/modules/architecture-repository/services/tests/drop-resolver.test.ts`

- [ ] **Step 3: Implement**

```ts
import type { ArchInstanceModel } from './architecture-instance-model.js'

export interface DropTarget { concept: string; member: string }

// Every (concept, reference-field) pair where the concept has a field whose type
// the dropped term's concept is (or a subtype of). The canvas creates a concept
// instance of `concept` and sets `member = &term`. Concepts are `typeOf==='concept'`
// nodes; schema fields come from the derived repo (which carries base edges).
export function resolveTermDrop(model: ArchInstanceModel, termId: string): DropTarget[]
{
    const repo = model.repository()
    const termConcept = repo.resolve(termId)?.typeOf
    if (termConcept === undefined) return []
    const compatible = new Set([termConcept, ...repo.supertypesOf(termConcept)])
    const out: DropTarget[] = []
    for (const n of repo.allNodes()) {
        if (n.typeOf !== 'concept') continue
        for (const f of repo.effectiveSchema(n.id).fields) {
            if (compatible.has(f.type)) out.push({ concept: n.id, member: f.name })
        }
    }
    return out
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(architecture): resolveTermDrop — term → (concept, referenceField)`.

---

## Task 2: `ArchDiagramDocument` + factory (layout + `.todl` persistence)

**Files:** Create `…/services/arch-diagram-document.ts`, `…/services/arch-diagram-document-factory.ts`; Test `…/services/tests/arch-diagram-document.test.ts`.

**Interfaces:**
- Consumes: `ArchInstanceModel`, `resolveBases`, `IStorage`, `IDocument`/`IDocumentFactory`.
- Produces:
  - `interface ArchLayout { namespace: string; todlFile: string; layout: Record<string, {x:number;y:number}>; version: number }`
  - `class ArchDiagramDocument extends Model implements IDocument` with `Id`, `Title`, `IsDirty`, `Save()`, `Model: ArchInstanceModel`, `LayoutOf(id)`, `SetLayout(id,x,y)`, `Nodes: ObservableCollection<InstanceNodeVM>` (kept in sync with the model), and `AddNode(id)` used by the drop handler.
  - `class ArchDiagramDocumentFactory` (openFile/saveFile/newFile) for the `.archdiagram` extension.

- [ ] **Step 1: Write the failing test** (save writes both files; open restores)

```ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { check, checkAgainst, toJSON } from '@pragmatic-lab/todl'
import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { META_MODELS_BACKEND_ID } from '../../../meta-model/services/meta-models-backend.js'
import { LIBRARIES_BACKEND_ID } from '../../../library/services/libraries-backend.js'
import { ArchDiagramDocumentFactory } from '../arch-diagram-document-factory.js'
import { ArchDiagramDocument } from '../arch-diagram-document.js'

// A provider whose meta-models + libraries backends hold a published EA meta-model
// and a technology library, and a project whose manifest binds them.
function env() {
    const provider = new ServiceProvider()
    const reg = new StorageProviderRegistry(provider)
    const meta = new FakeStorage('fake://meta-models'); const libs = new FakeStorage('fake://libraries')
    reg.Register(META_MODELS_BACKEND_ID, () => meta); reg.Register(LIBRARIES_BACKEND_ID, () => libs)
    provider.registerInstance(StorageProviderRegistry.Key, reg)
    const metaDoc = toJSON(check([{ uri:'ea.todl', text:'namespace ea { concept technology { label:string; } concept component { label:string; realised-by:technology?; } }' }]).model)
    void meta.WriteText('ea/1/model.json', JSON.stringify(metaDoc))
    const libDoc = toJSON(checkAgainst([metaDoc], [{ uri:'ms.todl', text:'namespace ms { taxonomy stack : represents technology { technology azure-openai { label="Azure OpenAI"; } } }' }]).model)
    void libs.WriteText('ms/1/model.json', JSON.stringify(libDoc))
    const project = new FakeStorage('fake://proj')
    void project.WriteText('project.plexus', JSON.stringify({ type:'architecture', name:'Proj', metaModel:{id:'ea',version:'1'}, libraries:[{id:'ms',version:'1'}] }))
    return { provider, project }
}

test('newFile then Save writes a .archdiagram and a sibling .todl; open restores the model', async () => {
    const { provider, project } = env()
    const f = new ArchDiagramDocumentFactory(provider)
    const path = await f.newFile(project, 'system')            // system.archdiagram
    const doc = await f.openFile(project, path) as ArchDiagramDocument

    const id = doc.Model.createInstance('component')
    doc.Model.setField(id, 'label', 'Gateway')
    doc.Model.addRelationship(id, 'realised-by', 'stack.azure-openai')
    doc.SetLayout(id, 120, 80)
    await f.saveFile(doc)

    expect(await project.Exists('system.archdiagram')).toBe(true)
    const todl = await project.ReadText('system.todl')
    expect(todl).toContain('component ')
    expect(todl).toContain('realised-by = &stack.azure-openai;')
    const layout = JSON.parse(await project.ReadText('system.archdiagram'))
    expect(layout.layout[id]).toEqual({ x: 120, y: 80 })

    const reopened = await f.openFile(project, path) as ArchDiagramDocument
    expect(reopened.Model.ownInstances()).toEqual([id])
    expect(reopened.LayoutOf(id)).toEqual({ x: 120, y: 80 })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `arch-diagram-document.ts`**

```ts
import { MetaData, Model, ObservableCollection } from '@pragmatic-lab/mural/runtime'
import type { IDocument } from '@pragmatic-lab/mural/framework'
import type { IStorage } from '../../../services/storage/storage.js'
import { ArchInstanceModel } from './architecture-instance-model.js'
import { InstanceNodeVM } from './instance-node-vm.js'

export interface ArchLayout { namespace: string; todlFile: string; layout: Record<string, { x: number; y: number }>; version: number }

export class ArchDiagramDocument extends Model implements IDocument
{
    public static readonly TitleKey = Model.RegisterProperty<string>(ArchDiagramDocument, 'Title', '', MetaData.None)

    public readonly Nodes = new ObservableCollection<InstanceNodeVM>()
    private readonly positions = new Map<string, { x: number; y: number }>()
    private dirty = false

    constructor(
        public readonly Id: string,               // the .archdiagram project-relative path
        public readonly Model: ArchInstanceModel,
        public readonly storage: IStorage,
        public readonly todlFile: string,
        layout: Record<string, { x: number; y: number }>,
        title: string,
    )
    {
        super()
        this.set_property_value(ArchDiagramDocument.TitleKey, title)
        for (const [id, p] of Object.entries(layout)) this.positions.set(id, p)
        for (const id of Model.ownInstances()) this.AddNode(id)
        Model.onChanged(() => { this.dirty = true })
    }

    public get Title(): string { return this.get_property_value(ArchDiagramDocument.TitleKey) }
    public get IsDirty(): boolean { return this.dirty }

    public LayoutOf(id: string): { x: number; y: number } | undefined { return this.positions.get(id) }
    public SetLayout(id: string, x: number, y: number): void { this.positions.set(id, { x, y }); this.dirty = true }

    // Materialise a node VM for an instance id (used on open + on drop-create).
    public AddNode(id: string): InstanceNodeVM
    {
        const vm = new InstanceNodeVM(this.Model, id)
        this.Nodes.Add(vm)
        return vm
    }

    public async Save(): Promise<void>
    {
        await this.storage.WriteText(this.todlFile, this.Model.emit())
        const doc: ArchLayout = {
            namespace: this.Model.namespace, todlFile: this.todlFile,
            layout: Object.fromEntries(this.positions), version: 1,
        }
        await this.storage.WriteText(this.Id, JSON.stringify(doc, null, 2))
        this.dirty = false
    }
}
```

- [ ] **Step 4: Implement `arch-diagram-document-factory.ts`**

```ts
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import type { IDocument } from '@pragmatic-lab/mural/framework'
import type { IDocumentFactory } from '../../../services/documents/document-factory.js'
import type { IStorage } from '../../../services/storage/storage.js'
import { PROJECT_MANIFEST_FILENAME } from '../../../services/projects/project-factory.js'
import type { BaseBindings } from '../../../services/projects/base-binding.js'
import { resolveBases } from '../../../services/projects/base-resolver.js'
import { ArchInstanceModel } from './architecture-instance-model.js'
import { ArchDiagramDocument, type ArchLayout } from './arch-diagram-document.js'

export class ArchDiagramDocumentFactory extends ServiceBase implements IDocumentFactory
{
    public static readonly Key = new ServiceKey<ArchDiagramDocumentFactory>('ArchDiagramDocumentFactory')
    constructor(provider: IServiceProvider) { super(provider) }

    public async openFile(storage: IStorage, path: string): Promise<IDocument>
    {
        const layoutDoc = JSON.parse(await storage.ReadText(path)) as ArchLayout
        const { bases } = await resolveBases(this.Provider, await this.bindings(storage))
        const source = (await storage.Exists(layoutDoc.todlFile)) ? await storage.ReadText(layoutDoc.todlFile) : ''
        const model = ArchInstanceModel.load(bases, source, layoutDoc.namespace)
        return new ArchDiagramDocument(path, model, storage, layoutDoc.todlFile, layoutDoc.layout ?? {}, basename(path))
    }

    public async saveFile(document: IDocument): Promise<void> { await (document as ArchDiagramDocument).Save() }

    public async newFile(storage: IStorage, name: string): Promise<string>
    {
        const base = ensureNoExt(name)
        const path = `${base}.archdiagram`
        const layout: ArchLayout = { namespace: base, todlFile: `${base}.todl`, layout: {}, version: 1 }
        await storage.WriteText(path, JSON.stringify(layout, null, 2))
        await storage.WriteText(layout.todlFile, `namespace ${base}\n{\n}\n`)
        return path
    }

    private async bindings(storage: IStorage): Promise<BaseBindings>
    {
        try {
            const m = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as BaseBindings
            return { metaModel: m.metaModel, libraries: m.libraries }
        } catch { return {} }
    }
}

function basename(p: string): string { const s = p.split(/[\\/]/); return s[s.length - 1] || p }
function ensureNoExt(n: string): string { return n.replace(/\.archdiagram$/i, '') }
```

- [ ] **Step 5: Run — expect PASS.** Fix per messages (e.g. `resolveBases` dedup already handled inside the model).
- [ ] **Step 6: Commit** `feat(architecture): ArchDiagramDocument + factory (.archdiagram layout + emitted .todl)`.

---

## Task 3: `ArchDiagram` (concept-aware node container)

**Files:** Create `…/services/arch-diagram.ts`; Test `…/services/tests/arch-diagram.test.ts`.

**Interfaces:**
- Consumes: `Diagram`, `Figure` (mural), `LibraryRegistry` (Phase 2), `InstanceNodeVM`, `ArchDiagramDocument` (for layout).
- Produces: `class ArchDiagram extends Diagram` overriding `GetContainerForItemOverride(item)` to build a `Figure` for an `InstanceNodeVM`: `Content = vm`, `ContentTemplate = registry.resolve(vm.ReferencedTerm, vm.Concept)`, `Left/Top` from the document layout, fixed `width/height` (e.g. 160×72). A `Registry`/`Document` DP wires those collaborators.

- [ ] **Step 1: Write the failing test** (a container is a Figure carrying the vm + resolved template)

```ts
import { test, expect } from 'vitest'
// build a LibraryRegistry over a FakeStorage backend with one library term template
// (reuse the Phase-2 registry test harness), an ArchInstanceModel with one instance
// referencing that term, an ArchDiagramDocument, then:
//   const fig = archDiagram.GetContainerForItemOverride(vm)
//   expect(fig).toBeInstanceOf(Figure)
//   expect(fig.Content).toBe(vm)
//   expect(fig.ContentTemplate).toBe(registry.resolve(vm.ReferencedTerm, vm.Concept))
//   expect(fig.Left).toBe(<layout x>)
// (Full harness mirrors library-registry.test.ts + arch-diagram-document.test.ts.)
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** `ArchDiagram` per the Interfaces block (DP-wire `Registry` + `Document`; override `GetContainerForItemOverride`; fall back to `super` for non-VM items).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(architecture): ArchDiagram renders instance nodes via their term template`.

---

## Task 4: Figure content template + editor resources (markup — live-smoke)

**Files:** Create `…/architecture-repository.resources.mu`; Modify `app.mu`, `package.json`.

- [ ] **Step 1** — `DataTemplate[ArchDiagramDocument]` hosts an `ArchDiagram [ ItemsSource = $Nodes, Connectors = $Connectors, DropReceiver = $Self, Registry = …, Document = $Self ]` (mirror `diagram.resources.mu`'s Diagram binding).
- [ ] **Step 2** — Override the `Figure` template for arch nodes: a `Border` + `ContentPresenter [ Content = $Content, ContentTemplate = $ContentTemplate ]` so a node draws its term's visual (default box when untemplated).
- [ ] **Step 3** — `import ArchitectureResources … .mu.js` + `merge ArchitectureResources` in `app.mu`; add the `.mu` to `compile:mu`.
- [ ] **Step 4** — `npm run compile:mu` + `npm run typecheck` clean.
- [ ] **Step 5: Commit**; then **live-smoke** deferred to Task 7.

---

## Task 5: Term palette + drop-create (drop handler testable; canvas live-smoke)

**Files:** Create `…/services/arch-terms-palette-service.ts`; Test `…/services/tests/arch-terms-palette-service.test.ts`; add palette templates to the resources file.

**Interfaces:** a palette service exposing the bound-library terms (from `LibraryRegistry` filtered to the project's `libraries[]`), each draggable as `plexus/class-ref = { termId }`; a pure drop handler `applyTermDrop(doc, term, x, y): void` — `resolveTermDrop`; one target ⇒ `createInstance(concept)` + `addRelationship(id, member, term)` + `doc.SetLayout(id,x,y)` + `doc.AddNode(id)`; several ⇒ a chooser (v1: pick the first + log the alternatives); none ⇒ no-op + a status message.

- [ ] **Step 1: Write the failing test** for `applyTermDrop` (given a doc + a term with one target, a node is created referencing it and positioned).
- [ ] **Step 2–4:** implement + pass.
- [ ] **Step 5:** palette template (`DataTemplate[DataType=<PaletteService>]` + draggable term tile emitting `plexus/class-ref`); wire `ArchDiagram.AddItemDroppedListener` → read `plexus/class-ref` from `args.Data` → `applyTermDrop(doc, term, args.Position.X, args.Position.Y)`.
- [ ] **Step 6: Commit**; canvas behavior verified in Task 7 live-smoke.

---

## Task 6: Connector-created → reference member (resolution testable; live-smoke)

**Files:** add to `arch-terms-palette-service.ts` (or a `arch-connector-handler.ts`); Test alongside.

**Interfaces:** a pure `applyConnect(model, fromId, toId): 'ok'|'ambiguous'|'none'` — `referenceMembers(fromId,toId)`; one ⇒ `addRelationship(fromId, member, toId)` return 'ok'; several ⇒ 'ambiguous' (v1: pick first, add it); none ⇒ 'none' (no mutation).

- [ ] **Step 1: Write the failing test** (connecting a component to a technology term-node adds the `realised-by` edge).
- [ ] **Step 2–4:** implement + pass.
- [ ] **Step 5:** wire `ArchDiagram.AddConnectorCreatedListener` → map `args.Source.Node`/`args.Target.Node` (Figures) → their `InstanceNodeVM.Id` → `applyConnect`.
- [ ] **Step 6: Commit.**

---

## Task 7: Module wiring + live smoke

**Files:** Modify `architecture-repository.module.mu` (add `.documents:` entry `Type="architecture-diagram"`, `FileExtensions=[".archdiagram"]`, `Factory=ArchDiagramDocumentFactory`; register `ArchDiagramDocumentFactory` + palette service in `.services:`); `plexus-icons.mu` (+ `arch-diagram.svg`); `package.json` (compile the resources `.mu`); a "New Architecture Diagram" affordance (the project explorer's new-file uses the factory's `newFile`).

- [ ] **Step 1–4:** wire, `compile:mu`, `typecheck`, full `vitest run` green.
- [ ] **Step 5: Commit.**
- [ ] **Step 6: Live smoke (`npm run dev`) — the acceptance gate:**
  1. In an architecture project bound to a published meta-model + library, create a **New Architecture Diagram** (`.archdiagram`).
  2. The **term palette** lists the bound library's terms.
  3. **Drop** a term → a node appears, rendered via the term's template (default box if untemplated); a `component` instance referencing the term is created.
  4. **Move** the node; **connect** two nodes → a reference edge is set (chooser/first-pick when ambiguous).
  5. **Save** → `system.todl` is emitted and validated (Problems dock clean, or shows real issues); reopen restores nodes + positions.
  6. A deliberately-unresolvable base or a broken template surfaces in Problems.

## Definition of done

- Dropping a bound-library term creates a concept instance referencing it, rendered via the term's template; connecting nodes sets a reference member; move/edit/delete work.
- Save emits a validated `.todl` + writes `.archdiagram` layout; reopen restores the scene.
- Headless helpers (`resolveTermDrop`, `applyTermDrop`, `applyConnect`, document save/open) are unit-tested; the canvas/palette/connector integration passes the `npm run dev` smoke.
- Full Vitest suite green; `compile:mu` + `typecheck` clean.

## Notes for the implementer

- The model's `repository()` already dedups bases (a library base carries the meta-model's nodes); don't re-dedup.
- Node positions are the ONLY canvas-owned state beyond the `.todl`; keep them in `.archdiagram`, never in the emitted `.todl`.
- `GetContainerForItemOverride` runs per node — resolve the template once per VM; re-resolve when `InstanceNodeVM.ReferencedTerm` changes (a later refinement; v1 resolves at container creation).
- Ambiguous drop/connect uses first-pick in v1 (a real chooser popover is a follow-up); `log()`/status the alternatives so it's visible.

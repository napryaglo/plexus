# Libraries Panel TreeView Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Libraries panel's flat nested list with a `TreeView` (Library → Concept → Class) whose class leaves are draggable onto the architecture canvas and whose selection expands an inline preview.

**Architecture:** One `LibraryTreeNode` view-model (single type + `Kind` discriminator, mirroring `ProjectNode`) recursed by a `HierarchicalDataTemplate [itemsselector = Children]`. `LibrariesPanelService` builds the tree from `LibraryRegistry.refresh()` and exposes `Roots` + a two-way `SelectedNode` whose change toggles a leaf's `IsPreviewOpen`. Class leaves carry a drag payload using the same `TOOLBOX_NODE_KIND_FORMAT` term id the Phase 3 canvas already accepts.

**Tech Stack:** TypeScript, Electron renderer, `@pragmatic-tech-ai/mural` (`Model`, `ObservableCollection`, `TreeView`, `HierarchicalDataTemplate`, `DataObject`, `TOOLBOX_NODE_KIND_FORMAT`), Vitest, `FakeStorage`.

## Global Constraints

- Every test file lives in a `tests/` subfolder next to its source (repo rule).
- Real TypeScript `enum`s, never string-literal unions (repo rule).
- Node hierarchy is exactly: **Library → Concept → Class** (concept = each class's `LoadedClass.concept`).
- Class-leaf drag payload sets `TOOLBOX_NODE_KIND_FORMAT` (imported from `@pragmatic-tech-ai/mural/framework`) to the full dotted term id (`cls.id`), effects `DragDropEffects.Copy`.
- No new icon assets: reuse `@Libraries` for Library rows (shown via `$IsLibrary << ToVisibility`); Concept/Class rows are text.
- Concepts sorted by name; classes sorted by display name.
- Run one test: `npx vitest run <path>`; full suite `npx vitest run`; markup `npm run compile:mu`; types `npm run typecheck`; live check `npm run dev`. Always `cd /c/Users/Eugene/Projects/architecture-agent/Plexus` first (shell cwd can drift).

## File Structure

- Create `src/renderer/src/modules/library/services/library-tree-node.ts` — `LibraryNodeKind` enum + `LibraryTreeNode` model + `group`/`leaf` factories.
- Modify `src/renderer/src/modules/library/services/libraries-panel-service.ts` — replace `LibraryRow`/`ClassRow`/`ClassData` with a tree built of `LibraryTreeNode`; add `Roots`/`SelectedNode`, preview toggling.
- Modify `src/renderer/src/modules/library/library.resources.mu` — `HierarchicalDataTemplate` + `TreeView`, drop the old row templates.
- Test `src/renderer/src/modules/library/services/tests/library-tree-node.test.ts`.
- Test `src/renderer/src/modules/library/services/tests/libraries-panel-service.test.ts` (rewrite).

---

## Task 1: `LibraryTreeNode` model + factories

**Files:**
- Create: `src/renderer/src/modules/library/services/library-tree-node.ts`
- Test: `src/renderer/src/modules/library/services/tests/library-tree-node.test.ts`

**Interfaces:**
- Consumes: `@pragmatic-tech-ai/mural/runtime` (`Model`, `ObservableCollection`, `DataObject`, `DragDropEffects`, `MetaData`), `@pragmatic-tech-ai/mural/framework` (`TOOLBOX_NODE_KIND_FORMAT`), `@pragmatic-tech-ai/mural/basic` (`DataTemplate` type).
- Produces:
  - `enum LibraryNodeKind { Library = 'library', Concept = 'concept', Class = 'class' }`
  - `class LibraryTreeNode extends Model` with getters: `Name: string`, `Kind: LibraryNodeKind`, `Children: ObservableCollection<LibraryTreeNode>`, `IsLibrary: boolean`, `IsDraggable: boolean`, `IsPreviewOpen: boolean` (get/set), `TermId: string`, `Concept: string`, `Display: string`, `Label: string`, `LocalId: string`, `Template: DataTemplate | undefined`, `Data: LibraryTreeNode`, `BeginKindDragData: (() => { data: DataObject; effects: DragDropEffects }) | undefined`.
  - `static group(name: string, kind: LibraryNodeKind): LibraryTreeNode`
  - `static leaf(info: { display: string; label: string; localId: string; termId: string; concept: string }, template: DataTemplate | undefined): LibraryTreeNode`

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/modules/library/services/tests/library-tree-node.test.ts
import { test, expect } from 'vitest'
import { DataTemplate } from '@pragmatic-tech-ai/mural/basic'
import { TOOLBOX_NODE_KIND_FORMAT } from '@pragmatic-tech-ai/mural/framework'
import { LibraryTreeNode, LibraryNodeKind } from '../library-tree-node.js'

test('group node: kind, name, empty children, inert (not draggable, no preview payload)', () => {
    const n = LibraryTreeNode.group('Microsoft  ·  0.1.0', LibraryNodeKind.Library)
    expect(n.Kind).toBe(LibraryNodeKind.Library)
    expect(n.Name).toBe('Microsoft  ·  0.1.0')
    expect(n.Children.Count).toBe(0)
    expect(n.IsLibrary).toBe(true)
    expect(n.IsDraggable).toBe(false)
    expect(n.BeginKindDragData).toBeUndefined()

    const concept = LibraryTreeNode.group('technology', LibraryNodeKind.Concept)
    expect(concept.IsLibrary).toBe(false)
})

test('class leaf: exposes the render surface + a draggable term payload', () => {
    const tpl = new DataTemplate((() => ({})) as never)
    const n = LibraryTreeNode.leaf(
        { display: 'Azure OpenAI', label: 'Azure OpenAI', localId: 'azure-openai', termId: 'stack.azure-openai', concept: 'technology' },
        tpl,
    )
    expect(n.Kind).toBe(LibraryNodeKind.Class)
    expect(n.Name).toBe('Azure OpenAI')
    expect(n.Display).toBe('Azure OpenAI')
    expect(n.Label).toBe('Azure OpenAI')
    expect(n.LocalId).toBe('azure-openai')
    expect(n.TermId).toBe('stack.azure-openai')
    expect(n.Concept).toBe('technology')
    expect(n.Template).toBe(tpl)
    expect(n.Data).toBe(n)
    expect(n.IsLibrary).toBe(false)
    expect(n.IsDraggable).toBe(true)

    const payload = n.BeginKindDragData!()
    expect(payload.data.Get(TOOLBOX_NODE_KIND_FORMAT)).toBe('stack.azure-openai')
})
```

- [ ] **Step 2: Run — expect FAIL** (`../library-tree-node.js` missing).

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-tree-node.test.ts`
Expected: FAIL, cannot resolve `../library-tree-node.js`.

- [ ] **Step 3: Implement `library-tree-node.ts`**

```ts
import { DataObject, DragDropEffects, MetaData, Model, ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'
import { TOOLBOX_NODE_KIND_FORMAT } from '@pragmatic-tech-ai/mural/framework'
import type { DataTemplate } from '@pragmatic-tech-ai/mural/basic'

// The three tiers of the Libraries tree. One node type carries all three, kept
// apart by Kind (mirrors ProjectNode's single-type-plus-Kind shape).
export enum LibraryNodeKind { Library = 'library', Concept = 'concept', Class = 'class' }

// A node in the Libraries TreeView. Group nodes (Library/Concept) carry a Name +
// Children; Class leaves additionally carry the render surface a mounted library
// template binds against ($Display/$Label/$LocalId/$Concept), the resolved
// Template, a self-reference Data (so the inline-preview ContentPresenter can bind
// Content = $Data), and a drag payload emitting the term id under the canvas-drop
// format so the leaf can be dropped onto an .archdiagram.
export class LibraryTreeNode extends Model
{
    public static readonly NameKey = Model.RegisterProperty<string>(LibraryTreeNode, 'Name', '', MetaData.None)
    public static readonly KindKey = Model.RegisterProperty<LibraryNodeKind>(LibraryTreeNode, 'Kind', LibraryNodeKind.Class, MetaData.None)
    public static readonly ChildrenKey = Model.RegisterProperty<ObservableCollection<LibraryTreeNode>>(
        LibraryTreeNode, 'Children', undefined as unknown as ObservableCollection<LibraryTreeNode>, MetaData.None)
    public static readonly IsLibraryKey = Model.RegisterProperty<boolean>(LibraryTreeNode, 'IsLibrary', false, MetaData.None)
    public static readonly IsDraggableKey = Model.RegisterProperty<boolean>(LibraryTreeNode, 'IsDraggable', false, MetaData.None)
    public static readonly IsPreviewOpenKey = Model.RegisterProperty<boolean>(LibraryTreeNode, 'IsPreviewOpen', false, MetaData.None)

    // Class-leaf render surface + drag payload.
    public static readonly TermIdKey = Model.RegisterProperty<string>(LibraryTreeNode, 'TermId', '', MetaData.None)
    public static readonly ConceptKey = Model.RegisterProperty<string>(LibraryTreeNode, 'Concept', '', MetaData.None)
    public static readonly DisplayKey = Model.RegisterProperty<string>(LibraryTreeNode, 'Display', '', MetaData.None)
    public static readonly LabelKey = Model.RegisterProperty<string>(LibraryTreeNode, 'Label', '', MetaData.None)
    public static readonly LocalIdKey = Model.RegisterProperty<string>(LibraryTreeNode, 'LocalId', '', MetaData.None)
    public static readonly TemplateKey = Model.RegisterProperty<DataTemplate | undefined>(LibraryTreeNode, 'Template', undefined, MetaData.None)
    public static readonly DataKey = Model.RegisterProperty<LibraryTreeNode>(
        LibraryTreeNode, 'Data', undefined as unknown as LibraryTreeNode, MetaData.None)
    public static readonly BeginKindDragDataKey = Model.RegisterProperty<(() => { data: DataObject; effects: DragDropEffects }) | undefined>(
        LibraryTreeNode, 'BeginKindDragData', undefined, MetaData.None)

    constructor()
    {
        super()
        this.set_property_value(LibraryTreeNode.ChildrenKey, new ObservableCollection<LibraryTreeNode>())
    }

    public get Name(): string { return this.get_property_value(LibraryTreeNode.NameKey) }
    public get Kind(): LibraryNodeKind { return this.get_property_value(LibraryTreeNode.KindKey) }
    public get Children(): ObservableCollection<LibraryTreeNode> { return this.get_property_value(LibraryTreeNode.ChildrenKey) }
    public get IsLibrary(): boolean { return this.get_property_value(LibraryTreeNode.IsLibraryKey) }
    public get IsDraggable(): boolean { return this.get_property_value(LibraryTreeNode.IsDraggableKey) }
    public get IsPreviewOpen(): boolean { return this.get_property_value(LibraryTreeNode.IsPreviewOpenKey) }
    public set IsPreviewOpen(v: boolean) { this.set_property_value(LibraryTreeNode.IsPreviewOpenKey, v) }
    public get TermId(): string { return this.get_property_value(LibraryTreeNode.TermIdKey) }
    public get Concept(): string { return this.get_property_value(LibraryTreeNode.ConceptKey) }
    public get Display(): string { return this.get_property_value(LibraryTreeNode.DisplayKey) }
    public get Label(): string { return this.get_property_value(LibraryTreeNode.LabelKey) }
    public get LocalId(): string { return this.get_property_value(LibraryTreeNode.LocalIdKey) }
    public get Template(): DataTemplate | undefined { return this.get_property_value(LibraryTreeNode.TemplateKey) }
    public get Data(): LibraryTreeNode { return this.get_property_value(LibraryTreeNode.DataKey) }
    public get BeginKindDragData(): (() => { data: DataObject; effects: DragDropEffects }) | undefined {
        return this.get_property_value(LibraryTreeNode.BeginKindDragDataKey)
    }

    // A container node (Library or Concept): named, no drag, no preview surface.
    public static group(name: string, kind: LibraryNodeKind): LibraryTreeNode
    {
        const n = new LibraryTreeNode()
        n.set_property_value(LibraryTreeNode.NameKey, name)
        n.set_property_value(LibraryTreeNode.KindKey, kind)
        n.set_property_value(LibraryTreeNode.IsLibraryKey, kind === LibraryNodeKind.Library)
        return n
    }

    // A class leaf: carries the render surface + resolved template + a draggable
    // term payload the architecture canvas accepts.
    public static leaf(
        info: { display: string; label: string; localId: string; termId: string; concept: string },
        template: DataTemplate | undefined,
    ): LibraryTreeNode
    {
        const n = new LibraryTreeNode()
        n.set_property_value(LibraryTreeNode.KindKey, LibraryNodeKind.Class)
        n.set_property_value(LibraryTreeNode.NameKey, info.display)
        n.set_property_value(LibraryTreeNode.DisplayKey, info.display)
        n.set_property_value(LibraryTreeNode.LabelKey, info.label)
        n.set_property_value(LibraryTreeNode.LocalIdKey, info.localId)
        n.set_property_value(LibraryTreeNode.TermIdKey, info.termId)
        n.set_property_value(LibraryTreeNode.ConceptKey, info.concept)
        n.set_property_value(LibraryTreeNode.TemplateKey, template)
        n.set_property_value(LibraryTreeNode.DataKey, n)
        n.set_property_value(LibraryTreeNode.IsDraggableKey, true)
        n.set_property_value(LibraryTreeNode.BeginKindDragDataKey, () => ({
            data:    new DataObject().Set(TOOLBOX_NODE_KIND_FORMAT, info.termId),
            effects: DragDropEffects.Copy,
        }))
        return n
    }
}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-tree-node.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/Plexus
git add src/renderer/src/modules/library/services/library-tree-node.ts src/renderer/src/modules/library/services/tests/library-tree-node.test.ts
git commit -m "feat(library): LibraryTreeNode model + group/leaf factories"
```

---

## Task 2: `LibrariesPanelService` tree build + preview selection

**Files:**
- Modify: `src/renderer/src/modules/library/services/libraries-panel-service.ts` (full rewrite — replaces `LibraryRow`/`ClassRow`/`ClassData`)
- Test: `src/renderer/src/modules/library/services/tests/libraries-panel-service.test.ts` (rewrite)

**Interfaces:**
- Consumes: `LibraryTreeNode`, `LibraryNodeKind` (Task 1); `LibraryRegistry.refresh(): Promise<LoadedLibrary[]>` and `LibraryRegistry.resolve(id, concept): DataTemplate` (existing).
- Produces: `class LibrariesPanelService extends ServiceBase implements IActivatable` with `Roots: ObservableCollection<LibraryTreeNode>`, `SelectedNode: LibraryTreeNode | undefined` (get/set), `IsEmpty: boolean`, `Reload(): Promise<void>`, `OnActivated(): void`.

**Note:** `LibraryRow`/`ClassRow`/`ClassData` are exported today but only referenced by this file, its `.mu`, and its test (verified: the only other matches — in `architecture-repository.resources.mu`, `instance-node-vm.ts`, `visual-library.ts` — are prose comments). Deleting them is safe. The `.mu` is rewritten in Task 3; until then `compile:mu` is not run (Task 2 changes are TS-only, verified by `vitest` + `typecheck`).

- [ ] **Step 1: Write the failing test** (rewrite the whole file)

```ts
// src/renderer/src/modules/library/services/tests/libraries-panel-service.test.ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { LIBRARIES_BACKEND_ID } from '../libraries-backend.js'
import { LibraryRegistry } from '../library-registry.js'
import { LibrariesPanelService } from '../libraries-panel-service.js'
import { LibraryNodeKind, type LibraryTreeNode } from '../library-tree-node.js'

// Synchronous seed (see the registry test) so all files exist before Reload lists.
function providerWith(seed: (b: FakeStorage) => void): ServiceProvider {
    const provider = new ServiceProvider()
    const registry = new StorageProviderRegistry(provider)
    const backend = new FakeStorage('fake://libraries')
    registry.Register(LIBRARIES_BACKEND_ID, () => backend)
    provider.registerInstance(StorageProviderRegistry.Key, registry)
    provider.registerInstance(LibraryRegistry.Key, new LibraryRegistry(provider))
    seed(backend)
    return provider
}

function leaves(root: LibraryTreeNode): LibraryTreeNode[] {
    const out: LibraryTreeNode[] = []
    for (const concept of root.Children.ToArray())
        for (const cls of concept.Children.ToArray()) out.push(cls)
    return out
}

test('builds a Library -> Concept -> Class tree, concepts sorted, leaves carry term + template', async () => {
    const provider = providerWith((b) => {
        void b.WriteText('microsoft/0.1.0/library.json', JSON.stringify({
            id: 'microsoft', version: '0.1.0', name: 'Microsoft', metaModel: { id: 'ea', version: '5' },
            classes: [
                { id: 'microsoft.azure', localId: 'azure', label: 'Azure', concept: 'location', template: 'visuals/a.mural' },
                { id: 'stack.azure-openai', localId: 'azure-openai', label: 'Azure OpenAI', concept: 'technology', template: 'visuals/b.mural' },
            ],
            assets: [], docs: [], samples: [],
        }))
        void b.WriteText('microsoft/0.1.0/visuals/a.mural', 'TextBlock [ Text = $Display ]')
        void b.WriteText('microsoft/0.1.0/visuals/b.mural', 'TextBlock [ Text = $Display ]')
    })
    const svc = new LibrariesPanelService(provider)
    await svc.Reload()

    expect(svc.IsEmpty).toBe(false)
    expect(svc.Roots.Count).toBe(1)
    const lib = svc.Roots.Get(0)!
    expect(lib.Kind).toBe(LibraryNodeKind.Library)
    expect(lib.Name).toContain('Microsoft')
    expect(lib.Children.ToArray().map((c) => c.Name)).toEqual(['location', 'technology'])   // sorted

    const tech = lib.Children.ToArray().find((c) => c.Name === 'technology')!
    expect(tech.Kind).toBe(LibraryNodeKind.Concept)
    expect(tech.Children.Count).toBe(1)
    const leaf = tech.Children.Get(0)!
    expect(leaf.Kind).toBe(LibraryNodeKind.Class)
    expect(leaf.TermId).toBe('stack.azure-openai')
    expect(leaf.Concept).toBe('technology')
    expect(leaf.IsDraggable).toBe(true)
    expect(typeof leaf.Template!.Apply).toBe('function')
})

test('selecting a class opens its preview; selecting another moves it; a group closes it', async () => {
    const provider = providerWith((b) => {
        void b.WriteText('ms/0.1.0/library.json', JSON.stringify({
            id: 'ms', version: '0.1.0', name: 'MS', metaModel: { id: 'ea', version: '5' },
            classes: [
                { id: 'stack.a', localId: 'a', label: 'A', concept: 'technology', template: 'visuals/a.mural' },
                { id: 'stack.b', localId: 'b', label: 'B', concept: 'technology', template: 'visuals/b.mural' },
            ],
            assets: [], docs: [], samples: [],
        }))
        void b.WriteText('ms/0.1.0/visuals/a.mural', 'TextBlock [ Text = $Display ]')
        void b.WriteText('ms/0.1.0/visuals/b.mural', 'TextBlock [ Text = $Display ]')
    })
    const svc = new LibrariesPanelService(provider)
    await svc.Reload()

    const lib = svc.Roots.Get(0)!
    const [a, b] = leaves(lib)

    svc.SelectedNode = a
    expect(a.IsPreviewOpen).toBe(true)

    svc.SelectedNode = b
    expect(a.IsPreviewOpen).toBe(false)
    expect(b.IsPreviewOpen).toBe(true)

    svc.SelectedNode = lib          // a group node closes any open preview
    expect(b.IsPreviewOpen).toBe(false)
})

test('IsEmpty is true when nothing is published', async () => {
    const svc = new LibrariesPanelService(providerWith(() => {}))
    await svc.Reload()
    expect(svc.IsEmpty).toBe(true)
    expect(svc.Roots.Count).toBe(0)
})
```

- [ ] **Step 2: Run — expect FAIL** (service still exports the old shape; `Roots`/`SelectedNode` missing).

Run: `npx vitest run src/renderer/src/modules/library/services/tests/libraries-panel-service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Rewrite `libraries-panel-service.ts`**

```ts
import { MetaData, Model, ObservableCollection, ServiceBase, ServiceKey, type IServiceProvider, type PropertyDescriptor } from '@pragmatic-tech-ai/mural/runtime'
import type { IActivatable } from '@pragmatic-tech-ai/mural/framework'

import { LibraryRegistry } from './library-registry.js'
import { LibraryTreeNode, LibraryNodeKind } from './library-tree-node.js'

// The Libraries capability's panel content: a TreeView of published libraries
// grouped Library -> Concept -> Class. Class leaves are draggable onto the
// architecture canvas (via the term payload on the node) and, when selected,
// expand an inline preview of their mounted visual.
export class LibrariesPanelService extends ServiceBase implements IActivatable
{
    public static readonly Key = new ServiceKey<LibrariesPanelService>('LibrariesPanelService')

    public static readonly RootsKey = Model.RegisterProperty<ObservableCollection<LibraryTreeNode>>(
        LibrariesPanelService, 'Roots', undefined as unknown as ObservableCollection<LibraryTreeNode>, MetaData.None)
    public static readonly SelectedNodeKey = Model.RegisterProperty<LibraryTreeNode | undefined>(
        LibrariesPanelService, 'SelectedNode', undefined, MetaData.None)
    public static readonly IsEmptyKey = Model.RegisterProperty<boolean>(LibrariesPanelService, 'IsEmpty', false, MetaData.None)

    private reloadSeq = 0
    private previewNode: LibraryTreeNode | undefined = undefined

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.set_property_value(LibrariesPanelService.RootsKey, new ObservableCollection<LibraryTreeNode>())
        void this.Reload()
    }

    public get Roots(): ObservableCollection<LibraryTreeNode> { return this.get_property_value(LibrariesPanelService.RootsKey) }
    public get SelectedNode(): LibraryTreeNode | undefined { return this.get_property_value(LibrariesPanelService.SelectedNodeKey) }
    public set SelectedNode(v: LibraryTreeNode | undefined) { this.set_property_value(LibrariesPanelService.SelectedNodeKey, v) }
    public get IsEmpty(): boolean { return this.get_property_value(LibrariesPanelService.IsEmptyKey) }

    public OnActivated(): void { void this.Reload() }

    public async Reload(): Promise<void>
    {
        const seq = ++this.reloadSeq
        const registry = this.Provider.get(LibraryRegistry.Key)
        const roots = this.Roots
        if (registry === undefined) { roots.Clear(); this.set_property_value(LibrariesPanelService.IsEmptyKey, true); return }
        const libs = await registry.refresh()
        if (seq !== this.reloadSeq) return

        roots.Clear()
        this.previewNode = undefined
        for (const lib of libs) {
            const libNode = LibraryTreeNode.group(`${lib.name}  ·  ${lib.version}`, LibraryNodeKind.Library)
            const byConcept = new Map<string, LibraryTreeNode>()
            const sorted = [...lib.classes].sort((x, y) => (x.label ?? x.localId ?? x.id).localeCompare(y.label ?? y.localId ?? y.id))
            for (const cls of sorted) {
                let conceptNode = byConcept.get(cls.concept)
                if (conceptNode === undefined) { conceptNode = LibraryTreeNode.group(cls.concept, LibraryNodeKind.Concept); byConcept.set(cls.concept, conceptNode) }
                const display = cls.label ?? cls.localId ?? cls.id
                conceptNode.Children.Add(LibraryTreeNode.leaf(
                    { display, label: cls.label ?? '', localId: cls.localId ?? '', termId: cls.id, concept: cls.concept },
                    registry.resolve(cls.id, cls.concept),
                ))
            }
            for (const conceptName of [...byConcept.keys()].sort()) libNode.Children.Add(byConcept.get(conceptName)!)
            roots.Add(libNode)
        }
        this.set_property_value(LibrariesPanelService.IsEmptyKey, roots.Count === 0)
    }

    // Selection drives the inline preview: close the previously-previewed leaf,
    // open the newly-selected one (only Class leaves preview; a group closes it).
    protected override OnPropertyChanged(descriptor: PropertyDescriptor, oldValue: unknown, newValue: unknown): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue)
        if (descriptor.Name !== 'SelectedNode') return
        if (this.previewNode !== undefined) this.previewNode.IsPreviewOpen = false
        const node = newValue instanceof LibraryTreeNode ? newValue : undefined
        if (node !== undefined && node.Kind === LibraryNodeKind.Class) { node.IsPreviewOpen = true; this.previewNode = node }
        else this.previewNode = undefined
    }
}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/libraries-panel-service.test.ts`
Expected: PASS (3 tests). If `OnPropertyChanged`'s `PropertyDescriptor` import path is wrong, check the existing signature used by `open-project.ts` (`src/renderer/src/services/projects/open-project.ts:70`) and match it.

- [ ] **Step 5: Typecheck (the `.mu.js` still imports old names but is regenerated in Task 3; verify TS only)**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/Plexus && npm run typecheck`
Expected: clean. (The stale compiled `library.resources.mu.js` is JS, not typechecked; it is regenerated in Task 3.)

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/Plexus
git add src/renderer/src/modules/library/services/libraries-panel-service.ts src/renderer/src/modules/library/services/tests/libraries-panel-service.test.ts
git commit -m "feat(library): build Libraries panel as a Library->Concept->Class tree with preview selection"
```

---

## Task 3: TreeView markup + drag + inline preview (live-smoke)

**Files:**
- Modify: `src/renderer/src/modules/library/library.resources.mu` (full rewrite)

**Interfaces:**
- Consumes: `LibrariesPanelService` (`$Roots`, `$SelectedNode`, `$IsEmpty`), `LibraryTreeNode` (`$Name`, `$Children`, `$IsLibrary`, `$IsDraggable`, `$BeginKindDragData`, `$IsPreviewOpen`, `$Data`, `$Template`, `$Concept`).
- Produces: the rendered Libraries TreeView (visual — final verification is `npm run dev`).

- [ ] **Step 1: Rewrite `library.resources.mu`**

```mu
// library.resources.mu — view resources for the Libraries capability panel
// (LibrariesPanelService). Merged app-global by app.mu. A TreeView of published
// libraries grouped Library -> Concept -> Class; class leaves are draggable onto
// the architecture canvas (term payload) and, when selected, expand an inline
// preview of their mounted visual template.

import LibrariesPanelService from "./services/libraries-panel-service.js"
import LibraryTreeNode from "./services/library-tree-node.js"

resources LibraryResources {

    // One node row + (for a selected class leaf) its inline preview beneath it.
    HierarchicalDataTemplate x:key="LibraryNodeTemplate" [ DataType = LibraryTreeNode, itemsselector = Children ] {
        StackPanel [ Orientation = Vertical ] {
            Border [ Background = #00000000, IsDraggable = $IsDraggable, OnDragStart = $BeginKindDragData ] {
                StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {
                    Shape [ Geometry = @Libraries, Fill = @OnSurfaceVariant, Width = 14, Height = 14,
                            Margin = (0,0,6,0), VerticalAlignment = Center,
                            Visibility = $IsLibrary << ToVisibility ]
                    TextBlock [ Text = $Name, Style = @BodyMedium, Foreground = @OnSurface, VerticalAlignment = Center ]
                }
            }
            Border [ Visibility = $IsPreviewOpen << ToVisibility, Background = @SurfaceContainerHigh,
                     CornerRadius = 6, Padding = (8,6,8,6), Margin = (18,2,0,4) ] {
                StackPanel [ Orientation = Vertical ] {
                    ContentPresenter [ Content = $Data, ContentTemplate = $Template ]
                    TextBlock [ Text = $Concept, Style = @BodySmall, Foreground = @OnSurfaceVariant, Margin = (0,4,0,0) ]
                }
            }
        }
    }

    DataTemplate [ DataType = LibrariesPanelService ] {
        StackPanel [ Orientation = Vertical, Margin = (12,12,12,12) ] {
            TreeView [ Indent = 14,
                       ItemsSource      = $Roots,
                       ItemTemplate     = @LibraryNodeTemplate,
                       SelectedDataItem = $SelectedNode,
                       SelectionMode    = Single ]
            TextBlock [ Style = @BodyMedium, Text = "No published libraries yet.",
                        Foreground = @OnSurfaceVariant, TextWrapping = Wrap,
                        Visibility = $IsEmpty << ToVisibility ]
        }
    }
}
```

- [ ] **Step 2: Compile the markup**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/Plexus && npm run compile:mu`
Expected: `compiled 21 files` with no error. If the compiler rejects `HierarchicalDataTemplate`, `itemsselector`, `TreeView`, or `SelectedDataItem`, cross-check the exact spelling/casing against `src/renderer/src/modules/project-explorer/project-explorer.resources.mu` (the working reference) and fix.

- [ ] **Step 3: Typecheck + full suite**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck clean; full suite green (the two rewritten test files + all others).

- [ ] **Step 4: Commit**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/Plexus
git add src/renderer/src/modules/library/library.resources.mu
git commit -m "feat(library): Libraries panel TreeView markup (drag leaves + inline preview)"
```

- [ ] **Step 5: Live smoke (`npm run dev`) — the acceptance gate:**

Run: `npm run dev`
Verify in the running app:
  1. The **Libraries** capability panel shows a tree; each published library expands to its **concept** groups, each concept to its **class** leaves.
  2. A `@Libraries` glyph shows on library rows; concept/class rows are text; chevrons expand/collapse.
  3. **Selecting a class** expands an inline preview beneath its row — the class's rendered visual + its concept.
  4. **Dragging a class leaf** onto an open `.archdiagram` creates a node (same behavior as the Phase 3 term palette).
  5. With nothing published, the panel shows "No published libraries yet."

---

## Definition of done

- The Libraries panel is a `TreeView` grouped Library → Concept → Class; concepts sorted, classes sorted by display.
- Class leaves are draggable onto the architecture canvas (shared `TOOLBOX_NODE_KIND_FORMAT` term payload) and, when selected, expand an inline preview of their mounted visual.
- `LibraryRow`/`ClassRow`/`ClassData` are gone; nothing references them.
- `library-tree-node.test.ts` + rewritten `libraries-panel-service.test.ts` pass; full Vitest suite green; `compile:mu` + `typecheck` clean; the tree/drag/preview pass the `npm run dev` smoke.

## Notes for the implementer

- Expansion is managed by the `TreeView`/`TreeViewItem` control (chevrons), so `LibraryTreeNode` intentionally has no `IsExpanded` — do not add one.
- The class visual renders against the leaf node itself (`Data = self`); the leaf exposes `Display`/`Label`/`LocalId`/`Concept` so any mounted library template (which binds `$Display` etc.) renders exactly as it did in the old flat panel.
- Both the Libraries tree and the Phase 3 `ArchTermsPaletteService` are independent drag sources using the same `TOOLBOX_NODE_KIND_FORMAT` payload — do not couple them.
- Prose comments in `architecture-repository.resources.mu` / `instance-node-vm.ts` / `visual-library.ts` mention "ClassRow"/"ClassData"; they are historical references, not code — leaving them is fine (optionally reword to "the library class row").

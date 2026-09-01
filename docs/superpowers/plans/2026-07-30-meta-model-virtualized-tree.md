# Meta-model Virtualized Tree — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Meta-models panel's eager nested-`ItemsControl` outline with a single virtualizing `TreeView` that layers the catalog (model → version) over each version's ontology entities, loaded lazily on first expand.

**Architecture:** Add a general `OnExpand()` notification hook to mural's `TreeViewItem` (publish 0.1.52), then in Plexus build a uniform `MetaModelTreeNode` VM (mirrors `ProjectNode`) whose Version nodes lazily read `model.json` on expand, grouping entities by ontology kind. One `HierarchicalDataTemplate` renders the whole heterogeneous tree; `IsVirtualizing = true` bounds render cost.

**Tech Stack:** TypeScript, `@pragmatic-tech-ai/mural` (Model/DP/ObservableCollection/TreeView), `@pragmatic-tech-ai/todl` (`TodlDocument`), Vitest (Plexus), `node:test` (Mural), Verdaccio local registry.

## Global Constraints

- **Two repos.** Mural work (Task 1) lands on the existing branch `treeview-data-templates` and publishes `0.1.52` to Verdaccio (`http://localhost:4873/`). Plexus work (Tasks 2–7) lands on a new branch `meta-model-virtualized-tree` cut from `main`.
- **Mural version:** bump `0.1.51` → `0.1.52`; Plexus range becomes `^0.1.52`.
- **Enums over string-literal unions** — node kinds are a real `enum` with explicit string values.
- **Tests live in a `tests/` subfolder** next to the code they exercise, in both repos.
- **Render through templates only** — every visible row flows through the `HierarchicalDataTemplate`; no hardcoded chrome.
- **Mural cross-class internals:** read a container's stamped data only through a named, typed interface — never bracket access.
- **Idempotency of expansion is the VM's job** — the framework fires `OnExpand()` on every transition to expanded; the node guards against re-loading.

---

## Task 1: Mural — `OnExpand` expansion hook + publish 0.1.52

**Repo:** `Mural` (branch `treeview-data-templates`)

**Files:**
- Modify: `src/framework/list/tree-view.ts` (add interface near `dataOf`; extend `TreeViewItem.OnPropertyChanged` `IsExpanded` case ~line 886)
- Modify: `package.json` (version 0.1.51 → 0.1.52)
- Test: `src/framework/list/tests/tree-view.test.ts` (append a describe block)

**Interfaces:**
- Consumes: existing module-level `dataOf(container: TreeViewItem): unknown` (reads `_itemsControlData`); existing `TreeViewItem.OnPropertyChanged` `IsExpanded` case.
- Produces: runtime contract — when a data-bound `TreeViewItem`'s `IsExpanded` becomes `true`, the framework calls `data.OnExpand()` if the bound data item defines that method. No new exported symbol (the interface is internal).

- [ ] **Step 1: Write the failing tests**

Append to `src/framework/list/tests/tree-view.test.ts`:

```ts
describe('TreeViewItem — OnExpand data hook', () => {
    beforeEach(() => { initTestApp(); });

    test('expanding a data-bound row invokes the data item OnExpand()', () => {
        const tree = new TreeView();
        let fired = 0;
        const data = { Name: 'root', children: [{ Name: 'child' }], OnExpand() { fired++; } };
        tree.ItemTemplate = new HierarchicalDataTemplate(
            (d) => new TextBlock((d as { Name: string }).Name),
            (d) => (d as { children?: unknown[] }).children,
        );
        tree.ItemsSource = [data];

        const root = tree.RootItems[0]!;
        assert.equal(fired, 0);
        root.IsExpanded = true;
        assert.equal(fired, 1, 'OnExpand fires when the row expands');
    });

    test('a data item without OnExpand expands without throwing', () => {
        const tree = new TreeView();
        tree.ItemTemplate = new HierarchicalDataTemplate(
            (d) => new TextBlock((d as { Name: string }).Name),
            (d) => (d as { children?: unknown[] }).children,
        );
        tree.ItemsSource = [{ Name: 'root', children: [{ Name: 'c' }] }];

        const root = tree.RootItems[0]!;
        assert.doesNotThrow(() => { root.IsExpanded = true; });
    });

    test('composed-markup rows (no bound data) expand without throwing', () => {
        const item = new TreeViewItem();
        item.AddChild(new TreeViewItem());
        assert.doesNotThrow(() => { item.IsExpanded = true; });
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: the first new test FAILS (`fired` stays 0 — no hook yet). The other two pass (no regression), which is fine.

- [ ] **Step 3: Add the typed interface**

In `src/framework/list/tree-view.ts`, near the `dataOf` function (~line 1068), add:

```ts
// A data item that wants to be told when its tree row is expanded — the
// framework calls OnExpand() on each transition to expanded (lazy-load hook).
// Idempotency is the data item's responsibility.
interface ExpandableTreeData { OnExpand?(): void }
```

- [ ] **Step 4: Fire the hook from the IsExpanded handler**

In `TreeViewItem.OnPropertyChanged`, the `case 'IsExpanded':` block (~line 886) currently reads:

```ts
            case 'IsExpanded':
                this.refreshChevron();
                this._childWrap?.SetCollapsed(!(newValue as boolean));
                this._childVsp?.SetCollapsed(!(newValue as boolean));
                this.InvalidateMeasure();
                return;
```

Insert the hook before `return;`:

```ts
            case 'IsExpanded':
                this.refreshChevron();
                this._childWrap?.SetCollapsed(!(newValue as boolean));
                this._childVsp?.SetCollapsed(!(newValue as boolean));
                this.InvalidateMeasure();
                if (newValue === true)
                {
                    const data = dataOf(this) as ExpandableTreeData | undefined;
                    data?.OnExpand?.();
                }
                return;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: all three new tests PASS and the full mural suite stays green.

- [ ] **Step 6: Bump the version**

Edit `package.json`: `"version": "0.1.51"` → `"version": "0.1.52"`.

- [ ] **Step 7: Publish to Verdaccio**

Run: `npm publish`
(`prepublishOnly` runs `clean` + `build` automatically.)
Expected: `+ @pragmatic-tech-ai/mural@0.1.52`.

- [ ] **Step 8: Commit**

```bash
git add src/framework/list/tree-view.ts src/framework/list/tests/tree-view.test.ts package.json
git commit -m "$(cat <<'EOF'
feat(tree-view): OnExpand data hook for lazy child population (0.1.52)

TreeViewItem now calls data.OnExpand() when a data-bound row expands, so a
view-model can populate a node's children on first open. Dispatched through a
typed ExpandableTreeData interface; composed-markup rows (no bound data) skip it.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Plexus — consume mural 0.1.52

**Repo:** `Plexus` (new branch `meta-model-virtualized-tree` from `main`)

**Files:**
- Modify: `package.json` (`"@pragmatic-tech-ai/mural": "^0.1.51"` → `"^0.1.52"`)

**Interfaces:**
- Consumes: the published `@pragmatic-tech-ai/mural@0.1.52` from Task 1.
- Produces: the OnExpand hook available in `node_modules` for Tasks 3 & 7.

- [ ] **Step 1: Bump the dependency range**

Edit `package.json`: set `"@pragmatic-tech-ai/mural": "^0.1.52"`.

- [ ] **Step 2: Reinstall from Verdaccio**

Run: `npm install`
Expected: `@pragmatic-tech-ai/mural@0.1.52` installed.

- [ ] **Step 3: Verify the hook shipped in the installed dist**

Run: `grep -n "OnExpand" node_modules/@pragmatic-tech-ai/mural/dist/framework/list/tree-view.js`
Expected: a match inside the `IsExpanded` handler (`data?.OnExpand?.()`). If no match, Task 1's publish didn't land — stop and fix before continuing.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(deps): bump @pragmatic-tech-ai/mural to ^0.1.52 (OnExpand hook)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Plexus — `MetaModelTreeNode` VM

**Repo:** `Plexus` (branch `meta-model-virtualized-tree`)

**Files:**
- Create: `src/renderer/src/modules/meta-model/services/meta-model-tree-node.ts`
- Test: `src/renderer/src/modules/meta-model/services/tests/meta-model-tree-node.test.ts`

**Interfaces:**
- Consumes: `Model`, `MetaData`, `ObservableCollection` from `@pragmatic-tech-ai/mural/runtime`.
- Produces:
  - `enum MetaModelNodeKind { Model = 'model', Version = 'version', Group = 'group', Entity = 'entity' }`
  - `class MetaModelTreeNode extends Model` with getters `Kind: MetaModelNodeKind`, `Label: string`, `Children: ObservableCollection<MetaModelTreeNode>`, and `OnExpand(): void`.
  - `static leaf(kind: MetaModelNodeKind, label: string): MetaModelTreeNode`
  - `static lazy(kind: MetaModelNodeKind, label: string, loader: () => Promise<MetaModelTreeNode[]>): MetaModelTreeNode`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/modules/meta-model/services/tests/meta-model-tree-node.test.ts`:

```ts
import { test, expect } from 'vitest'

import { MetaModelTreeNode, MetaModelNodeKind } from '../meta-model-tree-node.js'

test('leaf() has the given kind + label and no children', () => {
    const n = MetaModelTreeNode.leaf(MetaModelNodeKind.Model, 'tech-architecture')
    expect(n.Kind).toBe(MetaModelNodeKind.Model)
    expect(n.Label).toBe('tech-architecture')
    expect(n.Children.Count).toBe(0)
})

test('lazy() seeds a single "Loading…" sentinel child so the chevron shows', () => {
    const n = MetaModelTreeNode.lazy(MetaModelNodeKind.Version, '0.1.0', async () => [])
    expect(n.Kind).toBe(MetaModelNodeKind.Version)
    expect(n.Children.Count).toBe(1)
    expect(n.Children.Get(0)!.Label).toBe('Loading…')
})

test('OnExpand runs the loader once and replaces the sentinel with its result', async () => {
    let calls = 0
    const n = MetaModelTreeNode.lazy(MetaModelNodeKind.Version, '0.1.0', async () => {
        calls++
        return [MetaModelTreeNode.leaf(MetaModelNodeKind.Entity, 'Actor')]
    })

    n.OnExpand()
    n.OnExpand()                 // second expand must not re-run the loader
    await Promise.resolve()      // let the async populate settle
    await Promise.resolve()

    expect(calls).toBe(1)
    expect(n.Children.Count).toBe(1)
    expect(n.Children.Get(0)!.Label).toBe('Actor')
})

test('OnExpand replaces the sentinel with an error leaf when the loader rejects', async () => {
    const n = MetaModelTreeNode.lazy(MetaModelNodeKind.Version, '0.1.0', async () => {
        throw new Error('boom')
    })

    n.OnExpand()
    await Promise.resolve()
    await Promise.resolve()

    expect(n.Children.Count).toBe(1)
    expect(n.Children.Get(0)!.Label).toBe('Failed to load model.json')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-tree-node.test.ts`
Expected: FAIL — cannot find module `../meta-model-tree-node.js`.

- [ ] **Step 3: Implement the node**

Create `src/renderer/src/modules/meta-model/services/meta-model-tree-node.ts`:

```ts
import { MetaData, Model, ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'

// A uniform tree node for the Meta-models panel — one type for every level
// (model id, version, kind group, entity) so a single HierarchicalDataTemplate
// governs the whole tree (mirrors ProjectNode). Kind drives the leading icon.
//
// Version nodes are lazy: they carry a loader and a single "Loading…" sentinel
// child so the TreeView paints a chevron before anything is read. The mural
// TreeViewItem calls OnExpand() on first expand; the node runs its loader once
// and swaps the sentinel for the produced subtree. Because Children is an
// ObservableCollection bound live as the row's ItemsSource, the async swap
// updates the tree in place.
export enum MetaModelNodeKind
{
    Model = 'model',
    Version = 'version',
    Group = 'group',
    Entity = 'entity',
}

export class MetaModelTreeNode extends Model
{
    public static readonly KindKey = Model.RegisterProperty<MetaModelNodeKind>(
        MetaModelTreeNode, 'Kind', MetaModelNodeKind.Entity, MetaData.None)

    public static readonly LabelKey = Model.RegisterProperty<string>(
        MetaModelTreeNode, 'Label', '', MetaData.None)

    public static readonly ChildrenKey = Model.RegisterProperty<ObservableCollection<MetaModelTreeNode>>(
        MetaModelTreeNode, 'Children',
        undefined as unknown as ObservableCollection<MetaModelTreeNode>, MetaData.None)

    // Lazy machinery (view-invisible → plain fields). Only lazy() sets a loader.
    private loader?: () => Promise<MetaModelTreeNode[]>
    private loaded = false

    private constructor(kind: MetaModelNodeKind, label: string)
    {
        super()
        this.set_property_value(MetaModelTreeNode.KindKey, kind)
        this.set_property_value(MetaModelTreeNode.LabelKey, label)
        this.set_property_value(MetaModelTreeNode.ChildrenKey, new ObservableCollection<MetaModelTreeNode>())
    }

    public get Kind(): MetaModelNodeKind { return this.get_property_value(MetaModelTreeNode.KindKey) }
    public get Label(): string { return this.get_property_value(MetaModelTreeNode.LabelKey) }
    public get Children(): ObservableCollection<MetaModelTreeNode>
    {
        return this.get_property_value(MetaModelTreeNode.ChildrenKey)
    }

    // A non-lazy node: children (if any) are added by the caller.
    public static leaf(kind: MetaModelNodeKind, label: string): MetaModelTreeNode
    {
        return new MetaModelTreeNode(kind, label)
    }

    // A lazy node: seeded with a "Loading…" sentinel; loader runs on first expand.
    public static lazy(
        kind: MetaModelNodeKind, label: string,
        loader: () => Promise<MetaModelTreeNode[]>,
    ): MetaModelTreeNode
    {
        const node = new MetaModelTreeNode(kind, label)
        node.loader = loader
        node.Children.Add(MetaModelTreeNode.leaf(MetaModelNodeKind.Entity, 'Loading…'))
        return node
    }

    // Called by the mural TreeViewItem when this row expands. Runs the loader
    // exactly once (idempotent); subsequent expands are no-ops.
    public OnExpand(): void
    {
        if (this.loaded || this.loader === undefined) return
        this.loaded = true
        void this.runLoader(this.loader)
    }

    private async runLoader(loader: () => Promise<MetaModelTreeNode[]>): Promise<void>
    {
        let children: MetaModelTreeNode[]
        try { children = await loader() }
        catch { children = [MetaModelTreeNode.leaf(MetaModelNodeKind.Entity, 'Failed to load model.json')] }
        this.Children.Clear()
        for (const c of children) this.Children.Add(c)
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-tree-node.test.ts`
Expected: PASS (4 tests).

> Note: the mural `ObservableCollection<T>` accessor is `Get(index): T | undefined` (verified in `dist/runtime/observable-collection.d.ts`) — hence `.Get(0)!.Label`. Other members used here: `Count`, `Add`, `Clear`, `[Symbol.iterator]`, `ToArray()`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/meta-model-tree-node.ts src/renderer/src/modules/meta-model/services/tests/meta-model-tree-node.test.ts
git commit -m "$(cat <<'EOF'
feat(meta-model): MetaModelTreeNode VM with lazy OnExpand population

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Plexus — catalog + entity builders

**Repo:** `Plexus` (branch `meta-model-virtualized-tree`)

**Files:**
- Create: `src/renderer/src/modules/meta-model/services/meta-model-tree-builder.ts`
- Test: `src/renderer/src/modules/meta-model/services/tests/meta-model-tree-builder.test.ts`
- Modify: `src/renderer/src/modules/meta-model/services/meta-models-service.ts` (remove `PublishedModel` + `scanPublishedModels` — they move into the builder)
- Modify: `src/renderer/src/modules/meta-model/services/tests/meta-models-service.test.ts` (the three `scanPublishedModels` tests move to the builder test — see Step 6)

**Interfaces:**
- Consumes: `IStorage` from `../../../services/storage/storage.js`; `MetaModelTreeNode`, `MetaModelNodeKind` from `./meta-model-tree-node.js` (Task 3); `ontologyEntities`, `humanize`, `OntologyKind` from `./presentation-generator.js`; `TodlDocument`, `JsonNode` from `@pragmatic-tech-ai/todl`.
- Produces:
  - `interface PublishedModel { id: string; versions: string[] }`
  - `scanPublishedModels(storage: IStorage): Promise<PublishedModel[]>`
  - `buildCatalog(storage: IStorage): Promise<MetaModelTreeNode[]>`
  - `loadVersionEntities(storage: IStorage, id: string, version: string): Promise<MetaModelTreeNode[]>`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/modules/meta-model/services/tests/meta-model-tree-builder.test.ts`:

```ts
import { test, expect } from 'vitest'

import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { MetaModelNodeKind } from '../meta-model-tree-node.js'
import { scanPublishedModels, buildCatalog, loadVersionEntities } from '../meta-model-tree-builder.js'

function backendWith(entries: Array<[string, string]>): FakeStorage
{
    const s = new FakeStorage('fake://meta-models')
    for (const [path, text] of entries) void s.WriteText(path, text)
    return s
}

// A serialized TodlDocument (toJSON shape) with two concepts and one relationship.
const MODEL_JSON = JSON.stringify({
    nodes: [
        { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: { label: 'Actor' } },
        { id: 'app-component', tier: 'Ontology', typeOf: 'concept', attrs: {} },
        { id: 'depends-on', tier: 'Ontology', typeOf: 'relationship', attrs: {} },
    ],
    edges: [],
})

test('scanPublishedModels groups by id and sorts versions numeric-aware', async () => {
    const storage = backendWith([
        ['m/0.10.0/model.json', '{}'],
        ['m/0.9.0/model.json', '{}'],
        ['enterprise/1.0.0/model.json', '{}'],
    ])
    const models = await scanPublishedModels(storage)
    expect(models.map((m) => m.id)).toEqual(['enterprise', 'm'])
    expect(models.find((m) => m.id === 'm')?.versions).toEqual(['0.9.0', '0.10.0'])
})

test('buildCatalog yields Model nodes with lazy Version children', async () => {
    const storage = backendWith([['tech/0.1.0/model.json', MODEL_JSON]])
    const nodes = await buildCatalog(storage)

    expect(nodes).toHaveLength(1)
    expect(nodes[0].Kind).toBe(MetaModelNodeKind.Model)
    expect(nodes[0].Label).toBe('tech')
    const version = nodes[0].Children.get_Item(0)
    expect(version.Kind).toBe(MetaModelNodeKind.Version)
    expect(version.Label).toBe('0.1.0')
    // Lazy → the version starts with its "Loading…" sentinel.
    expect(version.Children.Get(0)!.Label).toBe('Loading…')
})

test('loadVersionEntities groups entities by kind, non-empty groups only, labelled', async () => {
    const storage = backendWith([['tech/0.1.0/model.json', MODEL_JSON]])
    const groups = await loadVersionEntities(storage, 'tech', '0.1.0')

    // Concepts + Relationships present; Taxonomies + Primitives omitted (empty).
    expect(groups.map((g) => g.Label)).toEqual(['Concepts', 'Relationships'])
    const concepts = groups[0]
    expect(concepts.Kind).toBe(MetaModelNodeKind.Group)
    // attrs.label wins; else humanize(id): 'app-component' → 'App Component'.
    expect(concepts.Children.Get(0)!.Label).toBe('Actor')
    expect(concepts.Children.Get(1)!.Label).toBe('App Component')
    expect(concepts.Children.Get(0)!.Kind).toBe(MetaModelNodeKind.Entity)
})

test('loadVersionEntities returns a "No entities" leaf for a model with none', async () => {
    const empty = JSON.stringify({ nodes: [], edges: [] })
    const storage = backendWith([['tech/0.1.0/model.json', empty]])
    const groups = await loadVersionEntities(storage, 'tech', '0.1.0')
    expect(groups).toHaveLength(1)
    expect(groups[0].Label).toBe('No entities')
})

test('loadVersionEntities returns a "Failed to load model.json" leaf on bad json', async () => {
    const storage = backendWith([['tech/0.1.0/model.json', 'not json']])
    const groups = await loadVersionEntities(storage, 'tech', '0.1.0')
    expect(groups).toHaveLength(1)
    expect(groups[0].Label).toBe('Failed to load model.json')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-tree-builder.test.ts`
Expected: FAIL — cannot find module `../meta-model-tree-builder.js`.

- [ ] **Step 3: Implement the builder**

Create `src/renderer/src/modules/meta-model/services/meta-model-tree-builder.ts`:

```ts
import type { TodlDocument, JsonNode } from '@pragmatic-tech-ai/todl'

import type { IStorage } from '../../../services/storage/storage.js'
import { MetaModelTreeNode, MetaModelNodeKind } from './meta-model-tree-node.js'
import { ontologyEntities, humanize, OntologyKind } from './presentation-generator.js'

// A published meta-model as plain data: its id and the versions found under it.
export interface PublishedModel { id: string; versions: string[] }

// Scan the meta-models backend for published models. Layout on disk is
// `<id>/<modelVersion>/…`, so the root's directories are ids and each id's
// directories are versions. Sorted numeric-aware so 0.9.0 precedes 0.10.0.
export async function scanPublishedModels(storage: IStorage): Promise<PublishedModel[]>
{
    const byName = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true })
    const ids = (await storage.List('')).filter((e) => e.IsDirectory).map((e) => e.Name).sort(byName)
    const out: PublishedModel[] = []
    for (const id of ids)
    {
        const versions = (await storage.List(id)).filter((e) => e.IsDirectory).map((e) => e.Name).sort(byName)
        out.push({ id, versions })
    }
    return out
}

// Build the catalog layer: one Model node per published id, each with lazy
// Version children whose entities load from model.json on first expand.
export async function buildCatalog(storage: IStorage): Promise<MetaModelTreeNode[]>
{
    const published = await scanPublishedModels(storage)
    return published.map((p) =>
    {
        const model = MetaModelTreeNode.leaf(MetaModelNodeKind.Model, p.id)
        for (const version of p.versions)
        {
            model.Children.Add(MetaModelTreeNode.lazy(
                MetaModelNodeKind.Version, version,
                () => loadVersionEntities(storage, p.id, version),
            ))
        }
        return model
    })
}

// The ontology kinds presented as groups, in fixed display order.
const GROUPS: ReadonlyArray<{ kind: OntologyKind; label: string }> = [
    { kind: OntologyKind.Concept, label: 'Concepts' },
    { kind: OntologyKind.Relationship, label: 'Relationships' },
    { kind: OntologyKind.Taxonomy, label: 'Taxonomies' },
    { kind: OntologyKind.Primitive, label: 'Primitives' },
]

// Read a version's model.json and outline its ontology entities as Group → Entity
// nodes. Empty groups are omitted; a model with no entities yields a single
// "No entities" leaf; a missing/malformed model.json yields "Failed to load
// model.json".
export async function loadVersionEntities(
    storage: IStorage, id: string, version: string,
): Promise<MetaModelTreeNode[]>
{
    let doc: TodlDocument
    try { doc = JSON.parse(await storage.ReadText(`${id}/${version}/model.json`)) as TodlDocument }
    catch { return [MetaModelTreeNode.leaf(MetaModelNodeKind.Entity, 'Failed to load model.json')] }

    const entities = ontologyEntities(doc)
    if (entities.length === 0) return [MetaModelTreeNode.leaf(MetaModelNodeKind.Entity, 'No entities')]

    const out: MetaModelTreeNode[] = []
    for (const g of GROUPS)
    {
        const inGroup = entities.filter((n) => n.typeOf === g.kind)
        if (inGroup.length === 0) continue
        const group = MetaModelTreeNode.leaf(MetaModelNodeKind.Group, g.label)
        for (const n of inGroup) group.Children.Add(MetaModelTreeNode.leaf(MetaModelNodeKind.Entity, entityLabel(n)))
        out.push(group)
    }
    return out
}

// An entity's row label: attrs.label when a string, else humanize(id).
function entityLabel(n: JsonNode): string
{
    return typeof n.attrs['label'] === 'string' ? String(n.attrs['label']) : humanize(n.id)
}
```

- [ ] **Step 4: Run the builder tests to verify they pass**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-tree-builder.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Remove the now-duplicated scan from the service module**

In `src/renderer/src/modules/meta-model/services/meta-models-service.ts`, delete the `PublishedModel` interface and the `scanPublishedModels` function (lines ~25–45). The service still imports what it needs otherwise; it will be rewired in Task 6. (Leaving them would duplicate the builder's copy.) Do not touch the rest of the file yet.

- [ ] **Step 6: Move the scan tests out of the service test**

In `src/renderer/src/modules/meta-model/services/tests/meta-models-service.test.ts`, delete the three tests that import and exercise `scanPublishedModels` (the whole current file body — it only tests `scanPublishedModels`). The builder test created in Step 1 already covers `scanPublishedModels`. Leave the file empty of tests for now; Task 6 refills it with the service-level `reload` test. (An empty test file makes Vitest error "No test found", so this step is completed together with Task 6 — do not run the suite between them.)

- [ ] **Step 7: Verify the builder + node tests still pass together**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-tree-builder.test.ts src/renderer/src/modules/meta-model/services/tests/meta-model-tree-node.test.ts`
Expected: PASS (10 tests total).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/meta-model-tree-builder.ts \
        src/renderer/src/modules/meta-model/services/tests/meta-model-tree-builder.test.ts \
        src/renderer/src/modules/meta-model/services/meta-models-service.ts \
        src/renderer/src/modules/meta-model/services/tests/meta-models-service.test.ts
git commit -m "$(cat <<'EOF'
feat(meta-model): catalog + lazy entity tree builders

buildCatalog scans the backend into Model→lazy-Version nodes; loadVersionEntities
reads model.json and groups ontology entities by kind. scanPublishedModels moves
here from meta-models-service (its tests move to the builder test).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Plexus — `MetaModelKindToGeometry` icon converter

**Repo:** `Plexus` (branch `meta-model-virtualized-tree`)

**Files:**
- Create: `src/renderer/src/modules/meta-model/services/meta-model-node-icon.ts`
- Test: `src/renderer/src/modules/meta-model/services/tests/meta-model-node-icon.test.ts`

**Interfaces:**
- Consumes: `Application`, `ValueConverter` from `@pragmatic-tech-ai/mural/runtime`; `MetaModelNodeKind` from `./meta-model-tree-node.js`.
- Produces: `iconKeyForNodeKind(kind: MetaModelNodeKind): string` and `export const MetaModelKindToGeometry: ValueConverter`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/modules/meta-model/services/tests/meta-model-node-icon.test.ts`:

```ts
import { test, expect } from 'vitest'

import { MetaModelNodeKind } from '../meta-model-tree-node.js'
import { iconKeyForNodeKind } from '../meta-model-node-icon.js'

test('each node kind maps to a registered plexus-icons resource key', () => {
    expect(iconKeyForNodeKind(MetaModelNodeKind.Model)).toBe('MetaModels')
    expect(iconKeyForNodeKind(MetaModelNodeKind.Version)).toBe('Todl')
    expect(iconKeyForNodeKind(MetaModelNodeKind.Group)).toBe('Folder')
    expect(iconKeyForNodeKind(MetaModelNodeKind.Entity)).toBe('File')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-node-icon.test.ts`
Expected: FAIL — cannot find module `../meta-model-node-icon.js`.

- [ ] **Step 3: Implement the converter**

Create `src/renderer/src/modules/meta-model/services/meta-model-node-icon.ts`. The resource keys are the ones registered in `src/renderer/src/plexus-icons.mu` (`MetaModels`, `Todl`, `Folder`, `File`):

```ts
// meta-model-node-icon.ts — the Meta-models tree's per-kind leading glyph.
//
// The tree renders declaratively (a HierarchicalDataTemplate over
// MetaModelTreeNode.Children — see meta-model.resources.mu), so the data-driven
// icon flows through a value converter (`$Kind << MetaModelKindToGeometry`).
// Distinct from the project explorer's KindToGeometry (different key set).
import { Application, type ValueConverter } from '@pragmatic-tech-ai/mural/runtime'

import { MetaModelNodeKind } from './meta-model-tree-node.js'

// The leading glyph resource key for a node kind (all registered in
// plexus-icons.mu). An unrecognised kind falls back to the generic File glyph.
export function iconKeyForNodeKind(kind: MetaModelNodeKind): string
{
    switch (kind)
    {
        case MetaModelNodeKind.Model:   return 'MetaModels'
        case MetaModelNodeKind.Version: return 'Todl'
        case MetaModelNodeKind.Group:   return 'Folder'
        default:                        return 'File'
    }
}

// Resolves a node's Kind to its themed leading geometry. Geometries are
// theme-agnostic (registered once in PlexusIcons), so a one-shot resolve is
// stable across scheme switches — the Shape's Fill carries the reactive brush.
export const MetaModelKindToGeometry: ValueConverter = {
    convert: (kind: unknown) =>
        Application.current?.Resources.Resolve(iconKeyForNodeKind(kind as MetaModelNodeKind)),
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-node-icon.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/meta-model-node-icon.ts src/renderer/src/modules/meta-model/services/tests/meta-model-node-icon.test.ts
git commit -m "$(cat <<'EOF'
feat(meta-model): MetaModelKindToGeometry icon converter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Plexus — rewire `MetaModelsService` to the node tree

**Repo:** `Plexus` (branch `meta-model-virtualized-tree`)

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/meta-models-service.ts` (replace `Models`/`MetaModelRow`/`MetaModelVersionRow` with `Nodes`)
- Modify: `src/renderer/src/modules/meta-model/services/tests/meta-models-service.test.ts` (refill with a reload test)

**Interfaces:**
- Consumes: `buildCatalog` from `./meta-model-tree-builder.js` (Task 4); `MetaModelTreeNode` from `./meta-model-tree-node.js` (Task 3); `ensureMetaModelsBackend` from `./meta-models-backend.js`.
- Produces: `MetaModelsService` with `Nodes: ObservableCollection<MetaModelTreeNode>` and `IsEmpty: boolean`. `MetaModelRow` / `MetaModelVersionRow` deleted.

- [ ] **Step 1: Write the failing test**

Replace the body of `src/renderer/src/modules/meta-model/services/tests/meta-models-service.test.ts` with:

```ts
import { test, expect } from 'vitest'

import { MetaModelNodeKind } from '../meta-model-tree-node.js'
import { buildCatalog } from '../meta-model-tree-builder.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'

// The service's reload logic is `buildCatalog(backend)` → Nodes; exercise the
// builder directly against a seeded backend to assert the shape the panel binds.
test('buildCatalog produces the Model→Version node tree the service binds as Nodes', async () => {
    const storage = new FakeStorage('fake://meta-models')
    await storage.WriteText('tech/0.1.0/model.json', JSON.stringify({ nodes: [], edges: [] }))

    const nodes = await buildCatalog(storage)

    expect(nodes).toHaveLength(1)
    expect(nodes[0].Kind).toBe(MetaModelNodeKind.Model)
    expect(nodes[0].Children.Get(0)!.Kind).toBe(MetaModelNodeKind.Version)
})

test('buildCatalog on an empty backend yields no nodes (drives IsEmpty)', async () => {
    const nodes = await buildCatalog(new FakeStorage('fake://meta-models'))
    expect(nodes).toHaveLength(0)
})
```

> The full DI-backed `MetaModelsService.reload` needs the service provider + registered backend, which is heavy to stand up in a unit test; the existing suite tested the pure scan for that reason. We keep that philosophy: test the pure `buildCatalog` the service delegates to. The service wiring itself is exercised by the dev smoke in Task 7.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-models-service.test.ts`
Expected: FAIL — `../meta-model-tree-node.js` / `../meta-model-tree-builder.js` resolve, but the service file still references the deleted scan; more importantly this test passes only once the service compiles. If it errors on the service import chain, that's the failing state to fix in Step 3.

- [ ] **Step 3: Rewrite the service**

Replace `src/renderer/src/modules/meta-model/services/meta-models-service.ts` with:

```ts
// meta-models-service.ts — the Meta-model module's left-panel content service.
// Module-local: registered by the module's `.services:` block and named by its
// Capability's `ServiceKey`. It renders published meta-models as a virtualized
// tree (model id → version → ontology entities), so it owns its own data shape
// (a MetaModelTreeNode forest) and its own `DataTemplate [DataType =
// MetaModelsService]` (meta-model.resources.mu).
//
// It reads the shared meta-models storage backend (where MetaModelProjectFactory
// publishes under `<id>/<modelVersion>/`) and re-scans every time the panel
// becomes active (IActivatable). Version nodes load their entities lazily on
// first expand (see MetaModelTreeNode / meta-model-tree-builder).
import {
    MetaData,
    Model,
    ObservableCollection,
    ServiceBase,
    ServiceKey,
    type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'
import type { IActivatable } from '@pragmatic-tech-ai/mural/framework'

import { ensureMetaModelsBackend } from './meta-models-backend.js'
import { buildCatalog } from './meta-model-tree-builder.js'
import type { MetaModelTreeNode } from './meta-model-tree-node.js'

export class MetaModelsService extends ServiceBase implements IActivatable
{
    public static readonly Key = new ServiceKey<MetaModelsService>('MetaModelsService')

    public static readonly NodesKey = Model.RegisterProperty<ObservableCollection<MetaModelTreeNode>>(
        MetaModelsService, 'Nodes',
        undefined as unknown as ObservableCollection<MetaModelTreeNode>, MetaData.None)

    // True when nothing has been published yet — drives the empty-state text.
    public static readonly IsEmptyKey = Model.RegisterProperty<boolean>(
        MetaModelsService, 'IsEmpty', false, MetaData.None)

    // Bumped each reload; a slower earlier scan whose seq is stale is discarded,
    // so overlapping OnActivated/ctor reloads can't clobber the newest result.
    private reloadSeq = 0

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.set_property_value(MetaModelsService.NodesKey, new ObservableCollection<MetaModelTreeNode>())
        void this.reload()
    }

    public get Nodes(): ObservableCollection<MetaModelTreeNode>
    {
        return this.get_property_value(MetaModelsService.NodesKey)
    }

    public get IsEmpty(): boolean { return this.get_property_value(MetaModelsService.IsEmptyKey) }

    // IActivatable: re-scan whenever this panel becomes the active capability.
    public OnActivated(): void { void this.reload() }

    // Re-read the backend and rebuild the node tree in place (the bound
    // ObservableCollection updates the panel reactively).
    public async reload(): Promise<void>
    {
        const seq = ++this.reloadSeq
        const backend = ensureMetaModelsBackend(this.Provider)
        const built = await buildCatalog(backend)
        if (seq !== this.reloadSeq) return   // a newer reload superseded this one

        const nodes = this.Nodes
        nodes.Clear()
        for (const n of built) nodes.Add(n)
        this.set_property_value(MetaModelsService.IsEmptyKey, built.length === 0)
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-models-service.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Check for stale references to the deleted classes**

Run: `grep -rn "MetaModelRow\|MetaModelVersionRow\|\.Models\b" src/renderer/src/modules/meta-model`
Expected: matches ONLY in `meta-model.resources.mu` (fixed in Task 7). If any `.ts` still references them, fix it. Confirm no other module imports `scanPublishedModels` from `meta-models-service.js`:
Run: `grep -rn "scanPublishedModels" src/renderer/src` — the only matches should be in the builder + builder test.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/meta-models-service.ts src/renderer/src/modules/meta-model/services/tests/meta-models-service.test.ts
git commit -m "$(cat <<'EOF'
refactor(meta-model): service exposes a MetaModelTreeNode forest as Nodes

Replaces the MetaModelRow/MetaModelVersionRow group-by-id shape with the
buildCatalog node tree; deletes the retired row classes.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Plexus — virtualized tree view + recompile + smoke

**Repo:** `Plexus` (branch `meta-model-virtualized-tree`)

**Files:**
- Modify: `src/renderer/src/modules/meta-model/meta-model.resources.mu` (rewrite the three data templates)

**Interfaces:**
- Consumes: `MetaModelsService.Nodes`/`IsEmpty` (Task 6); `MetaModelTreeNode` (Task 3); `MetaModelKindToGeometry` (Task 5); mural `TreeView` `IsVirtualizing` (Task 2).
- Produces: the rendered virtualized panel.

- [ ] **Step 1: Rewrite the resources file**

Replace the whole body of `src/renderer/src/modules/meta-model/meta-model.resources.mu` with:

```
// meta-model.resources.mu — view resources for the Meta-models capability panel
// (MetaModelsService). Merged app-global by app.mu (`merge MetaModelResources`).
//
// Renders the published meta-models as a virtualized tree: model id → version →
// ontology entities (grouped by kind), the entities loaded lazily when a version
// row is first expanded (MetaModelTreeNode.OnExpand via mural's TreeView hook).
// One HierarchicalDataTemplate governs every level; MetaModelKindToGeometry maps
// a node's Kind to its leading glyph.

import MetaModelsService from "./services/meta-models-service.js"
import MetaModelTreeNode from "./services/meta-model-tree-node.js"
import MetaModelKindToGeometry from "./services/meta-model-node-icon.js"

resources MetaModelResources {
    // The panel body: a virtualized tree of the published models, plus an
    // empty-state line shown only while nothing has been published.
    DataTemplate [ DataType = MetaModelsService ] {
        StackPanel [ Orientation = Vertical, Margin = (12,12,12,12) ] {
            TreeView [ Indent = 14, IsVirtualizing = true,
                       ItemsSource = $Nodes, ItemTemplate = @MetaModelNodeTemplate ]
            TextBlock [ Style = @BodyMedium, Text = "No published meta-models yet.",
                        Foreground = @OnSurfaceVariant, TextWrapping = Wrap,
                        Visibility = $IsEmpty << ToVisibility ]
        }
    }

    // One tree row (any level): the per-kind leading icon + the node's label.
    // `itemsselector = Children` recurses the template down the tree; the
    // framework's TreeView chrome supplies chevrons, indent, hover, selection.
    HierarchicalDataTemplate x:key="MetaModelNodeTemplate"
        [ DataType = MetaModelTreeNode, itemsselector = Children ] {
        StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {
            Shape [ Geometry = $Kind << MetaModelKindToGeometry, Fill = @OnSurfaceVariant,
                    Width = 16, Height = 16, Margin = (0,0,6,0), VerticalAlignment = Center ]
            TextBlock [ Text = $Label, Style = @BodyMedium, VerticalAlignment = Center ]
        }
    }
}
```

- [ ] **Step 2: Recompile the `.mu` resources**

Run: `npm run compile:mu`
Expected: no compiler errors; `meta-model.resources.mu.js` regenerates. If the compiler rejects `itemsselector`, cross-check the exact attribute spelling against the working `project-explorer.resources.mu` `HierarchicalDataTemplate` (line ~122) and match it.

- [ ] **Step 3: Run the full Plexus test suite**

Run: `npm test`
Expected: green. (Confirms no test referenced the deleted `MetaModelRow`/`Models`.)

- [ ] **Step 4: Dev smoke**

Run: `unset ELECTRON_RUN_AS_NODE; npm run dev`
Then in the app: open the **Meta-models** panel. Verify:
- Published model ids appear as top-level rows with the meta-model glyph and a chevron.
- Expanding a model shows its version rows; expanding a version shows `Concepts` / `Relationships` / … groups, then entity rows (a brief "Loading…" may flash).
- A model with no entities shows a single "No entities" row; scrolling a large model's entity list stays smooth (virtualization).

Close the dev app when satisfied.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/meta-model.resources.mu src/renderer/src/modules/meta-model/meta-model.resources.mu.js
git commit -m "$(cat <<'EOF'
feat(meta-model): virtualized tree view of the model catalog + entities

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** Component 1 → Task 1; Component 2 → Task 3; Component 3 → Task 4; Component 4 → Task 5; Component 5 → Task 6; Component 6 → Task 7; Component 7 (dep bump + recompile) → Tasks 2 & 7-Step 2. All covered.
- **Type consistency:** `MetaModelNodeKind` (enum, string values), `MetaModelTreeNode.leaf/lazy/OnExpand`, `buildCatalog`/`loadVersionEntities`/`scanPublishedModels` signatures, and `MetaModelKindToGeometry`/`iconKeyForNodeKind` names are identical across Tasks 3–7 and the `.mu` imports.
- **Accessor:** the tests use `ObservableCollection.Get(i)` (returns `T | undefined`, so `.Get(i)!`), verified against the installed mural d.ts.
- **Ordering:** Task 1 (mural publish) gates Task 2 (Plexus install), which gates the runtime hook; Tasks 3–5 are independent leaves; Task 6 depends on 3+4; Task 7 depends on 3, 5, 6.

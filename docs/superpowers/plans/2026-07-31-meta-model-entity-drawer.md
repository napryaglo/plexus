# Meta-model Entity Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Double-clicking an ontology-entity row in the Meta-models tree opens a Modal drawer that renders the entity through its published `mm:<id>` presentation template (header) above a field/attribute detail view.

**Architecture:** A new mural `TreeView` double-click hook (`OnActivate`, sibling of `OnExpand`) fires on the data item. The entity `MetaModelTreeNode` carries an `EntityRef` and calls the service's `openEntity`. The service loads the published `presentation.generated.mu` via a runtime `instantiate()` (taught to build `resources {}` dicts) into a `ResourceDictionary`, builds a `MetaModelEntity` (fields resolved from `HasField` edges), resolves + applies `mm:<id>` into `entity.Presentation`, and opens a Modal `SideSheet` bound to service DPs. All drawer chrome is `.mu` template-driven.

**Tech Stack:** TypeScript, `@pragmatic-tech-ai/mural` (runtime/basic/framework/visual-engine/compiler), `@pragmatic-tech-ai/todl` (`TodlDocument`/`JsonNode`/`JsonEdge`), Electron renderer, `node:test`/`tsx` (mural) + `vitest` (Plexus).

## Global Constraints

- **mural version floor:** the mural changes ship as `0.1.57`; Plexus depends on `^0.1.57`.
- **Enums over string-literal unions** (TS): any fixed value set is a real `enum`; no `x === 'literal'` against a bare string, no `type X = 'a'|'b'`.
- **Tests in `tests/` subfolders** next to the code, in both repos.
- **Render through templates only:** every visible drawer element flows through a `DataTemplate`/`Style`/`Binding` in `.mu`. The service composes no visuals — it only fills DPs. The one allowed exception is `entity.Presentation` (the *result* of applying the loaded `mm:<id>` template), hosted by a markup `ContentControl`.
- **No deep mural imports from Plexus:** consume only published package subpaths (`@pragmatic-tech-ai/mural/runtime|basic|framework|visual-engine|compiler`), never `../src`.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Proven facts (from feasibility probes)

- `instantiate()` currently **throws `Unexpected token 'export'`** on a `resources {}` doc — its body is `export class … extends ResourceDictionary` with a gated ctor whose populated instance comes from `static Clone()`. Task 1 fixes this: strip `export `, append `return <ClassName>.Clone();`.
- Proven recipe result: built dict → `CanResolve('mm:foo') === true` → `Resolve` returns a `DataTemplate` → `Apply(entity)` returns the template's root Visual.
- `PointerEventArgs.IsDoubleClick` is set **only on pointer-down** (`html-target.ts`), so the hook detects the double-click in `ClickableRow.OnPointerDown`, not in the up-fired `onClick`.
- `svgToGeometryJs(text)` (mural `src/tooling/svg-geometry.ts`) is renderer-safe (no `node:` imports) but not publicly exported — Task 1 re-exports it from the `compiler` barrel.
- The `compiler` barrel already exports `compile`, `instantiate`, `EmitError`, `CompilerOptions`, `DEFAULT_SYMBOLS`, `SymbolMap`. It does **not** export `IncludeResolver`/`IncludeResolution` — Task 1 adds them.
- `TodlDocument = { nodes: JsonNode[]; edges: JsonEdge[] }`; `JsonNode = { id, tier, typeOf, attrs: Record<string,Scalar> }`; `JsonEdge = { kind, via, from, to }`.
- The currently-published `tech-architecture/0.1.0` predates sub-project A and has **no `presentation/` folder** — the loader will hit the graceful "unavailable" path until the user re-publishes. This is expected; the drawer still shows fields/attrs.

---

# Part 1 — mural (branch `treeview-data-templates`, publish `0.1.57`)

### Task 1: `instantiate()` builds `resources {}` dicts + barrel exports

**Files:**
- Modify: `src/compiler/compile.ts` (the `instantiate` function, around lines 146-186)
- Modify: `src/compiler/index.ts` (barrel — add type + `svgToGeometryJs` re-exports)
- Test: `src/compiler/tests/instantiate-resources.test.ts` (create)

**Interfaces:**
- Consumes: `runPipeline(source, options): CompilerOutput` (already in `compile.ts`); `CompilerOutput.kind`, `.body`, `.imports`, `.resourcesBlocks` (each `{ name, imports, accessors }`).
- Produces: `instantiate(source, ctx, options)` returns the built `ResourceDictionary` instance when the source is a single-block `resources {}` doc. `IncludeResolver`, `IncludeResolution`, `svgToGeometryJs`, `GeometryResourceJs` reachable from `@pragmatic-tech-ai/mural/compiler`.

- [ ] **Step 1: Write the failing test**

Create `src/compiler/tests/instantiate-resources.test.ts`:

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../basic/tests/test-app.js';
import * as runtime from '../../runtime/index.js';
import * as engine from '../../visual-engine/index.js';
import * as basic from '../../basic/index.js';
import { instantiate } from '../compile.js';
import { DEFAULT_SYMBOLS } from '../symbol-table.js';
import { DataTemplate } from '../../basic/templates/data-template.js';

class Entity extends runtime.Model {}

describe('instantiate — resources dictionary', () => {
    test('builds a resources {} doc and resolves a keyed template', () => {
        initTestApp();
        const source = [
            'resources P {',
            '    DataTemplate x:key="mm:foo" [ DataType = Entity ] {',
            '        TextBlock [ Text = "Foo" ]',
            '    }',
            '}',
        ].join('\n');
        const ctx: Record<string, unknown> = { ...runtime, ...engine, ...basic, Entity };
        const symbols = new Map([...DEFAULT_SYMBOLS, ['Entity', '@app/entity']]);

        const dict = instantiate(source, ctx, { symbols }) as
            { CanResolve(k: string): boolean; Resolve(k: string): unknown };

        assert.equal(dict.CanResolve('mm:foo'), true);
        assert.ok(dict.Resolve('mm:foo') instanceof DataTemplate);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test src/compiler/tests/instantiate-resources.test.ts`
Expected: FAIL — `instantiate` throws `Unexpected token 'export'`.

- [ ] **Step 3: Add the resources branch to `instantiate`**

In `src/compiler/compile.ts`, inside `instantiate`, AFTER the `sortedSyms` missing-symbol check and BEFORE the existing `const destructure = …` line, add a dedicated resources branch that returns early:

```ts
    // Resources dicts compile to `export class NAME extends ResourceDictionary`
    // whose populated instance comes from `static Clone()`. new Function() can't
    // hold `export`, so strip it and return the built dict directly. (Single
    // block is the runtime case; multiple blocks aren't a runtime need.)
    if (out.kind === 'resources')
    {
        const blocks = out.resourcesBlocks ?? [];
        if (blocks.length !== 1)
        {
            throw new EmitError(
                `instantiate: a resources doc must have exactly one block, got ${blocks.length}`);
        }
        const className = blocks[0]!.name;
        const destructureR = (sortedSyms.length > 0)
            ? `const { ${sortedSyms.join(', ')} } = _ctx;\n`
            : '';
        const bodyR = out.body.replace(/^export class /gm, 'class ');
        const fnR = new Function('_ctx', destructureR + bodyR + `\nreturn ${className}.Clone();`) as
            (c: Record<string, unknown>) => unknown;
        return fnR(ctx);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test src/compiler/tests/instantiate-resources.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the barrel exports**

In `src/compiler/index.ts`, add after the existing `export { Compiler, … } from './compiler.js';` line:

```ts
export type { IncludeResolver, IncludeResolution } from './compiler.js';
export { svgToGeometryJs, type GeometryResourceJs } from '../tooling/svg-geometry.js';
```

- [ ] **Step 6: Typecheck the barrel addition**

Run: `npx tsc --noEmit`
Expected: PASS (no errors from the new re-exports).

- [ ] **Step 7: Commit**

```bash
git add src/compiler/compile.ts src/compiler/index.ts src/compiler/tests/instantiate-resources.test.ts
git commit -m "feat(compiler): instantiate() builds resources dicts at runtime + export include/svg helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `TreeView` `OnActivate` double-click data hook

**Files:**
- Modify: `src/framework/list/tree-view.ts` (`ClickableRow`, `TreeViewItem` ctor, `ExpandableTreeData` interface)
- Test: `src/framework/list/tests/tree-view.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `PointerEventArgs.IsDoubleClick` (down-only); `dataOf(container)` (existing module-private helper).
- Produces: a data item exposing `OnActivate?(): void` is invoked on a row double-click. `ClickableRow.onActivate?: () => void`.

- [ ] **Step 1: Write the failing test**

Append to `src/framework/list/tests/tree-view.test.ts` (a new describe, after the OnExpand block):

```ts
describe('TreeViewItem — OnActivate data hook (double-click)', () => {
    beforeEach(() => { initTestApp(); });

    test('double-clicking a data-bound row invokes the data item OnActivate()', () => {
        const tree = new TreeView();
        let fired = 0;
        const data = { Name: 'root', children: [], OnActivate() { fired++; } };
        tree.ItemTemplate = new HierarchicalDataTemplate(
            (d) => new TextBlock((d as { Name: string }).Name),
            (d) => (d as { children?: unknown[] }).children,
        );
        tree.ItemsSource = [data];
        const target = new HeadlessTarget(250, 400);
        target.Content = tree;
        target.Flush();

        const im = new InputManager(target);
        const row = rowOf(tree.RootItems[0]!);
        im.InjectPointerDown(row, pointer({}));                         // single → no activate
        assert.equal(fired, 0);
        im.InjectPointerDown(row, { ...pointer({}), IsDoubleClick: true }); // double → activate
        assert.equal(fired, 1, 'OnActivate fires on a double-click press');
    });
});
```

(`InputManager`, `HeadlessTarget`, `rowOf`, `pointer` are already imported/defined in this test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test --test-name-pattern="OnActivate data hook" src/framework/list/tests/tree-view.test.ts`
Expected: FAIL — `fired` stays 0 (no activation wiring).

- [ ] **Step 3: Add `onActivate` to `ClickableRow`**

In `ClickableRow`, add the field and fire it on a double-click press. Change the class's `onClick` field block to also declare `onActivate`, and update `OnPointerDown`:

```ts
    public onActivate: (() => void) | undefined;
```

and in `ClickableRow.OnPointerDown`, at the top of the method body:

```ts
    protected override OnPointerDown(args: PointerEventArgs): void
    {
        if (args.IsDoubleClick) this.onActivate?.();
        this._pressOriginatedHere = true;
        this._setIsPressed(true);
    }
```

- [ ] **Step 4: Wire the row to the data item in `TreeViewItem` ctor**

In the `TreeViewItem` constructor, right after the existing `this._row.onClick = …` assignment, add:

```ts
        this._row.onActivate = (): void => {
            const data = dataOf(this) as ExpandableTreeData | undefined;
            data?.OnActivate?.();
        };
```

- [ ] **Step 5: Extend the data interface**

Change the `ExpandableTreeData` interface (near `dataOf`) to include the new hook:

```ts
// A data item that wants tree-row lifecycle callbacks — the framework calls
// OnExpand() on each transition to expanded, and OnActivate() on a row
// double-click. Idempotency is the data item's responsibility.
interface ExpandableTreeData { OnExpand?(): void; OnActivate?(): void }
```

- [ ] **Step 6: Run the full tree-view suite**

Run: `npx tsx --conditions=development --test src/framework/list/tests/tree-view.test.ts`
Expected: PASS (all, including the new test).

- [ ] **Step 7: Commit**

```bash
git add src/framework/list/tree-view.ts src/framework/list/tests/tree-view.test.ts
git commit -m "feat(tree-view): OnActivate double-click data hook (sibling of OnExpand)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Version bump + publish `0.1.57`

**Files:**
- Modify: `package.json` (`version`)

- [ ] **Step 1: Bump the version**

Set `"version": "0.1.57"` in `package.json`.

- [ ] **Step 2: Verify the affected suites are green**

Run: `npx tsx --conditions=development --test "src/compiler/tests/*.test.ts" "src/framework/list/tests/*.test.ts"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(mural): 0.1.57

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 4: Publish to Verdaccio**

Run: `npm publish`
Expected: `+ @pragmatic-tech-ai/mural@0.1.57`.

---

# Part 2 — Plexus (branch `meta-model-entity-drawer`, base `main`)

All Plexus paths below are under `src/renderer/src/modules/meta-model/`.

### Task 4: `MetaModelEntity` + `MetaModelField` data objects

**Files:**
- Create: `services/meta-model-entity.ts`
- Test: `services/tests/meta-model-entity.test.ts`

**Interfaces:**
- Produces: `class MetaModelEntity extends Model` with settable DPs `Id: string`, `TypeOf: string`, `Label: string`, `Attrs: Record<string, unknown>`, read `Fields: ObservableCollection<MetaModelField>`, `Presentation: Visual | undefined`. `class MetaModelField extends Model` with `Name: string`, `Type: string`, `Cardinality: number`. Both have public no-arg constructors.

- [ ] **Step 1: Write the failing test**

Create `services/tests/meta-model-entity.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { MetaModelEntity, MetaModelField } from '../meta-model-entity.js'

describe('MetaModelEntity', () => {
  it('holds identity, attrs, and a live Fields collection', () => {
    const e = new MetaModelEntity()
    e.Id = 'application'; e.TypeOf = 'concept'; e.Label = 'Application'
    e.Attrs = { label: 'Application' }
    const f = new MetaModelField()
    f.Name = 'kind'; f.Type = 'ApplicationKind'; f.Cardinality = 0
    e.Fields.Add(f)

    expect(e.Id).toBe('application')
    expect(e.Label).toBe('Application')
    expect(e.Attrs.label).toBe('Application')
    expect(e.Fields.Count).toBe(1)
    expect(e.Fields.Get(0)!.Name).toBe('kind')
    expect(e.Presentation).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-entity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the data objects**

Create `services/meta-model-entity.ts`:

```ts
// meta-model-entity.ts — the data object a double-clicked ontology entity is
// projected into for the drawer. MetaModelEntity is BOTH the `instantiate` ctx
// symbol the generated presentation references (DataType = MetaModelEntity) AND
// the DataType the drawer's detail template binds. Presentation holds the applied
// mm:<id> template (filled by the service; undefined when unavailable).
import { MetaData, Model, ObservableCollection, type Visual } from '@pragmatic-tech-ai/mural/runtime'

export class MetaModelField extends Model
{
    public static readonly NameKey = Model.RegisterProperty<string>(
        MetaModelField, 'Name', '', MetaData.None)
    public static readonly TypeKey = Model.RegisterProperty<string>(
        MetaModelField, 'Type', '', MetaData.None)
    public static readonly CardinalityKey = Model.RegisterProperty<number>(
        MetaModelField, 'Cardinality', 0, MetaData.None)

    public get Name(): string { return this.get_property_value(MetaModelField.NameKey) }
    public set Name(v: string) { this.set_property_value(MetaModelField.NameKey, v) }
    public get Type(): string { return this.get_property_value(MetaModelField.TypeKey) }
    public set Type(v: string) { this.set_property_value(MetaModelField.TypeKey, v) }
    public get Cardinality(): number { return this.get_property_value(MetaModelField.CardinalityKey) }
    public set Cardinality(v: number) { this.set_property_value(MetaModelField.CardinalityKey, v) }
}

export class MetaModelEntity extends Model
{
    public static readonly IdKey = Model.RegisterProperty<string>(
        MetaModelEntity, 'Id', '', MetaData.None)
    public static readonly TypeOfKey = Model.RegisterProperty<string>(
        MetaModelEntity, 'TypeOf', '', MetaData.None)
    public static readonly LabelKey = Model.RegisterProperty<string>(
        MetaModelEntity, 'Label', '', MetaData.None)
    public static readonly AttrsKey = Model.RegisterProperty<Record<string, unknown>>(
        MetaModelEntity, 'Attrs', {}, MetaData.None)
    public static readonly FieldsKey = Model.RegisterProperty<ObservableCollection<MetaModelField>>(
        MetaModelEntity, 'Fields',
        undefined as unknown as ObservableCollection<MetaModelField>, MetaData.None)
    public static readonly PresentationKey = Model.RegisterProperty<Visual | undefined>(
        MetaModelEntity, 'Presentation', undefined, MetaData.None)

    public constructor()
    {
        super()
        this.set_property_value(MetaModelEntity.FieldsKey, new ObservableCollection<MetaModelField>())
    }

    public get Id(): string { return this.get_property_value(MetaModelEntity.IdKey) }
    public set Id(v: string) { this.set_property_value(MetaModelEntity.IdKey, v) }
    public get TypeOf(): string { return this.get_property_value(MetaModelEntity.TypeOfKey) }
    public set TypeOf(v: string) { this.set_property_value(MetaModelEntity.TypeOfKey, v) }
    public get Label(): string { return this.get_property_value(MetaModelEntity.LabelKey) }
    public set Label(v: string) { this.set_property_value(MetaModelEntity.LabelKey, v) }
    public get Attrs(): Record<string, unknown> { return this.get_property_value(MetaModelEntity.AttrsKey) }
    public set Attrs(v: Record<string, unknown>) { this.set_property_value(MetaModelEntity.AttrsKey, v) }
    public get Fields(): ObservableCollection<MetaModelField> { return this.get_property_value(MetaModelEntity.FieldsKey) }
    public get Presentation(): Visual | undefined { return this.get_property_value(MetaModelEntity.PresentationKey) }
    public set Presentation(v: Visual | undefined) { this.set_property_value(MetaModelEntity.PresentationKey, v) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-entity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/meta-model-entity.ts src/renderer/src/modules/meta-model/services/tests/meta-model-entity.test.ts
git commit -m "feat(meta-model): MetaModelEntity + MetaModelField data objects

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `buildEntity` — project an entity + its fields from the doc

**Files:**
- Create: `services/meta-model-entity-builder.ts`
- Test: `services/tests/meta-model-entity-builder.test.ts`

**Interfaces:**
- Consumes: `MetaModelEntity`, `MetaModelField` (Task 4); `humanize` (from `presentation-generator.js`); `TodlDocument`, `JsonNode`, `JsonEdge` (`@pragmatic-tech-ai/todl`).
- Produces: `buildEntity(doc: TodlDocument, entityId: string): MetaModelEntity`.

- [ ] **Step 1: Write the failing test**

Create `services/tests/meta-model-entity-builder.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-tech-ai/todl'
import { buildEntity } from '../meta-model-entity-builder.js'

const doc: TodlDocument = {
  nodes: [
    { id: 'application', tier: 'Ontology', typeOf: 'concept', attrs: {} },
    { id: 'application.id',   tier: 'Ontology', typeOf: 'field', attrs: { name: 'id',   type: 'identifier', cardinality: 0 } },
    { id: 'application.kind', tier: 'Ontology', typeOf: 'field', attrs: { name: 'kind', type: 'ApplicationKind', cardinality: 0 } },
    { id: 'actor',        tier: 'Ontology', typeOf: 'concept', attrs: { label: 'Human Actor' } },
  ],
  edges: [
    { kind: 'HasField', via: null, from: 'application', to: 'application.id' },
    { kind: 'HasField', via: null, from: 'application', to: 'application.kind' },
    { kind: 'HasField', via: null, from: 'application', to: 'missing.field' }, // dangling → skipped
  ],
}

describe('buildEntity', () => {
  it('resolves fields from HasField edges in order and humanizes a missing label', () => {
    const e = buildEntity(doc, 'application')
    expect(e.Id).toBe('application')
    expect(e.TypeOf).toBe('concept')
    expect(e.Label).toBe('Application')                 // attrs.label absent → humanize(id)
    expect(e.Fields.Count).toBe(2)                      // dangling edge skipped
    expect(e.Fields.Get(0)!.Name).toBe('id')
    expect(e.Fields.Get(1)!.Type).toBe('ApplicationKind')
  })

  it('prefers attrs.label when present', () => {
    const e = buildEntity(doc, 'actor')
    expect(e.Label).toBe('Human Actor')
    expect(e.Fields.Count).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-entity-builder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the builder**

Create `services/meta-model-entity-builder.ts`:

```ts
// meta-model-entity-builder.ts — project a MetaModelEntity (identity + own attrs
// + resolved fields) from a parsed model.json. Pure; no I/O. Fields are separate
// Ontology `field` nodes linked to the entity by `HasField` edges — a concept's
// own attrs are often empty, so the fields carry the substance.
import type { TodlDocument } from '@pragmatic-tech-ai/todl'

import { MetaModelEntity, MetaModelField } from './meta-model-entity.js'
import { humanize } from './presentation-generator.js'

const HAS_FIELD = 'HasField'

export function buildEntity(doc: TodlDocument, entityId: string): MetaModelEntity
{
    const node = doc.nodes.find((n) => n.id === entityId)
    const entity = new MetaModelEntity()
    entity.Id = entityId
    entity.TypeOf = node?.typeOf ?? ''
    const attrs = (node?.attrs ?? {}) as Record<string, unknown>
    entity.Attrs = attrs
    entity.Label = typeof attrs['label'] === 'string' ? String(attrs['label']) : humanize(entityId)

    for (const edge of doc.edges)
    {
        if (edge.kind !== HAS_FIELD || edge.from !== entityId) continue
        const fieldNode = doc.nodes.find((n) => n.id === edge.to)
        if (fieldNode === undefined) continue
        const fa = fieldNode.attrs as Record<string, unknown>
        const field = new MetaModelField()
        field.Name = typeof fa['name'] === 'string' ? String(fa['name']) : fieldNode.id
        field.Type = typeof fa['type'] === 'string' ? String(fa['type']) : ''
        field.Cardinality = typeof fa['cardinality'] === 'number' ? (fa['cardinality'] as number) : 0
        entity.Fields.Add(field)
    }
    return entity
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-entity-builder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/meta-model-entity-builder.ts src/renderer/src/modules/meta-model/services/tests/meta-model-entity-builder.test.ts
git commit -m "feat(meta-model): buildEntity resolves entity + HasField fields from the doc

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `presentation-loader` — instantiate the published dict at runtime

**Files:**
- Create: `services/presentation-loader.ts`
- Test: `services/tests/presentation-loader.test.ts`

**Interfaces:**
- Consumes: `IStorage` (`services/storage/storage.js`); `MetaModelEntity` (Task 4); mural `compiler` (`instantiate`, `DEFAULT_SYMBOLS`, `svgToGeometryJs`, `IncludeResolver`, `IncludeResolution`); mural barrels for ctx; `ResourceDictionary` (`@pragmatic-tech-ai/mural/runtime`).
- Produces: `loadPresentation(storage: IStorage, base: string): Promise<ResourceDictionary>` where `base = "<modelId>/<version>"`. Throws on read/instantiate failure.

- [ ] **Step 1: Write the failing test**

Create `services/tests/presentation-loader.test.ts`. A `FakeStorage` serves a minimal generated dict (one include + one `mm:<id>` template); the test asserts the instantiated dict resolves the key and feeds the SVG geometry.

```ts
import { describe, it, expect } from 'vitest'
import { DataTemplate } from '@pragmatic-tech-ai/mural/basic'
import type { IStorage, StorageEntry } from '../../../../services/storage/storage.js'
import { loadPresentation } from '../presentation-loader.js'

const GENERATED = [
  'resources MetaModelPresentation {',
  '    include "resources/foo.svg" as mm_icon_foo',
  '    DataTemplate x:key="mm:application" [ DataType = MetaModelEntity ] {',
  '        StackPanel [ Orientation = Horizontal ] {',
  '            Shape [ Geometry = @mm_icon_foo, Width = 16, Height = 16 ]',
  '            TextBlock [ Text = "Application" ]',
  '        }',
  '    }',
  '}',
].join('\n')

class FakeStorage implements IStorage {
  public readonly Root = 'fake://meta-models'
  private files: Record<string, string>
  constructor(files: Record<string, string>) { this.files = files }
  async ReadText(path: string): Promise<string> {
    const v = this.files[path]; if (v === undefined) throw new Error(`ENOENT ${path}`); return v
  }
  async ReadBytes(): Promise<Uint8Array> { throw new Error('unused') }
  async WriteText(): Promise<void> { throw new Error('unused') }
  async WriteBytes(): Promise<void> { throw new Error('unused') }
  async Exists(path: string): Promise<boolean> { return path in this.files }
  async Delete(): Promise<void> { throw new Error('unused') }
  async CreateDirectory(): Promise<void> { throw new Error('unused') }
  async Rename(): Promise<void> { throw new Error('unused') }
  async List(): Promise<readonly StorageEntry[]> { return [] }
}

describe('loadPresentation', () => {
  it('instantiates the generated dict and resolves an mm:<id> template with a real icon', async () => {
    const storage = new FakeStorage({
      'tech-architecture/0.1.0/presentation/presentation.generated.mu': GENERATED,
      'tech-architecture/0.1.0/presentation/resources/foo.svg':
        '<svg viewBox="0 0 16 16"><path d="M2 2 L14 2 L14 14 Z"/></svg>',
    })
    const dict = await loadPresentation(storage, 'tech-architecture/0.1.0')
    expect(dict.CanResolve('mm:application')).toBe(true)
    expect(dict.Resolve('mm:application')).toBeInstanceOf(DataTemplate)
  })

  it('throws when the generated file is missing', async () => {
    const storage = new FakeStorage({})
    await expect(loadPresentation(storage, 'x/0.0.0')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-loader.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the loader**

Create `services/presentation-loader.ts`. It pre-reads the includes (async) into a map, then instantiates with a SYNC resolver over that map:

```ts
// presentation-loader.ts — load a published presentation dictionary at runtime.
// Reads <base>/presentation/presentation.generated.mu and instantiate()s it into
// a live ResourceDictionary. The compiler's include resolver is synchronous, so
// the SVGs each `include` names are pre-read from storage first, then a sync
// resolver converts each to a Geometry via svgToGeometryJs.
import * as MuralRuntime from '@pragmatic-tech-ai/mural/runtime'
import * as MuralBasic from '@pragmatic-tech-ai/mural/basic'
import * as MuralFramework from '@pragmatic-tech-ai/mural/framework'
import * as MuralEngine from '@pragmatic-tech-ai/mural/visual-engine'
import { ResourceDictionary } from '@pragmatic-tech-ai/mural/runtime'
import {
    instantiate, DEFAULT_SYMBOLS, svgToGeometryJs,
    type IncludeResolver, type IncludeResolution,
} from '@pragmatic-tech-ai/mural/compiler'

import type { IStorage } from '../../../services/storage/storage.js'
import { MetaModelEntity } from './meta-model-entity.js'

const GENERATED = 'presentation/presentation.generated.mu'
const VISUAL_ENGINE = '@pragmatic-tech-ai/mural/visual-engine'

// Every `include "<path>" …` path named in the source.
function includePaths(source: string): string[]
{
    const paths: string[] = []
    const re = /include\s+"([^"]+)"/g
    let m: RegExpExecArray | null
    while ((m = re.exec(source)) !== null) paths.push(m[1]!)
    return paths
}

export async function loadPresentation(storage: IStorage, base: string): Promise<ResourceDictionary>
{
    const source = await storage.ReadText(`${base}/${GENERATED}`)

    // Pre-read each included SVG (async) into a path → text map.
    const svgByPath = new Map<string, string>()
    for (const path of includePaths(source))
    {
        svgByPath.set(path, await storage.ReadText(`${base}/presentation/${path}`))
    }

    // Sync include resolver: SVG text → geometry JS + the visual-engine names it needs.
    const include: IncludeResolver = (path, ctx): IncludeResolution =>
    {
        const text = svgByPath.get(path)
        if (text === undefined) throw new Error(`presentation include not pre-read: ${path}`)
        const { valueJs, names } = svgToGeometryJs(text)
        return {
            entries: [{ key: ctx.key ?? path, valueJs }],
            imports: [{ module: VISUAL_ENGINE, names: [...names] }],
        }
    }

    const ctx: Record<string, unknown> = {
        ...MuralRuntime, ...MuralEngine, ...MuralBasic, ...MuralFramework, MetaModelEntity,
    }
    const symbols = new Map([...DEFAULT_SYMBOLS, ['MetaModelEntity', './meta-model-entity.js']])
    return instantiate(source, ctx, { include, symbols }) as ResourceDictionary
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-loader.test.ts`
Expected: PASS.

> If `instantiate` reports a missing ctx symbol, the generated template referenced a control not in the four barrels — add that barrel to `ctx`. With the four mural barrels spread, every generated control (`StackPanel`, `Shape`, `TextBlock`, `Border`, `DataTemplate`) is present.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/presentation-loader.ts src/renderer/src/modules/meta-model/services/tests/presentation-loader.test.ts
git commit -m "feat(meta-model): runtime presentation-loader instantiates the published dict

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Entity identity + `OnActivate` on `MetaModelTreeNode`

**Files:**
- Modify: `services/meta-model-tree-node.ts`
- Test: `services/tests/meta-model-tree-node.test.ts` (append)

**Interfaces:**
- Consumes: existing `MetaModelTreeNode`, `MetaModelNodeKind`.
- Produces: `interface EntityRef { modelId: string; version: string; id: string }`; `static entity(label: string, ref: EntityRef, activate: (ref: EntityRef) => void): MetaModelTreeNode`; `OnActivate(): void` that calls `activate(ref)` when both are set. `leaf`/`lazy` nodes leave them unset (no-op).

- [ ] **Step 1: Write the failing test**

Append to `services/tests/meta-model-tree-node.test.ts`:

```ts
import { EntityRef } from '../meta-model-tree-node.js' // ensure the type is importable

describe('MetaModelTreeNode — entity activation', () => {
  it('an entity node calls activate(ref) on OnActivate', () => {
    const ref: EntityRef = { modelId: 'tech-architecture', version: '0.1.0', id: 'application' }
    let got: EntityRef | undefined
    const node = MetaModelTreeNode.entity('Application', ref, (r) => { got = r })
    node.OnActivate()
    expect(got).toEqual(ref)
  })

  it('a non-entity leaf node does nothing on OnActivate', () => {
    const node = MetaModelTreeNode.leaf(MetaModelNodeKind.Group, 'Concepts')
    expect(() => node.OnActivate()).not.toThrow()
  })
})
```

(If the existing test file lacks `MetaModelNodeKind`/`describe`/`expect` imports for this block, add them alongside the file's existing imports.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-tree-node.test.ts`
Expected: FAIL — `entity` / `EntityRef` / `OnActivate` undefined.

- [ ] **Step 3: Add the ref, factory, and hook**

In `services/meta-model-tree-node.ts`:

Add the exported type near the top (after the imports):

```ts
// Identifies a published ontology entity so a tree row can open its drawer.
export interface EntityRef { modelId: string; version: string; id: string }
```

Add two private fields alongside the existing lazy fields (`private loader?…; private loaded = false`):

```ts
    // Entity activation (view-invisible → plain fields). Only entity() sets these.
    private ref?: EntityRef
    private activate?: (ref: EntityRef) => void
```

Add the factory next to `leaf`/`lazy`:

```ts
    // An entity leaf that opens its drawer on double-click activation.
    public static entity(
        label: string, ref: EntityRef, activate: (ref: EntityRef) => void,
    ): MetaModelTreeNode
    {
        const node = new MetaModelTreeNode(MetaModelNodeKind.Entity, label)
        node.ref = ref
        node.activate = activate
        return node
    }
```

Add the hook after `OnExpand()`:

```ts
    // Called by the mural TreeViewItem on a row double-click. Entity nodes open
    // their drawer; every other node is inert.
    public OnActivate(): void
    {
        if (this.ref !== undefined && this.activate !== undefined) this.activate(this.ref)
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-tree-node.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/meta-model-tree-node.ts src/renderer/src/modules/meta-model/services/tests/meta-model-tree-node.test.ts
git commit -m "feat(meta-model): entity tree nodes carry an EntityRef + OnActivate hook

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Thread identity + activation through the tree builder

**Files:**
- Modify: `services/meta-model-tree-builder.ts`
- Test: `services/tests/meta-model-tree-builder.test.ts` (append)

**Interfaces:**
- Consumes: `MetaModelTreeNode.entity`, `EntityRef` (Task 7); existing `buildCatalog`, `loadVersionEntities`, `ontologyEntities`.
- Produces: `buildCatalog(storage: IStorage, activate: (ref: EntityRef) => void)` and `loadVersionEntities(storage, modelId, version, activate)` — entity leaves become `MetaModelTreeNode.entity(...)` carrying `{modelId, version, id}`.

- [ ] **Step 1: Write the failing test**

Append to `services/tests/meta-model-tree-builder.test.ts` a test that expands a version and asserts an entity node fires `activate` with the right ref. Reuse the file's existing fake-storage helper that serves a `model.json` with one concept. Add:

```ts
it('entity leaves carry an EntityRef wired to the activate callback', async () => {
  const storage = /* existing helper: a backend with tech-architecture/0.1.0/model.json
                     whose nodes include one Ontology concept `application` */ makeBackendWithOneConcept()
  const calls: EntityRef[] = []
  const groups = await loadVersionEntities(storage, 'tech-architecture', '0.1.0', (r) => calls.push(r))
  const concepts = groups.find((g) => g.Label === 'Concepts')!
  const appNode = concepts.Children.Get(0)!
  appNode.OnActivate()
  expect(calls).toEqual([{ modelId: 'tech-architecture', version: '0.1.0', id: 'application' }])
})
```

(Import `EntityRef` from `../meta-model-tree-node.js`. If the file has no `makeBackendWithOneConcept` helper, add one mirroring the existing fake-storage pattern in this test file, serving a `model.json` whose `nodes` contain `{ id: 'application', tier: 'Ontology', typeOf: 'concept', attrs: {} }`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-tree-builder.test.ts`
Expected: FAIL — `loadVersionEntities` has the old 3-arg signature; entity nodes are plain leaves.

- [ ] **Step 3: Thread the callback + build entity nodes**

In `services/meta-model-tree-builder.ts`:

Import the ref type:

```ts
import { MetaModelTreeNode, MetaModelNodeKind, type EntityRef } from './meta-model-tree-node.js'
```

Change `buildCatalog` to take and forward `activate`:

```ts
export async function buildCatalog(
    storage: IStorage, activate: (ref: EntityRef) => void,
): Promise<MetaModelTreeNode[]>
{
    const published = await scanPublishedModels(storage)
    return published.map((p) =>
    {
        const model = MetaModelTreeNode.leaf(MetaModelNodeKind.Model, p.id)
        for (const version of p.versions)
        {
            model.Children.Add(MetaModelTreeNode.lazy(
                MetaModelNodeKind.Version, version,
                () => loadVersionEntities(storage, p.id, version, activate),
            ))
        }
        return model
    })
}
```

Change `loadVersionEntities` to take `modelId` + `activate` and build entity nodes. Its signature becomes `(storage, id, version, activate)`; replace the entity-leaf construction line so each ontology entity node is created via `entity(...)` with a ref built from `id`/`version`/the node's own `id`:

```ts
export async function loadVersionEntities(
    storage: IStorage, id: string, version: string, activate: (ref: EntityRef) => void,
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
        for (const n of inGroup)
        {
            const ref: EntityRef = { modelId: id, version, id: n.id }
            group.Children.Add(MetaModelTreeNode.entity(entityLabel(n), ref, activate))
        }
        out.push(group)
    }
    return out
}
```

(`entityLabel`, `GROUPS`, `ontologyEntities`, `TodlDocument` import are already in this file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-tree-builder.test.ts`
Expected: PASS (the appended test and the existing ones — the existing tests call `buildCatalog`/`loadVersionEntities`; update those call sites in the test file to pass a no-op `() => {}` as the new arg).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/meta-model-tree-builder.ts src/renderer/src/modules/meta-model/services/tests/meta-model-tree-builder.test.ts
git commit -m "feat(meta-model): tree builder threads EntityRef + activation into entity leaves

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Service orchestration — `openEntity`, drawer DPs, dict cache

**Files:**
- Modify: `services/meta-models-service.ts`
- Test: `services/tests/meta-models-service.test.ts` (append)

**Interfaces:**
- Consumes: `buildCatalog` (Task 8, now 2-arg); `loadPresentation` (Task 6); `buildEntity` (Task 5); `MetaModelEntity` (Task 4); `EntityRef` (Task 7); `ensureMetaModelsBackend`; `DataTemplate` (`@pragmatic-tech-ai/mural/basic`); `ResourceDictionary` (`@pragmatic-tech-ai/mural/runtime`).
- Produces: DPs `DrawerEntity: MetaModelEntity | undefined`, `IsDrawerOpen: boolean`; method `openEntity(ref: EntityRef): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Append to `services/tests/meta-models-service.test.ts` two tests: success fills `Presentation` + opens; loader failure still opens with `Presentation` undefined. Use a fake backend serving a `model.json` (one concept + a `HasField` field) and a `presentation/presentation.generated.mu`; and a failure fake with `model.json` only.

```ts
it('openEntity loads the dict, builds the entity, fills Presentation, and opens', async () => {
  const svc = /* construct MetaModelsService over a backend with model.json + presentation */ makeServiceWithPresentation()
  await svc.openEntity({ modelId: 'tech-architecture', version: '0.1.0', id: 'application' })
  expect(svc.IsDrawerOpen).toBe(true)
  expect(svc.DrawerEntity?.Id).toBe('application')
  expect(svc.DrawerEntity?.Presentation).toBeDefined()  // mm:application resolved + applied
})

it('openEntity still opens (Presentation undefined) when the presentation is missing', async () => {
  const svc = makeServiceWithoutPresentation()   // model.json present, no presentation/ folder
  await svc.openEntity({ modelId: 'tech-architecture', version: '0.1.0', id: 'application' })
  expect(svc.IsDrawerOpen).toBe(true)
  expect(svc.DrawerEntity?.Id).toBe('application')
  expect(svc.DrawerEntity?.Presentation).toBeUndefined()
})
```

(Build the fakes with the existing test file's service-construction helper + the `FakeStorage` shape from Task 6. The presentation fake serves the same minimal `GENERATED` string keyed `mm:application`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-models-service.test.ts`
Expected: FAIL — `openEntity`/`DrawerEntity`/`IsDrawerOpen` undefined.

- [ ] **Step 3: Implement the orchestration**

In `services/meta-models-service.ts`:

Add imports:

```ts
import type { Visual } from '@pragmatic-tech-ai/mural/runtime'
import { ResourceDictionary } from '@pragmatic-tech-ai/mural/runtime'
import { DataTemplate } from '@pragmatic-tech-ai/mural/basic'
import { buildCatalog } from './meta-model-tree-builder.js'
import { loadPresentation } from './presentation-loader.js'
import { buildEntity } from './meta-model-entity-builder.js'
import { MetaModelEntity } from './meta-model-entity.js'
import type { EntityRef } from './meta-model-tree-node.js'
import type { TodlDocument } from '@pragmatic-tech-ai/todl'
```

Add the two DPs (alongside `NodesKey`/`IsEmptyKey`):

```ts
    public static readonly DrawerEntityKey = Model.RegisterProperty<MetaModelEntity | undefined>(
        MetaModelsService, 'DrawerEntity', undefined, MetaData.None)
    public static readonly IsDrawerOpenKey = Model.RegisterProperty<boolean>(
        MetaModelsService, 'IsDrawerOpen', false, MetaData.None)
```

Add a dictionary cache field and getters:

```ts
    private readonly dictCache = new Map<string, ResourceDictionary>()

    public get DrawerEntity(): MetaModelEntity | undefined { return this.get_property_value(MetaModelsService.DrawerEntityKey) }
    public get IsDrawerOpen(): boolean { return this.get_property_value(MetaModelsService.IsDrawerOpenKey) }
```

Change the `reload()` `buildCatalog(backend)` call to pass the activation callback and clear the cache:

```ts
        this.dictCache.clear()
        const built = await buildCatalog(backend, (ref) => { void this.openEntity(ref) })
```

Add `openEntity`:

```ts
    // Open the drawer for a double-clicked entity: load-or-cache the version's
    // presentation dictionary, build the entity from model.json, resolve + apply
    // its mm:<id> template, and open. A load/resolve failure still opens the
    // drawer (Presentation undefined → the template shows a note).
    public async openEntity(ref: EntityRef): Promise<void>
    {
        const backend = ensureMetaModelsBackend(this.Provider)
        const base = `${ref.modelId}/${ref.version}`

        let entity: MetaModelEntity
        try
        {
            const doc = JSON.parse(await backend.ReadText(`${base}/model.json`)) as TodlDocument
            entity = buildEntity(doc, ref.id)
        }
        catch
        {
            entity = new MetaModelEntity()
            entity.Id = ref.id
        }

        try
        {
            let dict = this.dictCache.get(base)
            if (dict === undefined)
            {
                dict = await loadPresentation(backend, base)
                this.dictCache.set(base, dict)
            }
            const key = `mm:${ref.id}`
            if (dict.CanResolve(key))
            {
                const tmpl = dict.Resolve(key)
                if (tmpl instanceof DataTemplate) entity.Presentation = tmpl.Apply(entity) as Visual
            }
        }
        catch { /* presentation unavailable — degrade to detail-only */ }

        this.set_property_value(MetaModelsService.DrawerEntityKey, entity)
        this.set_property_value(MetaModelsService.IsDrawerOpenKey, true)
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-models-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/meta-models-service.ts src/renderer/src/modules/meta-model/services/tests/meta-models-service.test.ts
git commit -m "feat(meta-model): service openEntity loads presentation, builds entity, opens drawer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Drawer markup + mural bump + full verification

**Files:**
- Modify: `meta-model.resources.mu`
- Modify: `package.json` (mural `^0.1.57`)

**Interfaces:**
- Consumes: `MetaModelsService.IsDrawerOpen`/`DrawerEntity`; `MetaModelEntity.Presentation`/`Fields`/`Label`/`TypeOf`/`Id`; `MetaModelField.Name`/`Type`; mural `SideSheet` (Modal), `ContentControl`, `ItemsControl`.

- [ ] **Step 1: Install mural 0.1.57**

Set `"@pragmatic-tech-ai/mural": "^0.1.57"` in `package.json`, then:

Run: `npm install @pragmatic-tech-ai/mural@0.1.57 --registry http://localhost:4873/`
Expected: installs 0.1.57 (verify `grep '"version"' node_modules/@pragmatic-tech-ai/mural/package.json` → `0.1.57`).

- [ ] **Step 2: Add the drawer + detail template to the panel markup**

In `meta-model.resources.mu`, add the imports at the top:

```
import MetaModelEntity from "./services/meta-model-entity.js"
```

Add the Modal `SideSheet` as the LAST child of the panel `DockPanel` (it contributes 0 to flow until open), and a detail `DataTemplate`. Inside the existing `DataTemplate [ DataType = MetaModelsService ]`'s `DockPanel`, append:

```
            SideSheet [ Variant = Modal, Anchor = Right, SheetSize = 360,
                        IsOpen = $IsDrawerOpen,
                        Content = $DrawerEntity, ContentTemplate = @MetaModelEntityDetail ]
```

Add the detail template as a sibling resource in the `MetaModelResources` block:

```
    // The drawer body: the entity's mm:<id> presentation (header) over its
    // identity + resolved fields. Presentation is undefined when the published
    // dictionary is unavailable — a note shows in its place.
    DataTemplate x:key="MetaModelEntityDetail" [ DataType = MetaModelEntity ] {
        StackPanel [ Orientation = Vertical, Margin = (16,16,16,16) ] {
            ContentControl [ Content = $Presentation, Margin = (0,0,0,12) ]
            TextBlock [ Text = "Presentation unavailable — republish the meta-model.",
                        Style = @BodySmall, Foreground = @OnSurfaceVariant, TextWrapping = Wrap,
                        Visibility = $Presentation << IsNullToVisibility, Margin = (0,0,0,12) ]
            TextBlock [ Text = $TypeOf, Style = @LabelSmall, Foreground = @OnSurfaceVariant ]
            TextBlock [ Text = $Label, Style = @TitleMedium, Foreground = @OnSurface, Margin = (0,0,0,8) ]
            TextBlock [ Text = "Fields", Style = @LabelMedium, Foreground = @OnSurfaceVariant ]
            ItemsControl [ ItemsSource = $Fields ] {
                ItemsControl.ItemTemplate {
                    DataTemplate [ DataType = MetaModelField ] {
                        StackPanel [ Orientation = Horizontal, Margin = (0,2,0,2) ] {
                            TextBlock [ Text = $Name, Style = @BodyMedium, Foreground = @OnSurface ]
                            TextBlock [ Text = " : ", Style = @BodyMedium, Foreground = @OnSurfaceVariant ]
                            TextBlock [ Text = $Type, Style = @BodyMedium, Foreground = @OnSurfaceVariant ]
                        }
                    }
                }
            }
        }
    }
```

> **Markup-symbol verification (do this before Step 3, adjust as the compiler dictates):**
> - `IsNullToVisibility` converter: create it — add a `ValueConverter` in a new `services/meta-model-converters.ts` (`convert: (v) => v == null ? Visibility.Visible : Visibility.Collapsed`, importing `Visibility` + `ValueConverter` from `@pragmatic-tech-ai/mural/runtime`) and `import … from "./services/meta-model-converters.js"` in the `.mu`. (The tree already uses the `$Kind << MetaModelKindToGeometry` converter pattern — mirror it.)
> - `ContentControl` hosting a bound Visual: if the compiler reports `ContentControl` is not a known markup symbol, use `ContentPresenter [ Content = $Presentation ]` instead (whichever the symbol table accepts — grep `ContentControl`/`ContentPresenter` in `src/compiler/symbol-table.ts`).
> - `Style` keys (`@TitleMedium`, `@LabelSmall`, `@LabelMedium`, `@BodySmall`): confirm each exists in the app theme (grep the theme `.mu` for the key). The tree already uses `@BodyMedium`/`@OnSurface`/`@OnSurfaceVariant`, so those are safe; substitute the nearest existing key for any the compiler flags as unresolved.
> - `SideSheet`: confirm it's a markup symbol (it's a mural framework control with a default Style); if the compiler flags it, add it to the `.mu` imports from `@pragmatic-tech-ai/mural/framework`.

- [ ] **Step 3: Compile the markup**

Run: `npm run compile:mu`
Expected: no compile errors; `meta-model.resources.mu.js` regenerates. Fix any unknown-symbol/binding errors the compiler reports (most likely a missing `Style` key or converter — see the note in Step 2).

- [ ] **Step 4: Run the full Plexus meta-model test suite**

Run: `npx vitest run src/renderer/src/modules/meta-model`
Expected: PASS (all tasks' tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck:web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/modules/meta-model/meta-model.resources.mu package.json package-lock.json
git commit -m "feat(meta-model): entity drawer markup + bump mural to ^0.1.57

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 7: Boot smoke (manual)**

Run: `npm run dev` (unset `ELECTRON_RUN_AS_NODE` first). Open the Meta-models panel, expand a version to an entity, double-click it → the Modal drawer opens on the right with the entity's type/label and its field list. If the model was published before sub-project A (no `presentation/` folder), the header shows the "Presentation unavailable — republish" note; re-publish the meta-model project to render the `mm:<id>` header badge.

---

## Notes / deferred

- **Author-override merge:** the loader instantiates the generated dict only. `generatePresentationMu` emits `merge <Dict>` lines only when a project ships author overrides; a model with overrides would need those dictionaries compiled into ctx too. The current `tech-architecture` model has none. If a future model does, `instantiate` will report the missing merge symbol and `openEntity` degrades (drawer opens, `Presentation` undefined). Full override support is a follow-up.
- **Re-publish requirement:** the on-disk `tech-architecture/0.1.0` predates sub-project A, so its `presentation/` folder is absent until re-published. The drawer works regardless (fields/attrs); only the header badge needs the payload.
```

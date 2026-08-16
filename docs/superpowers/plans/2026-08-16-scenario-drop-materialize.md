# Drop-a-Scenario → Materialize Its Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dropping a scenario onto the architecture canvas places one node per participating component/actor/block and one directional connector per step, laid out as a left-to-right flow — a pure visualization, writing no model data.

**Architecture:** A pure module computes the flow (participants, step edges, layered columns, positions) from a scenario entity; a thin drop factory applies that plan to the diagram (reuse-first node creation + `CreateConnector`); a Scenarios toolbox page lists draggable scenarios. Mirrors the existing `ArchModelInstanceDropFactory` / `ArchModelToolboxContributor` place-existing-entity pattern.

**Tech Stack:** TypeScript, `@pragmatic-lab/mural` framework (`DiagramDocument`, `ArchNodeVM`, `ConnectorEndpoint`), `@pragmatic-lab/todl` `Entity`, vitest (node env).

## Global Constraints

- **Visualization only.** No `model.create` / `model.addRef` / `model.save`. The only model call is `model.notifyChanged()` (triggers the binding rescan that labels/icons the nodes).
- **No TODL changes.**
- **Every test file lives in a `tests/` subfolder** next to its source.
- **Tests run in the `node` vitest env; do not import `monaco-editor`.** `@pragmatic-lab/mural` and `@pragmatic-lab/todl` ARE importable (vitest `deps.inline`), as the sibling arch-service tests show.
- **Enums over string-literal unions** for any fixed set.
- Meta-model relationship names (fixed): `scenario.sequences`, `sequence.steps`, `step.src`, `step.dst`.
- Intended for a **Scenarios-viewpoint** diagram; no structural-edge suppression logic is added.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/renderer/src/modules/architecture-projects/services/scenario-flow.ts` (NEW, pure) | `collectScenarioFlow`, `layoutColumns`, `planScenarioDrop` — participants, deduped step edges, cycle-broken longest-path columns, positions |
| `src/renderer/src/modules/architecture-projects/services/arch-scenario-drop-factory.ts` (NEW) | `scenarioIdOf`, `ArchScenarioDropFactory` — applies the plan to the diagram |
| `src/renderer/src/modules/diagram/services/register-arch-toolbox-adapters.ts` (MODIFY) | register the factory |
| `src/renderer/src/modules/architecture-projects/services/arch-model-toolbox-contributor.ts` (MODIFY) | add `scenarioPageItems` + contribute a "Scenarios" page |
| `tests/` next to each | headless coverage |

---

## Task 1: Flow collection (pure)

**Files:**
- Create: `src/renderer/src/modules/architecture-projects/services/scenario-flow.ts`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/scenario-flow-collect.test.ts`

**Interfaces:**
- Produces:
  - `interface FlowEntity { id: string; refs(member: string): FlowEntity[] }` (structural; the todl `Entity` satisfies it)
  - `collectScenarioFlow(scenario: FlowEntity): { participants: string[]; edges: Array<[string, string]> }` — participants deduped, first-seen order; edges deduped per `(src,dst)`; a step missing `src` or `dst` is skipped.

- [ ] **Step 1: Write the failing test**

```ts
// tests/scenario-flow-collect.test.ts
import { describe, it, expect } from 'vitest'
import { collectScenarioFlow, type FlowEntity } from '../scenario-flow.js'

// Tiny FlowEntity builder: a map of member -> child entities.
function ent(id: string, rels: Record<string, FlowEntity[]> = {}): FlowEntity {
  return { id, refs: (m) => rels[m] ?? [] }
}
function step(src?: FlowEntity, dst?: FlowEntity): FlowEntity {
  return ent('step', { src: src ? [src] : [], dst: dst ? [dst] : [] })
}

describe('collectScenarioFlow', () => {
  const a = ent('a'), b = ent('b'), c = ent('c'), d = ent('d')

  it('collects the union of step src/dst as participants and deduped edges', () => {
    const seq1 = ent('s1', { steps: [step(a, b), step(b, c)] })
    const seq2 = ent('s2', { steps: [step(a, b), step(b, d)] })   // shares a->b
    const scenario = ent('sc', { sequences: [seq1, seq2] })
    const { participants, edges } = collectScenarioFlow(scenario)
    expect(new Set(participants)).toEqual(new Set(['a', 'b', 'c', 'd']))
    expect(edges).toContainEqual(['a', 'b'])
    expect(edges).toContainEqual(['b', 'c'])
    expect(edges).toContainEqual(['b', 'd'])
    expect(edges.filter(([s, t]) => s === 'a' && t === 'b')).toHaveLength(1)  // deduped
  })

  it('skips a step missing src or dst without throwing', () => {
    const seq = ent('s', { steps: [step(a, undefined), step(undefined, b), step(a, b)] })
    const scenario = ent('sc', { sequences: [seq] })
    const { participants, edges } = collectScenarioFlow(scenario)
    expect(edges).toEqual([['a', 'b']])
    expect(new Set(participants)).toEqual(new Set(['a', 'b']))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/scenario-flow-collect.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `collectScenarioFlow`**

```ts
// scenario-flow.ts  (part 1 of 3 — collection)

// Structural view of a todl Entity: enough to walk a scenario's flow. The real
// Entity (@pragmatic-lab/todl) satisfies this (its refs(member) returns Entity[]).
export interface FlowEntity {
  id: string
  refs(member: string): FlowEntity[]
}

// Walk scenario -> sequences -> steps -> (src,dst); return the participant ids
// (union, first-seen order) and the deduped directed step edges. A step missing
// either endpoint is skipped.
export function collectScenarioFlow(scenario: FlowEntity): { participants: string[]; edges: Array<[string, string]> } {
  const participants: string[] = []
  const seenNode = new Set<string>()
  const edges: Array<[string, string]> = []
  const seenEdge = new Set<string>()
  const note = (id: string): void => { if (!seenNode.has(id)) { seenNode.add(id); participants.push(id) } }

  for (const seq of scenario.refs('sequences')) {
    for (const step of seq.refs('steps')) {
      const src = step.refs('src')[0]
      const dst = step.refs('dst')[0]
      if (src === undefined || dst === undefined) continue
      note(src.id); note(dst.id)
      const key = `${src.id}|${dst.id}`
      if (!seenEdge.has(key)) { seenEdge.add(key); edges.push([src.id, dst.id]) }
    }
  }
  return { participants, edges }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/scenario-flow-collect.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/services/scenario-flow.ts src/renderer/src/modules/architecture-projects/services/tests/scenario-flow-collect.test.ts
git commit -m "feat(scenario-drop): collect scenario participants + step edges (pure)"
```

---

## Task 2: Layered layout + drop plan (pure)

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/scenario-flow.ts`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/scenario-flow-layout.test.ts`

**Interfaces:**
- Consumes: `collectScenarioFlow`, `FlowEntity` (Task 1).
- Produces:
  - `layoutColumns(participants: string[], edges: Array<[string, string]>): Map<string, number>` — column per node = longest path from a source over the acyclic graph (back-edges dropped).
  - `interface DropDims { colDx: number; rowDy: number }`
  - `interface PlannedNode { id: string; left: number; top: number; isNew: boolean }`
  - `planScenarioDrop(scenario: FlowEntity, placed: ReadonlySet<string>, origin: { x: number; y: number }, dims?: DropDims): { nodes: PlannedNode[]; edges: Array<[string, string]> }` — positions computed for ALL participants (grid by column/row); `isNew = !placed.has(id)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/scenario-flow-layout.test.ts
import { describe, it, expect } from 'vitest'
import { layoutColumns, planScenarioDrop, type FlowEntity } from '../scenario-flow.js'

function ent(id: string, rels: Record<string, FlowEntity[]> = {}): FlowEntity {
  return { id, refs: (m) => rels[m] ?? [] }
}
function step(src: FlowEntity, dst: FlowEntity): FlowEntity {
  return ent('step', { src: [src], dst: [dst] })
}

describe('layoutColumns', () => {
  it('assigns longest-path columns for a diamond', () => {
    const col = layoutColumns(['a', 'b', 'c', 'd'], [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']])
    expect(col.get('a')).toBe(0)
    expect(col.get('b')).toBe(1)
    expect(col.get('c')).toBe(1)
    expect(col.get('d')).toBe(2)
  })

  it('breaks cycles so columns stay finite', () => {
    const col = layoutColumns(['a', 'b', 'c'], [['a', 'b'], ['b', 'c'], ['c', 'a']])
    expect(col.get('a')).toBe(0)
    expect(col.get('b')).toBe(1)
    expect(col.get('c')).toBe(2)   // back-edge c->a dropped from layering
  })
})

describe('planScenarioDrop', () => {
  const a = ent('a'), b = ent('b'), c = ent('c')
  const scenario = ent('sc', { sequences: [ent('s', { steps: [step(a, b), step(b, c)] })] })

  it('positions new nodes on the flow grid from the drop origin', () => {
    const plan = planScenarioDrop(scenario, new Set(), { x: 100, y: 50 }, { colDx: 200, rowDy: 120 })
    const byId = new Map(plan.nodes.map((n) => [n.id, n]))
    expect(byId.get('a')).toMatchObject({ left: 100, top: 50, isNew: true })   // col 0, row 0
    expect(byId.get('b')).toMatchObject({ left: 300, isNew: true })            // col 1
    expect(byId.get('c')).toMatchObject({ left: 500, isNew: true })            // col 2
    expect(plan.edges).toEqual([['a', 'b'], ['b', 'c']])
  })

  it('marks already-placed participants as not new', () => {
    const plan = planScenarioDrop(scenario, new Set(['a']), { x: 0, y: 0 })
    expect(plan.nodes.find((n) => n.id === 'a')!.isNew).toBe(false)
    expect(plan.nodes.find((n) => n.id === 'b')!.isNew).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/scenario-flow-layout.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement (append to `scenario-flow.ts`)**

```ts
// scenario-flow.ts  (part 2 of 3 — layout)

const DEFAULT_DIMS: DropDims = { colDx: 200, rowDy: 120 }

export interface DropDims { colDx: number; rowDy: number }
export interface PlannedNode { id: string; left: number; top: number; isNew: boolean }

// Drop the edges that close a cycle (a DFS back-edge), so the layering graph is
// a DAG. Dropped edges are still drawn as connectors — they just don't drive
// columns.
function acyclicEdges(nodes: string[], edges: Array<[string, string]>): Array<[string, string]> {
  const adj = new Map<string, string[]>()
  for (const n of nodes) adj.set(n, [])
  for (const [s, d] of edges) adj.get(s)?.push(d)
  const state = new Map<string, number>()   // 0 unvisited, 1 on-stack, 2 done
  const back = new Set<string>()
  const visit = (u: string): void => {
    state.set(u, 1)
    for (const v of adj.get(u) ?? []) {
      const st = state.get(v) ?? 0
      if (st === 1) back.add(`${u}|${v}`)
      else if (st === 0) visit(v)
    }
    state.set(u, 2)
  }
  for (const n of nodes) if ((state.get(n) ?? 0) === 0) visit(n)
  return edges.filter(([s, d]) => !back.has(`${s}|${d}`))
}

// column(v) = longest path length from any source, over the acyclic graph.
export function layoutColumns(participants: string[], edges: Array<[string, string]>): Map<string, number> {
  const preds = new Map<string, string[]>()
  for (const n of participants) preds.set(n, [])
  for (const [s, d] of acyclicEdges(participants, edges)) preds.get(d)?.push(s)

  const col = new Map<string, number>()
  const compute = (u: string): number => {
    const cached = col.get(u)
    if (cached !== undefined) return cached
    let m = 0
    for (const p of preds.get(u) ?? []) m = Math.max(m, compute(p) + 1)
    col.set(u, m)
    return m
  }
  for (const n of participants) compute(n)
  return col
}

export function planScenarioDrop(
  scenario: FlowEntity,
  placed: ReadonlySet<string>,
  origin: { x: number; y: number },
  dims: DropDims = DEFAULT_DIMS,
): { nodes: PlannedNode[]; edges: Array<[string, string]> } {
  const { participants, edges } = collectScenarioFlow(scenario)
  const col = layoutColumns(participants, edges)
  const rowOf = new Map<string, number>()
  const nextRow = new Map<number, number>()   // column -> next free row
  for (const id of participants) {             // stable first-seen order
    const c = col.get(id) ?? 0
    const r = nextRow.get(c) ?? 0
    rowOf.set(id, r)
    nextRow.set(c, r + 1)
  }
  const nodes: PlannedNode[] = participants.map((id) => ({
    id,
    left: origin.x + (col.get(id) ?? 0) * dims.colDx,
    top: origin.y + (rowOf.get(id) ?? 0) * dims.rowDy,
    isNew: !placed.has(id),
  }))
  return { nodes, edges }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/scenario-flow-layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/services/scenario-flow.ts src/renderer/src/modules/architecture-projects/services/tests/scenario-flow-layout.test.ts
git commit -m "feat(scenario-drop): layered flow layout + drop plan (pure)"
```

---

## Task 3: Scenario drop factory

**Files:**
- Create: `src/renderer/src/modules/architecture-projects/services/arch-scenario-drop-factory.ts`
- Modify: `src/renderer/src/modules/diagram/services/register-arch-toolbox-adapters.ts`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-scenario-drop-factory.test.ts`

**Interfaces:**
- Consumes: `planScenarioDrop` (Task 2), `ArchNodeVM`, `ArchDiagramBindingService`, `DiagramDocument`, `ConnectorEndpoint`.
- Produces:
  - `scenarioIdOf(itemId: string): string | undefined` — strips the `scenario:` prefix.
  - `ArchScenarioDropFactoryKey` + `class ArchScenarioDropFactory implements IToolboxDropFactory`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/arch-scenario-drop-factory.test.ts
import { test, expect, vi } from 'vitest'
import { Point, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { DiagramDocument, ToolboxVisualDescriptor, type ToolboxDropContext } from '@pragmatic-lab/mural/framework'
import { TodlVisualResolverKey } from '../../../diagram/services/todl-visual-resolver.js'
import { ArchToolboxItem } from '../../../diagram/services/arch-toolbox-item.js'
import { ArchDiagramBindingService } from '../arch-diagram-binding-service.js'
import { ArchNodeVM } from '../arch-node-vm.js'
import { ArchScenarioDropFactory, ArchScenarioDropFactoryKey, scenarioIdOf } from '../arch-scenario-drop-factory.js'
import type { FlowEntity } from '../scenario-flow.js'

// Fake entities: a scenario 'sc' with one sequence a->b->c.
function ent(id: string, rels: Record<string, FlowEntity[]> = {}): FlowEntity & { concept: string } {
  return { id, concept: id === 'sc' ? 'scenario' : 'component', refs: (m) => rels[m] ?? [] }
}
function step(s: FlowEntity, d: FlowEntity): FlowEntity { return ent('step', { src: [s as never], dst: [d as never] }) }
const a = ent('a'), b = ent('b'), c = ent('c')
const scenario = ent('sc', { sequences: [ent('s', { steps: [step(a, b), step(b, c)] })] })

function makeContext(doc: DiagramDocument, scenarioId: string): ToolboxDropContext {
  const descriptor = new ToolboxVisualDescriptor(TodlVisualResolverKey, 'scenario')
  const item = new ArchToolboxItem('scenario:' + scenarioId, 'Scn', descriptor, ArchScenarioDropFactoryKey)
  return { Item: item, Descriptor: descriptor, Position: new Point(100, 50), Diagram: undefined as never, Mutator: doc }
}

function stubProvider() {
  const model = { notifyChanged: vi.fn(), entities: () => [scenario], create: vi.fn(), addRef: vi.fn(), save: vi.fn() }
  const bindingSvc = { modelForDocument: () => model }
  const provider = { get: (k: unknown) => (k === ArchDiagramBindingService.Key ? bindingSvc : undefined) } as unknown as IServiceProvider
  return { provider, model }
}

test('scenarioIdOf strips the scenario: prefix', () => {
  expect(scenarioIdOf('scenario:sc')).toBe('sc')
  expect(scenarioIdOf('instance:x')).toBeUndefined()
})

test('dropping a scenario adds a node per participant and a connector per step, no model writes', () => {
  const doc = new DiagramDocument()
  const { provider, model } = stubProvider()
  const factory = new ArchScenarioDropFactory(provider)

  factory.CreateDropped(makeContext(doc, 'sc'))

  const nodes = doc.Nodes.ToArray().filter((n): n is ArchNodeVM => n instanceof ArchNodeVM)
  expect(nodes.map((n) => n.Id).sort()).toEqual(['a', 'b', 'c'])
  expect(doc.Connectors.ToArray().length).toBe(2)   // a->b, b->c
  expect(nodes.find((n) => n.Id === 'a')!.Left).toBe(100)   // origin col 0
  expect(nodes.find((n) => n.Id === 'b')!.Left).toBe(300)   // col 1
  expect(model.notifyChanged).toHaveBeenCalledOnce()
  expect(model.addRef).not.toHaveBeenCalled()
  expect(model.create).not.toHaveBeenCalled()
  expect(model.save).not.toHaveBeenCalled()
})

test('re-uses an already-present node instead of duplicating it', () => {
  const doc = new DiagramDocument()
  const pre = new ArchNodeVM(); pre.Id = 'b'; pre.Left = 999; pre.Top = 999
  doc.AddNode(pre)
  const { provider } = stubProvider()
  new ArchScenarioDropFactory(provider).CreateDropped(makeContext(doc, 'sc'))

  const bNodes = doc.Nodes.ToArray().filter((n): n is ArchNodeVM => n instanceof ArchNodeVM && n.Id === 'b')
  expect(bNodes.length).toBe(1)          // not duplicated
  expect(bNodes[0].Left).toBe(999)       // existing position preserved
  expect(doc.Connectors.ToArray().length).toBe(2)
})
```

> Implementer note: confirm `DiagramDocument` exposes `Connectors` (ToArray) and `AddNode`; the sibling `arch-model-instance-drop-factory.test.ts` uses `doc.Nodes.ToArray()` and `doc.AddNode`. If the connector collection accessor differs, adjust the assertion to the actual API (e.g. count via `doc.Connectors` vs a getter) — the factory still uses `doc.CreateConnector(...)` exactly as `arch-diagram-binding.ts` `projectEdges` does.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-scenario-drop-factory.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the factory**

```ts
// arch-scenario-drop-factory.ts
import { ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { ConnectorEndpoint, DiagramDocument, type IDocument, type IToolboxDropFactory, type ToolboxDropContext } from '@pragmatic-lab/mural/framework'

import { ArchDiagramBindingService } from './arch-diagram-binding-service.js'
import { ArchNodeVM } from './arch-node-vm.js'
import { planScenarioDrop, type FlowEntity } from './scenario-flow.js'

export const ArchScenarioDropFactoryKey = new ServiceKey<IToolboxDropFactory>('ArchScenarioDropFactory')

// Scenario-page items are keyed `scenario:<entityId>`; recover the entity id.
export function scenarioIdOf(itemId: string): string | undefined {
  return itemId.startsWith('scenario:') ? itemId.slice('scenario:'.length) : undefined
}

// Places an EXISTING scenario as a flow: one ArchNodeVM per participating
// entity (reuse-first, no duplicates) and one directional connector per step.
// Pure visualization — no create/addRef/save; the binding's rescan (fired by
// notifyChanged) derives each node's label/icon. Meant for a Scenarios-viewpoint
// diagram, where structural edges are out of scope.
export class ArchScenarioDropFactory implements IToolboxDropFactory {
  public constructor(private readonly provider: IServiceProvider) {}

  public CreateDropped(context: ToolboxDropContext): unknown | null {
    const doc = context.Mutator as unknown as DiagramDocument
    const model = this.provider.get(ArchDiagramBindingService.Key)?.modelForDocument(doc as unknown as IDocument)
    if (model === undefined) return null

    const scenarioId = scenarioIdOf(context.Item.Id)
    if (scenarioId === undefined) return null
    const scenario = model.entities().find((e) => e.id === scenarioId) as unknown as FlowEntity | undefined
    if (scenario === undefined) return null

    // Existing arch nodes on the canvas, by entity id (reuse targets).
    const byId = new Map<string, ArchNodeVM>()
    for (const n of doc.Nodes.ToArray())
      if (n instanceof ArchNodeVM && typeof n.Id === 'string') byId.set(n.Id, n)

    const plan = planScenarioDrop(scenario, new Set(byId.keys()), { x: context.Position.X, y: context.Position.Y })

    for (const nd of plan.nodes) {
      if (!nd.isNew) continue
      const vm = new ArchNodeVM()
      vm.Id = nd.id
      vm.Left = nd.left
      vm.Top = nd.top
      context.Mutator.AddNode(vm)
      byId.set(nd.id, vm)
    }
    for (const [s, d] of plan.edges) {
      const sv = byId.get(s)
      const dv = byId.get(d)
      if (sv !== undefined && dv !== undefined)
        doc.CreateConnector(new ConnectorEndpoint({ Node: sv }), new ConnectorEndpoint({ Node: dv }))
    }
    model.notifyChanged()   // rescan binds labels/icons; step connectors are left as-is
    return null
  }
}
```

- [ ] **Step 4: Register the factory**

In `register-arch-toolbox-adapters.ts`, add the import and registration next to `ArchModelInstanceDropFactory`:

```ts
import { ArchScenarioDropFactory, ArchScenarioDropFactoryKey } from '../../architecture-projects/services/arch-scenario-drop-factory.js'
```
```ts
    if (!services.has(ArchScenarioDropFactoryKey))
    {
        services.registerInstance(ArchScenarioDropFactoryKey, new ArchScenarioDropFactory(services))
    }
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-scenario-drop-factory.test.ts`
Expected: PASS. Then typecheck: `npm run typecheck:web`.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/services/arch-scenario-drop-factory.ts src/renderer/src/modules/architecture-projects/services/tests/arch-scenario-drop-factory.test.ts src/renderer/src/modules/diagram/services/register-arch-toolbox-adapters.ts
git commit -m "feat(scenario-drop): scenario drop factory (nodes + step connectors, viz-only)"
```

---

## Task 4: Scenarios toolbox page

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-model-toolbox-contributor.ts`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/scenario-page-items.test.ts`

**Interfaces:**
- Consumes: `ArchScenarioDropFactoryKey` (Task 3), `ArchModel`, `iconEntityKey`, `ArchToolboxItem`.
- Produces:
  - `scenarioPageItems(model: ArchModel, scope: ReadonlySet<string>): ArchToolboxItem[]` — one draggable `scenario:<id>` item per in-scope `scenario` entity.
  - The contributor also ensures/populates a `SCENARIO_PAGE_ID = 'arch:scenarios'` page (removed when empty / non-arch doc).

- [ ] **Step 1: Write the failing test**

```ts
// tests/scenario-page-items.test.ts
import { test, expect } from 'vitest'
import { scenarioPageItems } from '../arch-model-toolbox-contributor.js'
import { ArchScenarioDropFactoryKey } from '../arch-scenario-drop-factory.js'
import { architectureModelFromSources } from './helpers/arch-model-fixture.js'  // see note

// Build a tiny arch model with a scenario framed by the Scenarios viewpoint.
// Reuse whatever fixture helper the sibling arch-model tests already use to
// construct an ArchModel from .todl sources; if none is shared, inline the
// ModelDraft.fromSources setup from architecture-model-service.test.ts.
test('lists one scenario: item per in-scope scenario entity', () => {
  const model = architectureModelFromSources(/* sources with a `scenario sc1 {}` */)
  const scope = new Set(model.viewpoints().map((v) => v.id))
  const items = scenarioPageItems(model, scope)
  expect(items.length).toBeGreaterThan(0)
  expect(items.every((i) => i.Id.startsWith('scenario:'))).toBe(true)
  expect(items.every((i) => i.DropFactoryKey === ArchScenarioDropFactoryKey)).toBe(true)  // adjust accessor to ArchToolboxItem's actual field
})

test('excludes scenarios not framed by the diagram scope', () => {
  const model = architectureModelFromSources(/* same */)
  const empty = new Set<string>()   // no viewpoints in scope
  expect(scenarioPageItems(model, empty)).toEqual([])
})
```

> Implementer note: mirror the exact ArchModel construction used in `architecture-model-service.test.ts` / `arch-model-toolbox-contributor.test.ts` (they build a model from `.todl` sources). Read that test first and reuse its setup rather than inventing one. `ArchToolboxItem`'s drop-factory-key accessor: check `arch-toolbox-item.ts` for the field name the 4th constructor arg is stored under, and assert against that (the sibling `modelPageItems` test shows the pattern). Use a source with `scenario sc1 { }` conforming to a `Scenarios` viewpoint, plus the tech-architecture meta-model base — or the smallest hand-written meta-model that declares a `scenario` concept framed by a viewpoint.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/scenario-page-items.test.ts`
Expected: FAIL (`scenarioPageItems` missing).

- [ ] **Step 3: Implement**

Add to `arch-model-toolbox-contributor.ts` (imports + function + wire into `refresh`):

```ts
import { ArchScenarioDropFactoryKey } from './arch-scenario-drop-factory.js'
```
```ts
const SCENARIO_PAGE_ID = 'arch:scenarios'
const SCENARIO_CONCEPT = 'scenario'

// The toolbox items for a diagram's "Scenarios" page: one per in-scope scenario
// entity. Each drops through the scenario factory (`scenario:<id>`), which
// materializes the whole flow.
export function scenarioPageItems(model: ArchModel, scope: ReadonlySet<string>): ArchToolboxItem[] {
  const repo = model.repository()
  const inScope = (concept: string): boolean => repo.viewpointsFraming(concept).some((v) => scope.has(v))
  const items: ArchToolboxItem[] = []
  for (const e of model.entities()) {
    if (e.concept !== SCENARIO_CONCEPT || !inScope(e.concept)) continue
    const key = iconEntityKey(repo, e) ?? e.concept
    const descriptor = new ToolboxVisualDescriptor(TodlVisualResolverKey, key)
    items.push(new ArchToolboxItem('scenario:' + e.id, entityLabel(e), descriptor, ArchScenarioDropFactoryKey))
  }
  return items
}
```

In `refresh()`, after populating the Model page, ensure/populate or remove the Scenarios page:

```ts
    const scenarioItems = scenarioPageItems(model, scope)
    if (scenarioItems.length > 0) {
      const spage = repo.EnsurePage(SCENARIO_PAGE_ID, 'Scenarios')
      spage.Items.Clear()
      for (const item of scenarioItems) spage.Items.Add(item)
    } else {
      repo.RemovePage(SCENARIO_PAGE_ID)
    }
```

And in `removePage()`, also remove the scenarios page:

```ts
  private removePage(): void {
    this.repository()?.RemovePage(PAGE_ID)
    this.repository()?.RemovePage(SCENARIO_PAGE_ID)
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/scenario-page-items.test.ts`
Expected: PASS. Then `npm run typecheck:web` and the whole arch-services suite: `npx vitest run src/renderer/src/modules/architecture-projects/`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/services/arch-model-toolbox-contributor.ts src/renderer/src/modules/architecture-projects/services/tests/scenario-page-items.test.ts
git commit -m "feat(scenario-drop): Scenarios toolbox page listing draggable scenarios"
```

---

## Task 5: Manual smoke (human)

- [ ] Rebuild/run Plexus (`npm run dev`). Open the test_arch project, open a **Scenarios-viewpoint** diagram (e.g. `diagram-3`). Confirm:
  1. A "Scenarios" section appears in the toolbox listing the project's scenarios.
  2. Dragging a scenario onto the canvas creates a node per participating component/actor/block, laid out left-to-right, with a directional connector per step.
  3. Dropping a scenario whose participants are already on the canvas reuses those nodes (no duplicates) and still draws the step connectors.
  4. No `.todl` edits result (the model is unchanged; only the `.diagram` gains nodes/connectors).
  5. Structural (non-step) edges do not clutter the Scenarios view.

---

## Self-Review

**Spec coverage:** toolbox Scenarios section (T4), scenario drop factory (T3), participant collection (T1), layered flow layout (T2), step connectors (T3), reuse-first (T2 `isNew` + T3), viz-only/no-model-writes (T3 asserts), Scenarios-viewpoint scoping (T4 inScope). Covered.

**Placeholder scan:** the two fixture-dependent spots in T4's test are explicitly delegated to the sibling test's existing ArchModel setup with an implementer note, not left vague; all production code is complete.

**Type consistency:** `FlowEntity` shape identical across T1/T2/T3. `planScenarioDrop`/`collectScenarioFlow`/`layoutColumns`/`PlannedNode`/`DropDims` names consistent T2↔T3. `ArchScenarioDropFactoryKey`/`scenarioIdOf` consistent T3↔T4. `scenario:` prefix consistent T3↔T4. Meta-model member names (`sequences`/`steps`/`src`/`dst`) match the spec and T1.

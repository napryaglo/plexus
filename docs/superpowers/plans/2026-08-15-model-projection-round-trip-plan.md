# Model Projection Round-Trip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an architecture `.diagram` a curated two-way projection of the project's TODL model — existing entities place as nodes, relationships render as connectors, and canvas gestures (place / connect / delete) write back to the `.todl`.

**Architecture:** Extend the existing per-diagram `ArchDiagramBinding` (attached by `ArchDiagramBindingService`) into a two-way projector; add one active-diagram-reactive toolbox contributor and a place-existing drop factory. Node membership + positions persist in the `.diagram` scene (nodes carry `Id = entityId`); connectors **derive** from the model on every `rescan()` — arch diagrams are connector-authoritative (the only connectors between two bound arch nodes are projected ones). The generic mural `DiagramDocument`/`Diagram` are untouched except one additive event-arg field (SP4).

**Tech Stack:** TypeScript, `@pragmatic-tech-ai/mural` (framework/runtime), `@pragmatic-tech-ai/todl` (`Entity.refs`, `repo.effectiveSchema`), Vitest (jsdom).

Design doc: [2026-08-15-model-projection-round-trip-design.md](../specs/2026-08-15-model-projection-round-trip-design.md).

## Global Constraints

- **Every test file lives in a `tests/` subfolder** next to the code it exercises (e.g. `services/tests/arch-diagram-binding.test.ts`). Run: `npx vitest run` (jsdom). Typecheck: `npm run typecheck`. Compile markup: `npm run compile:mu`.
- **Enums, not string-literal unions** for any fixed set of named values (e.g. `ConnectorActionKind` if one is introduced) — never `type X = 'a'|'b'`.
- The generic `DiagramDocument`/`Diagram` stay generic; arch behavior attaches externally (via `ArchDiagramBindingService` lifecycle + `doc.ActiveView`).
- Any mural change is published **only** to the local Verdaccio (`localhost:4873`); never commit `.npmrc`/secrets. Commit/push only when the user asks.
- Connectors are derived, never authored as diagram data — no arch connector persistence.

## Key existing APIs (verified)

- `ArchModel`: `entities(): Entity[]`, `repository(): Repository`, `viewpoints()`, `addRef(from, member, to)`, `remove(id)`, `save()`, `onChanged(cb)`, `notifyChanged()`.
- `Entity`: `field(name)`, **`refs(member): Entity[]`**; `repo.effectiveSchema(concept).relationships → {name, targets}[]`; `repo.viewpointsFraming(concept): string[]`.
- `ArchDiagramBinding`: has `doc: DiagramDocument`, `model: ArchModel`, `bound: Map<string, Figure|ArchNodeVM>`, `scopeSet(): Set<string>`, `rescan()` (private).
- `DiagramDocument`: `Nodes`, `Connectors` (observable), `AddNode(vm)`, `DeleteNodes(ns)`, `CreateConnector(sourceVM, targetVM): Connector`, `DeleteConnectors(cs)`, `ActiveView: Diagram|undefined` (DP `ActiveViewKey`).
- `Connector`: `Source`/`Target` (the node VMs).
- `Diagram` (view) events: `AddConnectorCreatedListener(l)` (args `{Source, Target}`), `AddDeleteRequestedListener(l)` (args `{Items, Connectors}`), + `Remove*`. Wired by mural `attachStandardDiagramMutations` (`onDelete` → `mutator.DeleteNodes`; `onConnectorCreated` → `mutator.CreateConnector`).
- `ArchNodeVM` (extends `SideConnectableNodeVM`): `Id`, `Label`, `Descriptor`, `EntityId` getter (= `Id`).
- `ArchToolboxItem(itemId, label, ToolboxVisualDescriptor, factoryKey)`; drop context (`ToolboxDropContext`) carries `Item`, `Descriptor`, `Position`, `Diagram`, `Mutator`.
- `ToolboxRepository`: `EnsurePage(id, label): ToolboxPage`, `RemovePage(id)`, `Pages`, `ItemById(id)`.
- `DropCandidateChooserService.Show(candidates, onPick)` — candidates read only `.label`, `onPick(candidate)`.
- View-access pattern: watch `doc.AddPropertyChangedListener(DiagramDocument.ActiveViewKey, cb)`; on change attach/detach view listeners (see `auto-open-inspector-behavior.ts`).

---

## Task 1 (SP1): Edge projection — connector-authoritative rescan

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-diagram-binding.ts`
- Create: `src/renderer/src/modules/architecture-projects/services/edge-projection.ts` (pure helper)
- Test: `src/renderer/src/modules/architecture-projects/services/tests/edge-projection.test.ts`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-diagram-binding-edges.test.ts`

**Interfaces:**
- Produces: `edgeKey(from: string, member: string, to: string): string`; `desiredEdges(repo, entitiesById, scope): Set<string>` returning `edgeKey` strings for every in-scope relationship between two placed entities. `ArchDiagramBinding` gains `private readonly boundEdges = new Map<string, Connector>()`.
- Consumes: `Entity.refs`, `repo.effectiveSchema(concept).relationships`, `repo.viewpointsFraming`.

- [ ] **Step 1: Write the failing test for `desiredEdges` / `edgeKey` (pure).**

```ts
// edge-projection.test.ts
import { describe, it, expect } from 'vitest'
import { edgeKey, desiredEdges } from '../edge-projection.js'

// Minimal fakes matching the read surface desiredEdges uses.
function repoWith(rels: Record<string, string[]>, framing: Record<string, string[]>) {
    return {
        effectiveSchema: (c: string) => ({ relationships: (rels[c] ?? []).map((name) => ({ name, targets: [] as string[] })) }),
        viewpointsFraming: (c: string) => framing[c] ?? [],
    } as unknown as import('@pragmatic-tech-ai/todl').Repository
}
function entity(id: string, concept: string, refs: Record<string, string[]>) {
    return { id, concept, refs: (m: string) => (refs[m] ?? []).map((tid) => byId.get(tid)) } as unknown as import('@pragmatic-tech-ai/todl').Entity
}
const byId = new Map<string, import('@pragmatic-tech-ai/todl').Entity>()

describe('edge projection', () => {
    it('edgeKey is stable and unique per (from, member, to)', () => {
        expect(edgeKey('a', 'uses', 'b')).toBe('a|uses|b')
        expect(edgeKey('a', 'uses', 'b')).not.toBe(edgeKey('a', 'calls', 'b'))
    })

    it('emits one edge per in-scope relationship between two placed entities', () => {
        byId.clear()
        const b = entity('b', 'Service', {}); byId.set('b', b)
        const a = entity('a', 'Component', { uses: ['b'] }); byId.set('a', a)
        const repo = repoWith({ Component: ['uses'] }, { Service: ['V'], Component: ['V'] })
        const placed = new Map([['a', a], ['b', b]])
        const scope = new Set(['V'])
        expect([...desiredEdges(repo, placed, scope)]).toEqual(['a|uses|b'])
    })

    it('omits edges to unplaced or out-of-scope targets', () => {
        byId.clear()
        const b = entity('b', 'Service', {}); byId.set('b', b)
        const a = entity('a', 'Component', { uses: ['b'] }); byId.set('a', a)
        const repo = repoWith({ Component: ['uses'] }, { Service: ['OTHER'], Component: ['V'] })
        expect([...desiredEdges(repo, new Map([['a', a], ['b', b]]), new Set(['V']))]).toEqual([]) // b out of scope
        expect([...desiredEdges(repo, new Map([['a', a]]), new Set(['V']))]).toEqual([])            // b unplaced
    })
})
```

- [ ] **Step 2: Run it — expect FAIL** (`edge-projection.js` missing). `npx vitest run edge-projection`

- [ ] **Step 3: Implement `edge-projection.ts`.**

```ts
import type { Entity, Repository } from '@pragmatic-tech-ai/todl'

export function edgeKey(from: string, member: string, to: string): string {
    return `${from}|${member}|${to}`
}

// The set of desired projected edges: for each placed entity, each relationship
// member's targets that are ALSO placed and whose concept is framed by the scope.
export function desiredEdges(
    repo: Repository,
    placed: ReadonlyMap<string, Entity>,
    scope: ReadonlySet<string>,
): Set<string> {
    const out = new Set<string>()
    const inScope = (concept: string): boolean => repo.viewpointsFraming(concept).some((v) => scope.has(v))
    for (const [fromId, e] of placed) {
        for (const rel of repo.effectiveSchema(e.concept).relationships) {
            for (const target of e.refs(rel.name)) {
                if (!placed.has(target.id)) continue
                if (!inScope(target.concept)) continue
                out.add(edgeKey(fromId, rel.name, target.id))
            }
        }
    }
    return out
}
```

- [ ] **Step 4: Run — expect PASS.** `npx vitest run edge-projection`

- [ ] **Step 5: Write the failing binding test** (`arch-diagram-binding-edges.test.ts`) — a fake `DiagramDocument` with `Nodes`/`Connectors` collections + `CreateConnector`/`DeleteConnectors`, a fake `ArchModel` returning two related placed entities, assert that after `attach()` exactly one connector exists between the two nodes labeled by the member, and that a user-added raw connector between two bound nodes is reconciled away on the next `rescan` (via `notifyChanged`). Use the same fake shapes the existing `arch-diagram-binding` tests use (mirror `tests/arch-diagram-binding.test.ts` fixtures).

- [ ] **Step 6: Run — expect FAIL.**

- [ ] **Step 7: Extend `ArchDiagramBinding.rescan()` with the edge pass.** After the existing node-bind loop and node-removal loop, add:

```ts
// Edge projection: desired = model relationships between two bound nodes (in scope).
const placedEntities = new Map<string, Entity>()
for (const id of this.bound.keys()) {
    const e = byId.get(id)
    if (e !== undefined) placedEntities.set(id, e)
}
const desired = desiredEdges(this.model.repository(), placedEntities, this.scopeSet())

// Add missing projected connectors.
for (const key of desired) {
    if (this.boundEdges.has(key)) continue
    const [fromId, , toId] = key.split('|')
    const src = this.bound.get(fromId); const tgt = this.bound.get(toId)
    if (src === undefined || tgt === undefined) continue
    const c = this.doc.CreateConnector(src, tgt)
    this.boundEdges.set(key, c)
}
// Remove projected connectors no longer desired.
for (const [key, c] of [...this.boundEdges]) {
    if (!desired.has(key)) { this.doc.DeleteConnectors([c]); this.boundEdges.delete(key) }
}
// Connector-authoritative: drop any connector between two bound arch nodes that is
// NOT one of ours (a raw user-drawn connector — SP3 turns these into model refs).
const ours = new Set(this.boundEdges.values())
const boundNodes = new Set(this.bound.values())
for (const c of this.doc.Connectors.ToArray()) {
    if (ours.has(c)) continue
    if (boundNodes.has(c.Source) && boundNodes.has(c.Target)) this.doc.DeleteConnectors([c])
}
```

Add imports (`desiredEdges` from `./edge-projection.js`, `Connector` type, `Entity` type) and the `boundEdges` field. `byId` is the existing entity map built at the top of `rescan`.

- [ ] **Step 8: Run the binding tests + full suite — expect PASS.** `npx vitest run arch-diagram-binding` then `npx vitest run`. Typecheck.

- [ ] **Step 9: Commit.** `feat(arch-diagram): project model relationships as connectors (SP1)`

---

## Task 2 (SP2): Place-existing drop factory

**Files:**
- Create: `src/renderer/src/modules/architecture-projects/services/arch-model-instance-drop-factory.ts`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-model-instance-drop-factory.test.ts`

**Interfaces:**
- Produces: `ArchModelInstanceDropFactoryKey: ServiceKey<IToolboxDropFactory>`; item-id scheme `instance:<entityId>` (the entity id is recovered from `context.Item`).
- Consumes: `ArchDiagramBindingService.modelForDocument`, the binding's placed set, `ArchNodeVM`, `context.Mutator.AddNode`.

- [ ] **Step 1: Write the failing test.** Construct the factory with a stub provider whose `ArchDiagramBindingService` returns a model + a placed-set probe; a `ToolboxDropContext` with `Item` id `instance:svc1`, `Position {X:10,Y:20}`, and a `Mutator` recording `AddNode`. Assert: (a) drops an `ArchNodeVM` with `Id==='svc1'`, `Left===10`, `Top===20`; (b) calls `model.notifyChanged()`; (c) does **not** call `create`/`addRef`/`save`; (d) a second drop of `svc1` when it is already placed is a no-op (returns null, no second `AddNode`).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement the factory.**

```ts
import { ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { type IDocument, type IToolboxDropFactory, type ToolboxDropContext } from '@pragmatic-tech-ai/mural/framework'
import { ArchDiagramBindingService } from './arch-diagram-binding-service.js'
import { ArchNodeVM } from './arch-node-vm.js'

export const ArchModelInstanceDropFactoryKey = new ServiceKey<IToolboxDropFactory>('ArchModelInstanceDropFactory')

// Item id -> entity id. Model-page items are keyed `instance:<entityId>`.
export function entityIdOf(itemId: string): string | undefined {
    return itemId.startsWith('instance:') ? itemId.slice('instance:'.length) : undefined
}

// Places an EXISTING model entity as a node (no create/addRef/save — placement is
// diagram-only). Dedup: a no-op when the entity is already on this diagram.
export class ArchModelInstanceDropFactory implements IToolboxDropFactory {
    public constructor(private readonly provider: IServiceProvider) {}

    public CreateDropped(context: ToolboxDropContext): unknown | null {
        const doc = context.Mutator as unknown as IDocument
        const bindingSvc = this.provider.get(ArchDiagramBindingService.Key)
        const model = bindingSvc?.modelForDocument(doc)
        if (model === undefined) return null
        const entityId = entityIdOf(String((context.Item as { Id?: unknown })?.Id ?? ''))
        if (entityId === undefined) return null
        if (bindingSvc?.isPlaced(doc, entityId) === true) return null   // dedup

        const vm = new ArchNodeVM()
        vm.Id = entityId
        vm.Left = context.Position.X
        vm.Top = context.Position.Y
        context.Mutator.AddNode(vm)
        model.notifyChanged()   // rescan binds label/icon + projects edges (Task 1)
        return vm
    }
}
```

- [ ] **Step 4: Add `isPlaced` to `ArchDiagramBindingService`** (and a `placedIds(doc)` accessor the contributor reuses in Task 3): expose the binding's `bound` keys.

```ts
// arch-diagram-binding-service.ts
public isPlaced(doc: IDocument, entityId: string): boolean {
    return this.bindings.get(doc)?.isPlaced(entityId) ?? false
}
public placedIds(doc: IDocument): ReadonlySet<string> {
    return this.bindings.get(doc)?.placedIds() ?? new Set<string>()
}
```

Add to `ArchDiagramBinding`: `public isPlaced(id: string): boolean { return this.bound.has(id) }` and `public placedIds(): ReadonlySet<string> { return new Set(this.bound.keys()) }`.

- [ ] **Step 5: Run the factory test + full suite — expect PASS.** Typecheck.

- [ ] **Step 6: Commit.** `feat(arch-diagram): place-existing drop factory (SP2)`

---

## Task 3 (SP2): "Model: &lt;name&gt;" dynamic ToolboxPage contributor

**Files:**
- Create: `src/renderer/src/modules/architecture-projects/services/arch-model-toolbox-contributor.ts`
- Modify: `src/renderer/src/app.mu` (`.services:` — register the contributor) and `src/renderer/src/main.js` (eager-resolve it, like the binding service)
- Modify: register `ArchModelInstanceDropFactoryKey` in the arch adapters (`register-arch-toolbox-adapters.ts`) so the drop router resolves it.
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-model-toolbox-contributor.test.ts`

**Interfaces:**
- Produces: page id `'arch:model'`; items `ArchToolboxItem('instance:'+e.id, label, ToolboxVisualDescriptor(TodlVisualResolverKey, iconEntityKey(repo, e) ?? e.concept), ArchModelInstanceDropFactoryKey)`.
- Consumes: `ContentHostService`/`DocumentsContentHostService` (active/selected doc), `ArchDiagramBindingService` (`modelForDocument`, `scopeForDocument`, `placedIds`), `ToolboxRepository`.

- [ ] **Step 1: Write the failing test** for the pure item-builder first — factor page population into a pure function `modelPageItems(model, scope, placed): ArchToolboxItem[]` that returns items for in-scope entities minus `placed`. Assert: in-scope + unplaced entity → item with id `instance:<id>`; placed entity → excluded; out-of-scope entity → excluded. (Test the pure builder; the reactive wiring is smoke-covered live.)

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `modelPageItems` + the contributor service.** The contributor:
  - Resolves the active document from `ContentHostService` (the `DocumentsContentHostService`); watch its active/selected-document change signal.
  - On change / on `model.onChanged` / on scope change / on `doc.Nodes` change: if the active doc is an attached arch diagram, `repo = model.repository()`, `scope = scopeForDocument(doc)`, `placed = placedIds(doc)`, then `page = repo.EnsurePage('arch:model', 'Model: ' + model.namespace)`, clear `page.Items`, add `modelPageItems(model, scope, placed)`. Else `repo.RemovePage('arch:model')`.
  - Subscribe/unsubscribe to the current model's `onChanged` as the active doc changes (track the unsubscribe).

```ts
export function modelPageItems(model: ArchModel, scope: ReadonlySet<string>, placed: ReadonlySet<string>): ArchToolboxItem[] {
    const repo = model.repository()
    const inScope = (concept: string): boolean => repo.viewpointsFraming(concept).some((v) => scope.has(v))
    const items: ArchToolboxItem[] = []
    for (const e of model.entities()) {
        if (placed.has(e.id) || !inScope(e.concept)) continue
        const key = iconEntityKey(repo, e) ?? e.concept
        const descriptor = new ToolboxVisualDescriptor(TodlVisualResolverKey, key)
        items.push(new ArchToolboxItem('instance:' + e.id, displayLabel(e), descriptor, ArchModelInstanceDropFactoryKey))
    }
    return items
}
```

  `displayLabel` mirrors the binding's (`field('label') ?? field('name') ?? id`); export it from a shared spot or duplicate the 2-line helper.

- [ ] **Step 4: Wire registration.** `app.mu` `.services:` add `ArchModelToolboxContributor` + `ArchModelInstanceDropFactory`; `main.js` `app.Services.get(ArchModelToolboxContributor.Key)` (eager, so it observes from boot); ensure `register-arch-toolbox-adapters.ts` registers `ArchModelInstanceDropFactoryKey → new ArchModelInstanceDropFactory(provider)`.

- [ ] **Step 5: Run tests + full suite + `npm run compile:mu` + typecheck — expect PASS.**

- [ ] **Step 6: Commit.** `feat(arch-diagram): dynamic "Model:" toolbox page + place-existing wiring (SP2)`

---

## Task 4 (SP3): `resolveConnectorActions` resolver

**Files:**
- Create: `src/renderer/src/modules/architecture-projects/services/arch-connector-resolver.ts`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-connector-resolver.test.ts`

**Interfaces:**
- Produces: `interface ConnectorAction { member: string; label: string }`; `resolveConnectorActions(repo, sourceConcept, targetConcept, scope): ConnectorAction[]` (0 reject / 1 auto / many chooser). Reuses `acceptSet` from `arch-concept-type.ts` for subtype-aware target matching.

- [ ] **Step 1: Write the failing test.** With a fake repo exposing `effectiveSchema(concept).relationships` (`{name, targets}`), `viewpointsFraming`, and the supertype surface `acceptSet` needs: assert (a) a relationship on `source` whose `targets` include `target`'s concept (or a supertype) and whose owner is in scope → one action; (b) no matching relationship → empty; (c) two matching members → two actions; (d) owner concept out of scope → excluded.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.**

```ts
import type { Repository } from '@pragmatic-tech-ai/todl'
import { acceptSet, conceptTypeOf } from './arch-concept-type.js'

export interface ConnectorAction { member: string; label: string }

// Relationship members on `sourceConcept` whose targets accept `targetConcept`
// (subtype-aware), with the source concept framed by the scope. 0 reject / 1 auto
// / many chooser — mirrors resolveDropActions.
export function resolveConnectorActions(
    repo: Repository,
    sourceConcept: string,
    targetConcept: string,
    scope: ReadonlySet<string>,
): ConnectorAction[] {
    if (!repo.viewpointsFraming(sourceConcept).some((v) => scope.has(v))) return []
    const accept = acceptSet(repo, targetConcept)   // targetConcept ∪ supertypes
    const out: ConnectorAction[] = []
    for (const rel of repo.effectiveSchema(sourceConcept).relationships) {
        if (rel.targets.some((t) => accept.has(t))) {
            out.push({ member: rel.name, label: `${rel.name} → ${targetConcept}` })
        }
    }
    return out
}
```

Confirm `acceptSet(repo, concept)` signature in `arch-concept-type.ts` (it is used as `acceptSet(repo, ct)` in `arch-drop-resolver.ts`); if it takes a concept-type rather than a concept, pass `conceptTypeOf(repo, targetConcept)` accordingly.

- [ ] **Step 4: Run — expect PASS.** Typecheck.

- [ ] **Step 5: Commit.** `feat(arch-diagram): connector relationship resolver (SP3)`

---

## Task 5 (SP3): Connector authoring — intercept user-drawn connectors → addRef

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-diagram-binding.ts` (attach a `ConnectorCreated` listener via `doc.ActiveView`)
- Modify: `src/renderer/src/modules/architecture-projects/services/drop-candidate-chooser-service.ts` (generalize `Show` to any `{ label }` row)
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-connector-authoring.test.ts`

**Interfaces:**
- Consumes: `Diagram.AddConnectorCreatedListener` (args `{Source, Target}`), `resolveConnectorActions`, `ArchModel.addRef/save/notifyChanged`, `DropCandidateChooserService.Show`, the `ActiveView` attach/detach pattern.

- [ ] **Step 1: Generalize the chooser.** Change `Show(candidates: DropAction[], onPick)` to `Show<T extends { label: string }>(candidates: readonly T[], onPick: (a: T) => void)` (body already only reads `.label`). Backward compatible — existing `DropAction` callers keep working. Add/adjust a test asserting a `{label}`-only row set works.

- [ ] **Step 2: Write the failing authoring test.** Drive the binding's connector handler directly (extract it as a method `handleConnectorCreated(source, target)` for testability). With a fake model (two bound entities of concepts A, B) and a repo where A has exactly one member accepting B: assert `handleConnectorCreated(nodeA, nodeB)` calls `model.addRef(aId, member, bId)` + `model.save()` + `notifyChanged()`; with zero candidates it does nothing (and requests a rescan so the raw connector reconciles away — assert `notifyChanged` called); with two candidates it calls `chooser.Show` and, on pick, `addRef`.

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement `handleConnectorCreated` + `ActiveView` wiring in the binding.**

```ts
// in ArchDiagramBinding.attach(): also watch ActiveView to (re)attach the view listener.
private detachView: (() => void) | undefined
private attachView(): void {
    this.detachView?.(); this.detachView = undefined
    const view = this.doc.ActiveView
    if (view === undefined) return
    const l = (args: { Source: unknown; Target: unknown }): void => this.handleConnectorCreated(args.Source, args.Target)
    view.AddConnectorCreatedListener(l)
    this.detachView = () => view.RemoveConnectorCreatedListener(l)
}

public handleConnectorCreated(source: unknown, target: unknown): void {
    const fromId = (source as { Id?: string })?.Id
    const toId = (target as { Id?: string })?.Id
    // Always rescan first: reconciles away the raw connector the standard mutator
    // just created (arch diagrams are connector-authoritative — Task 1).
    this.model.notifyChanged()
    if (fromId === undefined || toId === undefined) return
    if (!this.bound.has(fromId) || !this.bound.has(toId)) return
    const repo = this.model.repository()
    const srcConcept = repo.resolve(fromId)?.concept; const tgtConcept = repo.resolve(toId)?.concept
    if (srcConcept === undefined || tgtConcept === undefined) return
    const actions = resolveConnectorActions(repo, srcConcept, tgtConcept, this.scopeSet())
    if (actions.length === 0) return
    const apply = (a: ConnectorAction): void => { this.model.addRef(fromId, a.member, toId); void this.model.save() }
    if (actions.length === 1) { apply(actions[0]); return }
    this.chooser.Show(actions, apply)
}
```

  - `conceptOf(repo, id)` = `repo.resolve(id)?.concept` (confirm the read; the binding already reads entity concepts via `byId` in `rescan` — reuse that). Inject `DropCandidateChooserService` into the binding (constructor param, provided by `ArchDiagramBindingService.attachDoc`).
  - In `attach()`, call `attachView()` and also register `doc.AddPropertyChangedListener(DiagramDocument.ActiveViewKey, () => this.attachView())`; unregister + `detachView()` in `dispose()`.

- [ ] **Step 5: Thread the chooser into the binding constructor** — update `ArchDiagramBindingService.attachDoc` to pass `this.Provider.getRequired(DropCandidateChooserService.Key)`.

- [ ] **Step 6: Run tests + full suite + typecheck — expect PASS.**

- [ ] **Step 7: Commit.** `feat(arch-diagram): author model relationships by drawing connectors (SP3)`

---

## Task 6 (SP4): Delete = view-only, Shift+Delete = remove entity

**Files:**
- Modify (mural): `Mural/src/framework/diagram/diagram.ts` (include `Shift` in the `DeleteRequested` args) + test; then build + publish to Verdaccio; bump Plexus mural dep.
- Modify (Plexus): `src/renderer/src/modules/architecture-projects/services/arch-diagram-binding.ts` (attach a `DeleteRequested` listener via `ActiveView`; on `Shift` remove entities).
- Test: `Mural/src/framework/diagram/tests/diagram-delete-modifiers.test.ts`; `Plexus/.../tests/arch-delete-routing.test.ts`

**Interfaces:**
- Produces (mural): `DeleteRequested` args gain `Shift: boolean`.
- Consumes (Plexus): `Diagram.AddDeleteRequestedListener` args `{Items, Connectors, Shift}`; `ArchModel.remove/save`.

- [ ] **Step 1 (mural): failing test** — simulate `OnKeyDown` with `Key.Delete` + Shift modifier over a diagram with a selection; assert the fired `DeleteRequested` args carry `Shift: true` (and `false` without the modifier).

- [ ] **Step 2 (mural): run — expect FAIL.**

- [ ] **Step 3 (mural): add `Shift` to the args.** In `diagram.ts` `OnKeyDown`, the delete branch: `this._fireDeleteRequested({ Items: [...this.SelectedItems], Connectors: [...this._selectedConnectors], Shift: hasModifier(args.Modifiers, ModifierKeys.Shift) })`. Update the `DeleteRequestedListener` arg type. The standard-mutations `onDelete` ignores the new field (still view-removes) — verify unchanged.

- [ ] **Step 4 (mural): run — expect PASS.** Run mural suite (`npx tsx --conditions=development --test --test-force-exit "src/**/*.test.ts"`). Build dist (`npm run build`), publish to local Verdaccio, bump `Plexus/package.json` mural dep to the new version, reinstall.

- [ ] **Step 5 (Plexus): failing test** for the arch delete handler — extract `handleDeleteRequested(items, shift)` on the binding. Assert: `shift=false` → no `model.remove` (view-only, the standard mutator handles removal); `shift=true` → `model.remove(entityId)` + `model.save()` for each bound arch node among `items`; non-arch items ignored.

- [ ] **Step 6 (Plexus): run — expect FAIL.**

- [ ] **Step 7 (Plexus): implement.** In `attachView()` also add a `DeleteRequested` listener → `this.handleDeleteRequested(args.Items, args.Shift)`:

```ts
public handleDeleteRequested(items: readonly unknown[], shift: boolean): void {
    if (!shift) return   // plain Delete: standard mutator view-removes; entity stays
    for (const it of items) {
        const id = (it as { Id?: string })?.Id
        if (id !== undefined && this.bound.has(id)) this.model.remove(id)
    }
    void this.model.save()
    // model.remove fires notifyChanged → rescan removes the node + its edges.
}
```

- [ ] **Step 8 (Plexus): run tests + full suite + typecheck — expect PASS.**

- [ ] **Step 9: Commit.** `feat(arch-diagram): Shift+Delete removes the entity from the model (SP4)`

---

## Self-review notes

- **Connector-authoritative reconcile (Task 1) is load-bearing for Task 5**: the raw connector the standard mutator creates on a user draw is removed by the next `rescan`; SP3 calls `notifyChanged()` up front so it never lingers (including while the chooser is open).
- **View access** (Tasks 5, 6) uses `doc.ActiveView` + `ActiveViewKey` property-changed, mirroring `auto-open-inspector-behavior.ts` — attach on mount, detach on unmount/dispose, re-attach on tab switch.
- **No new persistence**: placement (Task 2) and plain delete (Task 6) touch only the scene; `addRef`/`remove` (Tasks 5, 6) call `model.save()`.
- **Cross-repo**: only Task 6 touches mural (one additive arg + publish). Everything else is Plexus-only.
- **Live-GUI smoke** (after headless, all tasks): Model page renders + drag places nodes; related placed nodes show connectors; drawing a connector routes through the chooser and writes a ref; Shift+Delete removes from the model; icons resolve on placed nodes.

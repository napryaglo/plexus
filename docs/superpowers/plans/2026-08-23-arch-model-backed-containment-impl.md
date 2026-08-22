# Arch Model-Backed Containment — Implementation Plan (Plexus half)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On an arch diagram, dragging one arch node into another records the containment as an `in` relationship ref in the `.todl` model, loading reconstructs the nesting from the model, and a generic container tile lets users group arbitrary shapes visually.

**Architecture:** Three repos in a publish cascade. **TODL** gains prelude `container` + `containment` annotations (definitions). **Mural** fires a `NodeReparented` diagram event from `ContainerPlacement.reparent`/`reHome` so a drag-nest is observable, and bumps TODL. **Plexus** consumes both, adds `ArchModel.removeRef`, computes container concepts (containment targets ∪ `@container`) and containment relationships (`@containment` ∪ `in`-named) from the repo, sets `ArchNodeVM.IsContainer` so mural realizes those nodes as `ContentContainerFigure`s, projects `in` refs to visual nesting in `rescan`, and writes a nest/un-nest gesture back to the model via the new reparent event (rejecting nestings the meta-model can't hold). The generic container is a shape-kind toolbox tile whose nesting stays visual-only.

**Tech Stack:** TypeScript. TODL (`@pragmatic-lab/todl`), Mural (`@pragmatic-lab/mural`), Plexus (Electron renderer). Verdaccio (`http://localhost:4873`).

**Spec:** `Plexus/docs/superpowers/specs/2026-08-23-arch-model-backed-containment-design.md`. Prior plan (Mural VM-backed container seam, already merged + published in 0.21.0): `Mural/docs/superpowers/plans/2026-08-23-vm-backed-container-seam.md`.

## Global Constraints

- Publish `@pragmatic-lab/*` ONLY to Verdaccio (`http://localhost:4873`), NEVER public npm, and ONLY at the two explicit gated publish steps (Task A3, Task B3) — each pauses for the user's go-ahead.
- Every test file lives in a `tests/` subfolder next to the code it exercises.
- Real TypeScript enums, never string-literal unions. Cross-class internals: named-interface cast, never bracket access.
- Never mutate the corpus at `C:/Users/Eugene/Projects/plexus_tests`; Plexus e2e runs against a scratch copy via `PLEXUS_TEST_CORPUS`.
- Commit after each task; messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Version bumps: TODL `0.32.1 → 0.33.0` (new prelude annotations); Mural `0.21.0 → 0.21.1` (additive event) — or `0.22.0` if the TODL bump warrants a minor; Plexus depends on both.
- Containment direction: the ref lives on the CONTAINED entity and points at its container (`component --in--> location`). Container concept = containment target OR `@container`-annotated. Containment relationship = `@containment`-annotated OR member kind/name `in` (the default).

---

## Stage A — TODL: prelude `container` + `containment` annotations

Repo: `c:\Users\Eugene\Projects\architecture-agent\TODL` (on `main`; branch first). Version `0.32.1 → 0.33.0`.

### Task A1: Add the two annotations to the prelude

**Files:**
- Modify: `src/stdlib/prelude.todl` (add the annotation declarations)
- Test: `src/stdlib/tests/containment-annotations.test.ts`

**Interfaces:**
- Produces: two prelude annotations resolvable at runtime — `repo.resolve('<concept>@container')` and `repo.resolve('<concept>.<member>@containment')` return an application node when applied. Definition-only here (no fields required).

- [ ] **Step 1: Read `src/stdlib/prelude.todl`** to see the existing annotation block (`annotation icon`, `label`, `toolbox`, `iconSource`, `wiki`) and mirror the declaration style.

- [ ] **Step 2: Write the failing test** — mirror `src/stdlib/tests/mural-resource.test.ts` / `src/tests/prelude-injection.test.ts` (load a tiny model that applies the annotations against the injected prelude, assert they resolve). Concretely:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../../api.js';   // confirm the loader entry the sibling tests use

test('prelude ships container + containment annotations that a meta-model can apply', () => {
    const { model, diagnostics } = load([{ uri: 'todl:test', text: `
namespace mm {
  concept location {}
  concept component { relationship in -> location; }
  annotate location with container;
  annotate component.in with containment;
}` }]);
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0, 'no errors');
    assert.ok(model.resolve('mm.location@container') !== undefined, 'container applied to a concept');
    assert.ok(model.resolve('mm.component.in@containment') !== undefined, 'containment applied to a member');
});
```

(Confirm the exact `load` entry point + the `annotate ... with ...` application syntax against `prelude-injection.test.ts` and the annotation memory — the sibling tests are the source of truth for both.)

- [ ] **Step 3: Run it, verify it fails** — `npx tsx --test src/stdlib/tests/containment-annotations.test.ts` (confirm the repo's test runner/command from `package.json`). Expected: `@container` / `@containment` unknown annotation errors.

- [ ] **Step 4: Add the annotations** to `prelude.todl` inside `namespace todl`, after the existing `annotation wiki { path : string?; }`:

```
    // Container / containment (diagram nesting). `container` marks a concept
    // whose nodes render as a container (a box that holds children). `containment`
    // marks a relationship member whose refs project as visual NESTING instead of
    // a connector (the ref points from the contained entity to its container).
    annotation container { }
    annotation containment { }
```

(If an empty annotation body is a parse error, give each a single optional field — e.g. `annotation container { label : string?; }` — mirroring `annotation toolbox { visible : boolean?; }`. Confirm against the grammar; the test tells you.)

- [ ] **Step 5: Regenerate + run.** `npm run gen:prelude` (regenerates `prelude.generated.ts` from `prelude.todl`), then the test → PASS. Run the full TODL suite (`npm test`) for regressions.

- [ ] **Step 6: Commit** "feat(prelude): container + containment annotations for diagram nesting".

### Task A2: Bump TODL version

- [ ] **Step 1:** `npm version minor --no-git-tag-version` → `0.33.0`.
- [ ] **Step 2:** Commit `package.json` "chore(release): todl 0.33.0 — containment annotations".

### Task A3: **[GATED PUBLISH]** Publish TODL 0.33.0 to Verdaccio

- [ ] **Step 1: STOP — ask the user to confirm the publish.** Only on explicit go-ahead: `npm publish` (runs `prepublishOnly` clean+build). Verify: `curl -s http://localhost:4873/@pragmatic-lab%2ftodl | node -e "…dist-tags"` shows `latest: 0.33.0`.
- [ ] **Step 2: Finish the branch** (superpowers:finishing-a-development-branch — merge locally per the established pattern).

---

## Stage B — Mural: `NodeReparented` event + TODL bump

Repo: `c:\Users\Eugene\Projects\architecture-agent\Mural` (branch first). Version `0.21.0 → 0.21.1`.

### Task B1: Bump TODL dependency

- [ ] **Step 1:** `npm install @pragmatic-lab/todl@^0.33.0`.
- [ ] **Step 2:** `npx tsc --noEmit` — confirm no breakage from the TODL bump.
- [ ] **Step 3:** Commit "chore(deps): bump todl to ^0.33.0".

### Task B2: Fire `NodeReparented` from `ContainerPlacement`

**Files:**
- Modify: `src/framework/diagram/diagram.ts` (event: listener set + Add/Remove + `_fireNodeReparented`)
- Modify: `src/framework/diagram/collaborators/container-placement.ts` (fire it from `reparent` + `reHome`)
- Test: `src/framework/diagram/tests/node-reparented-event.test.ts`

**Interfaces:**
- Produces on `Diagram`: `interface NodeReparentedArgs { readonly Node: Figure; readonly OldParentId: string | undefined; readonly NewParentId: string | undefined; }`; `AddNodeReparentedListener(l)`, `RemoveNodeReparentedListener(l)`, `_fireNodeReparented(args)`. `ContainerPlacement.reparent`/`reHome` fire it after a membership change so a consumer (the Plexus binding) can write back to a model.

- [ ] **Step 1: Write the failing test** — mirror `tests/container-placement.test.ts` mount harness: nest a node via `reparent`, assert a `NodeReparented` fired with the right `Node` + `NewParentId`; un-nest, assert `NewParentId === undefined`.

```ts
// (mount harness mirrors container-placement.test.ts)
test('reparent fires NodeReparented with old/new parent ids', () => {
    // container 'C' + root child; capture events via diagram.AddNodeReparentedListener.
    const events: Array<{ id: string | undefined; oldP: string | undefined; newP: string | undefined }> = [];
    diagram.AddNodeReparentedListener(a => events.push({ id: a.Node.Id, oldP: a.OldParentId, newP: a.NewParentId }));
    diagram.ContainerPlacement.reparent(child, 'C');
    assert.deepEqual(events.at(-1), { id: child.Id, oldP: undefined, newP: 'C' });
    diagram.ContainerPlacement.reparent(child, undefined);
    assert.deepEqual(events.at(-1), { id: child.Id, oldP: 'C', newP: undefined });
});
```

- [ ] **Step 2: Run it, verify it fails** (`AddNodeReparentedListener` not a function).

- [ ] **Step 3: Add the event to `diagram.ts`** — mirror the `WrapRequested` event block added in sub-project 1 (listener `Set`, `Add`/`Remove`, `_fire…` with snapshot-iterate). Define `NodeReparentedArgs` + `NodeReparentedListener` (in a small `commands/container-ops.ts` addition or inline in diagram.ts near the other container event types — match where `WrapRequestedArgs` lives).

- [ ] **Step 4: Fire it from `container-placement.ts`.** In `reparent(node, parentId)`, capture `const old = node.ParentId` at the top; at each successful membership change (root branch after re-attach, and the into-container branch after `AddVisualChild`), call `this._diagram._fireNodeReparented({ Node: node, OldParentId: old, NewParentId: parentId })`. In `reHome`, fire per child as it is reparented (reHome already calls `reparent`, so if you fire inside `reparent` it is covered — verify reHome routes through `reparent` and does NOT need a separate fire; it does route through `reparent` per sub-project 1, so no extra code). Use a named interface for the `_fireNodeReparented` access if `_diagram` is typed as the concrete `Diagram` (it is — `container-placement.ts` imports `Diagram`), so call it directly.

- [ ] **Step 5: Run it, verify it passes; run the container test group** (`container-*.test.ts`) for regressions (reparent is on the hot drag path).

- [ ] **Step 6: Commit** "feat(diagram): NodeReparented event on container membership change".

### Task B3: Bump + **[GATED PUBLISH]** Mural 0.21.1

- [ ] **Step 1:** `npm version patch --no-git-tag-version` → `0.21.1`; commit "chore(release): mural 0.21.1 — NodeReparented event".
- [ ] **Step 2: STOP — ask the user to confirm the publish.** On go-ahead: `npm publish`; verify `latest: 0.21.1` on Verdaccio.
- [ ] **Step 3: Finish the branch** (finishing-a-development-branch — merge locally).

---

## Stage C — Plexus: model-backed containment

Repo: `c:\Users\Eugene\Projects\architecture-agent\Plexus`, branch `feat/arch-model-backed-containment` (already created; mural `^0.21.0` bump already committed). Bump deps first, then the binding work.

### Task C1: Bump deps + `ArchModel.removeRef`

**Files:**
- Modify: `package.json` (todl `^0.33.0`, mural `^0.21.1`)
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-model.ts` (add `removeRef`)
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-model-removeref.test.ts`

**Interfaces:**
- Consumes: TODL `ModelDraft.removeRef(from, member, to): void` (exists).
- Produces: `ArchModel.removeRef(from: string, member: string, to: string): void` — delegates to `draft.removeRef` then `fire()` (mirrors `addRef` at arch-model.ts:78).

- [ ] **Step 1:** `npm install @pragmatic-lab/todl@^0.33.0 @pragmatic-lab/mural@^0.21.1`; `npm run typecheck` — confirm clean against the new upstreams.
- [ ] **Step 2: Write the failing test** — build an `ArchModel` over a draft with an `in` ref (mirror an existing arch-model test's setup), call `removeRef`, assert the ref is gone (`entity.refs('in')` empty) and `onChanged` fired.
- [ ] **Step 3: Run it, verify it fails** (`removeRef` not a function).
- [ ] **Step 4: Implement** in `arch-model.ts`, next to `addRef`:

```ts
public removeRef(from: string, member: string, to: string): void
{
    this.draft.removeRef(from, member, to)
    this.fire()
}
```

- [ ] **Step 5: Run it, verify it passes.**
- [ ] **Step 6: Commit** "feat(arch): ArchModel.removeRef + bump todl/mural".

### Task C2: Containment metadata helper (defaults + annotations)

**Files:**
- Create: `src/renderer/src/modules/architecture-projects/services/containment.ts`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/containment.test.ts`

**Interfaces:**
- Consumes: TODL `Repository` (`resolve('<id>@<ann>')`, `effectiveSchema(concept).relationships` → `{ name, targets }`, some enumeration of concepts — confirm `repo.concepts()`/equivalent).
- Produces:
  - `const CONTAINMENT_MEMBER_DEFAULT = 'in'`
  - `isContainmentRelationship(repo, concept, member): boolean` — annotated `@containment` on `<concept>.<member>` OR `member === 'in'`.
  - `isContainerConcept(repo, concept): boolean` — annotated `@container` OR the concept is a containment target (appears in `rel.targets` of some containment relationship across the repo).
  - `containmentParentOf(repo, entity): Entity | undefined` — the entity's container via its first containment ref (`entity.refs(member)` for a containment member, first placed target).

- [ ] **Step 1: Write the failing test** — build a repo (load a small meta-model + instances via the TODL API, mirroring `edge-projection` tests if any, else `arch-drop-resolver.test.ts`'s `MM` string pattern) with `concept location {}`, `concept component { relationship in -> location; }`, an instance `component c in location l`; assert `isContainmentRelationship(repo,'component','in')===true`, `isContainerConcept(repo,'location')===true`, `isContainerConcept(repo,'component')===false`, `containmentParentOf(repo, c)===l`. Add an `@container`-annotated leaf concept and assert the override makes it a container.

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Implement `containment.ts`.** Use the annotation-resolve pattern from `arch-icon.ts` (`repo.resolve(\`${concept}@container\`)`, `repo.resolve(\`${concept}.${member}@containment\`)`). Compute container concepts by scanning every concept's `effectiveSchema().relationships`, filtering to containment ones, and unioning their `targets` (cache the Set per repo call). Provide the three predicates + `containmentParentOf`. (Confirm the repo API for enumerating concepts; if none, derive the target set lazily from the placed entities' concepts in the binding instead — see Task C4.)

- [ ] **Step 4: Run it, verify it passes.**
- [ ] **Step 5: Commit** "feat(arch): containment metadata helper (defaults + annotations)".

### Task C3: `ArchNodeVM.IsContainer` + set it in rescan

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-node-vm.ts` (add `IsContainer` DP)
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-diagram-binding.ts` (set it in `rescan`)
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-node-vm-iscontainer.test.ts`

**Interfaces:**
- Consumes: `isContainerConcept` (Task C2).
- Produces: `ArchNodeVM.IsContainer: boolean` (DP, default false) — read duck-typed by mural's `GetContainerForItemOverride` (from 0.21.0) to realize the node as a `ContentContainerFigure`. The binding sets it from the concept.

- [ ] **Step 1: Write the failing test** — a `new ArchNodeVM()` defaults `IsContainer===false`; after `IsContainer=true` it reads back true (a plain DP round-trip; the realization is covered by mural's own tests + Plexus e2e).

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Implement** the DP on `ArchNodeVM` (mirror the `Concept` DP shape):

```ts
static readonly IsContainerKey = MuralBase.RegisterProperty<boolean>(ArchNodeVM, 'IsContainer', false, MetaData.None)
get IsContainer(): boolean { return this.get_property_value(ArchNodeVM.IsContainerKey) }
set IsContainer(v: boolean) { this.set_property_value(ArchNodeVM.IsContainerKey, v) }
```

In `arch-diagram-binding.ts` `rescan`, after `node.Concept = entity.concept` (~:150), set `node.IsContainer = isContainerConcept(this.model.repository(), entity.concept)` (import from `containment.ts`).

- [ ] **Step 4: Run it, verify it passes.**
- [ ] **Step 5: Commit** "feat(arch): ArchNodeVM.IsContainer, set from the concept in rescan".

### Task C4: Project `in` refs to visual nesting in `rescan`

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-diagram-binding.ts` (a `projectContainment` pass; skip containment members in `projectEdges`)
- Modify: `src/renderer/src/modules/architecture-projects/services/edge-projection.ts` (exclude containment relationships from `desiredEdges`)
- Test: `src/renderer/src/modules/architecture-projects/services/tests/containment-projection.test.ts`

**Interfaces:**
- Consumes: `isContainmentRelationship`/`containmentParentOf` (C2); the `bound` map (entityId→node); mural `Figure.ParentId` + `diagram.ContainerPlacement.placeAll()` / `reparent`.
- Produces: after `rescan`, a placed entity with an `in` ref to a placed container node is visually nested (its node's `ParentId` = the container node's Id); the same ref does NOT also draw a connector.

- [ ] **Step 1: Write the failing test** — headless: build a doc with two `ArchNodeVM`s (a `location` container + a `component` with an `in` ref to it), run the binding, mount + `placeAll`, assert the component node's `ParentId === location.Id` (nested) and NO connector was projected for the `in` ref. Mirror the binding test harness (construct `ArchDiagramBinding(doc, model)`, `attach()`).

- [ ] **Step 2: Run it, verify it fails** (today the `in` ref projects as a connector, no nesting).

- [ ] **Step 3a: Exclude containment from `desiredEdges`** (`edge-projection.ts`): pass a predicate (or the repo + the `isContainmentRelationship` check) so `for (const rel of …relationships)` skips containment members:

```ts
for (const rel of repo.effectiveSchema(e.concept).relationships) {
    if (isContainmentRelationship(repo, e.concept, rel.name)) continue   // nests, not a connector
    for (const target of e.refs(rel.name)) { /* …unchanged… */ }
}
```

- [ ] **Step 3b: Add `projectContainment(byId)`** to the binding, called from `rescan` after `projectEdges`. For each bound `ArchNodeVM`, compute its containment parent via `containmentParentOf`; if the parent is placed and its node is a container, set `childNode.ParentId = parentNode.Id`; else clear `ParentId` (undefined). Then call `this.doc.ActiveView?.ContainerPlacement.placeAll()` so the visual tree reconciles (placeAll is the RESTORE pass — coords already parent-relative on load; for a freshly-projected nest, use `reparent(childNode, parentId)` to preserve on-screen position — decide per whether the child already has parent-relative coords: on LOAD they do (placeAll), on a model-driven change they may not (reparent). Simplest correct rule: if `childNode.ContainerParent` already equals the target, do nothing; else `reparent`).

- [ ] **Step 4: Run it, verify it passes; run the binding + edge-projection test groups** for regressions (connectors for non-containment refs must still project).

- [ ] **Step 5: Commit** "feat(arch): project containment refs as visual nesting, not connectors".

### Task C5: Write-back — nest/un-nest gesture → model ref (with rejection)

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-diagram-binding.ts` (subscribe to `NodeReparented`; write back)
- Test: `src/renderer/src/modules/architecture-projects/services/tests/containment-writeback.test.ts`

**Interfaces:**
- Consumes: mural `Diagram.AddNodeReparentedListener` (Stage B); `ArchModel.addRef`/`removeRef` (C1); `isContainmentRelationship` + container/concept checks (C2); the `bound` map.
- Produces: a drag-nest of a model-backed child into a model-backed container writes `addRef(childId, 'in', parentId)` + `save()`; an un-nest (or re-home) writes `removeRef(childId, 'in', oldParentId)` + `save()`; an illegal nesting (no permitting `in` relationship, or a non-entity parent) is rejected — the ref is not written and the child is un-nested (`reparent(childNode, undefined)`).

- [ ] **Step 1: Write the failing test** — headless: model-backed location + component (no `in` ref yet); simulate a nest by firing the diagram's `NodeReparented` for the component node with `NewParentId = location.Id`; assert `addRef(component,'in',location)` was applied (`component.refs('in')` includes location) + save called. Then fire with `NewParentId = undefined`; assert `removeRef`. Then an illegal case: fire `NodeReparented` nesting a `location` into a `technology` (no relationship); assert no ref written and the node was un-nested. Mirror the binding harness + a fake/mounted diagram exposing `AddNodeReparentedListener` (mural 0.21.1).

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Implement.** In `attachView()` (where `AddConnectorCreatedListener`/`AddDeleteRequestedListener` are wired), add `view.AddNodeReparentedListener(onReparent)` + teardown. `onReparent(args)`:
  - Resolve `childId = args.Node.Id`; `childEntity = byId(childId)`. If no entity → visual-only (generic container / shape), return.
  - **Un-nest** (`args.NewParentId === undefined`): if `args.OldParentId` named an entity, `this.model.removeRef(childId, membershipMember, args.OldParentId)` + `save()`. (Use the containment member for `childEntity.concept` → the `in` member; `membershipMember(repo, concept)` = the first containment relationship name, default `'in'`.)
  - **Nest** (`args.NewParentId` set): `parentEntity = byId(newParentId)`. If parent is not an entity, or `!isContainerConcept(parent.concept)`, or the meta-model has no containment relationship on `child.concept` targeting `parent.concept` → **reject**: `view.ContainerPlacement.reparent(args.Node, undefined)` and return (no model write). Else `removeRef` the old parent (if any) then `addRef(childId, member, newParentId)` + `save()`.
  - Guard re-entrancy: the `save()`→`onChanged`→`rescan`→`projectContainment` loop may itself call `reparent` and re-fire `NodeReparented`; gate with a `_writingBack` boolean so a projection-driven reparent doesn't recurse into a write-back (mirror mural's `_writingBack` guard pattern from the SelectionGeometryMirror memory).

- [ ] **Step 4: Run it, verify it passes; run the binding test group.**
- [ ] **Step 5: Commit** "feat(arch): write container nest/un-nest gestures back to the model as `in` refs".

### Task C6: Generic container toolbox tile (visual-only)

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-model-toolbox-contributor.ts` (contribute a generic-container shape tile)
- Test: `src/renderer/src/modules/architecture-projects/services/tests/generic-container-tile.test.ts`

**Interfaces:**
- Consumes: mural's `'container'` figure kind (`Figure.fromKind('container')`, registered in 0.21.0) + the shape-drop-factory path; the toolbox contribution shape (`ArchToolboxItem` / a shape-kind item + `ShapeDropFactory`).
- Produces: a static "Container" tile in the arch toolbox that drops a generic `ContainerFigure` (kind `'container'`); its nesting is visual-only — no entity, so the write-back observer (C5) returns early for it and `projectContainment` never touches it.

- [ ] **Step 1: Write the failing test** — assert the toolbox item list from the contributor includes a generic-container tile whose drop kind is `'container'` and whose factory is the shape (non-entity) factory. Mirror `arch-model-toolbox-contributor` tests if present, else assert on `modelPageItems`/a new `staticPageItems` output.

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Implement.** Add a static tile (alongside the entity tiles) — a shape-kind toolbox item for kind `'container'` routed to the shape drop factory (the same path geometric shapes use), NOT the `ArchModelInstanceDropFactoryKey`. Confirm mural exposes a shape drop for `'container'`; if the arch toolbox only wires entity tiles today, add a small static-tiles section. The dropped `ContainerFigure` carries no `Id`, so `rescan`/`projectContainment`/write-back all skip it (they key on `ArchNodeVM`/entity id).

- [ ] **Step 4: Run it, verify it passes.**
- [ ] **Step 5: Commit** "feat(arch): generic container toolbox tile (visual-only grouping)".

### Task C7: Live e2e (corpus copy)

**Files:**
- Create: `Plexus/e2e/arch-containment.spec.ts`

- [ ] **Step 1:** Against a corpus COPY (`PLEXUS_TEST_CORPUS`, never the real corpus), drive Plexus via the established Playwright/Electron harness (see the `project_playwright_electron_debug` pattern): open an arch diagram with a `location` + a `component`, drag the component into the location, assert the `.todl` gains `component … in location` (read the model file / assert via the app), reload, assert the component is nested again. Then drop a generic container + a shape, nest, reload, assert visual-only persistence (no model change).
- [ ] **Step 2: Commit** "test(arch): e2e model-backed + generic containment round-trip".

---

## Self-Review

**Spec coverage:** §1 annotation model + direction → Stage A (prelude defs) + Task C2 (defaults+overrides) + C3/C4/C5 (usage). §2 mural realization seam → already shipped (0.21.0) + Task C3 sets `IsContainer`. §3 write-back + projection + model-backed vs visual-only + rejection → C4 (projection), C5 (write-back + rejection), C6 (generic visual-only). §4 sequencing (mural publish gate) → Stage A/B gated publishes; removeRef → C1; meta-model `in` → assumed in corpus (C7 e2e), annotations shipped in prelude (A1). Error handling (illegal nesting snap-back, delete re-home clears ref) → C5.

**Placeholder scan:** code steps carry real code; "confirm against sibling X" directions point at named in-repo tests/patterns (prelude-injection, arch-icon, container-placement, arch-model-toolbox-contributor), not logic gaps. Two genuinely deferred confirmations flagged inline: the TODL `load`/annotate-application API surface (Task A1) and whether the repo enumerates concepts for the container-target scan (Task C2, with a lazy fallback given). These are API-shape confirmations the executor resolves from the sibling tests, not undefined behavior.

**Type consistency:** `isContainerConcept`/`isContainmentRelationship`/`containmentParentOf` (C2) are consumed with those exact names in C3/C4/C5. `ArchModel.removeRef(from,member,to)` (C1) matches the `addRef` shape used in C5. `NodeReparentedArgs { Node, OldParentId, NewParentId }` (Stage B) is consumed verbatim in C5's `onReparent`. `ArchNodeVM.IsContainer` (C3) is the flag mural's 0.21.0 `GetContainerForItemOverride` reads. Version floors: todl `^0.33.0`, mural `^0.21.1` used consistently in C1.

**Known follow-ups (not blockers):** exact TODL loader/annotate syntax (A1); empty-annotation-body grammar (A1); repo concept-enumeration API (C2); whether the arch toolbox has a static-tiles section or needs one (C6); the `_writingBack` re-entrancy guard's exact placement (C5). Each is flagged at its task with a concrete fallback.

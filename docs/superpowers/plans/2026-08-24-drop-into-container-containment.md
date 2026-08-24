# Drop-into-Container Containment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a container own the nodes placed inside it — via explicit drop/drag-in — so dragging the container carries them, including multi-level model-backed nesting (azure ⊃ m365 ⊃ power_platform).

**Architecture:** One enabling seam in Mural (the drop pipeline carries the container under the drop point on the drop context), consumed by two policies: generic containers adopt freely in Mural's router; arch (model-backed) containers validate in Plexus (meta-model containment + viewpoint) with a modal on reject. Model-backed nesting is projected from the model at any depth; a one-line meta-model change makes `location.parent` a containment relationship so location chains project.

**Tech Stack:** TypeScript. Mural (`@pragmatic-lab/mural`) WPF-style visual tree; Plexus Electron/electron-vite renderer; TODL meta-model (`.todl`). Tests: Mural `tsx --test`, Plexus `vitest` + Playwright (`_electron`).

**Spec:** [docs/superpowers/specs/2026-08-24-drop-into-container-containment-design.md](../specs/2026-08-24-drop-into-container-containment-design.md)

## Progress (2026-08-24)

- **Task 1 (meta-model) — DONE & validated.** `location.parent` → `@containment`
  relationship in the corpus tech-architecture meta-model. Guard tests added to
  `containment.test.ts` (self-referential containment; `containmentMemberFor(location,
  location) = parent`; parent-chain walk). Compiles.
- **Task 2 (nesting probe) — GREEN.** The probe first surfaced a deeper gap than the
  predicted timing cascade: imported **library** location terms (`microsoft_tech.*`)
  are not `ownInstances`, so they never bound → never became containers. Root-caused
  and fixed (see New Task A). The predicted realization-timing cascade is CLEARED —
  a container that is itself a child re-mints + nests correctly at depth (verified 3
  levels model-instance AND 4 levels library-location, both in the real app via
  `e2e/nesting-probe.spec.ts`).
- **New Task A (make library locations bindable) — DONE (per user decision).**
  `arch-diagram-binding.rescan()` now enriches `byId`: a placed node that is not an
  own instance but resolves via `repo.entity(id)` (an imported library term) binds,
  renders, and — for container concepts — nests from the model's `parent`/`in`
  chains. Read-only; write-back still guards library entities. 25 binding/containment
  regression tests pass; `azure ⊃ m365 ⊃ power_platform ⊃ business_agent` nests 4
  deep in the built app.
- **Task 3 (Mural — drop context carries TargetContainer) — DONE.**
  `canvas-drop-behavior` resolves `ContainerPlacement.containerAt(dropPoint)` onto
  `ItemDroppedArgs`; `ToolboxDropContext` gains `TargetContainer?`. Router threads it
  to the factory. Tests in `drop-routing.test.ts`.
- **Task 4 (Mural — generic container adopts) — DONE.** The router reparents a
  dropped `Figure` into a plain `ContainerFigure` (not `ContentContainerFigure`);
  arch VMs (not `Figure`) are left to the host factory. Tests in `drop-routing.test.ts`.
- **Task 5 (Plexus — arch validation + modal + ref) — DONE.**
  `ArchInstanceDropFactory.apply()` validates `containmentMemberFor` against a
  model-backed `TargetContainer`; illegal → shared modal + abort (no entity); legal →
  writes the containment ref, projection nests it. Shared helper `containment-modal.ts`
  (`showContainmentRejected`). Tests in `arch-instance-drop-factory.test.ts`.
- **Task 6 (Plexus — illegal drag-in modal + library-location write-back) — DONE.**
  `handleReparent` shows the same modal on an illegal nest; the PARENT resolves via
  `resolveEntity` (own OR repo/library entity) so dragging a component into a
  library-location container writes `in` — the CHILD stays own-instance-only, never
  mutating library files. `DialogService` threaded through the binding service. Tests
  in `containment-writeback.test.ts`.
- **Verification.** Mural 4593 pass; Plexus 912 pass; typecheck clean both repos;
  e2e `nesting-probe` (4-level library-location nest) + `container-drag-follow`
  (1-level regression) pass against the rebuilt app. Mural dist synced into Plexus
  `node_modules` for local iteration (NOT published).
- **Task 7 (integration — GATED):** version bumps + Verdaccio publish + commit/push
  are pending the user's explicit go-ahead. A dedicated drop-into-container e2e was
  not added — the drop/validation/modal logic is covered by unit tests and the
  projection/render by `nesting-probe`; manual smoke recommended.

## Global Constraints

- Publish `@pragmatic-lab/*` ONLY to Verdaccio `http://localhost:4873`, NEVER public npm, and ONLY when the user explicitly asks.
- Commit/push ONLY when the user explicitly asks.
- NEVER mutate the real corpus `C:/Users/Eugene/Projects/plexus_tests` — clone it (`cloneCorpus`) for any e2e that writes.
- Every test file lives in a `tests/` subfolder next to the source it exercises.
- Real TypeScript `enum`s, never string-literal unions or bare literals at use sites.
- Membership forms ONLY via explicit drop/drag-in for generic/geometric adoption; model-backed containment is projected from the model (not gesture-gated).
- Reject UX is a modal dialog; illegal drag-in shares the same modal.
- Mural→Plexus handoff: Plexus e2e/tests that rely on new Mural API need Mural available to Plexus. Use `npm link` for local iteration, or publish to Verdaccio (only when the user asks) + `npm install`. Do NOT publish silently.

---

### Task 1: Meta-model — `location.parent` becomes a containment relationship

**Files:**
- Modify: `C:/Users/Eugene/Projects/plexus_tests/meta-models/tech-architecture/concepts/location.todl`
- Test: TODL repo — `src/.../tests/containment-location-parent.test.ts` (new; use the nearest existing containment/schema test folder as the pattern)

**Interfaces:**
- Consumes: TODL `Repository` API (`effectiveSchema`, `resolve`, `supertypesOf`), prelude `annotation containment`.
- Produces: a `location.parent` relationship annotated `@containment`, so `containmentParentOf`/`containmentMemberFor` (Plexus) treat location→location as containment.

- [ ] **Step 1: Write the failing test**

Author a minimal TODL source that declares two locations in a parent chain and asserts the schema surfaces `parent` as a containment relationship. Model it on the existing TODL schema/annotation tests (find one that builds a `Repository` from source and inspects `effectiveSchema(concept).relationships`). Assert:
- `effectiveSchema('tech_architecture.location').relationships` contains a member named `parent` whose targets include `location`.
- `resolve('tech_architecture.location.parent@containment')` is defined.

- [ ] **Step 2: Run it to confirm it fails**

Run the single test file (`npx tsx --conditions=development --test <file>` or the TODL runner). Expected: FAIL — `parent` is a field, not a relationship / no `@containment`.

- [ ] **Step 3: Make the change**

In `location.todl`, replace:

```
parent : location?;
```

with:

```
relationship parent -> location? { annotate containment {} }
```

Leave the `parent`-cycle and `parent`-resolution invariants unchanged (relationships still resolve refs).

- [ ] **Step 4: Run the test — expect PASS**

- [ ] **Step 5: Verify no meta-model regressions**

Run the tech-architecture meta-model's own validation/compile (the command the project uses to compile/validate `.todl`; e.g. the TODL CLI compile over `meta-models/tech-architecture`). Expected: compiles clean; `microsoft.todl`'s `parent = azure` authoring still valid.

- [ ] **Step 6: Republish the meta-model to Verdaccio — ONLY if the user has authorized publishing this session**

If not yet authorized, STOP and ask before publishing. Record that Plexus tasks (2, 5, 6) need the republished meta-model installed in the test corpus clone.

- [ ] **Step 7: Commit — only when the user asks** (otherwise leave staged/working)

---

### Task 2: Nesting probe (GO/NO-GO) — 3-level model-backed nesting projects

**Files:**
- Test: `Plexus/e2e/nesting-probe.spec.ts` (new)
- Fixture helper: extend `Plexus/e2e/plexus-app.ts` (or the existing `writeContainmentDemoFixture` sibling) with `writeNestingFixture()` that writes a `.diagram` placing azure, m365, power_platform (all locations from the microsoft library) on one arch diagram in a **cloned** corpus.

**Interfaces:**
- Consumes: Task 1's republished meta-model; existing e2e harness (`launchPlexus`, `cloneCorpus`, `Symbol.for('mural:visual-backref')`, `Generator.ContainerFromItem`).
- Produces: `nesting-probe.spec.ts` — the go/no-go gate. A kept regression test either way.

- [ ] **Step 1: Write the probe test**

Clone the corpus, write a diagram placing the three locations, launch Plexus, open the diagram, then assert via the visual back-ref that the figures nest three deep:
- `containerFor(power_platform).ContainerParent` is the figure for `m365`.
- `containerFor(m365).ContainerParent` is the figure for `azure`.
- `containerFor(azure).ContainerParent` is undefined (root).

Read the visual tree with the `mural:visual-backref` symbol pattern already used in `format-populate.spec.ts` / `container-drag-follow.spec.ts`.

- [ ] **Step 2: Run it**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/Plexus && npx playwright test e2e/nesting-probe.spec.ts`

- [ ] **Step 3: DECISION GATE**

- **PASS** → the deferred-attach cascade already handles depth. Keep the test as a regression. Proceed to Task 3.
- **FAIL** → STOP. Do NOT write a fix here. Return to `superpowers:systematic-debugging` Phase 1 with this reproduction: trace whether the inner container's `ChildHost` is undefined at `projectContainment` time and whether the `ContainerBound → placeAll` flush fires for the re-minted mid-chain container. Root-cause first, then add a minimal fix task (Mural `ContainerPlacement`/`ContainerBound` cascade or Plexus `projectContainment` retry) and re-run this probe green before proceeding.

- [ ] **Step 4: Commit the probe — only when the user asks**

---

### Task 3: Mural — carry the drop-target container on the drop context

**Files:**
- Modify: `Mural/src/framework/diagram/diagram.ts` (the `_fireItemDropped` / `ItemDropped` args), `Mural/src/framework/diagram/behaviors/canvas-drop-behavior.ts` (already computes the drop `Position`), and the `ToolboxDropContext`/`ItemDropped` args type (locate via `grep ToolboxDropContext`).
- Test: `Mural/src/framework/diagram/tests/drop-target-container.test.ts` (new)

**Interfaces:**
- Consumes: `ContainerPlacement.containerAt(point)` (returns innermost `ContainerFigure | undefined`), `Diagram.HostToContent`.
- Produces: `ItemDropped` args + `ToolboxDropContext` gain `TargetContainer?: ContainerFigure`. Additive; existing factories ignoring it are unaffected. Task 4 and Task 5 consume `TargetContainer`.

- [ ] **Step 1: Write the failing test**

Build a `Diagram` with a `ContainerFigure` registered in `ContainerPlacement`. Simulate a drop whose diagram-space point lands inside the container; assert the dispatched `ItemDropped` args carry `TargetContainer === thatContainer`. Simulate a drop over empty canvas; assert `TargetContainer === undefined`. Use the existing container test setup (`tests/container-placement.test.ts`) as the harness pattern.

- [ ] **Step 2: Run — expect FAIL** (`TargetContainer` undefined / not on args)

- [ ] **Step 3: Implement**

In the drop dispatch (where `_fireItemDropped(Data, Position)` is raised), resolve `const target = this.ContainerPlacement.containerAt(Position)` and include it on the args as `TargetContainer`. Thread it through to `ToolboxDropContext` where `CreateDropped` is called (`behaviors/attach-standard-mutations.ts`). Add the optional field to both types.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Typecheck** `cd Mural && npm run typecheck`

- [ ] **Step 6: Commit — only when the user asks**

---

### Task 4: Mural — generic container adopts a dropped node

**Files:**
- Modify: `Mural/src/framework/diagram/behaviors/attach-standard-mutations.ts` (the `ItemDropped` handler, after `factory.CreateDropped` returns the node)
- Test: `Mural/src/framework/diagram/tests/generic-container-adopt-drop.test.ts` (new)

**Interfaces:**
- Consumes: Task 3's `TargetContainer`; `ContainerPlacement.reparent(node, id)`; `ContainerFigure` / `ContentContainerFigure` (to distinguish generic from model-backed).
- Produces: after a drop, a node whose `TargetContainer` is a **plain** `ContainerFigure` (NOT `ContentContainerFigure`) is reparented into it (visual `parentId`, parent-relative coords), persisting through save/load.

- [ ] **Step 1: Write the failing test**

Register a generic `ContainerFigure`; dispatch a drop landing inside it via the standard-mutations path; assert the created node's `ParentId === container.Id` and its coords are parent-relative. Add a second assertion: dispatch a drop over a `ContentContainerFigure` and assert the router does NOT adopt (leaves `ParentId` undefined — host owns it).

- [ ] **Step 2: Run — expect FAIL** (node lands at root)

- [ ] **Step 3: Implement**

After `const node = factory.CreateDropped(ctx)` in the handler:

```ts
const target = ctx.TargetContainer;
if (node !== undefined && target !== undefined
    && !(target instanceof ContentContainerFigure))
    diagram.ContainerPlacement.reparent(node, target.Id);
```

(Guard `node !== undefined` — a rejected host factory returns null.)

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Round-trip guard**

Extend or add a serialization assertion: the adopted node's `parentId` round-trips (Save→Load keeps it nested). Reuse `serialization/tests` patterns / `NodeVisualStore`.

- [ ] **Step 6: Full Mural suite** `cd Mural && npm test`

- [ ] **Step 7: Commit — only when the user asks**

---

### Task 5: Plexus — arch container validates a drop, modal on reject, ref on accept

**Files:**
- Modify: `Plexus/src/renderer/src/modules/architecture-projects/services/arch-instance-drop-factory.ts` (`apply()`)
- Create: `Plexus/src/renderer/src/modules/architecture-projects/services/containment-modal.ts` (shared reject-modal helper) — or the nearest existing dialog service; reuse Plexus's existing modal/dialog infra (the chooser UI uses one — locate and reuse).
- Test: `Plexus/src/renderer/src/modules/architecture-projects/services/tests/arch-drop-into-container.test.ts` (new) + e2e `Plexus/e2e/drop-into-container.spec.ts` (new)

**Interfaces:**
- Consumes: `ctx.TargetContainer` (Task 3), `containmentMemberFor(repo, childConcept, parentConcept)`, `isContainerConcept`, `model.createInViewpoint`/`addRef`/`save`/`notifyChanged`, the entity-by-node-id lookup used by `handleReparent`.
- Produces: on a model-backed `TargetContainer`, legal → entity + containment ref written (nested via existing `projectContainment`); illegal → modal + `null` (no entity). A `showContainmentRejected(childLabel, parentLabel)` helper shared with Task 6.

- [ ] **Step 1: Write the failing unit test**

With a stub/fake repo + model (follow `arch-instance-drop-factory.test.ts` and `containment-writeback.test.ts` fakes): drop a concept legally containable in the target container → assert `addRef(entityId, member, containerEntityId)` called with the member from `containmentMemberFor`, and an entity is created. Drop an illegal concept → assert the reject helper is invoked, `createInViewpoint`/`addRef` are NOT called, and `apply` returns null.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `apply()` branch**

When `ctx.TargetContainer` maps to a model-backed container entity (resolve its entity via node id; skip if generic/absent):

```ts
const parent = this.entityById(ctx.TargetContainer.Id);
if (parent !== undefined) {
    const member = containmentMemberFor(repo, action.concept, parent.concept);
    if (member === undefined) {
        showContainmentRejected(labelOf(action.concept), labelOf(parent.concept));
        return null;                        // no entity created
    }
    // ...create entity as today, then:
    this.model.addRef(entityId, member, parent.id);
}
```

Extract the message + modal into `showContainmentRejected` in the shared helper. Position/viewpoint framing is unchanged (already enforced by `resolveDropActions`).

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: e2e — legal + illegal drop**

`drop-into-container.spec.ts` (cloned corpus): drop a location onto another location container → assert the child entity's containment ref written on disk + nested figure. Drop a concept with no containment relation to the container → assert the modal appears and node count is unchanged. Use the toolbox-drop + `mural:visual-backref` patterns from existing e2e.

- [ ] **Step 6: Commit — only when the user asks**

---

### Task 6: Plexus — illegal drag-in shares the same modal

**Files:**
- Modify: `Plexus/src/renderer/src/modules/architecture-projects/services/arch-diagram-binding.ts` (`handleReparent`, the illegal-nest branch)
- Test: extend `Plexus/.../services/tests/containment-writeback.test.ts` + e2e assertion in `drop-into-container.spec.ts`

**Interfaces:**
- Consumes: `showContainmentRejected` from Task 5.
- Produces: illegal drag-in shows the modal AND retains the snap-back (`reparent(fig, undefined)`); legal path unchanged.

- [ ] **Step 1: Write the failing test**

In `containment-writeback.test.ts`, add: an illegal drag-in (`containmentMemberFor` undefined) invokes `showContainmentRejected` and still snaps back (asserts `reparent(fig, undefined)` called, no `addRef`). Inject/spy the modal helper.

- [ ] **Step 2: Run — expect FAIL** (today it snaps back silently)

- [ ] **Step 3: Implement**

In `handleReparent`'s `member === undefined` branch, call `showContainmentRejected(labelOf(child.concept), labelOf(parent.concept))` before/after the existing `_writingBack`-guarded `reparent(fig, undefined)`. Keep the snap-back.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: e2e** — extend `drop-into-container.spec.ts` (or a sibling) to drag an existing illegal node into an arch container and assert the modal + snap-back.

- [ ] **Step 6: Commit — only when the user asks**

---

### Task 7: Integration — versions, publish (gated), full suites

**Files:**
- Modify: `Mural/package.json` (minor bump), `Plexus/package.json` (`@pragmatic-lab/mural` → new minor)

**Interfaces:**
- Consumes: all prior tasks green.
- Produces: a consistent cross-repo version set; both full suites green against the integrated build.

- [ ] **Step 1: Bump Mural minor** (`0.25.1` → `0.26.0`), update the `NodeVisual`/serialization comments only if the wire form changed (it did not — `parentId` already serialized).

- [ ] **Step 2: Publish Mural to Verdaccio — ONLY if the user authorizes.** If not, STOP and ask. Then bump Plexus's `@pragmatic-lab/mural` dep and `npm install` (or keep `npm link` for local verification).

- [ ] **Step 3: Full Mural suite** `cd Mural && npm test` — expect green.

- [ ] **Step 4: Full Plexus suites** `cd Plexus && npx vitest run` and `npx playwright test` — expect green (including the Task 2 probe, Task 5/6 e2e).

- [ ] **Step 5: Manual smoke (report only):** open `diagram.diagram`; drag `m365` out of and back into `container:1` → it now moves with the container. Confirm azure/m365/power_platform nest on a diagram that places all three.

- [ ] **Step 6: Commit + push — only when the user asks.** Update memory (`project_*` + MEMORY.md) after the user authorizes the push.

---

## Self-Review Notes

- **Spec coverage:** Case 1 (Task 2 probe + regression), Case 2 (Task 5), Case 3 (Task 4), illegal drag-in modal (Task 6), meta-model nesting (Task 1), enabling seam (Task 3), integration (Task 7). All spec sections mapped.
- **Ordering risk:** Tasks 4–6 depend on Task 3's `TargetContainer`. Task 2 depends on Task 1's republished meta-model. Task 2 is a gate — a red probe halts the plan into debugging, not a speculative fix.
- **No placeholders:** the one deliberately-open item is Task 2's failure branch, which is correct per systematic-debugging (do not pre-write a fix for an unreproduced failure).
- **Type consistency:** `TargetContainer?: ContainerFigure` is the single new field name across `ItemDropped` args and `ToolboxDropContext`; `showContainmentRejected(childLabel, parentLabel)` is the single shared helper name across Tasks 5 and 6.

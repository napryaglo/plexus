# P1 — Plexus `ArchNodeVM` (icon + label) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. This plan spans TWO repos: **Mural** (`c:/Users/Eugene/Projects/architecture-agent/Mural`, Task 1) and **Plexus** (`c:/Users/Eugene/Projects/architecture-agent/Plexus`, Tasks 3–8). Task 2 bridges them.

**Goal:** A library term dropped on an architecture diagram renders the term's icon + a real label (not a placeholder rectangle labelled with the entity id).

**Architecture:** `ArchNodeVM extends` mural `NodeViewModel` goes into the diagram's `Nodes`; mural wraps it in a container and resolves a `[DataType=ArchNodeVM]` template that renders `ToolboxVisualPresenter[Context=VisualContext.Figure]` (icon, reusing the toolbox path) + a label. The drop factory builds the VM via a new mural `DiagramMutator.AddNode`; `ArchDiagramBinding.rescan()` derives `Label` + icon `Descriptor` from the `.todl` entity (source of truth); an `arch` serializer registered through mural's per-node registry round-trips id + position (icon/label re-derive on load).

**Tech Stack:** Mural framework (TS, node:test, `.template.mu`); Plexus renderer (TS, its test runner, `.mu` resources).

## Global Constraints

- **Mural M1–M4 + this plan's Task 1 must be available to Plexus** as `@pragmatic-tech-ai/mural` (Task 2 — publish `0.4.0` + bump, or workspace-link). Plexus imports ONLY the published surface (`@pragmatic-tech-ai/mural/{framework,runtime,basic,visual-engine,compiler}`) — no relative `../src` / internals.
- **Real TS enums**, never string-literal unions.
- **Test files** live next to source per each repo's convention (Mural: `tests/` subfolder; Plexus: its established test layout — match neighbouring tests).
- **Render through templates/bindings** — the arch node's visual flows through the `[DataType=ArchNodeVM]` DataTemplate, no hardcoded chrome.
- **Markup-facing types** (`ArchNodeVM`) registered in Plexus's `.mu` compiler symbol registration (as its other diagram types are).
- Commit only per the subagent-driven flow; nothing pushed/published unless the plan's Task 2 chooses publish AND the human authorises it.

---

### Task 1 (MURAL): `DiagramMutator.AddNode` + `DiagramDocument` impl

**Repo:** Mural. **Files:**
- Modify: `src/framework/diagram/behaviors/attach-standard-mutations.ts` (the `DiagramMutator` interface ~line 24-53)
- Modify: `src/framework/diagram/diagram-document.ts` (implement `AddNode`)
- Test: `src/framework/diagram/tests/m-addnode.test.ts`

**Interfaces — Produces:** `DiagramMutator.AddNode(node: NodeViewModel): void` — adds a pre-built node VM to `Nodes` (the diagram wraps it in a container + resolves its `[DataType]` template). Consumers that build their own VM (Plexus `ArchNodeVM`) use this instead of the shape-catalog-gated `CreateNode`.

- [ ] **Step 1: Write the failing test**

```ts
// m-addnode.test.ts — mirror the m2/m3 diagram-document harness (Application + DiagramDocument).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../../runtime/index.js';
import { DiagramDocument } from '../diagram-document.js';
import { ShapeNodeVM } from '../shape-node-vm.js';

describe('DiagramMutator.AddNode', () => {
    test('AddNode places a pre-built VM into Nodes', () => {
        Application.current = null; new Application();
        const doc = new DiagramDocument();
        const vm = ShapeNodeVM.fromKind('rectangle', 40, 60);
        vm.Id = 'x1';
        doc.AddNode(vm);
        assert.equal(doc.Nodes.Count, 1);
        assert.equal(doc.Nodes.Get(0), vm);
    });
});
```

- [ ] **Step 2: Run, verify FAIL** — `AddNode` doesn't exist.
  Run: `npx tsx --conditions=development --test "src/framework/diagram/tests/m-addnode.test.ts"`

- [ ] **Step 3: Implement**
  - In `attach-standard-mutations.ts`, add to `interface DiagramMutator`: `AddNode(node: NodeViewModel): void;` (import the `NodeViewModel` type).
  - In `diagram-document.ts`, implement:
    ```ts
    public AddNode(node: NodeViewModel): void { this.Nodes.Add(node); }
    ```
    (mirror where `CreateNode` lives; `Nodes.Add` triggers the container-wrapping the same way `CreateNode` results do).

- [ ] **Step 4: Run PASS** + `npm run typecheck`. Full suite green (`npm test`).
- [ ] **Step 5: Commit** (`feat(diagram): DiagramMutator.AddNode for pre-built node VMs`).

---

### Task 2 (BRIDGE): make Mural available to Plexus

**Decision made at execution start (human-authorised):**
- **Publish path:** checkpoint Mural M4 + Task 1 to `main` (fast-forward), `npm version minor` → `0.4.0`, `npm publish`, then in Plexus bump `@pragmatic-tech-ai/mural` → `^0.4.0` and install. Durable; matches the established publish→bump pattern.
- **Link path:** `npm run build` in Mural, then point Plexus `node_modules/@pragmatic-tech-ai/mural` at the local build (symlink). Faster; no publish; revert before any Plexus release.

- [ ] **Step 1:** Execute the chosen path so Plexus resolves `NodeViewModel`, the `[DataType]` template resolution, `DiagramMutator.AddNode`, and the node-serializer registry from `@pragmatic-tech-ai/mural`.
- [ ] **Step 2: Verify** in Plexus: `import { NodeViewModel } from '@pragmatic-tech-ai/mural/framework'` resolves and the node-serializer registry export is present. Plexus `typecheck` sees the new surface.

---

### Task 3 (PLEXUS): `ArchNodeVM` class + `.mu` symbol registration

**Repo:** Plexus. **Files:**
- Create: `src/renderer/src/modules/architecture-projects/services/arch-node-vm.ts`
- Modify: Plexus's `.mu` compiler symbol registration (find where diagram markup types are registered — grep `DEFAULT_SYMBOLS` / the symbol list used for `.mu` compilation; register `ArchNodeVM`)
- Test: alongside, per Plexus test layout — `.../services/tests/arch-node-vm.test.ts`

**Interfaces — Consumes:** mural `NodeViewModel`, `ToolboxVisualDescriptor`, `TodlVisualResolverKey` (Plexus). **Produces:** `class ArchNodeVM extends NodeViewModel` with `Label: string`, `Descriptor: ToolboxVisualDescriptor | undefined`; `EntityId` = the base `Id`.

- [ ] **Step 1: Write the failing test** — construct an `ArchNodeVM`, set `Id`/`Label`/`Descriptor`, assert the getters; assert defaults (empty label, sensible default `Width/Height` for an icon+label tile).
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** `ArchNodeVM` mirroring mural's `ShapeNodeVM` DP idiom: register `LabelKey` (string, '') and `DescriptorKey` (`ToolboxVisualDescriptor | undefined`) via `Model.RegisterProperty`; getters/setters; a default `Width/Height` in the ctor suited to an icon + label. `EntityId` getter returns `this.Id`. Register `ArchNodeVM` in the `.mu` symbol list (map the class name to its module path, as mural registers `ShapeNodeVM`).
- [ ] **Step 4: Run PASS** + Plexus `typecheck`.
- [ ] **Step 5: Commit** (`feat(arch): ArchNodeVM view-model`).

---

### Task 4 (PLEXUS): `[DataType=ArchNodeVM]` template

**Files:**
- Modify: `src/renderer/src/modules/diagram/diagram.resources.mu` (add the template near the `[DataType=ToolboxItem]` one that already uses `ToolboxVisualPresenter`)
- Test: a render test in Plexus's diagram/template test area (mirror how Plexus tests `.mu` templates; if none exist headlessly, cover via the Task 5 drop test asserting the materialised visual)

**Interfaces — Consumes:** `ArchNodeVM.Descriptor`, `.Label`; `ToolboxVisualPresenter`, `VisualContext.Figure`.

- [ ] **Step 1:** Add the template:
```
DataTemplate [DataType = ArchNodeVM] {
    // icon (reuses the toolbox path: vector/bitmap/fallback glyph) + label
    <StackPanel-or-Grid> {
        ToolboxVisualPresenter [ Descriptor = $Descriptor, Context = VisualContext.Figure,
                                 Width = <icon>, Height = <icon> ]
        TextBlock [ Text = $Label, HorizontalAlignment = Center, … ]
    }
}
```
Match the exact `ToolboxVisualPresenter` attribute names + `VisualContext` enum member used at `diagram.resources.mu:256-284` / `todl-visual-resolver.ts`.
- [ ] **Step 2:** Build Plexus `.mu` (its pretest/build) so the template compiles; a missing symbol/attr fails the build — fix registration.
- [ ] **Step 3: Commit** (`feat(arch): [DataType=ArchNodeVM] icon+label template`).

---

### Task 5 (PLEXUS): drop factory builds `ArchNodeVM`

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-instance-drop-factory.ts` (`apply()` ~line 43-63)
- Test: `.../services/tests/arch-instance-drop-factory.test.ts` (extend existing if present)

**Interfaces — Consumes:** mural `DiagramMutator.AddNode` (Task 1); `ArchNodeVM` (Task 3); `ToolboxVisualDescriptor`, `TodlVisualResolverKey`; `displayLabel` (from `arch-diagram-binding.ts`).

- [ ] **Step 1: Write the failing test** — drop a term (a `ToolboxDropContext` with a `Descriptor.Key`) on a doc backed by an `ArchModel`; assert the node added to `Nodes` is an `ArchNodeVM` with `Id === entity.id`, `Label === displayLabel(entity)`, and `Descriptor.Key === <concept key>` (`'mm:'`-stripped consistently with `arch-drop-resolver.ts`). Reuse the existing drop-factory test harness.
- [ ] **Step 2: Run, verify FAIL** (today it creates a `Figure` via `CreateNode('rectangle')`).
- [ ] **Step 3: Implement** — in `apply()`, replace the `CreateNode('rectangle'|Descriptor.Key)` materialisation with:
  ```ts
  const vm = new ArchNodeVM();
  vm.Id = entity.id;
  vm.Left = X; vm.Top = Y;
  vm.Descriptor = new ToolboxVisualDescriptor(TodlVisualResolverKey, conceptKey); // conceptKey = 'mm:'-stripped Descriptor.Key
  vm.Label = displayLabel(entity);
  context.Mutator.AddNode(vm);
  ```
  Keep `notifyChanged()` + `save()`. The standalone-diagram (no `ArchModel`) branch keeps its current `CreateNode` behaviour unchanged.
- [ ] **Step 4: Run PASS** + Plexus `typecheck`.
- [ ] **Step 5: Commit** (`feat(arch): drop builds ArchNodeVM with icon descriptor + label`).

---

### Task 6 (PLEXUS): binding derives label + icon (drop + reload)

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-diagram-binding.ts` (`rescan()` ~line 27-39; `displayLabel` ~71-75)
- Test: extend `.../services/tests/arch-diagram-binding.test.ts` (or the binding's existing test)

**Interfaces — Consumes:** `ArchNodeVM.Label`/`.Descriptor`; `Entity.concept`; `ToolboxVisualDescriptor`, `TodlVisualResolverKey`.

- [ ] **Step 1: Write the failing test** — a doc whose `Nodes` holds an `ArchNodeVM` with `Id` matching a live entity, but empty `Label`/`Descriptor` (as after deserialize); call the binding's `rescan()`; assert `archVM.Label === displayLabel(entity)` AND `archVM.Descriptor.Key === entity.concept`. This is the reload path.
- [ ] **Step 2: Run, verify FAIL** (rescan only sets `LabelText` on Figures today).
- [ ] **Step 3: Implement** — in `rescan()`, for each node that is an `ArchNodeVM` whose `Id` matches a live entity:
  ```ts
  node.Label = displayLabel(entity);
  node.Descriptor = new ToolboxVisualDescriptor(TodlVisualResolverKey, entity.concept);
  ```
  (retain the current Figure `LabelText` branch for any non-VM nodes). `entity.concept` is the instance's concept id (direct `Entity` property).
- [ ] **Step 4: Run PASS** + Plexus `typecheck`.
- [ ] **Step 5: Commit** (`feat(arch): binding derives ArchNodeVM label + icon from entity`).

---

### Task 7 (PLEXUS): register the `arch` node serializer

**Files:**
- Modify/Create: where Plexus wires diagram services at module init (grep the diagram module registration — e.g. `diagram-panel-services.ts` / the module's service setup) — register the serializer once at startup
- Test: `.../tests/arch-node-serialize.test.ts`

**Interfaces — Consumes:** mural's node-serializer registry (`registerNodeSerializer` / the published registry API), `ArchNodeVM`, `NodeBaseRecord`.

- [ ] **Step 1: Write the failing test** — a `DiagramDocument` with an `ArchNodeVM` (Id `a1`, at 30/40); `Save()` → `Load()` into a fresh doc; assert the reloaded node is an `ArchNodeVM` at (30,40) with `Id === 'a1'`. (Label/Descriptor are empty until the binding attaches — assert they are NOT persisted.)
- [ ] **Step 2: Run, verify FAIL** — without a registered `arch` serializer, `serializerFor(ArchNodeVM)` is undefined so `_serialize` skips it → the node is lost on reload.
- [ ] **Step 3: Implement** — register at module init:
  ```ts
  registerNodeSerializer({
      type: 'arch',
      matches: (n) => n instanceof ArchNodeVM,
      serialize: () => ({}),                       // id + position ride the base record; icon/label re-derive
      deserialize: (_data, base) => { const vm = new ArchNodeVM(); vm.Left = base.left; vm.Top = base.top; vm.Width = base.w; vm.Height = base.h; vm.Id = base.id; return vm; },
  });
  ```
  Ensure this runs before any diagram loads (module bootstrap, once).
- [ ] **Step 4: Run PASS** + Plexus `typecheck`.
- [ ] **Step 5: Commit** (`feat(arch): register arch node serializer (id+position round-trip)`).

---

### Task 8: Gate + live-smoke checklist

- [ ] **Step 1:** Plexus full test suite green; `typecheck` clean. Mural (if Task 1 touched) full suite green.
- [ ] **Step 2:** Build Plexus (`.mu` compile + app build) clean — the `[DataType=ArchNodeVM]` template compiled, `ArchNodeVM` symbol resolved.
- [ ] **Step 3:** Live-smoke checklist (human-run): (a) drop a component/technology on an architecture diagram → the node shows the term's icon + a real label (not a rectangle / "component2"); (b) a term with no icon shows the default glyph; (c) reopen the project → nodes restore icon + label at their saved positions; (d) connectors between arch nodes still route (mural M3). Report the checklist for the human to run.

## Self-Review

- **Spec coverage:** ArchNodeVM (T3), icon+label template via ToolboxVisualPresenter[Figure] (T4), drop builds VM via AddNode (T1+T5), binding derives label+icon from entity.concept (T6), arch serializer id+position round-trip (T7), gate+smoke (T8); mural availability (T2). ✓
- **Placeholders:** T1/T3/T5/T6/T7 carry concrete code; T4's exact `ToolboxVisualPresenter` attrs + `VisualContext` member and Plexus's symbol-registration / module-init locations are flagged to match against the cited existing files (they exist and are referenced) — not hand-waved logic. ✓
- **Type consistency:** `AddNode(node: NodeViewModel)`; `ArchNodeVM.Label/Descriptor`; `Descriptor = ToolboxVisualDescriptor(TodlVisualResolverKey, conceptKey)` identical in drop (T5) and binding (T6); serializer `data: {}` with id/pos on the base record. ✓
- **Cross-repo:** Task 1 (Mural) precedes Task 2 (availability) precedes Plexus tasks; the plan states the repo for each task. ✓

# Concept `toolbox { visible }` Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The arch-model toolbox engine skips a model entity whose concept carries `annotate toolbox { visible = false }`, on both the "Model:" and "Scenarios" pages.

**Architecture:** A pure helper `conceptToolboxVisible(repo, concept)` reads the concept's `<concept>@toolbox` annotation node from the loaded `Repository` (same path as `iconEntityKey`), returning visible-unless-opted-out. Both `modelPageItems` and `scenarioPageItems` add it to their per-entity skip guard.

**Tech Stack:** TypeScript (Plexus renderer), vitest (node env), `@pragmatic-lab/todl` (`Repository`, `ModelDraft`, `load`/`toJSON`/`graphFromJSON`).

## Global Constraints

- Renderer-only. No `@pragmatic-lab/mural` or `@pragmatic-lab/todl` change.
- Every test file lives in a `tests/` subfolder next to the code it exercises.
- Opt-out semantics, default visible: absent annotation → visible; `visible = true` → visible; only `visible = false` hides. No meta-model migration.
- Reuse the existing `toolbox` annotation (`annotation toolbox { visible : boolean; }`) — the same one `meta-model/services/toolbox-projection.ts` uses. Do NOT invent a new annotation name.
- Booleans resolve to real booleans from `repo.resolve(...).attrs` in this codebase (cf. `arch-materialize`, `arch-drop-resolver`), so the opt-out test is a strict `!== false`.

---

### Task 1: `conceptToolboxVisible` helper + both page filters

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-model-toolbox-contributor.ts`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/toolbox-visible-filter.test.ts`

**Interfaces:**
- Consumes: `modelPageItems(model: ArchModel, scope: ReadonlySet<string>, placed: ReadonlySet<string>): ArchToolboxItem[]` and `scenarioPageItems(model: ArchModel, scope: ReadonlySet<string>): ArchToolboxItem[]` (existing exports); `model.repository(): Repository`; `Entity.concept: string`; `repo.resolve(id: string): { attrs: Map<string, unknown> } | undefined`.
- Produces: `export function conceptToolboxVisible(repo: Repository, concept: string): boolean` — `true` unless the concept's `toolbox` annotation sets `visible = false`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/modules/architecture-projects/services/tests/toolbox-visible-filter.test.ts`:

```ts
import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-lab/todl'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { ArchModel } from '../arch-model.js'
import { modelPageItems, scenarioPageItems, conceptToolboxVisible } from '../arch-model-toolbox-contributor.js'

// service: hidden (visible = false); widget: visible = true; gadget: no annotation.
// A scenario concept is hidden so the Scenarios page collapses.
const MM = `namespace archmm {
  annotation toolbox { visible : boolean; }
  concept service { annotate toolbox { visible = false; } }
  concept widget  { annotate toolbox { visible = true; } }
  concept gadget  {}
  concept step { relationship src -> widget; relationship dst -> widget; }
  concept sequence { relationship steps -> step; }
  concept scenario { annotate toolbox { visible = false; } relationship sequences -> sequence; }
  viewpoint V : frames service, widget, gadget
  viewpoint S : frames scenario, sequence, step
}`

function buildModel(): ArchModel {
    const draft = ModelDraft.fromSources(
        [new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))],
        [], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

test('conceptToolboxVisible: opt-out false, explicit true, and absent (default visible)', () => {
    const repo = buildModel().repository()
    expect(conceptToolboxVisible(repo, 'service')).toBe(false)
    expect(conceptToolboxVisible(repo, 'widget')).toBe(true)
    expect(conceptToolboxVisible(repo, 'gadget')).toBe(true)   // no annotation → visible
})

test('modelPageItems drops entities whose concept opts out of the toolbox', () => {
    const model = buildModel()
    model.createInViewpoint('service', 'V')          // hidden
    const w = model.createInViewpoint('widget', 'V') // visible = true
    const g = model.createInViewpoint('gadget', 'V') // no annotation → visible

    const ids = modelPageItems(model, new Set(['V']), new Set()).map((i) => i.Id).sort()
    expect(ids).toEqual(['instance:' + g.id, 'instance:' + w.id].sort())
})

test('scenarioPageItems is empty when the scenario concept opts out', () => {
    const model = buildModel()
    model.createInViewpoint('scenario', 'S')
    expect(scenarioPageItems(model, new Set(['S']))).toEqual([])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/toolbox-visible-filter.test.ts`
Expected: FAIL — `conceptToolboxVisible` is not exported (import error), and/or the `modelPageItems` result still includes `instance:<service id>`.

- [ ] **Step 3: Add the helper**

In `arch-model-toolbox-contributor.ts`, add the import for `Repository` and the helper. The existing todl import is `import type { Entity } from '@pragmatic-lab/todl'` — extend it:

```ts
import type { Entity, Repository } from '@pragmatic-lab/todl'
```

Add the helper below `entityLabel` (before `modelPageItems`):

```ts
// A concept is toolbox-visible unless it explicitly opts out with
// `annotate toolbox { visible = false }` (the same author-declared `toolbox`
// annotation the meta-model module's toolbox-projection uses). Absent
// annotation → visible. Read from the loaded Repository, keyed on the
// `<concept>@toolbox` annotation node — the same path iconEntityKey reads
// `<id>@icon`. Booleans resolve to real booleans here, so opt-out is `!== false`.
export function conceptToolboxVisible(repo: Repository, concept: string): boolean
{
    return repo.resolve(`${concept}@toolbox`)?.attrs.get('visible') !== false
}
```

- [ ] **Step 4: Filter the Model page**

In `modelPageItems`, extend the per-entity skip guard (currently `if (placed.has(e.id) || !inScope(e.concept)) continue`):

```ts
    for (const e of model.entities()) {
        if (placed.has(e.id) || !inScope(e.concept) || !conceptToolboxVisible(repo, e.concept)) continue
        const key = iconEntityKey(repo, e) ?? e.concept
        const descriptor = new ToolboxVisualDescriptor(TodlVisualResolverKey, key)
        items.push(new ArchToolboxItem('instance:' + e.id, entityLabel(e), descriptor, ArchModelInstanceDropFactoryKey))
    }
```

- [ ] **Step 5: Filter the Scenarios page**

In `scenarioPageItems`, extend the guard (currently `if (e.concept !== SCENARIO_CONCEPT || !inScope(e.concept)) continue`):

```ts
    for (const e of model.entities()) {
        if (e.concept !== SCENARIO_CONCEPT || !inScope(e.concept) || !conceptToolboxVisible(repo, e.concept)) continue
        const key = iconEntityKey(repo, e) ?? e.concept
        const descriptor = new ToolboxVisualDescriptor(TodlVisualResolverKey, key)
        items.push(new ArchToolboxItem('scenario:' + e.id, entityLabel(e), descriptor, ArchScenarioDropFactoryKey))
    }
```

(`repo` is already bound at the top of both functions via `const repo = model.repository()`.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/toolbox-visible-filter.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Run the neighboring suite + typecheck (no regressions)**

Run: `npx vitest run src/renderer/src/modules/architecture-projects` and `npm run typecheck:web`
Expected: all pass; the existing `arch-model-toolbox-contributor.test.ts` and `scenario-page-items.test.ts` still green (they use meta-models without a `toolbox` annotation → every concept stays visible).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/services/arch-model-toolbox-contributor.ts \
        src/renderer/src/modules/architecture-projects/services/tests/toolbox-visible-filter.test.ts
git commit -m "feat(toolbox): respect concept toolbox { visible } in the arch-model toolbox engine"
```

---

## Self-Review

**Spec coverage:** Behavior (opt-out default) → Steps 3–5 + tests. Both pages → Steps 4 & 5. Reading path (`<concept>@toolbox`, `!== false`) → Step 3. Testing (three cases: hidden concept, visible/absent concept, hidden scenario) → Step 1. "Out of scope" items (meta-model annotation declaration, per-entity visibility) are not implemented here, as intended.

**Placeholder scan:** None — all steps carry real code and exact run commands.

**Type consistency:** `conceptToolboxVisible(repo: Repository, concept: string): boolean` is defined in Step 3 and called identically in Steps 4, 5, and the test. `repo` is `model.repository()` in both functions. `Entity`/`Repository` import extended in Step 3.

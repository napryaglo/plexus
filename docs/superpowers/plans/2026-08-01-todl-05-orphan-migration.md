# TODL 0.5.0 Orphan Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a green Plexus suite and fix the live 0.5.0 regression — the arch emitter emits `model`-wrapped valid TODL, and the unused `meta-model {…}` descriptor is dropped.

**Architecture:** Part A — `emitInstances` wraps concrete instances in a `model <ns>-model : <meta> uses <…> { }` block (local `class` nodes stay top-level, orphan-exempt; the model body rejects `class`); bindings are derived from the bases + the project namespace; `ArchInstanceModel.load` strips the synthesized container node so `own` stays instances-only. Part B — remove the descriptor from the scaffold guide, the TODL manual, and the `EA` test fixture.

**Tech Stack:** TypeScript (strict ESM), `@pragmatic-tech-ai/todl` (`TodlDocument`/`JsonNode` + `check`/`checkAgainst`/`toJSON`), Vitest.

## Global Constraints

- Consumes `@pragmatic-tech-ai/todl` **0.5.0** — no TODL changes; the `model`/orphan rule is consumed as-is.
- **Concrete instances wrap in a `model` block; local `class` nodes stay top-level** (verified: `class` inside a model body is a syntax error).
- **`deriveBindings`:** `metaModel` = the first (sorted) distinct `namespace` attr across the **base** nodes; `uses` = the remaining base namespaces plus the project namespace, sorted, with the meta-model slot removed. No bases → `{ metaModel: namespace, uses: [] }`. Validity only needs every bound name present in the merged doc (`validateModel` makes no meta-model/library distinction) — verified clean via `checkAgainst`.
- **Model id:** `${namespace}-model` (deterministic, valid lowercase-kebab, no collision with `freshId`'s `<stem>-<seq>`).
- **`load` strips the container:** nodes with `typeOf === 'model'` and edges whose `from` is a container id are excluded alongside the base-id filter, so `own` = instances + local classes as before.
- **Descriptor dropped** — removed from `scaffold/meta-model-guide.md`, `scaffold/todl-manual.md`, and the `EA` fixture. No reintroduction of `root-concept`/`top-level-concepts`.
- Every test file lives in a `tests/` subfolder (Vitest globs `src/**/*.test.ts`).
- Single file: `npx vitest run <path>`; whole suite: `npm test`; typecheck: `npm run typecheck`.
- **Success = the whole suite goes to ZERO failures** (the 5 pre-existing reds fixed, no regressions).

## File Structure

- **Modify** `src/renderer/src/modules/architecture-repository/services/todl-emitter.ts` — add `ModelBindings` + `deriveBindings`; `emitInstances` gains a `bindings` param and wraps concrete instances.
- **Modify** `src/renderer/src/modules/architecture-repository/services/architecture-instance-model.ts` — `emit()` derives bindings; `load()` strips the container node.
- **Modify** `src/renderer/src/modules/meta-model/services/scaffold/meta-model-guide.md`, `scaffold/todl-manual.md` — remove the descriptor sections.
- **Test** files alongside each in `tests/` subfolders (extend existing).

---

### Task 1: `deriveBindings` — model binding derivation

**Files:**
- Modify: `src/renderer/src/modules/architecture-repository/services/todl-emitter.ts`
- Test: `src/renderer/src/modules/architecture-repository/services/tests/todl-emitter.test.ts`

**Interfaces:**
- Consumes: `TodlDocument` (type); the test's existing `bases()` helper (metaDoc ns `ea` + libDoc ns `ms`).
- Produces: `export interface ModelBindings { metaModel: string; uses: string[] }` and `export function deriveBindings(bases: readonly TodlDocument[], namespace: string): ModelBindings` — used by Tasks 2 and 3.

- [ ] **Step 1: Write the failing tests**

Append to `tests/todl-emitter.test.ts` (add `deriveBindings` to the `../todl-emitter.js` import):

```ts
test('deriveBindings: meta-model is the first sorted base namespace; uses adds the rest + self', () => {
    expect(deriveBindings(bases(), 'app')).toEqual({ metaModel: 'ea', uses: ['app', 'ms'] })
})

test('deriveBindings: no bases binds the project namespace alone', () => {
    expect(deriveBindings([], 'app')).toEqual({ metaModel: 'app', uses: [] })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/renderer/src/modules/architecture-repository/services/tests/todl-emitter.test.ts`
Expected: FAIL — `deriveBindings` is not exported.

- [ ] **Step 3: Implement `deriveBindings`**

In `todl-emitter.ts`, add near the top (after imports):

```ts
export interface ModelBindings { metaModel: string; uses: string[] }

// Derive a model's bindings from the compiled bases + the project namespace.
// metaModel = the first (sorted) distinct `namespace` attr across the BASE nodes;
// uses = the remaining base namespaces plus the project namespace (so local `class`
// constructors stay in scope), sorted, minus the meta-model slot. Validity only
// requires every bound name to be present in the merged doc — validateModel makes
// no meta-model/library distinction.
export function deriveBindings(bases: readonly TodlDocument[], namespace: string): ModelBindings
{
    const baseNs = new Set<string>()
    for (const b of bases) for (const n of b.nodes) {
        const ns = (n.attrs as Record<string, unknown>)['namespace']
        if (typeof ns === 'string' && ns.length > 0) baseNs.add(ns)
    }
    const sortedBase = [...baseNs].sort()
    const metaModel = sortedBase[0] ?? namespace
    const usesSet = new Set<string>([...sortedBase.slice(1), namespace])
    usesSet.delete(metaModel)
    return { metaModel, uses: [...usesSet].sort() }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/renderer/src/modules/architecture-repository/services/tests/todl-emitter.test.ts`
Expected: the two `deriveBindings` tests PASS. (The existing round-trip tests still fail — fixed in Task 2.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/architecture-repository/services/todl-emitter.ts \
        src/renderer/src/modules/architecture-repository/services/tests/todl-emitter.test.ts
git commit -m "feat: deriveBindings — model bindings from bases + project namespace"
```

---

### Task 2: `emitInstances` wraps concrete instances in a `model` block

**Files:**
- Modify: `src/renderer/src/modules/architecture-repository/services/todl-emitter.ts`
- Test: `src/renderer/src/modules/architecture-repository/services/tests/todl-emitter.test.ts`

**Interfaces:**
- Consumes: `ModelBindings` + `deriveBindings` (Task 1).
- Produces: `emitInstances(own: TodlDocument, namespace: string, bindings: ModelBindings): string` — output has local classes top-level and concrete instances inside `model <ns>-model : <meta> [uses …] { }`. Used by Task 3.

- [ ] **Step 1: Update the round-trip tests to the migrated contract**

In `tests/todl-emitter.test.ts`:

(a) Update `ownOf` to also strip the model container node + its edges:

```ts
function ownOf(full: TodlDocument, ids: Set<string>): TodlDocument {
    const modelIds = new Set(full.nodes.filter((n) => n.typeOf === 'model').map((n) => n.id))
    return {
        nodes: full.nodes.filter((n) => !ids.has(n.id) && !modelIds.has(n.id)),
        edges: full.edges.filter((e) => !ids.has(String(e.from)) && !modelIds.has(String(e.from))),
    }
}
```

(b) Replace the two round-trip tests' bodies so the source is model-wrapped, `emitInstances` receives bindings, and the emitted `model` block is asserted:

```ts
test('round-trips a concept instance with a scalar field and a single reference', () => {
    const bs = bases()
    const src = `namespace app { model app-model : ea uses ms { component gw { label = "Gateway"; realised-by = &stack.azure-openai; } } }`
    const own = ownFrom(bs, src)

    const emitted = emitInstances(own, 'app', deriveBindings(bs, 'app'))
    expect(emitted).toContain('model app-model : ea')
    const own2 = ownFrom(bs, emitted)

    expect(normal(own2)).toEqual(normal(own))
})

test('round-trips a many-valued reference (list) and an instanceof class', () => {
    const bs = bases()
    const src = `namespace app {
      class component web-tier { realised-by = &stack.azure-func; }
      model app-model : ea uses ms, app {
        component api instanceof web-tier { label = "API"; deployed-to = [stack.azure-openai, stack.azure-func]; }
      }
    }`
    const own = ownFrom(bs, src)

    const emitted = emitInstances(own, 'app', deriveBindings(bs, 'app'))
    expect(emitted).toContain('model app-model : ea')
    expect(emitted).toMatch(/^\s*class component web-tier/m)   // local class stays top-level
    const own2 = ownFrom(bs, emitted)

    expect(normal(own2)).toEqual(normal(own))
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/renderer/src/modules/architecture-repository/services/tests/todl-emitter.test.ts`
Expected: FAIL — `emitInstances` takes 2 args / emits no `model` block (compile error on the 3rd arg or missing `model …` in output).

- [ ] **Step 3: Rewrite `emitInstances`**

Replace `emitInstances` in `todl-emitter.ts`:

```ts
export function emitInstances(own: TodlDocument, namespace: string, bindings: ModelBindings): string
{
    const instances = own.nodes.filter((n) => n.tier === 'Instance')
    const classes = instances.filter((n) => (n.attrs as Record<string, unknown>).class === true)
    const concrete = instances.filter((n) => (n.attrs as Record<string, unknown>).class !== true)

    // Index the own edges by source node.
    const instanceOf = new Map<string, string>()                        // from → class id
    const rels = new Map<string, Array<{ via: string; to: string }>>()  // from → relationship edges
    for (const e of own.edges) {
        const from = String(e.from)
        if (e.kind === 'InstanceOf') instanceOf.set(from, String(e.to))
        else if (e.kind === 'Relationship') {
            const list = rels.get(from) ?? []
            list.push({ via: String(e.via), to: String(e.to) })
            rels.set(from, list)
        }
    }

    const lines: string[] = [`namespace ${namespace}`, '{']
    // Local classes are orphan-exempt and the model body rejects `class`, so they
    // stay at top level (emitted first, so `instanceof` targets exist).
    for (const n of classes) lines.push(...emitOne(n, instanceOf.get(n.id), rels.get(n.id) ?? []))
    // Concrete instances must live inside a model; skip the block when there are none.
    if (concrete.length > 0) {
        const uses = bindings.uses.length > 0 ? ` uses ${bindings.uses.join(', ')}` : ''
        lines.push(`  model ${namespace}-model : ${bindings.metaModel}${uses} {`)
        for (const n of concrete) {
            for (const l of emitOne(n, instanceOf.get(n.id), rels.get(n.id) ?? [])) lines.push(`  ${l}`)
        }
        lines.push('  }')
    }
    lines.push('}')
    return lines.join('\n') + '\n'
}
```

`emitOne` is unchanged.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/renderer/src/modules/architecture-repository/services/tests/todl-emitter.test.ts`
Expected: PASS (both round-trip tests + the two `deriveBindings` tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/architecture-repository/services/todl-emitter.ts \
        src/renderer/src/modules/architecture-repository/services/tests/todl-emitter.test.ts
git commit -m "feat: emitInstances wraps concrete instances in a model block"
```

---

### Task 3: `ArchInstanceModel` derives bindings on emit, strips the container on load

**Files:**
- Modify: `src/renderer/src/modules/architecture-repository/services/architecture-instance-model.ts`
- Test: `src/renderer/src/modules/architecture-repository/services/tests/architecture-instance-model.test.ts`

**Interfaces:**
- Consumes: `emitInstances` + `deriveBindings` (Tasks 1–2).
- Produces: `emit()` returns model-wrapped source; `load()` yields `own` without the container node.

- [ ] **Step 1: Write the failing tests**

Append to `tests/architecture-instance-model.test.ts`:

```ts
test('load strips the model container node; ownInstances excludes it', () => {
    const src = `namespace app { model app-model : ea uses ms { component gw { label = "Gateway"; } } }`
    const model = ArchInstanceModel.load(bases(), src, 'app')
    expect(model.ownInstances()).toEqual(['gw'])   // 'app-model' container excluded
})

test('emit wraps concrete instances in a model block bound to the meta-model', () => {
    const model = ArchInstanceModel.load(bases(), '', 'app')
    const id = model.createInstance('component')
    model.setField(id, 'label', 'API')

    const emitted = model.emit()
    expect(emitted).toContain('model app-model : ea')
    expect(emitted).toContain(`component ${id}`)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/renderer/src/modules/architecture-repository/services/tests/architecture-instance-model.test.ts`
Expected: FAIL — `ownInstances()` returns `['app-model', 'gw']` (container not stripped); `emit()` output has no `model …` block (3rd arg missing → also a type error surfaced at Step 4 typecheck).

- [ ] **Step 3: Import `deriveBindings`**

In `architecture-instance-model.ts`, change the emitter import:

```ts
import { emitInstances, deriveBindings } from './todl-emitter.js'
```

- [ ] **Step 4: Strip the container in `load`**

In `ArchInstanceModel.load`, replace the `own = { … }` assignment inside the `if (instanceSource.trim().length > 0)` block:

```ts
            const full = toJSON(checkAgainst([...bases], [{ uri: `${namespace}.todl`, text: instanceSource }]).model)
            const modelIds = new Set(full.nodes.filter((n) => n.typeOf === 'model').map((n) => n.id))
            own = {
                nodes: full.nodes.filter((n) => !baseIds.has(n.id) && !modelIds.has(n.id)),
                edges: full.edges.filter((e) => !baseIds.has(String(e.from)) && !modelIds.has(String(e.from))),
            }
```

- [ ] **Step 5: Derive bindings in `emit`**

Replace `emit()`:

```ts
    public emit(): string { return emitInstances(this.own, this.namespace, deriveBindings(this.bases, this.namespace)) }
```

- [ ] **Step 6: Run to verify they pass**

Run: `npx vitest run src/renderer/src/modules/architecture-repository/services/tests/architecture-instance-model.test.ts`
Expected: PASS (the two new tests plus the existing ones — the existing `emit()` assertions are substring checks that still hold inside the model block; the existing top-level-source `load` test still yields `['gw']`).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/modules/architecture-repository/services/architecture-instance-model.ts \
        src/renderer/src/modules/architecture-repository/services/tests/architecture-instance-model.test.ts
git commit -m "feat: ArchInstanceModel derives model bindings on emit, strips container on load"
```

---

### Task 4: Drop the meta-model descriptor (Part B)

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/scaffold/meta-model-guide.md`
- Modify: `src/renderer/src/modules/meta-model/services/scaffold/todl-manual.md`
- Test: `src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts`

**Interfaces:**
- Consumes: nothing (independent cleanup).
- Produces: the 3 `meta-model-project-factory` publish tests go green (the `EA` orphan fixture removed).

- [ ] **Step 1: Fix the failing publish tests**

In `tests/meta-model-project-factory.test.ts`:

(a) Delete the `EA` const (line 32):
```ts
const EA = 'namespace d { meta-model enterprise-architecture { name = "EA"; version = 5; root-concept = model; top-level-concepts = [ component, location ]; } }'
```

(b) In `'publish writes compiled model + sources for a clean project'`, remove the `ea.todl` write and its assertion:
```ts
    await storage.WriteText('ea.todl', EA)
```
```ts
    expect(await dest.Exists('acme/0.1.0/src/ea.todl')).toBe(true)
```

(c) In `'publish also (re)writes presentation.generated.mu into the project'` and `'publish ships the presentation payload into the backend'`, remove the `ea.todl` write line from each:
```ts
    await storage.WriteText('ea.todl', EA)
```

- [ ] **Step 2: Run to verify these tests now pass**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts`
Expected: PASS — all tests in the file (the 3 formerly-failing publish tests now publish a clean concepts-only project).

- [ ] **Step 3: Remove the descriptor from the scaffold guide**

In `scaffold/meta-model-guide.md`, delete the entire `## The descriptor record` section — the heading, the prose, and the `meta-model my-mm { … }` code block (through the end of that section, up to the next `##` heading or a blank separator). Use the on-disk content as the exact anchor.

- [ ] **Step 4: Remove the descriptor from the TODL manual**

In `scaffold/todl-manual.md`, delete the `## 7. The `meta-model` descriptor` section (heading + prose + the `meta-model acme-ea { … }` example) and the later `meta-model my-mm { … }` example block. Keep the `: <meta-model>` model-binding bullet (§ around line 196) — it documents the valid `model` construct, not the descriptor. Use the on-disk content as the exact anchor.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/scaffold/meta-model-guide.md \
        src/renderer/src/modules/meta-model/services/scaffold/todl-manual.md \
        src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts
git commit -m "chore: drop the unused meta-model descriptor from scaffold docs + fixtures"
```

---

### Task 5: Full-suite + typecheck verification + finish

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: **ZERO failures** — the 5 pre-existing `instance.orphan` reds are fixed and nothing else regressed.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean (node + web) — the `ModelBindings`/`deriveBindings` types and the `emitInstances` 3-arg signature all check.

- [ ] **Step 3: Finish the branch**

Announce and use **superpowers:finishing-a-development-branch** to verify tests, present merge/PR/keep options (base `main`), and clean up. This is the first branch in the series expected to land a fully green suite.

---

## Self-Review

**Spec coverage:**
- §3.A1 `deriveBindings` → Task 1. ✓
- §3.A2 `emitInstances` model-wrap (classes top-level, model id `<ns>-model`, uses only when non-empty, omit block when no concrete instances) → Task 2. ✓
- §3.A3 `ArchInstanceModel` emit-derive + load-strip → Task 3. ✓
- §4 descriptor drop (guide, manual, EA fixture) → Task 4. ✓
- §7 testing (deriveBindings, emitter round-trip with model assertion + class-top-level, instance-model load-strip + emit-wrap, factory green) → Tasks 1–4. ✓
- §6 error handling (no concrete instances → no block; no bases → self-only) → deriveBindings no-bases test (Task 1) + the `concrete.length > 0` guard (Task 2). ✓

**Placeholder scan:** No TBD/TODO; the two doc-removal steps (Task 4 Steps 3–4) intentionally anchor on on-disk content because markdown line numbers shift as edits land — the section headings named are exact. Every code step carries real code. ✓

**Type consistency:** `ModelBindings { metaModel: string; uses: string[] }` defined in Task 1, consumed identically in Tasks 2–3. `emitInstances(own, namespace, bindings)` 3-arg signature matches its only caller (`ArchInstanceModel.emit`, Task 3) and the test calls (Task 2). `deriveBindings(bases, namespace)` reused verbatim in Tasks 1/3 and the emitter tests. Model id `${namespace}-model` consistent across emitter output and both test assertions (`model app-model : ea`, namespace `app`). ✓

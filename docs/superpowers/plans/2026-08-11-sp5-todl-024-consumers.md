# Plexus TODL 0.24 Consumers (SP5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Plexus onto `@pragmatic-lab/todl@^0.24.0`, make the one union-broken consumer union-aware, and give dropped entities a valid required `label`.

**Architecture:** Bump the dependency (Verdaccio); fix `arch-drop-resolver.ts` to test the relationship `targets` array instead of a single `target`; add a pure `arch-default-label.ts` helper the drop factory calls to set `label`. `deriveClasses` is delegated to TODL (unchanged); emit stays bare + operator-free via 0.24.0.

**Tech Stack:** TypeScript (ESM, strict), Electron/electron-vite, vitest. `@pragmatic-lab/*` from Verdaccio (`http://localhost:4873/`).

## Global Constraints

- Plexus imports `@pragmatic-lab/*` from Verdaccio only — no relative `../src` imports into framework packages.
- Every Plexus test file lives in a `tests/` subfolder next to its source (vitest globs `src/**/*.test.ts`).
- Real TypeScript `enum`s, never string-literal unions.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- No git push. The live in-app republish is a manual step, surfaced in the handoff.
- Test: `npm test` (`vitest run`). Typecheck: `npm run typecheck` (node + web).
- Branch: `feat/sp5-todl-0.24-consumers`.

---

### Task 1: Bump to 0.24.0 + union-aware drop resolver

The bump is the forcing function: `RelationshipSchema.target` no longer exists in 0.24.0, so `arch-drop-resolver.ts:39` stops compiling until fixed.

**Files:**
- Modify: `package.json` (dependency version)
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-drop-resolver.ts:39`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-drop-resolver.test.ts` (extend the existing fixture)

**Interfaces:**
- Consumes: `RelationshipSchema.targets: NodeId[]` (0.24.0), `resolveDropActions(repo, descriptorKey, scope)` (unchanged signature).
- Produces: union-aware reference-drop routing.

- [ ] **Step 1: Bump the dependency and reinstall**

Edit `package.json`: `"@pragmatic-lab/todl": "^0.23.0"` → `"@pragmatic-lab/todl": "^0.24.0"`.
Run: `npm install --registry http://localhost:4873/`
Expected: `@pragmatic-lab/todl@0.24.0` installed (verify: `npm ls @pragmatic-lab/todl`).

- [ ] **Step 2: Confirm the compile break**

Run: `npm run typecheck`
Expected: FAIL in `arch-drop-resolver.ts:39` — `Property 'target' does not exist on type 'RelationshipSchema'` (0.24.0 renamed it to `targets`). This confirms the bump landed and located the consumer.

- [ ] **Step 3: Fix the resolver to be union-aware**

`src/renderer/src/modules/architecture-projects/services/arch-drop-resolver.ts`, line 39, replace:

```ts
            if (accept.has(rel.target))
```
with:
```ts
            if (rel.targets.some((t) => accept.has(t)))
```

- [ ] **Step 4: Typecheck passes**

Run: `npm run typecheck`
Expected: PASS (no other consumer reads relationship `.target`).

- [ ] **Step 5: Extend the resolver test with a union relationship**

In `services/tests/arch-drop-resolver.test.ts`, extend `MM` — add an `actor` concept, an `edge` concept with a **union** relationship, and a viewpoint framing it (append inside the `namespace archmm { … }` body, before the closing brace):

```
  concept actor {}
  concept edge { relationship end -> actor | component; }
  viewpoint EdgeView : frames edge
```

Then add this test (its own scope with `EdgeView`, so the existing tests — which use the module `scope` without `EdgeView` — are unaffected):

```ts
test('a union relationship matches a term whose type is a non-first union member', () => {
    // `end -> actor | component`; webKind is a `component` (the 2nd union member).
    // Single-target routing would only check the first target (actor) and miss it.
    const actions = resolveDropActions(repo(), 'Kinds.webKind', new Set(['EdgeView']))
    const kinds = actions.map((a) => `${a.kind}:${a.concept}${a.member ? '.' + a.member : ''}`)
    expect(kinds).toContain('reference:edge.end')
})
```

- [ ] **Step 6: Run the resolver tests**

Run: `npm test -- arch-drop-resolver`
Expected: all PASS — the 3 existing tests (single-target = length-1 unions, unchanged behavior) plus the new union test.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/renderer/src/modules/architecture-projects/services/arch-drop-resolver.ts src/renderer/src/modules/architecture-projects/services/tests/arch-drop-resolver.test.ts
git commit -m "feat(sp5): bump todl 0.24; union-aware reference-drop routing

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Default `label` on dropped entities

**Files:**
- Create: `src/renderer/src/modules/architecture-projects/services/arch-default-label.ts`
- Create: `src/renderer/src/modules/architecture-projects/services/tests/arch-default-label.test.ts`
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-instance-drop-factory.ts` (`apply`)

**Interfaces:**
- Consumes: `Repository` (`.resolve(id)?.attrs.get('label')`), `DropAction` (`kind`, `concept`, `term?`), `DropActionKind` from `./arch-drop-resolver.js`.
- Produces: `defaultLabel(repo: Repository, action: DropAction): string`, `humanize(id: string): string`.

- [ ] **Step 1: Write the failing helper tests**

Create `services/tests/arch-default-label.test.ts`:

```ts
import { test, expect } from 'vitest'
import { load } from '@pragmatic-lab/todl'
import { defaultLabel, humanize } from '../arch-default-label.js'
import { DropActionKind, type DropAction } from '../arch-drop-resolver.js'

const MM = `namespace ta {
  concept component {}
  taxonomy Kinds : represents component { term m365_copilot { label = "M365 Copilot"; } term barebones {} }
}`
function repo() { return load([{ uri: 'mm.todl', text: MM }]).model }

test('humanize turns an id into a title-cased phrase', () => {
    expect(humanize('m365_copilot')).toBe('M365 Copilot')
    expect(humanize('component')).toBe('Component')
    expect(humanize('Kinds.barebones')).toBe('Barebones')
})

test('a reference drop uses the dropped term label when present', () => {
    const action: DropAction = { kind: DropActionKind.Reference, concept: 'edge', member: 'end', term: 'Kinds.m365_copilot', label: 'x' }
    expect(defaultLabel(repo(), action)).toBe('M365 Copilot')
})

test('a reference drop falls back to a humanized term id when unlabelled', () => {
    const action: DropAction = { kind: DropActionKind.Reference, concept: 'edge', member: 'end', term: 'Kinds.barebones', label: 'x' }
    expect(defaultLabel(repo(), action)).toBe('Barebones')
})

test('an instance drop uses a humanized concept name', () => {
    const action: DropAction = { kind: DropActionKind.Instance, concept: 'component', label: 'x' }
    expect(defaultLabel(repo(), action)).toBe('Component')
})
```

- [ ] **Step 2: Run — expect module-not-found failure**

Run: `npm test -- arch-default-label`
Expected: FAIL (`arch-default-label.js` does not exist).

- [ ] **Step 3: Implement the helper**

Create `services/arch-default-label.ts`:

```ts
import type { Repository } from '@pragmatic-lab/todl'
import { DropActionKind, type DropAction } from './arch-drop-resolver.js'

// Title-case the last dotted segment of an id: `m365_copilot` -> `M365 Copilot`.
export function humanize(id: string): string
{
    const seg = id.split('.').pop() ?? id
    return seg.split(/[_-]/).filter((w) => w.length > 0)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
}

// A sensible default for a dropped entity's required `label`: the dropped term's
// own label if present, else a humanized form of the term id (Reference drop) or
// the instantiated concept (Instance drop).
export function defaultLabel(repo: Repository, action: DropAction): string
{
    if (action.kind === DropActionKind.Reference && action.term !== undefined) {
        const lbl = repo.resolve(action.term)?.attrs.get('label')
        if (typeof lbl === 'string' && lbl.length > 0) return lbl
        return humanize(action.term)
    }
    return humanize(action.concept)
}
```

- [ ] **Step 4: Run the helper tests — expect pass**

Run: `npm test -- arch-default-label`
Expected: all PASS. If `resolve(...).attrs.get('label')` returns a non-string wrapper, adjust the `typeof lbl === 'string'` guard to read the scalar the node stores (inspect via a quick `console.log(repo().resolve('Kinds.m365_copilot')?.attrs.get('label'))`); the intent is "the term's label string if it has one."

- [ ] **Step 5: Wire it into the drop factory**

`services/arch-instance-drop-factory.ts`: add the import

```ts
import { defaultLabel } from './arch-default-label.js'
```

In `apply(...)`, right after `const entity = model.createInViewpoint(action.concept, vp)` (line ~51), before the `if (action.kind === DropActionKind.Reference …)` line, insert:

```ts
        const schema = model.repository().effectiveSchema(action.concept)
        if (schema.fields.some((f) => f.name === 'label'))
            model.setField(entity.id, 'label', defaultLabel(model.repository(), action))
```

This runs before `notifyChanged()` (so the rescan's `displayLabel` reads the new `label`) and before `save()` (so the persisted `.todl` carries it).

- [ ] **Step 6: Typecheck + run the drop-factory tests**

Run: `npm run typecheck`
Run: `npm test -- arch-instance-drop-factory`
Expected: typecheck PASS; the existing drop-factory tests PASS (setting a label field is additive — if a test asserts an exact emitted/entity shape that now includes `label`, update it to expect the label). If `effectiveSchema` or `setField` names differ from `arch-model.ts:70/116`, use the real method names.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/services/arch-default-label.ts src/renderer/src/modules/architecture-projects/services/tests/arch-default-label.test.ts src/renderer/src/modules/architecture-projects/services/arch-instance-drop-factory.ts
git commit -m "feat(sp5): dropped entities get a default required label

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Final gate + republish handoff

- [ ] **Step 1: Typecheck + full suite**

Run: `npm run typecheck`
Run: `npm test`
Expected: both green.

- [ ] **Step 2: Report + manual smoke handoff**

- Plexus on `@pragmatic-lab/todl@^0.24.0`; `arch-drop-resolver` union-aware; dropped entities carry a default `label`; `deriveClasses` and the arch emitter unchanged (delegated to TODL, bare + operator-free).
- **Manual smoke (needs Electron — `npm run dev`):**
  1. Open the tech-architecture meta-model project and **republish** it (regenerates any published/compiled artifact under 0.24.0).
  2. In an architecture project, drop a library term onto a diagram: confirm the candidate routing works (auto/chooser), the created entity shows a sensible label, and re-opening / saving the `.todl` shows **bare** refs with **no** `operator` (SP3/SP4 preserved on regeneration).
  3. Confirm no `operator`-reading code path errors (the SP4 risk).
- The arch editor loads the meta-model from `.todl` source via `ModelDraft.fromSources` (`architecture-model-service.ts:46`), so the bundled 0.24.0 compiles it directly; republish is for completeness of the published artifact.
- Do not push.

## Self-Review

- **Spec coverage:** Section 1 (bump + resolver union fix) → Task 1; Section 2 (default label helper + wiring) → Task 2; Section 3 verification (unit resolver, unit label, typecheck gate, full suite, manual republish) → Task 1 Steps 2/6, Task 2 Steps 4/6, Task 3; out-of-scope → unchanged (`deriveClasses`, emitter) noted in Task 3.
- **Placeholder scan:** all edits and both helper/test bodies are given in full; the two conditionals (scalar-wrapper guard; method-name drift) carry exact fallbacks with the file:line to check. No TBDs.
- **Type consistency:** `rel.targets.some((t) => accept.has(t))` matches 0.24.0's `RelationshipSchema.targets: NodeId[]`; `defaultLabel(repo, action)` / `humanize(id)` signatures identical across the helper, its tests, and the factory call; `DropActionKind.Reference`/`.Instance` and `action.term`/`action.concept` match `arch-drop-resolver.ts`; `model.setField` / `model.repository()` / `effectiveSchema` match `arch-model.ts`.

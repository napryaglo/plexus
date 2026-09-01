# MuralResource Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `MuralResource` annotation base carrying a generator-assigned, collision-aware `Key` (inherited by `icon`), and stamp that key into the compiled `model.json` during presentation generation.

**Architecture:** TODL contributes schema only — a `ResourceKey` primitive plus a `MuralResource` annotation that `icon` extends — so `projectAnnotations` surfaces a `Key`. All key logic (collision-aware assignment, stamping) lives Plexus-side in the presentation generator, operating on the in-memory `TodlDocument` that both the presentation and `BlobPackageStore.persist` share, so a single stamp reaches `model.json` with no re-serialization.

**Tech Stack:** TypeScript (ESM, strict), `@pragmatic-tech-ai/todl` (reflective typed graph, `node:test`), Plexus (Electron/electron-vite, Vitest), `@pragmatic-tech-ai/mural` compiler, Verdaccio local registry.

## Global Constraints

- Local registry is Verdaccio at `http://localhost:4873/`; TODL publishes there, Plexus consumes there.
- TODL is bumped and published (`npm version minor` → 0.18.0 → 0.19.0) **before** Plexus raises its floor to `^0.19.0`.
- TODL contributes **schema only** — no key-assignment logic, no emit change, no reflection change. Plexus owns all mural-key logic.
- `ResourceKey` regex is exactly `^[a-z][a-z0-9_]*$` (underscores — `slug`/`identifier` forbid them).
- Collision suffix scheme is `_2`, `_3`, … in sorted-path order (base key = `iconKey(stem)`).
- Every test file lives in a `tests/` subfolder next to the code it exercises.
- TODL tsconfig has `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`; `SourceFile = { uri: string; text: string }`.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Commit per task on the feature branch; do not push or merge until the finishing gate (user chooses).

**Key facts about the code being changed:**
- `iconKey(path)` (Plexus `presentation-generator.ts`) turns `resources/actor-internal.svg` → `mm_icon_actor_internal`: strips dir + ext, lowercases, non-`[a-z0-9]` runs → single `_`.
- `distinctIcons(doc)` returns the sorted union of every node's `attrs.icon` string and every `@icon` application node's `attrs.path` string.
- `iconKey` is recomputed at exactly three emit sites: `generatePresentationAssets` (generator, line ~62), `combinedSource` (publisher, line ~119, **shared** by the meta-model AND library publishers), and `iconElement` (scaffold, line ~149).
- Both project factories obtain `const doc = pkg.document` and pass that same object to their presentation publisher and to `new BlobPackageStore(...).persist(pkg)` (which serializes `pkg.document`). Mutating `doc` before persist reaches `model.json`.
- `JsonNode.attrs` is treated as `Record<string, unknown>` via cast in existing code (see `reflect.ts`).

---

### Task 1: TODL prelude — `ResourceKey` primitive + `MuralResource` annotation + `icon` inherits it

**Files:**
- Modify: `TODL/src/stdlib/prelude.todl`
- Modify: `TODL/src/stdlib/prelude.generated.ts` (regenerated, do not hand-edit)
- Modify: `TODL/src/stdlib/tests/prelude.test.ts`
- Create: `TODL/src/stdlib/tests/mural-resource.test.ts`

**Interfaces:**
- Consumes: nothing (schema authoring only).
- Produces: prelude now defines `ResourceKey` (primitive), `MuralResource` (annotation with optional `Key : ResourceKey`), and `icon : MuralResource` (adds inherited optional `Key`). Published as `@pragmatic-tech-ai/todl@0.19.0`.

- [ ] **Step 1: Add the failing schema test**

Create `TODL/src/stdlib/tests/mural-resource.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

// `icon : MuralResource { Key : ResourceKey? }` — the inherited `Key` param is a
// known param on `icon`, so annotating with it compiles clean.
test("a prelude icon annotation accepts the inherited Key param", () => {
  const src = `namespace app {
    concept thing { label : string; }
    concept widget : thing {
      annotate icon { path = "resources/w.svg"; Key = "mm_icon_w"; }
    }
  }`;
  assert.deepEqual(check([{ uri: "a.todl", text: src }]).diagnostics, []);
});

// Inheritance did not turn `icon` into an open bag: an unknown param is still rejected.
test("an unknown param on a prelude icon annotation is still annotation.unknown-param", () => {
  const src = `namespace app {
    concept thing { label : string; }
    concept widget : thing {
      annotate icon { path = "resources/w.svg"; bogus = "x"; }
    }
  }`;
  const codes = check([{ uri: "a.todl", text: src }]).diagnostics.map((d) => d.code);
  assert.ok(codes.includes(DiagnosticCode.AnnotationUnknownParam));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd TODL && npx tsx --conditions=development --test "src/stdlib/tests/mural-resource.test.ts"`
Expected: FAIL — `Key` is currently an unknown param on `icon`, so test 1 reports an `annotation.unknown-param` diagnostic (non-empty diagnostics array).

- [ ] **Step 3: Edit the prelude**

In `TODL/src/stdlib/prelude.todl`, add the `ResourceKey` primitive after the existing `label` primitive, and change the annotations block so `MuralResource` is declared and `icon` extends it. The annotations region becomes:

```todl
    // Standard primitives — stop redeclaring these in every meta-model.
    primitive identifier : string { regex = "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$"; }
    primitive slug       : string { regex = "^[a-z0-9]+(?:-[a-z0-9]+)*$"; }
    primitive label      : string { }
    primitive ResourceKey : string { regex = "^[a-z][a-z0-9_]*$"; }

    // Standard annotations.
    annotation MuralResource { Key : ResourceKey?; }
    annotation icon     : MuralResource { path : string?; }
    annotation toolbox  { visible : boolean?; }
    annotation instance { concept : identifier; via : identifier?; }
```

- [ ] **Step 4: Regenerate the generated prelude**

Run: `cd TODL && npm run gen:prelude`
Expected: `src/stdlib/prelude.generated.ts` updates so its `PRELUDE_SOURCE` string matches the new `prelude.todl` (keeps the "in sync" test green).

- [ ] **Step 5: Extend the existing prelude test for the two new ids**

In `TODL/src/stdlib/tests/prelude.test.ts`, add `"ResourceKey"` and `"MuralResource"` to the id list in BOTH the "carries the standard nodes" test and the "preludeNames lists" test. Each `for` loop's array becomes:

```ts
  for (const id of ["identifier", "slug", "label", "ResourceKey", "icon", "MuralResource", "toolbox", "instance", "element"]) {
```

- [ ] **Step 6: Run the stdlib tests to verify they pass**

Run: `cd TODL && npx tsx --conditions=development --test "src/stdlib/tests/*.test.ts"`
Expected: PASS — `mural-resource.test.ts` (both tests) and `prelude.test.ts` (all three) green.

- [ ] **Step 7: Run the full TODL suite + typecheck**

Run: `cd TODL && npx tsx --conditions=development --test "src/**/*.test.ts" && npm run typecheck`
Expected: PASS — the added optional param/annotation is backward compatible; no existing test regresses.

- [ ] **Step 8: Build, bump, publish to Verdaccio**

Run: `cd TODL && npm run build && npm version minor --no-git-tag-version && npm publish`
Expected: `@pragmatic-tech-ai/todl@0.19.0` published to `http://localhost:4873/`. (`npm publish` uses the repo's `.npmrc`/`publishConfig` registry; no auth prompt.)

- [ ] **Step 9: Commit**

```bash
cd TODL && git add src/stdlib/prelude.todl src/stdlib/prelude.generated.ts src/stdlib/tests/prelude.test.ts src/stdlib/tests/mural-resource.test.ts package.json
git commit -m "$(cat <<'EOF'
feat(prelude): add ResourceKey + MuralResource annotation base; icon inherits it

MuralResource carries an optional generator-assigned Key (ResourceKey, underscore
slug). icon extends it so projectAnnotations surfaces Key. Schema only — no
key-assignment logic in TODL. Published 0.19.0.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Plexus — collision-aware key authority (`assignResourceKeys` / `resourceKeyFor`)

**Files:**
- Modify: `Plexus/package.json` (raise `@pragmatic-tech-ai/todl` floor)
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/presentation-generator.ts`
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`

**Interfaces:**
- Consumes: `distinctIcons(doc): string[]` (sorted union of icon paths), `iconKey(path): string` (both existing in `presentation-generator.ts`).
- Produces:
  - `assignResourceKeys(doc: TodlDocument): Map<string, string>` — path → unique key, collision-aware, deterministic, sorted insertion order.
  - `resourceKeyFor(doc: TodlDocument, path: string): string` — single lookup.

- [ ] **Step 1: Raise the TODL dependency floor and install**

In `Plexus/package.json`, set `"@pragmatic-tech-ai/todl": "^0.19.0"` in `dependencies`. Then:

Run: `cd Plexus && npm install @pragmatic-tech-ai/todl@^0.19.0`
Expected: lockfile resolves `0.19.0` from Verdaccio.

- [ ] **Step 2: Sanity-run the Plexus suite against the new prelude**

Run: `cd Plexus && npx vitest run`
Expected: PASS — the new prelude (optional `Key`, new annotation) is backward compatible; no existing test regresses. If anything fails here, it is a prelude-ripple to investigate before continuing.

- [ ] **Step 3: Write the failing tests for key assignment**

Append to `Plexus/src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`. First add the import symbols to the existing top import line:

```ts
import { iconKey, humanize, ontologyEntities, classEntities, distinctIcons, generatePresentationAssets, isRasterIcon, resolveFacets, assignResourceKeys, resourceKeyFor } from '../presentation-generator.js'
```

Then add:

```ts
test('assignResourceKeys gives distinct stems their base iconKey, sorted', () => {
    const m = doc([
        { id: 'a', tier: 'Instance', typeOf: 'x', attrs: { icon: 'resources/comp.svg' } },
        { id: 'b', tier: 'Instance', typeOf: 'x', attrs: { icon: 'resources/actor.svg' } },
    ])
    expect([...assignResourceKeys(m)]).toEqual([
        ['resources/actor.svg', 'mm_icon_actor'],
        ['resources/comp.svg', 'mm_icon_comp'],
    ])
})

test('assignResourceKeys suffixes colliding stems _2, _3 in sorted-path order', () => {
    const m = doc([
        { id: 'a', tier: 'Instance', typeOf: 'x', attrs: { icon: 'a/az.svg' } },
        { id: 'b', tier: 'Instance', typeOf: 'x', attrs: { icon: 'b/az.svg' } },
        { id: 'c', tier: 'Instance', typeOf: 'x', attrs: { icon: 'c/az.svg' } },
        { id: 'd', tier: 'Instance', typeOf: 'x', attrs: { icon: 'x/other.svg' } },
    ])
    const keys = assignResourceKeys(m)
    expect(keys.get('a/az.svg')).toBe('mm_icon_az')
    expect(keys.get('b/az.svg')).toBe('mm_icon_az_2')
    expect(keys.get('c/az.svg')).toBe('mm_icon_az_3')
    expect(keys.get('x/other.svg')).toBe('mm_icon_other')
})

test('resourceKeyFor returns the assigned (possibly suffixed) key', () => {
    const m = doc([
        { id: 'a', tier: 'Instance', typeOf: 'x', attrs: { icon: 'a/az.svg' } },
        { id: 'b', tier: 'Instance', typeOf: 'x', attrs: { icon: 'b/az.svg' } },
    ])
    expect(resourceKeyFor(m, 'a/az.svg')).toBe('mm_icon_az')
    expect(resourceKeyFor(m, 'b/az.svg')).toBe('mm_icon_az_2')
})
```

- [ ] **Step 4: Run to verify they fail**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`
Expected: FAIL — `assignResourceKeys`/`resourceKeyFor` are not exported yet (import error / undefined).

- [ ] **Step 5: Implement the two functions**

In `Plexus/src/renderer/src/modules/meta-model/services/presentation-generator.ts`, add after the `iconKey` function:

```ts
// Assign every distinct icon path a UNIQUE mural resource key. The base key is
// iconKey(path); when two paths share a stem (e.g. a/az.svg, b/az.svg) the second
// and later collisions are suffixed _2, _3, … in sorted-path order. Deterministic
// and a pure function of the doc's icon paths (stamping adds attrs, never paths),
// so every call-site computes the identical map with no threading. Map insertion
// order follows distinctIcons (sorted), so iterating it is sorted.
export function assignResourceKeys(doc: TodlDocument): Map<string, string>
{
    const out = new Map<string, string>()
    const used = new Map<string, number>()
    for (const path of distinctIcons(doc)) {
        const base = iconKey(path)
        const n = used.get(base) ?? 0
        used.set(base, n + 1)
        out.set(path, n === 0 ? base : `${base}_${n + 1}`)
    }
    return out
}

// The unique resource key for one icon path in this doc. Falls back to the base
// iconKey for a path not among the doc's icons (should not happen in practice).
export function resourceKeyFor(doc: TodlDocument, path: string): string
{
    return assignResourceKeys(doc).get(path) ?? iconKey(path)
}
```

- [ ] **Step 6: Run to verify they pass**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`
Expected: PASS — the three new tests green, existing generator tests unchanged.

- [ ] **Step 7: Commit**

```bash
cd Plexus && git add package.json package-lock.json src/renderer/src/modules/meta-model/services/presentation-generator.ts src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts
git commit -m "$(cat <<'EOF'
feat(presentation): collision-aware resource-key authority

assignResourceKeys/resourceKeyFor assign a UNIQUE key per distinct icon path,
suffixing colliding stems _2/_3 in sorted order — fixing the silent overwrite of
same-stem icons. Bump @pragmatic-tech-ai/todl ^0.19.0.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Plexus — route the three emit sites through the assigned key

**Files:**
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/presentation-generator.ts` (`generatePresentationAssets`)
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/presentation-publisher.ts` (`combinedSource`)
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/presentation-scaffold.ts` (`iconElement`, `templateBlock`)
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`

**Interfaces:**
- Consumes: `assignResourceKeys(doc)`, `resourceKeyFor(doc, path)` from Task 2.
- Produces: all three emit sites now derive resource keys from the shared assignment; no site recomputes `iconKey` independently. `iconElement` signature becomes `iconElement(doc: TodlDocument, icon: string): string`.

- [ ] **Step 1: Write the failing collision-output test**

Append to `Plexus/src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`:

```ts
test('generatePresentationAssets suffixes colliding icon stems in its includes', () => {
    const m = doc([
        { id: 'a', tier: 'Instance', typeOf: 'x', attrs: { icon: 'a/az.svg' } },
        { id: 'b', tier: 'Instance', typeOf: 'x', attrs: { icon: 'b/az.svg' } },
    ])
    const out = generatePresentationAssets(m, 'MetaModelPresentation')
    expect(out).toContain('include "a/az.svg" as mm_icon_az')
    expect(out).toContain('include "b/az.svg" as mm_icon_az_2')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts -t 'suffixes colliding icon stems in its includes'`
Expected: FAIL — current `generatePresentationAssets` recomputes `iconKey`, so both emit `as mm_icon_az` and the `_2` assertion fails.

- [ ] **Step 3: Route `generatePresentationAssets` through the key map**

In `presentation-generator.ts`, change the `includes` line inside `generatePresentationAssets` from the `distinctIcons(doc).map(... iconKey(p))` form to iterate the assigned map (sorted insertion order):

```ts
    const includes = [...assignResourceKeys(doc)].map(([p, k]) => `    include "${p}" as ${k}`)
```

- [ ] **Step 4: Route `combinedSource` through the key map**

In `presentation-publisher.ts`, change the `includes` line inside `combinedSource` the same way, and drop the now-unused `iconKey` from its import (keep `distinctIcons` if still referenced elsewhere in the file; it is used by `publishPresentation`):

```ts
import { distinctIcons, assignResourceKeys } from './presentation-generator.js'
```
```ts
    const includes = [...assignResourceKeys(doc)].map(([p, k]) => `    include "${p}" as ${k}`)
```

- [ ] **Step 5: Route the scaffold `iconElement` through `resourceKeyFor`**

In `presentation-scaffold.ts`:
- Change the import to bring in `resourceKeyFor` and drop `iconKey`:
  ```ts
  import { ontologyEntities, classEntities, resolveFacets, resourceKeyFor, isRasterIcon } from './presentation-generator.js'
  ```
- Change `iconElement` to take `doc` and use `resourceKeyFor`:
  ```ts
  function iconElement(doc: TodlDocument, icon: string): string
  {
      const key = resourceKeyFor(doc, icon)
      return isRasterIcon(icon)
          ? `Border [ Width = 16, Height = 16, Margin = (0,0,6,0), Background = @${key} ]`
          : `Shape [ Geometry = @${key}, Fill = @OnSurface, Width = 16, Height = 16, Margin = (0,0,6,0) ]`
  }
  ```
- Update its single caller in `templateBlock` (which already has `doc`) from `${iconElement(icon)}` to `${iconElement(doc, icon)}`.

- [ ] **Step 6: Run the targeted + full presentation tests**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/meta-model/services/tests/`
Expected: PASS — the new collision test passes; existing generator/publisher/scaffold tests stay green (no-collision output is byte-identical to before, since single-stem paths get their base key).

- [ ] **Step 7: Typecheck the renderer**

Run: `cd Plexus && npm run typecheck`
Expected: no type errors. (Vitest/esbuild strips types at run time and does NOT type-check, so this `tsc` pass is what catches the `iconElement` signature change; `typecheck` runs both `tsconfig.node.json` and `tsconfig.web.json`.)

- [ ] **Step 8: Commit**

```bash
cd Plexus && git add src/renderer/src/modules/meta-model/services/presentation-generator.ts src/renderer/src/modules/meta-model/services/presentation-publisher.ts src/renderer/src/modules/meta-model/services/presentation-scaffold.ts src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts
git commit -m "$(cat <<'EOF'
feat(presentation): emit assigned resource keys at all sites

generatePresentationAssets, combinedSource (shared by meta-model + library
publishers) and the scaffold iconElement now derive keys from the single
collision-aware assignment instead of recomputing iconKey independently.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Plexus — stamp `Key` onto the compiled document in both factories

**Files:**
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/presentation-generator.ts` (`stampResourceKeys`)
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts`
- Modify: `Plexus/src/renderer/src/modules/library/services/library-project-factory.ts`

**Interfaces:**
- Consumes: `assignResourceKeys(doc)`, `resourceKeyFor(doc, path)` from Task 2.
- Produces: `stampResourceKeys(doc: TodlDocument): void` — mutates each `@icon` application node (`typeOf === 'icon'` with a string `path`) to carry `attrs.Key`. Called in both factories immediately after `const doc = pkg.document`, before `publishPresentation`/`persist`.

- [ ] **Step 1: Write the failing stamp test**

Append to `Plexus/src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts` (add `stampResourceKeys` to the import line from Task 2/3):

```ts
test('stampResourceKeys writes the assigned Key onto @icon application nodes only', () => {
    const m = {
        nodes: [
            { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} },
            { id: 'actor@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'a/az.svg' } },
            { id: 'comp@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'b/az.svg' } },
            { id: 'raw', tier: 'Instance', typeOf: 'x', attrs: { icon: 'c/other.svg' } }, // raw attr, not an app
        ],
        edges: [],
    } as unknown as TodlDocument
    stampResourceKeys(m)
    const byId = (id: string) => m.nodes.find((n) => n.id === id)!.attrs as Record<string, unknown>
    expect(byId('actor@icon')['Key']).toBe('mm_icon_az')
    expect(byId('comp@icon')['Key']).toBe('mm_icon_az_2') // collision-aware, shares the assignment
    expect(byId('raw')['Key']).toBeUndefined()            // raw attrs.icon node is not stamped
    expect(byId('actor')['Key']).toBeUndefined()          // non-icon node untouched
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts -t 'stampResourceKeys'`
Expected: FAIL — `stampResourceKeys` not exported.

- [ ] **Step 3: Implement `stampResourceKeys`**

In `presentation-generator.ts`, add after `resourceKeyFor`:

```ts
// Write the assigned resource Key onto each @icon application node in place — the
// "write-back" that lands in the compiled artifact (model.json). Only annotation
// application nodes (typeOf 'icon' carrying a `path`) are stamped; a raw attrs.icon
// on a concept/instance is not an application node and is left untouched. Called
// over pkg.document before persist, so the stamped Key reaches model.json.
export function stampResourceKeys(doc: TodlDocument): void
{
    const keys = assignResourceKeys(doc)
    for (const n of doc.nodes) {
        if (n.typeOf !== 'icon') continue
        const attrs = n.attrs as Record<string, unknown>
        const path = attrs['path']
        if (typeof path !== 'string' || path.length === 0) continue
        const key = keys.get(path)
        if (key !== undefined) attrs['Key'] = key
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts -t 'stampResourceKeys'`
Expected: PASS.

- [ ] **Step 5: Wire the stamp into the meta-model factory**

In `meta-model-project-factory.ts`:
- Add `stampResourceKeys` to the import from `./presentation-generator.js` (line ~21 currently imports `generatePresentationAssets`):
  ```ts
  import { generatePresentationAssets, stampResourceKeys } from './presentation-generator.js'
  ```
- Immediately after `const doc = pkg.document` (line ~127), before the `publishPresentation` call, add:
  ```ts
  // Assign + write mural resource keys onto @icon apps before either the
  // presentation or model.json is written — pkg.document is the same object
  // BlobPackageStore persists, so the Key reaches model.json.
  stampResourceKeys(doc)
  ```

- [ ] **Step 6: Wire the stamp into the library factory**

In `library-project-factory.ts`:
- Add `stampResourceKeys` to the existing import from `../../meta-model/services/presentation-generator.js` (line ~23):
  ```ts
  import { generatePresentationAssets, stampResourceKeys } from '../../meta-model/services/presentation-generator.js'
  ```
- Immediately after `const doc = pkg.document` (line ~133), add:
  ```ts
  stampResourceKeys(doc)
  ```

- [ ] **Step 7: Run the full Plexus suite**

Run: `cd Plexus && npx vitest run`
Expected: PASS — stamp unit test green; both factory publish tests (`meta-model-project-factory.test.ts`, `library-project-factory.test.ts`) stay green (stamping only adds an optional attr to icon apps; existing assertions unaffected).

- [ ] **Step 8: Commit**

```bash
cd Plexus && git add src/renderer/src/modules/meta-model/services/presentation-generator.ts src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts src/renderer/src/modules/library/services/library-project-factory.ts
git commit -m "$(cat <<'EOF'
feat(presentation): stamp resource Key onto @icon apps in model.json

stampResourceKeys writes the assigned Key onto each @icon application node of the
compiled document; both factories call it over pkg.document before persist, so the
key is written back into model.json (source untouched).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Notes for the executor

- **Cross-repo ordering is load-bearing:** Task 1 must publish `@pragmatic-tech-ai/todl@0.19.0` to Verdaccio before Task 2's `npm install` can resolve it. Do not start Task 2 until Task 1 Step 8 succeeds.
- **No `.mu` files change** — presentation dictionaries are generated text, not repo `.mu` sources, so `npm run compile:mu` is not needed.
- **Regression is the safety net for the emit rerouting:** the existing generator/publisher/scaffold tests assert exact single-stem output (`mm_icon_actor`, etc.); Task 3 must leave those byte-identical. If any changes, the rerouting diverged from the base key and is a bug.
- **Deferred (documented in the spec, not this plan):** `brush`/`geometry`/`embedded` subtypes of `MuralResource`; `deriveClasses`/`PublishedClass` staying path-based; the write-once-stub staleness tail; author-facing validation of the generator-owned `Key`.
```

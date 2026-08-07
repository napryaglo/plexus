# MuralResource Keys Implementation Plan (reconciled — Option B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `MuralResource` annotation base carrying a generator-assigned, collision-aware `key` (inherited by the well-known `icon` annotation), and stamp that key into the compiled `model.json` during presentation generation — while restoring the well-known annotations (`icon`/`label`/`toolbox`/`instance`) to lowercase, which SP1's C-like recaser wrongly PascalCased in the prelude.

**Architecture:** TODL contributes prelude schema only — revert the well-known annotations to lowercase, add `annotation label`, add a `ResourceKey` primitive and a `MuralResource` annotation base that `icon` extends, so `projectAnnotations` surfaces a `key`. All key logic (collision-aware assignment, stamping) lives Plexus-side in the presentation generator, operating on the in-memory `TodlDocument` that both presentation and `BlobPackageStore.persist` share, so a single stamp reaches `model.json`.

**Tech Stack:** TypeScript (ESM, strict), `@pragmatic-lab/todl` (reflective typed graph, `node:test`), Plexus (Electron/electron-vite, Vitest), `@pragmatic-lab/mural` compiler, Verdaccio local registry.

## Global Constraints

- Local registry is Verdaccio at `http://localhost:4873/`; TODL publishes there, Plexus consumes there.
- **Well-known annotations are lowercase** (`icon`, `label`, `toolbox`, `instance`) — a deliberate exception to types-are-PascalCase. User-defined annotations remain PascalCase. This is why the fix reverts the *prelude*, not the consumers (consumers already read lowercase and are correct).
- TODL is bumped and published (`npm version minor` → 0.19.0 → **0.20.0**) **before** Plexus raises its floor to `^0.20.0`. `0.19.0` is already taken (the C-like release).
- TODL contributes **schema only** — no key-assignment logic, no emit change, no reflection change. Plexus owns all mural-key logic.
- `ResourceKey` regex is exactly `^[a-z][a-z0-9_]*$` (underscores — `Slug`/`Identifier` forbid them).
- `MuralResource` base is PascalCase; its param is `key` (camelCase); `icon : MuralResource`.
- Collision suffix scheme is `_2`, `_3`, … in sorted-path order (base key = `iconKey(stem)`).
- Every test file lives in a `tests/` subfolder next to the code it exercises.
- TODL tsconfig has `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`; `SourceFile = { uri: string; text: string }`.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Commit per task on branch `feat/mural-resource-keys-v2`; do not push or merge until the finishing gate (user chooses).

**Key facts about the code being changed:**
- Current `TODL/src/stdlib/prelude.todl` has (post-SP1, PascalCased) `annotation Icon`/`Toolbox`/`Instance`; `primitive Identifier`/`Slug`/`Label`; `concept Element`.
- `iconKey(path)` (Plexus `presentation-generator.ts`) turns `resources/actor-internal.svg` → `mm_icon_actor_internal`: strips dir + ext, lowercases, non-`[a-z0-9]` runs → single `_`.
- `distinctIcons(doc)` returns the sorted union of every node's `attrs['icon']` string and every `typeOf === 'icon'` application node's `attrs['path']` string.
- `iconKey` is recomputed at three emit sites: `generatePresentationAssets` (generator, `presentation-generator.ts`), `combinedSource` (publisher, `presentation-publisher.ts`, **shared** by the meta-model AND library publishers), and `iconElement` (`presentation-scaffold.ts`).
- Both project factories obtain `const doc = pkg.document` and pass that same object to their presentation publisher and to `new BlobPackageStore(...).persist(pkg)` (which serializes `pkg.document`). Mutating `doc` before persist reaches `model.json`.
- `JsonNode.attrs` is treated as `Record<string, unknown>` via cast in existing code.

---

### Task 1: TODL prelude — restore lowercase well-known annotations + `ResourceKey`/`MuralResource`; publish 0.20.0

**Files:**
- Modify: `TODL/src/stdlib/prelude.todl`
- Modify: `TODL/src/stdlib/prelude.generated.ts` (regenerated, do not hand-edit)
- Modify: `TODL/src/stdlib/tests/prelude.test.ts`
- Create: `TODL/src/stdlib/tests/mural-resource.test.ts`

**Interfaces:**
- Consumes: nothing (schema authoring only).
- Produces: prelude with lowercase `icon`/`label`/`toolbox`/`instance`, a `ResourceKey` primitive, a `MuralResource` annotation (optional `key : ResourceKey`), and `icon : MuralResource` (adds inherited optional `key`). Published as `@pragmatic-lab/todl@0.20.0`.

- [ ] **Step 1: Add the failing schema test**

Create `TODL/src/stdlib/tests/mural-resource.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../index.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

// icon : MuralResource { key : ResourceKey? } — the inherited `key` param is a
// known param on `icon`, so annotating with it compiles clean.
test("a prelude icon annotation accepts the inherited key param", () => {
  const src = `namespace app {
    concept Thing { label : string; }
    concept Widget : Thing {
      annotate icon { path = "resources/w.svg"; key = "mm_icon_w"; }
    }
  }`;
  assert.deepEqual(check([{ uri: "a.todl", text: src }]).diagnostics, []);
});

// Inheritance did not turn `icon` into an open bag: an unknown param is still rejected.
test("an unknown param on a prelude icon annotation is still annotation.unknown-param", () => {
  const src = `namespace app {
    concept Thing { label : string; }
    concept Widget : Thing {
      annotate icon { path = "resources/w.svg"; bogus = "x"; }
    }
  }`;
  const codes = check([{ uri: "a.todl", text: src }]).diagnostics.map((d) => d.code);
  assert.ok(codes.includes(DiagnosticCode.AnnotationUnknownParam));
});

// The well-known label annotation now exists (lowercase; distinct from primitive Label).
test("a prelude label annotation accepts a text param", () => {
  const src = `namespace app {
    concept Thing { annotate label { text = "A Thing"; } label : string; }
  }`;
  assert.deepEqual(check([{ uri: "a.todl", text: src }]).diagnostics, []);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd TODL && npx tsx --conditions=development --test "src/stdlib/tests/mural-resource.test.ts"`
Expected: FAIL — `annotate icon` is currently `reference.undefined` (prelude annotation is `Icon`), `key` is unknown, and there is no `label` annotation.

- [ ] **Step 3: Edit the prelude**

In `TODL/src/stdlib/prelude.todl`, add the `ResourceKey` primitive after `Label`, and rewrite the annotations block so the well-known annotations are lowercase, `label` is added, and `MuralResource` is declared with `icon` extending it. The region becomes:

```todl
    // Standard primitives — stop redeclaring these in every meta-model.
    primitive Identifier : string { regex = "^[A-Za-z_][A-Za-z0-9_]*$"; }
    primitive Slug       : string { regex = "^[a-z0-9]+(?:-[a-z0-9]+)*$"; }
    primitive Label      : string { }
    primitive ResourceKey : string { regex = "^[a-z][a-z0-9_]*$"; }

    // Standard annotations. The four well-known keys tools switch on
    // (icon/label/toolbox/instance) are lowercase by deliberate exception.
    annotation MuralResource { key : ResourceKey?; }
    annotation icon     : MuralResource { path : string?; }
    annotation label    { text : string?; }
    annotation toolbox  { visible : boolean?; }
    annotation instance { concept : Identifier; via : Identifier?; }
```

- [ ] **Step 4: Regenerate the generated prelude**

Run: `cd TODL && npm run gen:prelude`
Expected: `src/stdlib/prelude.generated.ts` updates so its `PRELUDE_SOURCE` matches the new `prelude.todl`.

- [ ] **Step 5: Update the prelude id-list test**

In `TODL/src/stdlib/tests/prelude.test.ts`, both `for (const id of [...])` loops currently read
`["Identifier", "Slug", "Label", "Icon", "Toolbox", "Instance", "Element"]`. Change BOTH to:

```ts
  for (const id of ["Identifier", "Slug", "Label", "ResourceKey", "MuralResource", "icon", "label", "toolbox", "instance", "Element"]) {
```

- [ ] **Step 6: Run the stdlib tests**

Run: `cd TODL && npx tsx --conditions=development --test "src/stdlib/tests/*.test.ts"`
Expected: PASS — `mural-resource.test.ts` (all three) and `prelude.test.ts` green.

- [ ] **Step 7: Run the full TODL suite + typecheck**

Run: `cd TODL && npx tsx --conditions=development --test "src/**/*.test.ts" && npm run typecheck`
Expected: PASS. Note: the reflect / annotation tests that hand-build `typeOf: "icon"` graphs now match the lowercase prelude again. If any test fails because it was authored against a PascalCased `Icon`/`Toolbox`/`Instance`, fix that test to lowercase — that is the SP1 over-eager-casing being undone.

- [ ] **Step 8: Build, bump, publish to Verdaccio**

Run: `cd TODL && npm run build && npm version minor --no-git-tag-version && npm publish`
Expected: `@pragmatic-lab/todl@0.20.0` published to `http://localhost:4873/`.

- [ ] **Step 9: Commit**

```bash
cd TODL && git add src/stdlib/prelude.todl src/stdlib/prelude.generated.ts src/stdlib/tests/prelude.test.ts src/stdlib/tests/mural-resource.test.ts package.json package-lock.json
git commit -m "$(cat <<'EOF'
feat(prelude): MuralResource base + ResourceKey; restore lowercase well-known annotations

Well-known annotations (icon/label/toolbox/instance) are a lowercase exception
to types-are-PascalCase; SP1's recaser wrongly PascalCased them, breaking every
consumer. Revert them, add `annotation label`, add `ResourceKey` primitive +
`MuralResource { key }` base that `icon` extends. Schema only. Published 0.20.0.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Plexus — raise floor to ^0.20.0; revert scaffold-doc well-known mentions to lowercase

**Files:**
- Modify: `Plexus/package.json` + `package-lock.json`
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/scaffold/todl-manual.md`
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/scaffold/meta-model-guide.md`
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/scaffold/claude-root.md`

**Interfaces:**
- Consumes: `@pragmatic-lab/todl@0.20.0` from Verdaccio (Task 1).
- Produces: Plexus on the new floor; scaffold docs teach the lowercase well-known annotations.

- [ ] **Step 1: Raise the floor and install**

In `Plexus/package.json` set `"@pragmatic-lab/todl": "^0.20.0"`. Then run: `cd Plexus && npm install`
Expected: lockfile resolves `0.20.0` from Verdaccio.

- [ ] **Step 2: Sanity-run the Plexus suite against the new prelude**

Run: `cd Plexus && npx vitest run`
Expected: PASS — the lowercase-again well-known annotations match the consumers/fixtures; the new optional `key`/`MuralResource`/`ResourceKey` are backward compatible. Any failure here is a prelude-ripple to investigate before continuing.

- [ ] **Step 3: Revert the well-known-annotation mentions in the three scaffold docs**

In `todl-manual.md`, `meta-model-guide.md`, and `claude-root.md`, change the **well-known** annotation names back to lowercase — `annotation Icon` → `annotation icon`, `annotate Icon` → `annotate icon`, `annotate Label` → `annotate label`, `annotate Toolbox` → `annotate toolbox`, and prose like "`Icon` and `Label` are well-known" → "`icon` and `label` are well-known". **Leave user-defined-annotation examples PascalCase** (`annotation Category`, `annotation Author`, `annotate Category`, `annotate Author`, `Owner`). In `todl-manual.md` §2/§6, add a one-line note: "the four well-known annotations `icon`/`label`/`toolbox`/`instance` are lowercase by exception; all other annotations are PascalCase types."

- [ ] **Step 4: Verify docs have no stray PascalCase well-known mentions**

Run (from Plexus): `git grep -nE "annotat[e|ion] (Icon|Label|Toolbox|Instance)\b" -- 'src/renderer/src/modules/meta-model/services/scaffold/'`
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
cd Plexus && git add package.json package-lock.json src/renderer/src/modules/meta-model/services/scaffold/todl-manual.md src/renderer/src/modules/meta-model/services/scaffold/meta-model-guide.md src/renderer/src/modules/meta-model/services/scaffold/claude-root.md
git commit -m "$(cat <<'EOF'
chore(deps): bump @pragmatic-lab/todl ^0.20.0; docs: lowercase well-known annotations

Well-known annotations icon/label/toolbox are lowercase; revert the SP2 doc
mentions that PascalCased them (user-defined annotation examples stay Pascal).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Plexus — collision-aware key authority (`assignResourceKeys` / `resourceKeyFor`)

**Files:**
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/presentation-generator.ts`
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`

**Interfaces:**
- Consumes: `distinctIcons(doc): string[]`, `iconKey(path): string` (existing in `presentation-generator.ts`).
- Produces:
  - `assignResourceKeys(doc: TodlDocument): Map<string, string>` — path → unique key, collision-aware, deterministic, sorted insertion order.
  - `resourceKeyFor(doc: TodlDocument, path: string): string` — single lookup.

- [ ] **Step 1: Write the failing tests for key assignment**

Add `assignResourceKeys, resourceKeyFor` to the existing top import from `../presentation-generator.js`, then append to `presentation-generator.test.ts`:

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

- [ ] **Step 2: Run to verify they fail**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`
Expected: FAIL — `assignResourceKeys`/`resourceKeyFor` not exported.

- [ ] **Step 3: Implement the two functions**

In `presentation-generator.ts`, add after `iconKey`:

```ts
// Assign every distinct icon path a UNIQUE mural resource key. The base key is
// iconKey(path); when two paths share a stem (a/az.svg, b/az.svg) the second and
// later collisions are suffixed _2, _3, … in sorted-path order. A pure function
// of the doc's icon paths (stamping adds attrs, never paths), so every call-site
// computes the identical map with no threading. Map insertion order follows
// distinctIcons (sorted), so iterating it is sorted.
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

- [ ] **Step 4: Run to verify they pass**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`
Expected: PASS — three new tests green, existing generator tests unchanged.

- [ ] **Step 5: Commit**

```bash
cd Plexus && git add src/renderer/src/modules/meta-model/services/presentation-generator.ts src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts
git commit -m "$(cat <<'EOF'
feat(presentation): collision-aware resource-key authority

assignResourceKeys/resourceKeyFor assign a UNIQUE key per distinct icon path,
suffixing colliding stems _2/_3 in sorted order — fixing the silent overwrite of
same-stem icons.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Plexus — route the three emit sites through the assigned key

**Files:**
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/presentation-generator.ts` (`generatePresentationAssets`)
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/presentation-publisher.ts` (`combinedSource`)
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/presentation-scaffold.ts` (`iconElement`, `templateBlock`)
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`

**Interfaces:**
- Consumes: `assignResourceKeys(doc)`, `resourceKeyFor(doc, path)` (Task 3).
- Produces: all three emit sites derive keys from the shared assignment. `iconElement` signature becomes `iconElement(doc: TodlDocument, icon: string): string`.

- [ ] **Step 1: Write the failing collision-output test**

Append to `presentation-generator.test.ts`:

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
(Add `generatePresentationAssets` to the import if not already present.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts -t 'suffixes colliding icon stems in its includes'`
Expected: FAIL — current `generatePresentationAssets` recomputes `iconKey`, so both emit `as mm_icon_az`.

- [ ] **Step 3: Route `generatePresentationAssets` through the key map**

In `presentation-generator.ts`, change the `includes` line inside `generatePresentationAssets` from the `distinctIcons(doc).map((p) => ... iconKey(p))` form to:

```ts
    const includes = [...assignResourceKeys(doc)].map(([p, k]) => `    include "${p}" as ${k}`)
```

- [ ] **Step 4: Route `combinedSource` through the key map**

In `presentation-publisher.ts`, change the `includes` line inside `combinedSource` the same way, and update the import to bring in `assignResourceKeys` (keep `distinctIcons` if referenced elsewhere in the file):

```ts
import { distinctIcons, assignResourceKeys } from './presentation-generator.js'
```
```ts
    const includes = [...assignResourceKeys(doc)].map(([p, k]) => `    include "${p}" as ${k}`)
```

- [ ] **Step 5: Route the scaffold `iconElement` through `resourceKeyFor`**

In `presentation-scaffold.ts`:
- Import `resourceKeyFor` (drop `iconKey` if now unused):
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
  (Match the exact existing `iconElement` body; only the key source changes from `iconKey(icon)` to `resourceKeyFor(doc, icon)`.)
- Update its caller in `templateBlock` (which already has `doc`) from `iconElement(icon)` to `iconElement(doc, icon)`.

- [ ] **Step 6: Run the targeted + full presentation tests**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/meta-model/services/tests/`
Expected: PASS — the new collision test passes; existing generator/publisher/scaffold tests stay green (no-collision output is byte-identical, since single-stem paths get their base key).

- [ ] **Step 7: Typecheck the renderer**

Run: `cd Plexus && npm run typecheck`
Expected: no type errors (catches the `iconElement` signature change).

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

### Task 5: Plexus — stamp `key` onto the compiled document in both factories

**Files:**
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/presentation-generator.ts` (`stampResourceKeys`)
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts`
- Modify: `Plexus/src/renderer/src/modules/library/services/library-project-factory.ts`

**Interfaces:**
- Consumes: `assignResourceKeys(doc)` (Task 3).
- Produces: `stampResourceKeys(doc: TodlDocument): void` — mutates each `icon` application node (`typeOf === 'icon'` with a string `path`) to carry `attrs['key']`. Called in both factories immediately after `const doc = pkg.document`, before `publishPresentation`/`persist`.

- [ ] **Step 1: Write the failing stamp test**

Append to `presentation-generator.test.ts` (add `stampResourceKeys` to the import):

```ts
test('stampResourceKeys writes the assigned key onto icon application nodes only', () => {
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
    expect(byId('actor@icon')['key']).toBe('mm_icon_az')
    expect(byId('comp@icon')['key']).toBe('mm_icon_az_2') // collision-aware, shares the assignment
    expect(byId('raw')['key']).toBeUndefined()            // raw attrs.icon node is not stamped
    expect(byId('actor')['key']).toBeUndefined()          // non-icon node untouched
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts -t 'stampResourceKeys'`
Expected: FAIL — `stampResourceKeys` not exported.

- [ ] **Step 3: Implement `stampResourceKeys`**

In `presentation-generator.ts`, add after `resourceKeyFor`:

```ts
// Write the assigned resource key onto each icon application node in place — the
// "write-back" that lands in the compiled artifact (model.json). Only annotation
// application nodes (typeOf 'icon' carrying a `path`) are stamped; a raw attrs.icon
// on a concept/instance is not an application node and is left untouched. Called
// over pkg.document before persist, so the stamped key reaches model.json.
export function stampResourceKeys(doc: TodlDocument): void
{
    const keys = assignResourceKeys(doc)
    for (const n of doc.nodes) {
        if (n.typeOf !== 'icon') continue
        const attrs = n.attrs as Record<string, unknown>
        const path = attrs['path']
        if (typeof path !== 'string' || path.length === 0) continue
        const key = keys.get(path)
        if (key !== undefined) attrs['key'] = key
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts -t 'stampResourceKeys'`
Expected: PASS.

- [ ] **Step 5: Wire the stamp into the meta-model factory**

In `meta-model-project-factory.ts`:
- Add `stampResourceKeys` to the import from `./presentation-generator.js` (currently imports `generatePresentationAssets`):
  ```ts
  import { generatePresentationAssets, stampResourceKeys } from './presentation-generator.js'
  ```
- Immediately after `const doc = pkg.document`, before the `publishPresentation` call, add:
  ```ts
  // Assign + write mural resource keys onto icon apps before either the
  // presentation or model.json is written — pkg.document is the same object
  // BlobPackageStore persists, so the key reaches model.json.
  stampResourceKeys(doc)
  ```

- [ ] **Step 6: Wire the stamp into the library factory**

In `library-project-factory.ts`:
- Add `stampResourceKeys` to the existing import from `../../meta-model/services/presentation-generator.js`:
  ```ts
  import { generatePresentationAssets, stampResourceKeys } from '../../meta-model/services/presentation-generator.js'
  ```
- Immediately after `const doc = pkg.document`, add:
  ```ts
  stampResourceKeys(doc)
  ```

- [ ] **Step 7: Run the full Plexus suite + typecheck**

Run: `cd Plexus && npx vitest run && npm run typecheck`
Expected: PASS — stamp unit test green; both factory publish tests stay green (stamping only adds an optional `key` attr to icon apps; existing assertions unaffected).

- [ ] **Step 8: Commit**

```bash
cd Plexus && git add src/renderer/src/modules/meta-model/services/presentation-generator.ts src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts src/renderer/src/modules/library/services/library-project-factory.ts
git commit -m "$(cat <<'EOF'
feat(presentation): stamp resource key onto icon apps in model.json

stampResourceKeys writes the assigned key onto each icon application node of the
compiled document; both factories call it over pkg.document before persist, so the
key is written back into model.json (source untouched).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Notes for the executor

- **Cross-repo ordering is load-bearing:** Task 1 must publish `@pragmatic-lab/todl@0.20.0` to Verdaccio before Task 2's `npm install` can resolve it. Do not start Task 2 until Task 1 Step 8 succeeds.
- **The fix reverts the prelude, not the consumers.** Plexus's `typeOf === 'icon'` / `annotations['icon']` / toolbox `['toolbox']` reads and TODL's `reflect.js` `.icon` were correct; they need no change. The bug was SP1 PascalCasing the prelude annotation names.
- **No `.mu` files change** — presentation dictionaries are generated text, not repo `.mu` sources, so `npm run compile:mu` is not needed.
- **Regression is the safety net for the emit rerouting:** the existing generator/publisher/scaffold tests assert exact single-stem output (`mm_icon_actor`, etc.); Task 4 must leave those byte-identical.
- **Deferred (documented in the spec, not this plan):** `brush`/`geometry`/`embedded` subtypes of `MuralResource`; `deriveClasses`/`PublishedClass` staying path-based; the write-once-stub staleness tail; author-facing validation of the generator-owned `key`.

## Self-Review

- **Spec coverage:** prelude revert + MuralResource/ResourceKey/label (Task 1), floor + doc revert (Task 2), key authority (Task 3), emit rerouting (Task 4), stamping (Task 5). The label vestigial-branch and deferred subtypes are out of scope per spec.
- **No placeholders:** every code step carries concrete code; every run step an exact command + expected result.
- **Type consistency:** `assignResourceKeys`/`resourceKeyFor`/`stampResourceKeys` signatures are stable across tasks; `iconElement(doc, icon)` signature change is applied at its sole caller; param is `key` and app-node check is `typeOf === 'icon'` throughout.

# Plexus C-like Identifier Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Plexus onto TODL's C-like identifier grammar and lift its `@pragmatic-tech-ai/todl` floor to `^0.19.0`.

**Architecture:** Plexus's TODL corpus lives in `.ts` test fixtures (backtick strings) plus two shipped scaffold docs; no product code hard-codes kebab lookups. Migration = one runtime emitter fix (`freshId`), tool-assisted recasing of the fixture corpus with a suite-driven assertion grind, a scaffold-doc rewrite, and the floor bump.

**Tech Stack:** TypeScript, electron-vite, Vitest, `@pragmatic-tech-ai/todl`.

## Global Constraints

- `@pragmatic-tech-ai/todl` floor is `^0.19.0` (published to Verdaccio `http://localhost:4873/`).
- Convention: user-defined TYPES → PascalCase (concept, taxonomy, primitive, annotation, enum, class, `term`); MEMBERS → camelCase (fields, relationship names, annotation params); keywords and namespaces → lowercase.
- Every test file lives in a `tests/` subfolder next to its source.
- Use real enums, never string-literal unions.
- No relative `../src` imports into the framework packages.
- Commit only when the user asks; work on branch `feat/c-like-plexus`.
- Test command: `npm test` (`vitest run`); single file: `npx vitest run <path>`. Typecheck: `npm run typecheck`.

---

### Task 1: Lift the TODL floor to ^0.19.0

**Files:**
- Modify: `package.json` (dependency `@pragmatic-tech-ai/todl`)
- Modify: `package-lock.json` (regenerated)

**Interfaces:**
- Consumes: nothing.
- Produces: the 0.19.0 lexer/parser active in the test runner — kebab TODL now fails to parse, which is the red baseline the rest of the plan turns green.

- [ ] **Step 1: Bump the dependency**

In `package.json`, change:
```json
"@pragmatic-tech-ai/todl": "^0.18.0",
```
to:
```json
"@pragmatic-tech-ai/todl": "^0.19.0",
```

- [ ] **Step 2: Relock**

Run: `npm install`
Expected: `package-lock.json` updates to resolve `@pragmatic-tech-ai/todl@0.19.0` from Verdaccio.

- [ ] **Step 3: Confirm the red baseline**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-instance-roundtrip.test.ts`
Expected: FAIL — the kebab fixtures (`realised-by`, `stack.azure-openai`, `model app-model`) no longer parse under 0.19.0. This proves the migration is required.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): bump @pragmatic-tech-ai/todl to ^0.19.0 (C-like identifiers)"
```

---

### Task 2: Fix `freshId` to emit camelCase C-like ids

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/architecture-instance-model.ts` (add `toCamel`, rewrite `freshId`)
- Test: `src/renderer/src/modules/architecture-projects/services/tests/architecture-instance-model.test.ts`

**Interfaces:**
- Consumes: `check`, `toJSON` from `@pragmatic-tech-ai/todl`; `ArchInstanceModel.load`, `ArchInstanceModel.createInstance`.
- Produces: `createInstance(concept)` returns a valid C-like camelCase id (`component1`, `component2`, …).

- [ ] **Step 1: Write the failing test**

Add to `architecture-instance-model.test.ts`:
```ts
test('createInstance generates a valid camelCase C-like id (no hyphen)', () => {
    const META = `namespace ea { concept Component { label : string; } }`
    const metaDoc = toJSON(check([{ uri: 'ea.todl', text: META }]).model)
    const m = ArchInstanceModel.load([metaDoc], '', 'app')
    const id = m.createInstance('ea.Component')
    expect(id).toBe('component1')
    expect(id).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/)
})
```
(Ensure the file imports `check`, `toJSON` from `@pragmatic-tech-ai/todl` — add to the existing import if missing.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/architecture-instance-model.test.ts -t "camelCase C-like id"`
Expected: FAIL — current `freshId` returns `Component-1`.

- [ ] **Step 3: Implement `toCamel` + rewrite `freshId`**

Add a module-local helper near the top of `architecture-instance-model.ts` (after the imports, before the class):
```ts
// `component` / `Component` / `AppComponent` → camelCase. Mirrors TODL's C-like
// convention so generated instance ids are valid identifiers (no hyphens).
function toCamel(id: string): string {
    const words = id
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(/[-_\s]+/)
        .filter((w) => w.length > 0)
        .map((w) => w.toLowerCase())
    return words.length === 0 ? '' : words[0]! + words.slice(1).map((w) => w[0]!.toUpperCase() + w.slice(1)).join('')
}
```

Replace the body of `freshId`:
```ts
    private freshId(concept: string): string
    {
        const stem = toCamel(concept.slice(concept.lastIndexOf('.') + 1))
        let id = `${stem}${++this.seq}`
        while (this.draft.has(id)) id = `${stem}${++this.seq}`
        return id
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/architecture-instance-model.test.ts -t "camelCase C-like id"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/services/architecture-instance-model.ts src/renderer/src/modules/architecture-projects/services/tests/architecture-instance-model.test.ts
git commit -m "fix(arch): freshId emits camelCase C-like instance ids"
```

---

### Task 3: Recase the fixture corpus with TODL's recaser

**Files:**
- Create (throwaway, in the TODL repo): `c:\Users\Eugene\Projects\architecture-agent\TODL\_migrate_plexus.ts`
- Modify: the seed fixture files listed below (rewritten in place by the script)

**Interfaces:**
- Consumes: TODL's `recaseTsFragments(tsSource: string): string` from `TODL/src/migrate/recase-ts.js` (recases TODL fragments inside backtick template literals, passing through `${}`, never touching `'`/`"` strings).
- Produces: fixture backtick TODL fragments in C-like form; quoted assertion strings still kebab (fixed in Task 4).

- [ ] **Step 1: Write the throwaway migration script**

Create `TODL/_migrate_plexus.ts`:
```ts
import { readFileSync, writeFileSync } from 'node:fs'
import { recaseTsFragments } from './src/migrate/recase-ts.js'

const ROOT = 'c:/Users/Eugene/Projects/architecture-agent/Plexus/src/renderer/src'
const files = [
    `${ROOT}/modules/architecture-projects/services/tests/instance-node-vm.test.ts`,
    `${ROOT}/modules/architecture-projects/services/tests/drop-resolver.test.ts`,
    `${ROOT}/modules/architecture-projects/services/tests/architecture-instance-model.test.ts`,
    `${ROOT}/modules/architecture-projects/services/tests/arch-instance-roundtrip.test.ts`,
    `${ROOT}/modules/architecture-projects/services/tests/arch-diagram-document.test.ts`,
    `${ROOT}/modules/architecture-projects/services/tests/arch-canvas-ops.test.ts`,
    `${ROOT}/modules/library/services/tests/library-tree-node.test.ts`,
    `${ROOT}/modules/library/services/tests/library-bundle.test.ts`,
    `${ROOT}/modules/library/services/tests/library-project-factory.test.ts`,
    `${ROOT}/modules/library/services/tests/libraries-panel-service.test.ts`,
    `${ROOT}/modules/meta-model/services/tests/meta-model-project-factory.test.ts`,
    `${ROOT}/modules/meta-model/services/tests/meta-model-compile-to-document.test.ts`,
    `${ROOT}/modules/library/services/tests/library-compile-to-document.test.ts`,
    `${ROOT}/services/projects/tests/base-load-benchmark.test.ts`,
]
for (const f of files) {
    const before = readFileSync(f, 'utf8')
    const after = recaseTsFragments(before)
    if (after !== before) { writeFileSync(f, after, 'utf8'); console.log('recased', f) }
    else console.log('unchanged', f)
}
```

- [ ] **Step 2: Run it**

Run: `cd c:/Users/Eugene/Projects/architecture-agent/TODL && npx tsx _migrate_plexus.ts`
Expected: prints `recased …` for the files whose backtick TODL changed. No throw.

- [ ] **Step 3: Sanity-check one fixture**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-instance-roundtrip.test.ts`
Expected: the backtick `META`/`LIB`/`src` fragments now parse (source-side errors gone); remaining failures are `toContain('...')` assertion mismatches — expected, fixed in Task 4.

- [ ] **Step 4: Commit the recased fixtures**

```bash
cd c:/Users/Eugene/Projects/architecture-agent/Plexus
git add -A
git commit -m "refactor(tests): recase fixture TODL backtick fragments to C-like"
```

---

### Task 4: Grind the suite green

**Files:**
- Modify: any test file with kebab in quoted assertion strings or residual kebab TODL the recaser missed (surfaced by the sweep below).

**Interfaces:**
- Consumes: the recased fixtures from Task 3, the `freshId` fix from Task 2.
- Produces: a green `npm test`.

- [ ] **Step 1: Sweep for residual kebab**

Run (from Plexus root): `git grep -nE "realised-by|deployed-to|implemented-by|azure-openai|azure-func|web-tier|app-model|component-category|location-type" -- 'src/**/*.test.ts'`
Expected: remaining hits are in `'…'`/`"…"` assertion strings and any fixture the seed list missed. This is the worklist.

- [ ] **Step 2: Run the full suite to enumerate failures**

Run: `npm test`
Expected: FAIL — a bounded set of assertion mismatches (e.g. `expect(emitted).toContain('model app-model : ea')` now sees `model appModel : ea`).

- [ ] **Step 3: Fix assertions and stragglers, file by file**

For each failure, apply the C-like rename to the quoted string using the convention table from the spec — members → camelCase (`realised-by`→`realisedBy`), types/terms/classes → PascalCase (`azure-openai`→`AzureOpenai`, `web-tier`→`WebTier`), qualified refs keep the taxonomy prefix as declared (`stack.azure-openai`→`stack.AzureOpenai`), model ids → camelCase (`app-model`→`appModel`). Recase any straggler backtick fragment the seed list missed by adding its path to `_migrate_plexus.ts` and re-running, or by hand for one-offs.

- [ ] **Step 4: Verify green**

Run: `npm test`
Expected: PASS — full suite green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: recase assertion strings to C-like; suite green"
```

---

### Task 5: Recase and correct the scaffold docs

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/scaffold/todl-manual.md`
- Modify: `src/renderer/src/modules/meta-model/services/scaffold/meta-model-guide.md`

**Interfaces:**
- Consumes: nothing (docs shipped into scaffolded projects).
- Produces: authoring docs that teach C-like conventions.

- [ ] **Step 1: Recase every embedded TODL example**

In both files, rewrite every TODL snippet to C-like: concept/taxonomy/primitive/annotation/enum/term/class names → PascalCase; field and relationship-member names → camelCase; keywords and `namespace` segments → lowercase. E.g. `component-category` → `ComponentCategory`, `implemented-by` → `implementedBy`, `azure-openai` → `AzureOpenai`, `realised-by` → `realisedBy`, `deployed-to` → `deployedTo`.

- [ ] **Step 2: Rewrite the naming-convention prose**

Update any sentence that states the identifier convention. Replace kebab-case guidance with: "Types (concepts, taxonomies, primitives, annotations, enums, terms, classes) use PascalCase; members (fields, relationship names, annotation parameters) use camelCase; keywords and namespace segments are lowercase. Identifiers match `[A-Za-z_][A-Za-z0-9_]*` — hyphens are not allowed."

- [ ] **Step 3: Verify no kebab identifiers remain in the docs**

Run: `git grep -nE "[a-z]+-[a-z]+" -- 'src/renderer/src/modules/meta-model/services/scaffold/*.md'`
Expected: only non-identifier hyphenation remains (prose like "well-defined", "type-safe"); no TODL identifier tokens. Inspect each hit to confirm.

- [ ] **Step 4: Run scaffold-related tests**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/`
Expected: PASS — any test reading scaffold content agrees with the updated docs.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/scaffold/todl-manual.md src/renderer/src/modules/meta-model/services/scaffold/meta-model-guide.md
git commit -m "docs(scaffold): teach C-like identifier conventions"
```

---

### Task 6: Final verification and cleanup

**Files:**
- Delete: `c:\Users\Eugene\Projects\architecture-agent\TODL\_migrate_plexus.ts`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a clean, green branch.

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: PASS (the `toCamel` helper and edits type-check).

- [ ] **Step 2: Full suite**

Run: `npm test`
Expected: PASS — entire Plexus suite green under 0.19.0.

- [ ] **Step 3: Whole-repo residual-kebab sweep**

Run: `git grep -nE "realised-by|deployed-to|implemented-by|azure-openai|azure-func|web-tier|app-model|component-category|location-type" -- 'src/'`
Expected: no matches.

- [ ] **Step 4: Remove the throwaway migration script**

```bash
rm c:/Users/Eugene/Projects/architecture-agent/TODL/_migrate_plexus.ts
```
(It lives in the TODL repo and is untracked there; confirm `git -C c:/Users/Eugene/Projects/architecture-agent/TODL status` is clean afterward.)

- [ ] **Step 5: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: finalize Plexus C-like migration"
```

---

## Self-Review

- **Spec coverage:** freshId (Task 2), fixture corpus recasing (Tasks 3–4), scaffold docs incl. convention prose (Task 5), floor bump + relock (Task 1), throwaway-tool approach (Task 3), final residual-kebab sweep (Task 6). `slugify`/`iconKey`/`humanize` are explicitly unchanged per spec — no task, by design. Operational republish is out of scope per spec — no task, by design.
- **No placeholders:** every code step carries concrete code; every run step carries an exact command and expected result.
- **Type consistency:** `toCamel` defined once (Task 2) and reused conceptually in the recaser (TODL-side, Task 3); `freshId` signature unchanged; `createInstance` contract preserved.

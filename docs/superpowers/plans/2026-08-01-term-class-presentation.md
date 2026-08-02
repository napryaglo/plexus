# Term / Class Presentation in the Meta-Model Browser — Implementation Plan (SP2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a taxonomy term's (or class's) `icon`/`label` annotation in the Plexus meta-model browser by emitting `mm:<id>` templates for term/class nodes and surfacing terms under their taxonomy in the tree.

**Architecture:** The presentation generator gains a `classEntities` selector so `generatePresentationMu` emits a template for each Instance-tier `class` node (a taxonomy term) alongside the ontology entities; the projection helpers (`projectAnnotations`, `resolveFacets`, `distinctIcons`) are already node-id-generic and unchanged. The tree builder nests each taxonomy's terms as child entity rows, so double-clicking a term opens the existing drawer, which resolves the term's `mm:` template and renders its icon.

**Tech Stack:** TypeScript, Vitest, mural runtime. Plexus renderer module `meta-model`.

## Global Constraints

- A term/class node is an **Instance-tier** node with `attrs.class === true`; its id is `<taxonomy>.<term>` for a term. The annotation application node is `<id>@<name>`, Ontology-tier, typed by the annotation name.
- Consume serialized TODL wire strings via local named constants (e.g. `const CONTAINS = 'Contains'`), not TODL enum imports — the Plexus convention.
- Tests live in a `tests/` subfolder next to the source. Vitest.
- Run one test file: `npx vitest run <path>`. Typecheck: `npm run typecheck`.
- Do not modify `projectAnnotations`, `resolveFacets`, `entityTemplate`, `buildEntity`, or `openEntity` — they already generalize to any node id.

---

### Task 1: Emit `mm:<id>` templates for term/class nodes

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/presentation-generator.ts` — add `classEntities`; use it in `generatePresentationMu`.
- Test: `src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts` (extend).

**Interfaces:**
- Consumes: existing `ontologyEntities(model): JsonNode[]`, `entityTemplate(doc, n)` (private), `projectAnnotations`.
- Produces: `classEntities(model: TodlDocument): JsonNode[]` (exported) — Instance-tier nodes with `attrs.class === true`, in model order. `generatePresentationMu` now emits a `mm:<id>` template for each of these too.

- [ ] **Step 1: Write the failing test**

Add to `presentation-generator.test.ts` (it already imports from `../presentation-generator.js` — extend that import line to include `classEntities`, and add these tests at the end of the file):

```ts
test('classEntities returns Instance-tier class nodes only', () => {
    const m = doc([
        { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} },
        { id: 'actors.internal', tier: 'Instance', typeOf: 'actor', attrs: { class: true, id: 'internal' } },
        { id: 'web-app', tier: 'Instance', typeOf: 'component', attrs: { class: true, id: 'web-app' } },
        { id: 'storefront', tier: 'Instance', typeOf: 'component', attrs: {} },   // concrete, not a class
    ])
    expect(classEntities(m).map((n) => n.id)).toEqual(['actors.internal', 'web-app'])
})

test('generatePresentationMu emits an mm:<term> template with the term icon annotation', () => {
    const m: TodlDocument = {
        nodes: [
            { id: 'actors', tier: 'Ontology', typeOf: 'taxonomy', attrs: {} },
            { id: 'actors.internal', tier: 'Instance', typeOf: 'actor', attrs: { class: true, id: 'internal', label: 'Internal' } },
            { id: 'actors.internal@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/int.svg' } },
        ],
        edges: [
            { kind: 'Annotated', via: null, from: 'actors.internal', to: 'actors.internal@icon' },
        ],
    }
    const out = generatePresentationMu(m, [])

    expect(out).toContain('include "resources/int.svg" as mm_icon_int')
    expect(out).toContain('DataTemplate x:key="mm:actors.internal"')
    expect(out).toContain('Shape [ Geometry = @mm_icon_int')
})

test('a term without an icon annotation emits a label-only mm:<term> template', () => {
    const m = doc([
        { id: 'actors', tier: 'Ontology', typeOf: 'taxonomy', attrs: {} },
        { id: 'actors.partner', tier: 'Instance', typeOf: 'actor', attrs: { class: true, id: 'partner' } },
    ])
    const out = generatePresentationMu(m, [])
    expect(out).toContain('DataTemplate x:key="mm:actors.partner"')
    // no icon annotation → label-only; label falls back to humanize(full id)
    expect(out).toContain('Actors Partner')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`
Expected: FAIL — `classEntities` is not exported; no `mm:actors.internal` template emitted.

- [ ] **Step 3: Add `classEntities`**

In `presentation-generator.ts`, after `ontologyEntities` (around line 26), add:

```ts
// Instance-tier `class` nodes — a taxonomy term (staged with `class: true`) or a
// `class` declaration. Presented as first-class templates so a term's annotation
// icon/label renders. In model order.
export function classEntities(model: TodlDocument): JsonNode[]
{
    return model.nodes.filter((n) => n.tier === 'Instance' && n.attrs['class'] === true)
}
```

- [ ] **Step 4: Emit templates for class entities**

In `generatePresentationMu` (around line 54), replace:

```ts
    const templates = ontologyEntities(model).map((n) => entityTemplate(model, n))
```

with:

```ts
    const entities = [...ontologyEntities(model), ...classEntities(model)]
    const templates = entities.map((n) => entityTemplate(model, n))
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`
Expected: PASS (all tests, including the pre-existing ones — the existing `actors.internal` fixture has no `class: true`, so it stays excluded).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/presentation-generator.ts src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts
git commit -m "feat(meta-model): emit mm templates for term/class nodes"
```

---

### Task 2: Nest terms under their taxonomy in the tree

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/meta-model-tree-builder.ts` — add `termsOf`; nest term rows under taxonomy entity rows in `loadVersionEntities`.
- Test: `src/renderer/src/modules/meta-model/services/tests/meta-model-tree-builder.test.ts` (extend).

**Interfaces:**
- Consumes: existing `MetaModelTreeNode.entity(label, ref, activate)`, `entityLabel(n)` (private), `OntologyKind.Taxonomy`, `ontologyEntities`.
- Produces: `termsOf(doc: TodlDocument, taxonomyId: string): JsonNode[]` — the taxonomy's term nodes (its `Contains` targets that are `class` nodes). Taxonomy entity rows now carry a child entity row per term.

- [ ] **Step 1: Write the failing test**

Add to `meta-model-tree-builder.test.ts` (extend the existing imports to include nothing new — it already imports `MetaModelNodeKind`, `loadVersionEntities`; add this test at the end):

```ts
test('a taxonomy row nests its terms as child entity rows', async () => {
    const model = JSON.stringify({
        nodes: [
            { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} },
            { id: 'actors', tier: 'Ontology', typeOf: 'taxonomy', attrs: { label: 'Actors' } },
            { id: 'actors.internal', tier: 'Instance', typeOf: 'actor', attrs: { class: true, id: 'internal', label: 'Internal' } },
        ],
        edges: [
            { kind: 'Contains', via: null, from: 'actors', to: 'actors.internal' },
        ],
    })
    const storage = backendWith([['tech/0.1.0/model.json', model]])

    const calls: EntityRef[] = []
    const groups = await loadVersionEntities(storage, 'tech', '0.1.0', (r) => calls.push(r))

    const taxGroup = groups.find((g) => g.Label === 'Taxonomies')!
    const taxRow = taxGroup.Children.Get(0)!            // the `actors` taxonomy row
    expect(taxRow.Label).toBe('Actors')
    const termRow = taxRow.Children.Get(0)!             // its nested term
    expect(termRow.Label).toBe('Internal')
    termRow.OnActivate()
    expect(calls).toEqual([{ modelId: 'tech', version: '0.1.0', id: 'actors.internal' }])
})
```

(`EntityRef` is already imported in this test file; if not, add it to the `meta-model-tree-node.js` import.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-tree-builder.test.ts`
Expected: FAIL — the taxonomy row has no children (`taxRow.Children.Get(0)` is undefined).

- [ ] **Step 3: Add `termsOf`**

In `meta-model-tree-builder.ts`, add a module-scope constant and helper near the top (after the imports):

```ts
// A term is a taxonomy's `Contains` target that is a class node.
const CONTAINS = 'Contains'

// The term nodes of a taxonomy: its `Contains` targets with `attrs.class === true`.
export function termsOf(doc: TodlDocument, taxonomyId: string): JsonNode[]
{
    const targets = new Set(
        doc.edges.filter((e) => e.kind === CONTAINS && e.from === taxonomyId).map((e) => e.to),
    )
    return doc.nodes.filter((n) => targets.has(n.id) && n.attrs['class'] === true)
}
```

- [ ] **Step 4: Nest terms under taxonomy rows**

In `loadVersionEntities`, replace the inner entity-adding loop:

```ts
        for (const n of inGroup)
        {
            const ref: EntityRef = { modelId: id, version, id: n.id }
            group.Children.Add(MetaModelTreeNode.entity(entityLabel(n), ref, activate))
        }
```

with:

```ts
        for (const n of inGroup)
        {
            const ref: EntityRef = { modelId: id, version, id: n.id }
            const entityNode = MetaModelTreeNode.entity(entityLabel(n), ref, activate)
            if (g.kind === OntologyKind.Taxonomy)
            {
                for (const term of termsOf(doc, n.id))
                {
                    const termRef: EntityRef = { modelId: id, version, id: term.id }
                    entityNode.Children.Add(MetaModelTreeNode.entity(entityLabel(term), termRef, activate))
                }
            }
            group.Children.Add(entityNode)
        }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-tree-builder.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/meta-model-tree-builder.ts src/renderer/src/modules/meta-model/services/tests/meta-model-tree-builder.test.ts
git commit -m "feat(meta-model): nest taxonomy terms as tree rows that open their drawer"
```

---

### Task 3: Correct the scaffold manual's annotate-location line

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/scaffold/todl-manual.md:187-188`.

**Interfaces:**
- Consumes: nothing (documentation).
- Produces: nothing (documentation).

- [ ] **Step 1: Update the legal-locations sentence**

In `scaffold/todl-manual.md`, replace:

```
Apply it with `annotate` — legal **only inside a concept body** or a `package { }`
block — giving each param a fixed value:
```

with:

```
Apply it with `annotate` — legal inside a `concept` body, a taxonomy `term` body,
a `class` declaration, or a `package { }` block (annotations are type-level; a
concrete instance carrying `annotate` is `annotation.invalid-target`) — giving
each param a fixed value:
```

- [ ] **Step 2: Verify the full meta-model suite still passes**

Run: `npx vitest run src/renderer/src/modules/meta-model`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/scaffold/todl-manual.md
git commit -m "docs(scaffold): annotate is legal on terms and classes"
```

---

## Notes for the implementer

- The whole feature rides on the projection helpers already being node-id-generic. You are only (a) widening which nodes get a template and (b) adding a tree affordance to open a term. Do not touch `projectAnnotations` / `resolveFacets` / `entityTemplate` / `buildEntity` / `openEntity`.
- `distinctIcons` already emits an `include` for `<x>@icon` application nodes, so a term's icon geometry is already available to the generated template — no icon-include change is needed.
- A published meta-model must be **republished** to pick up term templates; the generator runs at publish time only. This is expected, not a bug.

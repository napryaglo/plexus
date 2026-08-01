# Meta-Model Annotations SP3 (annotation-driven presentation bake) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the meta-model presentation generator to source well-known icon/label from annotations (attr-primary, annotation-fallback) so annotation-authored presentation metadata is honored, without changing generated output shape.

**Architecture:** A shared pure `resolveFacets(node, annotations)` centralizes the attr-primary/annotation-fallback rule. `entityTemplate` resolves icon/label through it (reusing SP2's `projectAnnotations`); `distinctIcons` unions annotation-sourced icons so they are `include`d/copied; `buildEntity` applies the same resolver to keep the drawer label consistent. No Mural/runtime/TODL changes.

**Tech Stack:** TypeScript (strict ESM), `@pragmatic-lab/todl` (`TodlDocument`/`JsonNode` types only), Vitest.

## Global Constraints

- Consumes `@pragmatic-lab/todl` **0.5.0** (already installed) — no TODL/emit changes; pure consumption of `model.json`.
- **Attr-primary, annotation-fallback:** `icon = attrs.icon ?? annotations.icon?.path`; `label = attrs.label ?? annotations.label?.text ?? humanize(id)`. Only a non-empty string counts as an icon.
- **Well-known vocabulary (hard-coded):** annotation `icon` with param `path`; annotation `label` with param `text`. No others this slice.
- **Generated output shape unchanged** — same Border/StackPanel/Shape/TextBlock and static `@mm_icon_…` references; only the source of the baked values changes.
- Wire strings consumed as local literals matching existing style (`typeOf === 'icon'`, attr keys `'path'`/`'text'`/`'icon'`/`'label'`).
- Every test file lives in a `tests/` subfolder (Vitest globs `src/**/*.test.ts`).
- Single test file: `npx vitest run <path>`; whole suite: `npm test`.
- The suite carries 5 pre-existing `instance.orphan` failures (0.5.0 migration debt, tracked separately) — SP3 must add zero new failures.
- Out of scope: the `$Type` canvas hop, the runtime icon→geometry converter, generic `$Annotations` rendering, any well-known annotation beyond `icon`/`label`.

## File Structure

- **Modify** `src/renderer/src/modules/meta-model/services/presentation-generator.ts` — add `PresentationFacets` + `resolveFacets`; import `projectAnnotations`; `entityTemplate(doc, n)` resolves through it; `distinctIcons` unions annotation icons; `generatePresentationMu` threads `model` to `entityTemplate`.
- **Modify** `src/renderer/src/modules/meta-model/services/meta-model-entity-builder.ts` — resolve `entity.Label` via `resolveFacets`.
- **Test** files alongside each in `tests/` subfolders (extend existing).

---

### Task 1: `resolveFacets` — the shared attr-primary/annotation-fallback resolver

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/presentation-generator.ts`
- Test: `src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`

**Interfaces:**
- Consumes: `JsonNode` (type) from `@pragmatic-lab/todl`; the existing `humanize` in this file.
- Produces: `export interface PresentationFacets { icon?: string; label: string }` and `export function resolveFacets(node: JsonNode, annotations: Record<string, Record<string, unknown>>): PresentationFacets` — used by Tasks 2 and 3.

- [ ] **Step 1: Write the failing tests**

Append to `tests/presentation-generator.test.ts` (add `resolveFacets` to the existing import on line 4):

```ts
test('resolveFacets: attr wins over annotation for icon and label', () => {
    const node = { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: { icon: 'a.svg', label: 'Attr' } } as unknown as import('@pragmatic-lab/todl').JsonNode
    expect(resolveFacets(node, { icon: { path: 'ann.svg' }, label: { text: 'Ann' } })).toEqual({ icon: 'a.svg', label: 'Attr' })
})

test('resolveFacets: annotation fallback when no attr present', () => {
    const node = { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} } as unknown as import('@pragmatic-lab/todl').JsonNode
    expect(resolveFacets(node, { icon: { path: 'ann.svg' }, label: { text: 'Ann' } })).toEqual({ icon: 'ann.svg', label: 'Ann' })
})

test('resolveFacets: humanize label and no icon when neither present', () => {
    const node = { id: 'app-component', tier: 'Ontology', typeOf: 'concept', attrs: {} } as unknown as import('@pragmatic-lab/todl').JsonNode
    expect(resolveFacets(node, {})).toEqual({ icon: undefined, label: 'App Component' })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`
Expected: FAIL — `resolveFacets` is not exported.

- [ ] **Step 3: Implement `resolveFacets`**

In `presentation-generator.ts`, add near the other exports (e.g. after `humanize`):

```ts
export interface PresentationFacets { icon?: string; label: string }

// Attr-primary, annotation-fallback resolution of the well-known presentation
// facets for a node. `annotations` is the SP2 projected bag for that node
// (projectAnnotations output). Only a non-empty string counts as an icon; the
// label falls back through the annotation to humanize(id).
export function resolveFacets(node: JsonNode, annotations: Record<string, Record<string, unknown>>): PresentationFacets
{
    const attrIcon = node.attrs['icon']
    const annIcon = annotations['icon']?.['path']
    const icon = (typeof attrIcon === 'string' && attrIcon.length > 0) ? attrIcon
        : (typeof annIcon === 'string' && annIcon.length > 0) ? annIcon
            : undefined

    const attrLabel = node.attrs['label']
    const annLabel = annotations['label']?.['text']
    const label = typeof attrLabel === 'string' ? attrLabel
        : typeof annLabel === 'string' ? annLabel
            : humanize(node.id)

    return { icon, label }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`
Expected: PASS (the three new tests plus all existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/presentation-generator.ts \
        src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts
git commit -m "feat: resolveFacets — attr-primary, annotation-fallback icon/label resolver"
```

---

### Task 2: generator honors annotations — `entityTemplate` + `distinctIcons`

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/presentation-generator.ts`
- Test: `src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`

**Interfaces:**
- Consumes: `resolveFacets` (Task 1); `projectAnnotations(doc, targetId)` from `./annotation-projection.js` (SP2); existing `iconKey`, `escapeMu`.
- Produces: annotation-aware `generatePresentationMu` output — icon/label baked from `resolveFacets`, and `distinctIcons` including annotation icon paths.

- [ ] **Step 1: Write the failing tests**

Append to `tests/presentation-generator.test.ts`:

```ts
test('distinctIcons unions attrs.icon and annotation icon-application paths, sorted', () => {
    const m = {
        nodes: [
            { id: 'a', tier: 'Ontology', typeOf: 'concept', attrs: { icon: 'resources/a.svg' } },
            { id: 'b@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/b.svg' } },
            { id: 'b@icon-dup', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/a.svg' } }, // dup
        ],
        edges: [],
    } as unknown as TodlDocument
    expect(distinctIcons(m)).toEqual(['resources/a.svg', 'resources/b.svg'])
})

test('generatePresentationMu bakes annotation-sourced icon/label, attr still wins', () => {
    const m = {
        nodes: [
            { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} },
            { id: 'actor@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/actor.svg' } },
            { id: 'actor@label', tier: 'Ontology', typeOf: 'label', attrs: { text: 'Human Actor' } },
            { id: 'gateway', tier: 'Ontology', typeOf: 'concept', attrs: { icon: 'resources/gw.svg', label: 'API Gateway' } },
            { id: 'gateway@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/ann-gw.svg' } },
        ],
        edges: [
            { kind: 'Annotated', via: null, from: 'actor', to: 'actor@icon' },
            { kind: 'Annotated', via: null, from: 'actor', to: 'actor@label' },
            { kind: 'Annotated', via: null, from: 'gateway', to: 'gateway@icon' },
        ],
    } as unknown as TodlDocument
    const out = generatePresentationMu(m, [])

    // actor: annotation icon + label baked into its template
    expect(out).toContain('include "resources/actor.svg" as mm_icon_actor')
    expect(out).toContain('Geometry = @mm_icon_actor')
    expect(out).toContain('Text = "Human Actor"')

    // gateway: attr wins for both; annotation icon still included by the union
    expect(out).toContain('Geometry = @mm_icon_gw')
    expect(out).toContain('Text = "API Gateway"')
    expect(out).toContain('include "resources/ann-gw.svg" as mm_icon_ann_gw')
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`
Expected: FAIL — `distinctIcons` omits annotation icons; the actor template shows `Actor`/no icon (reads raw attrs).

- [ ] **Step 3: Import `projectAnnotations`**

In `presentation-generator.ts`, add after the existing `@pragmatic-lab/todl` import:

```ts
import { projectAnnotations } from './annotation-projection.js'
```

- [ ] **Step 4: Union annotation icons in `distinctIcons`**

Replace the loop body in `distinctIcons` so it also collects icon-application paths:

```ts
export function distinctIcons(model: TodlDocument): string[]
{
    const set = new Set<string>()
    for (const n of model.nodes) {
        const icon = n.attrs['icon']
        if (typeof icon === 'string' && icon.length > 0) set.add(icon)
        // Annotation-sourced icon: a `<x>@icon` application node (typeOf 'icon')
        // carries the path on its `path` attr.
        if (n.typeOf === 'icon') {
            const path = n.attrs['path']
            if (typeof path === 'string' && path.length > 0) set.add(path)
        }
    }
    return [...set].sort()
}
```

- [ ] **Step 5: Resolve icon/label in `entityTemplate` and thread `doc`**

Change `entityTemplate` to take the document and resolve through `resolveFacets`:

```ts
function entityTemplate(doc: TodlDocument, n: JsonNode): string
{
    const { icon, label } = resolveFacets(n, projectAnnotations(doc, n.id))
    const labelBlock = `TextBlock [ Text = "${escapeMu(label)}", Style = @BodyMedium, Foreground = @OnSurface ]`

    const body = (icon !== undefined)
        ? [
            `            StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {`,
            `                Shape [ Geometry = @${iconKey(icon)}, Fill = @OnSurfaceVariant, Width = 16, Height = 16, Margin = (0,0,6,0) ]`,
            `                ${labelBlock}`,
            `            }`,
          ]
        : [`            ${labelBlock}`]

    return [
        `    DataTemplate x:key="mm:${n.id}" [ DataType = MetaModelEntity ] {`,
        `        Border [ Background = @SurfaceContainerHigh, CornerRadius = 6, Padding = (8,6,8,6) ] {`,
        ...body,
        `        }`,
        `    }`,
    ].join('\n')
}
```

And in `generatePresentationMu`, change the templates line to pass the model:

```ts
    const templates = ontologyEntities(model).map((n) => entityTemplate(model, n))
```

- [ ] **Step 6: Run to verify they pass**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`
Expected: PASS (new tests plus all existing attr-based tests — the existing `generatePresentationMu` and `distinctIcons` tests still hold, since attrs remain primary and their fixtures use no annotations).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/presentation-generator.ts \
        src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts
git commit -m "feat: generator bakes annotation-sourced icon/label; distinctIcons unions annotation icons"
```

---

### Task 3: `buildEntity` label consistency

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/meta-model-entity-builder.ts`
- Test: `src/renderer/src/modules/meta-model/services/tests/meta-model-entity-builder.test.ts`

**Interfaces:**
- Consumes: `resolveFacets` (Task 1); `projectAnnotations` (already imported for SP2's `entity.Annotations`).
- Produces: `entity.Label` resolved attr-primary/annotation-fallback, consistent with the generated template label.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('buildEntity', …)` block in `tests/meta-model-entity-builder.test.ts`:

```ts
  it('resolves Label from an annotate label when attrs.label is absent; attr still wins', () => {
    const annotated: TodlDocument = {
      nodes: [
        { id: 'actor',        tier: 'Ontology', typeOf: 'concept', attrs: {} },
        { id: 'actor@label',  tier: 'Ontology', typeOf: 'label',   attrs: { text: 'Human Actor' } },
        { id: 'widget',       tier: 'Ontology', typeOf: 'concept', attrs: { label: 'Attr Label' } },
        { id: 'widget@label', tier: 'Ontology', typeOf: 'label',   attrs: { text: 'Ann Label' } },
      ],
      edges: [
        { kind: 'Annotated', via: null, from: 'actor',  to: 'actor@label' },
        { kind: 'Annotated', via: null, from: 'widget', to: 'widget@label' },
      ],
    } as unknown as TodlDocument

    expect(buildEntity(annotated, 'actor').Label).toBe('Human Actor')  // annotation fallback
    expect(buildEntity(annotated, 'widget').Label).toBe('Attr Label')  // attr wins
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-entity-builder.test.ts`
Expected: FAIL — `actor` Label is `humanize('actor')` = `'Actor'`, not `'Human Actor'` (label reads raw attrs only).

- [ ] **Step 3: Resolve `entity.Label` via `resolveFacets`**

In `meta-model-entity-builder.ts`, change the import from `presentation-generator.js` to bring in `resolveFacets` alongside `humanize`:

```ts
import { humanize, resolveFacets } from './presentation-generator.js'
```

Move the annotations projection above the label line and resolve the label through it. The relevant region becomes:

```ts
    const attrs = (node?.attrs ?? {}) as Record<string, unknown>
    entity.Attrs = attrs
    entity.Annotations = projectAnnotations(doc, entityId)
    entity.Label = node !== undefined ? resolveFacets(node, entity.Annotations).label : humanize(entityId)
```

Delete the original `entity.Label = …` line (line 20) and the trailing `entity.Annotations = projectAnnotations(doc, entityId)` line (added in SP2) so the projection is set only once, before the label. Keep the `HasField` loop and `return entity` unchanged.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-entity-builder.test.ts`
Expected: PASS (new test plus the existing ones — `'Application'`/`'Human Actor'`/annotation-bag tests still hold, attrs remain primary).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/meta-model-entity-builder.ts \
        src/renderer/src/modules/meta-model/services/tests/meta-model-entity-builder.test.ts
git commit -m "feat: resolve MetaModelEntity.Label attr-primary/annotation-fallback for drawer consistency"
```

---

### Task 4: Full-suite + typecheck verification + finish

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: the only failures are the 5 pre-existing `instance.orphan` tests (`todl-emitter.test.ts` ×2, `meta-model-project-factory.test.ts` ×3). SP3 adds **zero** new failures; every meta-model presentation/entity test passes.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean (node + web) — `resolveFacets`/`PresentationFacets`, the `entityTemplate(doc, n)` signature, and the entity-builder import all type-check.

- [ ] **Step 3: Finish the branch**

Announce and use **superpowers:finishing-a-development-branch** to verify tests, present merge/PR/keep options (base `main`; note the pre-existing 5 failures are the tracked 0.5.0 migration debt, not introduced here), and clean up.

---

## Self-Review

**Spec coverage:**
- §3.A `resolveFacets` shared resolver → Task 1. ✓
- §3.B `entityTemplate` resolves via `resolveFacets` + `generatePresentationMu` threads doc → Task 2. ✓
- §3.C `distinctIcons` annotation-icon union → Task 2. ✓
- §3.D `buildEntity` label consistency → Task 3. ✓
- §2 attr-primary/annotation-fallback + well-known `icon`/`path`, `label`/`text` → encoded in `resolveFacets` (Task 1) and the icon scan (Task 2). ✓
- §5 error handling (non-string values ignored; no annotations → humanize; missing SVG still skipped) → Task 1 humanize test + Task 2 union guards. ✓
- §6 testing (resolveFacets four cases, generator annotation bake, distinctIcons union, buildEntity label) → Tasks 1–3. ✓
- §7 out-of-scope ($Type hop, converter, generic rendering) → not implemented; Global Constraints forbids. ✓

**Placeholder scan:** No TBD/TODO; every code step carries real code and a concrete run/assert. ✓

**Type consistency:** `resolveFacets(node, annotations): PresentationFacets` used identically in Tasks 1–3. `entityTemplate(doc, n)` signature matches its single caller in `generatePresentationMu` (Task 2). `projectAnnotations(doc, targetId)` (SP2) reused unchanged. Annotation wire names (`icon`/`path`, `label`/`text`) consistent across generator and builder. ✓

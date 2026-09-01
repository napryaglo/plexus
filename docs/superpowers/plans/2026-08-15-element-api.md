# Element API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the read-only `Element` projection (TODL) plus the Plexus presentation resolver, diagram-selection bridge, and typed-by-concept view-model layer that binds architecture elements to mural templates without converters.

**Architecture:** TODL gains a pure `Element` type + `toElement(repo, entity, opts)` (deep-nested, cycle-guarded, four facets, presentation/home injected). Plexus adds a presentation resolver (reusing `iconEntityKey` + the registry), a `selectionToElements` bridge, and an `ElementViewModel` layer whose concrete per-concept subclass type drives mural template resolution.

**Tech Stack:** TypeScript; TODL (`@pragmatic-tech-ai/todl`, node:test); Plexus (electron-vite, vitest); mural (`@pragmatic-tech-ai/mural`).

## Global Constraints

- **Design source of truth:** `Plexus/docs/superpowers/specs/2026-08-15-element-api-design.md`.
- **TODL `Element` core is pure:** `src/model/element.ts` imports only type-only from `./entity.js`, `./model.js`, `./graph.js`. No mural, no presentation, no `ModelDraft` — presentation and `provenance.home` arrive via `ToElementOptions`.
- **TODL tests run with force-exit** to avoid the node-test open-handle hang: `npx tsx --conditions=development --test --test-force-exit "<file>"`.
- **Plexus tests:** `npx vitest run <file>`. **Typecheck:** `npm run typecheck`.
- **Every test file lives in a `tests/` subfolder** next to its source (both repos).
- **Enums, not string-literal unions.** `Cardinality` is already a TODL enum; reuse it.
- **TODL publishes to the local Verdaccio only** (`http://localhost:4873`). Version bump `0.24.0 → 0.25.0`.
- **Plexus bumps** `@pragmatic-tech-ai/todl` to `^0.25.0` after the TODL publish.
- **Commit per repo; branch first if on the default branch.** Commit/push only as the executor's workflow allows.
- **`referredBy` is root-only.** **`truncated` nodes carry flat facets but empty `refs`.** **Depth cut ≠ cycle:** a `maxDepth` stop leaves `refs` empty with no `truncated` flag.

---

### Task 1: TODL — `Element` types + `toElement` projection

**Files:**
- Create: `TODL/src/model/element.ts`
- Test: `TODL/src/model/tests/element.test.ts`
- Modify: `TODL/src/index.ts` (add barrel export)

**Interfaces:**
- Consumes: `Entity` (`./entity.js`), `Repository` (`./model.js`), `Scalar`, `Cardinality` (`./graph.js`). `Entity` provides `id`, `concept`, `field(name)`, `fields` (ReadonlyMap), `refs(member): Entity[]`, `referrers(): Entity[]`, `schema(): ConceptSchema`. `Repository.resolve(id)?.attrs` is a `Map<string, Scalar>`.
- Produces: `interface Element`, `ElementSchema`, `Provenance`, `IncomingRef`, `PresentationHint`, `ToElementOptions`, and `function toElement(repo: Repository, entity: Entity, opts?: ToElementOptions): Element`.

- [ ] **Step 1: Write the failing test**

Create `TODL/src/model/tests/element.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../model.js";
import { toJSON, graphFromJSON } from "../../emit/json.js";
import { load } from "../../parse/loader.js";
import { ModelDraft } from "../../authoring/model-draft.js";
import { toElement } from "../element.js";

const MM = `namespace t {
  concept category {}
  concept technology { relationship partOf -> technology; }
  concept component {
    name : string;
    relationship hostedIn -> technology;
    relationship categorisedAs -> category;
    relationship implementedBy -> technology;
    relationship linkedTo -> component;
  }
  taxonomy Cats : represents category { term ai {} }
  taxonomy Stack : represents technology { term cloud {}  term azure { partOf = Stack.cloud; } }
  viewpoint V : frames component
}`;

const MODEL = `namespace t {
  model M : t conforms V {
    component c1 { name = "C One"; hostedIn = Stack.cloud; categorisedAs = Cats.ai; implementedBy = Stack.azure; }
    component c2 { name = "C Two"; }
  }
}`;

function setup() {
  const base = new Repository(graphFromJSON(toJSON(load([{ uri: "mm.todl", text: MM }]).model)));
  const draft = ModelDraft.fromSources([base], [{ uri: "a.todl", text: MODEL }], { namespace: "t" });
  draft.addRef("c1", "linkedTo", "c2");
  draft.addRef("c2", "linkedTo", "c1");
  draft.setField("c1", "conforms", "V");
  const repo = draft.model;
  const entity = (id: string) => draft.ownInstances().find((e) => e.id === id)!;
  return { repo, draft, entity };
}

test("core: id/concept/fields and resolved refs", () => {
  const { repo, entity } = setup();
  const el = toElement(repo, entity("c1"));
  assert.equal(el.id, "c1");
  assert.equal(el.concept, "component");
  assert.equal(el.fields.name, "C One");
  assert.equal(el.refs.categorisedAs[0].id, "Cats.ai");
  assert.equal(el.refs.categorisedAs[0].concept, "category");
});

test("empty relationship members are omitted from refs", () => {
  const { repo, entity } = setup();
  const el = toElement(repo, entity("c1"));
  const c2 = el.refs.linkedTo[0];
  assert.equal(c2.id, "c2");
  assert.equal(c2.refs.categorisedAs, undefined); // c2 has no categorisedAs
});

test("deep nesting resolves aggregates inline", () => {
  const { repo, entity } = setup();
  const el = toElement(repo, entity("c1"));
  const azure = el.refs.implementedBy[0];
  assert.equal(azure.id, "Stack.azure");
  assert.equal(azure.refs.partOf[0].id, "Stack.cloud"); // one level deeper
});

test("cycle guard: a back-reference is truncated with empty refs", () => {
  const { repo, entity } = setup();
  const el = toElement(repo, entity("c1"));
  const back = el.refs.linkedTo[0].refs.linkedTo[0]; // c2 -> c1 (already expanded)
  assert.equal(back.id, "c1");
  assert.equal(back.truncated, true);
  assert.equal(Object.keys(back.refs).length, 0);
});

test("maxDepth cuts recursion without marking truncated", () => {
  const { repo, entity } = setup();
  const el = toElement(repo, entity("c1"), { maxDepth: 1 });
  const azure = el.refs.implementedBy[0]; // depth 1
  assert.equal(Object.keys(azure.refs).length, 0); // partOf not expanded
  assert.equal(azure.truncated, undefined); // depth cut, not a cycle
});

test("schema facet mirrors the concept's declared members", () => {
  const { repo, entity } = setup();
  const el = toElement(repo, entity("c1"));
  assert.equal(el.schema.concept, "component");
  assert.ok(el.schema.fields.some((f) => f.name === "name"));
  const cat = el.schema.relationships.find((r) => r.name === "categorisedAs");
  assert.ok(cat && cat.targets.includes("category"));
});

test("provenance: conforms from attrs, home from injected homeOf", () => {
  const { repo, entity } = setup();
  const el = toElement(repo, entity("c1"), { homeOf: (id) => (id === "c1" ? "application.todl" : undefined) });
  assert.equal(el.provenance.conforms, "V");
  assert.equal(el.provenance.home, "application.todl");
});

test("referredBy is present on the root and absent on nested nodes", () => {
  const { repo, entity } = setup();
  const el = toElement(repo, entity("c1"));
  assert.ok(el.referredBy!.some((r) => r.id === "c2" && r.via === "linkedTo"));
  assert.equal(el.refs.implementedBy[0].referredBy, undefined); // nested aggregate
});

test("presentation: default label, and injected resolver wins", () => {
  const { repo, entity } = setup();
  const plain = toElement(repo, entity("c1"));
  assert.equal(plain.presentation.label, "C One");
  assert.equal(plain.presentation.iconKey, undefined);

  const injected = toElement(repo, entity("c1"), {
    presentation: (e, def) => ({ label: def.toUpperCase(), iconKey: `k_${e.concept}` }),
  });
  assert.equal(injected.presentation.label, "C ONE");
  assert.equal(injected.presentation.iconKey, "k_component");
  assert.equal(injected.refs.implementedBy[0].presentation.iconKey, "k_technology"); // applied deep
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd TODL && npx tsx --conditions=development --test --test-force-exit "src/model/tests/element.test.ts"`
Expected: FAIL — `Cannot find module '../element.js'`.

- [ ] **Step 3: Write the implementation**

Create `TODL/src/model/element.ts`:

```ts
import type { Entity } from "./entity.js";
import type { Repository } from "./model.js";
import type { Scalar, Cardinality } from "./graph.js";

/** A read-only, JSON-serializable projection of a model node. Referenced
 *  aggregates and linked elements are resolved inline (deep); a node already
 *  expanded upstream collapses to a `truncated` node (own facets, empty subtree). */
export interface Element {
  id: string;
  concept: string;
  fields: Record<string, Scalar>;
  refs: Record<string, Element[]>;
  schema: ElementSchema;
  provenance: Provenance;
  presentation: PresentationHint;
  referredBy?: IncomingRef[];
  truncated?: true;
}

export interface ElementSchema {
  concept: string;
  extends: string | null;
  fields: { name: string; type: string; cardinality: Cardinality }[];
  relationships: { name: string; targets: string[]; cardinality: Cardinality; inverse: string | null }[];
}

export interface Provenance {
  home?: string;
  conforms?: string;
}

export interface IncomingRef {
  id: string;
  concept: string;
  via: string;
}

export interface PresentationHint {
  label: string;
  iconKey?: string | null;
}

export interface ToElementOptions {
  maxDepth?: number;
  presentation?: (e: Entity, defaultLabel: string) => PresentationHint;
  homeOf?: (id: string) => string | undefined;
}

export function toElement(repo: Repository, entity: Entity, opts: ToElementOptions = {}): Element {
  return build(repo, entity, new Set<string>(), 0, true, opts);
}

function build(repo: Repository, e: Entity, seen: Set<string>, depth: number, isRoot: boolean, opts: ToElementOptions): Element {
  const label = defaultLabel(e);
  const node: Element = {
    id: e.id,
    concept: e.concept,
    fields: fieldsOf(e),
    refs: {},
    schema: schemaOf(e),
    provenance: provenanceOf(repo, e, opts),
    presentation: opts.presentation !== undefined ? opts.presentation(e, label) : { label },
  };
  if (isRoot) node.referredBy = incomingRefs(e);

  if (seen.has(e.id)) { node.truncated = true; return node; }
  if (opts.maxDepth !== undefined && depth >= opts.maxDepth) return node;

  seen.add(e.id);
  for (const rel of e.schema().relationships) {
    const targets = e.refs(rel.name);
    if (targets.length === 0) continue;
    node.refs[rel.name] = targets.map((t) => build(repo, t, seen, depth + 1, false, opts));
  }
  return node;
}

function defaultLabel(e: Entity): string {
  const v = e.field("label") ?? e.field("name");
  return v !== undefined ? String(v) : e.id;
}

function fieldsOf(e: Entity): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  for (const [k, v] of e.fields) out[k] = v;
  return out;
}

function schemaOf(e: Entity): ElementSchema {
  const s = e.schema();
  return {
    concept: s.concept,
    extends: s.extends,
    fields: s.fields.map((f) => ({ name: f.name, type: f.type, cardinality: f.cardinality })),
    relationships: s.relationships.map((r) => ({ name: r.name, targets: [...r.targets], cardinality: r.cardinality, inverse: r.inverse })),
  };
}

function provenanceOf(repo: Repository, e: Entity, opts: ToElementOptions): Provenance {
  const out: Provenance = {};
  const conforms = repo.resolve(e.id)?.attrs.get("conforms");
  if (typeof conforms === "string") out.conforms = conforms;
  const home = opts.homeOf?.(e.id);
  if (home !== undefined) out.home = home;
  return out;
}

// Incoming edges: who references e, and via which member. Root-only.
function incomingRefs(e: Entity): IncomingRef[] {
  const out: IncomingRef[] = [];
  for (const r of e.referrers())
    for (const rel of r.schema().relationships)
      if (r.refs(rel.name).some((t) => t.id === e.id))
        out.push({ id: r.id, concept: r.concept, via: rel.name });
  return out;
}
```

- [ ] **Step 4: Add the barrel export**

In `TODL/src/index.ts`, add after the entity export line (`export { EntityBase, type Entity } from "./model/entity.js";`):

```ts
export {
  toElement,
  type Element,
  type ElementSchema,
  type Provenance,
  type IncomingRef,
  type PresentationHint,
  type ToElementOptions,
} from "./model/element.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd TODL && npx tsx --conditions=development --test --test-force-exit "src/model/tests/element.test.ts"`
Expected: PASS (9 tests).

- [ ] **Step 6: Run the full TODL suite + build**

Run: `cd TODL && npm test -- --test-force-exit && npm run build`
Expected: all green; `tsc` build clean.

- [ ] **Step 7: Commit** (branch first if on the default branch)

```bash
cd TODL && git add src/model/element.ts src/model/tests/element.test.ts src/index.ts
git commit -m "feat(model): add Element projection (toElement)"
```

---

### Task 2: TODL — publish `0.25.0` to local Verdaccio

**Files:**
- Modify: `TODL/package.json` (version)

**Interfaces:**
- Consumes: Task 1's `toElement` export.
- Produces: `@pragmatic-tech-ai/todl@0.25.0` on `http://localhost:4873`, consumable by Plexus.

- [ ] **Step 1: Bump the version**

In `TODL/package.json`, change `"version": "0.24.0"` to `"version": "0.25.0"`.

- [ ] **Step 2: Build + publish to Verdaccio**

Run: `cd TODL && npm run build && npm publish --registry http://localhost:4873`
Expected: `+ @pragmatic-tech-ai/todl@0.25.0`.

- [ ] **Step 3: Verify the published tarball exports `toElement`**

Run: `npm view @pragmatic-tech-ai/todl@0.25.0 version --registry http://localhost:4873`
Expected: `0.25.0`.

- [ ] **Step 4: Commit** (branch first if on the default branch)

```bash
cd TODL && git add package.json && git commit -m "chore: release @pragmatic-tech-ai/todl@0.25.0"
```

---

### Task 3: Plexus — bump TODL + presentation resolver

**Files:**
- Modify: `Plexus/package.json` (todl dep → `^0.25.0`)
- Create: `Plexus/src/renderer/src/modules/architecture-projects/services/element-presentation.ts`
- Test: `Plexus/src/renderer/src/modules/architecture-projects/services/tests/element-presentation.test.ts`

**Interfaces:**
- Consumes: `toElement`/`PresentationHint` from `@pragmatic-tech-ai/todl@0.25.0`; `iconEntityKey(repo, e)` from `./arch-icon.js`; `TodlPresentationRegistry.iconKeyFor(key): string | undefined` from `../../diagram/services/todl-presentation-registry.js`.
- Produces: `function resolveElementPresentation(repo: Repository, registry: TodlPresentationRegistry, e: Entity, defaultLabel: string): PresentationHint`.

- [ ] **Step 1: Bump the TODL dependency + install**

In `Plexus/package.json` change `"@pragmatic-tech-ai/todl": "^0.24.0"` to `"^0.25.0"`, then:
Run: `cd Plexus && npm install`
Expected: installs `0.25.0`.

- [ ] **Step 2: Write the failing test**

Create `Plexus/src/renderer/src/modules/architecture-projects/services/tests/element-presentation.test.ts`:

```ts
import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft, type Entity } from '@pragmatic-tech-ai/todl'
import { resolveElementPresentation } from '../element-presentation.js'
import type { TodlPresentationRegistry } from '../../../diagram/services/todl-presentation-registry.js'

const MM = `namespace t {
  concept category {}
  concept component { relationship categorisedAs -> category; }
  taxonomy Cats : represents category { term ai {} }
  viewpoint V : frames component
}`
const MODEL = `namespace t { model M : t conforms V { component c1 { categorisedAs = Cats.ai; } component c2 {} } }`

function setup() {
  // Seed a source `<term>@icon` node so iconEntityKey treats Cats.ai as
  // icon-bearing (mirrors arch-icon.test's base shape).
  const mmDoc = toJSON(load([{ uri: 'mm.todl', text: MM }]).model)
  mmDoc.nodes.push({ id: 'Cats.ai@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/ai.svg' } })
  const base = new Repository(graphFromJSON(mmDoc))
  const draft = ModelDraft.fromSources([base], [{ uri: 'a.todl', text: MODEL }], { namespace: 't' })
  const entity = (id: string): Entity => draft.ownInstances().find((e) => e.id === id)!
  return { repo: draft.model, entity }
}

// A fake registry that maps only the category term's mm: key to a resource key.
const registry = { iconKeyFor: (k: string) => (k === 'mm:Cats.ai' ? 'mm_icon_ai' : undefined) } as unknown as TodlPresentationRegistry

test('resolves iconKey via the registry (mm: fallback) and passes the label through', () => {
  const { repo, entity } = setup()
  const p = resolveElementPresentation(repo, registry, entity('c1'), 'C One')
  expect(p.label).toBe('C One')
  expect(p.iconKey).toBe('mm_icon_ai')
})

test('iconKey is null when nothing is icon-bearing', () => {
  const { repo, entity } = setup()
  const p = resolveElementPresentation(repo, registry, entity('c2'), 'C Two')
  expect(p.iconKey).toBeNull()
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/architecture-projects/services/tests/element-presentation.test.ts`
Expected: FAIL — cannot find `../element-presentation.js`.

- [ ] **Step 4: Write the implementation**

Create `Plexus/src/renderer/src/modules/architecture-projects/services/element-presentation.ts`:

```ts
import type { Entity, Repository, PresentationHint } from '@pragmatic-tech-ai/todl'
import { iconEntityKey } from './arch-icon.js'
import type { TodlPresentationRegistry } from '../../diagram/services/todl-presentation-registry.js'

// Resolves an element's presentation hint: the caller's default label, plus the
// icon resource key looked up through the same chain the canvas node resolver
// uses (iconEntityKey -> registry.iconKeyFor, with the mm: fallback). null when
// nothing is icon-bearing.
export function resolveElementPresentation(
    repo: Repository,
    registry: TodlPresentationRegistry,
    e: Entity,
    defaultLabel: string,
): PresentationHint
{
    const key = iconEntityKey(repo, e)
    const iconKey = key !== undefined
        ? (registry.iconKeyFor(key) ?? registry.iconKeyFor(`mm:${key}`) ?? null)
        : null
    return { label: defaultLabel, iconKey }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/architecture-projects/services/tests/element-presentation.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck**

Run: `cd Plexus && npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit** (branch first if on the default branch)

```bash
cd Plexus && git add package.json package-lock.json src/renderer/src/modules/architecture-projects/services/element-presentation.ts src/renderer/src/modules/architecture-projects/services/tests/element-presentation.test.ts
git commit -m "feat(arch): element presentation resolver + bump todl 0.25.0"
```

---

### Task 4: Plexus — selection → Elements bridge

**Files:**
- Create: `Plexus/src/renderer/src/modules/architecture-projects/services/element-selection-bridge.ts`
- Test: `Plexus/src/renderer/src/modules/architecture-projects/services/tests/element-selection-bridge.test.ts`

**Interfaces:**
- Consumes: `toElement`, `Element`, `Entity` from `@pragmatic-tech-ai/todl`; `resolveElementPresentation` (Task 3); `ArchDiagramBindingService.modelForDocument(doc): ArchModel | undefined`; `ArchModel.repository()`, `.entities()`, `.homeOf(id)`; `TodlPresentationRegistry`; `DiagramDocument.ActiveView` (a mural `Diagram | undefined`); node VMs expose `.Id`. `SelectedItems` is inherited from `Selector` (`readonly unknown[]`) but not on the `Diagram` d.ts — reach it via an interface cast.
- Produces: `function selectionToElements(doc: DiagramDocument, bindingSvc: ArchDiagramBindingService, registry: TodlPresentationRegistry): Element[]`.

- [ ] **Step 1: Write the failing test**

Create `Plexus/src/renderer/src/modules/architecture-projects/services/tests/element-selection-bridge.test.ts`:

```ts
import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { ArchModel } from '../arch-model.js'
import { ArchNodeVM } from '../arch-node-vm.js'
import { selectionToElements } from '../element-selection-bridge.js'
import type { ArchDiagramBindingService } from '../arch-diagram-binding-service.js'
import type { TodlPresentationRegistry } from '../../../diagram/services/todl-presentation-registry.js'

const MM = `namespace t { concept component {} viewpoint V : frames component }`
const MODEL = `namespace t { model M : t conforms V { component web {} } }`

function buildModel(): ArchModel {
  const base = new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))
  const draft = ModelDraft.fromSources([base], [{ uri: 'a.todl', text: MODEL }], { namespace: 't' })
  return new ArchModel(draft, new FakeStorage('fake://A'), 't')
}

// Structural fakes: the bridge needs only these members.
function fakes(model: ArchModel, selected: unknown[]) {
  const bindingSvc = { modelForDocument: () => model } as unknown as ArchDiagramBindingService
  const registry = { iconKeyFor: () => undefined } as unknown as TodlPresentationRegistry
  const doc = { ActiveView: { SelectedItems: selected } } as unknown as DiagramDocument
  return { bindingSvc, registry, doc }
}

test('maps selected node VMs to Elements of the bound model', () => {
  const model = buildModel()
  const node = new ArchNodeVM(); node.Id = 'web'
  const { bindingSvc, registry, doc } = fakes(model, [node])
  const els = selectionToElements(doc, bindingSvc, registry)
  expect(els).toHaveLength(1)
  expect(els[0].id).toBe('web')
  expect(els[0].concept).toBe('component')
})

test('an unbound document yields no elements', () => {
  const bindingSvc = { modelForDocument: () => undefined } as unknown as ArchDiagramBindingService
  const registry = { iconKeyFor: () => undefined } as unknown as TodlPresentationRegistry
  const node = new ArchNodeVM(); node.Id = 'web'
  const doc = { ActiveView: { SelectedItems: [node] } } as unknown as DiagramDocument
  expect(selectionToElements(doc, bindingSvc, registry)).toEqual([])
})

test('an empty selection yields no elements', () => {
  const model = buildModel()
  const { bindingSvc, registry, doc } = fakes(model, [])
  expect(selectionToElements(doc, bindingSvc, registry)).toEqual([])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/architecture-projects/services/tests/element-selection-bridge.test.ts`
Expected: FAIL — cannot find `../element-selection-bridge.js`.

- [ ] **Step 3: Write the implementation**

Create `Plexus/src/renderer/src/modules/architecture-projects/services/element-selection-bridge.ts`:

```ts
import { toElement, type Element, type Entity, type ToElementOptions } from '@pragmatic-tech-ai/todl'
import type { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import { resolveElementPresentation } from './element-presentation.js'
import type { ArchDiagramBindingService } from './arch-diagram-binding-service.js'
import type { TodlPresentationRegistry } from '../../diagram/services/todl-presentation-registry.js'

// SelectedItems is inherited from Selector (readonly unknown[]) and not on the
// Diagram d.ts — reach it through a narrow interface.
interface WithSelectedItems { SelectedItems?: readonly unknown[] }

// Projects the active diagram's selected node view-models to Elements of the
// document's bound ArchModel, with presentation + provenance.home wired in.
// Unbound document or empty selection -> [].
export function selectionToElements(
    doc: DiagramDocument,
    bindingSvc: ArchDiagramBindingService,
    registry: TodlPresentationRegistry,
): Element[]
{
    const model = bindingSvc.modelForDocument(doc)
    if (model === undefined) return []
    const repo = model.repository()
    const byId = new Map(model.entities().map((e) => [e.id, e]))

    const view = doc.ActiveView as unknown as WithSelectedItems | undefined
    const selected = view?.SelectedItems ?? []
    const ids = selected
        .map((vm) => (vm as { Id?: string }).Id)
        .filter((id): id is string => id !== undefined)

    const opts: ToElementOptions = {
        presentation: (e, def) => resolveElementPresentation(repo, registry, e, def),
        homeOf: (id) => model.homeOf(id),
    }
    return ids
        .map((id) => byId.get(id))
        .filter((e): e is Entity => e !== undefined)
        .map((e) => toElement(repo, e, opts))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/architecture-projects/services/tests/element-selection-bridge.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `cd Plexus && npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit** (branch first if on the default branch)

```bash
cd Plexus && git add src/renderer/src/modules/architecture-projects/services/element-selection-bridge.ts src/renderer/src/modules/architecture-projects/services/tests/element-selection-bridge.test.ts
git commit -m "feat(arch): diagram selection -> Element[] bridge"
```

---

### Task 5: Plexus — view-model base + registry + factory

**Files:**
- Create: `Plexus/src/renderer/src/modules/architecture-projects/view-model/element-view-model.ts`
- Test: `Plexus/src/renderer/src/modules/architecture-projects/view-model/tests/element-view-model.test.ts`

**Interfaces:**
- Consumes: `Element`, `Scalar` from `@pragmatic-tech-ai/todl`.
- Produces: `class ElementViewModel` (props `id`, `concept`, `label`, `icon`; protected `field(name)`, `ref(member)`, `refs(member)`); `registerElementViewModel(concept, ctor)`; `toViewModel(element): ElementViewModel`; type `ElementViewModelCtor = new (e: Element) => ElementViewModel`.

- [ ] **Step 1: Write the failing test**

Create `Plexus/src/renderer/src/modules/architecture-projects/view-model/tests/element-view-model.test.ts`:

```ts
import { test, expect } from 'vitest'
import type { Element } from '@pragmatic-tech-ai/todl'
import { ElementViewModel, registerElementViewModel, toViewModel } from '../element-view-model.js'

// Minimal Element factory for VM tests (facets not under test get sane defaults).
function el(partial: Partial<Element> & Pick<Element, 'id' | 'concept'>): Element {
  return {
    fields: {}, refs: {},
    schema: { concept: partial.concept, extends: null, fields: [], relationships: [] },
    provenance: {}, presentation: { label: partial.id },
    ...partial,
  } as Element
}

class Technology extends ElementViewModel {
  get name(): string { return String(this.field('label') ?? this.label) }
}
class Component extends ElementViewModel {
  get name(): string { return String(this.field('name') ?? this.label) }
  get implementedBy(): Technology[] { return this.refs('implementedBy') as Technology[] }
}
registerElementViewModel('technology', Technology)
registerElementViewModel('component', Component)

test('toViewModel returns the registered class instance with typed accessors', () => {
  const azure = el({ id: 'Stack.azure', concept: 'technology', fields: { label: 'Azure' } })
  const c1 = el({
    id: 'c1', concept: 'component', fields: { name: 'C One' },
    presentation: { label: 'C One', iconKey: 'k' }, refs: { implementedBy: [azure] },
  })
  const vm = toViewModel(c1)
  expect(vm).toBeInstanceOf(Component)
  expect((vm as Component).name).toBe('C One')
  expect(vm.icon).toBe('k')
  const tech = (vm as Component).implementedBy
  expect(tech[0]).toBeInstanceOf(Technology)
  expect(tech[0].name).toBe('Azure')
})

test('an unregistered concept gets a generated class whose name === concept', () => {
  const vm = toViewModel(el({ id: 'w1', concept: 'widget' }))
  expect(vm).toBeInstanceOf(ElementViewModel)
  expect(vm.constructor.name).toBe('widget')
  expect(vm.id).toBe('w1')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/architecture-projects/view-model/tests/element-view-model.test.ts`
Expected: FAIL — cannot find `../element-view-model.js`.

- [ ] **Step 3: Write the implementation**

Create `Plexus/src/renderer/src/modules/architecture-projects/view-model/element-view-model.ts`:

```ts
import type { Element, Scalar } from '@pragmatic-tech-ai/todl'

// Bindable view-model over an Element. The concrete subclass TYPE is what mural
// resolves a DataTemplate against; its getters flatten Element facets into clean
// binding targets so markup needs no converters.
export class ElementViewModel
{
    public readonly id: string
    public readonly concept: string
    public readonly label: string
    public readonly icon: string | null
    protected readonly element: Element

    public constructor(element: Element)
    {
        this.element = element
        this.id = element.id
        this.concept = element.concept
        this.label = element.presentation.label
        this.icon = element.presentation.iconKey ?? null
    }

    protected field(name: string): Scalar | undefined { return this.element.fields[name] }

    protected ref(member: string): ElementViewModel | undefined
    {
        const t = this.element.refs[member]?.[0]
        return t !== undefined ? toViewModel(t) : undefined
    }

    protected refs(member: string): ElementViewModel[]
    {
        return (this.element.refs[member] ?? []).map(toViewModel)
    }
}

export type ElementViewModelCtor = new (e: Element) => ElementViewModel

const registered = new Map<string, ElementViewModelCtor>()
const generated = new Map<string, ElementViewModelCtor>()

// Register a hand-authored typed VM class for a concept.
export function registerElementViewModel(concept: string, ctor: ElementViewModelCtor): void
{
    registered.set(concept, ctor)
}

// A distinct class whose .name === concept, so mural's findDataTemplateForType
// sees a per-concept type even without a hand-written class.
function generatedClassFor(concept: string): ElementViewModelCtor
{
    let ctor = generated.get(concept)
    if (ctor === undefined) {
        ctor = { [concept]: class extends ElementViewModel {} }[concept] as ElementViewModelCtor
        generated.set(concept, ctor)
    }
    return ctor
}

// Build the bindable VM for an Element: the registered class if any, else a
// generated per-concept class. Children are built lazily via ref()/refs().
export function toViewModel(element: Element): ElementViewModel
{
    const Ctor = registered.get(element.concept) ?? generatedClassFor(element.concept)
    return new Ctor(element)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/architecture-projects/view-model/tests/element-view-model.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `cd Plexus && npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit** (branch first if on the default branch)

```bash
cd Plexus && git add src/renderer/src/modules/architecture-projects/view-model/element-view-model.ts src/renderer/src/modules/architecture-projects/view-model/tests/element-view-model.test.ts
git commit -m "feat(arch): ElementViewModel base + registry + toViewModel"
```

---

### Task 6: Plexus — architecture typed view-models

**Files:**
- Create: `Plexus/src/renderer/src/modules/architecture-projects/view-model/arch-view-models.ts`
- Test: `Plexus/src/renderer/src/modules/architecture-projects/view-model/tests/arch-view-models.test.ts`

**Interfaces:**
- Consumes: `ElementViewModel`, `registerElementViewModel`, `toViewModel` (Task 5); `Element` from `@pragmatic-tech-ai/todl`.
- Produces: `class Component`, `class Technology`, `class Category` (all extend `ElementViewModel`); `function registerArchViewModels(): void` that registers all three. `Component` exposes `name`, `implementedBy: Technology[]`, `cat: Category | undefined`, `hostedIn: Technology | undefined`.

- [ ] **Step 1: Write the failing test**

Create `Plexus/src/renderer/src/modules/architecture-projects/view-model/tests/arch-view-models.test.ts`:

```ts
import { test, expect } from 'vitest'
import type { Element } from '@pragmatic-tech-ai/todl'
import { toViewModel } from '../element-view-model.js'
import { Component, Technology, Category, registerArchViewModels } from '../arch-view-models.js'

registerArchViewModels()

function el(partial: Partial<Element> & Pick<Element, 'id' | 'concept'>): Element {
  return {
    fields: {}, refs: {},
    schema: { concept: partial.concept, extends: null, fields: [], relationships: [] },
    provenance: {}, presentation: { label: partial.id },
    ...partial,
  } as Element
}

test('Component exposes typed name / implementedBy / cat / hostedIn', () => {
  const azure = el({ id: 'Stack.azure', concept: 'technology', fields: { label: 'Azure' } })
  const ai = el({ id: 'Cats.ai', concept: 'category', fields: { label: 'AI' } })
  const cloud = el({ id: 'Stack.cloud', concept: 'technology', fields: { label: 'Cloud' } })
  const c1 = el({
    id: 'c1', concept: 'component', fields: { name: 'C One' },
    refs: { implementedBy: [azure], categorisedAs: [ai], hostedIn: [cloud] },
  })

  const vm = toViewModel(c1) as Component
  expect(vm).toBeInstanceOf(Component)
  expect(vm.name).toBe('C One')
  expect(vm.implementedBy[0]).toBeInstanceOf(Technology)
  expect(vm.implementedBy[0].name).toBe('Azure')
  expect(vm.cat).toBeInstanceOf(Category)
  expect(vm.cat!.name).toBe('AI')
  expect(vm.hostedIn!.name).toBe('Cloud')
})

test('cat is undefined when no categorisedAs edge is present', () => {
  const vm = toViewModel(el({ id: 'c2', concept: 'component', fields: { name: 'C Two' } })) as Component
  expect(vm.cat).toBeUndefined()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/architecture-projects/view-model/tests/arch-view-models.test.ts`
Expected: FAIL — cannot find `../arch-view-models.js`.

- [ ] **Step 3: Write the implementation**

Create `Plexus/src/renderer/src/modules/architecture-projects/view-model/arch-view-models.ts`:

```ts
import { ElementViewModel, registerElementViewModel } from './element-view-model.js'

// Typed, bindable view-models for the tech-architecture concepts. Their getters
// flatten Element facets so markup binds directly (no converters). Concepts not
// covered here still get a generated per-concept VM from toViewModel.
export class Technology extends ElementViewModel
{
    public get name(): string { return String(this.field('label') ?? this.label) }
}

export class Category extends ElementViewModel
{
    public get name(): string { return String(this.field('label') ?? this.label) }
}

export class Component extends ElementViewModel
{
    public get name(): string { return String(this.field('name') ?? this.label) }
    public get implementedBy(): Technology[] { return this.refs('implementedBy') as Technology[] }
    public get cat(): Category | undefined { return this.ref('categorisedAs') as Category | undefined }
    public get hostedIn(): Technology | undefined { return this.ref('hostedIn') as Technology | undefined }
}

// Register the architecture VMs. Called by tests now; a future widget-host task
// calls it at app startup once a consumer exists (deferred — nothing renders
// these yet, so no startup wiring here).
export function registerArchViewModels(): void
{
    registerElementViewModel('component', Component)
    registerElementViewModel('technology', Technology)
    registerElementViewModel('category', Category)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/architecture-projects/view-model/tests/arch-view-models.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `cd Plexus && npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit** (branch first if on the default branch)

```bash
cd Plexus && git add src/renderer/src/modules/architecture-projects/view-model/arch-view-models.ts src/renderer/src/modules/architecture-projects/view-model/tests/arch-view-models.test.ts
git commit -m "feat(arch): typed Component/Technology/Category view-models"
```

---

### Task 7: Plexus — remove temporary icon diagnostics

**Files:**
- Modify: `Plexus/src/renderer/src/modules/diagram/services/todl-visual-resolver.ts`
- Modify: `Plexus/src/renderer/src/modules/diagram/services/todl-presentation-registry.ts`
- Modify: `Plexus/src/renderer/src/modules/architecture-projects/services/arch-icon.ts`

**Interfaces:**
- Consumes: nothing new. **Keep `iconEntityKey`** — Task 3's resolver depends on it.
- Produces: no behavior change; removes the `[icon MISS concept]` log, `debugIndexKeys()`, and the `diagIcon` helper/call added during the icon-fallback investigation.

- [ ] **Step 1: Remove the resolver diagnostic**

In `todl-visual-resolver.ts`, delete the temp block after the `iconKey` assignment (the comment beginning `// TEMP DIAG (remove after icon fallback is root-caused): only log a MISS…` and its `if (iconKey === '' && …) console.warn('[icon MISS concept] …')`). Leave the `iconKey` computation and everything below it intact.

- [ ] **Step 2: Remove the registry diagnostic**

In `todl-presentation-registry.ts`, delete the `// TEMP DIAG …` comment and the `public debugIndexKeys(): string[] { return [...this.index.keys()] }` method.

- [ ] **Step 3: Remove the arch-icon diagnostic**

In `arch-icon.ts`, delete: (a) the `// TEMP DIAG helper …` block defining `_diagIconSeen`, `_diagIconCount`, and `diagIcon`; (b) the `diagRefs`/`diagIcon(...)` instrumentation inside `iconEntityKey`, restoring the candidate loop to:

```ts
    const candidates: string[] = []
    for (const rel of entity.schema().relationships)
        for (const target of entity.refs(rel.name))
            if (hasIcon(target.id)) candidates.push(target.id)
```

- [ ] **Step 4: Grep to confirm no diagnostic remnants**

Run: `cd Plexus && grep -rnE "TEMP DIAG|debugIndexKeys|diagIcon|icon MISS concept" src/`
Expected: no matches.

- [ ] **Step 5: Typecheck + run the affected suites**

Run: `cd Plexus && npm run typecheck && npx vitest run src/renderer/src/modules/architecture-projects src/renderer/src/modules/diagram/services`
Expected: clean typecheck; all tests pass.

- [ ] **Step 6: Commit** (branch first if on the default branch)

```bash
cd Plexus && git add src/renderer/src/modules/diagram/services/todl-visual-resolver.ts src/renderer/src/modules/diagram/services/todl-presentation-registry.ts src/renderer/src/modules/architecture-projects/services/arch-icon.ts
git commit -m "chore(arch): remove temporary icon-resolution diagnostics"
```

---

## Final verification

- [ ] TODL: `cd TODL && npm test -- --test-force-exit && npm run build` — all green, build clean.
- [ ] Plexus: `cd Plexus && npm run typecheck && npx vitest run` — full suite green.
- [ ] `cd Plexus && npm run compile:mu` — markup compiles (no markup changed, but confirm no breakage).

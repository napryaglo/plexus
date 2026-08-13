# Materialize-Driven Term Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ambiguous, chooser-dialog term-drop resolver with a deterministic, meta-model-declared engine: one `materialize` annotation names the drop-created root concept, the term's type picks the reference member, the term's own refs propagate onto the instance, and that same propagation graph drives icon selection.

**Architecture:** Author marks a concept `materialize` (a drop-created root). Drop resolution bounds its scan to marked roots (not every concept), so it yields exactly one action. After wiring the primary member, the engine back-fills the instance's other empty members from the dropped term's own references (deterministic single-match). Icon precedence is derived from propagation direction — a term that references another filled facet's term outranks it — reproducibly from the saved model. A meta-model with zero `materialize` roots falls back to today's behavior unchanged.

**Tech Stack:** TypeScript (strict, ESM), Plexus renderer (electron-vite + vitest), `@pragmatic-lab/todl` repository read API (`resolve`, `classOf`, `represents`, `supertypesOf`, `viewpointsFraming`, `effectiveSchema`, `effectiveRelationships`, `refs`, `allNodes`), `@pragmatic-lab/mural` diagram framework.

## Global Constraints

- Tests: Plexus vitest. Run a file with `npx vitest run <path>` (from `Plexus/`). Typecheck with `npm run typecheck`.
- Every test file lives in a `tests/` subfolder next to its source (e.g. `services/tests/arch-materialize.test.ts`).
- Real TypeScript `enum`s only — never string-literal union types or bare literals at use sites.
- Import `@pragmatic-lab/*` from the local Verdaccio; **no TODL source changes** — `materialize` is a per-meta-model annotation convention Plexus reads at runtime.
- Annotation name is `materialize` (case-sensitive). An `annotate materialize {}` on target `Foo` produces a node with id `Foo@materialize` whose `attrs` map holds the params (verified: `TODL/src/parse/tests/loader-annotate-targets.test.ts`).
- Reference members are **relationships** only (`effectiveSchema().relationships`); non-relationship fields are out of scope.
- **Legacy fallback:** when `materializeRoots(repo).length === 0`, resolution keeps today's scan-and-chooser behavior. The four existing tests in `arch-drop-resolver.test.ts` must stay green unchanged.
- Propagation is deterministic: fill an empty member only when exactly one accepts the ref's type; skip on zero or several.
- Icon precedence is derived from propagation direction and must be reproducible from the saved refs alone (no stored drop-origin).
- Commit only when the user asks (do not `git commit` in any step unless told).

---

## File Structure

- `services/arch-concept-type.ts` (new) — pure type helpers `conceptTypeOf`, `acceptSet`, shared by resolver/propagation/icon.
- `services/arch-materialize.ts` (new) — reads the `materialize` annotation: `materializeOf`, `isMaterializeRoot`, `materializeRoots`.
- `services/arch-drop-resolver.ts` (rewrite) — `resolveDropActions` becomes the materialize lookup engine with legacy fallback. Signature and `DropAction`/`DropActionKind` exports unchanged.
- `services/arch-propagate.ts` (new) — pure `propagationFills` computing the back-fill list.
- `services/arch-icon.ts` (rewrite) — `iconEntityKey` precedence by propagation direction.
- `services/arch-instance-drop-factory.ts` (modify) — apply propagation fills in `apply()`.
- The `tech-architecture` meta-model at `c:\Users\Eugene\Projects\plexus_tests\meta-models\tech-architecture\` (author + republish) — Task 7, live integration.

---

### Task 1: Concept-type helpers

**Files:**
- Create: `Plexus/src/renderer/src/modules/architecture-projects/services/arch-concept-type.ts`
- Test: `Plexus/src/renderer/src/modules/architecture-projects/services/tests/arch-concept-type.test.ts`

**Interfaces:**
- Produces: `conceptTypeOf(repo: Repository, id: string): string` — the concept a node stands for (class it instantiates, else the concept its taxonomy represents, else its own `typeOf`). `acceptSet(repo: Repository, conceptId: string): Set<string>` — the concept plus all its supertypes.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'vitest'
import { load } from '@pragmatic-lab/todl'
import { conceptTypeOf, acceptSet } from '../arch-concept-type.js'

const MM = `namespace m {
  concept technology {}
  concept component {}
  concept application : component {}
  taxonomy Stack : represents technology { term azure {} }
}`
function repo() { return load([{ uri: 'm.todl', text: MM }]).model }

test('conceptTypeOf: a taxonomy term resolves to the concept its taxonomy represents', () => {
    expect(conceptTypeOf(repo(), 'Stack.azure')).toBe('technology')
})

test('conceptTypeOf: a bare concept resolves to itself', () => {
    expect(conceptTypeOf(repo(), 'component')).toBe('component')
})

test('acceptSet: a concept plus its supertypes', () => {
    expect(acceptSet(repo(), 'application')).toEqual(new Set(['application', 'component']))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-concept-type.test.ts`
Expected: FAIL — cannot find module `../arch-concept-type.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { type Repository } from '@pragmatic-lab/todl'

// The concept a node stands for: the class it instantiates, else the concept its
// taxonomy represents, else its own typeOf. Mirrors the long-standing derivation
// the drop resolver uses for a dropped term.
export function conceptTypeOf(repo: Repository, id: string): string {
    const typeOf = repo.resolve(id)?.typeOf ?? id
    return repo.classOf(id) ?? repo.represents(typeOf)[0] ?? typeOf
}

// A concept id plus all its supertypes — the set of concept ids a reference
// member may declare as a target and still accept `conceptId`.
export function acceptSet(repo: Repository, conceptId: string): Set<string> {
    return new Set<string>([conceptId, ...repo.supertypesOf(conceptId)])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-concept-type.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

---

### Task 2: Read the `materialize` annotation

**Files:**
- Create: `Plexus/src/renderer/src/modules/architecture-projects/services/arch-materialize.ts`
- Test: `Plexus/src/renderer/src/modules/architecture-projects/services/tests/arch-materialize.test.ts`

**Interfaces:**
- Produces: `interface MaterializeSpec { concept?: string; via?: string; propagate?: boolean }`; `materializeOf(repo, id): MaterializeSpec | undefined` (undefined ⇒ no marker; bare marker ⇒ `{}`); `isMaterializeRoot(repo, conceptId): boolean` (marker present and not redirecting elsewhere); `materializeRoots(repo): string[]` (all concept ids that are roots).

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'vitest'
import { load } from '@pragmatic-lab/todl'
import { materializeOf, isMaterializeRoot, materializeRoots } from '../arch-materialize.js'

const MM = `namespace m {
  annotation materialize { concept : identifier?; via : identifier?; propagate : boolean?; }
  concept technology {}
  concept category {}
  concept application {}
  concept component {
    annotate materialize {}
    relationship implementedBy -> technology;
    relationship categorisedAs -> category;
  }
  taxonomy Cats : represents category {
    term ai {}
    term special { annotate materialize { concept = application; } }
  }
}`
function repo() { return load([{ uri: 'm.todl', text: MM }]).model }

test('materializeOf returns {} for a bare marker and undefined when absent', () => {
    expect(materializeOf(repo(), 'component')).toEqual({})
    expect(materializeOf(repo(), 'technology')).toBeUndefined()
})

test('materializeOf reads a redirect override on a term', () => {
    expect(materializeOf(repo(), 'Cats.special')).toEqual({ concept: 'application' })
})

test('isMaterializeRoot is true for a bare-marked concept, false for a redirect', () => {
    expect(isMaterializeRoot(repo(), 'component')).toBe(true)
    expect(isMaterializeRoot(repo(), 'Cats.special')).toBe(false)
    expect(isMaterializeRoot(repo(), 'technology')).toBe(false)
})

test('materializeRoots lists only the root concepts', () => {
    expect(materializeRoots(repo())).toEqual(['component'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-materialize.test.ts`
Expected: FAIL — cannot find module `../arch-materialize.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { MetaKind, type Repository } from '@pragmatic-lab/todl'

export interface MaterializeSpec { concept?: string; via?: string; propagate?: boolean }

function str(v: unknown): string | undefined { return typeof v === 'string' && v.length > 0 ? v : undefined }
function bool(v: unknown): boolean | undefined { return typeof v === 'boolean' ? v : undefined }

// Reads the `<id>@materialize` annotation application off a concept or term.
// Undefined when the node carries no marker; a bare `annotate materialize {}`
// returns {} (present, every field undefined).
export function materializeOf(repo: Repository, id: string): MaterializeSpec | undefined {
    const node = repo.resolve(`${id}@materialize`)
    if (node === undefined) return undefined
    return { concept: str(node.attrs.get('concept')), via: str(node.attrs.get('via')), propagate: bool(node.attrs.get('propagate')) }
}

// A drop-created root: a concept carrying a materialize marker that does NOT
// redirect elsewhere (no foreign `concept` param).
export function isMaterializeRoot(repo: Repository, conceptId: string): boolean {
    if (repo.resolve(conceptId)?.typeOf !== MetaKind.Concept) return false
    const spec = materializeOf(repo, conceptId)
    return spec !== undefined && (spec.concept === undefined || spec.concept === conceptId)
}

// Every concept id that is a materialize root.
export function materializeRoots(repo: Repository): string[] {
    return repo.allNodes()
        .filter((n) => n.typeOf === MetaKind.Concept && isMaterializeRoot(repo, n.id))
        .map((n) => n.id)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-materialize.test.ts`
Expected: PASS (4 tests). If `component@materialize` does not resolve, confirm the annotation is declared (`annotation materialize { ... }`) before use and that the id convention is `<id>@materialize` (see `TODL/src/parse/tests/loader-annotate-targets.test.ts`).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

---

### Task 3: Rewrite the drop resolver as a materialize lookup (with legacy fallback)

**Files:**
- Modify: `Plexus/src/renderer/src/modules/architecture-projects/services/arch-drop-resolver.ts` (full rewrite of the function body; keep the `DropAction` interface and `DropActionKind` enum exports byte-identical)
- Test: `Plexus/src/renderer/src/modules/architecture-projects/services/tests/arch-drop-resolver-materialize.test.ts` (new file; the existing `arch-drop-resolver.test.ts` stays and must stay green)

**Interfaces:**
- Consumes: `conceptTypeOf`, `acceptSet` (Task 1); `materializeOf`, `materializeRoots` (Task 2).
- Produces: `resolveDropActions(repo: Repository, descriptorKey: string, scope: ReadonlySet<string>): DropAction[]` — unchanged signature. `enum DropActionKind { Instance = 'instance', Reference = 'reference' }`, `interface DropAction { kind: DropActionKind; concept: string; member?: string; term?: string; label: string }` — unchanged.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'vitest'
import { load } from '@pragmatic-lab/todl'
import { resolveDropActions, DropActionKind } from '../arch-drop-resolver.js'

const MM = `namespace m {
  annotation materialize { concept : identifier?; via : identifier?; propagate : boolean?; }
  concept technology {}
  concept category {}
  concept component {
    annotate materialize {}
    relationship implementedBy -> technology;
    relationship categorisedAs -> category;
  }
  concept other { relationship uses -> technology; }
  viewpoint V : frames component, other
  taxonomy Stack : represents technology { term azure {} }
  taxonomy Cats : represents category { term ai {} }
}`
function repo() { return load([{ uri: 'm.todl', text: MM }]).model }
const scope = new Set(['V'])

test('dropping a technology yields exactly one action — the root component member', () => {
    const actions = resolveDropActions(repo(), 'Stack.azure', scope)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ kind: DropActionKind.Reference, concept: 'component', member: 'implementedBy', term: 'Stack.azure' })
})

test('the non-root concept `other` that also accepts technology is NOT scanned (no ambiguity, no chooser)', () => {
    const actions = resolveDropActions(repo(), 'Stack.azure', scope)
    expect(actions.map((a) => a.concept)).not.toContain('other')
})

test('dropping a category yields the root component category member', () => {
    const actions = resolveDropActions(repo(), 'Cats.ai', scope)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ kind: DropActionKind.Reference, concept: 'component', member: 'categorisedAs' })
})

test('a term accepted by no root yields no actions (reject)', () => {
    const NOROOT = `namespace m {
      annotation materialize { concept : identifier?; via : identifier?; propagate : boolean?; }
      concept a {} concept b { annotate materialize {} relationship r -> a; }
      concept c {}
      viewpoint V : frames b
      taxonomy T : represents c { term t {} }
    }`
    const r = load([{ uri: 'm.todl', text: NOROOT }]).model
    expect(resolveDropActions(r, 'T.t', new Set(['V']))).toEqual([])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-drop-resolver-materialize.test.ts`
Expected: FAIL — the current resolver scans every concept, so the `other` concept leaks in (second test fails) and there's no bounded behavior.

- [ ] **Step 3: Write the implementation** (replace the whole file)

```ts
import { MetaKind, type Repository } from '@pragmatic-lab/todl'
import { conceptTypeOf, acceptSet } from './arch-concept-type.js'
import { materializeOf, materializeRoots } from './arch-materialize.js'

// What a term-drop can create: a direct instance of a materialize root, or an
// instance of a root X whose reference member m targets the dropped term's type.
export enum DropActionKind { Instance = 'instance', Reference = 'reference' }

export interface DropAction
{
    kind: DropActionKind
    concept: string     // X — the concept to instantiate
    member?: string     // m — reference member (Reference only)
    term?: string       // t — the dropped term id (Reference only)
    label: string       // chooser row text
}

// Candidate drop-actions for a dropped toolbox term. `descriptorKey` is the term
// id (library) or 'mm:'+id (meta-model); `scope` is the diagram's viewpoint set.
// Empty ⇒ reject; one ⇒ auto; many ⇒ chooser. When the meta-model declares no
// materialize roots the legacy scan behavior is used unchanged.
export function resolveDropActions(repo: Repository, descriptorKey: string, scope: ReadonlySet<string>): DropAction[]
{
    const termId = descriptorKey.startsWith('mm:') ? descriptorKey.slice(3) : descriptorKey
    const node = repo.resolve(termId)
    if (node === undefined) return []

    const roots = materializeRoots(repo)
    if (roots.length === 0) return legacyResolveDropActions(repo, termId, scope)

    const ct = conceptTypeOf(repo, termId)
    const accept = acceptSet(repo, ct)
    const framed = (concept: string): boolean => repo.viewpointsFraming(concept).some((v) => scope.has(v))
    const isClassTerm = node.attrs.get('class') === true

    // 1. Direct: the term's own class (or a supertype) is a root → instantiate it.
    //    Class-terms are excluded — a bare instance would lose which term it is,
    //    so they route through a reference instead.
    const directRoot = [...accept].find((r) => roots.includes(r) && framed(r))
    if (directRoot !== undefined && !isClassTerm)
        return [{ kind: DropActionKind.Instance, concept: directRoot, label: directRoot }]

    // 2. Redirect override on the term, else on its facet concept.
    const spec = materializeOf(repo, termId) ?? materializeOf(repo, ct)
    if (spec?.concept !== undefined && framed(spec.concept)) {
        const member = spec.via ?? singleAcceptingMember(repo, spec.concept, accept)
        if (member !== undefined)
            return [{ kind: DropActionKind.Reference, concept: spec.concept, member, term: termId, label: `${spec.concept}  (${member})` }]
    }

    // 3. Facet drop: scan ROOTS ONLY (not every concept) for a member accepting ct.
    const actions: DropAction[] = []
    for (const r of roots) {
        if (!framed(r)) continue
        for (const rel of repo.effectiveSchema(r).relationships)
            if (rel.targets.some((t) => accept.has(t)))
                actions.push({ kind: DropActionKind.Reference, concept: r, member: rel.name, term: termId, label: `${r}  (${rel.name})` })
    }
    return actions
}

// The one relationship on `concept` whose targets accept `accept`, or undefined
// when zero or several match (ambiguous → caller falls through).
function singleAcceptingMember(repo: Repository, concept: string, accept: ReadonlySet<string>): string | undefined
{
    const matching = repo.effectiveSchema(concept).relationships.filter((rel) => rel.targets.some((t) => accept.has(t)))
    return matching.length === 1 ? matching[0].name : undefined
}

// Pre-materialize behavior, kept as the fallback for meta-models that declare no
// materialize roots: scan EVERY framed concept for a member targeting the term's
// class (plus a bare Instance when the class itself is framed).
function legacyResolveDropActions(repo: Repository, termId: string, scope: ReadonlySet<string>): DropAction[]
{
    const node = repo.resolve(termId)
    if (node === undefined) return []
    const ct = repo.classOf(termId) ?? repo.represents(node.typeOf)[0] ?? node.typeOf
    const accept = new Set<string>([ct, ...repo.supertypesOf(ct)])
    const framed = (concept: string): boolean => repo.viewpointsFraming(concept).some((v) => scope.has(v))
    const isClassTerm = node.attrs.get('class') === true

    const actions: DropAction[] = []
    if (!isClassTerm && framed(ct)) actions.push({ kind: DropActionKind.Instance, concept: ct, label: ct })

    for (const n of repo.allNodes()) {
        if (n.typeOf !== MetaKind.Concept) continue
        const x = n.id
        if (!framed(x)) continue
        for (const rel of repo.effectiveSchema(x).relationships) {
            if (rel.targets.some((t) => accept.has(t)))
                actions.push({ kind: DropActionKind.Reference, concept: x, member: rel.name, term: termId, label: `${x}  (${rel.name})` })
        }
    }
    return actions
}
```

- [ ] **Step 4: Run both resolver test files to verify pass + no regression**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-drop-resolver-materialize.test.ts src/renderer/src/modules/architecture-projects/services/tests/arch-drop-resolver.test.ts`
Expected: PASS. The new file's 4 tests pass; the existing 4 tests pass unchanged (their meta-models declare no `materialize`, so they hit `legacyResolveDropActions`).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

---

### Task 4: Propagation fills

**Files:**
- Create: `Plexus/src/renderer/src/modules/architecture-projects/services/arch-propagate.ts`
- Test: `Plexus/src/renderer/src/modules/architecture-projects/services/tests/arch-propagate.test.ts`

**Interfaces:**
- Consumes: `conceptTypeOf`, `acceptSet` (Task 1). Uses `repo.effectiveRelationships(id): Map<string, string[]>` and `repo.effectiveSchema(id).relationships` — **verify both exist on the installed `@pragmatic-lab/todl` before implementing** (they are in `TODL/src/model/model.ts`; a quick `node -e` import check or the failing test will confirm).
- Produces: `interface PropFill { member: string; term: string }`; `propagationFills(repo, targetConcept, termId, primaryMember): PropFill[]`.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'vitest'
import { load } from '@pragmatic-lab/todl'
import { propagationFills } from '../arch-propagate.js'

const MM = `namespace m {
  concept category {}
  concept technology { relationship applicableTo -> category; }
  concept component {
    relationship implementedBy -> technology;
    relationship categorisedAs -> category;
  }
  taxonomy Cats : represents category { term ai {} }
  taxonomy Stack : represents technology { term azure { applicableTo = Cats.ai; } }
}`
function repo() { return load([{ uri: 'm.todl', text: MM }]).model }

test('back-fills categorisedAs from the technology term’s own applicableTo ref', () => {
    expect(propagationFills(repo(), 'component', 'Stack.azure', 'implementedBy'))
        .toEqual([{ member: 'categorisedAs', term: 'Cats.ai' }])
})

test('the primary member is never back-filled', () => {
    // Drop the category itself as primary; its own refs (none of type technology)
    // must not touch implementedBy, and must not re-fill categorisedAs.
    expect(propagationFills(repo(), 'component', 'Cats.ai', 'categorisedAs')).toEqual([])
})

test('a ref matching more than one empty member is skipped (no guess)', () => {
    const AMBIG = `namespace m {
      concept category {}
      concept technology { relationship applicableTo -> category; }
      concept component {
        relationship implementedBy -> technology;
        relationship primaryCat -> category;
        relationship secondaryCat -> category;
      }
      taxonomy Cats : represents category { term ai {} }
      taxonomy Stack : represents technology { term azure { applicableTo = Cats.ai; } }
    }`
    const r = load([{ uri: 'm.todl', text: AMBIG }]).model
    expect(propagationFills(r, 'component', 'Stack.azure', 'implementedBy')).toEqual([])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-propagate.test.ts`
Expected: FAIL — cannot find module `../arch-propagate.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { type Repository } from '@pragmatic-lab/todl'
import { conceptTypeOf, acceptSet } from './arch-concept-type.js'

export interface PropFill { member: string; term: string }

// After a term is wired into `primaryMember` of a freshly created `targetConcept`,
// back-fill the term's OWN references onto the concept's other still-empty members:
// for each ref value the term carries, if exactly one empty member accepts that
// value's type, fill it. Zero or several matches → skip (deterministic).
export function propagationFills(repo: Repository, targetConcept: string, termId: string, primaryMember: string): PropFill[]
{
    const rels = repo.effectiveSchema(targetConcept).relationships
    const filled = new Set<string>([primaryMember])
    const out: PropFill[] = []
    for (const [, targets] of repo.effectiveRelationships(termId)) {
        for (const tgt of targets) {
            const accept = acceptSet(repo, conceptTypeOf(repo, tgt))
            const matching = rels.filter((r) => !filled.has(r.name) && r.targets.some((t) => accept.has(t)))
            if (matching.length !== 1) continue
            out.push({ member: matching[0].name, term: tgt })
            filled.add(matching[0].name)
        }
    }
    return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-propagate.test.ts`
Expected: PASS (3 tests). If the first test returns `[]`, confirm a taxonomy term can carry a relationship value (`term azure { applicableTo = Cats.ai; }`) and that `repo.effectiveRelationships('Stack.azure')` includes `applicableTo → ['Cats.ai']`; adjust the term-ref reading if the installed API differs.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

---

### Task 5: Icon precedence from propagation direction

**Files:**
- Modify: `Plexus/src/renderer/src/modules/architecture-projects/services/arch-icon.ts` (rewrite `iconEntityKey`)
- Test: `Plexus/src/renderer/src/modules/architecture-projects/services/tests/arch-icon.test.ts` (new)

**Interfaces:**
- Consumes: `repo.effectiveRelationships(id)` (Task 4 dependency), `Entity.schema()`, `Entity.refs(member)`, `Entity.type()`.
- Produces: `iconEntityKey(repo: Repository, entity: Entity): string | undefined` — unchanged signature; used by `arch-diagram-binding.ts:45`.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-lab/todl'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { ArchModel } from '../arch-model.js'
import { iconEntityKey } from '../arch-icon.js'

// component lists categorisedAs BEFORE implementedBy, so raw schema order would
// pick the category. Propagation direction must override that: the technology
// term references the category term, so the technology wins the icon.
const MM = `namespace m {
  concept category {}
  concept technology { relationship applicableTo -> category; }
  concept component {
    relationship categorisedAs -> category;
    relationship implementedBy -> technology;
  }
  taxonomy Cats : represents category { term ai {} }
  taxonomy Stack : represents technology { term azure { applicableTo = Cats.ai; } }
  viewpoint V : frames component
}`

function modelWithIcons(iconIds: string[]): ArchModel {
    const mmDoc = toJSON(load([{ uri: 'm.todl', text: MM }]).model)
    for (const id of iconIds)
        mmDoc.nodes.push({ id: `${id}@icon`, tier: 'Ontology', typeOf: 'icon', attrs: { path: `${id}.svg` } })
    const baseRepo = new Repository(graphFromJSON(mmDoc))
    const file = { uri: 'model.todl', text: 'namespace m { model A : m conforms V { component c1 { categorisedAs = Cats.ai; implementedBy = Stack.azure; } } }' }
    const draft = ModelDraft.fromSources([baseRepo], [file], { namespace: 'm' })
    return new ArchModel(draft, new FakeStorage('fake://A'), 'm')
}

test('the propagation source (technology) outranks the back-filled category, beating schema order', () => {
    const model = modelWithIcons(['Stack.azure', 'Cats.ai'])
    const c1 = model.entities().find((e) => e.id === 'c1')!
    expect(iconEntityKey(model.repository(), c1)).toBe('Stack.azure')
})

test('with no propagation link, the first icon-bearing member in schema order wins', () => {
    // Only the category carries an icon here → it is the sole candidate.
    const model = modelWithIcons(['Cats.ai'])
    const c1 = model.entities().find((e) => e.id === 'c1')!
    expect(iconEntityKey(model.repository(), c1)).toBe('Cats.ai')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-icon.test.ts`
Expected: FAIL — current `iconEntityKey` returns `Cats.ai` (schema order) for the first test, not `Stack.azure`.

- [ ] **Step 3: Write the implementation** (replace the file)

```ts
import type { Entity, Repository } from '@pragmatic-lab/todl'

// The entity key whose icon a bound canvas node should draw — an id the presentation
// registry's index (registry.iconKeyFor) maps to a baked resource key, the SAME index
// the toolbox tiles resolve through. Returns undefined when nothing carries an icon
// (→ the node falls back to its concept, i.e. the default glyph).
//
// "Has an icon" is detected by the `<id>@icon` annotation node the meta-model/library
// source declares. Precedence: a referenced term wins over the entity's own type. When
// several referenced terms carry icons, the winner is decided by PROPAGATION DIRECTION —
// a term that references another candidate term (its propagation source) outranks it —
// reproducibly from the saved refs. Ties (no propagation link) fall back to schema order.
export function iconEntityKey(repo: Repository, entity: Entity): string | undefined
{
    const hasIcon = (id: string): boolean => {
        const path = repo.resolve(`${id}@icon`)?.attrs.get('path')
        return typeof path === 'string' && path.length > 0
    }

    // Filled, icon-bearing referenced terms, in schema relationship order.
    const candidates: string[] = []
    for (const rel of entity.schema().relationships)
        for (const target of entity.refs(rel.name))
            if (hasIcon(target.id)) candidates.push(target.id)

    if (candidates.length === 0) {
        const own = entity.type()?.id ?? entity.concept
        return hasIcon(own) ? own : undefined
    }
    if (candidates.length === 1) return candidates[0]

    // Rank by propagation direction: term A outranks B when A references B.
    const set = new Set(candidates)
    const refsOf = (id: string): Set<string> => {
        const s = new Set<string>()
        for (const [, targets] of repo.effectiveRelationships(id))
            for (const t of targets) s.add(t)
        return s
    }
    const outDegree = (term: string): number => {
        const refs = refsOf(term)
        let n = 0
        for (const other of set) if (other !== term && refs.has(other)) n++
        return n
    }
    // Highest out-degree (most "source") wins; ties keep schema order (first seen).
    let winner = candidates[0]
    let best = outDegree(winner)
    for (const term of candidates.slice(1)) {
        const d = outDegree(term)
        if (d > best) { winner = term; best = d }
    }
    return winner
}
```

- [ ] **Step 4: Run test + the binding test (regression on the icon call site)**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-icon.test.ts src/renderer/src/modules/architecture-projects/services/tests/arch-diagram-binding.test.ts`
Expected: PASS. The binding test's single-referenced-term icon case still resolves to `Stack.azure` (one candidate → returned directly).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

---

### Task 6: Apply propagation in the drop factory

**Files:**
- Modify: `Plexus/src/renderer/src/modules/architecture-projects/services/arch-instance-drop-factory.ts` (the `apply()` method)
- Test: `Plexus/src/renderer/src/modules/architecture-projects/services/tests/arch-instance-drop-factory.test.ts` (extend the existing file — reuse its `wire`/`ctx` helpers)

**Interfaces:**
- Consumes: `propagationFills` (Task 4), `materializeOf` (Task 2), `conceptTypeOf` (Task 1). Existing `wire(doc, model)` and `ctx(doc, key)` helpers in the test file.
- Produces: no signature change; `apply()` additionally wires propagation fills after the primary ref.

- [ ] **Step 1: Write the failing test** (append to the existing test file; all identifiers it uses — `load`, `toJSON`, `Repository`, `graphFromJSON`, `ModelDraft`, `FakeStorage`, `ArchModel`, `DiagramDocument`, `ArchInstanceDropFactory`, `ArchNodeVM`, `wire`, `ctx` — are already imported/defined in that file)

```ts
const PROP_MM = `namespace archmm {
  annotation materialize { concept : identifier?; via : identifier?; propagate : boolean?; }
  concept category {}
  concept technology { relationship applicableTo -> category; }
  concept component {
    annotate materialize {}
    relationship implementedBy -> technology;
    relationship categorisedAs -> category;
  }
  viewpoint ComponentView : frames component
  taxonomy Cats : represents category { term ai {} }
  taxonomy Stack : represents technology { term azure { applicableTo = Cats.ai; } }
}`

function buildPropModel(storage: FakeStorage): ArchModel {
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: PROP_MM }]).model)))], [], { namespace: 'archmm' })
    return new ArchModel(draft, storage, 'archmm')
}

test('dropping a technology wires the primary member AND back-fills the category by propagation', () => {
    const storage = new FakeStorage('fake://Acme')
    const model = buildPropModel(storage)
    const doc = new DiagramDocument()
    const factory = new ArchInstanceDropFactory(wire(doc, model))

    const result = factory.CreateDropped(ctx(doc, 'Stack.azure')) as ArchNodeVM
    expect(result).toBeInstanceOf(ArchNodeVM)
    const comp = model.entities().find((e) => e.concept === 'component')!
    // Primary member wired to the dropped technology term.
    expect(model.repository().refs(comp.id, 'implementedBy')).toContain('Stack.azure')
    // Category back-filled from the technology term's own applicableTo ref.
    expect(model.repository().refs(comp.id, 'categorisedAs')).toContain('Cats.ai')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-instance-drop-factory.test.ts`
Expected: FAIL — the new test's `categorisedAs` assertion fails (propagation not applied yet); the three existing tests still pass.

- [ ] **Step 3: Modify `apply()`** — add the propagation step after the existing reference wiring.

Find, in `arch-instance-drop-factory.ts`, the block:

```ts
        if (action.kind === DropActionKind.Reference && action.member !== undefined && action.term !== undefined)
            model.addRef(entity.id, action.member, action.term)
```

Replace it with:

```ts
        if (action.kind === DropActionKind.Reference && action.member !== undefined && action.term !== undefined) {
            model.addRef(entity.id, action.member, action.term)
            // Propagate the dropped term's own references onto the instance's other
            // empty members (technology → its category, etc.). Gated by the effective
            // materialize.propagate flag (term → facet concept → root), default true.
            const ct = conceptTypeOf(model.repository(), action.term)
            const propagate = materializeOf(model.repository(), action.term)?.propagate
                ?? materializeOf(model.repository(), ct)?.propagate
                ?? materializeOf(model.repository(), action.concept)?.propagate
                ?? true
            if (propagate)
                for (const fill of propagationFills(model.repository(), action.concept, action.term, action.member))
                    model.addRef(entity.id, fill.member, fill.term)
        }
```

Add the imports at the top of the file:

```ts
import { propagationFills } from './arch-propagate.js'
import { materializeOf } from './arch-materialize.js'
import { conceptTypeOf } from './arch-concept-type.js'
```

- [ ] **Step 4: Run the factory test to verify pass + no regression**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-instance-drop-factory.test.ts`
Expected: PASS (4 tests — 3 existing + 1 new).

- [ ] **Step 5: Full Plexus test run + typecheck**

Run: `npx vitest run` then `npm run typecheck`
Expected: whole suite green, no type errors.

---

### Task 7: Migrate the `tech-architecture` meta-model + live smoke

**Files (external authoring repo):** `c:\Users\Eugene\Projects\plexus_tests\meta-models\tech-architecture\` — `concepts/component.todl`, `concepts/technology.todl`, `concepts/category.todl`, `taxonomies/*.todl`, and wherever namespace-level `annotation` declarations live.

**Note:** This task is meta-model authoring + republish + live verification (no headless unit test). It depends on the meta-model project's publish flow, which the user drives (like the mural republish). Its "test" is a live drop in the running Plexus app.

- [ ] **Step 1: Read the current concept + taxonomy sources** to confirm member names (`implemented_by`, `realised_by`, `applicable_to`, etc.) before editing. Open `concepts/component.todl`, `concepts/technology.todl`, `concepts/category.todl`.

- [ ] **Step 2: Declare the annotation** (namespace level, once):

```todl
annotation materialize { concept : identifier?; via : identifier?; propagate : boolean?; }
```

- [ ] **Step 3: Mark the root** — add `annotate materialize {}` to `concept component`.

- [ ] **Step 4: Ensure the category facet member exists** on `component` (the design's back-fill target). If `component` has no category-typed relationship, add one, e.g.:

```todl
relationship categorised_as -> category?;
```

Confirm `technology` carries a category-typed reference (the propagation source — the report shows `applicable_to : categories[]`); if `applicable_to` is the intended source, ensure its target type is the `category` concept the new `component` member accepts.

- [ ] **Step 5: Curate the toolbox** — confirm only materializable taxonomies carry `annotate toolbox { visible = true }`. Non-placeable classifier taxonomies stay unmarked (author-driven curation; see the "Deferred" note below).

- [ ] **Step 6: Republish** the meta-model through the meta-model project publish flow, then restart the Plexus dev server so the renderer picks up the new published package.

- [ ] **Step 7: Live smoke** — open an architecture diagram and verify:
  - Dropping a category term creates a `component` with its category member filled (no chooser dialog).
  - Dropping a technology term creates a `component` with the technology member filled AND the category back-filled, and the node draws the **technology** icon (not the category icon).
  - No multi-candidate chooser appears for the migrated taxonomies.

---

## Deferred (out of scope, per the spec)

- Automatic runtime toolbox filtering of non-materializable terms — curation stays author-driven via the existing `toolbox` annotation (Task 7 Step 5). A runtime `isMaterializable` filter can be added later if authored curation proves insufficient.
- The multi-candidate chooser (`DropCandidateChooserService`) is left in place as the ambiguity safety net; a meta-model diagnostic on genuine multi-root ambiguity is a later addition.
- Per-member propagation control (`propagate-only`/`-except`), multi-target `materialize`, non-relationship `via`, and a friendlier `as` alias for the `concept` param.
- Direct-instance propagation (a directly-materialized root inherits its term's class refs already; explicit propagation for that path is not needed now).

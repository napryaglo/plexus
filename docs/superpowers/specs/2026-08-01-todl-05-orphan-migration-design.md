# TODL 0.5.0 Orphan Migration Design

**Status:** design complete, pending user review
**Target:** Plexus (consumes `@pragmatic-lab/todl` 0.5.0)
**Date:** 2026-08-01

## 1. Goal

Restore Plexus to a green suite and fix a live product regression introduced when
Plexus bumped to `@pragmatic-lab/todl` 0.4.0/0.5.0. The model-first-class rule now
requires every concrete instance to be declared inside a `model { }` block
(diagnostic `instance.orphan`), and two Plexus subsystems still emit/author
top-level instances, producing **invalid TODL** — 5 failing tests and real broken
saves/publishes:

- **Part A — architecture-repository emitter/loader.** `emitInstances` writes
  `namespace X { <instances> }` with no `model` wrapper, so every saved
  `.archdiagram` emits orphaned instances. (`todl-emitter.test.ts` ×2.)
- **Part B — meta-model descriptor.** The `meta-model <name> { … }` descriptor is a
  concrete instance (concept `meta-model`), now orphaned. (`meta-model-project-factory.test.ts` ×3.)

The two are independent (no shared code) but bundled here as one migration; the
plan keeps them as separate task groups.

## 2. Locked decisions

- **Part A wraps concrete instances in a `model` block**; locally-declared `class`
  nodes stay **top-level** (they are exempt from the orphan rule, and the TODL
  `model` body does **not** accept `class` declarations — verified empirically:
  `class` inside a model body is a syntax error).
- **Bindings derived from the bases + the project's own namespace.** The meta-model
  slot is the first (sorted) distinct `namespace` attr across the **base** nodes;
  `uses` is the remaining base namespaces plus the project's own namespace (so local
  `class` constructors stay in scope), sorted. The project namespace never occupies
  the meta-model slot. `validateModel` makes no meta-model-vs-library distinction —
  it only requires every bound name to be present in the merged doc — so this is
  robust with no binding metadata threaded in. Verified: the emitted forms compile
  clean via `checkAgainst`.
- **Load strips the model container node.** A `model` declaration compiles to an
  Instance-tier node (`typeOf: 'model'`, `attrs { meta-model, uses.0… }`) linked to
  its instances by `Contains` edges. `ArchInstanceModel.load` strips that node and
  its `Contains` edges alongside the base-id filter, so `own` stays instances +
  local classes exactly as before — no `ownInstances`/canvas/layout change.
- **Part B drops the descriptor** (no consumer; identity already lives in
  `project.plexus` + the SP2 `manifest.json`). Remove it from the scaffold guide,
  the TODL manual, and the test fixtures. No reintroduction of
  `root-concept`/`top-level-concepts` until a real consumer exists.
- **No TODL changes.** The `model` construct and the orphan rule are consumed as-is.

## 3. Part A — components

### A1. `deriveBindings` (new)

```ts
export interface ModelBindings { metaModel: string; uses: string[] }

// metaModel = the first (sorted) distinct `namespace` attr across the BASE nodes.
// uses = the remaining base namespaces plus `namespace` (the project's own — so
// locally-declared `class` constructors are in scope), sorted. The project
// namespace is never the meta-model slot. With no bases, metaModel = namespace and
// uses = [].
export function deriveBindings(bases: readonly TodlDocument[], namespace: string): ModelBindings
```

Lives with the emitter (`todl-emitter.ts`) so the pure emit path owns its own
binding computation; called by `ArchInstanceModel.emit()`.

### A2. `emitInstances(own, namespace, bindings)`

Signature gains `bindings: ModelBindings`. Output:

```
namespace <ns>
{
  class <concept> <id> { … }          // local classes: top-level, orphan-exempt
  model <ns>-model : <metaModel> [uses <u1>, <u2>, …] {
    <concept> <id> [instanceof <cls>] { … }   // concrete instances, wrapped
  }
}
```

- Local `class` nodes (own Instance-tier with `attrs.class === true`) are emitted
  at top level, exactly as today (so `instanceof` targets exist and stay in scope).
- Concrete instances (own Instance-tier, not class) are emitted inside a
  `model <ns>-model : <bindings> { }` block.
- The model id is `${namespace}-model` (deterministic; `namespace` is
  lowercase-kebab so the id is valid and won't collide with `freshId`'s
  `<stem>-<seq>` ids).
- `uses` clause is emitted only when `bindings.uses` is non-empty.
- If there are **no** concrete instances, the model block is omitted entirely (a
  classes-only or empty namespace — no empty `model { }`).

### A3. `ArchInstanceModel`

- `emit()` → `emitInstances(this.own, this.namespace, deriveBindings(this.bases, this.namespace))`.
- `load()` → after `checkAgainst`, compute the container ids
  (`full.nodes.filter(n => n.typeOf === 'model').map(n => n.id)`) and exclude them
  from `own.nodes`, and exclude edges whose `from` is a container id, alongside the
  existing base-id filters:

  ```ts
  const modelIds = new Set(full.nodes.filter((n) => n.typeOf === 'model').map((n) => n.id))
  own = {
      nodes: full.nodes.filter((n) => !baseIds.has(n.id) && !modelIds.has(n.id)),
      edges: full.edges.filter((e) => !baseIds.has(String(e.from)) && !modelIds.has(String(e.from))),
  }
  ```

  `own` therefore holds exactly the instances + local classes + their
  Relationship/InstanceOf edges, as before the migration.

## 4. Part B — descriptor drop

- **`scaffold/meta-model-guide.md`** — remove the "## The descriptor record" section
  (the `meta-model my-mm { … }` block). Identity is covered by the manifest.
- **`scaffold/todl-manual.md`** — remove "## 7. The `meta-model` descriptor" and the
  later `meta-model my-mm { … }` example. Keep the `: <meta-model>` model-binding
  line (that describes the valid `model` construct, not the descriptor).
- **`tests/meta-model-project-factory.test.ts`** — the 3 failing tests write
  `CONCEPTS + EA` where `EA` is the orphaned descriptor fixture. Drop `EA` from
  those tests (they publish `CONCEPTS` alone — clean) and remove the now-unused
  `EA` const.
- `scaffold/new-concept.md` mentions only "meta-model project" generically — no change.

## 5. Data flow (Part A round-trip)

```
own {instances + classes}
   │ emit()
   ▼
deriveBindings(bases, ns) → { metaModel, uses }
   │
emitInstances(own, ns, bindings)
   → namespace ns { class… ; model ns-model : meta uses … { instances } }
   │ (persisted / re-loaded)
   ▼
ArchInstanceModel.load(bases, source, ns)
   → checkAgainst(bases, source) → full
   → strip base ids + model-container ids (+ their Contains edges)
   → own' {instances + classes}   ===  own   (round-trip invariant)
```

## 6. Error handling

- **No concrete instances** — `emitInstances` omits the model block; a classes-only
  or empty namespace is valid.
- **No bases** — `deriveBindings` binds the project namespace alone; degenerate but
  valid (in practice an arch diagram always has a meta-model base).
- **Load of legacy top-level source** — a pre-migration saved `.archdiagram` (no
  `model` wrapper) would now fail `checkAgainst` with `instance.orphan`. Existing
  documents must be re-saved through the migrated emitter; this is a known
  one-time migration cost, consistent with the 0.5.0 rule. (No automatic rewrite in
  scope.)

## 7. Testing

Vitest, `tests/` subfolders:

- **`deriveBindings`** — bases spanning `ea`/`ms` + project `app` →
  `{ metaModel: 'ea', uses: ['app', 'ms'] }` (sorted, self included); no bases →
  `{ metaModel: 'app', uses: [] }`.
- **`todl-emitter`** — the 2 existing round-trip tests: pass `bindings`; update the
  test's `ownOf` helper to also strip the `model` container node + its `Contains`
  edges (mirroring `ArchInstanceModel.load`), so `own' === own` holds; add
  assertions that the emitted source contains a `model … : ea uses …` block and
  that a local `class` remains top-level (outside the model block). These go green.
- **`architecture-instance-model`** — a load→emit→load round-trip over a
  model-wrapped source: `ownInstances()` excludes the container; `own` matches
  after a round-trip.
- **`meta-model-project-factory`** — the 3 tests go green once `EA` is dropped.
- Full suite returns to **zero failures**; typecheck clean.

## 8. Out of scope

- Any TODL change (the `model`/orphan rule consumed as-is).
- Reintroducing `root-concept`/`top-level-concepts` (dropped until a consumer
  exists; if the meta-model browser needs them later, they return as a package
  annotation).
- Automatic rewrite of legacy top-level `.archdiagram` sources (one-time re-save).
- The `$Type` canvas hop and the icon-path→geometry converter (unrelated deferred
  slices).

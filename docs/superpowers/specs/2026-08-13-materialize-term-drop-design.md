# Materialize-Driven Term Drop — Design

**Status:** ✅ Approved (brainstorm complete). No implementation started.

**Supersedes:** `2026-08-03-annotation-driven-term-drop-design.md` (the earlier
`instance`-annotation backlog sketch, written before the current
viewpoint-scoped resolver). This doc modernizes that direction and renames the
annotation to `materialize`.

**Owner context:** Follows arch-canvas Phase 3 (`.archdiagram` concept-aware
editor) and the viewpoint-scoped drop resolver. Replaces runtime *inference* of
what a dropped term creates with an author-declared, meta-model-level fact.

---

## Problem

Dropping a toolbox term onto an `.archdiagram` currently runs
`resolveDropActions` ([arch-drop-resolver.ts](../../../src/renderer/src/modules/architecture-projects/services/arch-drop-resolver.ts)),
which *infers* candidate actions by scanning **every** concept in scope for a
relationship whose target accepts the dropped term's class. That scan is
inherently ambiguous:

- A term that can legally fill several concepts' members yields several
  candidate actions → the **multi-candidate chooser dialog** fires
  ([drop-candidate-chooser-service.ts](../../../src/renderer/src/modules/architecture-projects/services/drop-candidate-chooser-service.ts)).
  The user resolves at drop time what the author already knows.
- A term that fills *nothing* yields zero actions → a **silent no-op drop** (no
  shape appears), because nothing declares the term non-placeable.
- Icon selection ([arch-icon.ts](../../../src/renderer/src/modules/architecture-projects/services/arch-icon.ts))
  breaks ties among filled reference members by **raw schema relationship
  order**. Once a drop fills more than one facet (see propagation below), the
  icon can silently disagree with what the user dropped.

The author knows what a dropped term should become; the code guesses. The fix is
to move that knowledge into the meta-model.

## Goal

Let the meta-model author **declare** what a dropped term materializes and how it
references the term — turning drop resolution from a schema scan into a
deterministic lookup, and unifying drop target, reference back-fill, and icon
selection under one mechanism. Authoring stays minimal: a bare marker plus
schema-derived inference covers the common case; explicit fields override only
where the author deviates.

## The `materialize` annotation

A Plexus-recognized annotation the meta-model declares, with **all params
optional**. TODL needs no changes — annotations are already a general, typed,
inheritable, term-attachable mechanism; `materialize` is a per-meta-model
convention Plexus reads through the repository, exactly like the presentation
`icon`/`label` annotations.

```todl
namespace tech-architecture
{
    annotation materialize {
        concept   : identifier?;   // target concept to CREATE on drop
        via       : identifier?;   // member on `concept` that receives &term
        propagate : bool?;         // back-fill the term's own refs (default true)
    }

    concept component {
        annotate materialize {}    // bare marker: component is a drop-created root
        label          : string;
        category       : category?;      // a `categories` term lands here
        implemented-by : technology?;    // a `technology` term lands here
    }
}
```

Three placements, increasing specificity, each optional:

- **Bare marker on a root** (`component`) → "this concept is created by drops";
  members and propagation are inferred entirely from the schema. This is the
  common case, usually the only thing authored.
- **Override on a facet concept** (`annotate materialize { concept = application }`
  on `category`) → deviates the target/member for that whole taxonomy.
- **Override on a term** (annotate-on-term, already supported) → per-term
  divergence (some `categories` terms → `application`, others → `component`).

The effective annotation for a dropped term is resolved most-specific-first:
term → facet concept → target root.

## Resolution engine

`resolveDropActions` is replaced by a deterministic lookup. Reference members are
**relationships** (matching the current resolver and `iconEntityKey`; non-
relationship fields are out of scope). For a dropped term `T` with class
`ct = classOf(T) ?? represents(typeOf)[0] ?? typeOf` and viewpoint `scope`:

1. **Target concept `P`:**
   1. term-level `materialize.concept`, else
   2. facet-concept (`ct`)-level `materialize.concept`, else
   3. if `ct` (or a supertype) itself carries a `materialize` marker → `P = ct`
      (direct instance, no `via`), else
   4. the `materialize`-marked concept in `scope` whose relationship accepts `ct`.
2. **Primary member `m`:** `materialize.via` if set, else the single relationship
   on `P` whose target accepts `ct`. Direct instances (1.3) have no `m`.
3. **Determinism / fallback:** if step 1.4 yields more than one marked concept, or
   step 2 yields more than one accepting member with no override, the
   multi-candidate chooser fires **and** a meta-model diagnostic is emitted (this
   is an authoring smell). A well-authored model produces exactly one action, so
   the dialog disappears from normal use.
4. **Non-placeable:** no `P` → the term is not materializable → the toolbox
   filters it (no silent no-op).

Create `P` in a framing viewpoint, wire `m = &T`, propagate, label, persist —
the existing `apply()` path in
[arch-instance-drop-factory.ts](../../../src/renderer/src/modules/architecture-projects/services/arch-instance-drop-factory.ts),
essentially unchanged apart from the added propagation step.

## Propagation

After wiring `m = &T`, the engine walks the dropped term `T`'s **own** references
and back-fills matching empty members of the new instance `P`:

- For each relationship `R` the term `T` carries with value `v`: find an **empty**
  relationship member `m'` on `P` (`m' ≠ m`) whose target accepts `typeOf(v)`.
- Exactly one such `m'` → set `m' = &v`. Zero or more than one → **skip** (no
  guessing; deterministic, no silent wrong-fill).
- One level deep; no recursion.
- Gated by the effective `materialize.propagate` (default `true`);
  `propagate = false` on the term/facet/root suppresses it.

Example: dropping a `technology` term `azure-openai` into `component.implemented-by`
back-fills `component.category = &ai-services` because the term itself references
`ai-services`.

## Icon precedence

`iconEntityKey` ([arch-icon.ts](../../../src/renderer/src/modules/architecture-projects/services/arch-icon.ts))
stops using raw schema order. Precedence is **derived from propagation
direction**, reproducibly from the saved model alone (no stored drop-origin). For
a saved entity `E`:

1. **Candidates:** filled relationship members of `E` whose target term carries an
   `@icon` annotation.
2. **Direction:** member `A` outranks member `B` when `A`'s term references `B`'s
   term (i.e. `A` propagates into `B`). A source member outranks the members it
   feeds.
3. **Winner:** the highest-ranked candidate's target term supplies the IconKey.
   Among candidates with no propagation relationship, fall back to schema order
   (today's behavior). If no candidate, the entity's own concept if it has an
   `@icon`, else `undefined` (default glyph).

So a `component` built from a dropped technology (with `category` back-filled)
draws the **technology** icon — because `implemented-by`'s term references
`category`'s term — every time it loads, with nothing extra persisted.

## Shared data dependency

Both propagation and icon precedence need to read a **term's outgoing
references** from the repository. `iconEntityKey` already reads
`entity.refs(rel.name)` on the instance; the new work also reads a *library
term's* outgoing refs (e.g. `azure-openai → ai-services`). Verify this
repository capability early in planning — it is the one nontrivial dependency.

## Legacy fallback

A meta-model that declares **zero** `materialize` markers keeps today's
scan-and-chooser behavior. The new engine engages only once a model declares at
least one marker, so nothing breaks before migration.

## Affected components

- **[arch-drop-resolver.ts](../../../src/renderer/src/modules/architecture-projects/services/arch-drop-resolver.ts)** —
  rewrite to the `materialize` lookup engine (steps 1–4).
- **[arch-instance-drop-factory.ts](../../../src/renderer/src/modules/architecture-projects/services/arch-instance-drop-factory.ts)** —
  add the propagation step to `apply()`; keep viewpoint framing + persistence.
- **[arch-icon.ts](../../../src/renderer/src/modules/architecture-projects/services/arch-icon.ts)** —
  precedence from propagation direction.
- **Toolbox** — filter terms that resolve to no action (non-materializable) from
  the palette (locate the toolbox/term-source service in planning).
- **`tech-architecture` meta-model** (authoring, republish) — declare
  `annotation materialize`, mark `component` (and any other roots), ensure the
  facet relationship members exist, and ensure facet terms carry their cross-refs
  (technology → category) so propagation has data.
- **Chooser** — retained only as the ambiguity safety net; add the multi-match
  diagnostic.
- **TODL** — no changes expected (annotations are general); confirm during
  planning.

## Testing

- Resolver determinism: each facet type → exactly one action; direct vs facet
  placement; term/facet/root override precedence.
- Propagation: single type-match back-fills; zero/multi-match skips; `propagate =
  false` suppresses.
- Icon precedence recomputed from the **saved** model: drop technology with
  category back-filled → technology icon; no-propagation ties fall back to schema
  order; concept-own-icon and default-glyph fallbacks.
- Toolbox filtering hides non-materializable terms.
- Legacy fallback: a marker-less meta-model keeps scan+chooser behavior.

## Deferred (YAGNI)

- Per-member propagation control (`propagate-only`/`propagate-except` lists) — a
  boolean covers the current need.
- A `materialize` annotation listing several target concepts (multi-target) — the
  chooser fallback covers genuine multi-placeable cases.
- Non-relationship (field) reference members as `via` — relationships only.
- A friendlier `as` alias for the `concept` param — pending a TODL keyword check;
  `concept` is the safe default.

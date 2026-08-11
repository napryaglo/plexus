# SP5 — Plexus consumers for TODL 0.24 (reference integrity) — Design

**Date:** 2026-08-11
**Branch:** `feat/sp5-todl-0.24-consumers` (off Plexus `main`)
**Program:** reference-integrity fix, sub-project 5 of 5 — the consumer side. SP1 (union relationship targets), SP2 (tech-architecture meta-model retype, `@pragmatic-lab/todl@0.24.0` published to Verdaccio), SP3 (data migration quoted→bare), SP4 (edge-record cleanup) all landed on TODL `main`.

## Goal

Bring Plexus onto `@pragmatic-lab/todl@^0.24.0` and update the one consumer the
SP1 `RelationshipSchema.target → targets[]` change breaks, and fix the
arch drop factory so a dropped entity satisfies its meta-model's required
`label` field. Then republish tech-architecture from the app (manual smoke).

## Why this is small (measured)

An audit of Plexus found the SP1-breaking surface is tiny:
- **One** relationship-schema `.target` reader: `arch-drop-resolver.ts:39`
  (`accept.has(rel.target)`). It will not compile against 0.24.0.
- `deriveClasses` is **fully delegated** to TODL core
  (`library-bundle.ts` imports `deriveClasses`/`PublishedClass` from
  `@pragmatic-lab/todl`); the relationship-target logic lives in TODL, already
  SP1-updated. No Plexus change.
- **No test** reads relationship `.target` (matches are layout `source`/`target`
  routing and a mock signature).
- The arch model is emitted via TODL's `ModelDraft.toTodlByFile()`
  (`arch-model.ts:89`), which is type-directed (bare refs) and — post-SP4 —
  never injects `operator`. So "emit bare / no operator on regeneration" is
  satisfied by the version bump, **not** by Plexus code.

The `label` bug is separate: the drop factory creates an entity but never sets
its required `label`, so the model fails validation
("required component.label is missing"). The *visual* label already falls back
`label → name → id` (`arch-diagram-binding.ts:82 displayLabel`), so only the
**model data field** is missing.

## Section 1 — Version bump + the forced fix

- `package.json`: `@pragmatic-lab/todl` `^0.23.0` → `^0.24.0`; reinstall from
  Verdaccio (`http://localhost:4873/`).
- `arch-drop-resolver.ts:39`: replace
  ```ts
  if (accept.has(rel.target))
  ```
  with the union-aware form
  ```ts
  if (rel.targets.some((t) => accept.has(t)))
  ```
  Semantics: a dropped term is a valid reference-drop target for member `m` when
  the term's type matches **any** of `m`'s union targets (or a subtype — the
  `accept` set already includes supertypes of the term's class).

## Section 2 — Default `label` on drop

The dropped entity must carry a valid `label`. Fix in
`arch-instance-drop-factory.ts` `apply(...)`, after `createInViewpoint`:

- Add a pure helper `defaultLabel(repo: Repository, action: DropAction): string`:
  - **Reference drop** (`action.term` set): the term node's `label` attr
    (`repo.resolve(action.term)?.attrs.get('label')`) if a non-empty string,
    else `humanize(lastSegment(action.term))`.
  - **Instance drop:** `humanize(action.concept)`.
- Add `humanize(id: string): string` — take the last `.`-segment, split on
  `_`/`-`, title-case each word, join with a space
  (`m365_copilot` → `M365 Copilot`; `component` → `Component`).
- In `apply`, guard on the concept declaring a `label` field:
  ```ts
  const schema = model.repository().effectiveSchema(action.concept)
  if (schema.fields.some((f) => f.name === 'label'))
      model.setField(entity.id, 'label', defaultLabel(model.repository(), action))
  ```
  (`ArchModel.setField(id, name, value)` exists — `arch-model.ts:70`.) Set the
  label **before** `notifyChanged()` so the rescan's `displayLabel` reads the new
  `label`, and before `save()` so the persisted `.todl` carries it.

`defaultLabel` and `humanize` are exported from a small module
(`arch-default-label.ts`) so they are unit-testable in isolation.

## Section 3 — Verification

Plexus uses **vitest** (`npm test` → `vitest run`); typecheck is
`npm run typecheck` (node + web).

- **Unit — union resolver:** `resolveDropActions` is pure over a `Repository`.
  Build the repo the way existing arch tests do (`checkAgainst`/
  `ModelDraft.fromSources` from `@pragmatic-lab/todl` — see
  `services/tests/arch-diagram-binding-*.test.ts`): a concept `edge` with
  `relationship end -> actor | component;`, a viewpoint framing `edge`, plus
  `actor`/`component` concepts and instances. Assert a dropped `component` term
  yields a `Reference` action for `edge.end`, and a term of an unrelated type
  yields none. Proves union membership (`.targets.some`), not single-target.
- **Unit — default label:** `defaultLabel`/`humanize` — reference drop with a
  labelled term → the term's label; reference drop with an unlabelled term →
  humanized id; instance drop → humanized concept; `humanize('m365_copilot')`
  → `'M365 Copilot'`.
- **Gate — typecheck:** `npm run typecheck` passes (the forcing function — the
  0.24.0 `.targets` type breaks the old `.target`; green proves the bump +
  resolver fix are consistent, and no other consumer regressed).
- **Gate — full suite:** `npm test` green.
- **Manual smoke (deferred, needs Electron):** open the tech-architecture
  meta-model project, **republish** it (regenerates any published/compiled
  artifact under 0.24.0), then in an architecture project drop a library term
  onto a diagram and confirm: a chooser/auto action appears (union routing
  works), the created entity has a sensible `label`, and save produces bare refs
  with no `operator`. The arch editor loads the meta-model from `.todl` source
  via `ModelDraft.fromSources` (`architecture-model-service.ts:46`), so the
  bundled 0.24.0 compiles it directly; republish is for completeness.

## Out of scope

- `connector.type` (undeclared quoted taxonomy ref) — an SP2-class retyping gap.
- Emitter edge-shorthand / native-nested-step round-trip — SP4-deferred (YAGNI).
- Any consumer not required to build/run against 0.24.0.

## Constraints

- Plexus imports `@pragmatic-lab/*` from Verdaccio only — no relative `../src`
  imports into the framework packages.
- Every Plexus test file lives in a `tests/` subfolder next to its source
  (vitest globs `src/**/*.test.ts`).
- Real TypeScript `enum`s, never string-literal unions.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- No git push. The live republish is a manual step, surfaced in the handoff.

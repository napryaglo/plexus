# Concept `toolbox { visible }` filter for the arch-model toolbox engine

**Goal:** The engine that adds model entities to the architecture toolbox
respects a concept-level `toolbox { visible }` attribute — a concept marked
`annotate toolbox { visible = false }` contributes no tiles.

## Background

`ArchModelToolboxContributor` watches the active architecture diagram and
contributes two dynamic toolbox pages:

- **"Model: &lt;namespace&gt;"** — one tile per in-scope model entity not already
  placed (`modelPageItems`), dropped through the place-existing factory.
- **"Scenarios"** — one tile per in-scope `scenario` entity
  (`scenarioPageItems`), dropped through the scenario-flow factory.

Both currently filter only by viewpoint scope (`inScope`) and, for the Model
page, by whether the entity is already placed. There is no way for a
meta-model to keep a concept's instances out of the toolbox.

The meta-model module already establishes the authoring convention
(`toolbox-projection.ts`): an author-declared `annotation toolbox { visible :
boolean; }`, where a taxonomy is opt-in (`visible = true`) and a term is
opt-out (`visible = false`). This spec reuses the same annotation on
**concepts**, with opt-out semantics.

## Behavior

A concept is toolbox-visible **unless** it explicitly opts out:

- No `toolbox` annotation → visible (backward compatible; no migration).
- `annotate toolbox { visible = true }` → visible.
- `annotate toolbox { visible = false }` → hidden: none of its instances
  become toolbox tiles.

The filter applies to **both** pages. When the `scenario` concept is hidden,
`scenarioPageItems` returns an empty list and the existing `refresh()` logic
removes the "Scenarios" page — no additional handling.

## Implementation

Renderer-only, in
`src/renderer/src/modules/architecture-projects/services/arch-model-toolbox-contributor.ts`
plus a small pure helper. No mural or todl change.

### Reading the attribute

Same data path as `iconEntityKey` — the loaded `Repository`, keyed on the
annotation node id `&lt;concept&gt;@toolbox`. Booleans resolve to real booleans in
this repo (cf. `arch-materialize`, `arch-drop-resolver`), so the opt-out check
is a strict `!== false`:

```ts
// A concept is toolbox-visible unless it explicitly opts out with
// `annotate toolbox { visible = false }`. Absent annotation → visible.
export function conceptToolboxVisible(repo: Repository, concept: string): boolean {
  return repo.resolve(`${concept}@toolbox`)?.attrs.get('visible') !== false
}
```

### Wiring

- `modelPageItems`: extend the per-entity skip guard —
  `if (placed.has(e.id) || !inScope(e.concept) || !conceptToolboxVisible(repo, e.concept)) continue`.
- `scenarioPageItems`: extend the guard the same way on the `scenario` concept —
  `if (e.concept !== SCENARIO_CONCEPT || !inScope(e.concept) || !conceptToolboxVisible(repo, e.concept)) continue`.

`repo` is already in scope in both functions (`const repo = model.repository()`).

## Testing

Unit tests over the two pure functions, building an `ArchModel` from a
meta-model string (pattern from `arch-diagram-binding-scenario.test.ts`):

1. A concept with `annotate toolbox { visible = false }` contributes **no**
   Model-page tiles; its sibling concepts (no annotation) still do.
2. A concept with `annotate toolbox { visible = true }`, and a concept with no
   annotation, are both visible.
3. A `scenario` concept marked `visible = false` yields an empty
   `scenarioPageItems`.

## Out of scope

- The `tech-architecture` meta-model must declare
  `annotation toolbox { visible : boolean; }` before it can *use* the
  attribute. That authoring change (and republish) is separate from this
  engine change.
- Per-entity (instance-level) visibility. This is concept-level only.

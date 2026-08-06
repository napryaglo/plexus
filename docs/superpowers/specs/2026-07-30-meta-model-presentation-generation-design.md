# Meta-Model Presentation Generation — Design

**Status:** ✅ Finished
**Date:** 2026-07-30
**Sub-project 1 of 3** in the "Meta-model browser" effort.

## Umbrella context

The goal of the wider effort is a **meta-model browser** in Plexus: when a
meta-model package is published, it ships a *presentation* — a compiled mural
resource dictionary that gives every entity in the meta-model a visual
(icon + label, or an author-customised template) — and Plexus loads that
dictionary to render the meta-model's entities in a browsable panel.

The effort decomposes into three sub-projects, each with its own spec → plan →
implementation cycle:

1. **Presentation generation (this spec).** Generate an author-editable mural
   resource dictionary into a meta-model project from its entities + icons.
2. **Package + compile.** At publish, compile the presentation `.mu` into a JS
   resource-dictionary module and ship it beside `model.json`; plus the
   renderer-side loader that turns that shipped module into a live
   `ResourceDictionary`.
3. **Meta-models browser.** The Plexus panel that browses published meta-models
   and renders each entity through its loaded template.

This spec covers **only #1**. #2 and #3 are out of scope here and are named only
so the reader understands where generation fits.

---

## Goal

Given a meta-model project, generate a mural resource dictionary
(`presentation.generated.mu`) that (a) `include`s every SVG icon referenced by
the model, (b) emits one `DataTemplate` per ontology entity keyed by entity id,
and (c) `merge`s the author's own mural resource files so their custom
templates/styles override the generated defaults. The generator is a pure,
headless-testable function; a project command and the publish flow invoke it.

## Architecture

A pure generator function transforms the compiled `model.json` (plus the set of
author resource files) into `.mu` source text. It performs no I/O itself — a thin
service wrapper reads the model and author files from `IStorage`, calls the
generator, and writes the result back. This keeps the emission logic
deterministic and unit-testable without a renderer or filesystem.

The generated file is a mural `resources` dictionary. It is **regenerated
freely** and must never be hand-edited; author customisation lives in separate
`.mu` files under `presentation/`, which the generated dictionary composes via
`merge` (last-wins precedence, so author keys override generated ones).

## Tech Stack

- TypeScript, renderer-side (the meta-model module already runs there).
- Consumes the published `model.json` shape from `@pragmatic-lab/todl`
  (`TodlDocument = { nodes: JsonNode[]; edges: JsonEdge[] }`).
- Emits mural `.mu` source (compiled later by sub-project 2; this sub-project
  emits text only — no compilation here).
- `IStorage` seam for reads/writes (the same seam projects already use).

## Global Constraints

- **Tests live in a `tests/` subfolder** next to the source
  (`.../meta-model/services/tests/…`), per the repo rule.
- **Enums over string-literal unions** — any fixed set of named values
  (entity kinds, etc.) is a real TypeScript `enum` with explicit string values.
- **Render through templates only** — the generated `.mu` produces
  `DataTemplate`s; no hardcoded chrome. Icons flow in as geometry resources.
- The generator emits **text**; it does not invoke the mural compiler. Compiling
  `presentation.generated.mu` → JS is sub-project 2.
- No new dependency on the mural runtime from the generator (pure string work).

---

## Inputs

### The compiled model (`model.json`)

Shape (`@pragmatic-lab/todl` `TodlDocument`):

```ts
interface JsonNode { id: string; tier: string; typeOf: string; attrs: Record<string, Scalar> }
interface JsonEdge { kind: string; via: string | null; from: string; to: string }
interface TodlDocument { nodes: JsonNode[]; edges: JsonEdge[] }
```

Observed tiers/typeOf in a real meta-model (`tech-architecture`):

| tier     | typeOf       | count | present as entity? |
|----------|--------------|-------|--------------------|
| Ontology | concept      | 28    | **yes**            |
| Ontology | relationship | 13    | **yes**            |
| Ontology | taxonomy     | 15    | **yes**            |
| Ontology | primitive    | 3     | **yes**            |
| Ontology | field        | 125   | no (concept attrs) |
| Instance | (a concept)  | many  | no (instances)     |

**Ontology entities** to present = `tier === "Ontology"` and
`typeOf ∈ { concept, relationship, taxonomy, primitive }`. `field` nodes are
concept attributes, not standalone entities, and are excluded.

### Icon references

Icons are declared in the TODL source and land in the model as `attrs.icon`
string values on the nodes that carry them (typically Instance-tier
taxonomy/style members, e.g. `actor-type-style internal { icon =
"resources/actor-internal.svg" }`). The generator collects the **distinct set**
of `attrs.icon` values across **all** nodes (Ontology and Instance) — these are
the SVGs to `include` so they are available as geometry resources both for
generated templates and for author templates.

### Author resource files

Optional `.mu` files under the project's `presentation/` folder, authored by the
user (custom templates/styles). The generator does not read their contents — it
only needs their compiled-module identifiers to emit `merge` directives (the
exact import/merge wiring is finalised with sub-project 2, which owns
compilation; this spec emits the `merge` directives against a stable naming
convention). If `presentation/` is absent or empty, no `merge` directives are
emitted.

## Output — `presentation.generated.mu`

A single mural `resources` dictionary. Structure:

```mu
// presentation.generated.mu — AUTOGENERATED. Do not edit.
// Regenerated from model.json by the "Generate presentation" command / publish.
// Author customisation goes in presentation/*.mu (merged below, author wins).

resources MetaModelPresentation {

    // --- Icons: one geometry per distinct icon referenced by the model. ---
    include "resources/actor-internal.svg"  as mm_icon_actor_internal
    include "resources/role-service.svg"    as mm_icon_role_service
    // … one per distinct attrs.icon value …

    // --- Entity templates: one per ontology entity, keyed "mm:<id>". ---
    // Entities that carry an icon value render icon + label; the rest render a
    // label-only default box (the buildDefaultTemplate shape).
    DataTemplate x:key="mm:actor" [ DataType = MetaModelEntity ] {
        // label-only default (concept declares an icon FIELD but no icon VALUE)
        Border [ Background = @SurfaceContainerHigh, CornerRadius = 6, Padding = (8,6,8,6) ] {
            TextBlock [ Text = $Label, Style = @BodyMedium, Foreground = @OnSurface ]
        }
    }
    // … one per ontology entity …

    // --- Author overrides: one `merge` per compiled author dict from
    // presentation/*.mu. Ordered so author keys win (see precedence note). ---
    merge MetaModelPresentationCustom
    // … one `merge <Name>` per author override dictionary …
}
```

Details:

- **Icon keys** are a deterministic slug of the icon path
  (`resources/actor-internal.svg` → `mm_icon_actor_internal`): strip the
  directory + extension, replace non-identifier chars with `_`, prefix `mm_icon_`
  to avoid collisions. Distinct paths → distinct keys; the same path referenced
  by many nodes yields **one** include.
- **Template key** is `mm:<entity-id>` so a consumer (sub-project 3) resolves an
  entity to its template by id.
- **Label** for an entity = `attrs.label ?? humanize(id)` where `humanize`
  turns `app-component` into `App Component` (split on `-`/`.`, title-case).
- **Default template shape**: an entity whose own node has an `attrs.icon` value
  renders an icon `Shape` (geometry `@mm_icon_<slug>`) beside the label; an entity
  without one renders the label-only box above. (Most base concepts are
  label-only; this is expected — richer visuals come from author `presentation/`
  files.)
- **`DataType = MetaModelEntity`**: the templates bind against a small view-model
  the browser will supply (sub-project 3), exposing `$Label` (and, later,
  `$Icon`/`$Concept`). This spec fixes the binding surface name; the class itself
  is defined in sub-project 3. The generated `.mu` only references `$Label` (+
  `$Icon` geometry keys), so it compiles against that surface.

## Generator function

Pure, no I/O:

```ts
// Emits presentation.generated.mu source text from a compiled model + the set of
// distinct author-override dictionary names to merge. Deterministic: stable key
// slugs, entities emitted in model order, one include per distinct icon.
function generatePresentationMu(
    model: TodlDocument,
    authorOverrideDicts: readonly string[],   // compiled-dict identifiers to `merge`, [] if none
): string
```

Helpers (also pure, individually tested):

```ts
enum OntologyKind { Concept = 'concept', Relationship = 'relationship', Taxonomy = 'taxonomy', Primitive = 'primitive' }

function ontologyEntities(model: TodlDocument): JsonNode[]   // tier Ontology ∧ typeOf ∈ OntologyKind
function distinctIcons(model: TodlDocument): string[]        // sorted distinct attrs.icon across all nodes
function iconKey(path: string): string                       // "resources/a-b.svg" → "mm_icon_a_b"
function humanize(id: string): string                        // "app-component" → "App Component"
```

## Service wrapper + triggers

A thin method on the meta-model side does the I/O around the pure generator:

```ts
// Read model.json (compile sources if needed) + scan presentation/*.mu for
// override names, call generatePresentationMu, write presentation.generated.mu.
async function regeneratePresentation(storage: IStorage, provider: IServiceProvider): Promise<void>
```

Invoked from:

1. **A "Generate presentation" command** on the meta-model project (wired in the
   project explorer's per-project commands, beside Publish/Refresh Bases), so the
   author can regenerate on demand.
2. **The first step of `MetaModelProjectFactory.publish()`**, so the published
   artifact is always current. (Publish itself already compiles the model; this
   reuses that compiled `model.json`.)

Regeneration overwrites **only** `presentation.generated.mu`. Files under
`presentation/` are never read for content nor written.

## Testing

Headless Vitest against the pure generator (no renderer, no FS):

- **Icons**: a model with several `attrs.icon` values (including a duplicate path
  across two nodes) → output has one `include … as mm_icon_…` per distinct path,
  sorted, with correctly slugged keys.
- **Entities**: a model with a concept, a relationship, a taxonomy, a primitive,
  a `field` node, and an Instance node → output has exactly four
  `DataTemplate x:key="mm:<id>"` (the field and instance are excluded), keys and
  `$Label` text matching `attrs.label ?? humanize(id)`.
- **Icon vs label-only**: an entity with `attrs.icon` emits an icon `Shape`
  bound to its `@mm_icon_…` geometry; an entity without emits the label-only box.
- **Author merge**: `authorOverrideDicts = ['Foo', 'Bar']` → output ends with
  `merge Foo` and `merge Bar`; `[]` → no `merge` line.
- **Determinism**: same input → byte-identical output (stable ordering).

Service-wrapper I/O is covered by a lighter test with a `FakeStorage`: seed a
`model.json` + a `presentation/custom.mu`, run `regeneratePresentation`, assert
`presentation.generated.mu` was written and contains the expected includes +
one `merge`.

## Out of scope (later sub-projects)

- Compiling `presentation.generated.mu` → JS and shipping it (sub-project 2).
- The renderer loader that turns the shipped JS into a live `ResourceDictionary`
  (sub-project 2).
- The `MetaModelEntity` view-model and the browser panel that renders entities
  through the loaded templates (sub-project 3).
- Instance-level styling (an `actor` instance choosing an icon by its
  `actor-type-style`) — that is canvas-rendering concern, not the meta-model
  browser.

## Open points deferred to planning

- Exact `merge` import wiring (identifier naming for compiled author dicts) is
  finalised with sub-project 2, which owns compilation. This spec fixes the
  directive shape (`merge <Name>`), not the import statements.
- **Merge precedence must be confirmed** against mural's `merge` semantics
  (does a later `merge` override an earlier one, or vice versa?). The
  requirement is fixed — **author keys win over generated defaults** — but the
  generator's ordering of `merge` directives (author-first vs author-last)
  depends on that precedence and is settled in planning by checking the mural
  runtime's `ResourceDictionary` merge order.
- Whether "Generate presentation" should also run automatically on model save
  (vs. only on-demand + at publish) — default is on-demand + at publish; a
  save-hook can be added later if the manual step proves annoying.

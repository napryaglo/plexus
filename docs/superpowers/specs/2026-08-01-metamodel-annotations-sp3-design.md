# Meta-Model Annotations — SP3 (annotation-driven presentation bake) Design

**Status:** ✅ Finished
**Target:** Plexus (consumes `@pragmatic-lab/todl` 0.5.0; SP2 already landed)
**Date:** 2026-08-01

## 0. Context — the three sub-projects

Part of the `.NET-attributes`-style meta-model metadata feature (typed,
author-declared **annotations** decorating concepts and the package). Decomposed
into three sequenced sub-projects:

- **SP1 — TODL language (DONE, 0.5.0).** `annotation` / `annotate` / `package`
  constructs; compiled `model.json` carries annotation-def nodes, application
  nodes (`<target>@<Ann>`, `typeOf` = annotation name, param values as scalar
  attrs), and `Annotated` edges.
- **SP2 — Plexus projection + manifest (DONE, merged `9c9d071`).** Concept
  annotations project into a bindable `Annotations` bag on `MetaModelEntity`
  (`Record<string, Record<string, unknown>>`, keyed by annotation name, `namespace`
  stripped) via the shared pure `projectAnnotations(doc, targetId)`; publish emits
  a `manifest.json` package descriptor read by `loadMetaModelManifest`.
- **SP3 (this spec) — annotation-driven presentation bake.** Teach the
  presentation generator to source well-known presentation metadata (icon, label)
  from annotations, attr-primary with annotation fallback.

The originally-sketched SP3 bundled three loosely-coupled pieces (the generator
bake, a runtime icon-path→geometry Mural converter, and a `$Type` canvas hop for
on-canvas architecture instances). Only the **generator bake** is in this spec;
the converter and the `$Type` hop are separate later slices (§7).

## 1. Goal (SP3)

Make the generated meta-model presentation honor annotation-authored presentation
metadata. Today the generator reads `attrs.icon` / `attrs.label` directly and
bakes them into each per-concept `DataTemplate`. SP3 lets those same facets come
from the typed annotations SP1/SP2 added (`annotate icon { path = … }`,
`annotate label { text = … }`), **preferring the legacy raw attr and falling back
to the annotation** — a non-breaking migration path. Custom (non-well-known)
annotations remain bindable through the SP2 `Annotations` bag in author-override
`.mu`; SP3 does not render them generically.

## 2. Locked decisions

- **Attr-primary, annotation-fallback.** `icon = attrs.icon ?? annotations.icon?.path`;
  `label = attrs.label ?? annotations.label?.text ?? humanize(id)`. Existing
  meta-models (raw attrs) keep working unchanged; newly-authored ones may use
  annotations; when both are present, the attr wins.
- **Well-known vocabulary is `icon` (param `path`) and `label` (param `text`)**,
  hard-coded in the generator. `icon`/`path` mirrors SP1's example; `label`/`text`
  is conventionalized here. No other well-known annotations in this slice.
- **No generic rendering.** The generated per-entity template bakes only the
  well-known icon/label. Custom annotations are bindable via `$Annotations.x.y`
  in author-written override `.mu` (already works from SP2). No dict→list
  converter, no `ItemsControl` over the bag.
- **Generated output shape unchanged.** Same Border/StackPanel/Shape/TextBlock
  structure and static `@mm_icon_…` geometry references; only the *source* of the
  baked icon/label values changes. No Mural/runtime/loader/converter changes.
- **Drawer label stays consistent** with the baked template label by applying the
  same resolver in `buildEntity`.
- **No TODL changes.** Pure consumption of the compiled `model.json`.

## 3. Components

### A. `resolveFacets` — the shared resolver (new, in `presentation-generator.ts`)

```ts
export interface PresentationFacets { icon?: string; label: string }

// Attr-primary, annotation-fallback resolution of the well-known presentation
// facets for a node. `annotations` is the SP2 projected bag for that node
// (projectAnnotations output). icon: attrs.icon ?? annotations.icon?.path (only
// a non-empty string counts). label: attrs.label ?? annotations.label?.text ??
// humanize(id).
export function resolveFacets(
    node: JsonNode,
    annotations: Record<string, Record<string, unknown>>,
): PresentationFacets
```

- `icon`: if `attrs.icon` is a non-empty string, use it; else if
  `annotations.icon?.path` is a non-empty string, use it; else `undefined`.
- `label`: if `attrs.label` is a string, use it; else if `annotations.label?.text`
  is a string, use it; else `humanize(node.id)`.
- Pure; no I/O. Reused by `entityTemplate` (icon + label) and `buildEntity` (label).

### B. `entityTemplate` — resolve instead of read raw

Signature changes from `entityTemplate(n)` to `entityTemplate(doc, n)`. It computes
`const facets = resolveFacets(n, projectAnnotations(doc, n.id))` (reusing SP2's
`projectAnnotations`), then bakes `facets.icon` / `facets.label` into the identical
template structure it emits today (icon present → StackPanel with `Shape [ Geometry
= @${iconKey(facets.icon)} … ]` + label `TextBlock`; else label-only `TextBlock`).
`generatePresentationMu` passes `model` through to each `entityTemplate(model, n)`.

### C. `distinctIcons` — surface annotation-sourced icons

Keeps the existing `attrs.icon` scan across all nodes and adds an
icon-application scan: a node whose `typeOf === 'icon'` is an `<x>@icon`
application node, and its `path` attr (a non-empty string) is an icon. The result
is the sorted union of both. This ensures every referenced icon — attr-authored or
annotation-authored — is `include`d by the generator and copied by the publisher
(which shares this function). Being a union it is deliberately broad: an annotation
icon that an attr overrides in the template is still included, matching the
function's existing "make every referenced icon available to generated and author
templates alike" philosophy.

### D. `buildEntity` — drawer label consistency

In `meta-model-entity-builder.ts`, after `entity.Annotations` is populated (SP2),
replace the label line with:

```ts
entity.Label = resolveFacets(node, entity.Annotations).label
```

`node` is the already-resolved entity node; `entity.Annotations` is the bag just
built — no second projection. Keeps the drawer title and the baked `mm:<id>`
template label in lockstep. Icon needs no property change: the drawer renders the
icon through the applied Presentation template, not a `MetaModelEntity` field.

## 4. Data flow

```
model.json (0.5.0)
  ├─ concept node (attrs.icon?/attrs.label?)
  ├─ <concept>@icon  app node (typeOf 'icon',  attr path)
  ├─ <concept>@label app node (typeOf 'label', attr text)
  └─ Annotated edges
        │
   generatePresentationMu(model, authorDicts)
        ├─ distinctIcons(model)  → attrs.icon ∪ (typeOf 'icon').path → include per icon
        └─ entityTemplate(model, n)
              └─ resolveFacets(n, projectAnnotations(model, n.id))
                    → bake facets.icon (@mm_icon_…) + facets.label (TextBlock)

   buildEntity(doc, id)  → entity.Label = resolveFacets(node, entity.Annotations).label
```

## 5. Error handling

- **No annotations / no attrs** — `resolveFacets` yields `{ icon: undefined, label:
  humanize(id) }`; `entityTemplate` emits the label-only box (unchanged today's
  behavior). No throw.
- **Malformed annotation values** — a non-string `icon.path` / `label.text` is
  ignored by the string checks; resolution falls through to the next source.
- **Publish unaffected** — `distinctIcons` still skips a missing SVG file
  (non-fatal, existing behavior); a broader icon set only means more `include`
  lines / copy attempts, each independently guarded.

## 6. Testing

Vitest, all in `tests/` subfolders (`src/**/*.test.ts`):

- **`resolveFacets`** — the four precedence cases directly: attr-only, annotation-
  only, both (attr wins), neither (`humanize`), for both icon and label.
- **`presentation-generator`** — extend: an entity with `annotate icon { path }`
  and no `attrs.icon` → its template references the annotation icon and
  `distinctIcons` / the `include` block carries that path; an entity with both →
  the attr icon is baked; `annotate label { text }` with no `attrs.label` → the
  label falls back to the annotation text; neither → `humanize(id)`. Existing
  attr-only tests stay green.
- **`meta-model-entity-builder`** — extend: an entity with `annotate label` and no
  `attrs.label` → `entity.Label` is the annotation text; the attr still wins when
  present.

## 7. Out of scope (SP3 slice)

- The **`$Type` canvas hop** — exposing a `Type` property on `InstanceNodeVM` so
  on-canvas architecture instances reach their concept's static annotations
  (`instance-node-vm.ts` already carries the meta-model bases and a `Concept`
  string). Its own later slice.
- The **runtime icon-path→geometry Mural converter** — needed only when something
  binds a *dynamic* (non-baked) icon path; no consumer yet (the well-known baked
  path resolves statically). Its own later slice, likely YAGNI until a consumer
  exists.
- **Generic `$Annotations` rendering** in generated output; any well-known
  annotation beyond `icon` / `label`; non-scalar annotation params.

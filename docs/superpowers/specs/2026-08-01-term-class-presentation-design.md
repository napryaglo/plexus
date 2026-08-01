# Term / class presentation in the meta-model browser — design (SP2)

## Goal

A taxonomy `term` (or `class`) that carries an `icon` / `label` annotation should
render that glyph in the Plexus **meta-model browser**. Today the presentation
generator emits `mm:<id>` templates only for Ontology-tier entities
(concept / relationship / taxonomy / primitive), so a term — an Instance-tier
`class` node — gets no template and its annotation never renders, even though its
icon is already in the dictionary's `include` list.

## Scope

This is **SP2** of the annotate-rendering work (SP1 was the TODL language change,
already merged). It is self-contained in the Plexus `meta-model` module:

1. **Generator** — emit `mm:<id>` templates for term / class nodes.
2. **Consumer** — surface terms under their taxonomy in the meta-model tree so
   opening one shows its `mm:` template (with the icon) in the drawer.
3. **Docs** — correct the scaffold `todl-manual.md` line about where `annotate`
   is legal.

**Out of scope — SP3 (later cycle):** the architecture canvas. Making a canvas
node's glyph use its referenced term's icon runs through the `LibraryRegistry` /
visual-library, a different subsystem than the presentation generator.

## Why it is small

The projection machinery is already node-id-generic:

- `projectAnnotations(doc, id)` walks `Annotated` edges from any node
  (`annotation-projection.ts`), so a term's `@icon` application projects with no
  change.
- `resolveFacets(node, annotations)` and `entityTemplate(doc, node)` resolve
  icon / label attr-primary, annotation-fallback for any node
  (`presentation-generator.ts:80-147`).
- `distinctIcons(model)` already scans every node's `attrs.icon` **and** every
  `<x>@icon` application node, so term icons are already `include`d
  (`presentation-generator.ts:31-45`).
- `buildEntity(doc, id)` / `openEntity(ref)` already build and open a drawer for
  any node id; a term node produces an entity with its icon + label and no own
  `HasField` rows (fields live on the concept) — acceptable for v1.

So the only gaps are: which nodes get a template, and a tree affordance to open a
term.

## Design

### 1. Generator — `classEntities` + emit their templates

In `presentation-generator.ts`:

- Add `classEntities(model: TodlDocument): JsonNode[]` — Instance-tier nodes with
  `attrs.class === true`, in model order. This is exactly a taxonomy term (staged
  by the TODL builder as an Instance-tier node with `class: true`) and any `class`
  declaration.
- In `generatePresentationMu`, build templates for
  `[...ontologyEntities(model), ...classEntities(model)]` instead of
  `ontologyEntities(model)` alone. `entityTemplate` is unchanged — it already
  resolves facets via `projectAnnotations(doc, n.id)`.

Result: a term with `annotate icon { path = "…"; }` emits
`DataTemplate x:key="mm:<taxonomy>.<term>"` with the icon Shape; a term without
one emits a label-only box (label = `attrs.label` ?? `label` annotation ??
`humanize(id)`).

### 2. Consumer — terms under their taxonomy in the tree

In `meta-model-tree-builder.ts`, in `loadVersionEntities`, when emitting the
**Taxonomies** group's entity rows: for each taxonomy node, find its term nodes
and add each as a child entity row.

- A taxonomy's terms are the `to` ends of its `Contains` edges whose target is an
  Instance-tier `class` node — equivalently, nodes whose id begins
  `<taxonomyId>.`. Use the `Contains` edges (`edge.kind === 'Contains'`,
  `edge.from === taxonomyId`) filtered to nodes with `attrs.class === true`.
- Each term row: `MetaModelTreeNode.entity(entityLabel(termNode), { modelId, version, id: termNode.id }, activate)`.
- Add the term rows as `Children` of the taxonomy's entity row (the
  `HierarchicalDataTemplate` already recurses `Children`, so nesting renders with
  a chevron). Terms are already in `doc` — children are added eagerly, no lazy
  loader.

Double-clicking a term fires `activate(ref)` → `openEntity` → `buildEntity`
resolves `mm:<termId>` → the drawer's presentation box renders the term's icon.
`openEntity` / `buildEntity` are unchanged.

### 3. Docs

In `scaffold/todl-manual.md` §6, replace the sentence that says `annotate` is
legal "only inside a concept body or a `package { }` block" with wording that
includes taxonomy `term` bodies and `class` declarations, and note that a
concrete instance carrying `annotate` is `annotation.invalid-target`. Mirrors the
TODL-repo `todl-language.md` §4.6 wording landed in SP1.

## Data flow

```
model.json (SP1 output: Annotated edges from term nodes)
  ─generatePresentationMu→ mm:<term> DataTemplate  (icon Shape via projectAnnotations)
  ─loadVersionEntities→    Taxonomy row → term child rows (EntityRef{id: term})
  ─double-click term→      openEntity → buildEntity → resolve mm:<term> → drawer renders icon
```

## Error handling

- A term with no icon / label annotation → label-only template; `humanize(id)`
  label. No error.
- A taxonomy with no terms → no children added (unchanged behaviour).
- `buildEntity` on a term with no `HasField` edges → entity with empty `Fields`;
  the drawer shows the icon + label and an empty field list.

## Testing

`tests/` subfolders next to source, Vitest, `FakeStorage` where I/O is involved.

- **Generator** (`presentation-generator.test.ts`):
  - `classEntities` returns Instance-tier `class` nodes and excludes Ontology /
    non-class instance nodes.
  - `generatePresentationMu` emits an `mm:<taxonomy>.<term>` template whose body
    contains the icon `Shape [ Geometry = @mm_icon_… ]` when the term has an
    `icon` annotation.
  - a term without an icon annotation emits a label-only `mm:<term>` template.
- **Tree** (`meta-model-tree-builder.test.ts`):
  - a taxonomy row exposes each term as a child entity row carrying
    `EntityRef { id: '<taxonomy>.<term>' }`.
- **Docs**: spot-check the `todl-manual.md` line (no automated assertion unless
  an existing doc test covers it).

## Migration note

`generatePresentationMu` runs at publish time. Meta-models published before this
change keep their old presentation (no term templates) until republished; newly
published / republished meta-models gain term templates. No runtime migration.

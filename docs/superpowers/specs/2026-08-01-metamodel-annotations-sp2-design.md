# Meta-Model Annotations — SP2 (Plexus projection + manifest) Design

**Status:** design complete, pending user review
**Target:** Plexus (consumes `@pragmatic-lab/todl` 0.5.0 — already bumped in `7d466a5`)
**Date:** 2026-08-01

## 0. Context — the three sub-projects

Part of the `.NET-attributes`-style meta-model metadata feature (typed,
author-declared **annotations** decorating concepts and the package). Decomposed
into three sequenced sub-projects, each its own spec → plan → build:

- **SP1 — TODL language (DONE, 0.5.0).** `annotation` / `annotate` / `package`
  constructs, their reflective-graph representation, typed validation, emit. The
  compiled `model.json` carries annotation-def nodes, application nodes
  (`<target>@<Ann>`, Ontology-tier, `typeOf` = annotation name, param values as
  scalar attrs + a `namespace` provenance attr), and `Annotated` edges
  (`<target> —Annotated→ <target>@<Ann>`).
- **SP2 (this spec) — Plexus projection + package manifest.** Project a concept's
  annotations into a bindable `Annotations` bag on `MetaModelEntity`; emit a
  `manifest.json` package descriptor (identity + package-level annotations) at
  publish, and a thin loader that reads it back.
- **SP3 — Presentation hybrid + Mural.** The presentation generator bakes
  well-known annotations into per-concept templates AND emits a generic bindable
  template; the `$Type` canvas instance hop; any Mural converter (icon-path →
  geometry).

SP2 is the only subject of this document.

## 1. Goal (SP2)

Make the annotations SP1 compiled into `model.json` **consumable in Plexus**,
without reaching into the canvas/instance machinery:

1. A concept's annotations appear as a bindable `Annotations` bag on the
   `MetaModelEntity` the drawer and generated presentation already bind to, so a
   template can read `$Annotations.icon.path`.
2. Publish emits a `manifest.json` — a package descriptor carrying identity plus
   the package-level annotations — and a thin loader reads it back, mirroring the
   existing `library.json` / `library-loader` pattern. This fills the gap that
   meta-model packages currently have **no manifest at all**.

## 2. Locked decisions

- **Projection + manifest only.** SP2 does **not** wire the `$Type` canvas
  instance hop (an on-canvas Instance-tier object reaching its concept's static
  annotations). That reaches into the architecture-repository / canvas binding and
  has no consumer until SP3's templates exist — it lands in SP3.
- **Nested `Record` bag.** `Annotations: Record<string, Record<string, unknown>>`,
  keyed by annotation name → its param values. Mirrors the existing `Attrs`
  property; binds as `$Annotations.icon.path` via Mural's nested path support. No
  new `Model` subclass.
- **Manifest = package descriptor + annotations, with a loader.** `manifest.json`
  carries `id` / `version` / `name` / optional `description` plus the package-level
  `annotations`. SP2 adds `loadMetaModelManifest`, mirroring `library-loader`'s
  never-throws contract.
- **Pure consumption.** No TODL / emit changes. SP2 reads the `0.5.0` `model.json`.
- **Wire-string constants, not TODL enum imports.** Plexus consumes the serialized
  `tier` / `typeOf` / `edge.kind` strings via local named constants (as
  `meta-model-entity-builder.ts` already does with `const HAS_FIELD = 'HasField'`).
  `EdgeKind.Annotated` serializes to `"Annotated"` (numeric enum → member-name via
  `EdgeKind[…]` in TODL's `emit/json.ts`); the package node id is `"package"`.

## 3. Components

### A. `annotation-projection.ts` (new — shared pure helper)

```ts
// Walk `Annotated` edges from `targetId` to its `<target>@<Ann>` application
// nodes; key each by the app node's `typeOf` (the annotation name); value = the
// app node's scalar param attrs minus the `namespace` provenance stamp.
export function projectAnnotations(
    doc: TodlDocument,
    targetId: string,
): Record<string, Record<string, unknown>>
```

- Local constants `const ANNOTATED = 'Annotated'`, `const NAMESPACE_ATTR = 'namespace'`.
- For each edge with `kind === ANNOTATED && from === targetId`, resolve the `to`
  node; skip if missing. Its `typeOf` is the annotation name; copy its `attrs`
  into a fresh object, dropping `NAMESPACE_ATTR`. Assign under the annotation-name
  key.
- A target with no `Annotated` edges → `{}`.
- Pure; no I/O. Reused by both the entity builder (concept target) and the
  manifest writer (package target).

### B. `MetaModelEntity` — one new property

In `meta-model-entity.ts`, mirroring `AttrsKey`:

```ts
public static readonly AnnotationsKey = Model.RegisterProperty<Record<string, Record<string, unknown>>>(
    MetaModelEntity, 'Annotations', {}, MetaData.None)
public get Annotations(): Record<string, Record<string, unknown>> {
    return this.get_property_value(MetaModelEntity.AnnotationsKey) }
public set Annotations(v: Record<string, Record<string, unknown>>) {
    this.set_property_value(MetaModelEntity.AnnotationsKey, v) }
```

### C. `buildEntity` — one new line

In `meta-model-entity-builder.ts`, after the existing `HasField` loop:

```ts
entity.Annotations = projectAnnotations(doc, entityId)
```

The drawer and the generated presentation bind to the live `MetaModelEntity`, so
`$Annotations.icon.path` is reachable with no further wiring.

### D. `MetaModelManifestFile` + write at publish

Named to distinguish it from the existing project-envelope `MetaModelManifest`
in `meta-model-project-factory.ts`:

```ts
export interface MetaModelManifestFile {
    id:           string
    version:      string   // = the published modelVersion
    name:         string
    description?: string   // omitted when absent
    annotations:  Record<string, Record<string, unknown>>  // package-level
}
```

In `MetaModelProjectFactory.publish()`, immediately after the `model.json` write:

- `const PACKAGE_NODE = 'package'` (local const).
- Build the descriptor from the project manifest (`id`, `modelVersion` → `version`,
  `name`) and `projectAnnotations(doc, PACKAGE_NODE)`. `description` is omitted
  (the project envelope has no description field today).
- `await dest.WriteText(\`${base}/manifest.json\`, JSON.stringify(file, null, 2))`.
- A package-less meta-model still gets a manifest with `annotations: {}` — the
  identity descriptor is worth having regardless.

### E. `meta-model-manifest-loader.ts` (new)

Mirrors `library-loader`'s contract (never throws):

```ts
// Local, so the meta-model module does not depend on the library module.
export interface ManifestProblem { uri: string | null; message: string; severity: 'error' | 'warning' }
export interface LoadedMetaModelManifest extends MetaModelManifestFile {
    problems: ManifestProblem[]
}
export async function loadMetaModelManifest(
    backend: IStorage, id: string, version: string,
): Promise<LoadedMetaModelManifest>
```

- `JSON.parse(await backend.ReadText(\`${id}/${version}/manifest.json\`))` inside
  try/catch.
- Malformed/missing → safe default `{ id, version, name: id, annotations: {},
  problems: [{ severity: 'error', uri: 'manifest.json', message: … }] }`. Never
  throws.
- `ManifestProblem` is a local structural copy of `library-loader`'s `LoadProblem`
  (`{ uri, message, severity }`), keeping the module self-contained.

## 4. Data flow

```
model.json (0.5.0)                     publish()
  ├─ concept node                        ├─ toJSON(model) → model.json
  ├─ <concept>@<Ann> app nodes           └─ projectAnnotations(doc,'package')
  ├─ Annotated edges                          → manifest.json  ──┐
  └─ package@<Ann> app nodes                                     │
        │                                                        │
   buildEntity(doc, conceptId)                    loadMetaModelManifest(backend,id,ver)
        │ projectAnnotations(doc, conceptId)                     │
        ▼                                                        ▼
   MetaModelEntity.Annotations                    LoadedMetaModelManifest.annotations
        │ (drawer / presentation bind)                  (package API for Plexus)
        ▼
   $Annotations.icon.path
```

## 5. Error handling

- **Missing target / dangling edge** — `projectAnnotations` skips an `Annotated`
  edge whose `to` node is absent; a target with none → `{}`. No throw.
- **Malformed manifest** — the loader returns a safe default plus one error
  problem; never throws (matches `library-loader`).
- **Publish** — the manifest write is additive; it does not change publish's
  existing success/error result. A model with no package annotations publishes a
  manifest with `annotations: {}`.

## 6. Testing

Vitest, all in `tests/` subfolders (`src/**/*.test.ts`):

- **`annotation-projection`** — a synthetic `TodlDocument`: concept with two
  annotations → correct nested `Record`; the `namespace` attr is stripped; a
  concept with no annotations → `{}`; the `package` node's annotations project the
  same way.
- **`meta-model-entity-builder`** — extend the existing tests: a built entity
  carries the projected `Annotations` alongside its `Fields`.
- **`meta-model-manifest-loader`** — write a manifest via an in-memory `IStorage`
  and round-trip it; malformed JSON → one error problem, no throw; missing file →
  safe default.

## 7. Out of scope (SP2)

- The `$Type` canvas instance hop and any template that reads annotations — SP3.
- Non-scalar param types (lists, references, nested objects) — bounded by SP1's
  scalar `attrs` contract.
- A `description` field on the meta-model project envelope (manifest omits it for
  now).

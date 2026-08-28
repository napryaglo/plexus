# Wiki Resolution Redesign — Design

**Status:** proposed · **Date:** 2026-08-28

## Problem

A DevTools trace (`Plexus/debug/Trace-8`, 66.6 s wall / 56.9 s active CPU) captured
while **dropping a scenario onto an arch diagram** — an action with nothing to do
with wikis — showed `WikiLocator.resolveWiki` inclusive at **~50% of the entire
trace**, driving a full TODL parse (`fromSources`) → validate (`checkAgainst`) →
`loadInto` on essentially every sample. Rendered markdown (the RichTextBlock/
FlowDocument viewer) was 0.0%.

Root cause is **three compounding defects** in how a concept's wiki page is located:

1. **`HasWiki` is eagerly recomputed per node on every rescan.**
   [arch-diagram-binding.ts:270-276](../../../src/renderer/src/modules/architecture-projects/services/arch-diagram-binding.ts#L270)
   fires `wiki.hasWiki(concept)` for **every** node inside `rescan()`, and `rescan()`
   is wired to **every** model change ([line 63](../../../src/renderer/src/modules/architecture-projects/services/arch-diagram-binding.ts#L63)).
   A scenario drop mutates the model many times × many nodes → hundreds of
   `resolveWiki` calls. This is *why the work was requested at all*.

2. **`resolveWiki` recompiles source instead of reading the loaded model.**
   [wiki-locator.ts:28-31](../../../src/renderer/src/services/wiki/wiki-locator.ts#L28)
   calls `collectTodlSources` + `ModelDraft.fromSources(...)` per call — a full parse+
   validate from raw `.todl` — where every other annotation consumer
   (`materializeOf`, presentation/iconSource) reads the already-loaded `Repository`.
   This is *why each call is catastrophic*.

3. **The `path` is resolved against the wrong base.**
   `resolveWiki` returns `{ root: openProjectRoot, relPath }` — always the open
   project root. But a concept's wiki page lives with *the artifact that declares
   the concept*: for a **consumed/published** package that is the package directory
   in the backend, not the consuming project. The meta-model and library panels
   render **published** packages (from `<id>/<version>/model.json` in their
   backends), so they are inherently the published case — which the current locator
   cannot resolve at all.

Defects 1 and 2 multiply into the 50% CPU; defect 3 means the page is often not
found even when the work is done.

## Goals

- Resolve the `concept@wiki` annotation like any other annotation: one cheap
  `repo.resolve('X@wiki')` off the already-loaded model. No source recompile.
- Resolve the wiki `path` to bytes against the concept's **provenance**: the
  package directory for published concepts, the project root for open-source
  (unpublished) concepts.
- Stop recomputing `HasWiki` per node on every model change; instance-only edits
  (scenario drops) must not trigger any wiki work.
- Make publish actually bundle wiki pages so the published case has files to read.

## Non-goals

- Changing the rendered wiki view (`WikiDocument` / RichTextBlock) — unchanged.
- Reworking the TODL package format beyond adding bundled wiki assets + reusing the
  existing `dependencies`/provenance already carried by base resolution.
- Cross-project wiki search / indexing beyond the declaring package/project.

## Design

Two independent layers, plus a demand-driven `HasWiki`.

### Layer 1 — resolve the annotation (uniform, cheap)

`concept@wiki` and its `path` attr come from a loaded `Repository`, exactly like
[`materializeOf`](../../../src/renderer/src/modules/architecture-projects/services/arch-materialize.ts#L11):

```ts
// pure, no I/O, no compile
function wikiPathOf(repo: Repository, concept: string): string | undefined {
    const v = repo.resolve(`${concept}@wiki`)?.attrs.get('path')
    return typeof v === 'string' && v.length > 0 ? v : undefined
}
```

`HasWiki` existence = `wikiPathOf(...) !== undefined`. `collectTodlSources`,
`ModelDraft.fromSources`, and `namespaceOf` are deleted from the locator.

### Layer 2 — resolve `path` → readable bytes (provenance-dependent, on click only)

The `path` is relative to the declaring artifact's root. Provenance is a
discriminated union, produced where bases are resolved (see below):

```ts
enum WikiOriginKind { OpenProject = 'openProject', Package = 'package' }

type WikiOrigin =
    | { kind: WikiOriginKind.OpenProject; storage: IStorage }              // live source
    | { kind: WikiOriginKind.Package; backend: ProducerKind; id: string; version: string }
```

`locate(origin, relPath)` returns the `IStorage` + storage-relative path to read:

- **OpenProject** → `{ storage: origin.storage, path: relPath }` (path relative to
  project root, read via the project's `IStorage`).
- **Package** → `{ storage: backendFor(origin.backend), path: `${origin.id}/${origin.version}/${relPath}` }`
  (path relative to the package root in the meta-models/libraries backend).

`WikiService.openWiki` reads the file through the returned storage instead of the
absolute-path `FileSystemService`. A missing file sets `Status` (unchanged
behaviour), so a package published before this change degrades gracefully.

**Precedence** (open-source wins over published) is inherited for free: the loaded
`Repository` a producer contributes is *already* compiled from live source when the
producer project is open ([WorkspaceBaseResolver.resolveOne](../../../src/renderer/src/services/projects/workspace-base-resolver.ts#L160)),
and its `WikiOrigin` is then `OpenProject`; otherwise it is `Package`.

### Provenance production (the `nodeId → WikiOrigin` map)

Base resolution already decides provenance per base; it just discards it. Two
seams, both of which currently push untagged `{ nodes, edges }`:

- [`WorkspaceBaseResolver`](../../../src/renderer/src/services/projects/workspace-base-resolver.ts)
  (arch + workspace-local path): `resolveOne` pushes an **open-producer** doc at
  L178 and a **published** doc at L205 (`resolvePublishedTransitive`). Tag each
  base doc's node ids with the corresponding `WikiOrigin` and return an
  `originOf: Map<string, WikiOrigin>` alongside `bases`.
- [`resolveBases`](../../../src/renderer/src/services/projects/base-resolver.ts)
  (library-factory path): same addition, `Package` origins only.

`originOf` is threaded to `ArchModel` (constructed at
[architecture-model-service.ts:55](../../../src/renderer/src/modules/architecture-projects/services/architecture-model-service.ts#L55),
`new ArchModel(draft, op.Storage, namespace, merged)`) so it exposes
`originOf(conceptId): WikiOrigin | undefined`. A concept declared by the arch
project's *own* content (rare — arch projects hold instances) defaults to
`OpenProject { storage: op.Storage }`.

**Panels** don't need the map: a library/meta tree node already sits under a known
`<id>/<version>` and kind, so it supplies `WikiOrigin.Package` directly, and its
`Repository` is the package model it already loads to build the tree (loaded once,
cached per package — replacing today's per-call recompile).

### `HasWiki` becomes demand-driven, not per-rescan

`HasWiki` depends only on the *concept* (a type in the loaded model), never on
instances. A scenario drop adds instances, so no `HasWiki` value can change.

- Cache `HasWiki` by concept in the binding (`Map<concept, boolean>`), populated on
  first need; `rescan()` reuses the cache and never re-fires resolution for a
  concept it already knows.
- Invalidate the cache only when the loaded model's **bases** change (base refresh),
  not on instance edits.
- (Optional, larger) compute `HasWiki` lazily when a node's context menu opens,
  eliminating the eager pass entirely. The per-concept cache is the minimal fix and
  already removes the N×M explosion; lazy-on-open is a follow-up.

### Publish bundles wiki pages

`path` is relative to the package root, so publish copies a dedicated `wiki/`
folder into the bundle (symmetric with the open-project case, where the same `path`
resolves under the project root):

- Library factory: add `'wiki'` to the resource-folder whitelist at
  [library-project-factory.ts:184](../../../src/renderer/src/modules/library/services/library-project-factory.ts#L184).
- Meta-model factory: bundle `wiki/` the same way (add the copy step if the factory
  lacks the shared `copyResourceFolder` helper).

`.md` already copies as text via `copyResourceFolder`.

## Affected components

| File | Change |
|---|---|
| `services/projects/base-resolver.ts` | `resolveBases` also returns `originOf: Map<nodeId, WikiOrigin>` (Package origins) |
| `services/projects/workspace-base-resolver.ts` | `ResolveForStorage` returns `originOf`; tag open-producer vs published nodes |
| `services/projects/wiki-origin.ts` (new) | `WikiOrigin` type + `WikiOriginKind` enum |
| `modules/architecture-projects/services/arch-model.ts` | hold `originOf`; expose `originOf(concept)` |
| `modules/architecture-projects/services/architecture-model-service.ts` | thread `originOf` into `ArchModel` |
| `services/wiki/wiki-locator.ts` | rewrite: `wikiPathOf(repo, concept)` + `locate(origin, relPath)`; delete source-compile |
| `services/wiki/wiki-service.ts` | `hasWiki`/`openWiki` take a repo + origin (via a small `WikiTarget`); read via returned `IStorage` |
| `arch-diagram-binding.ts` | per-concept `HasWiki` cache; stop per-node-per-rescan resolution |
| `arch-model-toolbox-contributor.ts`, `libraries-panel-service.ts`, `meta-models-service.ts` | supply repo + `WikiOrigin.Package`; cache per package |
| `library-project-factory.ts`, `meta-model-project-factory.ts` | bundle `wiki/` on publish |

## Testing

- `wiki-locator`: `wikiPathOf` off a repo (hit/miss); `locate` for OpenProject vs
  Package (path composition `<id>/<version>/<rel>`); missing path → undefined.
- base-resolver / workspace-base-resolver: `originOf` tags published nodes with
  `{Package,id,version}` and open-producer nodes with `{OpenProject,storage}`;
  precedence (open producer overrides published) reflected in the origin.
- `arch-model`: `originOf(concept)` returns the base's origin; own concept →
  OpenProject.
- `arch-diagram-binding`: dropping instances triggers **zero** `resolveWiki` calls
  (per-concept cache); a base change invalidates the cache.
- publish: library/meta bundle copies `wiki/*.md` into `<id>/<version>/wiki/`.
- `wiki-service`: open reads via backend storage for a Package origin and project
  storage for an OpenProject origin; missing file → `Status`, no tab.
- Regression: existing `wiki-locator.test.ts` / `wiki-service.test.ts` updated to
  the repo+origin API.

## Migration / compatibility

- Packages published before this change ship no `wiki/`; their pages resolve to
  "not found" (graceful `Status`) until republished. No crash, no data change.
- `WikiDocument` and the rendered view are untouched.

## Suggested implementation sequence

1. **Stop the bleeding (perf):** per-concept `HasWiki` cache (defect 1) + `wikiPathOf`
   off the loaded repo (defect 2). This alone fixes Trace-8. Path resolution can
   temporarily keep returning the open-project root.
2. **Provenance + correct path (defect 3):** `WikiOrigin`, `originOf` from base
   resolution, `locate`, and the panel/arch call-site wiring.
3. **Publish bundles `wiki/`** so authored pages actually ship for the published case.

Each step is independently shippable and testable; step 1 is the highest-leverage.

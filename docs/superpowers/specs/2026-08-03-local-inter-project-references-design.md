# Local Inter-Project References — Design

**Status:** Design approved 2026-08-03. Ready for an implementation plan.

**Goal:** When several projects are open at once (Plexus already supports this),
let a consuming project resolve its bases from an **open sibling project's live
local source** instead of the published registry artifact — so co-editing a
meta-model, its libraries, and an architecture needs no publish round-trip. The
open-set *is* the "solution"; resolution is implicit (workspace-link semantics),
like `pnpm`/`npm` workspace linking or a .NET `ProjectReference`.

**Tech Stack:** Plexus renderer (TypeScript, electron-vite, mural framework,
service-based observables). Consumes `@pragmatic-lab/todl` (`check`,
`checkAgainst`, `toJSON`, `TodlDocument`). No TODL changes — this is entirely
Plexus-side.

---

## Problem

A consuming project declares its bases in `project.plexus` as `BaseRef {id,
version}` values: an architecture binds `metaModel` + `libraries`, a library
binds `metaModel`. Today `resolveBases(provider, bindings)`
(`src/renderer/src/services/projects/base-resolver.ts`) turns each `BaseRef`
into `<backend>/<id>/<version>/model.json` and reads the **published** artifact
from the meta-models / libraries backends under `<userData>`.

Consequence: while iterating on a meta-model *and* an architecture that consumes
it, every change to the meta-model requires republishing it before the
downstream architecture sees the new concepts/terms. The producing and consuming
projects can both be open in the same window, yet they cannot see each other.

## Goal / Success Criteria

- With a producer project (meta-model or library) **open**, a consumer's base
  for that `id` is compiled live from the producer's saved source — no publish.
- Resolution is implicit: match by `id`; no manifest edit, no solution file.
- The live-compiled base goes through the **same compile pipeline** as
  `publish()` — no divergent compile logic; identical output given identical
  bases (correctness anchor). Content differs from the published copy only where
  an input genuinely differs (the producer's source was edited, or a transitive
  base is itself resolved locally) — which is the whole point.
- When a producer's source changes (on save), its transitive dependents
  revalidate automatically.
- **Publish is unaffected**: a published artifact still resolves its bases from
  the published registry only.
- Nothing regresses when no sibling producer is open — the published path is the
  fallback, unchanged.

## Design

### 1. `WorkspaceBaseResolver` (new service)

`src/renderer/src/services/projects/workspace-base-resolver.ts`.

Owns the rule *"prefer an open sibling's live-compiled output; else read the
published artifact."* All **authoring/validation** base resolution routes
through it. It holds:

- **Producer index** — `Map<string, OpenProject>` from `manifest.id` to the open
  project that produces it, restricted to *producer* project types (meta-model,
  library). Rebuilt whenever `ProjectExplorerService.OpenProjects` changes (that
  collection already exposes `.Subscribe`). A library is both a producer (of a
  library) and a consumer (of a meta-model); an open library therefore satisfies
  an architecture's `libraries` binding while resolving its own meta-model
  through the same resolver.
- `resolveBindings(consumer): Promise<{ bases: TodlDocument[]; problems: string[] }>`
  — the workspace-aware analogue of `resolveBases`, meta-model-first order
  preserved.
- `dependentsOf(id): OpenProject[]` — open projects whose bindings match `id`
  (used by invalidation).

### 2. Recursive resolution — "compute what publish would write"

To resolve one `BaseRef` `ref` of kind `k` (`meta-model` | `library`) for
consumer `C`:

1. `P = producerIndex.get(ref.id)`. If `P` exists, `P` is not `C`
   (self-exclusion), and `P`'s kind matches `k`:
   - Resolve `P`'s own bindings recursively through this resolver →
     `childBases` (a meta-model has none, so `childBases = []`).
   - Return `P.factory.compileToDocument(P.storage, childBases, provider)` —
     `toJSON(checkAgainst(childBases, collectTodlSources(P.storage)))`.
   - A **visited set** (by project identity) guards cycles: if `P` is already on
     the resolution stack, skip local resolution for it and fall through to the
     published read (step 2), recording a problem.
2. Otherwise read the published `<backend>/<id>/<version>/model.json` — exactly
   today's `resolveBases` inner `read()`. This is the fallback and the leaf.

`resolveBindings(C)` maps `C`'s `metaModel` (if any) then each `libraries` entry
through the above, concatenating `bases` and `problems`. The result is the flat,
meta-model-first `TodlDocument[]` the language server already consumes via
`todl/setBases`; cross-base node-id duplication is handled by the server's
existing first-wins `mergeBases` dedup, identical to the published path.

### 3. `compileToDocument` on producer factories

Each producer factory's `publish()` currently inlines "collect sources →
`check`/`checkAgainst` → `toJSON`" before writing. Extract that into:

```
compileToDocument(storage: IStorage, bases: TodlDocument[], provider): Promise<{ doc: TodlDocument; problems: string[] }>
```

Used by **both** paths:
- `publish()` calls it with **strict** bases (from `resolveBases`, published
  only), then writes `doc`.
- `WorkspaceBaseResolver` calls it with **workspace** bases (recursive).

Both paths run the identical compile pipeline, so the local document has no
divergent logic from what publish would emit — the two differ only when their
input bases differ (a locally-resolved transitive base). Factories also expose
their identity for the index (`id` + kind, read from the manifest).

### 4. Resolution semantics

- **Match by `id`, ignore version.** An open producer wins regardless of the
  binding's version string (workspace-link contract). On a version mismatch,
  attach an **info** problem (`using local "<id>" (open project) — binding
  requests @X, project is @Y`); non-blocking.
- **Kind must match.** `metaModel` → open meta-model project only; a `libraries`
  entry → open library project only.
- **Self-exclusion.** A project never resolves against itself.
- **Saved-on-disk, not editor-buffer.** Compilation reads
  `collectTodlSources(storage)` (last-saved files). Unsaved Monaco edits are not
  seen until saved. Live-buffer linking is an explicit non-goal (§ Non-goals).
- **Local producer with errors.** If the open sibling has compile errors, return
  its partial `toJSON` document **and** add a problem (`local <kind> "<id>" has
  N error(s)`). Do **not** fall back to published — the user asked for the local
  source.
- **Publish stays strict.** `publish()` resolves bases from the published
  registry only. You cannot publish an artifact whose bases resolve to an
  unpublished sibling; this enforces publish ordering (meta-model, then library,
  then architecture) and is the line between authoring convenience and shipped
  artifact.

### 5. Reactivity (keeping consumers live)

The dependency graph (`id → dependents`) is derived on demand from open
projects' manifests — no persisted graph. A thin invalidation subscriber wires
two existing signals to the existing `TodlLanguageClient.RefreshBases(storage)`
(which clears that project's `baseCache` entry and re-pushes `todl/refreshBases`
to the server):

- **Signal A — a producer's source changes.** The file-watch/rescan service
  already fires per open project on `.todl` change. When project `P` changes,
  refresh `WorkspaceBaseResolver.dependentsOf(P.id)`, walking the dependency DAG
  transitively (a meta-model change → dependent libraries refresh → their
  dependent architectures refresh), each project refreshed once (visited set).
- **Signal B — the open-set changes.** `OpenProjects.Subscribe` fires on
  open/close. Rebuild the producer index; refresh dependents whose resolution
  could have flipped: on **open** of a producer, dependents that were falling
  back to published switch to local; on **close**, dependents fall back to
  published (a now-missing base surfaces the existing "not published" problem —
  correctly reporting "you closed what I depend on").

Cross-project refresh is debounced to the save, matching how single-project
rescan already feels — a brief moment after saving a producer before dependents
revalidate.

### 6. Callers routed through the resolver (authoring paths only)

- `TodlLanguageClient.basesFor(storage)` — call
  `WorkspaceBaseResolver.resolveBindings` instead of `resolveBases` directly.
  `RefreshBases` unchanged.
- `ArchDiagramDocumentFactory.openFile` (architecture-repository) — route its
  base resolution through the resolver, so opening/editing a diagram sees live
  sibling libraries (the term-drop palette reflects the co-edited library).
- **Not** routed: `publish()` in the producer factories (stays strict per § 4).

## Components / File Map

**New**
- `src/renderer/src/services/projects/workspace-base-resolver.ts`
- `src/renderer/src/services/projects/tests/workspace-base-resolver.test.ts`
- Invalidation subscriber (alongside the resolver or `FileWatchService`) + test.

**Modified**
- `base-resolver.ts` — unchanged behaviour; remains the strict/published path the
  resolver and publish call for fallback.
- `meta-model-project-factory.ts`, `library-project-factory.ts` — extract
  `compileToDocument`; expose `id`/kind for the index; `publish()` reuses it.
- `todl-language-client.ts` — `basesFor` routes through the resolver.
- `ArchDiagramDocumentFactory` (architecture-repository) — route base resolution
  through the resolver.
- Bootstrap/module registration for the resolver + subscriber.

## Testing

Resolver is unit-testable with fake `IStorage` producers + a fake published
backend (no Electron):

1. Prefers local when the producer is open; published when not.
2. `id`-match ignores version; emits the info problem on mismatch.
3. Recursion: architecture → library → meta-model all local yields three bases,
   meta-model first.
4. Cycle guard: mutually-referencing producers fall back without hanging.
5. Self-exclusion: a producer editing its own source does not recurse into
   itself.
6. Local-with-errors returns the partial doc + a problem, no published fallback.
7. Publish path resolves published-only: with an unpublished sibling open,
   publish still reads published (or fails "not published"), never local.
8. Invalidation A: changing a producer refreshes exactly its transitive
   dependents, each once.
9. Invalidation B: closing a producer flips dependents to the published path.

Every test file lives in a `tests/` subfolder next to its source (repo
convention).

## Global Constraints

- Real TypeScript enums, never string-literal / template-literal union types
  (for any new kind/status enums).
- Tests in `tests/` subfolders.
- Pipeline parity with the published path is the correctness anchor: local
  resolution runs the same compile code `publish()` runs (via
  `compileToDocument`), returning what `publish()` would write given the same
  bases.
- TODL (`@pragmatic-lab/todl`) is unchanged; this is Plexus-side only.

## Non-goals

- **Saved solution file.** No `.plexussln` container; the open-set is the
  solution. (Considered and set aside — the user chose implicit workspace-link.)
- **Explicit per-project references / per-binding toggles.** Resolution is
  implicit by `id` match.
- **Live editor-buffer linking.** Resolution reads saved files; it does not react
  to unsaved keystrokes across projects.
- **Presentation live-linking.** Local resolution covers the base `TodlDocument`
  (concepts/terms/vocabulary driving validation and the term-drop palette). A
  meta-model's *presentation* (`presentation.compiled.json`: icons/geometry) is
  consumed by a separate path and still comes from the published artifact; live
  icon updates without republish is a distinct future feature.
- **Publishing against local bases.** Publish stays strict; correct publish
  ordering is enforced, not worked around.

## Open sub-points (resolve during planning)

1. Exact home of the invalidation subscriber (its own module vs. folded into
   `FileWatchService`) — a wiring choice, not a semantics one.
2. How a producer factory advertises its `id`/kind to the index — read the
   manifest on demand vs. cache it on `OpenProject`. Prefer read-on-demand unless
   it shows up as a cost.
3. Whether `dependentsOf` and the producer index share one derived snapshot
   rebuilt on `OpenProjects` change (likely yes — one scan, both uses).

# Plexus C-like Identifier Migration — Design

**Date:** 2026-08-07
**Status:** Approved
**Depends on:** `@pragmatic-lab/todl@0.19.0` (C-like identifiers; SP1)

## Problem

TODL switched from kebab-case identifiers to C-like identifiers in 0.19.0:
PascalCase types, camelCase members, lowercase keywords and namespaces, and
the lexer now rejects hyphens in identifiers. Plexus consumes and generates
TODL. Every kebab identifier in Plexus TODL source is now invalid, and one
runtime emitter synthesizes an id shape (`stem-seq`) that the lexer rejects.

This migration brings Plexus onto the C-like grammar and lifts its floor to
`^0.19.0`.

## Scope

Investigation (see the mapping in the SP2 conversation) established that the
Plexus TODL corpus lives entirely in `.ts` test fixtures (backtick template
strings) plus two shipped scaffold docs. **No product code hard-codes kebab
identifiers as lookup keys** — every kebab occurrence is either TODL source
text (recasable) or a generated string. The work is therefore four fronts.

### 1. Runtime emitter: `freshId`

`ArchInstanceModel.freshId(concept)` at
`src/renderer/src/modules/architecture-projects/services/architecture-instance-model.ts`
currently builds `` `${stem}-${++seq}` `` where `stem` is the last dotted
segment of the concept id. Under a C-like meta-model `stem` is PascalCase
(e.g. `Component`), so it emits `Component-1` — an invalid identifier (hyphen)
and the wrong case for an instance. Instance ids are emitted into `.todl`
model files via `emitModelTodl`, so they must be valid C-like camelCase.

**Change:** produce `` `${toCamel(stem)}${seq}` `` → `component1`, `component2`,
… . `toCamel` lowercases the first segment and camel-joins the rest
(`AppComponent` → `appComponent` → `appComponent1`). Collision guard against
`this.draft` is unchanged. A tiny local `toCamel` helper is added (Plexus
cannot import TODL's non-exported `recase` module); it splits on case
boundaries and separators, matching TODL's convention.

**No change** to the other generators:

- `slugify` (meta-model + library factories) produces the project/package
  **id** — a manifest field and backend path segment (`ea/0.1.0/`), never a
  TODL identifier. Kebab is correct there.
- `iconKey` (presentation-generator) produces `mm_icon_actor_internal` — a
  mural resource key using underscores, which are legal C-like and not a TODL
  id.
- `humanize` produces display labels only.

### 2. TODL corpus recasing (test fixtures)

~30 test files carry backtick TODL fragments with kebab identifiers plus
single/double-quoted assertion strings that reference the same ids. The
backtick fragments recase mechanically with SP1's `recase-ts.ts`; the quoted
assertion strings do not (the recaser deliberately never touches `'`/`"`
strings) and are corrected by hand, with the Plexus test suite (`vitest`) as
the oracle — the same grind pattern proven in SP1.

Representative renames:

| kebab | C-like | role |
| --- | --- | --- |
| `realised-by`, `deployed-to`, `implemented-by` | `realisedBy`, `deployedTo`, `implementedBy` | member (field/relationship) |
| `component-category`, `location-type` | `ComponentCategory`, `LocationType` | type (concept) |
| `azure-openai`, `azure-func` | `AzureOpenai`, `AzureFunc` | taxonomy term (type) |
| `web-tier` | `WebTier` | class (type) |
| `stack.azure-openai` | `stack.AzureOpenai` | qualified term ref |
| `app-model` | `appModel` | model id (follows SP1 emitter) |

`app-model` → `appModel` is mandated by the SP1 change to `emit/todl.ts`
(model id = camelCase flatten of namespace + `Model`); both the source
fixtures and the `toContain(...)` assertions move together.

### 3. Scaffold documentation

`todl-manual.md` and `meta-model-guide.md` under
`src/renderer/src/modules/meta-model/services/scaffold/` ship into every
meta-model project as the authoring manual an agent reads. If they keep
teaching kebab, agents author kebab and hit lexer errors. Both files get:

- every embedded TODL example recased to C-like, and
- the naming-convention prose rewritten to state the C-like rules:
  PascalCase for types (concepts, taxonomies, primitives, annotations,
  enums, terms, classes), camelCase for members (fields, relationship names,
  annotation params), lowercase for keywords and namespaces.

### 4. Dependency floor

Bump `@pragmatic-lab/todl` from `^0.18.0` to `^0.19.0` in `package.json` and
relock (`npm install`). The build script `scripts/build-todl-server.mjs`
already tolerates `>=0.3.0` and needs no change.

## Tooling

The recaser is run as a **throwaway dev script** driving TODL's local
`recase-ts.ts` / `recase.ts` against the Plexus tree (the pattern SP1 used
with its `_migrate_*.ts` scripts), removed on completion. TODL is **not**
given a public `./migrate` subpath export — this is a one-time pass (YAGNI).

## Out of scope

Meta-models and libraries already **published** to live backends under kebab
ids would need republishing under C-like ids. That is live data outside the
repository and is recorded as a manual operational follow-up, not code in
this migration.

## Success criteria

- `freshId` emits valid camelCase C-like ids; a new instance round-trips
  through `emit()`/`load()`.
- The full Plexus test suite is green under `@pragmatic-lab/todl@0.19.0`.
- No kebab identifier remains in any TODL source string or scaffold doc.
- `package.json` pins `^0.19.0` and the lockfile matches.

# Base `TodlProjectFactory` — Design

**Date:** 2026-08-17
**Status:** Approved (brainstorm)

## Goal

Introduce an abstract base `TodlProjectFactory` that owns everything common to a
TODL-authoring project — the project lifecycle plumbing, TODL source collection,
and the basic TODL-related agentic scaffolding — so **every** TODL project type
(architecture, meta-model, library) knows TODL grammar and rules. The three
concrete factories become thin subclasses that declare only what differs.

## Motivation

Today all three factories are TODL-authoring projects that independently
reimplement the same plumbing:

- identical `buildProject` (root node + populate);
- near-identical `populate` (recursive storage walk, `.todl` → kind `'todl'`;
  architecture additionally maps `.diagram` → `'diagram'`);
- duplicated `basename` / `slugify` / path helpers;
- the `.todl` `ProjectFileFormat` entry.

Meanwhile the agent-support scaffold (`CLAUDE.md` + `.claude/todl-manual.md` +
guides) is written **only** by `MetaModelProjectFactory`. Architecture and
library projects — equally TODL-authoring — get **no** TODL guidance at all. And
the shared source-collection helper (`todl-sources.ts`) lives inside the
meta-model module yet is imported cross-module by five consumers.

## Decisions (locked during brainstorm)

1. **Full consolidation.** The base owns all three tiers: agentic scaffolding,
   factory plumbing, and TODL source collection.
2. **Set-union scaffold.** The base contributes shared files
   (`.claude/todl-manual.md` + `.claude/todl-rules.md`); each subclass
   contributes its own `CLAUDE.md` + type-specific guides. `ensureScaffold`
   writes the union; each file remains write-once (never overwrites author
   edits). No templating.
3. **Architecture & library projects start getting the scaffold.** This is an
   intended behavioral addition — the whole point is that any TODL project knows
   the grammar and rules.
4. **Abstract base class** (not a delegated helper or a mixin) — it is the "base
   factory" object requested, and matches the existing `ServiceBase` pattern.

## Architecture

`TodlProjectFactory extends ServiceBase implements IProjectFactory`, in
`services/projects/`. Single-inheritance chain:
`ServiceBase → TodlProjectFactory → { Architecture | MetaModel | Library }`.
The base constructor forwards `provider` to `ServiceBase`.

### What the base owns

- **`createProject(storage, name, bindings?)`** — template method:
  1. `manifest = this.buildManifest(name, bindings)` (abstract);
  2. write `project.plexus`;
  3. `await this.ensureScaffold(storage)`;
  4. `return this.buildProject(storage, manifest)`.
- **`openProject(storage)`** — read the manifest envelope,
  `await this.ensureScaffold(storage)` (self-heal), `buildProject`.
- **`saveProject(project, storage)`** — fully generic: re-read the manifest
  JSON, set `name = project.Name`, write back. Preserves every type-specific
  field (id/modelVersion/libVersion/metaModel/libraries/diagrams). Identical to
  all three current implementations, so it moves down unchanged.
- **`buildProject(storage, manifest)`** — build the root `ProjectNode`, populate,
  return `new Project(manifest.type, manifest.name ?? rootName, storage.Root,
  root)`.
- **`populate(storage, node)`** — recursive storage walk. Node kind is **derived
  from `this.formats`**: an entry's extension is matched against the subclass's
  declared `ProjectFileFormat[]`; a hit uses that format's `kind`, a directory is
  `'folder'`, everything else is `'file'`. This reproduces every current mapping
  (`.todl` → `'todl'` for all; `.diagram` → `'diagram'` for architecture) with no
  per-subclass code. The manifest file stays hidden at the root.
- **`ensureScaffold(storage)`** — writes the union of `TODL_BASE_SCAFFOLD` (the
  base's shared files) and `this.scaffoldContributions()` (abstract, subclass
  extras). Each file is written only when absent (`storage.Exists` guard);
  creates `.claude/commands` up front, as today.
- Shared `basename` path helper.

### Abstract members the subclass supplies

```ts
protected abstract buildManifest(name: string, bindings?: BaseBindings): ProjectManifestEnvelope
protected abstract scaffoldContributions(): readonly ScaffoldFile[]
// plus the existing IProjectFactory surface each already declares:
public abstract readonly formats: readonly ProjectFileFormat[]
// (ProjectType stays a static on each concrete factory, as today — the
//  instance manifest carries `type` from buildManifest.)
```

`ScaffoldFile` (`{ path: string; content: string }`) and `ensureScaffold` move
out of `meta-model-scaffold.ts` into the base module.

## File structure

### New

- **`services/projects/todl-project-factory.ts`** — the abstract base, the
  `ScaffoldFile` interface, `ensureScaffold`, and `TODL_BASE_SCAFFOLD` (the two
  shared file entries wired to the `?raw` imports below).
- **`services/projects/scaffold/todl-manual.md`** — the pure TODL language
  reference, **moved verbatim** from
  `modules/meta-model/services/scaffold/todl-manual.md`.
- **`services/projects/scaffold/todl-rules.md`** — the TODL golden-rules block,
  **extracted** from the current `claude-root.md` "Golden rules — the current
  TODL surface" section, so the rules are single-sourced. Destination path in a
  project: `.claude/todl-rules.md`.
- **`services/projects/tests/todl-project-factory.test.ts`** — see Testing.
- **`modules/architecture-projects/services/scaffold/claude-root.md`** — new
  architecture `CLAUDE.md` content.
- **`modules/library/services/scaffold/claude-root.md`** — new library `CLAUDE.md`
  content.

### Moved

- **`modules/meta-model/services/todl-sources.ts` →
  `services/todl/todl-sources.ts`** (+ its test under `services/todl/tests/`).
  Repoint the five importers:
  `library-project-factory.ts`, `meta-model-project-factory.ts`,
  `services/wiki/wiki-locator.ts`, `services/todl/todl-language-client.ts`,
  `modules/architecture-projects/services/architecture-model-service.ts`
  (and any test that imports it).

### Modified

- **`modules/meta-model/services/meta-model-project-factory.ts`** — extends
  `TodlProjectFactory`; drops `buildProject`/`populate`/`saveProject`/`basename`;
  implements `buildManifest` (id/modelVersion defaults) and
  `scaffoldContributions()` (its `CLAUDE.md` + `meta-model-guide.md` +
  `commands/new-concept.md`); keeps publish / producer / presentation.
- **`modules/library/services/library-project-factory.ts`** — extends the base;
  drops the shared plumbing; implements `buildManifest` (id/libVersion/metaModel)
  and `scaffoldContributions()` (its new `CLAUDE.md`); keeps publish / producer /
  presentation + `copyResourceFolder`.
- **`modules/architecture-projects/services/architecture-project-factory.ts`** —
  extends the base; drops the shared plumbing; implements `buildManifest`
  (metaModel/libraries) and `scaffoldContributions()` (its new `CLAUDE.md`);
  `formats` adds the `.diagram` entry. Now gains scaffold on create/open.
- **`modules/meta-model/services/meta-model-scaffold.ts`** — reduced to the
  meta-model's own contributions (its `CLAUDE.md`, `meta-model-guide.md`,
  `new-concept.md` as `?raw` imports exported as a `ScaffoldFile[]`). The
  `todl-manual.md` entry and the `ensureScaffold`/`ScaffoldFile` machinery leave.
- **`modules/meta-model/services/scaffold/claude-root.md`** — its "Golden rules"
  section is replaced by a short pointer to `.claude/todl-rules.md` (rules now
  single-sourced); the meta-model-specific framing stays.

## Scaffold layout (result)

Every TODL project (all three types) receives:

```
.claude/todl-manual.md      (base — full language reference)
.claude/todl-rules.md       (base — golden rules)
CLAUDE.md                   (subclass — project-type intro + workflow,
                             references the two files above)
```

Meta-model additionally receives:

```
.claude/meta-model-guide.md
.claude/commands/new-concept.md
```

## Data flow

`create`/`open` → base template method → `ensureScaffold` writes base files
(`todl-manual`, `todl-rules`) then subclass files (`CLAUDE.md`, guides) if
absent → `buildProject` walks storage, mapping each entry's extension against
`this.formats`.

## Error handling

Unchanged from today: scaffold writes are best-effort write-once via
`storage.Exists`; publish/compile error handling stays entirely in the concrete
subclasses. No new failure modes — the base only relocates existing behavior.

## Testing

- **Keep green:** the three existing factory suites
  (`meta-model-project-factory.test.ts`, `library-project-factory.test.ts`,
  `architecture-project-factory.test.ts`).
- **New `todl-project-factory.test.ts`** — drive the base through a minimal fake
  subclass (in-memory `IStorage`):
  - `ensureScaffold` writes base ∪ subclass files, and a second call with a
    pre-existing file leaves that file untouched (write-once);
  - `populate` maps kinds from `formats` (a `.todl` file → `'todl'`, an
    unmatched extension → `'file'`, a nested folder recurses);
  - `saveProject` renames while preserving an unrelated manifest field.
- **New assertions** (in the architecture and library suites, or the base suite):
  a freshly created architecture project and a freshly created library project
  each contain `.claude/todl-manual.md`, `.claude/todl-rules.md`, and their own
  `CLAUDE.md`.
- **Moved:** the `todl-sources` test travels with the source to
  `services/todl/tests/`.

## Risks

- **`todl-sources` relocation** touches five importers — path-only, mechanical;
  the typecheck (`npm run typecheck:web`) is the guard.
- **Single-inheritance chain** — the three factories currently extend
  `ServiceBase`; inserting `TodlProjectFactory` between them and `ServiceBase`
  keeps DI intact provided the base ctor forwards `provider`.
- **Behavioral addition** (scaffold for architecture/library) is intended and
  covered by the new assertions; it never overwrites author files.

## Out of scope

- No change to publish/producer/presentation logic beyond relocation.
- No change to the New-Project dialog, the manifest schema, or the
  `ProjectFactoryRegistry` wiring.
- No new project types.

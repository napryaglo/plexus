# Diagnostics & Problems Dock — Design

**Date:** 2026-07-23
**Status:** Approved (brainstorm), pending implementation plan

## Problem

Plexus surfaces compilation/validation errors through two surfaces, both with gaps:

1. **Live validation → Monaco squiggles.** `TodlValidationService` watches open `.todl`
   documents, debounces 250ms, runs `checkAgainst(bases, sources)` over the whole
   project, and pushes `EditorDiagnostic`s into each open editor via `setModelMarkers`.
   This works — but **only for files currently open**. Diagnostics for unopened files
   are computed (TODL validates all sources in one pass) and then discarded.

2. **Publish → single status string.** `publish()` runs the same TODL check, filters
   to `Severity.Error`, and returns `PublishResult { ok, message }`. The explorer sets
   `this.Status = result.message`, so a failed publish shows one flat, uncolored line
   like *"Publish blocked: 3 error(s). Fix them first."* — no file, no line, no way to
   jump to the offending spans. Base-binding failures (*"meta-model acme@1.0 is not
   published"*) land in the same string.

The diagnostic **data** is already clean and typed. The gap is entirely **presentation
and navigation**: there is no aggregated view of all problems, no severity styling on
status, and no navigation from a failure to the actual spans.

## Goals

- A **Problems dock** in the shell's bottom Status region: a VS Code-style, always-visible,
  glanceable view of every diagnostic across every open project, expandable to a grouped,
  navigable tree.
- **Continuous, whole-project** validation feeds it: the dock reflects current project
  health, validated on project-open and kept live as files change — even with no editor open.
- **All open projects** shown, grouped project → file.
- **Publish routes into the dock**: failures direct attention there instead of emitting a
  flat count string.
- A **source-agnostic** diagnostics store, so future non-TODL producers (e.g. diagram
  validation) plug in without touching the store or the dock.

## Non-Goals

- Persistent error history / log across sessions.
- Toast/notification system (the dock + status string are the channels).
- Quick-fix / code-action affordances on diagnostics.
- Incremental (per-edit-range) diagnostics — validation stays whole-project per pass.

## Existing Architecture (as found)

- **Shell** (`app.mu`): `EditorShell` lays out six regions — Header, Commands, Navigation
  (left), Content, Inspector (right), **Status (bottom)**. The Status region is real and
  lightly used: the diagram module puts a connector-mode indicator there
  (`Region = StatusBar`).
- **`TodlValidationService`** (`src/renderer/src/services/todl/todl-validation-service.ts`):
  root-scoped, already coordinates **all open projects** (per-project base cache). On a
  `.todl` doc change it debounces 250ms, collects all project `.todl` sources, resolves
  bases via `resolveBases`, calls `checkAgainst(bases, sources)`, maps TODL `Diagnostic`s
  to `EditorDiagnostic`s, and distributes to each **open** doc's `Diagnostics` collection.
  Unresolved bases surface as a whole-file error.
- **`CodeDocument`** (`src/renderer/src/modules/code-editor/code-document.ts`): owns a
  `Diagnostics: ObservableCollection<EditorDiagnostic>` DP; the `CodeEditor` view binds it
  and renders Monaco markers. A validation producer replaces the collection's contents each
  pass. This is the editor's consumer seam.
- **`EditorDiagnostic`** (`src/renderer/src/modules/code-editor/editor-diagnostic.ts`):
  `{ severity, message, startLine, startColumn, endLine, endColumn }` — 1-based, exclusive
  end column. Maps to `monaco.editor.IMarkerData` (Error=8, Warning=4, Info=2, Hint=1).
- **Publish**: `MetaModelProjectFactory.publish()` and `LibraryProjectFactory.publish()`
  implement `IPublishableProjectFactory` (`src/renderer/src/services/projects/project-factory.ts`),
  returning `PublishResult { ok, message }`. `ProjectExplorerService.publishProject()` sets
  `this.Status = result.message`. Library publish first resolves bases (`resolveBases` →
  `{ bases, problems }`); architecture projects are consumers and are not publishable.

## Design Decisions

| Decision | Choice |
|----------|--------|
| Panel scope | **All open projects**, grouped project → file |
| Trigger | **Continuous, whole-project** — validate on project-open, keep live on edit |
| Store architecture | **Generic `DiagnosticsService`** — owner-agnostic; TODL validation publishes into it, Monaco + dock consume |
| Placement | **Bottom Status-region dock** (VS Code style), additive to the connector-mode indicator |

## Section 1 — `DiagnosticsService` (the store)

A new **root-scoped, source-agnostic** service: the single source of truth for every
diagnostic. Producers publish; consumers subscribe. It knows nothing about TODL.

Canonical type — one `Diagnostic`, richer than `EditorDiagnostic`:

```ts
enum DiagnosticSeverity { Error, Warning, Info, Hint }

interface DiagnosticSpan {
    startLine:   number   // 1-based
    startColumn: number   // 1-based
    endLine:     number
    endColumn:   number   // exclusive
}

interface Diagnostic {
    owner:       string                  // producer id, e.g. "todl" — namespaces publishes
    projectId:   string                  // which open project
    projectName: string                  // for the dock's group header
    uri:         string | null           // project-relative file; null ⇒ project-level (base-binding)
    message:     string
    severity:    DiagnosticSeverity
    span:        DiagnosticSpan | null    // null for project-level diagnostics
    code?:       string                  // optional rule id, reserved
}
```

API — publish **replaces all** diagnostics for an `(owner, projectId)` key in one atomic
pass, matching how validation already works (whole-project each run):

```ts
Publish(owner: string, projectId: string, diagnostics: Diagnostic[]): void
ClearProject(projectId: string): void            // on project close (clears all owners)
readonly All: ObservableCollection<Diagnostic>    // dock binds a grouped view over this
ForUri(uri: string): /* observable */ Diagnostic[] // editor subscribes per-file
```

`EditorDiagnostic` becomes a **derived projection** of `Diagnostic` (span + severity +
message) — the Monaco layer never sees `owner`/`project`. Keeping it separate preserves the
existing editor binding and marker mapping unchanged.

Rationale for replace-set over incremental add/remove: a validation pass produces the
complete diagnostic set for a project every time, so replacing the `(owner, project)` slice
is the natural, leak-free update — fixed problems disappear without bookkeeping.

## Section 2 — Producers: validation + publish

**`TodlValidationService` becomes a producer.** After each whole-project `checkAgainst`
pass it maps **all** diagnostics (every file, opened or not) to `Diagnostic`s and calls
`DiagnosticsService.Publish("todl", projectId, all)` — one publish per pass, per project.
It stops writing into `CodeDocument.Diagnostics` directly.

- **Project open** triggers a first validation pass, so the dock is populated before any
  file is opened (satisfies continuous, whole-project).
- **Project close** → `DiagnosticsService.ClearProject(projectId)`.
- **Unresolved base bindings** — today a whole-file error — become **project-level**
  diagnostics (`uri: null`).

**The Monaco editor consumes from the service.** `CodeDocument.Diagnostics` stays as the
editor's binding (no view change). When a doc opens it subscribes to
`DiagnosticsService.ForUri(uri)` and mirrors that file's diagnostics — projected to
`EditorDiagnostic` — into its collection. Squiggles work identically; the source moved from
"validator pushes into the doc" to "doc pulls its slice from the store."

**Publish routes into the dock.** `publish()` keeps its own authoritative `check` /
`checkAgainst` for the go/no-go decision (correct at that instant, independent of dock
state). On failure it:

1. Publishes any base-resolution `problems` as **project-level** diagnostics under owner
   `"todl"` (so they appear in the dock).
2. Reveals + focuses the dock.
3. Sets status to *"Publish blocked — N problem(s), see Problems."*

Because validation is continuous, the offending spans are already listed in the dock. On
success: *"Published id@version (N file(s))."* The flat "N error(s)" string is removed.

## Section 3 — The dock (Status region) + navigation

A `ProblemsService` (root-scoped) exposes a grouped, observable view over
`DiagnosticsService.All`: **project → file → diagnostics**, plus rolled-up error/warning
counts. It renders in the Status region via `DataTemplate[ProblemsService]`.

- **Collapsed bar** (always visible): `⊗ 3   ⚠ 2` — red error count, amber warning count;
  `✓ No problems` when clean. Click to expand.
- **Expanded tree**: project headers (shown only when more than one project has problems),
  file rows with per-file counts, diagnostic rows with severity icon, message, and
  `line:col`. Project-level entries (`uri: null`) sit in a **"Project"** bucket under their
  project.
- **Navigation**: clicking a file/diagnostic row opens the `.todl` via `CodeEditorService`
  (dedupes to an existing tab) and reveals the span in Monaco via a small `RevealSpan`
  added to the editor. Span-less project-level rows open the project's manifest, or no-op if
  none applies.
- The existing connector-mode indicator keeps its corner of the Status region; the dock is
  additive.

## Section 4 — Edge cases

- **Multi-project**: the tree groups by project; closing one clears only its group via
  `ClearProject`.
- **Span-less diagnostics** (base bindings): first-class via `uri: null` → project bucket,
  non-navigable to a line.
- **Stale on edit**: `Publish` replaces the whole `(owner, project)` set each pass, so fixed
  problems vanish without leak; the existing 250ms debounce throttles.
- **No open editors**: dock still fully populated (validation runs on project open).
- **Non-TODL future** (e.g. diagram validation): just a new `owner` — no store or dock change.

## Section 5 — Testing

Per the repo convention, every test file lives in a `tests/` subfolder next to its source.

- **`DiagnosticsService`**: publish-replaces-set for an `(owner, project)` key; `ClearProject`
  drops all owners for a project; per-uri projection returns only that file's slice; grouped
  view produces correct project → file structure and counts.
- **`ProblemsService`**: grouping and rolled-up error/warning counts; single-project vs
  multi-project header behavior; project-level bucket for `uri: null`.
- **`TodlValidationService` (producer)**: a whole-project pass publishes diagnostics for
  **unopened** files too; an unresolved base yields a project-level diagnostic.
- **Publish routing**: a failing publish publishes base-resolution problems as project-level
  diagnostics and sets the blocked status; a passing publish emits the success status.
- **UI template**: thin; exercised through the services above.

## Files (anticipated)

New:
- `src/renderer/src/services/diagnostics/diagnostics-service.ts` — the store + `Diagnostic` type.
- `src/renderer/src/services/diagnostics/tests/diagnostics-service.test.ts`
- `src/renderer/src/modules/problems/problems-service.ts` — grouped view over the store.
- `src/renderer/src/modules/problems/problems.resources.mu` — `DataTemplate[ProblemsService]`.
- `src/renderer/src/modules/problems/problems.module.mu` — Status-region contribution.
- `src/renderer/src/modules/problems/tests/problems-service.test.ts`

Changed:
- `todl-validation-service.ts` — publish to `DiagnosticsService` instead of per-doc; validate
  on project open; clear on close.
- `code-document.ts` / code editor — subscribe `Diagnostics` from `DiagnosticsService.ForUri`;
  add `RevealSpan`.
- `meta-model-project-factory.ts`, `library-project-factory.ts` — publish base-resolution
  problems as project-level diagnostics on failure.
- `project-explorer-service.ts` — updated publish status strings; reveal/focus dock.
- `app.mu` — register `DiagnosticsService`, add the problems module, merge its resources.

## Open Questions

None blocking. The `code` field on `Diagnostic` is reserved for a future rule-id / quick-fix
story and is unused in v1.

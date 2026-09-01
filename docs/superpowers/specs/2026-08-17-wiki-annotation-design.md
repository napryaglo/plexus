# Wiki annotation — attach wiki pages to concepts

**Goal:** A `wiki` TODL annotation, analogous to `icon`, that attaches a
Markdown page (a `.md` file in the project) to a concept. In Plexus, an
"Open Wiki" action on the concept's surfaces opens that `.md` in a Monaco
editor tab.

## Background

The `icon` annotation is declared in TODL's prelude
(`src/stdlib/prelude.todl`: `annotation icon : MuralResource { path : string?; }`)
and attached with `annotate icon { path = "resources/service.svg"; }` on a
concept. It is read at runtime via `repo.resolve(\`${id}@icon\`)?.attrs.get('path')`.
The TODL annotation machinery is generic: any `annotation <name> { ... }`
becomes resolvable as `repo.resolve(\`${target}@<name>\`)` with no bespoke
wiring — the parser mints the `<target>@<name>` application node, the builder
stages it with an `Annotated` edge, and `projectAnnotations` is annotation-agnostic.

Unlike `icon`, a wiki page is **not** baked into published presentation; the
`.md` is opened from its source project on disk. This is **Approach A
(source-only, workspace-linked)**: wiki works for a concept whose declaring
project is open in the workspace. Baking wiki content into published packages
(so published-only bases work too) is a deliberate future extension
(Approach B), out of scope here.

## Behavior

- A concept is annotated with `annotate wiki { path = "wiki/service.md"; }`.
  `path` is relative to the root of the project that **declares** the concept.
- "Open Wiki" appears on a concept surface **only when** the concept has a
  `wiki` annotation (a `HasWiki` flag drives menu-item visibility).
- Invoking "Open Wiki" resolves the declaring open project's root, joins the
  relative path, and opens the absolute `.md` path as a Monaco tab (reusing
  `CodeEditorService.OpenFile`). If the declaring project is not open, or the
  file is missing, a brief status message explains why; nothing crashes.

## Architecture

### A. TODL — the annotation

Add to `src/stdlib/prelude.todl` (next to the `icon` declaration):

```todl
annotation wiki { path : string?; }
```

Plain (not `: MuralResource`): wiki carries no publish-time resource key and
is never baked. Being in the prelude, it is injected as an implicit base by
`check`/`checkAgainst`, so `annotate wiki { ... }` is valid in every model and
`repo.resolve(\`${concept}@wiki\`)` resolves anywhere — no meta-model
republish needed (same as `icon`).

Publish: bump `@pragmatic-tech-ai/todl` (minor), publish to the local Verdaccio
(`localhost:4873`), bump Plexus's `todl` dependency.

### B. Plexus — `WikiService` (the DRY core)

A new root-registered service
(`src/renderer/src/modules/architecture-projects/services/wiki-service.ts`,
or a neutral `services/wiki/` location — see File Structure). Responsibilities:

- `hasWiki(repo: Repository, concept: string): boolean` — a pure helper:
  `typeof repo.resolve(\`${concept}@wiki\`)?.attrs.get('path') === 'string'`.
  (Exported as a free function so surface-builders can compute the flag
  without holding the service.)
- `OpenWikiCommand: ICommand` — a `RelayCommand` whose `CommandParameter` is
  the concept string; delegates to `openWiki(concept)`. Registered DP so `.mu`
  can bind `$service(WikiService).OpenWikiCommand`.
- `openWiki(concept: string): Promise<void>`:
  1. `root = WikiLocator.projectRootForConcept(concept)`. If `undefined` →
     status "Open the meta-model project that declares <concept> to view its
     wiki." and return.
  2. Read the relative path from that project's repository:
     `rel = <repo>.resolve(\`${concept}@wiki\`)?.attrs.get('path')`. If not a
     string → status "No wiki page for <concept>." and return.
  3. `abs = join(root, rel)` (renderer-safe join, separator inferred from
     `root`; the same helper `open-projects-store.join` uses — factor it into
     a shared util rather than a third copy).
  4. If `await FileSystemService.Exists(abs)` → `CodeEditorService.OpenFile(abs)`.
     Else → status "Wiki file not found: <rel>."

Status messages surface through whatever lightweight channel the app already
uses for transient notices (e.g. the same mechanism other services write
user-facing status to); if none is convenient, `console`-level is acceptable
for v1 and noted as a follow-up. (Resolve during planning by checking how
existing services report "couldn't do it" to the user.)

### B2. `WikiLocator` — concept → declaring open project root

A focused collaborator
(`.../services/wiki-locator.ts`) with one method:

```ts
projectRootForConcept(concept: string): string | undefined
```

**Strategy:** return the root of the open project whose **own source** declares
the concept — i.e. the meta-model/library that authored it, not a consuming
architecture project (whose composed repo also resolves the concept via its
base). Two candidate mechanisms, to be chosen in planning after a close read:

1. **Own-repo probe** — iterate open projects; for each, obtain its
   own-source repository (pre-base-composition) and pick the one that declares
   `concept` locally (and carries its `@wiki`). Preferred if each project type
   exposes an own-source repo.
2. **Namespace match** — derive the concept's namespace prefix and match it
   against each open project's declared namespace
   (`ArchitectureModelService` derives one per architecture project; meta-model
   and library projects declare theirs in source/manifest). Fallback if (1) is
   awkward for some project type.

This is the **main implementation risk**; isolating it behind one method keeps
it unit-testable and swappable without touching consumers. `undefined` when no
open project declares the concept (the Approach-A limitation) is a normal,
handled outcome.

### C. The four surfaces

All four currently lack a context menu. Each gains one "Open Wiki" item,
shared across surfaces:

```
MenuItem [ Header = "Open Wiki",
           Visibility = $HasWiki << ToVisibility,
           Command = $service(WikiService).OpenWikiCommand,
           CommandParameter = $Concept ]
```

Each surface must expose two things on its item VM: `Concept` (the concept id
string) and `HasWiki` (boolean, computed at build time via the `hasWiki`
helper against the relevant repository).

1. **Architecture canvas node** — `ArchNodeVM`
   (`modules/architecture-projects/services/arch-node-vm.ts`). The binding
   (`arch-diagram-binding.ts`) already knows each node's `Entity` + the model
   repo; set `Concept` + `HasWiki` when it builds/updates the node. Add a
   `ContextMenu` to the ArchNodeVM template in `diagram.resources.mu`.
2. **Toolbox tile** — `ArchToolboxItem`
   (`modules/diagram/services/arch-toolbox-item.ts`). The contributor
   (`arch-model-toolbox-contributor.ts`) builds tiles and has the repo +
   entity; set `Concept` + `HasWiki`. Add a `ContextMenu` to the tile template.
3. **Meta-model concept** — `MetaModelTreeNode` entity rows
   (`modules/meta-model/...`). Expose `Concept` + `HasWiki` on entity nodes;
   add an entity-row context menu. Self-contained: the concept is declared in
   the current meta-model project, so `WikiLocator` resolves to it directly.
4. **Library tile** — `LibraryTreeNode` leaf (already exposes `Concept`). Add
   `HasWiki` + a leaf context menu. Resolves when the library project is open.

One `WikiService.OpenWikiCommand` serves all four; surfaces differ only in how
they populate `Concept`/`HasWiki`.

## File structure

- `TODL/src/stdlib/prelude.todl` — add the `wiki` declaration.
- `TODL/src/stdlib/tests/prelude-wiki.test.ts` — parse/resolve test.
- Plexus, a new `wiki` feature folder (neutral, since it spans arch + meta-model
  + library surfaces): `src/renderer/src/services/wiki/` containing
  `wiki-service.ts`, `wiki-locator.ts`, `wiki.resources.mu` (the shared
  "Open Wiki" MenuItem, if factorable as a keyed template), and `tests/`.
  (If a shared keyed MenuItem across dictionaries proves awkward, inline the
  identical MenuItem in each surface's existing `.resources.mu` — decide in
  planning.)
- Touch points: `arch-node-vm.ts`, `arch-diagram-binding.ts`,
  `diagram.resources.mu` (node + toolbox templates), `arch-toolbox-item.ts`,
  `arch-model-toolbox-contributor.ts`, meta-model tree node + resources,
  library tree node + resources, and `app.mu` (register `WikiService` +
  merge its resources).

## Testing

- **TODL** (`prelude-wiki.test.ts`): a model with
  `concept service { annotate wiki { path = "wiki/service.md"; } }` loads, and
  `repo.resolve("service@wiki")?.attrs.get('path')` === `"wiki/service.md"`.
  `--test-force-exit`.
- **Plexus `hasWiki`**: true for an annotated concept, false for a bare one.
- **Plexus `WikiService.openWiki`** (fake `Repository` + fake
  `FileSystemService` + fake `CodeEditorService` + a stub `WikiLocator`):
  - happy path → `OpenFile` called with `join(root, rel)`.
  - no wiki annotation → no `OpenFile`, a status set.
  - locator returns undefined → no `OpenFile`, a status set.
  - file does not exist → no `OpenFile`, a status set.
- **Plexus `WikiLocator`**: given open projects (fakes), returns the root of
  the one declaring the concept; `undefined` when none do.
- **Live Playwright smoke**: annotate one `tech-architecture` concept with
  `annotate wiki { path = "wiki/<concept>.md" }`, create the `.md`, open an
  architecture diagram with a node of that concept, right-click → "Open Wiki",
  assert a Monaco tab opens for that `.md`. (Reuses the Electron+Playwright
  harness; mural hit-rect / non-input gotchas from prior smokes apply.)

## Out of scope (v1)

- Publish-baking wiki `.md` into library/meta-model packages (Approach B) —
  the path to supporting published-only bases that aren't open.
- A rendered Markdown viewer panel (v1 opens the raw `.md` in Monaco).
- Creating/editing/renaming wiki pages from the UI (author the `.md` + the
  annotation by hand, like icons today).
- Wiki on relationship members / an `iconSource`-style precedence
  (concept-level only).

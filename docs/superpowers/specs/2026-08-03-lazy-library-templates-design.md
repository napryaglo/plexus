# Lazy Library Template Compilation — Design

**Status:** Design approved 2026-08-03. Ready for an implementation plan.

**Goal:** Make the Libraries panel appear instantly regardless of library size by
splitting cheap library **discovery** from expensive per-class **template
compilation**, compiling a class's visual only when it is actually shown (preview
pane) or placed (canvas). Add a loading indicator for the discovery phase.

**Tech Stack:** Plexus renderer — TypeScript (ESM, strict), mural runtime
(`ServiceBase`, `Model`/DPs, `ObservableCollection`, `ResourceDictionary`),
`.mu` templates, vitest.

---

## Problem

`LibraryRegistry.refresh()` eagerly compiles a live `DataTemplate` (or parses an
SVG icon) for **every class** in every published library before it returns, and
`LibrariesPanelService.Reload()` adds zero tree rows until that loop finishes. A
large library — e.g. the user's `microsoft` library with **470 classes** — takes
several seconds, during which the panel reads as empty (root-caused via
instrumentation: the panel *is* loading, just blocked on compilation).

Yet the panel tree rows render only a glyph + the node name
(`library.resources.mu` `LibraryNodeTemplate`) — **no inline template**. The
compiled `DataTemplate` is consumed only by:
- the panel's **preview pane** (`$PreviewTemplate`), for the *selected* class, and
- the **canvas** (`ArchDiagramDocument.ResolveTemplate` → `InstanceNodeVM.Template`),
  for the nodes on an *open* diagram.

So compiling all 470 up front is wasted work for a list that needs none of it.

## Goal / Success Criteria

- The panel shows its library/concept/class rows immediately after cheap
  discovery, independent of library size.
- A class's template compiles lazily — only when previewed or placed on a canvas.
- The canvas still shows the correct per-class visual (upgrading from the default
  box once the class compiles), and no longer silently depends on the Libraries
  panel having been opened first.
- A loading indicator shows during the discovery phase.
- `library.json` format, publishing, and the default-template fallback are
  unchanged.

## Design

### 1. `LibraryRegistry` contract (`library-registry.ts`)

Split the current `refresh()` into cheap discovery + lazy, notifying compilation.

- **`discover(): Promise<LoadedLibrary[]>`** — runs `discoverLibraries(backend)`
  (reads each `library.json`), builds a `classIndex: Map<string, { lib:
  LoadedLibrary; cls: LoadedClass }>` for later compilation, and publishes each
  library's **discovery** problems (malformed manifest, missing referenced
  resource — already produced by `loadLibrary`). Does **no** template
  compilation. Returns the loaded set for the panel. Calls `ensureMerged` so the
  app-resources dictionary is wired before any lazy compile populates it.
- **`resolve(classId, concept): DataTemplate`** — unchanged signature, still
  synchronous. Returns the memoized compiled template from `libraryVisuals` if
  present; else, if `classId` is in `classIndex` and not already compiling,
  schedules `compileClass(classId)` (fire-and-forget, deduped via an in-flight
  `Set<string>`) and returns the shared `defaultTemplate` for now; else returns
  the default.
- **`compileClass(classId): Promise<void>`** (private, async) — looks up
  `{ lib, cls }` in `classIndex`; `readTemplateSource` / `readIconSource`;
  `compileTemplate` / `buildIconTemplate(parseSvgIcon(...))`; on success
  `libraryVisuals.Set(classId, tmpl)`; on failure record a compile problem and
  republish that library's Problems slice (accumulated per library so a trickle
  of compiles doesn't clear earlier entries); finally remove from the in-flight
  set and fire `Changed(classId)`.
- **`onChanged(listener: (classId: string) => void): () => void`** — a plain
  listener registry (returns an unsubscribe). Fired by `compileClass` when a
  class's real template becomes available.
- `resolve` semantics preserved: callers that never react to `onChanged` still
  get the default until (if ever) the class is compiled — identical to today's
  "not mounted → default".

Problems reporting shifts from "all at once in refresh" to "discovery problems in
`discover`, compile problems as classes compile." Per-library Problems slices are
keyed exactly as today (`library:<id>@<version>`), so republishing on each
compile keeps one coherent slice per library.

### 2. Panel (`libraries-panel-service.ts` + `library.resources.mu`)

- Add **`IsLoadingKey`** DP (bool, default false).
- `Reload()`: set `IsLoading = true`; `const libs = await registry.discover()`;
  guard the stale-`seq` check; build the tree from `libs` **without** calling
  `registry.resolve` per leaf (drop the pre-resolved template argument — pass
  `undefined`); set `IsEmpty = roots.Count === 0`; set `IsLoading = false`.
- On class selection (`OnPropertyChanged` for a `Class` node): resolve the
  template for the preview (`registry.resolve(node.TermId, node.Concept)`),
  set `PreviewTemplate`; if it came back as the default (class not yet compiled),
  the panel's `onChanged` subscription updates `PreviewTemplate` when that class
  compiles and it is still the selected node.
- Subscribe to `registry.onChanged` in the panel (dispose on teardown); when the
  fired `classId` matches the selected class, re-resolve `PreviewTemplate`.
- `.mu`: add a loading row/spinner bound to `IsLoading` (docked top, beside the
  existing empty-state `TextBlock`), e.g. `Visibility = $IsLoading << ToVisibility`.

### 3. Canvas (`arch-diagram-document.ts`)

- `AddNode` keeps `vm.Template = this.ResolveTemplate(vm)` (default until the
  class compiles).
- In the constructor, subscribe to `registry?.onChanged`: when a class compiles,
  re-run `ResolveTemplate` for each node whose resolved key (`ReferencedTerm`
  else `Concept`) equals the compiled `classId`, and set `vm.Template`. Dispose
  the subscription in the document's existing teardown.
- Result: opening a diagram renders nodes as default boxes momentarily, then
  upgrades the referenced classes' visuals as they compile — only the classes on
  the diagram compile. Removes today's latent dependency on the Libraries panel
  having run `refresh` first.

## Components / File Map

**Modified**
- `src/renderer/src/modules/library/services/library-registry.ts` — split
  `refresh` → `discover` + lazy `resolve`/`compileClass`; add `onChanged`.
- `src/renderer/src/modules/library/services/libraries-panel-service.ts` —
  `IsLoading`; discover-then-build; lazy preview; `onChanged` subscription.
- `src/renderer/src/modules/library/library.resources.mu` — loading indicator
  bound to `IsLoading`.
- `src/renderer/src/modules/architecture-repository/services/arch-diagram-document.ts`
  — `onChanged` subscription upgrading node templates.

**Tests (each in a `tests/` subfolder next to its source)**
- `library-registry.test.ts` (extend) — discovery compiles nothing; `resolve`
  default→compiled after a `Changed` tick; dedup; `onChanged` fires.
- `libraries-panel-service.test.ts` (extend) — `IsLoading` toggles; tree
  populates from `discover` without compiling; preview upgrades on `Changed`.
- `arch-diagram-document.test.ts` (extend) — a node's `Template` upgrades on
  `Changed` for its referenced class.

## Testing Strategy

- A fake/instrumented `LibraryRegistry` or a compile-counter proves `discover()`
  triggers **zero** compilations for N classes.
- `resolve` returns `defaultTemplate` on first call for an un-compiled class,
  then the compiled template after awaiting a microtask/`onChanged`.
- Concurrent `resolve(classId)` calls schedule `compileClass` **once**.
- Panel: `IsLoading` is true during `discover` and false after; `Roots` populated
  with library/concept/class nodes; no compile occurred just to list.
- Canvas: after `AddNode` (Template = default), firing `onChanged(classId)` for
  the node's class sets `Template` to the compiled one.

## Non-goals

- Optimizing discovery's per-class `Exists` probes in `loadLibrary` (defer unless
  measured slow after this change).
- Any change to `library.json`, the publish pipeline, or the default-template
  fallback.
- Per-concept default templates (the `concept` arg to `resolve` stays reserved).
- Pre-warming / background-compiling all classes (defeats the purpose; compile is
  strictly on demand).

## Open sub-points (resolve during planning)

1. Whether `discover()` replaces `refresh()` outright or `refresh()` remains as a
   thin `discover()` alias for any other caller — grep shows the panel is the only
   caller, so replace outright and rename.
2. Exact loading-indicator visuals (spinner vs text) — a `.mu` detail, pick the
   simplest that matches existing panel styling.

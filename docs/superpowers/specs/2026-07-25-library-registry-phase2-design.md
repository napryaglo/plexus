# Library Registry (Phase 2) — Design

**Status:** ✅ Finished
**Date:** 2026-07-25

## Problem

Phase 1 made a library publish a complete bundle — `library.json` (its instantiable **classes**, each with optional `template`/`thumbnail`/`doc` paths), the `.mural` visual templates, assets, docs, and samples. Nothing yet *reads* that bundle. Phase 2 builds the `LibraryRegistry`: it discovers published libraries, loads their bundles, **mounts each class's `.mural` template into the running app as a live `DataTemplate`**, and surfaces the result in a **Libraries browse panel** that renders every class through its mounted template. The same registry is the engine Phase 3's drag-to-create palette will drive.

## Current state (grounding)

- **Bundle contract (Phase 1).** `<userData>/libraries/<id>/<version>/library.json` =
  `{ id, version, name, description?, metaModel: {id,version}, classes: PublishedClass[], assets: string[], docs: string[], samples: string[] }`,
  where `PublishedClass = { id, localId?, label?, concept, template?, thumbnail?, doc? }`. Class ids are library-qualified (e.g. `microsoft.azure`). Templates live at `visuals/<classId>.mural`, thumbnails at `thumbnails/<classId>.png`, docs at `docs/<classId>.md`. The backend is reached with `ensureLibrariesBackend(provider): IStorage` ([libraries-backend.ts](../../src/renderer/src/modules/library/services/libraries-backend.ts)).
- **Runtime `.mural` compilation exists.** `instantiate(source: string, ctx: Record<string, unknown>, options?): unknown` from `@pragmatic-lab/mural/compiler` compiles `.mural` markup text in-process (browser-safe, no `node:fs`). A `Fragment{…}` root compiles to a **factory** `(data) => Visual`; `ctx` must supply the runtime symbols (`{ ...runtime, ...basic, ...visualEngine }`).
- **Dynamic resource mounting exists.** `ResourceDictionary.AddMergedDictionary(dict)` merges a dictionary into a live one (reactive; last-added wins). `dict.Set(key, value)` registers entries; a **string** key is resolved by explicit reference, a **Function** (class) key by implicit prototype-walk. `Application.current.Resources` is the app-global dictionary.
- **`DataTemplate`** = `new DataTemplate(factory: (data)=>Visual, dataType?, …triggers)`; `template.Apply(data): Visual` materialises one instance.
- **Panel pattern.** A nav capability is `Capability [ Name, Icon, ServiceKey ]` on a module; the service (resolved as `NavigationService.ActiveService`) renders through a `DataTemplate [ DataType = <Service> ]`. `IActivatable.OnActivated()` fires on every rail selection — the re-scan hook (see the Meta-models panel, [meta-models-service.ts](../../src/renderer/src/modules/meta-model/services/meta-models-service.ts)).
- **Diagnostics store.** `DiagnosticsService.Publish(owner, projectId, Diagnostic[])` replaces one `(owner, projectId)` slice atomically; the Problems dock groups by `projectId` (header = `projectName`). `Diagnostic = { owner, projectId, projectName, uri, message, severity, span }`, `DiagnosticSeverity` enum. Resolve it optionally (`Provider.get(DiagnosticsService.Key)`).

## Architecture — three units

### Unit 1 — Bundle loader (`library-loader.ts`, headless)

Pure data. Reads bundles off the libraries backend into an in-memory shape.

```ts
interface LoadedClass {
    id:         string
    localId?:   string
    label?:     string
    concept:    string
    templatePath?:  string   // "visuals/<id>.mural" from the manifest, if present
    thumbnailPath?: string
    docPath?:       string
}
interface LoadedLibrary {
    id:       string
    version:  string
    name:     string
    metaModel: { id: string; version: string }
    classes:  LoadedClass[]
    problems: LoadProblem[]   // manifest / missing-file issues (see Error handling)
}
interface LoadProblem { uri: string | null; message: string; severity: 'error' | 'warning' }

// Discover every published <id>/<version> under the backend and load its manifest.
async function discoverLibraries(backend: IStorage): Promise<LoadedLibrary[]>
// Load one library's manifest (+ validate referenced files exist) into a LoadedLibrary.
async function loadLibrary(backend: IStorage, id: string, version: string): Promise<LoadedLibrary>
// Read a class's template source on demand (returns undefined if absent/unreadable).
async function readTemplateSource(backend: IStorage, lib: LoadedLibrary, cls: LoadedClass): Promise<string | undefined>
```

`discoverLibraries` lists the backend root for `<id>` dirs, each `<id>` for `<version>` dirs (the Phase-1 layout), and calls `loadLibrary` per pair. A malformed or unreadable `library.json` yields a `LoadedLibrary` with empty `classes` and one `error` problem — never a throw. A manifest that references a `template`/`thumbnail`/`doc` path with no file on disk records a `warning` problem (the class still loads). FakeStorage-testable end to end.

### Unit 2 — Visual mount + resolver (`LibraryRegistry` service + `visual-library.ts`)

`LibraryRegistry` (a `ServiceBase`, app-registered) owns mounting and resolution.

- **`ctx`** is built once: `{ ...runtime, ...basic, ...visualEngine }` from the mural packages.
- **One merged dictionary.** The registry holds a single `ResourceDictionary` (`this.libraryVisuals`) that it `AddMergedDictionary`s onto `Application.current.Resources` at construction. All class templates register into it, **string-keyed by class id**.
- **Default visual library.** A built-in generic template — a labelled box (`Border` + `TextBlock` bound to the class label) — is created programmatically as a `DataTemplate` and held as `this.defaultTemplate`. This is the "always-installed default library" for any class without its own template.
- **Mounting.** `async mount(lib: LoadedLibrary): Promise<void>` — for each class with a `templatePath`, `readTemplateSource`, `instantiate(source, ctx)` → factory → `new DataTemplate(factory)` → `this.libraryVisuals.Set(cls.id, template)`. A compile failure records a problem (see Error handling) and leaves the class on the default. Idempotent + cached: a library already mounted at the same `id@version` is skipped unless forced.
- **Resolver.** `resolve(classId: string, concept: string): DataTemplate` → the string-keyed class template if registered, else `this.defaultTemplate`. (Per-concept defaults are out of scope — a single generic default.) `concept` is accepted now for a future per-concept tier without an API change.
- **Refresh.** `async refresh(): Promise<LoadedLibrary[]>` — `discoverLibraries` + `mount` each; returns the loaded set (for the panel) and republishes diagnostics.

### Unit 3 — Libraries browse panel (`library` module nav capability)

Mirrors the Meta-models panel. New capability `Capability [ Name = "Libraries", Icon = @Libraries, ServiceKey = LibrariesPanelService ]` on the library module; a new `libraries-panel-service.ts` + `library.resources.mu`.

- `LibrariesPanelService extends ServiceBase implements IActivatable`. On `OnActivated` (and in the ctor) it calls `LibraryRegistry.refresh()` and rebuilds an `ObservableCollection<LibraryRow>`; `LibraryRow { name, version, classes: ObservableCollection<ClassRow> }`; `ClassRow { label, classData, template }` where `template` is `registry.resolve(cls.id, cls.concept)` and `classData` is a small model carrying the class's `label`/`localId`/`concept` (the template's data context).
- **Rendering through the mounted template.** `DataTemplate [ DataType = ClassRow ]` hosts a `ContentPresenter [ Content = $ClassData, ContentTemplate = $Template ]`, so a class with a real `.mural` renders its actual visual and an untemplated class renders the default box. Library/class grouping is a nested `ItemsControl` tree, exactly like the Meta-models panel's group-by-id.
- An empty backend shows a "No published libraries yet." line (an `IsEmpty` flag, as in the Meta-models panel).

## Data flow

```
libraries backend (library.json + visuals/*.mural)
   → discoverLibraries / loadLibrary            (Unit 1: data)
   → LibraryRegistry.mount: instantiate → DataTemplate → libraryVisuals.Set(classId, tmpl)
                                            AddMergedDictionary(Application.Resources)   (Unit 2)
   → resolve(classId, concept) → DataTemplate
   → LibrariesPanelService rows → ContentPresenter ContentTemplate = resolved template   (Unit 3)
```

## Lifecycle & scope

- The panel browses **all published** libraries (discovery, like Meta-models); it does **not** depend on an open architecture project.
- Templates mount **globally**, string-keyed by class id. Ids are library-qualified, so cross-library collisions don't occur; a re-published `id@version` re-mounts (overwrites its keys).
- Re-scan happens on panel `OnActivated`; a newly-published or re-published library is picked up then.
- **Phase 3 reuse:** the palette will call the *same* `LibraryRegistry` — filtered to a project's bound libraries (its manifest `libraries[]`) and using `resolve()` for canvas rendering — so nothing here is throwaway.

## Error handling → Problems dock

All failures route to `DiagnosticsService` under **owner `"libraries"`**, one slice per library: `projectId = "library:<id>@<version>"`, `projectName = "<name> (<id>@<version>)"`.

| Failure | severity | uri | message |
|---|---|---|---|
| `library.json` invalid/unreadable | Error | `library.json` | `Library manifest is invalid: <reason>` |
| `visuals/<classId>.mural` fails to `instantiate` | Error | `visuals/<classId>.mural` | `Template for <classId> failed to compile: <reason>` |
| manifest references a missing template/thumbnail/doc | Warning | the missing path | `Referenced resource is missing: <path>` |

`refresh()` re-`Publish`es each library's slice (empty when clean), so a fixed+re-published library's problems auto-clear on the next activation — the atomic-replace pattern the TODL validator uses. `DiagnosticsService` is resolved optionally, so the registry is inert (but records the same `LoadProblem[]`) when the dock isn't present — which is how headless tests assert reporting.

## Testing

- **Loader** (FakeStorage): a seeded bundle → `LoadedLibrary` with the right classes + `templatePath`s; a malformed `library.json` → one `error` problem, no throw; a manifest citing a missing file → one `warning` problem.
- **Registry** (mural packages in Node): `mount` a `LoadedLibrary` whose class has a minimal real `.mural` `Fragment` → `resolve(id, concept)` returns a `DataTemplate` that `.Apply(data)` materialises to the expected `Visual`; an untemplated class → `resolve` returns the default template; a syntactically bad `.mural` → the class falls back to default **and** a `LoadProblem`/published `Diagnostic` with `uri = visuals/<id>.mural` is produced.
- **Panel service**: builds `LibraryRow`/`ClassRow` from a stub/loaded registry; `IsEmpty` true on an empty backend; each `ClassRow.template` is the resolver's result.

## Out of scope (Phase 2)

- The drag-to-create palette and any diagram/canvas integration (Phase 3).
- Per-concept default templates and view-scoped template overrides (single generic default only).
- Filtering to a project's bound libraries (the panel browses all; Phase 3 filters).
- Thumbnail auto-generation (Phase 1 already deferred it).

## Open contracts to verify during implementation

1. **`instantiate` factory signature for a `Fragment` root** — confirm it returns `(data) => Visual` (or adapt the returned factory to `DataTemplateFactory`). The `visuals/<classId>.mural` authoring contract is: root is a `Fragment` whose visual binds to the class data context.
2. **`ContentPresenter.ContentTemplate`** accepts an explicit `DataTemplate` instance bound from a DP (`ContentTemplate = $Template`). If the DP is named differently, use that; the intent is "render this content with this specific template."
3. **A `Libraries` icon** must be added to `plexus-icons.mu` (reuse a generic glyph if no bespoke asset).

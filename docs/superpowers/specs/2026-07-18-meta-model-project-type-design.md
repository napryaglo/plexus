# Meta-model Project Type — Design Spec

**Date:** 2026-07-18
**Status:** ✅ Finished

## Goal

Add a **"Meta-model"** project type to Plexus: a user creates a Meta-model
project, authors a tree of `.todl` definition files in the Monaco editor with
whole-project live validation (inline squiggles), and **publishes** the
validated project — compiled `TodlDocument` JSON plus the raw sources — into a
shared **meta-models** storage backend where other project types will later
consume it.

## Context

The pieces this builds on already exist:

- **Project-type infrastructure** — `IProjectFactory` (createProject/openProject/
  saveProject/openFile/saveFile/newFile), the `project.plexus` manifest envelope
  (`type` routes a folder to its factory), a module's `.projectFactories:` block
  contributing a `ProjectFactoryDefinition [Type, Title, Factory]`, and the
  generic `ProjectExplorerService` that reads the manifest and delegates.
  `DiagramProjectFactory` (type `"architecture"`, `.diagram` files) is the
  reference.
- **Code editor** — `CodeDocument` (a Monaco-backed `IDocument` that owns its
  text) rendered by `CodeEditor` (a `DomHost` subclass hosting Monaco), declared
  in `DataTemplate[CodeDocument]`. `CodeEditorService` opens/dedupes file tabs.
- **Storage seam** — `IStorage` (rooted per project, project-relative POSIX
  paths) and `StorageProviderRegistry` (backend id → rooted-`IStorage` factory).
- **TODL** — `@pragmatic-tech-ai/todl@0.1.0` provides `check(sources: SourceFile[])
  → { model, diagnostics }` (spanned diagnostics) and `toJSON(model) →
  TodlDocument` (a `fromJSON`-loadable `{ nodes, edges }` interchange form).

The existing `ontologies` module (formerly `architecture-meta-models`) is
unrelated legacy example content — a left-nav capability panel — and is **not**
touched by this work.

## Global Constraints

- **Dependency floor:** add `@pragmatic-tech-ai/todl@^0.1.0` to Plexus
  `dependencies` and install from Verdaccio.
- **Tests:** every test file lives in a `tests/` subfolder next to its source
  (Plexus convention). Vitest; no Monaco/DOM in tests — test pure functions and
  services with fakes.
- **Enums, not string-literal unions:** new fixed value sets are real TS enums
  with explicit string values (e.g. `EditorSeverity`).
- **Language ids / manifest strings:** the `todl` Monaco language id and the
  `"meta-model"` project type string are the markup-string ↔ code-constant
  contract; define each as a named constant at its owning module.

## Architecture Overview

Five cohesive changes, sequenced so each yields working software:

1. **Generalize the project explorer** (shared) — replace the two remaining
   diagram-specific behaviors (open routing, new-file) with format-driven ones,
   and add a feature-tested Publish command.
2. **`MetaModelProjectFactory`** (meta-model module) — the `"meta-model"`
   project type owning the `.todl` format, plus publishing.
3. **Generic diagnostics channel** (code-editor module) — `CodeDocument` carries
   a `Diagnostics` collection; `CodeEditor` maps it to Monaco markers.
4. **`MetaModelValidationService`** (meta-model module) — debounced whole-project
   `check()`, distributing diagnostics to open `.todl` documents.
5. **Meta-models backend** (meta-model module) — a `'meta-models'`
   `StorageProviderRegistry` backend rooted under userData, the publish target.

```
New Project ─▶ MetaModelProjectFactory.createProject ─▶ project.plexus (+ id, modelVersion)
Open .todl  ─▶ explorer.openNode ─(format kind)─▶ factory.openFile ─▶ CodeDocument(lang=todl) ─▶ host.Open
edit        ─▶ CodeDocument.Content ─(debounce)─▶ MetaModelValidationService.check(all .todl)
                                                    └▶ per-file EditorDiagnostic[] ─▶ CodeDocument.Diagnostics
                                                                                      └▶ CodeEditor ─▶ Monaco markers (squiggles)
Publish     ─▶ explorer.PublishCommand ─(isPublishable)─▶ factory.publish
                 └▶ check(all .todl); errors ⇒ abort; else toJSON + copy sources ─▶ 'meta-models' backend /<id>/<modelVersion>/
```

## Component 1 — Generalize the Project Explorer (shared)

The "generic" `ProjectExplorerService` still hard-codes diagram behavior in two
places. The meta-model type is the second consumer that forces the fix; both
changes benefit every project type.

### 1a. Format-driven open routing

`ProjectNodeKind` (in `services/projects/project.ts`) gains a `'todl'` member:

```ts
export type ProjectNodeKind = 'folder' | 'file' | 'diagram' | 'todl'
```

`ProjectExplorerService.openNode` today opens in-app only when
`node.Kind === 'diagram'`. Replace that with a check against the **active
factory's declared formats** — a node opens in-app when its kind matches any
`format.kind`; `'folder'` is a no-op; everything else routes to the OS
(`isLocalFileAccess`):

```ts
const openable = this.activeFactory?.formats.some(f => f.kind === node.Kind) ?? false
if (openable) {
    const doc = await this.activeFactory!.openFile(this.activeStorage!, node.Path)
    this.host.Open(doc)
} else if (node.Kind === 'file') {
    // …existing OS-open path…
}
```

This is format-driven: future format kinds need no further explorer edits.

### 1b. Format-aware new file

Rename `NewDiagramCommandKey`/`newDiagram()` to `NewFileCommandKey`/`newFile()`.
It creates a file of the **active factory's first declared format** and opens it,
naming it `<kind>-<n>`:

```ts
private async newFile(): Promise<void> {
    // guard: project + activeFactory + activeStorage present, ≥1 format
    const format = this.activeFactory!.formats[0]
    const n = this.Project!.Root.Children.Count + 1
    const path = await this.activeFactory!.newFile(this.activeStorage!, format.kind, `${format.kind}-${n}`)
    const refreshed = await this.activeFactory!.openProject(this.activeStorage!)
    this.setActive(refreshed, this.activeFactory!, this.activeStorage!)
    const doc = await this.activeFactory!.openFile(this.activeStorage!, path)
    this.host.Open(doc)
}
```

Update the binding in `project-explorer.resources.mu`: `$NewDiagramCommand` →
`$NewFileCommand` (label becomes generic, e.g. "New File"). Diagram behavior is
unchanged (its sole format is `.diagram`); meta-model gets "New `.todl`".

### 1c. Feature-tested Publish command

A new optional factory capability — exactly the `isLocalFileAccess` pattern
already in the explorer:

```ts
// services/projects/project-factory.ts
export interface PublishResult { ok: boolean; message: string }

export interface IPublishableProjectFactory {
    publish(project: Project, storage: IStorage, provider: IServiceProvider): Promise<PublishResult>
}

export function isPublishable(f: IProjectFactory): f is IProjectFactory & IPublishableProjectFactory {
    return typeof (f as Partial<IPublishableProjectFactory>).publish === 'function'
}
```

`ProjectExplorerService` gains `PublishCommandKey` (a `RelayCommand` →
`this.publish()`). `publish()` guards on an open project + `isPublishable(activeFactory)`
(status `"This project type can't be published."` otherwise), then delegates and
surfaces `PublishResult.message` as `Status`. The command bar in
`project-explorer.resources.mu` gains a Publish button. The generic host never
learns what "publish" means — it only delegates when the active factory offers it.

## Component 2 — `MetaModelProjectFactory` (meta-model module)

New module folder `modules/meta-model/`. The factory implements both
`IProjectFactory` and `IPublishableProjectFactory`.

```ts
export class MetaModelProjectFactory extends ServiceBase
    implements IProjectFactory, IPublishableProjectFactory
{
    public static readonly Key = new ServiceKey<MetaModelProjectFactory>('MetaModelProjectFactory')
    public static readonly ProjectType = 'meta-model'

    public readonly formats: readonly ProjectFileFormat[] = [
        { extension: '.todl', kind: 'todl', displayName: 'TODL Definition' },
    ]
}
```

**Manifest.** Extends the envelope with a publish identity:

```ts
interface MetaModelManifest extends ProjectManifestEnvelope {
    // type = 'meta-model', name, version = 1 (manifest schema version)
    id:           string   // stable slug, defaults to slugify(name) at create
    modelVersion: string   // published version, defaults to '0.1.0'
}
```

- `createProject(storage, name)` — write a manifest with
  `{ type: 'meta-model', name, version: 1, id: slugify(name), modelVersion: '0.1.0' }`,
  then build the project tree.
- `openProject(storage)` — read the manifest, scan storage into a `ProjectNode`
  tree; `.todl` files are tagged kind `'todl'` (openable); the manifest file is
  hidden. Register the project's storage with `MetaModelValidationService`
  (`SetProject(storage)`) so validation can read closed files.
- `newFile(storage, _format, name)` — write an empty `.todl` at the root, return
  its project-relative path.
- `openFile(storage, path)` — read text, construct a `CodeDocument` (its language
  resolves to `'todl'` from the extension), and return it. Opening a document is
  what the validation service tracks (it observes the content host's open-set).
- `saveFile(document)` — `(document as CodeDocument).Save()`.
- `saveProject` — rewrite the manifest (preserving `id`/`modelVersion`).

**Publishing.**

```ts
public async publish(project, storage, provider): Promise<PublishResult> {
    const manifest = /* read project.plexus */
    const sources = await collectTodlSources(storage)      // SourceFile[] { uri: relPath, text }
    const { model, diagnostics } = check(sources)
    const errors = diagnostics.filter(d => d.severity === Severity.Error)
    if (errors.length > 0)
        return { ok: false, message: `Publish blocked: ${errors.length} error(s). Fix them first.` }

    const dest = ensureMetaModelsBackend(provider)          // lazy-register + Create('meta-models', …)
    const base = `${manifest.id}/${manifest.modelVersion}`
    await dest.WriteText(`${base}/model.json`, JSON.stringify(toJSON(model), null, 2))
    for (const s of sources) await dest.WriteText(`${base}/src/${s.uri}`, s.text)
    return { ok: true, message: `Published ${manifest.id}@${manifest.modelVersion}.` }
}
```

`collectTodlSources(storage)` recursively walks storage (`List` per directory),
returning a `SourceFile[]` (`uri` = project-relative POSIX path) for every
`.todl` file. `ensureMetaModelsBackend` is Component 5.

## Component 3 — Generic Diagnostics Channel (code-editor module)

A reusable editor capability — diagnostics are a generic editor concept, not
TODL-specific.

```ts
// modules/code-editor/editor-diagnostic.ts
export enum EditorSeverity { Error = 'error', Warning = 'warning', Info = 'info', Hint = 'hint' }

export interface EditorDiagnostic {
    severity:    EditorSeverity
    message:     string
    startLine:   number   // 1-based
    startColumn: number   // 1-based
    endLine:     number   // 1-based
    endColumn:   number   // 1-based, exclusive (points past the last char)
}
```

`CodeDocument` gains a `Diagnostics` DP:

```ts
public static readonly DiagnosticsKey = Model.RegisterProperty<ObservableCollection<EditorDiagnostic>>(
    CodeDocument, 'Diagnostics', undefined as unknown as ObservableCollection<EditorDiagnostic>, MetaData.None)
```

Seeded with an empty collection in the constructor; getter exposed. Nothing in
the generic code path fills it — a validation producer (Component 4) does.

`CodeEditor` binds `$Diagnostics` alongside `$Content`/`$Language` in its
constructor, and applies markers to **its own** Monaco model — the service never
reaches into the view:

```ts
// pure mapping, unit-tested
export function toMarkers(diags: readonly EditorDiagnostic[]): monaco.editor.IMarkerData[] {
    return diags.map(d => ({
        severity:        MONACO_SEVERITY[d.severity],   // Error→8, Warning→4, Info→2, Hint→1
        message:         d.message,
        startLineNumber: d.startLine, startColumn: d.startColumn,
        endLineNumber:   d.endLine,   endColumn:   d.endColumn,
    }))
}
```

On a `Diagnostics` change (property set or collection change) and once the editor
exists, `CodeEditor` calls
`monaco.editor.setModelMarkers(this.editor.getModel(), 'todl', toMarkers(this.Diagnostics.ToArray()))`.
An empty collection clears the markers.

**Language registration.** A minimal `'todl'` Monaco language (id + a small
Monarch tokenizer for comments/strings/keywords) is registered once from the
meta-model module's load, so `.todl` documents get an id (richer highlighting can
grow later). `code-document.ts`'s `LANGUAGE_BY_EXT` gains `todl: 'todl'`.

## Component 4 — `MetaModelValidationService` (meta-model module)

Owns whole-project validation and diagnostic distribution.

```ts
export class MetaModelValidationService extends ServiceBase {
    public static readonly Key = new ServiceKey<MetaModelValidationService>('MetaModelValidationService')
    public SetProject(storage: IStorage): void   // called by the factory on open/create
}
```

- **Tracking.** Subscribes to `ContentHostService` open-set changes. When a
  `CodeDocument` with a `.todl` id opens, hook its `Content` `PropertyChanged` to
  schedule a debounced revalidation (~250 ms); unhook on close.
- **Validation pass.** Build `SourceFile[]` from the **live `Content` of open
  `.todl` docs** overlaid on **storage text of the remaining `.todl` files**
  (`uri` = project-relative path). Run `check(sources)`.
- **Distribution.** Group diagnostics by `span.uri` (null span ⇒ position 1:1).
  Map each `Diagnostic` → `EditorDiagnostic` (`spanToRange`: 1-based, end
  exclusive — a direct copy, since TODL spans already match Monaco's convention;
  `Severity` → `EditorSeverity`). For every **open** `.todl` doc, replace its
  `Diagnostics` collection with its slice (empty ⇒ cleared). Diagnostics for
  **closed** files are dropped in v1 (that is the deferred Problems panel's job).

The service never imports Monaco or touches a `CodeEditor` — it writes data onto
documents; the view reacts.

## Component 5 — Meta-models Backend (meta-model module)

Register a `'meta-models'` backend in the existing `StorageProviderRegistry`,
rooted at `<EnvironmentService.UserDataDirectory>/meta-models`:

```ts
export const META_MODELS_BACKEND_ID = 'meta-models'

export function ensureMetaModelsBackend(provider: IServiceProvider): IStorage {
    const registry = provider.getRequired(StorageProviderRegistry.Key)
    if (!registry.Has(META_MODELS_BACKEND_ID)) {
        const env = provider.getRequired(EnvironmentService.Key)
        const fs  = provider.getRequired(FileSystemService.Key)
        const root = `${env.UserDataDirectory}${env.PathSeparator}meta-models`
        registry.Register(META_MODELS_BACKEND_ID, () => new LocalFileStorage(root, fs))
    }
    return registry.Create(META_MODELS_BACKEND_ID, '')   // factory ignores location; roots at userData/meta-models
}
```

Lazy registration on first publish (idempotent via `Has`) avoids a startup
ordering service. It is a normal rooted `IStorage`, so a cloud/REST backend can
replace it later — per the chosen "StorageProviderRegistry backend" approach.

## Module Wiring

`modules/meta-model/meta-model.module.mu`:

```
import MetaModelProjectFactory from "./services/meta-model-project-factory.js"
import MetaModelValidationService from "./services/meta-model-validation-service.js"

module MetaModelModule [ Name = "Meta-model" ] {
    .services: {
        MetaModelProjectFactory
        MetaModelValidationService
    }
    .projectFactories: {
        ProjectFactoryDefinition
            [ Type        = "meta-model",
              Title       = "Meta-model Project",
              Description = "Author and validate TODL meta-model definitions.",
              Factory     = MetaModelProjectFactory ]
    }
}
```

Add the module to `app.mu`'s imports and `.modules:` block, and its two `.mu`
files to `package.json`'s `compile:mu` list. The module contributes only
services + a project factory (no nav Capability): the project type is reached
through **New Project**, not a rail entry. If the `ShellModule` schema mandates
at least one `Capability`, add a minimal "Meta-models" published-browser
capability as a fallback (otherwise out of scope).

## Error Handling

- **Publish with errors** — abort, write nothing, return a failing
  `PublishResult` naming the error count. (Warnings do not block.)
- **Unregistered/failed backend** — `ensureMetaModelsBackend` surfaces the
  registry's error message as `Status` (mirrors the explorer's existing handling).
- **Malformed `.todl`** — parser recovery (already in TODL 0.1.0) yields
  diagnostics, never throws; validation renders squiggles and publish is blocked.
- **File read races during a validation pass** — a `.todl` that vanishes mid-scan
  is skipped (treated as absent); the next debounced pass reconciles.

## Testing Strategy

Vitest, fakes over a `FakeStorage` implementing `IStorage`; no Monaco/DOM.

- **Explorer generalization** — `openNode` routes a format-kind node to
  `openFile` and a plain `file` to OS; `newFile` creates the active factory's
  first format; `Publish` delegates only when the factory `isPublishable`, and
  surfaces the message.
- **`MetaModelProjectFactory`** — `createProject` writes a manifest carrying
  `id`/`modelVersion`; `openProject` tags `.todl` nodes `'todl'` and hides the
  manifest; `newFile` creates a `.todl`; `openFile` returns a `CodeDocument`
  whose language is `'todl'`.
- **Publish** — a clean multi-file project writes `model.json` that `fromJSON`
  round-trips plus every source under `src/`; a project with an error writes
  nothing and reports the count.
- **`MetaModelValidationService`** — a concept defined in file A and referenced
  in file B produces **no** diagnostic (whole-project resolution); a syntax error
  in A localizes to A's document only; a clean edit clears prior diagnostics.
- **Diagnostics channel** — the pure `spanToRange`/`toMarkers`/severity mappings;
  `CodeDocument.Diagnostics` defaults to an empty collection.

## Out of Scope

- **Problems panel** — squiggles only in v1; closed-file diagnostics are dropped.
- **Consuming published meta-models** — an architecture project reading a
  published meta-model is a later sub-project.
- **Version management** — republishing the same `id`/`modelVersion` overwrites;
  no immutability guard, bump UI, or dependency resolution yet.
- **Rich `.todl` syntax highlighting** — only a minimal Monaco language id.
- **The legacy `ontologies` module** — untouched.

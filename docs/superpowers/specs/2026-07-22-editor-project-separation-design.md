# Editor / Project Separation

**Date:** 2026-07-22
**Status:** ✅ Finished
**Repo:** Plexus (renderer)
**Arc:** Sub-project 1 of 4 (architecture-model loading). Frees the `architecture`
project-type name and establishes the editor/project model the later
sub-projects build on.

## Principle

**Editors own files, not projects.** A file editor (diagram → `.diagram`, code →
`.todl`) owns opening/saving/creating its file formats. A project factory owns
only project lifecycle (create/open/save + optional publish) and declares which
document formats can be added to it. Any project can contain any file whose
extension a registered editor handles; the editor opens it, regardless of
project type.

Today `IProjectFactory` bundles both concerns: the diagram module's
`DiagramProjectFactory` (type `architecture`) owns `.diagram` file I/O *and*
project lifecycle; `MetaModelProjectFactory` owns `.todl` file I/O *and* its
lifecycle. This spec splits file I/O out to per-format editors.

## Framework mechanism (already present)

Mural already exposes the contribution point — **no mural change needed**:

- `.documents:` blocks contribute `DocumentDefinition`s (`Type`, `Title`,
  `Description`, `FileExtensions[]`, **`Factory` service token**,
  `CommandContexts[]`), aggregated by `DocumentTypeRegistry`
  (`GetByType`, `GetByExtension`).
- The diagram module already declares a `DocumentDefinition`
  (`Type="diagram"`, `FileExtensions=[".diagram"]`) — but with **no `Factory`**
  yet (comment: "future file-open").
- `DocumentTypeRegistry.PopulateFromModules()` exists but is **not called** in
  Plexus today — wiring that call is part of this work.

`DocumentDefinition.Factory` is a `ServiceToken`, resolved exactly as project
factories are today: `provider.get(ServiceProvider.tokenFor(def.Factory))`.

## Design

### New Plexus interface: `IDocumentFactory`

The file-I/O half of today's `IProjectFactory`, resolved from a
`DocumentDefinition.Factory` token. Lives at
`src/renderer/src/services/documents/document-factory.ts`.

```ts
export interface IDocumentFactory {
  openFile(storage: IStorage, path: string): Promise<IDocument>
  saveFile(document: IDocument): Promise<void>
  newFile(storage: IStorage, name: string): Promise<string>   // returns project-relative path
}

// Optional: re-point an open document after a rename (was IRelocatableFileFactory).
export interface IRelocatableDocumentFactory {
  relocateOpenFile(document: IDocument, newPath: string): void
}
export function isRelocatable(f: IDocumentFactory): f is IDocumentFactory & IRelocatableDocumentFactory
```

`newFile` drops the `format` argument — the editor already knows its extension
(one factory per document type). The project supplies the base `name`.

### `IProjectFactory` slims

Remove `openFile` / `saveFile` / `newFile` / `relocateOpenFile` and the
`IRelocatableFileFactory` guard. Keep `createProject` / `openProject` /
`saveProject`, optional `publish`, and **`formats`** — now interpreted as *the
document formats addable to this project* (each `ProjectFileFormat.extension`
must match a registered `DocumentDefinition.FileExtensions` entry; `kind` stays
the tree-node kind).

### Diagram module

- New `DiagramDocumentFactory` (`IDocumentFactory` + `IRelocatableDocumentFactory`)
  holding the `.diagram` I/O currently in `DiagramProjectFactory`
  (`FileDiagramStorage` + `DiagramDocument` load/save; relocate re-targets the
  storage path).
- Set it as the `.documents:` `DocumentDefinition.Factory`.
- **Delete `DiagramProjectFactory`** and its `.projectFactories:` entry — the
  diagram module is only an *editor* now.

### Architecture-repository module

- New `ArchitectureProjectFactory` (`IProjectFactory`, type `architecture`,
  `formats=[.diagram]`) holding the project *lifecycle* currently in
  `DiagramProjectFactory` (`createProject`/`openProject`/`saveProject` +
  the storage-scanning tree build). No file I/O — that's the diagram editor's.
- Register it on the architecture-repository module via `.services:` +
  `.projectFactories:`. Modules own project types; editors own files.

### Meta-model module

- New `.documents:` `DocumentDefinition` (`Type="todl"`, `Title="TODL"`,
  `FileExtensions=[".todl"]`, `Factory=TodlDocumentFactory`).
- New `TodlDocumentFactory` (`IDocumentFactory`) holding the `.todl` → Monaco
  `CodeDocument` I/O currently in `MetaModelProjectFactory.openFile/saveFile/newFile`.
- `MetaModelProjectFactory` keeps `createProject`/`openProject`/`saveProject`/
  `publish`/`formats`; loses file I/O. Its `formats` now declares `.todl` as
  addable.

### ProjectExplorerService refactor

Route file operations through `DocumentTypeRegistry` by extension instead of the
project factory:

- **openFile**: `GetByExtension(ext)` → resolve `.Factory` (`IDocumentFactory`)
  → `openFile(storage, path)`. Unknown extension → not openable.
- **saveFile**: resolve the open document's factory by its extension → `saveFile`.
- **newFile**: from the project's `formats` (curated) → the document factory for
  that extension → `newFile(storage, name)`.
- **openable / node kind**: `GetByExtension(ext)` exists → openable; the node
  kind comes from the matching `ProjectFileFormat.kind` (or the definition), else
  `'file'`.
- **relocate**: `isRelocatable(factory)` → `relocateOpenFile`.
- Call `DocumentTypeRegistry.PopulateFromModules()` during explorer/app startup
  (once) so `GetByExtension` is populated.

## Consequences

- The `architecture` project type moves off the diagram module onto the
  architecture-repository module (`ArchitectureProjectFactory`). Existing
  `type: "architecture"` manifests keep opening — sub-project 4 layers a
  meta-model/library resolver onto this factory rather than reclaiming the name.
- `.diagram` files now open by extension inside *any* project (the editor opens
  them), not only architecture projects — the intended decoupling.

## Testing

- `DiagramDocumentFactory`: open/save/new/relocate a `.diagram` round-trips
  through a fake `IStorage` (port the existing diagram-factory assertions).
- `TodlDocumentFactory`: open/save/new a `.todl` yields a `CodeDocument` with the
  file text; save writes it back.
- `ProjectExplorerService`: openFile routes by extension to the registered
  document factory (fake `DocumentTypeRegistry` with a stub factory); an unknown
  extension is not openable; newFile from a project format delegates to the right
  factory. Update the existing explorer tests for the registry-based routing.
- Regression: the meta-model publish + validation paths are untouched (file I/O
  moved, not the project lifecycle).

## Out of scope

- Sub-projects 2–4 (library backend/type, TODL `checkAgainst`, architecture
  resolver). This spec only separates editors from projects.

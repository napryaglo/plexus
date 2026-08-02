# "Add New →" Submenu Driven by Project Formats — Design

**Date:** 2026-08-02
**Status:** Approved (brainstorm)
**Area:** Plexus project explorer + architecture-repository module

## Problem

An architecture project cannot create a new architecture **diagram** (`.archdiagram`)
from the UI. The creation primitive already exists —
`ArchDiagramDocumentFactory.newFile()` scaffolds a `.archdiagram` plus its sibling
`.todl`, and the factory is registered for the `.archdiagram` extension via the
module's `.documents:` block. The gap is purely the trigger: the generic "New File"
command always creates `op.Factory.formats[0]`
(`ProjectExplorerService.newFileIn`), and the architecture factory declares only
`.todl`. So "New File" in an architecture project always produces a raw `.todl`, and
there is no path to a diagram.

Today every project type (architecture, library, meta-model, and the diagram
project) declares exactly **one** format. The fixed single "New File" menu item was
adequate; it no longer is.

## Goal

Replace the fixed "New File" context-menu item (on both the project header menu and
the per-node menu) with an **"Add New →"** submenu that lists the project type's
declared file formats, one entry per format. Add `.archdiagram` as the architecture
project's **primary** format so an architecture project offers **Architecture
Diagram** and **TODL Definition**.

This is a general mechanism, not an architecture-only special case: any project type
with N formats gets an N-entry submenu with no per-type code.

## Non-Goals

- Changing how `.archdiagram` documents are created, opened, or saved (that machinery
  is complete).
- Seeding a diagram automatically when a new architecture project is created.
- Reworking the New **Project** dialog (this is about files within an open project).
- Fixing the separate "drop doesn't create a shape" bug (tracked independently; a
  temporary debug log currently sits in `arch-diagram-document.ts` and is unrelated).

## Approach

Generalize the existing single-format path rather than special-case architecture.

### 1. `NewItemChoice` view-model

A tiny VM bound by the submenu's item template:

```
class NewItemChoice extends Model {
  Label:   string      // the format's displayName, e.g. "Architecture Diagram"
  Command: ICommand    // creates that format in this container, then opens it
}
```

One instance per available format, per menu host (project or node).

### 2. Architecture factory declares two formats

`architecture-project-factory.ts`:

```
public readonly formats: readonly ProjectFileFormat[] = [
  { extension: '.archdiagram', kind: 'diagram', displayName: 'Architecture Diagram' },
  { extension: '.todl',        kind: 'todl',    displayName: 'TODL Definition' },
]
```

`.archdiagram` is listed first, making it the primary format (used by any
`formats[0]` caller). `kind: 'diagram'` drives the default new-file name
(`diagram.archdiagram`) and the `ProjectNode` kind. The `populate()` scan is updated
so a `.archdiagram` file is marked node kind `'diagram'` (matching the format's
`kind`), giving it the diagram icon instead of the generic file icon; `.todl` stays
`'todl'`, everything else `'file'`.

### 3. `newFileIn` becomes format-parameterized

`ProjectExplorerService.newFileIn(op, parentFolder, format)` takes the specific
`ProjectFileFormat` to create instead of reading `op.Factory.formats[0]`. It resolves
the document factory by `format.extension` and builds the default name from
`format.kind` + `format.extension` exactly as today. The default new-file behavior
(primary format) is preserved because callers pass `op.Factory.formats[0]` when they
want the primary.

### 4. Building the choices

- `wireProjectCommands(op)` sets `op.NewItemChoices` to one `NewItemChoice` per
  `op.Factory.formats`, each command a `RelayCommand(() => newFileIn(op, '', format))`
  with `Label = format.displayName`.
- `wireNodes(node, op)` sets `node.NewItemChoices` the same way, but each command
  closes over the node's container path (`node.Kind === 'folder' ? node.Path :
  parentOf(node.Path)`), mirroring how the existing per-node `NewFileCommand` is
  wired. Recurse to children as today.

The existing single `NewFileCommand` property (on both `OpenProject` and
`ProjectNode`) is removed; the menus bind `NewItemChoices` instead. No other consumer
references `NewFileCommand`.

### 5. Data-carrier changes

- `OpenProject`: add a `NewItemChoices: ObservableCollection<NewItemChoice>` dependency
  property (with getter/setter, following the existing command-property pattern);
  remove `NewFileCommand`.
- `ProjectNode`: add the same `NewItemChoices` collection; remove its `NewFileCommand`.

### 6. Menu markup

In `project-explorer.resources.mu`, both `@ProjectContextMenu` and `@NodeContextMenu`
replace their "New File" `MenuItem` with:

```
MenuItem [ Header = "Add New", Icon = <NoteAdd glyph> ]
    [ ItemsControl.ItemsSource  = $NewItemChoices,
      ItemsControl.ItemTemplate = @NewItemChoiceTemplate ]
```

with a shared item template:

```
DataTemplate x:key="NewItemChoiceTemplate" [ DataType = NewItemChoice ] {
    MenuItem [ Header = $Label, Command = $Command ]
}
```

`MenuItem` is a `HeaderedItemsControl`/`ItemsControl`; when it has items it shows the
`▶` chevron and opens a submenu (`menu-strip.js`), and it supports
`ItemsSource`/`ItemTemplate` — the same dynamic-items pattern the toolbox
`TabControl` already uses. "Add New" always renders as a submenu, including the
single-format case (one child), for one uniform code path.

## Data Flow

Right-click a project header or a tree node → the row's DataContext (`OpenProject` /
`ProjectNode`) supplies `NewItemChoices` → the "Add New" submenu lists one row per
format → clicking a row runs its command → `newFileIn` creates the file through the
document factory resolved by that format's extension → the project rescans → the new
file opens in a tab (existing `newFileIn` behavior).

## Testing

Unit tests (Vitest, in `tests/` subfolders beside the source):

- **`newFileIn` format selection** — given a factory with two formats, creating the
  second format writes a file with the second extension and opens it through the
  matching document factory (not `formats[0]`). Covered via the service's logic with
  a fake factory/storage, mirroring existing explorer tests.
- **Choice construction** — `wireProjectCommands` / `wireNodes` produce one
  `NewItemChoice` per declared format, labels equal to each `displayName`, in
  declaration order (diagram before todl for architecture).
- **Architecture factory formats** — asserts the two formats and their order/values.
- **`populate` node kind** — a `.archdiagram` entry is scanned as node kind
  `'diagram'`; `.todl` stays `'todl'`.

Live verification (the one implementation risk): confirm the dynamic `MenuItem`
submenu (`ItemsSource` + a `MenuItem` item template) renders a working, clickable menu
row before building the rest. This is a supported-but-not-yet-used-here pattern; if
mural wraps the generated container in a way that breaks menu-row behavior, fall back
to an alternative submenu construction (e.g. a container-generating item style).
Verify this first, in isolation.

## Risks / Open Questions

- **Dynamic menu rendering** (above) — the single load-bearing uncertainty; verified
  first.
- **`ProjectNodeKind` value `'diagram'`** — confirm the kind is a recognized
  `ProjectNode` kind with an icon mapping (`project-node-icon.ts`); if not, either add
  the icon mapping or fall back to marking `.archdiagram` as `'file'`. Cosmetic, does
  not block creation.

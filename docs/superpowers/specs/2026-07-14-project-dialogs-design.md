# New / Open Project Dialogs & Commands — Design

**Date:** 2026-07-14
**Status:** Approved (design), implementing
**Repos touched:** `Plexus` only (no Mural change, no republish)

## Goal

Replace the Project Explorer's straight-to-OS-picker New/Open buttons with two
proper in-app dialogs, driven by the same explorer command-bar RelayCommands:

- **New Project** — a full control: a selectable project-type list (always
  shown, even with one registered factory), a Name, and a Location (Browse).
- **Open Project** — a recent-projects list (click to open) plus Browse, backed
  by a persisted MRU list.

## Decisions (settled during brainstorming)

- **Command surface:** the commands stay `RelayCommand`s on
  `ProjectExplorerService` (the explorer's Open/New buttons). The shell toolbar
  is document-scoped, so a global command surface would need Mural work — out of
  scope. Only the command *bodies* change: show a dialog, act on the result.
- **New Project folder model:** use the chosen (empty) folder as the project
  root; Name is the manifest name, not a created subfolder.
- **Type picker is a full control, no shortcuts:** always render a real
  selectable list from the registry, even with a single factory. No hiding.
- **Open Project:** in-app dialog with a persisted recents list + Browse.
- **Recents persistence:** a plain JSON file at
  `<UserDataDirectory>/recent-projects.json` via the existing `FileSystemService`
  + `EnvironmentService` — NOT the settings store (its `persist()` rewrites the
  whole record and would clobber a shared key), and no new IPC bridge.

## Dialog mechanism (existing, no new framework work)

Mural's `DialogService` is auto-registered and hosted by `EditorShell`
(`SetHost(this)` in its ctor). `Show({ Title, Content, Width, MaxHeight? })`
returns `Promise<result | undefined>`; `Content` is a **Model** rendered by a
`DataTemplate[DataType=VM]`; `Close(result)` resolves the promise. Dialogs are
therefore a VM + a template, the mural-idiomatic way (the Settings page already
uses this).

Each dialog VM is constructed with a `close: (result) => void` callback the
explorer wires to `DialogService.Close`, plus whatever collaborators its
commands need (`FileSystemService` for Browse, an async `validate` for New
Project). This keeps VMs decoupled from `DialogService` and unit-testable.

## Components

### `RecentProjectsService` (`services/projects/recent-projects-service.ts`)

Persists an MRU list to `<UserDataDirectory>/recent-projects.json`.

```ts
export interface RecentProject { name: string; path: string; type: string; openedAt: number }

export class RecentProjectsService extends ServiceBase {
    static readonly Key: ServiceKey<RecentProjectsService>
    static readonly MaxEntries = 10
    List(): Promise<readonly RecentProject[]>       // [] if the file is missing/unparseable
    Add(entry: RecentProject): Promise<void>        // dedupe by path, unshift, cap MaxEntries
    Remove(path: string): Promise<void>
}
```

Reads/writes via `FileSystemService.ReadText/WriteText/Exists`; the file path is
`join(EnvironmentService.UserDataDirectory, 'recent-projects.json')`. Registered
as a root service in `app.mu`.

### New Project VM (`services/projects/new-project-dialog-model.ts`)

```ts
export class ProjectTypeChoice extends Model {   // one per registered factory
    // Type, Title, Description (from ProjectFactoryDefinition)
    // Marker: '●' | '○'  (selection glyph, toggled by the VM — themable, no triggers)
    // SelectCommand: ICommand
}

export interface NewProjectResult { type: string; name: string; location: string }

export class NewProjectDialogModel extends Model {
    // Types: ObservableCollection<ProjectTypeChoice>   (always populated)
    // SelectedType: ProjectTypeChoice | undefined      (defaults to Types[0])
    // Name: string   Location: string   Error: string
    // CanConfirm: boolean  (SelectedType && Name.trim() && Location)
    // BrowseCommand   → FileSystemService.OpenFolder → set Location
    // ConfirmCommand  → if CanConfirm: err = await validate(result); err ? set Error : close(result)
    // CancelCommand   → close(undefined)
    constructor(choices, fs, validate, close)
}
```

Selection is VM-driven (no `ListBox` in mural): `SelectCommand` sets
`SelectedType`, flips the chosen choice's `Marker` to `'●'` and the rest to
`'○'`. `validate` is injected so the "folder already contains a project" check
(`storage.Exists(PROJECT_MANIFEST_FILENAME)`) stays in the service yet surfaces
in-dialog.

### Open Project VM (`services/projects/open-project-dialog-model.ts`)

```ts
export class RecentProjectItem extends Model {   // Name, Path, OpenCommand: ICommand }

export interface OpenProjectResult { location: string }

export class OpenProjectDialogModel extends Model {
    // Recents: ObservableCollection<RecentProjectItem>
    // EmptyLabel: string   ('' when there are recents, else 'No recent projects.')
    // BrowseCommand → FileSystemService.OpenFolder → close({location}) if picked
    // CancelCommand → close(undefined)
    constructor(recents, fs, close)   // each item's OpenCommand → close({location: item.Path})
}
```

### `ProjectExplorerService` rewire

- Inject `DialogService`, `RecentProjectsService`, `ProjectFactoryRegistry`.
- `newProject()`: build choices from `registry.Definitions`; `vm = new
  NewProjectDialogModel(choices, fs, validate, close)`; `await
  dialogService.Show({ Title: 'New Project', Content: vm, Width: 520 })`; on a
  result, resolve the type's factory, build a `local` storage rooted at
  `location`, `factory.createProject(storage, name)`, `setActive`, and
  `recents.Add`. `validate` checks `storage.Exists(manifest)`.
- `openProject()`: `recents = await recentProjects.List()`; `vm = new
  OpenProjectDialogModel(recents, fs, close)`; `Show`; on a result, run the
  existing open flow (bootstrap storage → envelope → factory → storage →
  setActive) via an extracted `openProjectAt(folder)`; then `recents.Add`. A
  recent that fails to open reports status (and is a candidate for `Remove`).
- The existing open/create bodies are extracted into `openProjectAt(folder)` /
  `createProjectAt(type, name, folder)` so both the dialog results and future
  callers share one path.

### Markup (`modules/project-explorer/project-explorer.resources.mu`)

- `DataTemplate[ProjectTypeChoice]`: a `Button [Variant=Text, Command=$SelectCommand]`
  row — a leading marker `TextBlock [Text=$Marker, Foreground=@Primary]` + a
  column of `Title` (@BodyLarge) and `Description` (@BodySmall,
  @OnSurfaceVariant, wrap).
- `DataTemplate[NewProjectDialogModel]`: "Project type" label → bordered
  `ItemsControl [ItemsSource=$Types, ItemsPanel=@VerticalStackPanel]`; Name
  `TextBox [Text=$Name]`; Location row (`FilePathSettingRow` idiom: `TextBox
  [Text=$Location]` + `Button [Variant=Outlined, Command=$BrowseCommand]`); an
  Error `TextBlock [Text=$Error]`; footer `Cancel` + `Create [IsEnabled=$CanConfirm]`.
- `DataTemplate[RecentProjectItem]`: `Button [Variant=Text, Command=$OpenCommand]`
  with `Name` + `Path`.
- `DataTemplate[OpenProjectDialogModel]`: "Recent" label; `ItemsControl
  [ItemsSource=$Recents]`; an `EmptyLabel` `TextBlock`; footer `Browse…` +
  `Cancel`.

## Error handling

- New Project: `CanConfirm` gates Create; `validate` blocks + shows Error when
  the target folder already holds a `project.plexus.json`.
- Open Project: an unreadable manifest / unknown backend reports on the
  explorer `Status` line (existing behavior), now reachable from a recent too.
- `RecentProjectsService.List` tolerates a missing/corrupt file → `[]`.

## Testing

- `NewProjectDialogModel`: default selection is `Types[0]`; `SelectCommand`
  moves the marker and `SelectedType`; `CanConfirm` reflects Name+Location;
  Browse sets Location (stub fs); Confirm with a failing `validate` sets Error
  and does NOT close; Confirm success closes with `{type,name,location}`.
- `OpenProjectDialogModel`: `EmptyLabel` reflects recents count; an item's
  `OpenCommand` closes with its path; Browse closes with the picked folder;
  Cancel closes with undefined.
- `RecentProjectsService` over a stub fs / `FakeStorage`-style map: `Add`
  dedupes by path and caps at `MaxEntries` MRU-ordered; `Remove` drops one;
  `List` returns `[]` for a missing file.

## Files

```
Create:
  services/projects/recent-projects-service.ts
  services/projects/new-project-dialog-model.ts
  services/projects/open-project-dialog-model.ts
  services/projects/tests/new-project-dialog-model.test.ts
  services/projects/tests/open-project-dialog-model.test.ts
  services/projects/tests/recent-projects-service.test.ts
Modify:
  modules/project-explorer/services/project-explorer-service.ts   (rewire open/new)
  modules/project-explorer/project-explorer.resources.mu          (4 new templates)
  app.mu                                                          (register RecentProjectsService)
```

## Deferred

- Global shell command surface (File menu / palette) for New/Open — needs Mural
  framework work.
- New Project creating a named subfolder (chosen: use the folder as-is).
- Auto-pruning recents whose folders vanished (Remove exists; not wired to a
  sweep).
- Recent-project icons / project-type icons in the pickers.

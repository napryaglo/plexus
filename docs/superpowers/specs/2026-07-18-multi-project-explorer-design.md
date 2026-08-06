# Multiple Open Projects — Design Spec

**Date:** 2026-07-18
**Status:** ✅ Finished

## Goal

Let the Project Explorer hold **several open projects at once**, each rendered as
a collapsible root in the tree. Project-specific actions (New File, Publish,
Close) move to a **right-click context menu on the project row**; the command bar
keeps only uniform actions (Open Project, New Project, Save). The set of open
projects is **persisted and restored on next launch**.

## Context

Today `ProjectExplorerService` is single-project: a `Project` DP, one
`activeFactory`/`activeStorage`, and a `Roots` collection holding one root node.
Open/New **replace** the active project via `setActive()`. The consumers of this
surface are contained — the explorer's own `project-explorer.resources.mu`, its
tests, and `app.mu` (service registration only). Building blocks already present:

- **Project model** — `Project` / `ProjectNode` (`Name`/`Path`/`Kind`/`Children`/
  `OpenCommand`); the recursive `DataTemplate[ProjectNode]` renders a node's row +
  its children.
- **Factories** — `IProjectFactory` (+ `IPublishableProjectFactory`/`isPublishable`);
  `ProjectFactoryRegistry` maps a manifest `type` → factory.
- **Persistence pattern** — `RecentProjectsService` persists a JSON list to
  `<userData>/recent-projects.json` via `FileSystemService`.
- **Context menu** — `ContextMenu` (an `ItemsControl` of `MenuItem`/`MenuSeparator`)
  attached to a Visual via `ContextMenuService.ContextMenu = @Key`; its items'
  `Command` bindings resolve against the attached row's DataContext (see
  `@DiagramContextMenu` in `diagram.resources.mu`).
- **Meta-model validation** — `MetaModelValidationService` currently binds ONE
  project storage via `SetProject(storage)`.

## Global Constraints

- Every test file lives in a `tests/` subfolder next to its source. Vitest; no
  Monaco/DOM in tests — services against `FakeStorage`, a real
  `DocumentsContentHostService`, and a `ServiceProvider` with `registerInstance`.
- Real TS enums for any new fixed value set.
- Persistence uses `FileSystemService` + a JSON file under `<userData>` (mirrors
  `RecentProjectsService`); it is NOT put through the settings store.

## Architecture Overview

Six changes:

1. **`OpenProject` VM** — one open project (name, tree, its factory+storage, and
   its per-project commands).
2. **`ProjectExplorerService` refactor** — an `OpenProjects` collection replacing
   the single-project state; add/dedupe/close; per-project + doc-routed actions.
3. **`OpenProjectsStore` + restore-on-launch** — persist the open set, reopen it
   at startup.
4. **Multi-project meta-model validation** — validate per document's project.
5. **Markup** — `DataTemplate[OpenProject]` + a shared project context menu;
   command-bar trimmed to uniform actions.
6. **Bootstrap** — call `RestoreSession()` at startup.

```
Open/New Project ─▶ explorer builds an OpenProject {project, factory, storage}
                     ├─ add to OpenProjects (dedupe by folder path)
                     └─ persist folder in OpenProjectsStore
tree row (OpenProject) ─ right-click ▶ context menu: New File | Publish | Close
file node (ProjectNode) ─ click ▶ OpenCommand → owning OpenProject.factory.openFile → host.Open
command bar ─ Open Project | New Project | Save(active doc → its OpenProject.factory.saveFile)
launch ─▶ RestoreSession() reads OpenProjectsStore → reopen each (skip missing)
```

## Component 1 — `OpenProject` VM

`src/renderer/src/services/projects/open-project.ts`. A `Model` bundling one open
project so the tree can render it and its context menu can bind its commands.

```ts
export class OpenProject extends Model {
    static readonly NameKey            // string  — project display name
    static readonly RootKey            // ProjectNode — the project's file tree root
    static readonly NewFileCommandKey  // ICommand
    static readonly PublishCommandKey  // ICommand
    static readonly CloseCommandKey    // ICommand

    constructor(project: Project, factory: IProjectFactory, storage: IStorage)
    // getters: Name, Root, NewFileCommand, PublishCommand, CloseCommand
    get Project(): Project
    get Factory(): IProjectFactory
    get Storage(): IStorage
    get Folder(): string   // project.RootPath — the dedupe/persistence key
}
```

The VM stores `project`/`factory`/`storage` and exposes them (read-only) for the
explorer. Command DPs start undefined; the explorer sets each to a `RelayCommand`
closing over this `OpenProject` (Component 2). `Name` = `project.Name`, `Root` =
`project.Root`.

## Component 2 — `ProjectExplorerService` Refactor

Replace single-project state with a collection.

- **State.** Remove `ProjectKey`, `RootsKey`, `activeFactory`, `activeStorage`.
  Add `OpenProjectsKey` (`ObservableCollection<OpenProject>`). Keep a private
  `docOwners = new Map<IDocument, OpenProject>()` for save-routing and
  close-cleanup.
- **Commands (bar).** Keep `OpenProjectCommand`, `NewProjectCommand`,
  `SaveActiveCommand`. Remove `NewFileCommandKey`/`PublishCommandKey` from the
  service's bar surface (those move onto each `OpenProject`).
- **Open / create → add.** `openProjectAt`/`createProjectAt` build a `Project`
  via the factory, wrap it in an `OpenProject`, and `addOpenProject(op)`:
  dedupe by `op.Folder` (already open ⇒ no-op, status "Already open"), else add
  to `OpenProjects`, wire its per-project commands + node `OpenCommand`s, and
  persist (`OpenProjectsStore.Add(folder)`).
- **Per-project command wiring.** For each `OpenProject`:
  - `NewFileCommand = new RelayCommand(() => this.newFileIn(op))` — creates the
    factory's first format in `op`, refreshes `op`'s tree, opens the file (records
    `docOwners`).
  - `PublishCommand = new RelayCommand(() => this.publishProject(op), () => isPublishable(op.Factory))`
    — delegates to `op.Factory.publish(op.Project, op.Storage, this.Provider)`,
    surfaces the message. Disabled for non-publishable types.
  - `CloseCommand = new RelayCommand(() => this.closeProject(op))`.
- **Node open routing.** `wireNodes(op)` gives every node in `op.Root` an
  `OpenCommand` closing over `(node, op)`; `openNode(node, op)` opens through
  `op.Factory`/`op.Storage` (format-driven, as today) and records `docOwners`.
- **Save routing.** `saveActive()` looks up `host.ActiveDocument` in `docOwners`
  → that `OpenProject.Factory.saveFile(doc)` (falls back to a plain status if the
  active doc isn't a project file).
- **Close.** `closeProject(op)`: close its open tabs (each doc in `docOwners`
  whose owner is `op` → `host.Close(doc)`, drop from `docOwners`), remove from
  `OpenProjects`, `OpenProjectsStore.Remove(op.Folder)`. (Validation untracks its
  docs automatically on host close — Component 4.)
- **`RestoreSession()`** (public, awaitable): read `OpenProjectsStore.List()`; for
  each folder, if it still exists, `openProjectAt(folder)`; skip + prune missing.

## Component 3 — `OpenProjectsStore` + Persistence

`src/renderer/src/services/projects/open-projects-store.ts`, mirroring
`RecentProjectsService`.

```ts
export class OpenProjectsStore extends ServiceBase {
    static readonly Key
    List(): Promise<readonly string[]>          // open folder paths, tolerant of missing/corrupt → []
    Add(folder: string): Promise<void>          // append if absent
    Remove(folder: string): Promise<void>
}
```

Persists a JSON string array to `<userData>/open-projects.json` via
`FileSystemService`. Registered at the app root (`app.mu` `.services:`).

## Component 4 — Multi-Project Meta-model Validation

`MetaModelValidationService` becomes per-document instead of single-storage.

- Replace `SetProject(storage)` with `AttachDocument(doc: CodeDocument, storage:
  IStorage)`, called from `MetaModelProjectFactory.openFile` (which has both). It
  records `doc → storage`, hooks the doc's `Content`, and schedules revalidation.
- Keep the content-host open-set subscription for **removal** only (a closed doc
  untracks: drop from the doc→storage map, unhook its listener).
- `Revalidate()` groups tracked docs by their storage; for **each** storage it
  builds sources (that storage's `collectTodlSources` overlaid with its open docs'
  live `Content`), runs `validateSources`, and distributes diagnostics to that
  storage's open docs. Independent per project.
- The factory's `createProject`/`openProject` no longer call `SetProject`
  (validation attaches per opened document). `overlaySources`/`validateSources`
  (pure) are unchanged.

## Component 5 — Markup

`project-explorer.resources.mu`:

- **New `DataTemplate[OpenProject]`** — a header row bound to `$Name` carrying
  `ContextMenuService.ContextMenu = @ProjectContextMenu`, above an `ItemsControl
  [ ItemsSource = $Root.Children, ItemsPanel = @VerticalStackPanel ]` (children
  render via the existing `DataTemplate[ProjectNode]`, unchanged).
- **`ContextMenu x:key="ProjectContextMenu"`** — `MenuItem`s for `New File`
  (`$NewFileCommand`, `@NoteAdd`), `Publish` (`$PublishCommand`, `@Publish`),
  `MenuSeparator`, `Close Project` (`$CloseCommand`). Commands resolve against the
  row's `OpenProject`.
- **Root list** — the service template's tree `ItemsControl` switches
  `ItemsSource = $Roots` → `$OpenProjects` with `DataTemplate[OpenProject]`.
- **Command bar** — drop the New File and Publish `PanelButton`s; keep Open / New
  / Save.

## Component 6 — Bootstrap

`main.js` resolves `ProjectExplorerService` and `await`s `RestoreSession()` at
startup (after `app.initialize`), so the previous session's projects reappear.

## Error Handling

- **Reopen an already-open project** — no-op with an "Already open" status; no
  duplicate entry.
- **Restore a folder that moved/deleted** — skipped and pruned from the store; the
  others still restore.
- **Publish on a non-publishable project** — the menu item is disabled
  (`CanExecute` = `isPublishable`); no status noise.
- **Save with a non-project active document** (e.g. the scratch file opened by
  `CodeEditorService`) — not in `docOwners`; report "Nothing to save" rather than
  routing to a wrong factory.

## Testing Strategy

Vitest; `FakeStorage`, a real `DocumentsContentHostService`, a `ServiceProvider`
with `registerInstance`, and the recording fake factory from the existing explorer
test.

- **Add + dedupe** — opening two folders yields two `OpenProjects`; reopening one
  does not add a third.
- **Node routing** — with two projects (different fake factories), opening a node
  under project B calls **B's** factory `openFile`, not A's.
- **Save routing** — the active document created under project A saves through A's
  factory.
- **Close** — `closeProject` removes the entry, closes its tabs (host open-set
  shrinks), and calls `OpenProjectsStore.Remove`.
- **Publish gating** — a non-publishable factory's `PublishCommand.CanExecute()`
  is false.
- **`OpenProjectsStore`** — `Add`/`Remove`/`List` round-trip through `FakeStorage`;
  missing file → `[]`.
- **`RestoreSession`** — reopens listed folders that exist and skips/prunes ones
  that don't (fake `FileSystemService.Exists`).
- **Validation (multi-project)** — two meta-model projects each with an open doc;
  an error in project A's doc marks A's document only, B's stays clean.

## Out of Scope

- An "active/focused project" highlight — actions are explicit via the menu, so
  none is needed.
- Project reordering / drag-and-drop; closing individual files from the tree.
- Cross-project references (each meta-model validates within its own project).

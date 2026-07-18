# Multiple Open Projects — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let the Project Explorer hold several open projects at once (each a tree
root), with project actions in a per-project context menu, uniform actions in the
command bar, and the open set persisted + restored on launch.

**Spec:** `docs/superpowers/specs/2026-07-18-multi-project-explorer-design.md`.

**Tech Stack:** TypeScript (ESM, strict), mural runtime/framework, Vitest.

## Global Constraints

- Test files in `tests/` subfolders. Vitest; no Monaco/DOM — `FakeStorage`, a real
  `DocumentsContentHostService`, `ServiceProvider.registerInstance`, the recording
  fake factory pattern from the existing explorer test.
- Real TS enums for new fixed value sets.
- Persistence: `FileSystemService` + a JSON file under `<userData>` (mirrors
  `RecentProjectsService`), NOT the settings store.
- mural: `RelayCommand(execute, canExecute?)`; `Model.set_property_value` public;
  `ObservableCollection` + `.ToArray()/.Add()/.Remove()/.Clear()`;
  `DocumentsContentHostService` `OpenDocuments`/`ActiveDocument`/`Open`/`Close`.

---

### Task 1: `OpenProject` VM

**Files:**
- Create: `src/renderer/src/services/projects/open-project.ts`
- Create: `src/renderer/src/services/projects/tests/open-project.test.ts`

**Produces:** `OpenProject extends Model` with DPs `Name`, `Root` (ProjectNode),
`NewFileCommand`, `PublishCommand`, `CloseCommand`; ctor
`(project: Project, factory: IProjectFactory, storage: IStorage)` seeding
`Name`=`project.Name`, `Root`=`project.Root`; read getters `Project`, `Factory`,
`Storage`, `Folder` (=`project.RootPath`). Command DPs start undefined (explorer
sets them).

- [ ] Failing test: constructing an OpenProject exposes Name/Root/Folder from the
      Project, and Factory/Storage as given; command DPs are settable + gettable.
- [ ] Run → fail. Implement. Run → pass. Commit.

### Task 2: `OpenProjectsStore` persistence

**Files:**
- Create: `src/renderer/src/services/projects/open-projects-store.ts`
- Create: `src/renderer/src/services/projects/tests/open-projects-store.test.ts`

**Produces:** `OpenProjectsStore extends ServiceBase` (mirrors
`RecentProjectsService`): `List(): Promise<readonly string[]>` (missing/corrupt →
`[]`), `Add(folder)` (append if absent), `Remove(folder)`; persists a JSON string
array to `<userData>/open-projects.json` via `FileSystemService`.

- [ ] Failing test (fake `FileSystemService` over an in-memory Map + fake
      `EnvironmentService`): `Add` twice with the same folder stores one; `Remove`
      drops it; `List` on a missing file returns `[]`.
- [ ] Run → fail. Implement. Run → pass. Commit.

### Task 3: `ProjectExplorerService` multi-project refactor

**Files:**
- Modify: `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts`
- Modify: `src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts`

**Consumes:** Task 1 (`OpenProject`), Task 2 (`OpenProjectsStore`).
**Produces:** `OpenProjectsKey` (`ObservableCollection<OpenProject>`) replacing
`ProjectKey`/`RootsKey`/`activeFactory`/`activeStorage`; private
`docOwners: Map<IDocument, OpenProject>`; `addOpenProject(op)` (dedupe by Folder,
wire commands + node OpenCommands, persist); `newFileIn(op)`, `publishProject(op)`,
`closeProject(op)`, `openNode(node, op)`, `saveActive()` (routes via `docOwners`),
`RestoreSession()`. Command bar keeps Open/New/Save (drop NewFile/Publish DPs).

- [ ] Failing tests (extend existing; `FakeStorage` + real host + fake factory):
      opening two folders adds two OpenProjects and reopening one does not add a
      third; opening a node under project B calls B's factory openFile; the active
      doc created under A saves through A's factory; `closeProject` removes the
      entry + closes its tabs + calls `OpenProjectsStore.Remove`; a non-publishable
      factory's `PublishCommand.CanExecute()` is false; `RestoreSession` reopens
      existing folders and skips missing ones.
- [ ] Run → fail. Implement. Run → pass. Commit.

*Detail:* `openProjectAt`/`createProjectAt` now build an `OpenProject` and call
`addOpenProject`; `resolveFactory`/`typeChoices`/`validateNewProject`/dialogs
unchanged. `RestoreSession` reads `OpenProjectsStore.List()` and calls
`openProjectAt` per existing folder (fake `FileSystemService.Exists`).

### Task 4: Multi-project meta-model validation

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/meta-model-validation-service.ts`
- Modify: `src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts`
- Modify: `src/renderer/src/modules/meta-model/services/tests/meta-model-validation-service.test.ts`

**Produces:** `AttachDocument(doc: CodeDocument, storage: IStorage)` replacing
`SetProject`; a `doc → storage` map; `Revalidate()` groups tracked docs by storage
and validates each project independently. Factory `openFile` calls
`AttachDocument`; `createProject`/`openProject` drop `attachValidation`.
`validateSources`/`overlaySources` unchanged.

- [ ] Failing test: two storages, each with an open `.todl` doc; an error in
      storage-A's doc marks A's document only, B's stays clean (extends the
      existing service test; drop the SetProject-based assertions).
- [ ] Run → fail. Implement. Run → pass. Commit.

### Task 5: Explorer markup

**Files:**
- Modify: `src/renderer/src/modules/project-explorer/project-explorer.resources.mu`

**Produces:** a `DataTemplate[OpenProject]` (header row bound to `$Name` with
`ContextMenuService.ContextMenu = @ProjectContextMenu`, over an `ItemsControl
[ ItemsSource = $Root.Children, ItemsPanel = @VerticalStackPanel ]`); a shared
`ContextMenu x:key="ProjectContextMenu"` (`New File`/`$NewFileCommand`/`@NoteAdd`,
`Publish`/`$PublishCommand`/`@Publish`, `MenuSeparator`, `Close Project`/
`$CloseCommand`); the service template's tree `ItemsSource` `$Roots` → `$OpenProjects`
with the new template; command bar drops the New File + Publish buttons.

- [ ] Add an `OpenProject` import to the resource file. Edit the templates.
- [ ] `npm run compile:mu` → compiles. Commit.

### Task 6: Bootstrap + registration + verify

**Files:**
- Modify: `src/renderer/src/app.mu` (register `OpenProjectsStore` in `.services:`)
- Modify: `src/renderer/src/main.js` (`await explorer.RestoreSession()` after init)

- [ ] Register `OpenProjectsStore`; import + call `RestoreSession()` in the
      bootstrap (resolve `ProjectExplorerService` from `app.Services`).
- [ ] `npm run compile:mu`; `npm run typecheck`; `npm test` (all green);
      `npm run build`. Commit.

---

## Self-Review

- **Spec coverage:** Components 1–6 map to Tasks 1–6.
- **Placeholders:** none.
- **Type consistency:** `OpenProject` (T1) consumed by the explorer (T3) and markup
  (T5); `OpenProjectsStore` (T2) by the explorer (T3) + app (T6); `AttachDocument`
  (T4) called by the factory (T4). `docOwners` keyed by `IDocument` throughout.

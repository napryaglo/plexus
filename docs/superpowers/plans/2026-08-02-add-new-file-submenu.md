# "Add New →" Submenu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the project explorer's fixed "New File" context-menu item with an "Add New →" submenu listing each project type's declared file formats, and make `.archdiagram` the architecture project's primary format so architecture diagrams can be created from the UI.

**Architecture:** A small `NewItemChoice` view-model (one per `ProjectFileFormat`) drives a dynamic `MenuItem` submenu bound with `ItemsControl.ItemsSource`. `ProjectExplorerService.newFileIn` is parameterized by the specific format to create; the host builds the choices onto both `OpenProject` and `ProjectNode`. The architecture factory declares two formats (`.archdiagram` first, `.todl` second). No per-type UI code.

**Tech Stack:** TypeScript, `@pragmatic-tech-ai/mural` (runtime + framework, from Verdaccio), Vitest, mural `.mu` markup.

## Global Constraints

- Every test file lives in a `tests/` subfolder beside the source it exercises (e.g. `services/projects/tests/new-item-choice.test.ts`) — never beside the source.
- `.mu.js` files are gitignored build artifacts compiled from `.mu`; never `git add` them. Commit only `.mu` sources.
- Anything bound in `.mu` markup (`$Label`, `$Command`, `$NewItemChoices`) must be a mural `Model` dependency property — bindings only walk DPs.
- Architecture factory formats, verbatim: `{ extension: '.archdiagram', kind: 'diagram', displayName: 'Architecture Diagram' }` then `{ extension: '.todl', kind: 'todl', displayName: 'TODL Definition' }`.
- Run the full suite with `npm test` from the `Plexus` directory (Vitest globs `src/**/*.test.ts`).
- Work happens on branch `add-new-file-submenu` (already created off `main`).

---

### Task 1: `NewItemChoice` view-model

**Files:**
- Create: `src/renderer/src/services/projects/new-item-choice.ts`
- Test: `src/renderer/src/services/projects/tests/new-item-choice.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `class NewItemChoice extends Model` with `constructor(label: string, command: ICommand)`, a read-only `Label: string` and `Command: ICommand | undefined`. Later tasks build one per format and bind `$Label` / `$Command` in the submenu template.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'vitest'
import { RelayCommand } from '@pragmatic-tech-ai/mural/runtime'
import { NewItemChoice } from '../new-item-choice.js'

test('NewItemChoice exposes its label and runs its command', () => {
    let ran = false
    const choice = new NewItemChoice('Architecture Diagram', new RelayCommand(() => { ran = true }))
    expect(choice.Label).toBe('Architecture Diagram')
    choice.Command!.Execute(undefined)
    expect(ran).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- new-item-choice`
Expected: FAIL — cannot find module `../new-item-choice.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { MetaData, Model, type ICommand } from '@pragmatic-tech-ai/mural/runtime'

// One entry in a project's / node's "Add New" submenu: a labelled command that
// creates a file of a specific declared format in the target container. The host
// (ProjectExplorerService) builds one per ProjectFileFormat; the submenu's item
// template binds $Label and $Command. A Model (not a plain object) so those
// bindings resolve — bindings only walk dependency properties.
export class NewItemChoice extends Model
{
    static readonly LabelKey = Model.RegisterProperty<string>(NewItemChoice, 'Label', '', MetaData.None)
    static readonly CommandKey = Model.RegisterProperty<ICommand | undefined>(
        NewItemChoice, 'Command', undefined, MetaData.None)

    constructor(label: string, command: ICommand)
    {
        super()
        this.set_property_value(NewItemChoice.LabelKey, label)
        this.set_property_value(NewItemChoice.CommandKey, command)
    }

    public get Label(): string { return this.get_property_value(NewItemChoice.LabelKey) }
    public get Command(): ICommand | undefined { return this.get_property_value(NewItemChoice.CommandKey) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- new-item-choice`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/services/projects/new-item-choice.ts src/renderer/src/services/projects/tests/new-item-choice.test.ts
git commit -m "feat: NewItemChoice view-model for the Add New submenu"
```

---

### Task 2: Architecture factory declares `.archdiagram` + `.todl`

**Files:**
- Modify: `src/renderer/src/modules/architecture-repository/services/architecture-project-factory.ts` (the `formats` field at lines 40-42; the `populate` kind computation at lines 89-91)
- Test: `src/renderer/src/modules/architecture-repository/services/tests/architecture-project-factory.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `ArchitectureProjectFactory.formats` = `[{'.archdiagram','diagram','Architecture Diagram'}, {'.todl','todl','TODL Definition'}]`; a scanned `.archdiagram` file becomes `ProjectNode` kind `'diagram'`, a `.todl` stays `'todl'`. Task 3 relies on `formats[0]` being the diagram.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { PROJECT_MANIFEST_FILENAME } from '../../../../services/projects/project-factory.js'
import { ArchitectureProjectFactory } from '../architecture-project-factory.js'

function factory(): ArchitectureProjectFactory
{
    return new ArchitectureProjectFactory(new ServiceProvider())
}

test('architecture factory lists Architecture Diagram first, then TODL Definition', () => {
    const f = factory()
    expect(f.formats.map((x) => x.extension)).toEqual(['.archdiagram', '.todl'])
    expect(f.formats[0]).toEqual({ extension: '.archdiagram', kind: 'diagram', displayName: 'Architecture Diagram' })
    expect(f.formats[1]).toEqual({ extension: '.todl', kind: 'todl', displayName: 'TODL Definition' })
})

test('openProject marks a .archdiagram as a diagram node and a .todl as a todl node', async () => {
    const storage = new FakeStorage('C:/a')
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'architecture', name: 'A', version: 1 }))
    await storage.WriteText('city.archdiagram', '{}')
    await storage.WriteText('city.todl', 'namespace city\n{\n}\n')

    const project = await factory().openProject(storage)

    const kinds = new Map(project.Root.Children.ToArray().map((n) => [n.Name, n.Kind]))
    expect(kinds.get('city.archdiagram')).toBe('diagram')
    expect(kinds.get('city.todl')).toBe('todl')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- architecture-project-factory`
Expected: FAIL — `formats` has only `.todl`; the `.archdiagram` node's kind is `'file'`, not `'diagram'`.

- [ ] **Step 3: Write the minimal implementation**

In `architecture-project-factory.ts`, replace the `formats` field (currently lines 40-42):

```ts
    public readonly formats: readonly ProjectFileFormat[] = [
        { extension: '.archdiagram', kind: 'diagram', displayName: 'Architecture Diagram' },
        { extension: '.todl',        kind: 'todl',    displayName: 'TODL Definition' },
    ]
```

And in `populate`, replace the `kind` computation (currently lines 89-91):

```ts
            const kind: ProjectNodeKind = e.IsDirectory
                ? 'folder'
                : extname(e.Name) === '.archdiagram' ? 'diagram'
                    : extname(e.Name) === '.todl' ? 'todl' : 'file'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- architecture-project-factory`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/architecture-repository/services/architecture-project-factory.ts src/renderer/src/modules/architecture-repository/services/tests/architecture-project-factory.test.ts
git commit -m "feat: architecture project offers .archdiagram (primary) and .todl formats"
```

---

### Task 3: Parameterize `newFileIn` and build `NewItemChoices`

**Files:**
- Modify: `src/renderer/src/services/projects/open-project.ts` (add a `NewItemChoices` DP)
- Modify: `src/renderer/src/services/projects/project.ts` (add a `NewItemChoices` DP on `ProjectNode`)
- Modify: `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts` (`newFileIn` signature at line 347; `wireProjectCommands` at line 321; `wireNodes` at line 989)
- Modify (test harness + new tests): `src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts`

**Interfaces:**
- Consumes: `NewItemChoice` (Task 1); `op.Factory.formats` with `.archdiagram` first (Task 2).
- Produces: `newFileIn(op: OpenProject, parentFolder?: string, format?: ProjectFileFormat): Promise<void>` — defaults `format` to `op.Factory.formats[0]`. `OpenProject.NewItemChoices` and `ProjectNode.NewItemChoices`, each an `ObservableCollection<NewItemChoice>`, one choice per declared format, in declaration order. The existing `NewFileCommand` on both stays (removed in Task 4).

**NOTE:** This task keeps the existing `NewFileCommand` wiring so the current `.mu` menu still works; Task 4 swaps the markup and removes `NewFileCommand`. Every commit stays runnable.

- [ ] **Step 1: Write the failing tests**

Add these two tests to `project-explorer-service.test.ts` (after the existing `New File in a subfolder` test), plus the `twoFormatFactory` helper:

```ts
function twoFormatFactory(): IProjectFactory
{
    return {
        formats: [
            { extension: '.archdiagram', kind: 'diagram', displayName: 'Architecture Diagram' },
            { extension: '.todl',        kind: 'todl',    displayName: 'TODL Definition' },
        ],
        createProject: async (_s, name) => projectWith(name, 'C:/x'),
        openProject: async () => projectWith('P', 'C:/x'),
        saveProject: async () => {},
    }
}

test('a two-format project builds one Add-New choice per format on the project and each node', async () => {
    const { priv } = makeExplorer()
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), twoFormatFactory(), new FakeStorage('C:/a'))

    expect(op.NewItemChoices.ToArray().map((c) => c.Label)).toEqual(['Architecture Diagram', 'TODL Definition'])
    const child = op.Root.Children.ToArray()[0]!
    expect(child.NewItemChoices.ToArray().map((c) => c.Label)).toEqual(['Architecture Diagram', 'TODL Definition'])
})

test('a New choice creates and opens a file of THAT format, not just the primary', async () => {
    const { priv, rec } = makeExplorer()
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), twoFormatFactory(), new FakeStorage('C:/a'))

    op.NewItemChoices.ToArray()[1]!.Command!.Execute(undefined)     // the TODL choice
    await new Promise((r) => setTimeout(r, 0))
    expect(rec.opened).toContain('todl.todl')

    op.NewItemChoices.ToArray()[0]!.Command!.Execute(undefined)     // the Diagram choice
    await new Promise((r) => setTimeout(r, 0))
    expect(rec.opened).toContain('diagram.archdiagram')
})
```

Update the test harness so the fake document registry resolves `.archdiagram` and the fake `newFile` echoes the already-extensioned name. In `fakeDocFactory` (line 37) change `newFile` to:

```ts
        newFile: async (_s, name) => name,
```

In `makeExplorer`'s `DocumentTypeRegistry` fake (line 155) change `GetByExtension` to:

```ts
        GetByExtension: (ext: string) => ((ext === '.todl' || ext === '.archdiagram') ? { Factory: TodlDocFactoryToken } : undefined),
```

Update the `ExplorerPrivates.newFileIn` signature (line 100) to:

```ts
    newFileIn(op: OpenProject, parentFolder?: string, format?: ProjectFileFormat): Promise<void>
```

and add the import at the top of the test file:

```ts
import type { ProjectFileFormat } from '../../../../services/projects/project-factory.js'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- project-explorer-service`
Expected: FAIL — `op.NewItemChoices` is undefined; the diagram choice can't create a `.archdiagram`.

- [ ] **Step 3: Implement — add the `NewItemChoices` DP on `OpenProject`**

In `open-project.ts`, add the import:

```ts
import { MetaData, Model, ObservableCollection, type ICommand, type PropertyDescriptor } from '@pragmatic-tech-ai/mural/runtime'
import { NewItemChoice } from './new-item-choice.js'
```

Register the property (place it beside `NewFileCommandKey`):

```ts
    static readonly NewItemChoicesKey = Model.RegisterProperty<ObservableCollection<NewItemChoice>>(
        OpenProject, 'NewItemChoices', undefined as unknown as ObservableCollection<NewItemChoice>, MetaData.None)
```

Add the accessor (beside the `NewFileCommand` accessor):

```ts
    public get NewItemChoices(): ObservableCollection<NewItemChoice> { return this.get_property_value(OpenProject.NewItemChoicesKey) }
    public set NewItemChoices(v: ObservableCollection<NewItemChoice>) { this.set_property_value(OpenProject.NewItemChoicesKey, v) }
```

- [ ] **Step 4: Implement — add the `NewItemChoices` DP on `ProjectNode`**

In `project.ts`, add the import (the file already imports `ObservableCollection`):

```ts
import { NewItemChoice } from './new-item-choice.js'
```

Register the property (beside `NewFileCommandKey`):

```ts
    static readonly NewItemChoicesKey = Model.RegisterProperty<ObservableCollection<NewItemChoice>>(
        ProjectNode, 'NewItemChoices', undefined as unknown as ObservableCollection<NewItemChoice>, MetaData.None)
```

Add the accessor (beside the `NewFileCommand` accessor):

```ts
    public get NewItemChoices(): ObservableCollection<NewItemChoice> { return this.get_property_value(ProjectNode.NewItemChoicesKey) }
    public set NewItemChoices(v: ObservableCollection<NewItemChoice>) { this.set_property_value(ProjectNode.NewItemChoicesKey, v) }
```

- [ ] **Step 5: Implement — parameterize `newFileIn` and add the choices builder**

In `project-explorer-service.ts`, add the import:

```ts
import { NewItemChoice } from '../../../services/projects/new-item-choice.js'
```

Replace `newFileIn` (lines 347-364) with the format-parameterized version:

```ts
    // Create a new file of `format` (default: the project's primary format) inside
    // `parentFolder` (project-relative; '' = the project root) and open it. The
    // name is the format kind, auto-numbered to dodge collisions (foo → foo-2).
    private async newFileIn(op: OpenProject, parentFolder = '', format: ProjectFileFormat | undefined = op.Factory.formats[0]): Promise<void>
    {
        if (format === undefined) { this.Status = 'This project type has no file format.'; return }
        const factory = this.resolveDocumentFactory(format.extension)
        if (factory === undefined) { this.Status = `No editor for ${format.extension}.`; return }
        try {
            const name = await uniqueStorageName(op.Storage, joinRel(parentFolder, `${format.kind}${format.extension}`))
            const path = await factory.newFile(op.Storage, name)
            // Refresh the project's tree so the new file appears, then open it.
            op.Adopt(await op.Factory.openProject(op.Storage))
            this.wireNodes(op.Root, op)
            await this.openDocument(op, path, factory)
            this.Status = `New ${format.displayName} at ${basename(path)}.`
        } catch (e) {
            this.Status = `New file failed: ${(e as Error).message}`
        }
    }

    // One NewItemChoice per declared format, each creating that format in
    // `container` (project-relative; '' = root). Bound by the "Add New" submenu.
    private newItemChoices(op: OpenProject, container: string): ObservableCollection<NewItemChoice>
    {
        const choices = new ObservableCollection<NewItemChoice>()
        for (const format of op.Factory.formats) {
            choices.Add(new NewItemChoice(format.displayName, new RelayCommand(() => void this.newFileIn(op, container, format))))
        }
        return choices
    }
```

In `wireProjectCommands` (line 321), add after the existing `op.NewFileCommand = ...` line:

```ts
        op.NewItemChoices = this.newItemChoices(op, '')
```

In `wireNodes` (line 989), add after the existing `node.NewFileCommand = ...` line:

```ts
        node.NewItemChoices = this.newItemChoices(op, container)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- project-explorer-service`
Expected: PASS (including the existing `New File in a subfolder` test, which still resolves `formats[0]` = `todl` for the single-format fake factory).

- [ ] **Step 7: Run the full suite + typecheck**

Run: `npm test` then `npm run typecheck`
Expected: all green (no consumer of the changed `newFileIn` default broke).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/services/projects/open-project.ts src/renderer/src/services/projects/project.ts src/renderer/src/modules/project-explorer/services/project-explorer-service.ts src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts
git commit -m "feat: format-parameterized newFileIn + per-format NewItemChoices"
```

---

### Task 4: "Add New →" submenu markup + remove `NewFileCommand`

**Files:**
- Modify: `src/renderer/src/modules/project-explorer/project-explorer.resources.mu` (the `@ProjectContextMenu` "New File" item at lines 30-33; the `@NodeContextMenu` "New File" item at lines 61-64; add a `NewItemChoiceTemplate`; add the `NewItemChoice` import)
- Modify: `src/renderer/src/services/projects/open-project.ts` (remove `NewFileCommandKey` + its accessor)
- Modify: `src/renderer/src/services/projects/project.ts` (remove `NewFileCommandKey` + its accessor on `ProjectNode`)
- Modify: `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts` (remove the two `NewFileCommand` assignments)

**Interfaces:**
- Consumes: `OpenProject.NewItemChoices` / `ProjectNode.NewItemChoices` (Task 3); `NewItemChoice.Label` / `.Command` (Task 1).
- Produces: the live "Add New" submenu on both menus. `NewFileCommand` no longer exists on `OpenProject` / `ProjectNode`.

**RISK GATE — do this step first, before the edits below.** The dynamic `MenuItem` submenu (`ItemsControl.ItemsSource` + a `MenuItem` item template) is a supported pattern (`MenuItem` extends `ItemsControl`; its `▶` chevron shows once `itemCount() > 0`) but is not used elsewhere in this app. Build just the `@ProjectContextMenu` change + the template first, run the app (below), and confirm the submenu opens and a click creates a file. Only then apply the `@NodeContextMenu` change and the `NewFileCommand` removals. If the submenu does not render or click through, STOP and report — do not delete `NewFileCommand`; the fallback is to construct the submenu's `MenuItem` children imperatively in the host and expose them as a `Visual` collection the menu binds directly (`IsItemItsOwnContainerOverride` accepts `Visual` items).

- [ ] **Step 1: Add the `NewItemChoice` import to the resources file**

At the top of `project-explorer.resources.mu`, beside the other imports:

```
import NewItemChoice from "../../services/projects/new-item-choice.js"
```

- [ ] **Step 2: Add the submenu item template**

Inside `resources ProjectExplorerResources { ... }`, add:

```
    // One row in an "Add New" submenu: a MenuItem whose Header/Command bind the
    // NewItemChoice. MenuItem is an ItemsControl, so the parent "Add New" item's
    // ItemsSource generates one of these per available project format.
    DataTemplate x:key="NewItemChoiceTemplate" [ DataType = NewItemChoice ] {
        MenuItem [ Header = $Label, Command = $Command ]
    }
```

- [ ] **Step 3: Swap the project menu's "New File" item for the submenu**

In `@ProjectContextMenu`, replace the `MenuItem [ Header = "New File", Command = $NewFileCommand, ... ]` (lines 30-33) with:

```
        MenuItem
            [ Header = "Add New",
              Icon = Shape [ Geometry = @NoteAdd, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ],
              ItemsControl.ItemsSource  = $NewItemChoices,
              ItemsControl.ItemTemplate = @NewItemChoiceTemplate ]
```

- [ ] **Step 4: Compile the markup and run the app for the RISK GATE check**

Run: `npm run compile:mu` (regenerates the gitignored `.mu.js`), then `npm run dev`.
In the app: open (or create) an architecture project, right-click the project header → **Add New** should expand a submenu with **Architecture Diagram** and **TODL Definition**. Click **Architecture Diagram** → a `diagram.archdiagram` file is created, appears in the tree, and opens in a tab.
Expected: submenu renders, both rows present, clicking creates + opens the file. If not, STOP (see RISK GATE).

- [ ] **Step 5: Swap the node menu's "New File" item for the submenu**

In `@NodeContextMenu`, replace the `MenuItem [ Header = "New File", Command = $NewFileCommand, ... ]` (lines 61-64) with:

```
        MenuItem
            [ Header = "Add New",
              Icon = Shape [ Geometry = @NoteAdd, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ],
              ItemsControl.ItemsSource  = $NewItemChoices,
              ItemsControl.ItemTemplate = @NewItemChoiceTemplate ]
```

- [ ] **Step 6: Remove the now-unused `NewFileCommand` — `OpenProject`**

In `open-project.ts`, delete the `NewFileCommandKey` registration (lines 18-19) and its getter/setter (lines 98-99).

- [ ] **Step 7: Remove the now-unused `NewFileCommand` — `ProjectNode`**

In `project.ts`, delete the `NewFileCommandKey` registration (lines 29-30) and its getter/setter (lines 85-86). Leave the doc-comment mention of `$NewFileCommand` updated or removed so it doesn't dangle.

- [ ] **Step 8: Remove the `NewFileCommand` assignments in the host**

In `project-explorer-service.ts`, delete the `op.NewFileCommand = new RelayCommand(() => void this.newFileIn(op))` line in `wireProjectCommands` and the `node.NewFileCommand = new RelayCommand(() => void this.newFileIn(op, container))` line in `wireNodes`.

- [ ] **Step 9: Typecheck, full suite, and re-verify the node menu live**

Run: `npm run typecheck` then `npm test`.
Expected: green — no dangling reference to `NewFileCommand`.
Then `npm run compile:mu && npm run dev`: right-click a **file node** inside the project → **Add New** submenu appears; creating a diagram beside that node works.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/modules/project-explorer/project-explorer.resources.mu src/renderer/src/services/projects/open-project.ts src/renderer/src/services/projects/project.ts src/renderer/src/modules/project-explorer/services/project-explorer-service.ts
git commit -m "feat: Add New submenu on project + node menus; drop NewFileCommand"
```

---

## Notes for the implementer

- The drop-doesn't-create-a-shape bug is a **separate** investigation; a temporary `[arch DEBUG]` `console.warn` currently sits in `arch-diagram-document.ts` (`CreateNode`). Leave it — it is unrelated to this plan and will be removed when that bug is resolved.
- `npm run compile:mu` output (`*.mu.js`) is gitignored — never stage it.
- Single-format project types (meta-model, library, diagram) now show an "Add New" submenu with a single child. This is intended (one uniform code path).

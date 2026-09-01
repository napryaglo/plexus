# Architecture Resolver (SP4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the `architecture` project a terminal TODL-authoring project binding a meta-model + a set of libraries, with live `checkAgainst([metaModel, ...libraries])` validation and a multi-select libraries picker in New Project.

**Architecture:** Mirror `LibraryProjectFactory`, but (a) bind `{ metaModel, libraries[] }` not just a meta-model, (b) author `.todl` (swap `formats` from `.diagram`), (c) no publish (terminal). The base-aware `TodlValidationService` + `resolveBases` already handle a `libraries[]` array, so live validation works once the manifest carries both. The New-Project dialog gains a `Switch`-row libraries checklist.

**Tech Stack:** TypeScript (renderer), mural, `.mu` compiled via `npm run compile:mu`, Vitest, `@pragmatic-tech-ai/todl@^0.2.0` (`checkAgainst`).

## Global Constraints

- Every test file in a `tests/` subfolder next to its source.
- Real TS enums; no new string-literal union types.
- Commits authored `Eugene Napryaglo <evgen.napryaglo@gmail.com>`; message ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Do NOT stage `src/renderer/src/modules/ontologies/services/ontologies-service.ts`.
- `.mu.js` are gitignored build artifacts — regenerate with `npm run compile:mu`; do not commit them. No new `.mu` files in this plan, so the `package.json` `compile:mu` list is unchanged.
- Verify from `Plexus/`: `npm test`, `npm run typecheck`, `npm run compile:mu`.

---

## Task 0: Branch

- [ ] **Step 1: Cut the feature branch** off `main` (spec already committed to `main` at `1adb8aa`).

```bash
git checkout -b architecture-resolver
```

---

## Task 1: Architecture factory → TODL-authoring, meta-model + libraries bound

**Files:**
- Modify: `src/renderer/src/services/projects/project-factory.ts` (add `offersLibraries?`)
- Modify: `src/renderer/src/modules/architecture-repository/services/architecture-project-factory.ts`
- Test: `src/renderer/src/modules/architecture-repository/services/tests/architecture-project-factory.test.ts`

**Interfaces:**
- Consumes: `BaseBindings`, `BaseRef` (`services/projects/base-binding.js`); `Project`, `ProjectNode` (`services/projects/project.js`).
- Produces: `IProjectFactory.offersLibraries?: boolean`; `ArchitectureProjectFactory` with `formats=[.todl]`, `requiresMetaModel=true`, `offersLibraries=true`, `createProject(storage, name, bindings?)` writing `{ metaModel?, libraries? }`, `.todl` nodes tagged `'todl'`, not publishable.

- [ ] **Step 1: Widen `IProjectFactory`** — add `offersLibraries` beneath `requiresMetaModel` in `project-factory.ts`:

```ts
    // True when creating this project type needs a meta-model base chosen up front
    // (the New-Project dialog shows a meta-model picker). Absent ⇒ false.
    readonly requiresMetaModel?: boolean

    // True when this project type binds a set of libraries chosen up front (the
    // New-Project dialog shows a libraries multi-select). Absent ⇒ false.
    readonly offersLibraries?: boolean
```

- [ ] **Step 2: Write the failing test** — `tests/architecture-project-factory.test.ts`:

```ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { PROJECT_MANIFEST_FILENAME, isPublishable } from '../../../../services/projects/project-factory.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { ArchitectureProjectFactory } from '../architecture-project-factory.js'

function factory(): ArchitectureProjectFactory { return new ArchitectureProjectFactory(new ServiceProvider()) }

test('createProject writes an architecture manifest with meta-model + libraries bindings', async () => {
    const storage = new FakeStorage('fake://Acme')
    const project = await factory().createProject(storage, 'Acme Arch', {
        metaModel: { id: 'ea', version: '5' },
        libraries: [{ id: 'microsoft', version: '0.1.0' }, { id: 'aws', version: '2' }],
    })
    expect(project.Type).toBe('architecture')
    const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
    expect(manifest.type).toBe('architecture')
    expect(manifest.metaModel).toEqual({ id: 'ea', version: '5' })
    expect(manifest.libraries).toEqual([{ id: 'microsoft', version: '0.1.0' }, { id: 'aws', version: '2' }])
})

test('createProject with no bindings omits both binding fields', async () => {
    const storage = new FakeStorage('fake://Bare')
    await factory().createProject(storage, 'Bare')
    const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
    expect('metaModel' in manifest).toBe(false)
    expect('libraries' in manifest).toBe(false)
})

test('requiresMetaModel + offersLibraries are true; the factory is not publishable', () => {
    const f = factory()
    expect(f.requiresMetaModel).toBe(true)
    expect(f.offersLibraries).toBe(true)
    expect(isPublishable(f)).toBe(false)
})

test('openProject tags .todl files as openable todl nodes', async () => {
    const storage = new FakeStorage('fake://Acme')
    await factory().createProject(storage, 'Acme')
    await storage.WriteText('model.todl', 'namespace a { concept x { label : string; } }')
    await storage.WriteText('notes.md', '# notes')
    const project = await factory().openProject(storage)
    const kinds = new Map(project.Root.Children.ToArray().map((c) => [c.Name, c.Kind]))
    expect(kinds.get('model.todl')).toBe('todl')
    expect(kinds.get('notes.md')).toBe('file')
})
```

- [ ] **Step 3: Run — fail** (`npx vitest run src/renderer/src/modules/architecture-repository/services/tests/architecture-project-factory.test.ts`). Expected: bindings not persisted / `offersLibraries` undefined.

- [ ] **Step 4: Rewrite `architecture-project-factory.ts`:**

```ts
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import {
    PROJECT_MANIFEST_FILENAME,
    type IProjectFactory,
    type ProjectFileFormat,
    type ProjectManifestEnvelope,
} from '../../../services/projects/project-factory.js'
import type { BaseBindings, BaseRef } from '../../../services/projects/base-binding.js'
import { Project, ProjectNode, type ProjectNodeKind } from '../../../services/projects/project.js'
import { compareStorageEntries, type IStorage } from '../../../services/storage/storage.js'

// The 'architecture' project type — the architecture-repository module's
// contribution to the generic ProjectExplorerService (declared via
// `.projectFactories:`, resolved through the ProjectFactoryRegistry). It is a
// TODL-authoring project: its `.todl` files are the instance-tier architecture
// model, validated live against the project's BOUND bases — a meta-model AND a
// set of libraries — by the shared base-aware TodlValidationService (which reads
// the manifest's metaModel + libraries via resolveBases). Architecture is the
// terminal consumer: it binds bases but publishes nothing, so it is not an
// IPublishableProjectFactory.
//
// The `.todl` FILE format is edited by the meta-model module's TodlDocumentFactory
// (resolved by extension) — editors own files, this factory owns the project. All
// persistence flows through the project's rooted IStorage (project-relative paths).
interface ArchitectureManifest extends ProjectManifestEnvelope
{
    metaModel?: BaseRef                  // the meta-model this architecture conforms to
    libraries?: readonly BaseRef[]       // the technology libraries it draws on
}

export class ArchitectureProjectFactory extends ServiceBase implements IProjectFactory
{
    public static readonly Key = new ServiceKey<ArchitectureProjectFactory>('ArchitectureProjectFactory')
    public static readonly ProjectType = 'architecture'

    public readonly requiresMetaModel = true
    public readonly offersLibraries = true

    public readonly formats: readonly ProjectFileFormat[] = [
        { extension: '.todl', kind: 'todl', displayName: 'TODL Definition' },
    ]

    constructor(provider: IServiceProvider) { super(provider) }

    public async createProject(storage: IStorage, name: string, bindings?: BaseBindings): Promise<Project>
    {
        const manifest: ArchitectureManifest = {
            type: ArchitectureProjectFactory.ProjectType, name, version: 1,
            ...(bindings?.metaModel !== undefined ? { metaModel: bindings.metaModel } : {}),
            ...(bindings?.libraries !== undefined && bindings.libraries.length > 0
                ? { libraries: bindings.libraries } : {}),
        }
        await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))
        return this.buildProject(storage, manifest)
    }

    public async openProject(storage: IStorage): Promise<Project>
    {
        const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as ArchitectureManifest
        return this.buildProject(storage, manifest)
    }

    public async saveProject(project: Project, storage: IStorage): Promise<void>
    {
        // Preserve the bindings; only the name tracks the project.
        const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as ArchitectureManifest
        manifest.name = project.Name
        await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))
    }

    private async buildProject(storage: IStorage, manifest: ArchitectureManifest): Promise<Project>
    {
        const rootName = basename(storage.Root)
        const root = new ProjectNode(rootName, '', 'folder')   // the root node's path is ''
        await this.populate(storage, root)
        return new Project(manifest.type, manifest.name ?? rootName, storage.Root, root)
    }

    // Recursively fill a folder node's children from storage. The manifest file
    // is hidden; `.todl` files are marked openable (kind 'todl'). Node paths are
    // project-relative (POSIX `/`); the root node's path is ''.
    private async populate(storage: IStorage, node: ProjectNode): Promise<void>
    {
        const entries = [...await storage.List(node.Path)].sort(compareStorageEntries)
        for (const e of entries) {
            if (node.Path === '' && e.Name === PROJECT_MANIFEST_FILENAME) continue
            const childPath = joinRel(node.Path, e.Name)
            const kind: ProjectNodeKind = e.IsDirectory
                ? 'folder'
                : extname(e.Name) === '.todl' ? 'todl' : 'file'
            const child = new ProjectNode(e.Name, childPath, kind)
            node.Children.Add(child)
            if (e.IsDirectory) await this.populate(storage, child)
        }
    }
}

// ── project-relative path helpers (POSIX `/`; the storage backend translates) ──
function joinRel(dir: string, name: string): string
{
    return dir === '' ? name : dir + '/' + name
}

function basename(p: string): string
{
    const parts = p.split(/[\\/]/)
    return parts[parts.length - 1] || p
}

function extname(name: string): string
{
    const i = name.lastIndexOf('.')
    return i > 0 ? name.slice(i).toLowerCase() : ''
}
```

- [ ] **Step 5: Run — pass.** `npx vitest run src/renderer/src/modules/architecture-repository/services/tests/architecture-project-factory.test.ts` → 4 pass.

- [ ] **Step 6: Typecheck** — `npm run typecheck` clean.

- [ ] **Step 7: Commit** (stage only these 3 files; NOT `ontologies-service.ts`):

```bash
git add src/renderer/src/services/projects/project-factory.ts \
        src/renderer/src/modules/architecture-repository/services/architecture-project-factory.ts \
        src/renderer/src/modules/architecture-repository/services/tests/architecture-project-factory.test.ts
git commit -m "feat(architecture): TODL-authoring project binding meta-model + libraries

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: New-Project libraries multi-select in the dialog model

**Files:**
- Modify: `src/renderer/src/services/projects/new-project-dialog-model.ts`
- Test: `src/renderer/src/services/projects/tests/new-project-dialog-model.test.ts` (extend)

**Interfaces:**
- Consumes: `BaseRef`.
- Produces: `NewProjectResult.libraries?: readonly BaseRef[]`; `ProjectTypeChoice` `offersLibraries` ctor param + `OffersLibraries` accessor; `class LibraryChoice extends Model` (`Ref`, `Label`, `IsSelected`); `NewProjectDialogModel` ctor 6th param `libraries: readonly BaseRef[] = []`, `Libraries`, `ShowLibrariesPicker`, `SelectedLibraries` getter; `confirm()` includes `libraries`.

- [ ] **Step 1: Extend the test** — append to `tests/new-project-dialog-model.test.ts` (the `build`/`stubFs`/`flush` helpers + `META_REFS` already exist from SP2):

```ts
// ── libraries multi-select (architecture projects) ──

import type { BaseRef } from '../base-binding.js'   // already imported at top in SP2 — do NOT duplicate

const LIB_REFS: readonly BaseRef[] = [{ id: 'microsoft', version: '0.1.0' }, { id: 'aws', version: '2' }]

// An architecture-like choice: requires a meta-model AND offers libraries.
function archChoices(): ProjectTypeChoice[]
{
    return [
        new ProjectTypeChoice('diagram', 'Diagram Project', 'A plain diagram.'),
        new ProjectTypeChoice('architecture', 'Architecture Project', 'An instance model.', true, true),
    ]
}

function buildArch(metaModels: readonly BaseRef[] = META_REFS, libraries: readonly BaseRef[] = LIB_REFS)
{
    let result: NewProjectResult | undefined | 'uncalled' = 'uncalled'
    const vm = new NewProjectDialogModel(
        archChoices(),
        stubFs('/picked'),
        () => Promise.resolve(null),
        (r) => { result = r },
        metaModels,
        libraries,
    )
    return { vm, closed: () => result }
}

test('selecting an offersLibraries type shows the libraries picker; a plain type hides it', () => {
    const { vm } = buildArch()
    expect(vm.ShowLibrariesPicker).toBe(false)               // diagram selected by default
    vm.Types.ToArray()[1].SelectCommand!.Execute(undefined)  // architecture
    expect(vm.ShowLibrariesPicker).toBe(true)
    expect(vm.Libraries.ToArray().map((l) => l.Label)).toEqual(['microsoft @ 0.1.0', 'aws @ 2'])
    vm.Types.ToArray()[0].SelectCommand!.Execute(undefined)  // back to diagram
    expect(vm.ShowLibrariesPicker).toBe(false)
})

test('checked libraries flow into confirm().libraries; meta-model still required', async () => {
    const { vm, closed } = buildArch()
    vm.Types.ToArray()[1].SelectCommand!.Execute(undefined)  // architecture
    vm.Name = 'Acme'
    vm.Location = '/work/acme'
    expect(vm.CanConfirm).toBe(false)                        // meta-model not chosen yet
    vm.SelectedMetaModel = vm.MetaModels.ToArray()[0]
    vm.Libraries.ToArray()[0].IsSelected = true              // check "microsoft"
    expect(vm.CanConfirm).toBe(true)
    vm.ConfirmCommand.Execute(undefined)
    await flush()
    expect(closed()).toEqual({
        type: 'architecture', name: 'Acme', location: '/work/acme',
        metaModel: { id: 'ea', version: '5' },
        libraries: [{ id: 'microsoft', version: '0.1.0' }],
    })
})

test('confirming an architecture with zero libraries yields an empty libraries array', async () => {
    const { vm, closed } = buildArch()
    vm.Types.ToArray()[1].SelectCommand!.Execute(undefined)  // architecture
    vm.Name = 'Acme'
    vm.Location = '/work/acme'
    vm.SelectedMetaModel = vm.MetaModels.ToArray()[0]
    vm.ConfirmCommand.Execute(undefined)
    await flush()
    expect((closed() as NewProjectResult).libraries).toEqual([])
})

test('a non-offering type omits libraries from the result', async () => {
    const { vm, closed } = buildArch()
    vm.Name = 'Plain'                                        // diagram selected by default
    vm.Location = '/work/plain'
    vm.ConfirmCommand.Execute(undefined)
    await flush()
    expect('libraries' in (closed() as NewProjectResult)).toBe(false)
})
```

Note: `import type { BaseRef }` is already present at the top of the test from SP2 — reuse it; do not add a second import. Place the `LIB_REFS`/helpers/tests after the existing meta-model tests.

- [ ] **Step 2: Run — fail** (`npx vitest run src/renderer/src/services/projects/tests/new-project-dialog-model.test.ts`). Expected: `NewProjectDialogModel` takes 5 args / `ShowLibrariesPicker` undefined.

- [ ] **Step 3: `NewProjectResult` gains `libraries`** — in `new-project-dialog-model.ts`:

```ts
export interface NewProjectResult
{
    type:      string
    name:      string
    location:  string
    // The meta-model the project is authored against — present only for a type
    // that RequiresMetaModel (a library or an architecture).
    metaModel?: BaseRef
    // The libraries an architecture draws on — present (possibly empty) only for a
    // type that OffersLibraries.
    libraries?: readonly BaseRef[]
}
```

- [ ] **Step 4: `ProjectTypeChoice` gains `OffersLibraries`** — add the DP + ctor param + accessor (mirror `RequiresMetaModel`):

```ts
    static readonly OffersLibrariesKey = Model.RegisterProperty<boolean>(
        ProjectTypeChoice, 'OffersLibraries', false, MetaData.None)
```

Constructor:

```ts
    constructor(type: string, title: string, description: string, requiresMetaModel = false, offersLibraries = false)
    {
        super()
        this.set_property_value(ProjectTypeChoice.TypeKey, type)
        this.set_property_value(ProjectTypeChoice.TitleKey, title)
        this.set_property_value(ProjectTypeChoice.DescriptionKey, description)
        this.set_property_value(ProjectTypeChoice.RequiresMetaModelKey, requiresMetaModel)
        this.set_property_value(ProjectTypeChoice.OffersLibrariesKey, offersLibraries)
    }
```

Accessor (beside `RequiresMetaModel`):

```ts
    public get OffersLibraries(): boolean { return this.get_property_value(ProjectTypeChoice.OffersLibrariesKey) }
    public set OffersLibraries(v: boolean) { this.set_property_value(ProjectTypeChoice.OffersLibrariesKey, v) }
```

- [ ] **Step 5: Add `LibraryChoice`** — beneath `MetaModelChoice` in the same file:

```ts
// One selectable library in the architecture picker: a published BaseRef, a
// human `id @ version` label, and a two-way IsSelected the Switch row binds.
export class LibraryChoice extends Model
{
    static readonly LabelKey = Model.RegisterProperty<string>(LibraryChoice, 'Label', '', MetaData.None)
    static readonly IsSelectedKey = Model.RegisterProperty<boolean>(LibraryChoice, 'IsSelected', false, MetaData.None)

    constructor(public readonly Ref: BaseRef)
    {
        super()
        this.set_property_value(LibraryChoice.LabelKey, `${Ref.id} @ ${Ref.version}`)
    }

    public get Label(): string { return this.get_property_value(LibraryChoice.LabelKey) }
    public get IsSelected(): boolean { return this.get_property_value(LibraryChoice.IsSelectedKey) }
    public set IsSelected(v: boolean) { this.set_property_value(LibraryChoice.IsSelectedKey, v) }
    public toString(): string { return this.Label }
}
```

- [ ] **Step 6: `NewProjectDialogModel` picker state** — add DPs beside the meta-model ones:

```ts
    static readonly LibrariesKey = Model.RegisterProperty<ObservableCollection<LibraryChoice>>(
        NewProjectDialogModel, 'Libraries', undefined as unknown as ObservableCollection<LibraryChoice>, MetaData.None)
    static readonly ShowLibrariesPickerKey = Model.RegisterProperty<boolean>(
        NewProjectDialogModel, 'ShowLibrariesPicker', false, MetaData.None)
```

Constructor: add the 6th param + build the collection (place after the `metaModels` handling):

```ts
    constructor(
        choices: readonly ProjectTypeChoice[],
        private readonly fs: FileSystemService,
        private readonly validate: (result: NewProjectResult) => Promise<string | null>,
        private readonly close: (result?: NewProjectResult) => void,
        metaModels: readonly BaseRef[] = [],
        // The published libraries offered when an OffersLibraries type is chosen.
        libraries: readonly BaseRef[] = [],
    )
    {
        // ... existing body through the MetaModels build ...
        const libs = new ObservableCollection<LibraryChoice>()
        for (const ref of libraries) libs.Add(new LibraryChoice(ref))
        this.set_property_value(NewProjectDialogModel.LibrariesKey, libs)
        // ... existing command wiring + listeners + `if (choices.length > 0) this.select(choices[0])` ...
    }
```

Accessors (beside the meta-model ones):

```ts
    public get Libraries(): ObservableCollection<LibraryChoice> { return this.get_property_value(NewProjectDialogModel.LibrariesKey) }
    public get ShowLibrariesPicker(): boolean { return this.get_property_value(NewProjectDialogModel.ShowLibrariesPickerKey) }
    // The BaseRefs of the currently-checked libraries (empty when none checked).
    public get SelectedLibraries(): readonly BaseRef[]
    {
        return this.Libraries.ToArray().filter((l) => l.IsSelected).map((l) => l.Ref)
    }
```

- [ ] **Step 7: Toggle the picker in `select`** — add a line after the `ShowMetaModelPicker` set (do not otherwise change `select`):

```ts
        this.set_property_value(NewProjectDialogModel.ShowLibrariesPickerKey, choice.OffersLibraries)
```

- [ ] **Step 8: Include `libraries` in `confirm`** — extend the result literal (libraries are optional, so `CanConfirm`/`recompute` are untouched):

```ts
        const result: NewProjectResult = {
            type: this.SelectedType.Type,
            name: this.Name.trim(),
            location: this.Location,
            ...(this.ShowMetaModelPicker && this.SelectedMetaModel !== undefined
                ? { metaModel: this.SelectedMetaModel.Ref }
                : {}),
            ...(this.ShowLibrariesPicker ? { libraries: this.SelectedLibraries } : {}),
        }
```

- [ ] **Step 9: Run — pass.** `npx vitest run src/renderer/src/services/projects/tests/new-project-dialog-model.test.ts` → all (SP2 + 4 new) pass. Typecheck clean.

- [ ] **Step 10: Commit** (dialog model + its test; NOT `ontologies-service.ts`):

```bash
git add src/renderer/src/services/projects/new-project-dialog-model.ts \
        src/renderer/src/services/projects/tests/new-project-dialog-model.test.ts
git commit -m "feat(project-explorer): New-Project libraries multi-select for architecture projects

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Explorer enumeration + forwarding + libraries checklist template

**Files:**
- Modify: `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts`
- Modify: `src/renderer/src/modules/project-explorer/project-explorer.resources.mu` (+ regenerate `.mu.js`)

**Interfaces:**
- Consumes: `ensureLibrariesBackend` (`modules/library/services/libraries-backend.js`); `LibraryChoice` (dialog model); `BaseRef`.
- Produces: `publishedLibraries()`; `typeChoices()` sets `OffersLibraries`; `createProjectAt(type, name, folder, metaModel?, libraries?)`.

- [ ] **Step 1: Import the libraries backend** — beside the `ensureMetaModelsBackend` import in `project-explorer-service.ts`:

```ts
import { ensureMetaModelsBackend } from '../../meta-model/services/meta-models-backend.js'
import { ensureLibrariesBackend } from '../../library/services/libraries-backend.js'
```

- [ ] **Step 2: `typeChoices()` sets `OffersLibraries`** — pass the flag as the 5th `ProjectTypeChoice` arg:

```ts
    private typeChoices(): ProjectTypeChoice[]
    {
        return this.Provider.getRequired(ProjectFactoryRegistry.Key)
            .Definitions.ToArray()
            .map((d) => {
                const factory = this.resolveFactory(d.Type)
                return new ProjectTypeChoice(
                    d.Type, d.Title, d.Description,
                    factory?.requiresMetaModel ?? false,
                    factory?.offersLibraries ?? false)
            })
    }
```

- [ ] **Step 3: Add `publishedLibraries()`** — beside `publishedMetaModels()` (identical shape, libraries backend):

```ts
    // Enumerate every published library in the backend as a BaseRef
    // (`<id>/<version>/`), offered by the New-Project libraries multi-select.
    private async publishedLibraries(): Promise<BaseRef[]>
    {
        const backend = ensureLibrariesBackend(this.Provider)
        const refs: BaseRef[] = []
        for (const id of await backend.List('')) {
            if (!id.IsDirectory) continue
            for (const version of await backend.List(id.Name)) {
                if (version.IsDirectory) refs.push({ id: id.Name, version: version.Name })
            }
        }
        return refs
    }
```

- [ ] **Step 4: Pass libraries to the dialog + forward the result** — in `newProject()`:

```ts
        const vm = new NewProjectDialogModel(
            choices,
            this.fs,
            (r) => this.validateNewProject(r),
            (r) => this.dialogs.Close(r),
            await this.publishedMetaModels(),
            await this.publishedLibraries(),
        )
        const result = (await this.dialogs.Show({ Title: 'New Project', Content: vm, Width: 520 })) as NewProjectResult | undefined
        if (result === undefined) return
        await this.createProjectAt(result.type, result.name, result.location, result.metaModel, result.libraries)
```

- [ ] **Step 5: `createProjectAt` forwards both bindings:**

```ts
    // Create a project of `type` named `name` in `folder`, add + record it.
    // `metaModel` / `libraries` are the base bindings chosen in the dialog.
    private async createProjectAt(
        type: string, name: string, folder: string,
        metaModel?: BaseRef, libraries?: readonly BaseRef[]): Promise<void>
    {
        const factory = this.resolveFactory(type)
        if (factory === undefined) { this.Status = `No factory for project type "${type}".`; return }

        const storage = this.storageRegistry.Create(StorageProviderRegistry.DefaultBackendId, folder)
        try {
            const bindings = (metaModel !== undefined || (libraries !== undefined && libraries.length > 0))
                ? { metaModel, libraries }
                : undefined
            const project = await factory.createProject(storage, name, bindings)
            const op = await this.addOpenProject(project, factory, storage)
            await this.recents.Add({ name: op.Name, path: folder, type, openedAt: Date.now() })
            this.Status = `Created ${op.Name}.`
        } catch (e) {
            this.Status = `Create failed: ${(e as Error).message}`
        }
    }
```

(Note: the `import { LibraryChoice }` is only needed by the template's `.mu.js`, not the service; the service references no new dialog type beyond `BaseRef`, already imported in SP2.)

- [ ] **Step 6: Add the libraries checklist template** — in `project-explorer.resources.mu`, import `LibraryChoice` and add its `DataTemplate`, then insert the checklist below the meta-model combo.

Import (beside the existing `NewProjectDialogModel` import at the top):

```
import LibraryChoice from "../../services/projects/new-project-dialog-model.js"
```

A `DataTemplate` for a library row (place near the `NewProjectDialogModel` template, before it):

```
    DataTemplate [ DataType = LibraryChoice ] {
        DockPanel [ LastChildFill = true, Margin = (0,2,0,2) ] {
            Switch [ DockPanel.Dock = Left, IsChecked = $IsSelected, Margin = (0,0,8,0) ]
            TextBlock [ Text = $Label, Style = @BodyMedium, Foreground = @OnSurface, VerticalAlignment = Center ]
        }
    }
```

Checklist block — insert immediately after the meta-model `Border` (the one gated on `$ShowMetaModelPicker`), before the `Error` TextBlock:

```
            // Libraries picker — shown only for a project type that offers
            // libraries (architecture). A checklist of published libraries; each
            // row's Switch two-ways LibraryChoice.IsSelected. Zero selected is valid.
            Border [ Visibility = $ShowLibrariesPicker << ToVisibility, Margin = (0,4,0,8) ] {
                StackPanel [ Orientation = Vertical ] {
                    TextBlock [ Style = @BodyLarge, Text = "Libraries", Foreground = @OnSurface ]
                    ItemsControl [ ItemsSource = $Libraries, ItemsPanel = @VerticalStackPanel, Margin = (0,4,0,0) ]
                }
            }
```

- [ ] **Step 7: compile:mu** — `npm run compile:mu` (no new files; regenerates `project-explorer.resources.mu.js` + `app.mu.js`). Confirm exit 0.

- [ ] **Step 8: typecheck + full test** — `npm run typecheck && npm test`. All green (SP2 + SP4 counts). If the `LibraryChoice` symbol fails to resolve in the `.mu` compile, verify the import path/name matches the class export (`export class LibraryChoice`).

- [ ] **Step 9: Commit** (service + `.mu` source only — NOT `.mu.js`, NOT `ontologies-service.ts`):

```bash
git add src/renderer/src/modules/project-explorer/services/project-explorer-service.ts \
        src/renderer/src/modules/project-explorer/project-explorer.resources.mu
git commit -m "feat(project-explorer): enumerate + bind libraries when creating an architecture project

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Finish the branch

- [ ] **Step 1: Full green gate** — from `Plexus/`: `npm run compile:mu && npm run typecheck && npm test` all pass; `git status` shows only `ontologies-service.ts` unstaged.

- [ ] **Step 2: Invoke `superpowers:finishing-a-development-branch`** — verify tests, present the 4 options, execute the user's choice (the established pattern is merge to `main` + push).

---

## Self-Review Notes

- **Spec coverage:** unit 1 → Task 1 (factory + `offersLibraries`); unit 2 → Task 1; unit 3 → Task 2 (dialog); unit 4 → Task 3 (explorer); unit 5 → Task 3 (template). Error handling reuses SP2's validator path (no task). Testing per Task 1/2; validation path already covered by SP2 tests.
- **Type consistency:** `offersLibraries` (factory/interface) ↔ `OffersLibraries` (ProjectTypeChoice DP) ↔ `ShowLibrariesPicker` (dialog); `LibraryChoice.IsSelected` ↔ template `Switch.IsChecked`; `createProject(storage, name, bindings?: BaseBindings)` matches the SP2-widened signature; `NewProjectResult.libraries?: readonly BaseRef[]` matches `SelectedLibraries` return type.
- **No placeholders:** every code step shows full code; the one runtime check (Task 3 Step 8) is a fallback instruction, not a gap.
```

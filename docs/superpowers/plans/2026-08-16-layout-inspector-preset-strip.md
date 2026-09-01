# Layout Inspector Preset Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the layout inspector's two top button rows with a strip — a saved-preset ComboBox, a Save button, a Delete button, and a Run button — backed by layout presets stored as one JSON file per preset under the Plexus user-data folder.

**Architecture:** Presets become a folder-of-files store (`LayoutPresetsStore` over `EnvironmentService` + async `FileSystemService`). `LayoutStageVM` gains `LoadSpec` to restore a strategy and its parameter values. `LayoutPipelineService` drops all preview/run-mode machinery and gains preset wiring (`PresetNames`, `SelectedPreset`, `CanDelete`, `SaveCommand`, `DeleteCommand`, `LoadPreset`). A small dialog VM (`SavePresetPromptModel` + `promptPresetName`) collects the save name. The `.mu` header becomes the strip; a new `@Play` icon is added.

**Tech Stack:** TypeScript (Plexus renderer), mural runtime/framework (`Model`/`RegisterProperty`, `RelayCommand`, `ObservableCollection`, `DialogService`, `ServiceBase`), Fresco (`PipelineConfiguration`, `LayoutStageSpec`, `CatalogStrategy`, `GetPipelineCatalog`), vitest (node env), mural `.mu` CLI (`compile:mu`).

## Global Constraints

- Renderer-only. No `@pragmatic-tech-ai/mural`, `@pragmatic-tech-ai/fresco`, or `@pragmatic-tech-ai/todl` change.
- Every test file lives in a `tests/` subfolder next to the code it exercises (e.g. `layout/tests/…`), never beside the source.
- No `node:fs`/`node:path` in the renderer: build paths with the local `join` helper (separator inferred from the directory), read/write through `FileSystemService`.
- Presets persist one `<name>.json` (a Fresco `PipelineConfiguration`) per preset in `<EnvironmentService.UserDataDirectory>/layout-presets/`.
- `safe(name)` = `name.trim()` with every character outside `[A-Za-z0-9._-]` replaced by `-`; the sanitized stem is BOTH the filename and the display name.
- Preview / run-mode is fully removed (deleted, not hidden): no `Mode`, `PreviewPositions`, `applyPreview`, `cancelPreview`, or `UsePositionsMode`/`UsePreviewMode`/`ApplyPreview`/`CancelPreview` commands. `Run()` always applies positions.
- `run-modes.ts` is unchanged — its `planForMode` positions branch (and its existing test) stay; the preview branch simply becomes unused by the service.
- Store methods degrade gracefully with no filesystem host: `names()` → `[]`, `get()` → `undefined` on any read failure (missing folder/file, parse error).
- Commit after each task with the exact message shown. Do NOT push (the user pushes explicitly).

---

### Task 1: `LayoutPresetsStore` — folder-of-files rewrite

Rewrite the presets store from a single settings-store key to one JSON file per preset under `<UserDataDirectory>/layout-presets/`, read/written through the async `FileSystemService`.

**Files:**
- Rewrite: `src/renderer/src/modules/diagram/layout/layout-presets-store.ts`
- Test: `src/renderer/src/modules/diagram/layout/tests/layout-presets-store.test.ts`

**Interfaces:**
- Consumes: `IServiceProvider` (`.getRequired(key)`); `EnvironmentService.Key` → `{ UserDataDirectory: string }`; `FileSystemService.Key` → async `ListDirectory(path): Promise<readonly { Name: string; IsDirectory: boolean }[]>`, `ReadText(path): Promise<string>`, `WriteText(path, content): Promise<void>`, `CreateDirectory(path): Promise<void>`, `Delete(path): Promise<void>`; `PipelineConfiguration` (Fresco).
- Produces:
  - `class LayoutPresetsStore` with `constructor(provider: IServiceProvider)`
  - `dir(): string`
  - `names(): Promise<string[]>` — sorted `.json` stems; `[]` on any failure
  - `get(name: string): Promise<PipelineConfiguration | undefined>` — `undefined` on missing/parse error
  - `save(name: string, cfg: PipelineConfiguration): Promise<string>` — writes `<safe(name)>.json`, returns the sanitized stem
  - `delete(name: string): Promise<void>` — tolerates absence

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/modules/diagram/layout/tests/layout-presets-store.test.ts`:

```ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { PipelineConfiguration } from '@pragmatic-tech-ai/fresco'

import { EnvironmentService } from '../../../../services/environment/environment-service.js'
import { FileSystemService } from '../../../../services/file-system/file-system-service.js'
import { LayoutPresetsStore } from '../layout-presets-store.js'

// An in-memory FileSystemService covering only the methods the store uses.
// Keys are absolute file paths; ListDirectory returns the immediate children
// of a directory path.
function fakeFs(): { fs: FileSystemService; files: Map<string, string> } {
    const files = new Map<string, string>()
    const fs = {
        CreateDirectory: (_p: string) => Promise.resolve(),
        WriteText: (p: string, c: string) => { files.set(p, c); return Promise.resolve() },
        ReadText: (p: string) => files.has(p) ? Promise.resolve(files.get(p)!) : Promise.reject(new Error('ENOENT')),
        Delete: (p: string) => { files.delete(p); return Promise.resolve() },
        ListDirectory: (dir: string) => {
            const prefix = dir.endsWith('/') ? dir : dir + '/'
            const entries = [...files.keys()]
                .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
                .map((k) => ({ Name: k.slice(prefix.length), IsDirectory: false }))
            return Promise.resolve(entries)
        },
    } as unknown as FileSystemService
    return { fs, files }
}

function storeWith(fs: FileSystemService): LayoutPresetsStore {
    const provider = new ServiceProvider()
    provider.registerInstance(FileSystemService.Key, fs)
    provider.registerInstance(EnvironmentService.Key, { UserDataDirectory: '/data' } as unknown as EnvironmentService)
    return new LayoutPresetsStore(provider)
}

const cfg = (name: string): PipelineConfiguration => ({ name, transforms: [], layout: {} })

test('save then get round-trips a preset; names lists the stem', async () => {
    const s = storeWith(fakeFs().fs)
    const stem = await s.save('Wide', cfg('Wide'))
    expect(stem).toBe('Wide')
    expect(await s.names()).toEqual(['Wide'])
    expect(await s.get('Wide')).toEqual(cfg('Wide'))
})

test('names returns the stems sorted', async () => {
    const s = storeWith(fakeFs().fs)
    await s.save('beta', cfg('beta'))
    await s.save('alpha', cfg('alpha'))
    expect(await s.names()).toEqual(['alpha', 'beta'])
})

test('names is [] when the presets folder has never been written', async () => {
    // ListDirectory of a never-created folder rejects; the store swallows it.
    const rejecting = { ListDirectory: () => Promise.reject(new Error('ENOENT')) } as unknown as FileSystemService
    expect(await storeWith(rejecting).names()).toEqual([])
})

test('get returns undefined for a missing preset', async () => {
    const s = storeWith(fakeFs().fs)
    expect(await s.get('nope')).toBeUndefined()
})

test('save sanitizes an unsafe name; the stem round-trips as the display name', async () => {
    const { fs, files } = fakeFs()
    const s = new LayoutPresetsStore((() => {
        const p = new ServiceProvider()
        p.registerInstance(FileSystemService.Key, fs)
        p.registerInstance(EnvironmentService.Key, { UserDataDirectory: '/data' } as unknown as EnvironmentService)
        return p
    })())
    const stem = await s.save('a/b c', cfg('x'))
    expect(stem).toBe('a-b-c')
    expect([...files.keys()]).toEqual(['/data/layout-presets/a-b-c.json'])
    expect(await s.names()).toEqual(['a-b-c'])
    expect(await s.get('a-b-c')).toEqual(cfg('x'))
})

test('delete removes a preset and tolerates a second delete', async () => {
    const s = storeWith(fakeFs().fs)
    await s.save('gone', cfg('gone'))
    await s.delete('gone')
    expect(await s.names()).toEqual([])
    await s.delete('gone')   // absent now — must not throw
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/diagram/layout/tests/layout-presets-store.test.ts`
Expected: FAIL — the current `LayoutPresetsStore` constructor takes no arguments and has no `dir`/`names(): Promise`/`get(): Promise`/`save(): Promise<string>` signatures (type + runtime errors).

- [ ] **Step 3: Rewrite the store**

Replace the entire contents of `src/renderer/src/modules/diagram/layout/layout-presets-store.ts`:

```ts
import { type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { PipelineConfiguration } from '@pragmatic-tech-ai/fresco'

import { EnvironmentService } from '../../../services/environment/environment-service.js'
import { FileSystemService } from '../../../services/file-system/file-system-service.js'

// Named layout-pipeline presets, one `<name>.json` file per preset under
// <UserDataDirectory>/layout-presets/. Each file is a Fresco
// PipelineConfiguration (plain JSON, no bespoke serializer). Reads degrade to
// empty/undefined so a host without a filesystem (headless tests) is safe;
// writes assume the desktop host (they run only from user commands).
const FOLDER = 'layout-presets'

export class LayoutPresetsStore
{
    public constructor(private readonly provider: IServiceProvider) {}

    private get fs(): FileSystemService { return this.provider.getRequired(FileSystemService.Key) }
    private get env(): EnvironmentService { return this.provider.getRequired(EnvironmentService.Key) }

    // <UserDataDirectory>/layout-presets
    public dir(): string
    {
        return join(this.env.UserDataDirectory, FOLDER)
    }

    // The saved preset display names (the `.json` stems), sorted. Any failure
    // — a missing folder, an absent filesystem host — yields [].
    public async names(): Promise<string[]>
    {
        try {
            const entries = await this.fs.ListDirectory(this.dir())
            return entries
                .filter((e) => !e.IsDirectory && e.Name.endsWith('.json'))
                .map((e) => e.Name.slice(0, -'.json'.length))
                .sort()
        } catch {
            return []
        }
    }

    // The preset by display name, or undefined if it is missing / unreadable /
    // not valid JSON.
    public async get(name: string): Promise<PipelineConfiguration | undefined>
    {
        try {
            return JSON.parse(await this.fs.ReadText(this.filePath(name))) as PipelineConfiguration
        } catch {
            return undefined
        }
    }

    // Write the preset as <safe(name)>.json and return the sanitized stem (the
    // display name), so the caller can select it. Overwrites silently.
    public async save(name: string, cfg: PipelineConfiguration): Promise<string>
    {
        const stem = safe(name)
        await this.fs.CreateDirectory(this.dir())
        await this.fs.WriteText(this.filePath(stem), JSON.stringify(cfg, null, 2))
        return stem
    }

    // Delete the preset file; tolerates its absence.
    public async delete(name: string): Promise<void>
    {
        try {
            await this.fs.Delete(this.filePath(safe(name)))
        } catch {
            // already gone — nothing to do
        }
    }

    private filePath(stem: string): string
    {
        return join(this.dir(), `${stem}.json`)
    }
}

// Replace every character outside [A-Za-z0-9._-] with '-' so the name is a safe
// file stem. The sanitized value is also the display name (filenames round-trip).
function safe(name: string): string
{
    return name.trim().replace(/[^A-Za-z0-9._-]/g, '-')
}

// Join a directory and a child using the directory's own separator (no
// node:path in the renderer). Mirrors open-projects-store.join.
function join(dir: string, name: string): string
{
    const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
    return dir.endsWith(sep) ? dir + name : dir + sep + name
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/diagram/layout/tests/layout-presets-store.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/diagram/layout/layout-presets-store.ts \
        src/renderer/src/modules/diagram/layout/tests/layout-presets-store.test.ts
git commit -m "feat(layout): store layout presets as one json file per preset"
```

---

### Task 2: `LayoutStageVM.LoadSpec` — restore a strategy + its param values

Add a method that drives a stage row from a saved `LayoutStageSpec`, plus the reverse-lookup map it needs.

**Files:**
- Modify: `src/renderer/src/modules/diagram/layout/layout-stage-vm.ts`
- Test: `src/renderer/src/modules/diagram/layout/tests/layout-stage-vm-load-spec.test.ts`

**Interfaces:**
- Consumes: `LayoutStageSpec` (Fresco: `{ className: string; params: Record<string, number | boolean> }`); `CatalogStrategy` (`{ name: string; className: string; parameters?: CatalogParam[] }`); the existing `Selected` setter (rebuilds params at defaults + emits), `Params: ObservableCollection<Model>`, `NumberParamVM`/`BoolParamVM` (each has `readonly Key: string` and a settable `Value`), `DEFAULT_OPTION`.
- Produces: `LoadSpec(spec: LayoutStageSpec | undefined): void`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/modules/diagram/layout/tests/layout-stage-vm-load-spec.test.ts`:

```ts
import { test, expect } from 'vitest'
import type { CatalogStrategy, LayoutStageSpec } from '@pragmatic-tech-ai/fresco'

import { LayoutStageVM, DEFAULT_OPTION } from '../layout-stage-vm.js'

// Two strategies; the first carries a number + a boolean parameter.
const STRATEGIES = [
    { name: 'Grid', className: 'GridStrategy', parameters: [
        { key: 'gap', type: 'number', default: 10 },
        { key: 'pack', type: 'boolean', default: false },
    ] },
    { name: 'Radial', className: 'RadialStrategy', parameters: [] },
] as unknown as CatalogStrategy[]

// Build a stage capturing the last spec it emitted into the config.
function stage(): { vm: LayoutStageVM; last: () => LayoutStageSpec | undefined } {
    let last: LayoutStageSpec | undefined
    const vm = new LayoutStageVM('Layer Assigner', STRATEGIES, (spec) => { last = spec })
    return { vm, last: () => last }
}

test('LoadSpec restores the strategy AND its stored parameter values', () => {
    const { vm, last } = stage()
    vm.LoadSpec({ className: 'GridStrategy', params: { gap: 42, pack: true } })
    expect(vm.Selected).toBe('Grid')
    expect(last()).toEqual({ className: 'GridStrategy', params: { gap: 42, pack: true } })
})

test('LoadSpec(undefined) selects the framework default', () => {
    const { vm, last } = stage()
    vm.Selected = 'Grid'          // move off default first
    vm.LoadSpec(undefined)
    expect(vm.Selected).toBe(DEFAULT_OPTION)
    expect(last()).toBeUndefined()
})

test('LoadSpec with an unknown className falls back to the default', () => {
    const { vm } = stage()
    vm.LoadSpec({ className: 'GhostStrategy', params: {} })
    expect(vm.Selected).toBe(DEFAULT_OPTION)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/diagram/layout/tests/layout-stage-vm-load-spec.test.ts`
Expected: FAIL — `vm.LoadSpec` is not a function.

- [ ] **Step 3: Add the reverse map and `LoadSpec`**

In `src/renderer/src/modules/diagram/layout/layout-stage-vm.ts`:

Add the import of the concrete param VMs' types is already present (`NumberParamVM, BoolParamVM`). Add a `byClassName` field next to `byName` (after line `private readonly byName = new Map<string, CatalogStrategy>()`):

```ts
    // className -> display name, the reverse of byName's key, so LoadSpec can
    // resolve a saved spec's className back to the ComboBox option.
    private readonly byClassName = new Map<string, string>()
```

In the constructor loop that fills `byName`, also fill `byClassName` (the loop `for (const s of strategies) { opts.Add(s.name); this.byName.set(s.name, s) }` becomes):

```ts
        for (const s of strategies)
        {
            opts.Add(s.name)
            this.byName.set(s.name, s)
            this.byClassName.set(s.className, s.name)
        }
```

Add the `LoadSpec` method (public, after `Reapply`):

```ts
    // Drive this stage from a saved spec: undefined (or an unknown className)
    // selects "(default)"; otherwise select the matching strategy — which
    // rebuilds its params at defaults — then overwrite each param row's Value
    // from the spec (each write re-emits the full { className, params }).
    public LoadSpec(spec: LayoutStageSpec | undefined): void
    {
        const name = spec === undefined ? undefined : this.byClassName.get(spec.className)
        if (name === undefined)
        {
            this.Selected = DEFAULT_OPTION
            return
        }
        this.Selected = name   // rebuilds param rows at defaults + emits
        const params = spec!.params ?? {}
        for (const row of this.Params.ToArray())
        {
            const key = (row as NumberParamVM | BoolParamVM).Key
            if (!(key in params)) continue
            const v = params[key]
            if (row instanceof NumberParamVM && typeof v === 'number') row.Value = v
            else if (row instanceof BoolParamVM && typeof v === 'boolean') row.Value = v
        }
    }
```

Add the `LayoutStageSpec` type to the existing Fresco import if not already present. The current import is:

```ts
import type { CatalogStrategy, CatalogParam, LayoutStageSpec } from '@pragmatic-tech-ai/fresco'
```

`LayoutStageSpec` is already imported (used by the `onChange` type) — no import change needed. Confirm `NumberParamVM`/`BoolParamVM` are imported as values (they are: `import { NumberParamVM, BoolParamVM } from './layout-param-vm.js'`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/diagram/layout/tests/layout-stage-vm-load-spec.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/diagram/layout/layout-stage-vm.ts \
        src/renderer/src/modules/diagram/layout/tests/layout-stage-vm-load-spec.test.ts
git commit -m "feat(layout): LayoutStageVM.LoadSpec restores strategy + param values"
```

---

### Task 3: Save-name prompt dialog (`SavePresetPromptModel` + `promptPresetName`)

A one-field modal that collects the preset name, modeled on `ViewpointPickerModel` / `pickViewpoints`.

**Files:**
- Create: `src/renderer/src/modules/diagram/layout/save-preset-prompt.ts`
- Test: `src/renderer/src/modules/diagram/layout/tests/save-preset-prompt.test.ts`

**Interfaces:**
- Consumes: `Model`/`RegisterProperty`/`MetaData`/`RelayCommand`/`ICommand` (mural runtime); `DialogService` (mural framework: `Show<T>({ Title, Content, Width }): Promise<T | undefined>`, `Close(result)`).
- Produces:
  - `class SavePresetPromptModel` — `Name` (two-way string), `CanConfirm` (non-empty trimmed), `ConfirmCommand`, `CancelCommand`
  - `promptPresetName(dialogs: DialogService, initial: string): Promise<string | undefined>`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/modules/diagram/layout/tests/save-preset-prompt.test.ts`:

```ts
import { describe, test } from 'vitest'
import assert from 'node:assert/strict'

import { SavePresetPromptModel } from '../save-preset-prompt.js'

// The dialog content VM: a name field + Confirm/Cancel that close with the
// typed name (or undefined). Tested directly via the `close` callback.
describe('SavePresetPromptModel', () => {

    test('starts with the initial name', () => {
        const m = new SavePresetPromptModel('Wide', () => {})
        assert.equal(m.Name, 'Wide')
        assert.equal(m.CanConfirm, true)
    })

    test('confirm closes with the trimmed name', () => {
        let closed: string | undefined = 'sentinel'
        const m = new SavePresetPromptModel('', (n) => { closed = n })
        m.Name = '  Tall  '
        m.ConfirmCommand.Execute(undefined)
        assert.equal(closed, 'Tall')
    })

    test('cancel closes with undefined', () => {
        let closed: string | undefined = 'sentinel'
        const m = new SavePresetPromptModel('x', (n) => { closed = n })
        m.CancelCommand.Execute(undefined)
        assert.equal(closed, undefined)
    })

    test('CanConfirm is false for an empty or blank name; confirm is a no-op then', () => {
        let called = false
        const m = new SavePresetPromptModel('', () => { called = true })
        assert.equal(m.CanConfirm, false)
        m.Name = '   '
        assert.equal(m.CanConfirm, false)
        m.ConfirmCommand.Execute(undefined)
        assert.equal(called, false)
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/diagram/layout/tests/save-preset-prompt.test.ts`
Expected: FAIL — module `../save-preset-prompt.js` does not exist.

- [ ] **Step 3: Write the model + helper**

Create `src/renderer/src/modules/diagram/layout/save-preset-prompt.ts`:

```ts
import {
    MetaData, Model, RelayCommand, type ICommand,
} from '@pragmatic-tech-ai/mural/runtime'
import { DialogService } from '@pragmatic-tech-ai/mural/framework'

// Content view-model for the "save layout preset" dialog. Rendered by
// DataTemplate[SavePresetPromptModel] (a name field + Cancel/Save). The host
// shows it through DialogService and awaits the typed name: ConfirmCommand
// closes with the trimmed name, CancelCommand closes with undefined (as does a
// scrim/Escape dismiss). Confirm is blocked while the name is blank (CanConfirm
// drives the button's IsEnabled).
export class SavePresetPromptModel extends Model
{
    public static readonly NameKey = Model.RegisterProperty<string>(SavePresetPromptModel, 'Name', '', MetaData.None)
    public static readonly CanConfirmKey = Model.RegisterProperty<boolean>(SavePresetPromptModel, 'CanConfirm', false, MetaData.None)
    public static readonly ConfirmCommandKey = Model.RegisterProperty<ICommand>(
        SavePresetPromptModel, 'ConfirmCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly CancelCommandKey = Model.RegisterProperty<ICommand>(
        SavePresetPromptModel, 'CancelCommand', undefined as unknown as ICommand, MetaData.None)

    public constructor(initial: string, private readonly close: (name: string | undefined) => void)
    {
        super()
        this.set_property_value(SavePresetPromptModel.NameKey, initial)
        this.set_property_value(SavePresetPromptModel.ConfirmCommandKey, new RelayCommand(() => this.confirm()))
        this.set_property_value(SavePresetPromptModel.CancelCommandKey, new RelayCommand(() => this.close(undefined)))
        this.AddPropertyChangedListener(SavePresetPromptModel.NameKey, () => this.recompute())
        this.recompute()
    }

    public get Name(): string { return this.get_property_value(SavePresetPromptModel.NameKey) }
    public set Name(v: string) { this.set_property_value(SavePresetPromptModel.NameKey, v) }
    public get CanConfirm(): boolean { return this.get_property_value(SavePresetPromptModel.CanConfirmKey) }
    public get ConfirmCommand(): ICommand { return this.get_property_value(SavePresetPromptModel.ConfirmCommandKey) }
    public get CancelCommand(): ICommand { return this.get_property_value(SavePresetPromptModel.CancelCommandKey) }

    private recompute(): void
    {
        this.set_property_value(SavePresetPromptModel.CanConfirmKey, this.Name.trim().length > 0)
    }

    private confirm(): void
    {
        const name = this.Name.trim()
        if (name.length === 0) return
        this.close(name)
    }
}

// Open the save-preset prompt as a modal dialog and resolve the typed name (or
// undefined on cancel/dismiss). `initial` pre-fills the field (the currently
// selected preset, for a quick overwrite).
export function promptPresetName(dialogs: DialogService, initial: string): Promise<string | undefined>
{
    const model = new SavePresetPromptModel(initial, (name) => dialogs.Close(name))
    return dialogs.Show<string>({ Title: 'Save layout preset', Content: model, Width: 360 })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/diagram/layout/tests/save-preset-prompt.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/diagram/layout/save-preset-prompt.ts \
        src/renderer/src/modules/diagram/layout/tests/save-preset-prompt.test.ts
git commit -m "feat(layout): SavePresetPromptModel + promptPresetName save-name dialog"
```

---

### Task 4: `LayoutPipelineService` — drop preview, wire presets

Remove all run-mode/preview machinery and add the preset strip's state and commands: `PresetNames`, `SelectedPreset` (loads on change), `CanDelete`, `SaveCommand`, `DeleteCommand`, `LoadPreset`, `refreshPresetNames`, and a `stageKeys` map.

**Files:**
- Modify: `src/renderer/src/modules/diagram/layout/layout-pipeline-service.ts`
- Test (extend): `src/renderer/src/modules/diagram/layout/tests/layout-pipeline-service.test.ts`

**Interfaces:**
- Consumes: `LayoutPresetsStore(provider)` (Task 1); `LayoutStageVM.LoadSpec` (Task 2); `promptPresetName(dialogs, initial)` (Task 3); `DialogService.Key`; `GetPipelineCatalog`, `BuildPipeline`, `LoadElementRepository`, `PipelineConfiguration`, `LayoutStageSpec` (Fresco); `planForMode` (unchanged run-modes).
- Produces (bound in the `.mu` in Task 5):
  - `Presets: LayoutPresetsStore`
  - `PresetNames: ObservableCollection<string>`
  - `SelectedPreset: string | undefined` (two-way)
  - `CanDelete: boolean`
  - `SaveCommand`, `DeleteCommand`, `RunCommand: ICommand`
  - `LoadPreset(name: string): Promise<void>`
- Removed: `Mode`, `ModeOptions`, `PreviewPositions`, `applyPreview`, `cancelPreview`, `ApplyPreviewCommand`, `CancelPreviewCommand`, `UsePositionsModeCommand`, `UsePreviewModeCommand` (and their `*Key` registrations + getters).

- [ ] **Step 1: Write the failing test**

Append to `src/renderer/src/modules/diagram/layout/tests/layout-pipeline-service.test.ts` (add imports at the top, tests at the bottom).

Add to the imports block at the top of the file:

```ts
import { GetPipelineCatalog, type PipelineConfiguration } from '@pragmatic-tech-ai/fresco'
import { EnvironmentService } from '../../../../services/environment/environment-service.js'
import { FileSystemService } from '../../../../services/file-system/file-system-service.js'
```

Add this helper below `providerWithActive` (it augments the same provider with a filesystem host holding a pre-written preset):

```ts
// A provider with an in-memory filesystem host seeded with `presets`
// (name -> config), plus the active-document host, so LoadPreset / SelectedPreset
// can read real preset files.
function providerWithPresets(doc: IDocument | undefined, presets: Record<string, PipelineConfiguration>): ServiceProvider {
    const provider = providerWithActive(doc)
    const files = new Map<string, string>()
    for (const [name, cfg] of Object.entries(presets)) files.set(`/data/layout-presets/${name}.json`, JSON.stringify(cfg))
    const fs = {
        CreateDirectory: () => Promise.resolve(),
        WriteText: (p: string, c: string) => { files.set(p, c); return Promise.resolve() },
        ReadText: (p: string) => files.has(p) ? Promise.resolve(files.get(p)!) : Promise.reject(new Error('ENOENT')),
        Delete: (p: string) => { files.delete(p); return Promise.resolve() },
        ListDirectory: (dir: string) => {
            const prefix = dir.endsWith('/') ? dir : dir + '/'
            return Promise.resolve([...files.keys()]
                .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
                .map((k) => ({ Name: k.slice(prefix.length), IsDirectory: false })))
        },
    } as unknown as FileSystemService
    provider.registerInstance(FileSystemService.Key, fs)
    provider.registerInstance(EnvironmentService.Key, { UserDataDirectory: '/data' } as unknown as EnvironmentService)
    return provider
}

// The catalog's first real strategy for a given slot — used to build a preset
// whose className the stage VM can resolve.
function firstStrategy(slotId: string): { name: string; className: string } {
    const slot = GetPipelineCatalog().find((s) => s.slotId === slotId && s.kind === 'strategy-slot')!
    const strat = (slot as unknown as { strategies: { name: string; className: string }[] }).strategies[0]
    return { name: strat.name, className: strat.className }
}
```

Add the tests:

```ts
test('LoadPreset clones the preset into Config and restores the matching stage', async () => {
    const strat = firstStrategy('layer-assigner')
    const preset: PipelineConfiguration = {
        name: 'p1', transforms: ['MakeAcyclicTransform'],
        layout: { layerAssigner: { className: strat.className, params: {} } },
    }
    const svc = new LayoutPipelineService(providerWithPresets(undefined, { p1: preset }))

    await svc.LoadPreset('p1')

    expect(svc.Config.name).toBe('p1')
    expect(svc.Config).not.toBe(preset)   // a clone, not the same reference
    const stage = svc.Stages.ToArray().find((s) => s.Label === 'Layer Assigner')!
    expect(stage.Selected).toBe(strat.name)
})

test('LoadPreset of an unknown name leaves Config unchanged', async () => {
    const svc = new LayoutPipelineService(providerWithPresets(undefined, {}))
    const before = svc.Config
    await svc.LoadPreset('missing')
    expect(svc.Config).toBe(before)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/diagram/layout/tests/layout-pipeline-service.test.ts`
Expected: FAIL — `svc.LoadPreset` is not a function.

- [ ] **Step 3: Rewrite the service**

Replace the whole file `src/renderer/src/modules/diagram/layout/layout-pipeline-service.ts` with the version below. (It keeps the pipeline/adapter logic verbatim; it removes preview/mode members and adds preset members.)

```ts
import {
    MetaData,
    Model,
    ObservableCollection,
    RelayCommand,
    ServiceBase,
    ServiceKey,
    type ICommand,
    type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'
import { Connector, ContentHostService, DialogService, DiagramDocument, type DocumentsContentHostService } from '@pragmatic-tech-ai/mural/framework'
import {
    GetPipelineCatalog,
    BuildPipeline,
    LoadElementRepository,
    type PipelineConfiguration,
    type CatalogSlot,
    type EdgeRouting,
    type Edge,
    type LayoutStageSpec,
} from '@pragmatic-tech-ai/fresco'

import {
    extract,
    computeOutcome,
    applySides,
    nodeSize,
    type FigureLike,
    type ConnectorLike,
    type ConnectorEdge,
    type EdgeSideLike,
    type NodeSize,
    type PositionSet,
    type SizedLike,
} from './diagram-graph-adapter.js'
import { planForMode } from './run-modes.js'
import { LayoutPresetsStore } from './layout-presets-store.js'
import { promptPresetName } from './save-preset-prompt.js'
import { LayoutInspector } from './layout-inspector.js'
import { LayoutStageVM } from './layout-stage-vm.js'

// Maps a catalog strategy-slot id to its PipelineConfiguration.layout field.
// graph-transforms is intentionally absent — it is a transform list, not a
// single-select stage.
const SLOT_CONFIG_KEY: Record<string, string> = {
    'layer-assigner':      'layerAssigner',
    'layer-improver':      'layerImprover',
    'first-layer-orderer': 'firstLayerOrderer',
    'dummy-inserter':      'dummyInserter',
    'reorderer':           'reorderer',
    'improver':            'improver',
    'position-computer':   'positionComputer',
    'vertical-aligner':    'verticalAligner',
    'edge-router':         'edgeRouter',
    'port-assigner':       'portAssigner',
}

// 'layer-assigner' -> 'Layer Assigner'
function stageLabel(slotId: string): string
{
    return slotId.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

// Fresco's edge router that emits cardinal sides for the host diagram to
// route natively (rather than Fresco polyline points). When it's the
// selected edge router, the diagram owns port assignment, so the Port
// Assigner stage is disabled and turned off in the config.
const CARDINAL_SIDE_ROUTER = 'CardinalSideRouter'

// Fallback node size when a figure has not been measured yet (RenderSize 0).
const FALLBACK_SIZE: NodeSize = { width: 80, height: 40 }

// MakeAcyclic runs first so a cyclic diagram (feedback / bidirectional
// architecture relationships) is broken into a DAG before the longest-path
// layer assigner — which refuses cyclic input ('longest-path depths require a
// DAG') — ever sees it. It reverses the minimal feedback-arc set; on an
// already-acyclic graph it is a no-op.
const DEFAULT_CONFIG: PipelineConfiguration = { name: 'default', transforms: ['MakeAcyclicTransform'], layout: {} }

// LayoutPipelineService — composes a Fresco layout pipeline and runs it on
// the active diagram. Holds the current PipelineConfiguration, exposes the
// catalog-derived stage rows for the builder UI, manages named presets, and
// applies the computed positions via the pure adapter.
//
// The pure work (extract / computeOutcome / planForMode) lives in unit-tested
// modules; this service is the mural-framework seam that reaches the active
// document and writes positions back.
export class LayoutPipelineService extends ServiceBase
{
    public static readonly Key = new ServiceKey<LayoutPipelineService>('LayoutPipelineService')

    // Every member bound from the .mu template MUST be a registered property:
    // mural's binding engine reads a path on a Model only via a registered
    // PropertyKey (get_property_value) — it does NOT fall back to plain fields.
    public static readonly StatusKey = Model.RegisterProperty<string>(
        LayoutPipelineService, 'Status', '', MetaData.None)
    public static readonly StagesKey = Model.RegisterProperty<ObservableCollection<LayoutStageVM>>(
        LayoutPipelineService, 'Stages', undefined as unknown as ObservableCollection<LayoutStageVM>, MetaData.None)
    public static readonly InspectorKey = Model.RegisterProperty<LayoutInspector>(
        LayoutPipelineService, 'Inspector', undefined as unknown as LayoutInspector, MetaData.None)
    public static readonly PresetNamesKey = Model.RegisterProperty<ObservableCollection<string>>(
        LayoutPipelineService, 'PresetNames', undefined as unknown as ObservableCollection<string>, MetaData.None)
    public static readonly SelectedPresetKey = Model.RegisterProperty<string | undefined>(
        LayoutPipelineService, 'SelectedPreset', undefined, MetaData.None)
    public static readonly CanDeleteKey = Model.RegisterProperty<boolean>(
        LayoutPipelineService, 'CanDelete', false, MetaData.None)
    public static readonly RunCommandKey = Model.RegisterProperty<ICommand>(
        LayoutPipelineService, 'RunCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly SaveCommandKey = Model.RegisterProperty<ICommand>(
        LayoutPipelineService, 'SaveCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly DeleteCommandKey = Model.RegisterProperty<ICommand>(
        LayoutPipelineService, 'DeleteCommand', undefined as unknown as ICommand, MetaData.None)

    // Plain fields — used only from TS (not bound in markup).
    public readonly Catalog: CatalogSlot[] = GetPipelineCatalog()
    public Config: PipelineConfiguration = structuredClone(DEFAULT_CONFIG)

    // stage -> its PipelineConfiguration.layout key, for LoadPreset.
    private readonly stageKeys = new Map<LayoutStageVM, string>()
    private _presets: LayoutPresetsStore | undefined

    constructor(provider: IServiceProvider)
    {
        super(provider)

        // The inspector panel host added to the shell's Inspector region.
        this.set_property_value(LayoutPipelineService.InspectorKey, new LayoutInspector())

        // One ComboBox row per configurable strategy slot (the transform-list
        // slot is excluded). Selecting a strategy writes its className into
        // Config.layout; "(default)" clears it (framework default applies).
        const stages = new ObservableCollection<LayoutStageVM>()
        // Captured so selecting the native side router (CardinalSideRouter)
        // in the Edge Router can disable + turn off the Port Assigner stage
        // — under native routing the diagram assigns ports itself.
        let portAssignerStage: LayoutStageVM | undefined
        for (const slot of this.Catalog)
        {
            if (slot.kind !== 'strategy-slot') continue
            const key = SLOT_CONFIG_KEY[slot.slotId]
            if (key === undefined) continue

            const isEdgeRouter = slot.slotId === 'edge-router'

            const stage = new LayoutStageVM(stageLabel(slot.slotId), slot.strategies, (spec) => {
                const layout = this.Config.layout as Record<string, unknown>
                if (spec === undefined) delete layout[key]
                else layout[key] = spec

                if (isEdgeRouter && portAssignerStage !== undefined) {
                    if (spec?.className === CARDINAL_SIDE_ROUTER) {
                        // Native routing owns port assignment: skip Fresco's
                        // port assigner and disable its combobox.
                        layout.portAssigner = { off: true }
                        portAssignerStage.Enabled = false
                    } else {
                        // Re-enable and restore the port assigner from its
                        // own current selection.
                        portAssignerStage.Enabled = true
                        portAssignerStage.Reapply()
                    }
                }
            })
            stages.Add(stage)
            this.stageKeys.set(stage, key)
            if (slot.slotId === 'port-assigner') portAssignerStage = stage
        }
        this.set_property_value(LayoutPipelineService.StagesKey, stages)
        this.set_property_value(LayoutPipelineService.PresetNamesKey, new ObservableCollection<string>())

        this.set_property_value(LayoutPipelineService.RunCommandKey, new RelayCommand(() => this.Run()))
        this.set_property_value(LayoutPipelineService.SaveCommandKey, new RelayCommand(() => { void this.save() }))
        this.set_property_value(LayoutPipelineService.DeleteCommandKey, new RelayCommand(() => { void this.deleteSelected() }))

        // Selecting a preset loads it; whatever is selected also drives whether
        // Delete is enabled.
        this.AddPropertyChangedListener(LayoutPipelineService.SelectedPresetKey, () => {
            const name = this.SelectedPreset
            const has = name !== undefined && name.length > 0
            this.set_property_value(LayoutPipelineService.CanDeleteKey, has)
            if (has) void this.LoadPreset(name!)
        })

        void this.refreshPresetNames()
    }

    public get Status(): string { return this.get_property_value(LayoutPipelineService.StatusKey) }
    private set Status(v: string) { this.set_property_value(LayoutPipelineService.StatusKey, v) }

    public get Stages(): ObservableCollection<LayoutStageVM> { return this.get_property_value(LayoutPipelineService.StagesKey) }
    public get Inspector(): LayoutInspector { return this.get_property_value(LayoutPipelineService.InspectorKey) }
    public get PresetNames(): ObservableCollection<string> { return this.get_property_value(LayoutPipelineService.PresetNamesKey) }
    public get SelectedPreset(): string | undefined { return this.get_property_value(LayoutPipelineService.SelectedPresetKey) }
    public set SelectedPreset(v: string | undefined) { this.set_property_value(LayoutPipelineService.SelectedPresetKey, v) }
    public get CanDelete(): boolean { return this.get_property_value(LayoutPipelineService.CanDeleteKey) }
    public get RunCommand(): ICommand { return this.get_property_value(LayoutPipelineService.RunCommandKey) }
    public get SaveCommand(): ICommand { return this.get_property_value(LayoutPipelineService.SaveCommandKey) }
    public get DeleteCommand(): ICommand { return this.get_property_value(LayoutPipelineService.DeleteCommandKey) }

    // Lazily created so a non-desktop context (should not happen in the
    // renderer) doesn't fail at construction just because presets are unused.
    public get Presets(): LayoutPresetsStore
    {
        return (this._presets ??= new LayoutPresetsStore(this.Provider))
    }

    // Reload PresetNames from the store (ctor + after save/delete).
    private async refreshPresetNames(): Promise<void>
    {
        const names = await this.Presets.names()
        const coll = this.PresetNames
        coll.Clear()
        for (const n of names) coll.Add(n)
    }

    // Load a preset into the current settings: clone it into Config, then drive
    // each stage from its layout entry. Stages load in insertion order (= Stages
    // order), so the Edge Router's native-routing choice disables the Port
    // Assigner before we reach it; a disabled Port Assigner is skipped so its
    // { off: true } directive (set by the Edge Router) survives.
    public async LoadPreset(name: string): Promise<void>
    {
        const cfg = await this.Presets.get(name)
        if (cfg === undefined) return
        this.Config = structuredClone(cfg)
        const layout = this.Config.layout as Record<string, LayoutStageSpec | undefined>
        for (const [stage, key] of this.stageKeys) {
            if (!stage.Enabled) continue
            stage.LoadSpec(layout[key])
        }
    }

    // Prompt for a name and save the current Config as that preset, then select
    // it. A no-op when there is no DialogService (headless) or the user cancels.
    private async save(): Promise<void>
    {
        const dialogs = this.Provider.get(DialogService.Key)
        if (dialogs === undefined) return
        const name = await promptPresetName(dialogs, this.SelectedPreset ?? '')
        if (name === undefined) return
        const stem = await this.Presets.save(name, this.Config)
        await this.refreshPresetNames()
        this.SelectedPreset = stem
    }

    // Delete the selected preset and clear the selection; the working Config /
    // Stages are left as-is (deleting the saved copy does not reset the editor).
    private async deleteSelected(): Promise<void>
    {
        const name = this.SelectedPreset
        if (name === undefined || name.length === 0) return
        await this.Presets.delete(name)
        await this.refreshPresetNames()
        this.SelectedPreset = undefined
    }

    // Compose the pipeline from Config and run it on the active diagram,
    // writing the new positions to the figures.
    public Run(): void
    {
        const doc = this.activeDiagram()
        if (doc === undefined) { this.Status = 'Active document is not a diagram.'; return }

        // Figures (not Groups) carry Left/Top; treat those as the node set.
        const figures = (doc.Nodes.ToArray() as unknown as FigureLike[]).filter(
            (n) => typeof n.Left === 'number' && typeof n.Top === 'number',
        )
        if (figures.length === 0) { this.Status = 'Diagram has no nodes to lay out.'; return }
        const connectors = doc.Connectors.ToArray() as unknown as ConnectorLike[]

        const { graph, index, connectorEdges } = extract(figures, connectors)

        let outcome
        let lastRoutes: Map<Edge, EdgeRouting> | undefined
        try {
            const { graphPipeline, layoutPipeline } = BuildPipeline(this.Config, LoadElementRepository())
            const transformed = graphPipeline.Apply(graph)
            const positions = layoutPipeline.Apply(transformed)
            outcome = computeOutcome(index, transformed, positions, (f) => this.sizeOf(f))
            lastRoutes = layoutPipeline.LastRoutes
        } catch (err) {
            this.Status = `Pipeline error: ${(err as Error).message}`
            return
        }

        const plan = planForMode('positions', outcome)
        this.applyPositions(index, plan.mutation.setPositions)
        this.clearConnectorWaypoints(doc)   // layout is the reset: drop user pins, rebuild routing

        let status = `Laid out ${plan.mutation.setPositions.length} nodes.`
        const n = this.applyDiagramSides(connectorEdges, lastRoutes)
        if (n > 0) status += ` Assigned sides to ${n} connectors.`
        this.Status = status
    }

    // Apply any `sides` routing directives the edge router produced onto the
    // connectors, keyed by node-id pair so parallel connectors share a side
    // (the diagram fans them into slots). A point-based router yields no
    // `sides` entries, so this is a no-op unless the native side router ran.
    // Returns the count of connectors assigned.
    private applyDiagramSides(
        connectorEdges: ConnectorEdge[],
        lastRoutes: Map<Edge, EdgeRouting> | undefined,
    ): number
    {
        if (lastRoutes === undefined) return 0
        const byPair = new Map<string, EdgeSideLike>()
        for (const [edge, routing] of lastRoutes) {
            if (routing.kind === 'sides') {
                byPair.set(`${edge.From}|${edge.To}`, { source: routing.source, target: routing.target })
            }
        }
        if (byPair.size === 0) return 0
        return applySides(connectorEdges, byPair)
    }

    // Layout is the single "reset to auto" operation: drop every connector's
    // waypoints (user pins included) so the route rebuilds from scratch. Without
    // this, moving nodes preserves pins (mural's per-move behaviour), leaving a
    // stale hand-route distorting the freshly laid-out diagram.
    private clearConnectorWaypoints(doc: DiagramDocument): void
    {
        for (const c of doc.Connectors.ToArray()) {
            if (c instanceof Connector) c.Waypoints = undefined
        }
    }

    private applyPositions(index: Map<string, FigureLike>, sets: PositionSet[]): void
    {
        for (const s of sets) {
            const fig = index.get(s.id)
            if (fig === undefined) continue
            fig.Left = s.left
            fig.Top = s.top
        }
    }

    // The active tab's document when it's a diagram. In the multi-document
    // shell each diagram (architecture or standalone) opens as its OWN
    // DiagramDocument via the content host; layout must run on whichever is
    // active, not the fixed workspace singleton — same ActiveDocument source
    // the arch binding / viewpoint-scope services read.
    private activeDiagram(): DiagramDocument | undefined
    {
        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        const doc = host?.ActiveDocument
        return doc instanceof DiagramDocument ? doc : undefined
    }

    // Node footprint: VM nodes (Model) expose Width/Height but no RenderSize;
    // Figures expose both. nodeSize prefers Width/Height so VMs don't collapse
    // to the fallback size. See diagram-graph-adapter.nodeSize.
    private sizeOf(fig: FigureLike): NodeSize
    {
        return nodeSize(fig as unknown as SizedLike, FALLBACK_SIZE)
    }
}
```

- [ ] **Step 4: Run the extended service tests to verify they pass**

Run: `npx vitest run src/renderer/src/modules/diagram/layout/tests/layout-pipeline-service.test.ts`
Expected: PASS — the 4 pre-existing `Run` tests (unchanged behavior) plus the 2 new `LoadPreset` tests.

- [ ] **Step 5: Run the whole layout suite + web typecheck**

Run: `npx vitest run src/renderer/src/modules/diagram/layout` and `npm run typecheck:web`
Expected: all green. `typecheck:web` must be clean — the removed `Mode`/`applyPreview`/etc. are no longer referenced anywhere in `.ts` (the `.mu`-referenced commands are updated in Task 5, but `.mu` files are not typechecked by `tsconfig.web.json`).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/modules/diagram/layout/layout-pipeline-service.ts \
        src/renderer/src/modules/diagram/layout/tests/layout-pipeline-service.test.ts
git commit -m "feat(layout): drop preview run-mode; wire preset load/save/delete"
```

---

### Task 5: The preset strip UI — `@Play` icon + inspector template

Add the play icon and replace the inspector's two button rows with the strip; add the save-prompt template.

**Files:**
- Create: `src/renderer/src/icons/play.svg`
- Modify: `src/renderer/src/plexus-icons.mu`
- Modify: `src/renderer/src/modules/diagram/layout/layout-inspector.resources.mu`

**Interfaces:**
- Consumes: `@Play`, `@Save` (icon geometries); `LayoutPipelineService.PresetNames`/`SelectedPreset`/`CanDelete`/`SaveCommand`/`DeleteCommand`/`RunCommand` (Task 4); `SavePresetPromptModel` (Task 3).
- Produces: the rendered strip + `DataTemplate[SavePresetPromptModel]`. Verified by `compile:mu` + `typecheck:web`, not a unit test (`.mu` has no test harness).

- [ ] **Step 1: Add the play icon**

Create `src/renderer/src/icons/play.svg` (a filled right-pointing triangle on the shared 24×24 viewBox, matching save.svg's `currentColor` fill so the theme brush paints it):

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <path fill="currentColor" d="M8 5v14l11-7z"/>
</svg>
```

- [ ] **Step 2: Register the icon**

In `src/renderer/src/plexus-icons.mu`, add a `Play` include next to the other command-bar glyphs (after the `Copy`/`FilterOff` block, inside the `resources PlexusIcons { … }` body):

```
    // Layout inspector Run action.
    include "icons/play.svg"                     as Play
```

- [ ] **Step 3: Rewrite the inspector template header + add the save-prompt template**

In `src/renderer/src/modules/diagram/layout/layout-inspector.resources.mu`:

First, add the `SavePresetPromptModel` import next to the other imports at the top (after `import BoolParamVM from "./layout-param-vm.js"`):

```
import SavePresetPromptModel from "./save-preset-prompt.js"
```

Then replace the `DataTemplate [ DataType = LayoutInspector ] { … }` block (the whole block, currently lines ~64–101) with:

```
    DataTemplate [ DataType = LayoutInspector ] {
        ScrollViewer [ HorizontalScrollEnabled = false ] {
            StackPanel [ Orientation = Vertical, Margin = (12,12,12,12) ] {

                TextBlock [ Style = @TitleMedium, Text = "Layout Pipeline",
                            Foreground = @OnSurface, Margin = (0,0,0,10) ]

                // Preset strip: [ presets ▾ ]  [Save]  [Delete]  [Run].
                StackPanel [ Orientation = Horizontal, Margin = (0,0,0,10) ] {
                    ComboBox [ ItemsSource = $service(LayoutPipelineService).PresetNames,
                               SelectedItem = $service(LayoutPipelineService).SelectedPreset,
                               Width = 150, VerticalAlignment = Center, Margin = (0,0,8,0) ]
                    PanelButton [ Margin = (0,0,4,0), Command = $service(LayoutPipelineService).SaveCommand ] {
                        Shape [ Geometry = @Save, Fill = @OnSurfaceVariant, Width = 20, Height = 20 ]
                    }
                    PanelButton [ Margin = (0,0,4,0), Command = $service(LayoutPipelineService).DeleteCommand,
                                  IsEnabled = $service(LayoutPipelineService).CanDelete ] {
                        TextBlock [ Text = "Delete", Style = @BodyMedium, Foreground = @OnSurfaceVariant,
                                    VerticalAlignment = Center, Margin = (4,0,4,0) ]
                    }
                    PanelButton [ Command = $service(LayoutPipelineService).RunCommand ] {
                        Shape [ Geometry = @Play, Fill = @OnSurfaceVariant, Width = 20, Height = 20 ]
                    }
                }

                TextBlock [ Style = @BodySmall, Text = $service(LayoutPipelineService).Status,
                            Foreground = @OnSurfaceVariant, TextWrapping = Wrap, Margin = (0,0,0,12) ]

                // Layout stages — one labelled ComboBox per stage; the choice
                // writes into the pipeline configuration used by Run.
                TextBlock [ Style = @BodySmall, Text = "Layout stages",
                            Foreground = @OnSurfaceVariant, Margin = (0,0,0,4) ]
                ItemsControl [ ItemsSource = $service(LayoutPipelineService).Stages,
                               ItemsPanel = @VerticalStackPanel ]
            }
        }
    }
```

Then add the save-prompt dialog body as a new `DataTemplate` inside the same `resources LayoutInspectorResources { … }` block (place it after the `DataTemplate [ DataType = LayoutInspector ]` block, before the closing `}`):

```
    // The save-preset prompt dialog body (DialogService supplies surface/title/
    // padding). A single name field + Cancel / Save; Save stays disabled until
    // the name is non-blank (CanConfirm).
    DataTemplate [ DataType = SavePresetPromptModel ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            TextBlock [ Style = @BodyLarge, Text = "Preset name", Foreground = @OnSurface, Margin = (0,0,0,4) ]
            TextBox [ Text = $Name, Margin = (0,0,0,14) ]
            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right ] {
                Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel" ] }
                Button [ Variant = Filled, Command = $ConfirmCommand, IsEnabled = $CanConfirm ] { TextBlock [ Text = "Save" ] }
            }
        }
    }
```

Delete the now-unused header import lines only if they are unused elsewhere — `NumberParamVM`/`BoolParamVM`/`LayoutStageVM`/`LayoutPipelineService`/`LayoutInspector` imports all stay (their templates remain). No import is removed in this task.

- [ ] **Step 4: Compile the markup**

Run: `npm run compile:mu`
Expected: SUCCESS — no unresolved binding/resource errors. In particular `@Play` resolves (Step 2) and every `$service(LayoutPipelineService).*` path resolves to a registered property/command added in Task 4. A failure naming `Mode`, `ApplyPreviewCommand`, `CancelPreviewCommand`, `UsePositionsModeCommand`, or `UsePreviewModeCommand` means a stale reference remains in the template — remove it.

- [ ] **Step 5: Typecheck the renderer**

Run: `npm run typecheck:web`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/icons/play.svg \
        src/renderer/src/plexus-icons.mu \
        src/renderer/src/modules/diagram/layout/layout-inspector.resources.mu
git commit -m "feat(layout): preset strip UI (combobox + save/delete/run) with play icon"
```

---

### Task 6: Full-suite verification

- [ ] **Step 1: Run the full renderer test suite**

Run: `npm test`
Expected: all green (the new preset store / stage LoadSpec / save-prompt / service tests plus the untouched suite; the existing `run-modes.test.ts` still passes — `planForMode` is unchanged).

- [ ] **Step 2: Full typecheck + markup compile**

Run: `npm run typecheck && npm run compile:mu`
Expected: both clean.

- [ ] **Step 3: (manual, host-only) live smoke — noted, not automated**

The strip, the native save-name dialog, folder-of-files persistence across restarts, and the ComboBox → settings round-trip are only exercisable in the running Electron app (`npm run dev`). Flag this as the one manual check; it is out of scope for the automated tasks.

---

## Self-Review

**Spec coverage:**
- Target UI strip (ComboBox/Save/Delete/Run, Status + Stages below) → Task 5 Step 3.
- Run = apply; preview/mode removal → Task 4 (Run rewrite + removed members).
- Presets store folder-of-files via EnvironmentService (`dir`/`names`/`get`/`save`/`delete`, `safe()`) → Task 1.
- `LayoutStageVM.LoadSpec` (default / match+params / unknown className) → Task 2.
- Service wiring (`stageKeys`, `PresetNames`, `SelectedPreset` change → `LoadPreset`, `LoadPreset` clones + per-stage LoadSpec in order, `SaveCommand`, `DeleteCommand`, `refreshPresetNames`) → Task 4.
- Save prompt (`SavePresetPromptModel` + `promptPresetName` + template) → Tasks 3 & 5.
- Play icon → Task 5 Steps 1–2.
- Testing (store / LoadSpec / LoadPreset / prompt) → Tasks 1–4.

**Beyond the spec (necessary detail found while planning):** `LoadPreset` skips a stage whose `Enabled` is already false. Without this, loading a preset that uses `CardinalSideRouter` would let the Port Assigner stage's `LoadSpec({off:true})` fall to `(default)` and *delete* the `{ off: true }` directive the Edge Router just set — re-enabling Fresco's port assigner under native routing (wrong). The Edge Router loads before the Port Assigner (Stages order), disables it, and the skip preserves the directive. Documented in the `LoadPreset` comment.

**Placeholder scan:** none — every code step carries full source and an exact run command.

**Type consistency:** `LayoutPresetsStore(provider)` with `names(): Promise<string[]>` / `get(): Promise<PipelineConfiguration | undefined>` / `save(): Promise<string>` / `delete(): Promise<void>` is defined in Task 1 and called identically in Task 4. `LoadSpec(spec: LayoutStageSpec | undefined): void` defined in Task 2, called in Task 4's `LoadPreset`. `promptPresetName(dialogs, initial): Promise<string | undefined>` defined in Task 3, called in Task 4's `save`. `SelectedPreset: string | undefined` getter/setter matches the two-way `.mu` binding in Task 5. Removed members (`Mode`, `ApplyPreviewCommand`, …) are absent from both the Task 4 service and the Task 5 template.

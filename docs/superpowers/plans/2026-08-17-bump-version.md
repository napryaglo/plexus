# Bump Version Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give TODL producer projects (meta-model, library) a project-menu "Bump Version" command — Major/Minor/Patch one-click plus a Custom… dialog with an opt-in Publish — that updates `modelVersion`/`libVersion` on the manifest.

**Architecture:** A feature-tested factory capability (`IVersionedProjectFactory`) abstracts version read/write per producer; a pure `bumpVersion`/`isValidVersion` helper computes new versions; a `SetVersionDialogModel` view-model drives the Custom flow through the existing `DialogService`. `ProjectExplorerService` wires four feature-gated commands onto `OpenProject`, and the `.mu` context menu binds them under a `Bump Version` submenu.

**Tech Stack:** TypeScript, `@pragmatic-tech-ai/mural/runtime` (`Model`, `RelayCommand`, `ICommand`) + `/framework` (`DialogService`, `Checkbox`), Vitest, mural `.mu` (compiled via `npm run compile:mu`).

## Global Constraints

- Every test file lives in a `tests/` subfolder next to its source.
- Renderer code uses `IStorage` (project-relative POSIX paths) — never `node:fs`/`node:path`.
- Use real TS enums, never string-literal unions (`VersionPart` is an enum).
- The version string becomes a `<id>/<version>/` folder segment — validate it as a safe path segment.
- Producers only: meta-model (`modelVersion`) and library (`libVersion`); architecture has no version.
- Bump-only in the submenu; the Custom… dialog publishes only when its Publish checkbox is checked.
- `npm run typecheck:web` clean; `npm test` green (baseline: 834 passed, 1 skipped). After editing `.mu`, run `npm run compile:mu`.
- Commit only when the user asks (the executor pauses at the finish menu); steps still show the commit.

---

### Task 1: Semver bump helper

A pure, I/O-free version calculator + validator.

**Files:**
- Create: `Plexus/src/renderer/src/services/projects/semver-bump.ts`
- Test: `Plexus/src/renderer/src/services/projects/tests/semver-bump.test.ts`

**Interfaces:**
- Produces: `enum VersionPart { Major = 'major', Minor = 'minor', Patch = 'patch' }`, `bumpVersion(current: string, part: VersionPart): string`, `isValidVersion(v: string): boolean`.

- [ ] **Step 1: Write the failing test**

Create `services/projects/tests/semver-bump.test.ts`:

```ts
import { test, expect } from 'vitest'
import { bumpVersion, isValidVersion, VersionPart } from '../semver-bump.js'

test('bumpVersion increments the chosen part and zeros the lower parts', () => {
    expect(bumpVersion('0.1.0', VersionPart.Minor)).toBe('0.2.0')
    expect(bumpVersion('1.2.3', VersionPart.Major)).toBe('2.0.0')
    expect(bumpVersion('1.2.3', VersionPart.Minor)).toBe('1.3.0')
    expect(bumpVersion('1.2.3', VersionPart.Patch)).toBe('1.2.4')
})

test('bumpVersion is lenient on non-semver input (missing parts default to 0)', () => {
    expect(bumpVersion('5', VersionPart.Major)).toBe('6.0.0')
    expect(bumpVersion('5', VersionPart.Patch)).toBe('5.0.1')
    expect(bumpVersion('', VersionPart.Minor)).toBe('0.1.0')
})

test('isValidVersion accepts semver-ish + rejects empty / path-hostile strings', () => {
    expect(isValidVersion('0.1.0')).toBe(true)
    expect(isValidVersion('5')).toBe(true)
    expect(isValidVersion('1.0.0-rc.1')).toBe(true)
    expect(isValidVersion('')).toBe(false)
    expect(isValidVersion('   ')).toBe(false)
    expect(isValidVersion('../x')).toBe(false)
    expect(isValidVersion('a/b')).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/services/projects/tests/semver-bump.test.ts`
Expected: FAIL — `Cannot find module '../semver-bump.js'`.

- [ ] **Step 3: Write the implementation**

Create `services/projects/semver-bump.ts`:

```ts
// Pure semver bump + validation for producer project versions. No I/O.

export enum VersionPart { Major = 'major', Minor = 'minor', Patch = 'patch' }

// Increment the chosen part, zeroing the lower parts. Lenient: a version with
// missing or non-numeric parts coerces those parts to 0 (so it never throws) —
// `'5'` → [5,0,0], `''` → [0,0,0].
export function bumpVersion(current: string, part: VersionPart): string
{
    const seg = current.split('.')
    const major = Number(seg[0]) || 0
    const minor = Number(seg[1]) || 0
    const patch = Number(seg[2]) || 0
    switch (part) {
        case VersionPart.Major: return `${major + 1}.0.0`
        case VersionPart.Minor: return `${major}.${minor + 1}.0`
        case VersionPart.Patch: return `${major}.${minor}.${patch + 1}`
    }
}

// A version is usable iff it is non-empty and safe as a single path segment (it
// becomes the `<id>/<version>/` folder name): starts alphanumeric, then only
// alphanumerics, dot, underscore, hyphen. No slashes, no leading dot.
export function isValidVersion(v: string): boolean
{
    return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v.trim())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/services/projects/tests/semver-bump.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/services/projects/semver-bump.ts src/renderer/src/services/projects/tests/semver-bump.test.ts
git commit -m "feat: add semver bump helper for producer versions"
```

---

### Task 2: `IVersionedProjectFactory` capability + producer implementations

Add the capability and implement it on both producer factories.

**Files:**
- Modify: `Plexus/src/renderer/src/services/projects/project-factory.ts` (add interface + `isVersioned` guard)
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts`
- Modify: `Plexus/src/renderer/src/modules/library/services/library-project-factory.ts`
- Test: `Plexus/src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts`, `Plexus/src/renderer/src/modules/library/services/tests/library-project-factory.test.ts`, `Plexus/src/renderer/src/modules/architecture-projects/services/tests/architecture-project-factory.test.ts`

**Interfaces:**
- Consumes: `bumpVersion` is NOT used here; this task only exposes version read/write.
- Produces: `interface IVersionedProjectFactory { getVersion(storage: IStorage): Promise<string>; setVersion(storage: IStorage, version: string): Promise<void> }` and `isVersioned(factory: IProjectFactory): factory is IProjectFactory & IVersionedProjectFactory`, both from `services/projects/project-factory.js`. `MetaModelProjectFactory` and `LibraryProjectFactory` implement it.

- [ ] **Step 1: Write the failing tests**

In `meta-model-project-factory.test.ts`, add (the `factory()` + `FakeStorage` helpers already exist in the file):

```ts
test('getVersion/setVersion round-trips modelVersion, preserving other fields', async () => {
    const storage = new FakeStorage('fake://Acme')
    const f = factory()
    await f.createProject(storage, 'Acme EA')          // seeds modelVersion '0.1.0', id 'acme-ea'
    expect(await f.getVersion(storage)).toBe('0.1.0')
    await f.setVersion(storage, '0.2.0')
    expect(await f.getVersion(storage)).toBe('0.2.0')
    const m = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
    expect(m.id).toBe('acme-ea')                        // untouched
})
```

In `library-project-factory.test.ts`, add (uses its existing `factory()`):

```ts
test('getVersion/setVersion round-trips libVersion, preserving id + metaModel', async () => {
  const storage = new FakeStorage('fake://Acme')
  const f = factory()
  await f.createProject(storage, 'Acme Lib', { metaModel: { id: 'ea', version: '5' } })
  expect(await f.getVersion(storage)).toBe('0.1.0')
  await f.setVersion(storage, '1.0.0')
  expect(await f.getVersion(storage)).toBe('1.0.0')
  const m = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
  expect(m.id).toBe('acme-lib')                        // untouched
  expect(m.metaModel).toEqual({ id: 'ea', version: '5' })   // untouched
})
```

In `architecture-project-factory.test.ts`, extend the existing `project-factory.js` import to add `isVersioned` (it already imports `PROJECT_MANIFEST_FILENAME, isPublishable`):

```ts
import { PROJECT_MANIFEST_FILENAME, isPublishable, isVersioned } from '../../../../services/projects/project-factory.js'
```

and add:

```ts
test('architecture is not versioned', () => {
    expect(isVersioned(factory())).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts`
Expected: FAIL — `f.getVersion is not a function`.

- [ ] **Step 3: Add the capability to `project-factory.ts`**

`project-factory.ts` already imports `IStorage`. Add, next to the `isPublishable` guard:

```ts
// Optional capability a producer factory (meta-model, library) implements: read
// and update the manifest's published version. The explorer's Bump Version
// command feature-tests with isVersioned before offering it — same pattern as
// isPublishable. Each producer knows its own manifest field (modelVersion /
// libVersion); this seam hides that from the caller.
export interface IVersionedProjectFactory
{
    getVersion(storage: IStorage): Promise<string>
    setVersion(storage: IStorage, version: string): Promise<void>
}

// Type guard: does this factory expose a bumpable version?
export function isVersioned(
    factory: IProjectFactory,
): factory is IProjectFactory & IVersionedProjectFactory
{
    const f = factory as Partial<IVersionedProjectFactory>
    return typeof f.getVersion === 'function' && typeof f.setVersion === 'function'
}
```

- [ ] **Step 4: Implement on `MetaModelProjectFactory`**

Add `IVersionedProjectFactory` to the imported types and the `implements` list:

```ts
import {
    PROJECT_MANIFEST_FILENAME,
    ProducerKind,
    type IProducerProjectFactory,
    type IPresentationProjectFactory,
    type IPublishableProjectFactory,
    type IVersionedProjectFactory,
    type ProjectFileFormat,
    type ProjectManifestEnvelope,
    type PublishResult,
} from '../../../services/projects/project-factory.js'
```
```ts
export class MetaModelProjectFactory extends TodlProjectFactory
    implements IPublishableProjectFactory, IPresentationProjectFactory, IProducerProjectFactory, IVersionedProjectFactory
{
```

Add the two methods to the class body (e.g. after `scaffoldContributions`):

```ts
public async getVersion(storage: IStorage): Promise<string>
{
    const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as MetaModelManifest
    return manifest.modelVersion
}

public async setVersion(storage: IStorage, version: string): Promise<void>
{
    const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as MetaModelManifest
    manifest.modelVersion = version
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))
}
```

- [ ] **Step 5: Implement on `LibraryProjectFactory`**

Add `type IVersionedProjectFactory` to its `project-factory.js` import block and to the `implements` list:

```ts
export class LibraryProjectFactory extends TodlProjectFactory
    implements IPublishableProjectFactory, IProducerProjectFactory, IPresentationProjectFactory, IVersionedProjectFactory
{
```

Add to the class body:

```ts
public async getVersion(storage: IStorage): Promise<string>
{
    const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as LibraryManifest
    return manifest.libVersion
}

public async setVersion(storage: IStorage, version: string): Promise<void>
{
    const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as LibraryManifest
    manifest.libVersion = version
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))
}
```

- [ ] **Step 6: Run the three suites + typecheck**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts src/renderer/src/modules/library/services/tests/library-project-factory.test.ts src/renderer/src/modules/architecture-projects/services/tests/architecture-project-factory.test.ts && npm run typecheck:web`
Expected: PASS + typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add IVersionedProjectFactory capability on producer factories"
```

---

### Task 3: `SetVersionDialogModel`

The Custom… dialog view-model (validation + Publish checkbox). VM only; the `.mu` template lands in Task 5.

**Files:**
- Create: `Plexus/src/renderer/src/services/projects/set-version-dialog-model.ts`
- Test: `Plexus/src/renderer/src/services/projects/tests/set-version-dialog-model.test.ts`

**Interfaces:**
- Consumes: `isValidVersion` from `services/projects/semver-bump.js`.
- Produces: `interface SetVersionResult { version: string; publish: boolean }` and `class SetVersionDialogModel` with props `Current`, `NewVersion` (two-way), `Publish` (two-way), `Error`, `CanConfirm`, and `ConfirmCommand`/`CancelCommand`; constructor `(current: string, close: (result?: SetVersionResult) => void)`.

- [ ] **Step 1: Write the failing test**

Create `services/projects/tests/set-version-dialog-model.test.ts`:

```ts
import { test, expect } from 'vitest'
import { SetVersionDialogModel, type SetVersionResult } from '../set-version-dialog-model.js'

test('prefills NewVersion with the current version and can confirm', () => {
    const vm = new SetVersionDialogModel('0.1.0', () => {})
    expect(vm.Current).toBe('0.1.0')
    expect(vm.NewVersion).toBe('0.1.0')
    expect(vm.CanConfirm).toBe(true)
})

test('CanConfirm tracks validity; empty shows no error, invalid does', () => {
    const vm = new SetVersionDialogModel('0.1.0', () => {})
    vm.NewVersion = ''
    expect(vm.CanConfirm).toBe(false)
    expect(vm.Error).toBe('')
    vm.NewVersion = 'a/b'
    expect(vm.CanConfirm).toBe(false)
    expect(vm.Error).not.toBe('')
})

test('Confirm closes with a trimmed version + the publish flag; Cancel closes undefined', () => {
    let result: SetVersionResult | undefined = { version: 'sentinel', publish: false }
    const vm = new SetVersionDialogModel('0.1.0', (r) => { result = r })
    vm.NewVersion = ' 0.2.0 '
    vm.Publish = true
    vm.ConfirmCommand.Execute(undefined)
    expect(result).toEqual({ version: '0.2.0', publish: true })

    result = { version: 'sentinel', publish: false }
    vm.CancelCommand.Execute(undefined)
    expect(result).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/services/projects/tests/set-version-dialog-model.test.ts`
Expected: FAIL — `Cannot find module '../set-version-dialog-model.js'`.

- [ ] **Step 3: Write the implementation**

Create `services/projects/set-version-dialog-model.ts`:

```ts
import { MetaData, Model, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'

import { isValidVersion } from './semver-bump.js'

// The Custom… version dialog's view-model. The host shows it through
// DialogService and awaits a SetVersionResult (or undefined on cancel/scrim).
// Rendered by DataTemplate[SetVersionDialogModel]. NewVersion is pre-filled with
// the current version; CanConfirm gates OK on isValidVersion; the Publish
// checkbox asks the host to publish right after setting the version.
export interface SetVersionResult
{
    version: string
    publish: boolean
}

export class SetVersionDialogModel extends Model
{
    static readonly CurrentKey = Model.RegisterProperty<string>(SetVersionDialogModel, 'Current', '', MetaData.None)
    static readonly NewVersionKey = Model.RegisterProperty<string>(SetVersionDialogModel, 'NewVersion', '', MetaData.None)
    static readonly PublishKey = Model.RegisterProperty<boolean>(SetVersionDialogModel, 'Publish', false, MetaData.None)
    static readonly ErrorKey = Model.RegisterProperty<string>(SetVersionDialogModel, 'Error', '', MetaData.None)
    static readonly CanConfirmKey = Model.RegisterProperty<boolean>(SetVersionDialogModel, 'CanConfirm', false, MetaData.None)
    static readonly ConfirmCommandKey = Model.RegisterProperty<ICommand>(
        SetVersionDialogModel, 'ConfirmCommand', undefined as unknown as ICommand, MetaData.None)
    static readonly CancelCommandKey = Model.RegisterProperty<ICommand>(
        SetVersionDialogModel, 'CancelCommand', undefined as unknown as ICommand, MetaData.None)

    constructor(current: string, private readonly close: (result?: SetVersionResult) => void)
    {
        super()
        this.set_property_value(SetVersionDialogModel.CurrentKey, current)
        this.set_property_value(SetVersionDialogModel.NewVersionKey, current)
        this.set_property_value(SetVersionDialogModel.ConfirmCommandKey, new RelayCommand(() => this.confirm()))
        this.set_property_value(SetVersionDialogModel.CancelCommandKey, new RelayCommand(() => this.close(undefined)))
        this.AddPropertyChangedListener(SetVersionDialogModel.NewVersionKey, () => this.recompute())
        this.recompute()
    }

    public get Current(): string { return this.get_property_value(SetVersionDialogModel.CurrentKey) }
    public get NewVersion(): string { return this.get_property_value(SetVersionDialogModel.NewVersionKey) }
    public set NewVersion(v: string) { this.set_property_value(SetVersionDialogModel.NewVersionKey, v) }
    public get Publish(): boolean { return this.get_property_value(SetVersionDialogModel.PublishKey) }
    public set Publish(v: boolean) { this.set_property_value(SetVersionDialogModel.PublishKey, v) }
    public get Error(): string { return this.get_property_value(SetVersionDialogModel.ErrorKey) }
    public get CanConfirm(): boolean { return this.get_property_value(SetVersionDialogModel.CanConfirmKey) }
    public get ConfirmCommand(): ICommand { return this.get_property_value(SetVersionDialogModel.ConfirmCommandKey) }
    public get CancelCommand(): ICommand { return this.get_property_value(SetVersionDialogModel.CancelCommandKey) }

    // Valid → enable OK, clear error. Invalid-and-nonblank → show an error.
    // Blank → disabled but no error (the field is just incomplete).
    private recompute(): void
    {
        const ok = isValidVersion(this.NewVersion)
        this.set_property_value(SetVersionDialogModel.CanConfirmKey, ok)
        const blank = this.NewVersion.trim() === ''
        this.set_property_value(SetVersionDialogModel.ErrorKey, ok || blank ? '' : 'Not a valid version.')
    }

    private confirm(): void
    {
        if (!this.CanConfirm) return
        this.close({ version: this.NewVersion.trim(), publish: this.Publish })
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/services/projects/tests/set-version-dialog-model.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/services/projects/set-version-dialog-model.ts src/renderer/src/services/projects/tests/set-version-dialog-model.test.ts
git commit -m "feat: add SetVersionDialogModel for the Custom version flow"
```

---

### Task 4: OpenProject commands + explorer wiring

Add the four command properties and the explorer methods, tested headlessly.

**Files:**
- Modify: `Plexus/src/renderer/src/services/projects/open-project.ts`
- Modify: `Plexus/src/renderer/src/modules/project-explorer/services/project-explorer-service.ts`
- Test: `Plexus/src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts`

**Interfaces:**
- Consumes: `VersionPart`, `bumpVersion` (`services/projects/semver-bump.js`); `isVersioned` (`services/projects/project-factory.js`); `SetVersionDialogModel`, `SetVersionResult` (`services/projects/set-version-dialog-model.js`).
- Produces: `OpenProject.BumpVersionMajorCommand`, `.BumpVersionMinorCommand`, `.BumpVersionPatchCommand`, `.SetVersionCommand` (each `ICommand | undefined`), wired by `ProjectExplorerService.wireProjectCommands`; private methods `bumpVersion(op, part)` and `setVersionDialog(op)`.

- [ ] **Step 1: Add the four command properties to `OpenProject`**

In `open-project.ts`, after the `PublishCommandKey`/getter/setter block, add four properties following that exact idiom. Property keys:

```ts
    static readonly BumpVersionMajorCommandKey = Model.RegisterProperty<ICommand | undefined>(
        OpenProject, 'BumpVersionMajorCommand', undefined, MetaData.None)
    static readonly BumpVersionMinorCommandKey = Model.RegisterProperty<ICommand | undefined>(
        OpenProject, 'BumpVersionMinorCommand', undefined, MetaData.None)
    static readonly BumpVersionPatchCommandKey = Model.RegisterProperty<ICommand | undefined>(
        OpenProject, 'BumpVersionPatchCommand', undefined, MetaData.None)
    static readonly SetVersionCommandKey = Model.RegisterProperty<ICommand | undefined>(
        OpenProject, 'SetVersionCommand', undefined, MetaData.None)
```

Getters/setters (mirror `PublishCommand`):

```ts
    public get BumpVersionMajorCommand(): ICommand | undefined { return this.get_property_value(OpenProject.BumpVersionMajorCommandKey) }
    public set BumpVersionMajorCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.BumpVersionMajorCommandKey, v) }
    public get BumpVersionMinorCommand(): ICommand | undefined { return this.get_property_value(OpenProject.BumpVersionMinorCommandKey) }
    public set BumpVersionMinorCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.BumpVersionMinorCommandKey, v) }
    public get BumpVersionPatchCommand(): ICommand | undefined { return this.get_property_value(OpenProject.BumpVersionPatchCommandKey) }
    public set BumpVersionPatchCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.BumpVersionPatchCommandKey, v) }
    public get SetVersionCommand(): ICommand | undefined { return this.get_property_value(OpenProject.SetVersionCommandKey) }
    public set SetVersionCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.SetVersionCommandKey, v) }
```

- [ ] **Step 2: Write the failing explorer tests**

In `project-explorer-service.test.ts`:

(a) Widen the dialog stub so a test can drive a non-boolean result. Change `fakeDialogs`'s first parameter and `makeExplorer`'s `confirm` parameter type from `boolean` to `boolean | object` (the `Show` body already resolves whatever value is passed — no logic change). Add the imports at the top:

```ts
import { VersionPart } from '../../../../services/projects/semver-bump.js'
import type { SetVersionResult } from '../../../../services/projects/set-version-dialog-model.js'
import { isVersioned, type IVersionedProjectFactory } from '../../../../services/projects/project-factory.js'
```

(b) Add a versioned fake factory + record helper near the other fakes:

```ts
// A publishable + versioned fake factory whose version lives in the manifest of
// the storage it's given; publish() records that it ran.
function fakeVersionedFactory(published: string[]): IProjectFactory & IVersionedProjectFactory & IPublishableProjectFactory
{
    const base = fakeProjectFactory(true) as IProjectFactory & IPublishableProjectFactory
    return {
        ...base,
        publish: async () => { published.push('published'); return { ok: true, message: 'Published.' } },
        getVersion: async (s) => (JSON.parse(await s.ReadText(PROJECT_MANIFEST_FILENAME)) as { modelVersion: string }).modelVersion,
        setVersion: async (s, v) => {
            const m = JSON.parse(await s.ReadText(PROJECT_MANIFEST_FILENAME))
            m.modelVersion = v
            await s.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(m))
        },
    }
}

async function seededStorage(folder: string, version = '0.1.0'): Promise<FakeStorage>
{
    const s = new FakeStorage(folder)
    await s.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'meta-model', name: 'A', modelVersion: version }))
    return s
}
```

(c) Extend `ExplorerPrivates` with the two new methods:

```ts
    bumpVersion(op: OpenProject, part: VersionPart): Promise<void>
    setVersionDialog(op: OpenProject): Promise<void>
```

(d) The tests:

```ts
test('bumpVersion writes the incremented version to the manifest', async () => {
    const { priv } = makeExplorer()
    const storage = await seededStorage('C:/a', '0.1.0')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeVersionedFactory([]), storage)
    await priv.bumpVersion(op, VersionPart.Minor)
    const m = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
    expect(m.modelVersion).toBe('0.2.0')
})

test('bump commands are enabled only for versioned factories', async () => {
    const { priv } = makeExplorer()
    const vOp = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeVersionedFactory([]), await seededStorage('C:/a'))
    const plainOp = await priv.addOpenProject(projectWith('B', 'C:/b'), fakeProjectFactory(), new FakeStorage('C:/b'))
    expect(vOp.BumpVersionMajorCommand!.CanExecute(undefined)).toBe(true)
    expect(vOp.SetVersionCommand!.CanExecute(undefined)).toBe(true)
    expect(plainOp.BumpVersionMajorCommand!.CanExecute(undefined)).toBe(false)
    expect(plainOp.SetVersionCommand!.CanExecute(undefined)).toBe(false)
})

test('setVersionDialog sets the version and publishes only when the flag is set', async () => {
    const published: string[] = []
    const result: SetVersionResult = { version: '3.0.0', publish: true }
    const { priv } = makeExplorer(null, result)                 // dialog resolves this result
    const storage = await seededStorage('C:/a', '0.1.0')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeVersionedFactory(published), storage)
    await priv.setVersionDialog(op)
    expect(JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)).modelVersion).toBe('3.0.0')
    expect(published).toEqual(['published'])                    // publish ran

    const published2: string[] = []
    const { priv: priv2 } = makeExplorer(null, { version: '4.0.0', publish: false })
    const storage2 = await seededStorage('C:/b', '0.1.0')
    const op2 = await priv2.addOpenProject(projectWith('B', 'C:/b'), fakeVersionedFactory(published2), storage2)
    await priv2.setVersionDialog(op2)
    expect(JSON.parse(await storage2.ReadText(PROJECT_MANIFEST_FILENAME)).modelVersion).toBe('4.0.0')
    expect(published2).toEqual([])                              // publish did NOT run
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts`
Expected: FAIL — `priv.bumpVersion is not a function` / `BumpVersionMajorCommand` undefined.

- [ ] **Step 4: Wire the commands in `wireProjectCommands`**

In `project-explorer-service.ts`, add imports:

```ts
import { VersionPart, bumpVersion } from '../../../services/projects/semver-bump.js'
import { SetVersionDialogModel, type SetVersionResult } from '../../../services/projects/set-version-dialog-model.js'
```
and add `isVersioned` to the existing `project-factory.js` import (which already brings in `isPublishable`, `canGeneratePresentation`).

In `wireProjectCommands(op)`, after the `PublishCommand` line, add:

```ts
        op.BumpVersionMajorCommand = new RelayCommand(
            () => void this.bumpVersion(op, VersionPart.Major), () => isVersioned(op.Factory))
        op.BumpVersionMinorCommand = new RelayCommand(
            () => void this.bumpVersion(op, VersionPart.Minor), () => isVersioned(op.Factory))
        op.BumpVersionPatchCommand = new RelayCommand(
            () => void this.bumpVersion(op, VersionPart.Patch), () => isVersioned(op.Factory))
        op.SetVersionCommand = new RelayCommand(
            () => void this.setVersionDialog(op), () => isVersioned(op.Factory))
```

- [ ] **Step 5: Add the two methods**

Add near `publishProject` in `project-explorer-service.ts`:

```ts
    // Bump the producer project's published version by one semver part and write
    // it back to the manifest. Menu items are disabled for non-versioned types,
    // but guard anyway.
    private async bumpVersion(op: OpenProject, part: VersionPart): Promise<void>
    {
        if (!isVersioned(op.Factory)) { this.Status = 'This project type has no version.'; return }
        const next = bumpVersion(await op.Factory.getVersion(op.Storage), part)
        await op.Factory.setVersion(op.Storage, next)
        this.Status = `Version bumped to ${next}.`
    }

    // The Custom… flow: show the set-version dialog pre-filled with the current
    // version; on OK write the chosen version and — if the dialog's Publish box was
    // checked — publish immediately (reusing publishProject's error handling).
    private async setVersionDialog(op: OpenProject): Promise<void>
    {
        if (!isVersioned(op.Factory)) { this.Status = 'This project type has no version.'; return }
        const current = await op.Factory.getVersion(op.Storage)
        const vm = new SetVersionDialogModel(current, (r) => this.dialogs.Close(r))
        const result = (await this.dialogs.Show({ Title: 'Set Version', Content: vm, Width: 380 })) as SetVersionResult | undefined
        if (result === undefined) return
        await op.Factory.setVersion(op.Storage, result.version)
        if (result.publish) { await this.publishProject(op); return }
        this.Status = `Version set to ${result.version}.`
    }
```

- [ ] **Step 6: Run the explorer suite + typecheck + full suite**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts && npm run typecheck:web && npm test`
Expected: explorer tests PASS; typecheck clean; full suite green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: wire Bump Version commands into the project explorer"
```

---

### Task 5: `.mu` menu submenu + dialog template

Surface the commands in the project context menu and render the Custom dialog. GUI glue — gated by `compile:mu` + typecheck (no headless test).

**Files:**
- Modify: `Plexus/src/renderer/src/modules/project-explorer/project-explorer.resources.mu`

**Interfaces:**
- Consumes: the four `OpenProject` commands (Task 4) and `SetVersionDialogModel` (Task 3).

- [ ] **Step 1: Add the Bump Version submenu**

In `project-explorer.resources.mu`, in the `ContextMenu x:key="ProjectContextMenu"` block, after the `Generate Presentation` MenuItem block and before `Add Library Reference…`, add:

```
        MenuItem [ Header = "Bump Version" ] {
            MenuItem [ Header = "Major",   Command = $BumpVersionMajorCommand ]
            MenuItem [ Header = "Minor",   Command = $BumpVersionMinorCommand ]
            MenuItem [ Header = "Patch",   Command = $BumpVersionPatchCommand ]
            MenuSeparator
            MenuItem [ Header = "Custom…", Command = $SetVersionCommand ]
        }
```

- [ ] **Step 2: Import the dialog VM + add its DataTemplate**

At the top of the file, alongside `import ConfirmDialogModel …`, add:

```
import SetVersionDialogModel from "../../services/projects/set-version-dialog-model.js"
```

After the `DataTemplate [ DataType = ConfirmDialogModel ]` block, add:

```
    DataTemplate [ DataType = SetVersionDialogModel ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            TextBlock [ Style = @BodySmall, Text = $Current, Foreground = @OnSurfaceVariant, Margin = (0,0,0,2) ]
            TextBox [ Text = $NewVersion, Margin = (0,0,0,6) ]
            Checkbox [ IsChecked = $Publish, Margin = (0,0,0,4) ] { TextBlock [ Text = "Publish after setting" ] }
            TextBlock [ Style = @BodySmall, Text = $Error, Foreground = @Error, Margin = (0,0,0,10) ]
            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right ] {
                Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel" ] }
                Button [ Variant = Filled, Command = $ConfirmCommand, IsEnabled = $CanConfirm ] { TextBlock [ Text = "Set Version" ] }
            }
        }
    }
```

Note: `@Error` is the standard M3 error color token used elsewhere for error text; if the compiler reports it unresolved in this dictionary, use `@OnSurfaceVariant` (the file already resolves it) to keep the build green — the error copy is what matters, not its hue.

- [ ] **Step 3: Compile the `.mu` + typecheck**

Run: `cd Plexus && npm run compile:mu && npm run typecheck:web`
Expected: compile succeeds (the new `Checkbox` / bindings resolve; `SetVersionDialogModel` import loads); typecheck clean. If `compile:mu` fails on `Checkbox`, confirm the element spelling is `Checkbox` (registered name) — not `CheckBox`.

- [ ] **Step 4: Run the full suite**

Run: `cd Plexus && npm test`
Expected: green (no test exercises the `.mu`, but confirm nothing regressed).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Bump Version submenu + Set Version dialog template"
```

---

## Notes for the executor

- **Do not** publish any package or touch Verdaccio; renderer-only TS + `.mu`.
- A live GUI smoke (right-click a meta-model/library project → Bump Version → Minor; then Custom… with Publish checked) is a good manual check after Task 5 but is not a plan step — the headless tests cover the logic.
- The `compile:mu` step in Task 5 is required because the `.mu` is precompiled into `.mu.js` (gitignored); editing the `.mu` without recompiling would leave the menu stale.

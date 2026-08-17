# Bump Version command — Design

**Date:** 2026-08-17
**Status:** Approved (brainstorm)

## Goal

Give TODL **producer** projects (meta-model, library) a project-menu command to
bump their published version — the `modelVersion` / `libVersion` on the project
manifest — so an author can cut a new `<id>/<version>/` publish without
hand-editing JSON.

## Motivation

A published library embeds a snapshot of its meta-model; publishing a new
`<id>/<version>/` is how an author ships an updated snapshot (see
`docs/.../todl-project-factory`). Today the only way to change `modelVersion` /
`libVersion` is to edit `project.plexus` by hand. Both producer factories already
default the version to `0.1.0` at create; they need a first-class bump affordance
next to Publish.

## Decisions (locked during brainstorm)

1. **Producers only.** Meta-model (`modelVersion`) and library (`libVersion`)
   carry a version; architecture publishes nothing and has none. The command is
   feature-gated exactly like Publish.
2. **Submenu + Custom.** A `Bump Version ▸` submenu offers Major / Minor / Patch
   (one-click semver increments) plus a `Custom…` entry.
3. **Bump-only in the submenu; opt-in publish in the dialog.** Major/Minor/Patch
   only update the manifest version. `Custom…` opens a dialog with a **Publish**
   checkbox: when checked, the dialog sets the version *and* publishes; unchecked,
   it only sets the version.
4. **Static submenu labels** (`Major`/`Minor`/`Patch`) — no dynamic
   "→ next-version" bindings. The current version is shown in the Custom dialog
   and every action reports its result to the status bar.

## Architecture

Three cooperating units, each independently testable:

1. A factory **capability** (`IVersionedProjectFactory`) that abstracts reading
   and writing the version, so the explorer never learns which manifest key each
   producer uses.
2. A **pure semver helper** (`bumpVersion` / `isValidVersion`) with no I/O.
3. A **dialog view-model** (`SetVersionDialogModel`) for the Custom flow, shown
   through the existing `DialogService`.

The `ProjectExplorerService` wires four feature-gated commands onto `OpenProject`
and orchestrates these units; the `.mu` menu binds them under a `Bump Version`
submenu.

## Components

### `IVersionedProjectFactory` (services/projects/project-factory.ts)

```ts
export interface IVersionedProjectFactory {
    getVersion(storage: IStorage): Promise<string>
    setVersion(storage: IStorage, version: string): Promise<void>
}
export function isVersioned(
    factory: IProjectFactory,
): factory is IProjectFactory & IVersionedProjectFactory {
    const f = factory as Partial<IVersionedProjectFactory>
    return typeof f.getVersion === 'function' && typeof f.setVersion === 'function'
}
```

- `MetaModelProjectFactory` implements it over `manifest.modelVersion`.
- `LibraryProjectFactory` implements it over `manifest.libVersion`.
- Each reads the manifest JSON, returns / assigns only its version field, and
  writes back — every other field (id, metaModel, name, diagrams) is preserved.
  Same read-modify-write shape the base `saveProject` already uses.

### `semver-bump.ts` (services/projects/)

```ts
export enum VersionPart { Major = 'major', Minor = 'minor', Patch = 'patch' }
export function bumpVersion(current: string, part: VersionPart): string
export function isValidVersion(v: string): boolean
```

- **Lenient parse:** split on `.`, `Number(seg) || 0`, pad to three parts. `'5'`
  → `[5,0,0]`, `'0.1.0'` → `[0,1,0]`. Never throws.
- **Bump:** increment the chosen part, zero the lower parts —
  Major `1.2.3`→`2.0.0`, Minor `1.2.3`→`1.3.0`, Patch `1.2.3`→`1.2.4`.
- **`isValidVersion`:** non-empty and safe as a single path segment (it becomes
  the `<id>/<version>/` folder name) — `^[A-Za-z0-9][A-Za-z0-9._-]*$`.

### `SetVersionDialogModel` (services/projects/set-version-dialog-model.ts + .mu template)

A `Model`, same idiom as `NewProjectDialogModel` / `ConfirmDialogModel`:

- `Current: string` (read-only display of the version at open).
- `NewVersion: string` (two-way text, pre-filled with `Current`).
- `Publish: boolean` (checkbox, default `false`).
- `Error: string`, `CanConfirm: boolean` — recomputed on `NewVersion` change:
  `CanConfirm = isValidVersion(NewVersion)`, with `Error` set to a short message
  when invalid.
- `ConfirmCommand` → `close({ version: NewVersion.trim(), publish: Publish })`;
  `CancelCommand` → `close(undefined)`.
- Result type: `export interface SetVersionResult { version: string; publish: boolean }`.

A `DataTemplate[SetVersionDialogModel]` in a `.mu` resource renders the current
line, the text box, the Publish checkbox, an error line, and Cancel/OK.

### `OpenProject` command properties (services/projects/open-project.ts)

Four new `ICommand | undefined` properties mirroring `PublishCommand`:
`BumpVersionMajorCommand`, `BumpVersionMinorCommand`, `BumpVersionPatchCommand`,
`SetVersionCommand` (RegisterProperty + get/set each).

### `ProjectExplorerService` wiring (modules/project-explorer/services/…)

In `wireProjectCommands(op)`, after the Publish command:

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

Methods:

```ts
private async bumpVersion(op: OpenProject, part: VersionPart): Promise<void> {
    if (!isVersioned(op.Factory)) { this.Status = "This project type has no version."; return }
    const next = bumpVersion(await op.Factory.getVersion(op.Storage), part)
    await op.Factory.setVersion(op.Storage, next)
    this.Status = `Version bumped to ${next}.`
}

private async setVersionDialog(op: OpenProject): Promise<void> {
    if (!isVersioned(op.Factory)) { this.Status = "This project type has no version."; return }
    const current = await op.Factory.getVersion(op.Storage)
    const vm = new SetVersionDialogModel(current, (r) => this.dialogs.Close(r))
    const result = (await this.dialogs.Show({ Title: 'Set Version', Content: vm, Width: 380 })) as SetVersionResult | undefined
    if (result === undefined) return
    await op.Factory.setVersion(op.Storage, result.version)
    if (result.publish) { await this.publishProject(op); return }
    this.Status = `Version set to ${result.version}.`
}
```

### `.mu` menu (modules/project-explorer/project-explorer.resources.mu)

Add a `Bump Version` submenu to the project header context menu, next to
`Generate Presentation`, with Major / Minor / Patch items, a separator, and
`Custom…`, bound to the four commands. Register the `SetVersionDialogModel`
template.

## Data flow

Menu item → `RelayCommand` → explorer method → `factory.getVersion/setVersion`
(manifest read-modify-write) → status bar. The Custom path inserts the dialog and
an optional `publishProject` hop.

## Error handling

- Non-versioned factory: guarded in every method and the menu is disabled via
  `canExecute` — belt and suspenders.
- Dialog: `isValidVersion` blocks empty / path-hostile input; `CanConfirm`
  disables OK until valid.
- Publish (Custom + checkbox): reuses `publishProject`, whose existing
  error-to-Problems-dock handling is unchanged.
- `setVersion` write failure surfaces through the normal promise rejection; the
  method is `void`-invoked like the existing commands (consistent with Publish /
  Generate Presentation).

## Testing

- **`semver-bump.test.ts`** — Major/Minor/Patch on `0.1.0` and `1.2.3`;
  lower-part zeroing; lenient `'5'` → `'6.0.0'` (major); `isValidVersion` accepts
  `0.1.0`/`5`/`1.0.0-rc.1` and rejects `''`, `' '`, `../x`, `a/b`.
- **`set-version-dialog-model.test.ts`** — prefill equals `Current`; `CanConfirm`
  false for empty/invalid, true for valid; Confirm closes with
  `{ version, publish }` (trimmed); Cancel closes with `undefined`.
- **Factory tests** — meta-model: `getVersion` returns `modelVersion`,
  `setVersion` updates it and preserves `id`; library: same over `libVersion`
  preserving `id` + `metaModel`; `isVersioned` true for both, false for
  architecture.
- **Explorer test** — `bumpVersion` updates the manifest version on disk;
  `setVersionDialog` with `publish:false` updates only (no backend write);
  `publish:true` routes through publish. (Follow the existing
  `project-explorer-service.test.ts` fixture style; stub the dialog result.)

## Out of scope

- No dynamic next-version labels in the submenu.
- No version display in the project tree (the dialog + status bar suffice).
- No change to publish semantics, the manifest schema beyond the existing version
  fields, or architecture projects.
- No automatic bump-on-publish.

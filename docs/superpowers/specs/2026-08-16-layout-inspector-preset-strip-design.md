# Layout Inspector Preset Strip

**Goal:** Replace the layout inspector's top button rows with a simple strip —
a preset combobox, a Save button, a Delete button, and a Run button — backed by
layout presets persisted as one file per preset in a user-data folder.

## Current state

`layout-inspector.resources.mu` renders (top → bottom): a **Run mode** row
(Positions / Preview buttons), a **primary actions** row (Run / Apply / Cancel),
a **Status** line, then the **Layout stages** list (one ComboBox + params per
strategy slot). `LayoutPipelineService` holds the `PipelineConfiguration`
(`Config`), the `Stages` VMs, the run `Mode`, `Status`, and the
Run/Apply/Cancel/UseMode commands. A `LayoutPresetsStore` exists but persists
through the **settings store** and is not wired to any UI.

## Target UI

The `DataTemplate[LayoutInspector]` header becomes ONE horizontal strip:

```
[ presets ▾ ]   [💾 Save]   [ Delete ]   [▶ Run]
```

- **ComboBox** — read-only. `ItemsSource = $service(LayoutPipelineService).PresetNames`,
  `SelectedItem = $service(LayoutPipelineService).SelectedPreset`. Selecting a
  name loads that preset into the pipeline settings immediately.
- **Save** — a `PanelButton` with the `@Save` icon → `SaveCommand`.
- **Delete** — a `PanelButton` with a `TextBlock "Delete"` (no icon) →
  `DeleteCommand`; `IsEnabled` bound to whether a preset is selected.
- **Run** — a `PanelButton` with the new `@Play` icon → `RunCommand`.

The **Status** line and the **Layout stages** list stay unchanged below the
strip. The Run-mode row and the Apply/Cancel/Positions/Preview buttons are
deleted.

## Behavior

### Run = apply

`Run()` already writes node positions straight to the diagram in the
`'positions'` path. Preview is obsolete and removed: drop `Mode`,
`PreviewPositions`, `applyPreview`, `cancelPreview`, and the
Apply/Cancel/UsePositionsMode/UsePreviewMode commands from
`LayoutPipelineService`. `run-modes.ts`'s preview branch becomes unused; keep
the positions path (and its passing test). `Run()` no longer branches on mode.

### Presets store — folder of files via EnvironmentService

Rewrite `LayoutPresetsStore` to take the `IServiceProvider` and use
`EnvironmentService.UserDataDirectory` + the async `FileSystemService`. Presets
live in `<UserDataDirectory>/layout-presets/`, one `<name>.json` per preset,
each a Fresco `PipelineConfiguration` (plain JSON). API (all async):

- `dir(): string` — `join(env.UserDataDirectory, 'layout-presets')`.
- `names(): Promise<string[]>` — `ListDirectory(dir)`, keep `*.json`, return the
  file stems sorted; a missing directory yields `[]`.
- `get(name): Promise<PipelineConfiguration | undefined>` — read + `JSON.parse`;
  missing file or parse error → `undefined`.
- `save(name, cfg): Promise<string>` — ensure the folder exists, write
  `<safe(name)>.json`, and RETURN the sanitized stem (so the caller can select
  it). `safe()` trims and replaces any char outside `[A-Za-z0-9._-]` with `-`;
  the sanitized stem is the display name.
- `delete(name): Promise<void>` — delete `<safe(name)>.json` (tolerates
  absence).

Filenames use the sanitized name verbatim, so the stem round-trips as the
display name — no separate name field to read.

### Load a preset into settings

`LayoutStageVM.LoadSpec(spec: LayoutStageSpec | undefined): void`:

- `undefined` → `this.Selected = DEFAULT_OPTION` (clears params, emits
  `undefined`).
- otherwise → look up the strategy whose `className` matches `spec.className`
  (reverse of the existing `byName` map; build a `byClassName` map in the ctor).
  If none matches (stale preset) → `DEFAULT_OPTION`. If it matches, set
  `this.Selected = name` (rebuilds param rows at defaults + emits), then for each
  param row whose `Key` appears in `spec.params`, set `row.Value` to the stored
  value — each write fires the row's `onChange`, re-emitting the full
  `{ className, params }` into `Config.layout`.

`LayoutPipelineService`:

- Track a `stageKeys: Map<LayoutStageVM, string>` (stage → `SLOT_CONFIG_KEY`
  value) built alongside the `Stages` in the ctor.
- `PresetNames: ObservableCollection<string>` (registered property, ComboBox
  `ItemsSource`), populated by `refreshPresetNames()` (async) on construction and
  after save/delete.
- `SelectedPreset: string | undefined` (registered property, two-way with the
  ComboBox). Its change handler calls `void LoadPreset(value)` when non-empty.
- `LoadPreset(name): Promise<void>` — `const cfg = await Presets.get(name)`; if
  undefined return; `this.Config = structuredClone(cfg)`; then for each `[stage,
  key]` in `stageKeys`, `stage.LoadSpec(cfg.layout[key])`. Load in `Stages`
  order so the Edge Router's native-routing rule (which disables the Port
  Assigner) settles before the Port Assigner loads.

### Save

`promptPresetName(dialogs, initial): Promise<string | undefined>` and a
`SavePresetPromptModel` (a `Name` string property two-way with a `TextBox`,
`CanConfirm` = non-empty trimmed name, Confirm/Cancel commands calling
`dialogs.Close(name | undefined)`) — modeled exactly on `ViewpointPickerModel` /
`pickViewpoints`, with a `DataTemplate[SavePresetPromptModel]` in the inspector
resources.

`SaveCommand`: `const name = await promptPresetName(dialogs, this.SelectedPreset
?? '')`; if undefined return; `const stem = await Presets.save(name,
this.Config)`; `await refreshPresetNames()`; `this.SelectedPreset = stem`.
Overwrites an existing preset of the same name silently. When no
`DialogService` is available (headless) the command is a no-op.

### Delete

`DeleteCommand`: if `SelectedPreset` is set, `await
Presets.delete(SelectedPreset)`, `await refreshPresetNames()`, then
`this.SelectedPreset = undefined`. The working `Config`/`Stages` are left as-is
(deleting the saved copy does not reset the editor).

### Icon

Add `src/renderer/src/icons/play.svg` (a filled right-pointing triangle) and
register `include "icons/play.svg" as Play` in `plexus-icons.mu`.

## Testing

- **`LayoutPresetsStore`** (async, fake `FileSystemService` mirroring
  `open-projects.test.ts`): save → names → get → delete round-trip; `names()`
  returns sorted stems; a missing folder → `[]`; `safe()` sanitizes an unsafe
  name and the stem round-trips.
- **`LayoutStageVM.LoadSpec`**: a spec restores the strategy AND its param
  values; `undefined` selects `(default)`; an unknown `className` falls back to
  `(default)`.
- **`LayoutPipelineService.LoadPreset`**: clones the preset into `Config` and
  each stage's `Selected` reflects the preset's layout.
- **`promptPresetName` / `SavePresetPromptModel`**: Confirm resolves the typed
  name; Cancel resolves `undefined`; `CanConfirm` is false for an empty/blank
  name.

## Out of scope

- Preset import/export.
- Renaming a preset in place (Save under a new name + Delete the old covers it).
- Migrating the old settings-store presets (the previous store was never wired
  to the UI, so there is nothing user-visible to migrate).

# Save-UX Design

**Date:** 2026-08-31
**Status:** Approved (design) — pending implementation plan

## Problem

Plexus loses unsaved work silently. A `.diagram` document persists geometry,
non-derived connectors, and connector visual state (route/ports) only on an
explicit Ctrl+S or a few opportunistic autosaves (camera, guides, layout,
scope, scenario). There is **no save-on-close and no save-on-quit for
documents** — only chat sessions are flushed on quit (`window.__flushChats`,
`src/main/index.ts`). Closing a dirty diagram tab, or quitting with unsaved
edits, drops those edits with no warning. This surfaced directly out of the
connector-save investigation: the connectors themselves persist, but geometry
and route/port edits made after the last save are lost on close.

## Goal

Eliminate silent loss of unsaved work through three coordinated capabilities,
all keyed off the existing `IDocument.IsDirty` contract:

1. **Periodic autosave** — configurable interval (default 5 min), on/off toggle,
   both editable in Settings.
2. **Tab-close prompt** — when closing a dirty document, ask Save / Don't Save /
   Cancel.
3. **App-quit prompt** — when quitting with unsaved documents, one consolidated
   Save All / Discard All / Cancel dialog; Cancel aborts the quit.

Manual save (Ctrl+S / Ctrl+Shift+S) already exists and is unchanged.

## Confirmed decisions

- Autosave default: **on, 5-minute interval** (user-configurable).
- Quit prompt: **one consolidated dialog** for all dirty documents (not
  per-document sequential).

## Background — verified seams

All confirmed by reading the code/framework before design:

- **`IDocument` contract** (`@pragmatic-tech-ai/mural/framework`):
  `Id`, `Title`, `IsDirty: boolean`, `Save(): void | Promise<void>`.
- **`DiagramDocument`** (`dist/framework/diagram/diagram-document.js`) flips
  `IsDirty` via a private `_markDirty()` wired to node / connector / container /
  endpoint / pen edits, and clears it in `Save()`. So diagram geometry and
  connector edits — the motivating case — DO participate in dirty tracking.
- **`CodeDocument`** sets `IsDirty` by comparing editor content to
  `savedContent`; clears it in `Save()` after writing the file.
- **Read-only docs** (`MarkdownDocument`, `SettingsPage`, chat/task-output docs)
  hardcode `IsDirty = false` and a no-op `Save()`, so they never prompt.
- **`DocumentsContentHostService`** (`ContentHostService.Key`) exposes:
  `OpenDocuments` (`ObservableCollection<IDocument>`), `ActiveDocument` (DP
  `ActiveDocumentKey`), `Open(doc)`, `Close(doc)`, `CloseById(id)`,
  `CloseAll()`, `Save(doc?)`, `SaveAll(): Promise<void>`, and commands
  `CloseDocumentCommand`, `CloseAllCommand`, `SaveActiveCommand`,
  `SaveAllCommand`. There is **no built-in "closing" veto hook** — interception
  is done by re-pointing the close affordances to a Plexus guard command.
- **Close affordances today** bind directly to
  `$service(ContentHostService).CloseDocumentCommand` /
  `CloseAll` in `document-tabs.resources.mu` (tab ✕ and overflow dropdown).
  `ProjectExplorerService.closeProject()` calls `host.Close(doc)` directly in a
  loop. There is no Ctrl+W today; Ctrl+S/Ctrl+Shift+S are wired in
  `services/documents/save-shortcuts.ts` at window capture phase.
- **Settings** are declared as `SettingDefinition` entries in a module's
  `.settings:` block (e.g. `diagram.grid.show` in `diagram.module.mu`) with
  `Key / Label / Description / Kind / Default / Min / Max / Category / Choices`.
  `ApplicationSettings` (framework, auto-provided by `EditorShell`) builds live
  `Setting` objects. Read via `settings.Get(key)` (value) or
  `settings.GetSetting(key)` (the `Setting`, whose `Value` is a DP);
  subscribe via
  `settings.GetSetting(key)?.AddPropertyChangedListener(Setting.ValueKey, cb)`.
  New definitions auto-render in the existing Settings page grouped by
  `Category`. Persistence flows renderer `ElectronSettingsStore` →
  `SettingsChannel.Save` → main `settings.ts` → `userData/settings.json`.
- **Dialogs**: `DialogService` (framework) has
  `Show<T>(options): Promise<T | undefined>` where `Content` is a view-model and
  the model calls `dialogs.Close(result)`. `ConfirmDialogModel`
  (`services/dialogs/confirm-dialog-model.ts`) is the two-button precedent; a
  three-button model is a small extension. Resolves `undefined` on
  Escape/scrim.
- **Quit path** (`src/main/index.ts`): the window `'close'` handler
  `preventDefault()`s once (`flushed` guard), runs
  `window.__flushChats()` via `executeJavaScript` racing a 2 s timeout, then
  re-issues `close()`. Preload exposes `window.api`; renderer attaches
  `window.__flushChats` for main to call. Same mechanism reused for documents.
- **Timer precedent**: `DiagramCameraService` / `DiagramGuidesService` use
  `setTimeout` debounce + teardown-on-close in the renderer. `setInterval` is
  fine in the renderer (the `Date.now()`/timer prohibition is main-process only).

## Architecture

Four units, each with one responsibility and a clean interface.

### Unit A — Autosave settings (declarative)

Two `SettingDefinition`s, Category **"Documents"**, added to an app-level
`.settings:` block (new tiny `save.module.mu`, or the app's own settings block
if it has one — see plan):

| Key | Kind | Default | Range |
| --- | --- | --- | --- |
| `documents.autosave.enabled` | Boolean | `true` | — |
| `documents.autosave.intervalMinutes` | Number | `5` | Min 1, Max 120 |

No UI code — they render automatically in the Settings page under "Documents".

### Unit B — `AutosaveService` (renderer, root-registered)

Injects `ApplicationSettings` and `DocumentsContentHostService`. Owns a single
`setInterval`.

- On construction and whenever either setting's `Value` changes
  (`AddPropertyChangedListener(Setting.ValueKey, …)`), (re)compute the timer:
  clear any existing interval; if `enabled`, start
  `setInterval(tick, intervalMinutes * 60_000)`.
- `tick()`: for each `doc` in `host.OpenDocuments`, if `doc.IsDirty` call
  `host.Save(doc)` (which routes to the doc's `Save()`; the diagram storage
  writes asynchronously — no need to await inside the tick).
- Guard against re-entrancy (skip a tick already in progress) and clean up the
  interval on dispose.

Interface consumed by nothing else; it is a self-contained background service.

### Unit C — `SavePromptModel` + `DocumentCloseGuard` (renderer)

**`SavePromptModel`** — a three-button dialog view-model (sibling to
`ConfirmDialogModel`) with commands `SaveCommand`, `DontSaveCommand`,
`CancelCommand`, each invoking a `close(result: SavePromptResult)` callback.
`SavePromptResult` is a **real enum**: `Save | DontSave | Cancel`. A helper
`promptSaveOnClose(dialogs, title, message)` shows it and maps `undefined`
(Escape/scrim) to `Cancel`. Its template lives in a `.resources.mu`
(`DataTemplate [DataType = SavePromptModel]`) — no hardcoded chrome.

**`DocumentCloseGuard`** — a service exposing `CloseDocumentCommand` and
`CloseAllCommand` (ICommand) plus a `TryCloseDocument(doc): Promise<boolean>`
method (returns `true` if the doc was closed, `false` if cancelled):

- If `!doc.IsDirty` → `host.Close(doc)`, return `true`.
- Else `promptSaveOnClose(...)`:
  - `Save` → `await host.Save(doc)`, then `host.Close(doc)`, return `true`.
  - `DontSave` → `host.Close(doc)`, return `true`.
  - `Cancel` → do nothing, return `false`.
- `CloseAllCommand` / a `TryCloseAll()` iterate open docs calling
  `TryCloseDocument`; stop early on the first `false` (Cancel aborts the batch).

Re-point every close affordance to the guard:
- `document-tabs.resources.mu`: tab ✕ and overflow dropdown Close/Close-All bind
  `$service(DocumentCloseGuard).CloseDocumentCommand` / `CloseAllCommand`.
- `ProjectExplorerService.closeProject()`: route its per-doc close through
  `DocumentCloseGuard.TryCloseDocument` (respecting Cancel — a cancelled doc
  aborts the project close).
- Add **Ctrl+W** in `save-shortcuts.ts` (or a sibling) firing the guard's
  `CloseDocumentCommand` for the active document.

### Unit D — Quit guard (renderer + main)

**Renderer** attaches `window.__confirmCloseDocs(): Promise<boolean>` (next to
`__flushChats`, same registration site):
- Collect dirty docs from `host.OpenDocuments`. None → resolve `true`.
- Else show **one consolidated** `SavePromptModel`-style dialog (Save All /
  Discard All / Cancel — same `SavePromptResult` enum, reworded labels):
  - `Save` → `await host.SaveAll()`, resolve `true`.
  - `DontSave` (Discard All) → resolve `true`.
  - `Cancel` → resolve `false`.

**Main** (`src/main/index.ts` `'close'` handler): before the existing
chat-flush, `await window.__confirmCloseDocs()`:
- `false` → cancel the quit: do **not** call `mainWindow.close()`, and reset the
  `flushed` guard to `false` so a later close attempt runs the flow again.
- `true` → proceed to the existing `__flushChats()` (keep its 2 s timeout) and
  then `mainWindow.close()`.
The document confirm gets **no timeout** (the user is interacting); only the
chat flush keeps its bounded race.

## Data flow

```
Autosave:   interval tick → host.OpenDocuments → dirty? → host.Save(doc)
Tab close:  ✕ / Ctrl+W → DocumentCloseGuard → dirty? → SavePromptModel
                        → Save|DontSave|Cancel → host.Save/Close / abort
Quit:       main 'close' → window.__confirmCloseDocs() → dirty set?
                        → consolidated dialog → SaveAll|Discard|Cancel
                        → true (proceed to __flushChats + close) | false (abort)
```

## Error handling

- `host.Save(doc)` rejection during autosave: swallow per-doc (log), continue
  the tick; a transient write failure must not kill the timer.
- `host.Save(doc)` rejection during a close/quit **Save**: do **not** close the
  doc / proceed with quit; surface the failure (leave the tab open, dirty).
  Better to keep the work than to close after a failed save.
- `__confirmCloseDocs` throwing in the renderer: main treats a rejected/thrown
  confirm as **Cancel** (safer than closing on an unknown state), mirroring the
  existing `__flushChats` `.catch(() => undefined)` defensiveness but biased to
  not-close.
- Read-only docs (`IsDirty === false`) never prompt and never autosave.

## Testing strategy

**Unit (Vitest, `tests/` subfolders):**
- `AutosaveService`: fake timers — fires at the configured interval; disabled
  toggle stops it; interval change reschedules; only `IsDirty` docs are saved;
  a save rejection doesn't stop later ticks.
- `SavePromptModel`: each command invokes `close` with the correct
  `SavePromptResult`; `promptSaveOnClose` maps `undefined` → `Cancel`.
- `DocumentCloseGuard.TryCloseDocument`: clean doc closes without prompt;
  Save → save-then-close; DontSave → close-without-save; Cancel → no close, and
  a failed Save leaves the doc open.
- `__confirmCloseDocs` decision logic: no dirty → `true` without a dialog;
  Save → SaveAll + `true`; Discard → `true`; Cancel → `false`.

**e2e (Playwright, `e2e/`):**
- Dirty a diagram (move a node); close the tab → prompt appears; Save persists
  to disk and closes; Don't Save closes with disk unchanged; Cancel keeps the
  tab dirty and open.
- Autosave: set the interval setting to a tiny value in-test, dirty a doc, wait,
  assert the `.diagram` on disk updated without any manual save.
- Quit path: with a dirty doc, driving the window close triggers the consolidated
  prompt; Cancel leaves the window open.

## Out of scope

- Recovery/backup files or crash recovery (autosave writes in place).
- Per-document autosave overrides (single global interval).
- Changing what a diagram serializes (covered by the connector-save work).

## Files (anticipated)

- `src/renderer/src/modules/save/save.module.mu` (new) — `.settings:` block, or
  fold into an existing app-level settings host if present.
- `src/renderer/src/services/autosave/autosave-service.ts` (new) + tests.
- `src/renderer/src/services/dialogs/save-prompt-model.ts` (new) +
  `save-prompt.resources.mu` + tests.
- `src/renderer/src/services/documents/document-close-guard.ts` (new) + tests.
- `src/renderer/src/services/documents/save-shortcuts.ts` (modify — add Ctrl+W).
- `src/renderer/src/services/document-tabs/document-tabs.resources.mu` (modify —
  re-point close bindings).
- `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts`
  (modify — route project-close through the guard).
- `src/renderer/src/app.mu` (modify — register `AutosaveService`,
  `DocumentCloseGuard`, merge new resources; attach `__confirmCloseDocs`).
- `src/main/index.ts` (modify — await `__confirmCloseDocs` in the close handler).

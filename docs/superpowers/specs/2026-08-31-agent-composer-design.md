# VSCode-style Agent Composer — Design

**Status:** Approved shape (2026-08-31). Awaiting spec review before planning.

## Goal

Redesign the agent-chat prompt control in Plexus to match the Claude prompt in
the VSCode extension: a single rounded composer card with a multiline
auto-growing input (Enter sends, Shift+Enter newline), a placeholder, a keybind
hint, an in-card **model picker**, and an **add-files/folders-to-context**
affordance with removable chips.

## Context (current state)

- **Prompt view** — [agent-chat.resources.mu:39-44](../../../src/renderer/src/modules/agent-chat/agent-chat.resources.mu#L39-L44):
  a bare single-line `TextBox [Text=$Draft]` + a `PanelButton` (↑ icon) in a
  `DockPanel`. Enter-to-send is a `KeyDown → InvokeCommand $SubmitCommand`
  trigger on the enclosing input-row `DockPanel` (the single-line box leaves
  Return unhandled, so KeyDown bubbles). `SubmitCommand` sends only on `Key.Return`.
- **VM** — [chat-session.ts](../../../src/renderer/src/modules/agent-chat/services/chat-session.ts):
  `ChatSession` exposes `Draft` (two-way), `CanInput`, `SendCommand`,
  `SubmitCommand`, `Transcript`, etc. No model or context state.
- **Send path** — `ChatSession.send()` → `callbacks.send(sessionId, text)` →
  [chat-sessions-service.ts:166](../../../src/renderer/src/modules/agent-chat/services/chat-sessions-service.ts#L166)
  `this.agent.sendTurn(id, this.currentCwd(), this.addDirs(), text)`. `currentCwd()`
  = first open project; `addDirs()` = the remaining open projects.
- **Main lifecycle** — [agent-session.ts](../../../src/main/agent/agent-session.ts):
  `AgentSession` holds one live provider session with a `target = {cwd, addDirs}`.
  `send()` **respawns** when the target differs (`sameTarget`), and respawn
  **preserves the resume token** (`this.resumeToken` is retained across `start()`
  unless a new one is passed; `SessionStarted` updates it). So changing the target
  reconnects the same CLI conversation via `--resume`.
- **Provider** — [claude-cli-provider.ts](../../../src/main/agent/claude-cli-provider.ts):
  `start(sessionId, workingDirectory, addDirs, onEvent, resumeToken?)` spawns
  `claude` with `addDirs.flatMap(d => ['--add-dir', d])`. No `--model` today.
- **Pickers** — [filesystem.ts](../../../src/main/filesystem.ts) already exposes
  `OpenFile`, `OpenFiles`, `OpenFolder` IPC via `IFileSystemApi`.
- **Framework** — mural `TextBox` has `AcceptsReturn` (Return inserts `\n` when
  true), `TextWrapping`, `Variant`; **no placeholder**. `Visual` has
  `MaxHeight`/`MinHeight`. mural `ComboBox` (framework/list/combo-box.js) extends
  `Selector` (`ItemsSource`/`SelectedItem`), is markup-registered, has
  `Placeholder`/`IsDropDownOpen`.

## Global Constraints

- **Render through templates only** — all chat chrome stays in
  `agent-chat.resources.mu`; no hardcoded visuals in TS.
- **Enums, never string-literal unions** — the model list is a real `enum`
  (member = CLI alias string value). Markup-facing mural enums also register in
  the compiler `ENUM_MEMBERS` + `DEFAULT_SYMBOLS`.
- **Tests in a `tests/` subfolder** next to source.
- **`compile:mu` is ground truth**; IDE LSP false-positives (`Border.Fill "not
  registered"`, unknown `PanelDockService`) are ignored.
- **No `Date.now()`/`setInterval`** in main-process code.
- Mural changes ship via Verdaccio: bump version → `npm run build` → publish →
  Plexus `npm install @pragmatic-lab/mural@X` → `npm run build`.
- MVVM in the renderer: view-observable state on DPs; no view-tree reads from VMs.

## Design

### Piece 1 — mural `TextBox`: submit-on-Enter + placeholder

Additive; unset = today's behavior.

**`SubmitsOnEnter`** (bool DP, default `false`, `MetaData.None`). In `OnKeyDown`,
`case Key.Return` becomes:

```ts
case Key.Return:
    if (this.AcceptsReturn && !this.IsReadOnly)
    {
        // Submit mode: plain Return bubbles (no newline) so an ancestor
        // KeyDown trigger can send; Shift+Return still inserts a newline.
        if (this.SubmitsOnEnter && !shift) return;   // leave unhandled
        this.insertText('\n');
        args.Handled = true;
    }
    return;
```

(`shift` is already computed at the top of `OnKeyDown`.) This reuses the app's
existing `KeyDown → SubmitCommand` trigger unchanged — the multiline box now
leaves plain Return unhandled exactly like the single-line box did.

**`Placeholder`** (string DP, default `''`, `MetaData.Measure | MetaData.Render`)
+ **`PlaceholderBrush`** (Brush DP, default a muted brush; the app passes
`@OnSurfaceVariant`). In `RenderOverride`, when the text is empty, draw the
placeholder string with `PlaceholderBrush` at the text origin (same baseline the
editor uses). No layout change — placeholder never affects `DesiredSize`.

Tests (`src/basic/tests/text-box.test.ts`): Return-submits-when-`SubmitsOnEnter`
(no `\n` inserted, event unhandled), Shift+Return-inserts-newline, default
(unset) still inserts `\n` and handles; placeholder draws when empty and not when
non-empty (assert via the render/measure seam already used by the TextTrimming
tests — `HeadlessTarget` + a fake measurer).

### Piece 2 — the composer card (`agent-chat.resources.mu`, view only)

Replace the bottom input `DockPanel` (lines 39-44) with a rounded card. The
enclosing `DataTemplate[ChatSession]` keeps its `resources { Style[DockPanel] { on
KeyDown → SubmitCommand } }` so Enter still submits from inside the card.

```
Border [ DockPanel.Dock = Bottom, Margin = (0,8,0,0),
         Fill = @SurfaceContainerHigh, Stroke = Pen[Brush=@OutlineVariant],
         CornerRadius = 12, Padding = (10,8,10,8), ClipToBounds = true ] {
    DockPanel [ LastChildFill = true ] {
        // Context chips (only when non-empty). Horizontal wrap of removable chips.
        ItemsControl [ DockPanel.Dock = Top, ItemsSource = $ContextItems,
                       ItemsPanel = @HorizontalWrapPanel, Visibility = $HasContext << ToVisibility,
                       ItemTemplate = @ContextChipTemplate, Margin = (0,0,0,6) ]
        // Footer row (bottom): add-context + model on the left, send on the right.
        DockPanel [ DockPanel.Dock = Bottom, LastChildFill = false, Margin = (0,8,0,0) ] {
            PanelButton [ DockPanel.Dock = Left, Command = $AddContextCommand, Margin = (0,0,6,0) ] {
                Shape [ Geometry = @AddIcon, Width = 16, Height = 16, Fill = @OnSurfaceVariant ]
            }
            ComboBox [ DockPanel.Dock = Left, ItemsSource = $Models, SelectedItem = $SelectedModel,
                       Placeholder = "Model" ]
            TextBlock [ DockPanel.Dock = Left, Style = @BodySmall, VerticalAlignment = Center,
                        Foreground = @OnSurfaceVariant, Margin = (10,0,0,0),
                        Text = "↵ send   ⇧↵ newline" ]
            PanelButton [ DockPanel.Dock = Right, Command = $SendCommand, IsEnabled = $CanInput ] {
                Shape [ Geometry = @ArrowUpward, Width = 20, Height = 20, Fill = @OnSurfaceVariant ]
            }
        }
        // The input fills the middle; caps height and scrolls past the cap.
        ScrollViewer [ HorizontalScrollEnabled = false, MaxHeight = 200 ] {
            TextBox [ Text = $Draft, IsEnabled = $CanInput, AcceptsReturn = true,
                      SubmitsOnEnter = true, TextWrapping = Wrap,
                      Placeholder = "Ask Claude anything…", PlaceholderBrush = @OnSurfaceVariant ]
        }
    }
}
```

Notes:
- `@AddIcon` — add a `+` glyph to `plexus-icons.mu` if none exists (reuse an
  existing plus/attach geometry if present).
- `@HorizontalWrapPanel` — confirm an existing wrap-panel resource key; else use
  the toolbox's `@DiagramToolboxPanel` pattern or a `WrapPanel`.
- `MaxHeight = 200` bounds auto-grow; the `TextBox` measures to content and the
  `ScrollViewer` scrolls beyond the cap. (Auto-hide scrollbars already app-wide.)

**`ContextChipTemplate`** (`DataTemplate x:key`, `DataType = ContextItemVM`): a
small pill — file/folder glyph + `$Name` + an ✕ `PanelButton [Command=$RemoveCommand]`.

### Piece 3 — model picker (VM + IPC + provider + main session)

**Model enum** (renderer, next to `ChatSession`): `enum AgentModel { Default =
'', Opus = 'opus', Sonnet = 'sonnet', Haiku = 'haiku' }` with a parallel display
list (`{ Label, Value }`) exposed as `ChatSession.Models`. `--model` accepts these
aliases; `Default` (empty) omits the flag. (Confirm alias set against the
installed CLI during Task-0 spike; fall back to full model IDs if aliases are
rejected.)

**VM** — `ChatSession` gains:
- `Models: ObservableCollection<ModelOption>` (seeded from the enum; `ModelOption`
  = `{ Label: string, Value: AgentModel }`).
- `SelectedModel: ModelOption` (two-way DP; default = the `Default` option).
- `Model(): string` helper returning `SelectedModel.Value`.

`ChatSession.send()` is unchanged in shape; the model reaches the backend through
the callback (below), read from the VM at send time.

**Callbacks/service** — `ChatSessionCallbacks.send` stays `(id, text)`; the
service reads the model + context from the session it looks up by id (it already
looks sessions up for `close`). `ChatSessionsService.callbacks().send` becomes:

```ts
send: (id, text) => {
    const s = this.sessionById(id)
    void this.agent.sendTurn(id, this.currentCwd(), this.contextDirsFor(s), text, s?.Model() ?? '')
},
```

`startSession` calls likewise pass the session's model (or `''`).

**IPC** — extend `IAgentApi.sendTurn`/`startSession` with a trailing
`model: string` (default `''`), the preload bridge forwards it, and the main
`SendTurn`/`StartSession` handlers pass it to `AgentSession`.

**Main session** — `AgentSession.target` becomes `{cwd, addDirs, model}`;
`start`/`send` accept `model`; `sameTarget` compares it too. Model change ⇒
respawn ⇒ `--resume` preserves history (identical to the addDirs path).

**Provider** — `IAiProvider.start` + `ClaudeCliProvider.start` accept `model?:
string`; when non-empty, args include `'--model', model`.

### Piece 4 — add files/folders to context (VM + service; reuses existing IPC)

**`ContextItemVM`** (renderer): `{ Path, Name, IsFolder, Dir, RemoveCommand }`.
`Dir` = the directory to pass to `--add-dir` (the folder itself, or a file's
parent dir). `Name` = basename for the chip.

**VM** — `ChatSession` gains `ContextItems: ObservableCollection<ContextItemVM>`,
`HasContext: bool` (kept in sync on add/remove), and `AddContextCommand`.
`AddContextCommand` is a thin relay that calls an injected callback
`callbacks.addContext(sessionId)` (the VM must not touch `window.api` directly).

**Service** — `ChatSessionsService`:
- `addContext(id)` — shows a small chooser (file vs folder) or two entries; calls
  `IFileSystemApi.OpenFile`/`OpenFolder`; for each pick, appends a `ContextItemVM`
  to the session (`Dir` = folder path, or `dirname(file)` for a file; dedupe by
  `Dir`).
- `contextDirsFor(session)` — returns `[...this.addDirs(), ...session unique
  ContextItems.Dir]` (deduped). Used by both `send` and `startSession`.

The existing respawn-on-target-change picks up the new dirs; no new main-process
lifecycle code. A file outside the cwd becomes readable because its parent dir is
added via `--add-dir`.

**Persistence (v1 scope):** `SelectedModel` and `ContextItems` are session-runtime
state, **not** persisted to `ChatStore` in v1 (a reopened conversation resets to
Default model / no extra context). Persisting them is a follow-up.

## Testing strategy

- **mural** — unit tests for `SubmitsOnEnter` (3 cases) + `Placeholder`
  render/measure (2 cases) in `src/basic/tests/text-box.test.ts`.
- **renderer VM** — `chat-session.test.ts`: `Models` seeded + default selection;
  `Model()` returns the selected alias; add/remove `ContextItems` updates
  `HasContext`; a file pick stores its parent dir as `Dir`.
- **service** — `chat-sessions-service.test.ts`: `send` forwards the session's
  model + merged context dirs; `contextDirsFor` dedupes.
- **provider** — `claude-cli-provider.test.ts`: `--model` present when set, absent
  when `''`; `--add-dir` for each context dir.
- **main session** — `agent-session.test.ts`: model change triggers respawn with
  the retained resume token; same model + dirs does not respawn.
- **e2e (live)** — `agent-composer.spec.ts`: the composer card renders; the model
  `ComboBox` and `＋` button exist; typing + Shift+Enter keeps focus/newline;
  0 app errors. (Enter-sends is covered by unit tests; live send is out of scope.)

## Risks / open items (pinned during Task 0 spike)

1. **`--model` aliases** — verify `opus`/`sonnet`/`haiku` are accepted by the
   installed CLI; else use full IDs from the enum values (only the enum values
   change).
2. **Model-change-on-resume** — confirm the CLI honors a different `--model` on
   `--resume` without erroring. If it rejects mid-conversation model swaps, scope
   the model to session start only (picker disabled after the first turn) — a
   smaller v1.
3. **`MaxHeight` auto-grow** — confirm `ScrollViewer[MaxHeight]` clamps a
   content-measured `TextBox`; else bound the `TextBox` directly.
4. **Wrap-panel + `+` icon resource keys** — confirm existing keys or add them.

## Out of scope (follow-ups)

- Agent/Plan (`--permission-mode plan`) mode toggle.
- Image/media attach in the composer (media-drop already exists elsewhere).
- Persisting model + context selection across reopen.
- `@`-mention inline file autocomplete.

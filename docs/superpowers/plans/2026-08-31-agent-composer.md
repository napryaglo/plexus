# VSCode-style Agent Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the agent-chat prompt with a VSCode-style composer card — multiline auto-grow input (Enter sends / Shift+Enter newline), placeholder, keybind hint, in-card model picker, and add-files/folders-to-context chips.

**Architecture:** Two mural `TextBox` DPs (`SubmitsOnEnter`, `Placeholder`) shipped via Verdaccio; the rest is Plexus. Model and context are threaded through the existing `sendTurn`/`startSession` IPC → `AgentSession` target → provider; both reuse the existing respawn-on-target-change path (which preserves the CLI `--resume` token), so no new main-process lifecycle is written.

**Tech Stack:** mural (TS visual framework, `.mu` markup), Plexus (Electron + electron-vite), Vitest (renderer/main), node:test (mural), Playwright (`_electron`) for live e2e.

**Spec:** [docs/superpowers/specs/2026-08-31-agent-composer-design.md](../specs/2026-08-31-agent-composer-design.md)

## Global Constraints

- **Render through templates only** — chat chrome lives in `agent-chat.resources.mu`; no hardcoded visuals in TS.
- **Enums, never string-literal unions** — `AgentModel` is a real `enum` (member value = CLI alias). Markup-facing mural enums register in `symbol-table.ts` `ENUM_MEMBERS` + `DEFAULT_SYMBOLS` (not needed here — `SubmitsOnEnter`/`Placeholder` are bool/string, not enums).
- **Every test file in a `tests/` subfolder** next to source.
- **`compile:mu` is ground truth** — ignore IDE LSP false-positives (`Border.Fill "not registered"`, unknown `PanelDockService`).
- **No `Date.now()`/`setInterval`** in main-process code.
- **Mural publish loop:** bump `Mural/package.json` version → `cd Mural && npm run build` → `npm publish --registry http://localhost:4873/` → `cd Plexus && npm install @pragmatic-lab/mural@X --registry http://localhost:4873/` → `npm run build`.
- **MVVM (renderer):** view-observable state on DPs; VMs never read the view tree or touch `window.api` (inject via callbacks); no host globals in VMs.
- Commits: author Eugene Napryaglo <evgen.napryaglo@gmail.com>; end message with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Work on `main`, push origin/main when the user asks.

## File Structure

**mural (`Mural/`):**
- Modify: `src/basic/text-box.ts` — add `SubmitsOnEnter` + `Placeholder` + `PlaceholderBrush` DPs, Return branch, placeholder render.
- Modify: `src/basic/tests/text-box.test.ts` — new cases.
- Modify: `Mural/package.json` — version bump.

**Plexus shared/main (`Plexus/src`):**
- Modify: `shared/agent-api.ts` — `sendTurn`/`startSession` gain trailing `model`.
- Modify: `preload/index.ts` — forward `model`.
- Modify: `main/agent.ts` (IPC handlers) — pass `model` through.
- Modify: `main/agent/agent-session.ts` — `target` gains `model`; `sameTarget` compares it.
- Modify: `main/agent/ai-provider.ts` — `IAiProvider.start` gains `model?`.
- Modify: `main/agent/claude-cli-provider.ts` — `--model` arg.
- Tests: `main/agent/tests/agent-session.test.ts`, `main/agent/tests/claude-cli-provider.test.ts`.

**Plexus renderer (`Plexus/src/renderer/src/modules/agent-chat`):**
- Create: `services/agent-model.ts` — `AgentModel` enum + `ModelOption` + default list.
- Create: `services/context-item.ts` — `ContextItemVM`.
- Modify: `services/chat-session.ts` — `Models`, `SelectedModel`, `Model()`, `ContextItems`, `HasContext`, `AddContextCommand`; extend `ChatSessionCallbacks` with `addContext`.
- Modify: `services/chat-sessions-service.ts` — `sessionById`, `contextDirsFor`, `addContext`, thread model into `send`/`startSession`.
- Modify: `agent-chat.resources.mu` — the composer card + `ContextChipTemplate`.
- Modify: `plexus-icons.mu` — `@AddIcon` if absent.
- Tests: `services/tests/chat-session.test.ts`, `services/tests/chat-sessions-service.test.ts`.
- e2e: `e2e/agent-composer.spec.ts`.

## Interfaces (locked signatures)

- `enum AgentModel { Default = '', Opus = 'opus', Sonnet = 'sonnet', Haiku = 'haiku' }`
- `interface ModelOption { Label: string; Value: AgentModel }`; `DEFAULT_MODELS: ModelOption[]`.
- `ChatSession.Model(): string` → selected alias (`''` for Default).
- `ContextItemVM { Path: string; Name: string; IsFolder: boolean; Dir: string; RemoveCommand: ICommand }`.
- `ChatSessionCallbacks.addContext(sessionId: string): void` (new).
- IPC: `startSession(sessionId, workingDirectory, addDirs, resumeToken?, model?)`, `sendTurn(sessionId, workingDirectory, addDirs, text, model?)` — `model` trailing + optional (default `''`) to keep call sites compiling.
- `IAiProvider.start(sessionId, workingDirectory, addDirs, onEvent, resumeToken?, model?)`.
- `AgentSession.start(workingDirectory, addDirs, resumeToken?, model?)`, `AgentSession.send(workingDirectory, addDirs, text, model?)`.

---

### Task 0: Spike — verify CLI `--model` aliases + resume behavior

**Files:** none (throwaway shell checks).

- [ ] **Step 1: Confirm alias set.** Run `claude --help` (or `claude -p --model opus 'say hi' --output-format json` with a trivial prompt in a scratch dir) to confirm `opus`/`sonnet`/`haiku` are accepted. If rejected, capture the accepted full model IDs.
- [ ] **Step 2: Confirm model-on-resume.** Start a `claude -p --output-format stream-json --input-format stream-json` session, capture its session id, then `--resume <id> --model <other>` and send a turn. Verify no error.
- [ ] **Step 3: Record findings.** If aliases work and resume honors `--model`: proceed as specced. If resume rejects a model swap: set `AgentModel` values to full IDs (aliases fine) AND note in Task 7 that the picker disables after the first turn (scope model to session start). Update the spec's "Risks" section with the resolved answers.

**Verification:** a one-paragraph note in the spec's Risks section stating the resolved alias set and resume behavior. No code yet.

---

### Task 1: mural `TextBox.SubmitsOnEnter`

**Files:**
- Modify: `Mural/src/basic/text-box.ts`
- Test: `Mural/src/basic/tests/text-box.test.ts`

**Interfaces:**
- Produces: `TextBox.SubmitsOnEnter` (bool DP, default false) — when true + `AcceptsReturn`, plain Return is left unhandled (no `\n`); Shift+Return inserts `\n`.

- [ ] **Step 1: Write failing tests.** In `text-box.test.ts`, add a `describe('TextBox — SubmitsOnEnter')`:

```ts
test('Return is left unhandled and inserts no newline when SubmitsOnEnter', () => {
    const tb = new TextBox();
    tb.AcceptsReturn = true;
    tb.SubmitsOnEnter = true;
    tb.Text = 'hi';
    const args = keyDown(Key.Return, NoModifiers);   // helper mirroring existing key tests
    tb.dispatchKeyDown(args);
    assert.equal(tb.Text, 'hi');
    assert.equal(args.Handled, false);
});

test('Shift+Return inserts a newline even when SubmitsOnEnter', () => {
    const tb = new TextBox();
    tb.AcceptsReturn = true;
    tb.SubmitsOnEnter = true;
    tb.Text = 'hi';
    tb.CaretIndex = 2;
    const args = keyDown(Key.Return, ModifierKeys.Shift);
    tb.dispatchKeyDown(args);
    assert.equal(tb.Text, 'hi\n');
    assert.equal(args.Handled, true);
});

test('default (SubmitsOnEnter unset) inserts a newline and handles Return', () => {
    const tb = new TextBox();
    tb.AcceptsReturn = true;
    tb.Text = 'hi';
    tb.CaretIndex = 2;
    const args = keyDown(Key.Return, NoModifiers);
    tb.dispatchKeyDown(args);
    assert.equal(tb.Text, 'hi\n');
    assert.equal(args.Handled, true);
});
```

Use the existing test file's key-dispatch helper/pattern (match how current `OnKeyDown` tests build `KeyEventArgs` and invoke — mirror them exactly; do not invent a new harness).

- [ ] **Step 2: Run tests — expect FAIL** (`SubmitsOnEnter` undefined).
  Run: `cd Mural && npx tsx --conditions=development --test --test-force-exit src/basic/tests/text-box.test.ts`
- [ ] **Step 3: Implement.** Add the DP + accessors near `AcceptsReturnKey`:

```ts
public static readonly SubmitsOnEnterKey = MuralBase.RegisterProperty<boolean>(TextBox, 'SubmitsOnEnter', false, MetaData.None);
public get SubmitsOnEnter(): boolean { return this.get_property_value(TextBox.SubmitsOnEnterKey); }
public set SubmitsOnEnter(v: boolean) { this.set_property_value(TextBox.SubmitsOnEnterKey, v); }
```

Update the `case Key.Return` branch in `OnKeyDown`:

```ts
case Key.Return:
    if (this.AcceptsReturn && !this.IsReadOnly)
    {
        if (this.SubmitsOnEnter && !shift) return;   // bubble to an ancestor submit trigger
        this.insertText('\n');
        args.Handled = true;
    }
    return;
```

- [ ] **Step 4: Run tests — expect PASS.** Also run the full `text-box.test.ts` to confirm no regression.
- [ ] **Step 5: Commit.** `git add Mural/src/basic/text-box.ts Mural/src/basic/tests/text-box.test.ts && git commit`.

---

### Task 2: mural `TextBox.Placeholder`

**Files:**
- Modify: `Mural/src/basic/text-box.ts`
- Test: `Mural/src/basic/tests/text-box.test.ts`

**Interfaces:**
- Produces: `TextBox.Placeholder` (string, default `''`) + `TextBox.PlaceholderBrush` (Brush) — drawn when `Text` is empty; never affects `DesiredSize`.

- [ ] **Step 1: Write failing tests.** Mirror the TextTrimming test setup (`HeadlessTarget` + a fake measurer, per `project_text_trimming` memory). Assert: with empty `Text` and a `Placeholder`, the render pass emits the placeholder string through the draw seam; with non-empty `Text`, it does not; and `Measure` returns the same `DesiredSize` whether or not a `Placeholder` is set (placeholder is render-only for sizing). Inspect via whatever draw-capture the existing render tests use (e.g. a recording `DrawingContext`); do not assert on private fields.
- [ ] **Step 2: Run tests — expect FAIL.**
- [ ] **Step 3: Implement.** Add DPs:

```ts
public static readonly PlaceholderKey = MuralBase.RegisterProperty<string>(TextBox, 'Placeholder', '', MetaData.Measure | MetaData.Render);
public static readonly PlaceholderBrushKey = MuralBase.RegisterProperty<Brush>(TextBox, 'PlaceholderBrush', /* muted default brush */, MetaData.Render);
```

(+ accessors.) In `RenderOverride`, when the logical text length is 0 and `Placeholder !== ''`, draw the placeholder at the same origin/baseline the editor uses for text, with `PlaceholderBrush`. Guard so a non-empty `Text` never draws it. Do not add placeholder width to `MeasureOverride`.

- [ ] **Step 4: Run tests — expect PASS** + full `text-box.test.ts` green.
- [ ] **Step 5: Commit.**

---

### Task 3: Publish mural, consume in Plexus

**Files:**
- Modify: `Mural/package.json` (version bump, e.g. `0.44.0` → `0.45.0`)
- Modify: `Plexus/package.json` (`@pragmatic-lab/mural` dep bump)

- [ ] **Step 1: Bump** `Mural/package.json` version.
- [ ] **Step 2: Build + publish.** `cd Mural && npm run build && npm publish --registry http://localhost:4873/`.
- [ ] **Step 3: Consume.** `cd Plexus && npm install @pragmatic-lab/mural@<new> --registry http://localhost:4873/`.
- [ ] **Step 4: Verify build.** `cd Plexus && npm run build` (must succeed; `compile:mu` runs first).
- [ ] **Step 5: Commit** both `package.json` (+ `package-lock.json`).

---

### Task 4: `AgentModel` enum + `ContextItemVM`

**Files:**
- Create: `Plexus/src/renderer/src/modules/agent-chat/services/agent-model.ts`
- Create: `Plexus/src/renderer/src/modules/agent-chat/services/context-item.ts`
- Test: `.../services/tests/agent-model.test.ts`, `.../services/tests/context-item.test.ts`

**Interfaces:**
- Produces: `AgentModel`, `ModelOption`, `DEFAULT_MODELS`, `modelOptions()`; `ContextItemVM` (+ static `fromPath(path, isFolder, onRemove)` factory computing `Name`/`Dir`).

- [ ] **Step 1: Write failing tests.** `agent-model.test.ts`: `DEFAULT_MODELS[0].Value === AgentModel.Default` and labels are non-empty; enum values match the Task-0 alias decision. `context-item.test.ts`: `fromPath('C:/a/b/file.ts', false, fn)` → `Name==='file.ts'`, `Dir==='C:/a/b'`, `IsFolder===false`; `fromPath('C:/a/b', true, fn)` → `Name==='b'`, `Dir==='C:/a/b'`; `RemoveCommand.Execute()` invokes `fn`.
- [ ] **Step 2: Run — expect FAIL.** `cd Plexus && npx vitest run src/renderer/src/modules/agent-chat/services/tests/agent-model.test.ts src/renderer/src/modules/agent-chat/services/tests/context-item.test.ts`
- [ ] **Step 3: Implement.** `agent-model.ts`:

```ts
export enum AgentModel { Default = '', Opus = 'opus', Sonnet = 'sonnet', Haiku = 'haiku' }
export interface ModelOption { Label: string; Value: AgentModel }
export const DEFAULT_MODELS: ModelOption[] = [
    { Label: 'Default',      Value: AgentModel.Default },
    { Label: 'Opus 4.8',     Value: AgentModel.Opus },
    { Label: 'Sonnet 4.6',   Value: AgentModel.Sonnet },
    { Label: 'Haiku 4.5',    Value: AgentModel.Haiku },
];
```

`context-item.ts`: `ContextItemVM extends MuralBase` with DPs `Path`/`Name`/`IsFolder`/`Dir`, `RemoveCommand` (RelayCommand wrapping the injected `onRemove`), and a static `fromPath` using a path-basename/dirname helper (import node-free path utils or a tiny local `basename`/`dirname` on `/`+`\\`). Use real `enum`, no string unions.

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit.**

---

### Task 5: `ChatSession` VM — model + context state

**Files:**
- Modify: `.../services/chat-session.ts`
- Test: `.../services/tests/chat-session.test.ts`

**Interfaces:**
- Consumes: `AgentModel`/`ModelOption`/`DEFAULT_MODELS` (Task 4), `ContextItemVM` (Task 4).
- Produces: `ChatSession.Models`, `SelectedModel` (two-way), `Model()`, `ContextItems`, `HasContext`, `AddContextCommand`; `ChatSessionCallbacks.addContext(sessionId)`.

- [ ] **Step 1: Write failing tests.** In `chat-session.test.ts`: `Models` seeded from `DEFAULT_MODELS`; `SelectedModel` defaults to the Default option; setting `SelectedModel` to the Opus option makes `Model()==='opus'`; `addContextItem`/remove updates `ContextItems` + flips `HasContext`; `AddContextCommand.Execute()` calls the injected `callbacks.addContext(sessionId)`. Use the existing test's fake-callbacks pattern (extend the stub with `addContext`).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** Add DPs (`ModelsKey`, `SelectedModelKey` two-way, `ContextItemsKey`, `HasContextKey`, `AddContextCommandKey`) + accessors; seed `Models` from `DEFAULT_MODELS` and `SelectedModel` to `Models[0]` in the ctor; `Model(): string { return this.SelectedModel?.Value ?? '' }`. Add `addContext(sessionId)` to `ChatSessionCallbacks`; `AddContextCommand = new RelayCommand(() => this.callbacks.addContext(this.sessionId))`. Add helper methods to add/remove a `ContextItemVM` (keeping `HasContext` in sync); the item's remove callback removes it from `ContextItems`.
- [ ] **Step 4: Run — expect PASS.** Existing `chat-session.test.ts` cases still green (extend the callbacks stub so they compile).
- [ ] **Step 5: Commit.**

---

### Task 6: Thread model through IPC → provider → session

**Files:**
- Modify: `Plexus/src/shared/agent-api.ts`, `Plexus/src/preload/index.ts`, `Plexus/src/main/agent.ts`
- Modify: `Plexus/src/main/agent/ai-provider.ts`, `main/agent/claude-cli-provider.ts`, `main/agent/agent-session.ts`
- Test: `main/agent/tests/agent-session.test.ts`, `main/agent/tests/claude-cli-provider.test.ts`

**Interfaces:**
- Consumes: nothing from renderer (main-side only).
- Produces: model-aware `sendTurn`/`startSession` IPC + `IAiProvider.start(...,model?)` + `AgentSession` model target.

- [ ] **Step 1: Write failing tests.** `claude-cli-provider.test.ts`: with a fake `SpawnFn` capturing args, `start(..., model='opus')` includes `['--model','opus']`; `model=''` (or omitted) includes no `--model`; `--add-dir` still emitted per dir. `agent-session.test.ts`: with a fake provider, calling `send(cwd, dirs, text, 'opus')` after a prior `send(cwd, dirs, text, '')` **respawns** (provider `start` called twice) and passes the retained resume token; a second `send` with the same `(cwd,dirs,'opus')` does **not** respawn.
- [ ] **Step 2: Run — expect FAIL.** `cd Plexus && npx vitest run src/main/agent/tests/claude-cli-provider.test.ts src/main/agent/tests/agent-session.test.ts`
- [ ] **Step 3: Implement.**
  - `ai-provider.ts`: `start(sessionId, workingDirectory, addDirs, onEvent, resumeToken?, model?): AiProviderSession`.
  - `claude-cli-provider.ts`: `const modelArgs = model ? ['--model', model] : []`; splice into `args` (before `mcpArgs` is fine).
  - `agent-session.ts`: `target` → `{ cwd, addDirs, model }`; `start(wd, addDirs, resumeToken?, model = '')` stores model + forwards to provider; `send(wd, addDirs, text, model = '')` compares model in `sameTarget` and respawns on mismatch; keep resume-token retention intact.
  - `agent.ts` (IPC handlers): read trailing `model` arg from `StartSession`/`SendTurn` and pass it down.
  - `shared/agent-api.ts` + `preload/index.ts`: add trailing optional `model` to both signatures + forward in `ipcRenderer.invoke`.
- [ ] **Step 4: Run — expect PASS** + full `main/agent` suite green.
- [ ] **Step 5: Commit.**

---

### Task 7: Wire the service — model + context into send/start

**Files:**
- Modify: `.../services/chat-sessions-service.ts`
- Test: `.../services/tests/chat-sessions-service.test.ts`

**Interfaces:**
- Consumes: `ChatSession.Model()`/`ContextItems` (Task 5), model-aware IPC (Task 6), `IFileSystemApi.OpenFile`/`OpenFolder`.
- Produces: `sessionById`, `contextDirsFor`, `addContext` on the service; model + context flow into every `sendTurn`/`startSession`.

- [ ] **Step 1: Write failing tests.** In `chat-sessions-service.test.ts` (fake `IAgentApi` capturing calls): a `send` for a session whose `SelectedModel` is Opus forwards `'opus'` as the trailing `sendTurn` arg; a session with a `ContextItemVM(Dir='C:/x')` makes `sendTurn` receive addDirs including `'C:/x'` (merged + deduped with open-project dirs); `contextDirsFor` dedupes a context dir equal to an open-project dir. Use the existing service test's fakes/harness; extend the fake `IFileSystemApi` if the test drives `addContext`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.**
  - `sessionById(id)` → search `liveSessions()` (+ primary).
  - `contextDirsFor(session?)` → `dedupe([...this.addDirs(), ...(session?.ContextItems.ToArray().map(c => c.Dir) ?? [])])`.
  - `callbacks().send` → `(id, text) => { const s = this.sessionById(id); void this.agent.sendTurn(id, this.currentCwd(), this.contextDirsFor(s), text, s?.Model() ?? '') }`.
  - Every `startSession(...)` call (EnsurePrimary, newSession, Reveal-from-stored, RunAgentSkill's send) passes `contextDirsFor(session)` + `session.Model()` (or `''` where no session yet — primary/new default to Default model + no extra context at first start).
  - `addContext(id)` → look up the session; show a two-choice (File / Folder) mini-prompt (reuse an existing chooser/dialog, or call `OpenFile` then, if cancelled, skip — v1 may offer folder-only if a File/Folder chooser is heavy; if so, note it). For each picked path, add a `ContextItemVM` (`Dir` = folder path or `dirname(file)`), dedupe by `Dir`.
  - Add `addContext` to the object returned by `callbacks()`.
  - **If Task 0 found resume rejects model swaps:** gate `SelectedModel` edits after the first user turn (expose a `ModelLocked` bool the picker's `IsEnabled` binds to; set it once a turn is sent).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit.**

---

### Task 8: The composer card (`.mu` view)

**Files:**
- Modify: `.../agent-chat/agent-chat.resources.mu`
- Modify: `Plexus/src/renderer/src/plexus-icons.mu` (only if `@AddIcon` absent)

- [ ] **Step 1: Confirm resource keys.** Grep `plexus-icons.mu` for a plus/attach geometry (`@AddIcon`/`@Plus`/`@Attach`) and `app.mu`/mural for a horizontal wrap-panel key (`@HorizontalWrapPanel`/`WrapPanel`). Use existing keys; add `@AddIcon` to `plexus-icons.mu` only if none exists (a simple `+` `PathGeometry`).
- [ ] **Step 2: Replace the input row.** Swap the `DockPanel[Dock=Bottom]` (lines 39-44) for the composer `Border` from the spec (Piece 2): context-chip `ItemsControl` (Dock=Top, `Visibility=$HasContext << ToVisibility`), footer `DockPanel` (Dock=Bottom) with `＋` `PanelButton`, model `ComboBox [ItemsSource=$Models, SelectedItem=$SelectedModel]`, the `↵ send   ⇧↵ newline` hint, and the `↑` send `PanelButton`; then a `ScrollViewer[MaxHeight=200]` wrapping the multiline `TextBox [AcceptsReturn=true, SubmitsOnEnter=true, TextWrapping=Wrap, Placeholder="Ask Claude anything…", PlaceholderBrush=@OnSurfaceVariant]`. Keep the `DataTemplate[ChatSession]` `resources { Style[DockPanel]{ on KeyDown → SubmitCommand } }` so Enter still submits.
- [ ] **Step 3: Add `ContextChipTemplate`.** A `DataTemplate x:key="ContextChipTemplate" [DataType = ContextItemVM]`: a small `Border` pill (`@SurfaceContainerHigh`, `CornerRadius=4`, `Padding`) with a `DockPanel` — a folder/file glyph, `TextBlock [Text=$Name]`, and an ✕ `PanelButton [Command=$RemoveCommand]`. Register `ContextItemVM` (and any needed import) at the top of the `.mu` like the other `import` lines.
- [ ] **Step 4: Compile.** `cd Plexus && npm run compile:mu` — must report success for `agent-chat.resources.mu` (ignore LSP false-positives). Grep the emitted `agent-chat.resources.mu.js` for `SubmitsOnEnterKey`, `PlaceholderKey`, and `ComboBox` to confirm the template carries them.
- [ ] **Step 5: Build.** `npm run build` succeeds.
- [ ] **Step 6: Commit** (`.mu` source + any `plexus-icons.mu`; do not commit generated `.mu.js` unless the repo tracks it — match existing tracking).

---

### Task 9: Live e2e + full-suite verification

**Files:**
- Create: `Plexus/e2e/agent-composer.spec.ts`

- [ ] **Step 1: Write the live spec.** Model on `toolbox-active-doc-scope.spec.ts`: `launchPlexus`, seed the corpus, wait, ensure the docked Agent Chat is present. Assert via `Symbol.for('mural:visual-backref')`: exactly one composer `TextBox` with `SubmitsOnEnter===true` and a non-empty `Placeholder`; a `ComboBox` whose `DataContext` is a `ChatSession` exists; the `＋` add-context `PanelButton` exists; `appErrors(l.errors)` is empty. (Do not DOM-click mural buttons — drive/read via `evaluate`, per the harness gotcha.)
- [ ] **Step 2: Run the spec.** `cd Plexus && $env:PLEXUS_TEST_CORPUS='C:/Users/Eugene/Projects/architecture-agent/plexus_test_projects'; npx playwright test e2e/agent-composer.spec.ts --reporter=list`. Expect PASS, 0 app errors.
- [ ] **Step 3: Full suites.** mural: `cd Mural && npm test` (text-box green). Plexus: `cd Plexus && npx vitest run` (all green).
- [ ] **Step 4: Commit** the e2e spec.
- [ ] **Step 5: Finish.** Use superpowers:finishing-a-development-branch (verify suites, then push origin/main per the user's standing instruction). Update memory (`project_*` file + MEMORY.md pointer) with the composer feature, the mural `SubmitsOnEnter`/`Placeholder` DPs, and the model/context respawn reuse.

## Self-Review

- **Spec coverage:** Piece 1 → Tasks 1-2; Piece 2 → Task 8; Piece 3 → Tasks 4-7; Piece 4 → Tasks 4,5,7,8. Publish gate → Task 3. Risks → Task 0.
- **Type consistency:** `Model()` returns `string` (alias) everywhere; `sendTurn`/`startSession`/`IAiProvider.start`/`AgentSession` all take a trailing optional `model`; `ContextItemVM.Dir` is the `--add-dir` value used by `contextDirsFor`; `AddContextCommand` → `callbacks.addContext` (added to `ChatSessionCallbacks` in Task 5, implemented in Task 7).
- **Ordering:** mural DPs (1-2) publish (3) before the `.mu` (8) references them; VM/enum (4-5) before the service (7) and view (8); IPC/provider (6) independent of the view. Task 0 de-risks model aliases before Task 4 fixes enum values.

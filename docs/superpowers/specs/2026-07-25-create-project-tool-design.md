# create_project Agent Tool — Design

**Goal:** Give the Plexus agent a `create_project` MCP tool that surfaces the New
Project form as a card in the chat, lets the user create the project from it, and
returns the outcome to the agent — reusing the existing dialog view-model and the
project-creation command, with no Mural framework changes.

**Status:** Approved design (brainstorming). Plexus-only.

---

## Motivation & key insight

Today a project is created only through the toolbar's **New Project** command:
`ProjectExplorerService.newProject()` shows a `NewProjectDialogModel` in a modal
`DialogService`, and on confirm calls the private `createProjectAt(...)`.

The agent lives in the **main** process (`PlexusMcpServer`); the dialog + command
live in the **renderer**. So the tool must round-trip main→renderer→main, exactly
like `refresh_project`.

The subtlety the user identified: an `ask_user_question`-style card returns the
collected data *to the agent* on submit — which would leave the actual creation
"out of the loop" (the agent would need a second step). The fix is that the
**card's submit creates the project renderer-side**, and only the *outcome*
round-trips back to unblock the tool.

**No framework change is needed.** Mural's `ICommand` is already WPF-faithful:
`Execute(parameter?: unknown)` / `CanExecute(parameter?)` already carry a
parameter (`Mural/src/runtime/command.ts:33,39`), and `RelayCommand` already
forwards it to its delegate (`command.ts:158,172`). So rather than overload the
`NewProjectCommand` delegate with a data-vs-dialog branch (which the user
declined, and which a `void` command can't return an outcome from anyway), we
factor out one shared awaitable creator that both the command and the card call.

---

## Architecture

Three layers, mirroring the existing `refresh_project` and `ask_user_question`
plumbing.

### Data flow

1. Agent calls `create_project` with optional prefill `{ name?, type?, location? }`.
2. **main** `PlexusMcpServer` emits a `CreateProject` event and BLOCKS (no
   timeout — a human is filling a form, like `ask_user_question`).
3. **renderer** `AgentService` receives the event, asks `ProjectExplorerService`
   for a configured, pre-filled New Project form, wraps it in a `NewProjectCard`,
   and inserts the card into the transcript (input is gated while it is pending).
4. User adjusts and clicks **Create** (or **Cancel**). Browse still opens the
   native folder picker.
5. Card submit → `await ProjectExplorerService.CreateProject(result)` → project is
   created on disk and added to the open set. Cancel → no creation.
6. `AgentService` posts a `CreateProjectResult` back over a new IPC channel →
   `PlexusMcpServer.resolveCreate` unblocks the tool → the agent learns the
   folder/name (or `cancelled` / `error`).

### Shared contract (`src/shared/agent-api.ts`)

```ts
// Tool identity (third tool under the single `plexus` server).
export const CREATE_PROJECT_TOOL_NAME = 'create_project'
export const CREATE_PROJECT_TOOL_QUALIFIED = `mcp__${MCP_SERVER_KEY}__${CREATE_PROJECT_TOOL_NAME}`

// Optional prefill the agent proposes; the user finalizes in the form.
export interface CreateProjectPrefill { name?: string; type?: string; location?: string }
export interface CreateProjectRequest { id: string; prefill?: CreateProjectPrefill }

// The outcome the tool returns to the agent.
export interface CreateProjectResult
{
    id: string
    created: boolean
    cancelled?: boolean
    folder?: string
    name?: string
    type?: string
    error?: string
}

export enum AgentEventKind { /* … */ CreateProject = 'create-project' }
export enum AgentChannel   { /* … */ CreateProjectResult = 'agent:create-project-result' }
export interface CreateProjectEvent { Kind: AgentEventKind.CreateProject; Request: CreateProjectRequest }
// Added to the AgentEvent union and to IAgentApi:
//   createProjectResult(result: CreateProjectResult): Promise<void>
```

### Main (`PlexusMcpServer` + `agent.ts` + preload)

- Register a third tool `create_project` in `buildServer()`, input schema
  `{ name?, type?, location? }` (all optional).
- `requestCreateProject(prefill?): Promise<CreateProjectResult>` — mints an id
  (`c${seq}`), emits the `CreateProject` event, and blocks on a `pendingCreate`
  map. **No timeout.** No sink (probe/headless) → resolve `{ created:false,
  error:'No Plexus window is available.' }`.
- `resolveCreate(result)` — delivers to the blocked call.
- `close()` also drains `pendingCreate` with `{ created:false, error:'Server closed.' }`.
- `agent.ts`: allow-list `CREATE_PROJECT_TOOL_QUALIFIED`; add
  `ipcMain.handle(AgentChannel.CreateProjectResult, (_e, r) => mcpServer.resolveCreate(r))`.
- `preload/index.ts`: `createProjectResult: (r) => ipcRenderer.invoke(AgentChannel.CreateProjectResult, r)`.

### Renderer

**`ProjectExplorerService` — two public additions, `createProjectAt` reused:**

```ts
// One creator, three callers (toolbar dialog, agent card, any future headless).
// Returns the outcome a void command cannot.
public async CreateProject(data: NewProjectResult): Promise<CreateOutcome>
{
    const error = await this.validateNewProject(data)
    if (error !== null) return { created: false, error }
    const op = await this.createProjectAt(data.type, data.name, data.location, data.metaModel, data.libraries)
    if (op === undefined) return { created: false, error: this.Status }   // Status holds the failure reason
    return { created: true, folder: op.Folder, name: op.Name, type: data.type }
}

// Build a configured, pre-filled New Project form (async: gathers types +
// published meta-models/libraries). `close` is supplied by the caller (the modal
// or the card). Existing newProject() is refactored to call this too.
public async NewProjectFormFor(
    close: (result?: NewProjectResult) => void,
    prefill?: CreateProjectPrefill): Promise<NewProjectDialogModel>
```

`CreateOutcome` = `Omit<CreateProjectResult, 'id'>`.

The only tweak to existing creation logic: `createProjectAt` changes its return
type from `void` to `Promise<OpenProject | undefined>` (it already builds the
`OpenProject` via `addOpenProject` — it just returns it now, `undefined` on the
caught-error path). Its existing callers ignore the return, so this is
non-breaking.

**`NewProjectCard` (new, `modules/agent-chat/services/new-project-card.ts`):**
mirrors `QuestionCard`. Holds the configured `NewProjectDialogModel` as its
`Form`, plus lifecycle DPs (`IsPending`, `ResultSummary`) and `onSubmit(result)` /
`onCancel()` callbacks. The Form's existing `ConfirmCommand`/`CancelCommand` fire
through its `close(result?)` callback, wired so `result` → `onSubmit(result)` and
`undefined` → `onCancel()`. On done it flips `IsPending=false` and shows a recap
("Created <name> at <folder>" / "Cancelled").

**`NewProjectCard` DataTemplate (`agent-chat.resources.mu`):** a card frame around
a `ContentControl { Content = $Form }`, which resolves the **existing**
`DataTemplate[NewProjectDialogModel]` — so the in-chat form is visually identical
to the modal. A `$ResultSummary` recap shows after submit (bind to `$IsPending` /
its complement, same pattern as `QuestionCard`).

**`AgentService` coordination:** branch the event subscription —

```ts
this.agent.onEvent((event) => {
    if (event.Kind === AgentEventKind.CreateProject) { void this.handleCreateProject(event.Request); return }
    this.reducer.apply(event)
})

private async handleCreateProject(req: CreateProjectRequest): Promise<void> {
    const explorer = this.Provider.getRequired(ProjectExplorerService.Key)
    const card = new NewProjectCard(req.id)
    card.Form = await explorer.NewProjectFormFor(
        (r) => { if (r) void card.submit(r); else card.cancel() }, req.prefill)
    card.onSubmit = async (data) => {
        const outcome = await explorer.CreateProject(data)
        card.showResult(outcome)
        void this.agent.createProjectResult({ id: req.id, ...outcome })
        this.reducer.releasePending(req.id)
    }
    card.onCancel = () => {
        card.showCancelled()
        void this.agent.createProjectResult({ id: req.id, created: false, cancelled: true })
        this.reducer.releasePending(req.id)
    }
    this.reducer.addPendingCard(req.id, card)
}
```

**`TranscriptReducer` — two small additions** so cards built outside the reducer
still gate input and reset the assistant bubble, reusing the pending-block set
that today only tracks questions:

```ts
public addPendingCard(id: string, card: Model): void  // currentAssistant=null; pending.add(id); Transcript.Add(card); onPendingChange
public releasePending(id: string): void               // pending.delete(id); onPendingChange
```

The `CreateProject` case in `apply()` is a no-op (handled by `AgentService`,
like `RefreshProject` is handled by `WorkspaceRefreshService`). `HasPendingQuestion`
generalizes to "any blocking card open"; `CanInput` gating is unchanged in spirit.

---

## Error handling

- **No project factories / unknown type reaching `CreateProject`** → `createProjectAt`
  sets `Status`; `CreateProject` returns `{ created:false, error }`.
- **Validation failure** (folder not empty, blank name, missing required
  meta-model) → surfaced live in the form; if it still reaches `CreateProject`,
  returned as `{ created:false, error }`.
- **User cancels** → `{ created:false, cancelled:true }`.
- **No renderer / server closed** → tool resolves with an error, never hangs.
- **No timeout** — a human fills the form; matches `ask_user_question`.

## Testing

- `shared/tests/agent-api.test.ts` — `CREATE_PROJECT_TOOL_QUALIFIED` shape;
  `CreateProject` event kind + channel exist.
- `main/agent/tests/plexus-mcp-server.test.ts` — `create_project` appears in the
  existing "tool surface" list assertion (no new `connect()` cycle — the merged
  file's native-socket ceiling); `requestCreateProject` emits a `CreateProject`
  event and resolves via `resolveCreate`; no-sink path returns an error.
- `main/agent/tests/claude-cli-provider.test.ts` — allow-list includes the create
  tool.
- `project-explorer-service.test.ts` — `CreateProject(data)` validates + creates
  (fake factory) and returns the outcome; a validation failure returns
  `{created:false,error}`; `NewProjectFormFor` maps prefill (name/type/location).
- `new-project-card.test.ts` (new) — submit fires `onSubmit` with the form's
  result and flips to done; cancel fires `onCancel`.
- `agent-service.test.ts` — `handleCreateProject` builds a card, and card submit
  calls the explorer + posts a `CreateProjectResult`; the fake agent gains
  `createProjectResult`.

## Out of scope (v1)

- Prefilling meta-model / library selections (the user picks these).
- Autonomous/headless creation with no card (the tool always shows the form).
- Listing valid project types to the agent (prefill `type` is best-effort;
  the user finalizes).

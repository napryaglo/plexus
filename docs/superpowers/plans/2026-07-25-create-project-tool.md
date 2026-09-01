# create_project Agent Tool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `create_project` MCP tool that surfaces the New Project form as a card in the agent chat, creates the project renderer-side on submit, and returns the outcome to the agent.

**Architecture:** A third tool on the existing single `PlexusMcpServer` (main) round-trips main→renderer→main like `refresh_project`. The renderer's `AgentService` coordinates: it builds a pre-filled `NewProjectDialogModel` (reusing the modal's view-model + DataTemplate), wraps it in a `NewProjectCard` in the transcript, and on submit calls a new awaitable `ProjectExplorerService.CreateProject(data)` — one creator shared by the toolbar dialog and the card — then posts the outcome back over a new IPC channel.

**Tech Stack:** Electron (main/preload/renderer), `@modelcontextprotocol/sdk` (`McpServer` + `StreamableHTTPServerTransport`), zod, mural runtime (`Model`/DP/`RelayCommand`/`ICommand`/`ServiceBase`), Vitest.

## Global Constraints

- **No Mural framework changes.** `ICommand.Execute(parameter?)` already exists; do not touch `Mural/`.
- **Tests live in a `tests/` subfolder** next to the code (`vitest.config.ts` globs `src/**/*.test.ts`). Run with `npx vitest run <path>`.
- **Enums over string-literal unions** (repo rule): add members to the existing `AgentEventKind` / `AgentChannel` enums.
- **One MCP server** (`MCP_SERVER_KEY = 'plexus'`) hosts all tools; `create_project` is `mcp__plexus__create_project`.
- **No timeout** on the create tool (a human fills the form, like `ask_user_question`).
- **Do not add new `connect()` cycles** in `plexus-mcp-server.test.ts` — assert `create_project` in the existing "tool surface" list; unit-test the rest via `requestCreateProject`/`resolveCreate`. (The merged file hard-crashes the vitest worker past 3 real MCP connect/close cycles — a native socket-teardown ceiling.)
- **Branch first:** this work starts on a feature branch off `main` (e.g. `feat/create-project-tool`), not on `main`.

---

## File Structure

- `src/shared/agent-api.ts` — MOD: create-tool consts, `CreateProject` event kind, `CreateProjectResult` channel, request/result/prefill types, `AgentEvent` union, `IAgentApi.createProjectResult`.
- `src/preload/index.ts` — MOD: `createProjectResult` bridge method.
- `src/main/agent/plexus-mcp-server.ts` — MOD: register `create_project` tool; `requestCreateProject`/`resolveCreate`; drain on close.
- `src/main/agent.ts` — MOD: allow-list the tool; `ipcMain.handle(CreateProjectResult)`.
- `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts` — MOD: `createProjectAt` returns `OpenProject | undefined`; new `CreateProject`, `NewProjectFormFor`; `applyPrefill` helper; `newProject()` refactored to reuse them.
- `src/renderer/src/modules/agent-chat/services/new-project-card.ts` — NEW: `NewProjectCard` view-model.
- `src/renderer/src/modules/agent-chat/agent-chat.resources.mu` — MOD: `DataTemplate[NewProjectCard]`.
- `src/renderer/src/modules/agent-chat/services/transcript.ts` — MOD: `addPendingCard`/`releasePending`; `CreateProject` case no-op.
- `src/renderer/src/modules/agent-chat/services/agent-service.ts` — MOD: `handleCreateProject` coordination.

Test files (each in the sibling `tests/` folder): `agent-api.test.ts`, `plexus-mcp-server.test.ts`, `claude-cli-provider.test.ts`, `project-explorer-service.test.ts`, `new-project-card.test.ts`, `transcript.test.ts`, `agent-service.test.ts`.

---

### Task 1: Shared contract + preload bridge

**Files:**
- Modify: `src/shared/agent-api.ts`
- Modify: `src/preload/index.ts`
- Test: `src/shared/tests/agent-api.test.ts`

**Interfaces:**
- Produces: `CREATE_PROJECT_TOOL_NAME='create_project'`, `CREATE_PROJECT_TOOL_QUALIFIED='mcp__plexus__create_project'`; `AgentEventKind.CreateProject='create-project'`; `AgentChannel.CreateProjectResult='agent:create-project-result'`; `interface CreateProjectPrefill { name?: string; type?: string; location?: string }`; `interface CreateProjectRequest { id: string; prefill?: CreateProjectPrefill }`; `interface CreateProjectResult { id: string; created: boolean; cancelled?: boolean; folder?: string; name?: string; type?: string; error?: string }`; `interface CreateProjectEvent { Kind: AgentEventKind.CreateProject; Request: CreateProjectRequest }`; `IAgentApi.createProjectResult(result: CreateProjectResult): Promise<void>`.

- [ ] **Step 1: Write the failing test** — append to `src/shared/tests/agent-api.test.ts`:

```ts
import {
  // …existing imports…
  CREATE_PROJECT_TOOL_NAME,
  CREATE_PROJECT_TOOL_QUALIFIED,
} from '../agent-api.js'

test('create_project tool is qualified under the single plexus server key', () => {
  expect(CREATE_PROJECT_TOOL_NAME).toBe('create_project')
  expect(CREATE_PROJECT_TOOL_QUALIFIED).toBe('mcp__plexus__create_project')
})

test('the create-project channel and event kind exist and are distinct', () => {
  expect(AgentChannel.CreateProjectResult).toBe('agent:create-project-result')
  expect(AgentEventKind.CreateProject).toBe('create-project')
  const kinds = Object.values(AgentEventKind)
  expect(new Set(kinds).size).toBe(kinds.length)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/tests/agent-api.test.ts`
Expected: FAIL — `CREATE_PROJECT_TOOL_NAME` is not exported / `AgentChannel.CreateProjectResult` is undefined.

- [ ] **Step 3: Implement in `src/shared/agent-api.ts`**

Add to `enum AgentChannel`: `CreateProjectResult = 'agent:create-project-result',`
Add to `enum AgentEventKind`: `CreateProject = 'create-project',`
Below the refresh consts, add:

```ts
export const CREATE_PROJECT_TOOL_NAME = 'create_project'
export const CREATE_PROJECT_TOOL_QUALIFIED = `mcp__${MCP_SERVER_KEY}__${CREATE_PROJECT_TOOL_NAME}`

// create_project payloads. `prefill` is the agent's optional proposal; the user
// finalizes it in the New Project form. Correlated by `id` like a Question.
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
```

Add the event interface near the others:

```ts
export interface CreateProjectEvent { Kind: AgentEventKind.CreateProject; Request: CreateProjectRequest }
```

Add `| CreateProjectEvent` to the `AgentEvent` union. Add to `IAgentApi`:

```ts
    // The renderer's outcome for a pending create_project tool call.
    createProjectResult(result: CreateProjectResult): Promise<void>;
```

- [ ] **Step 4: Implement the preload bridge** — in `src/preload/index.ts`, inside the `agent` object after `refreshProjectResult`:

```ts
  createProjectResult: (result): Promise<void> => ipcRenderer.invoke(AgentChannel.CreateProjectResult, result),
```

- [ ] **Step 5: Keep typed `IAgentApi` fakes compiling** — `IAgentApi` now requires `createProjectResult`. One test fake is a *typed* `IAgentApi` and will break typecheck: in `src/renderer/src/modules/agent-chat/services/tests/agent-service.test.ts`, add to `fakeAgent()`'s `api` object:

```ts
        createProjectResult: () => Promise.resolve(),
```

(The `workspace-refresh-service.test.ts` bridge is an `as unknown as` cast — it does NOT need the member. Don't touch it.)

- [ ] **Step 6: Run test + typecheck**

Run: `npx vitest run src/shared/tests/agent-api.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/shared/agent-api.ts src/shared/tests/agent-api.test.ts src/preload/index.ts src/renderer/src/modules/agent-chat/services/tests/agent-service.test.ts
git commit -m "feat(agent): create_project shared contract + preload bridge"
```

---

### Task 2: create_project tool on PlexusMcpServer + main wiring

**Files:**
- Modify: `src/main/agent/plexus-mcp-server.ts`
- Modify: `src/main/agent.ts`
- Test: `src/main/agent/tests/plexus-mcp-server.test.ts`
- Test: `src/main/agent/tests/claude-cli-provider.test.ts`

**Interfaces:**
- Consumes: `CREATE_PROJECT_TOOL_NAME`, `CREATE_PROJECT_TOOL_QUALIFIED`, `CreateProjectPrefill`, `CreateProjectResult`, `AgentEventKind.CreateProject`, `AgentChannel.CreateProjectResult` (Task 1).
- Produces: `PlexusMcpServer.requestCreateProject(prefill?: CreateProjectPrefill): Promise<CreateProjectResult>`; `PlexusMcpServer.resolveCreate(result: CreateProjectResult): void`.

- [ ] **Step 1: Write the failing tests** — in `src/main/agent/tests/plexus-mcp-server.test.ts`:

Add `create_project` to the "tool surface" assertion (extend the existing test):

```ts
        expect(names).toContain(CREATE_PROJECT_TOOL_NAME)
```

Add `CREATE_PROJECT_TOOL_NAME` to that file's imports from `../../../shared/agent-api.js`, plus `type CreateProjectResult`. Then add a new describe:

```ts
describe('PlexusMcpServer — create_project', () => {
    test('requestCreateProject emits a CreateProject event and resolves with the posted result', async () => {
        const server = new PlexusMcpServer()
        const events: AgentEvent[] = []
        server.setSink((e) => events.push(e))

        const pending = server.requestCreateProject({ name: 'Acme', type: 'diagram' })
        expect(events.length).toBe(1)
        const evt = events[0]!
        expect(evt.Kind).toBe(AgentEventKind.CreateProject)
        const req = (evt as { Request: { id: string; prefill?: { name?: string } } }).Request
        expect(req.prefill?.name).toBe('Acme')

        const result: CreateProjectResult = { id: req.id, created: true, folder: '/p/acme', name: 'Acme', type: 'diagram' }
        server.resolveCreate(result)
        expect(await pending).toEqual(result)
    })

    test('requestCreateProject with no sink resolves immediately with an error', async () => {
        const server = new PlexusMcpServer()
        const result = await server.requestCreateProject()
        expect(result.created).toBe(false)
        expect((result.error ?? '').length).toBeGreaterThan(0)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/agent/tests/plexus-mcp-server.test.ts`
Expected: FAIL — `requestCreateProject` is not a function / `CREATE_PROJECT_TOOL_NAME` not in tool list.

- [ ] **Step 3: Implement in `src/main/agent/plexus-mcp-server.ts`**

Extend the imports from `../../shared/agent-api.js` with `CREATE_PROJECT_TOOL_NAME`, `type CreateProjectPrefill`, `type CreateProjectResult`.

Add a pending map field next to the others:

```ts
    private readonly pendingCreate = new Map<string, (result: CreateProjectResult) => void>()
```

Add the resolver + request methods (after `resolveRefresh` / `requestRefresh`):

```ts
    // Deliver the renderer's outcome to a blocked create_project call; no-op if stale.
    public resolveCreate(result: CreateProjectResult): void
    {
        const done = this.pendingCreate.get(result.id)
        if (done === undefined) return
        this.pendingCreate.delete(result.id)
        done(result)
    }

    // Emit a CreateProject request and await the renderer's outcome. No timeout —
    // a human fills the form. No sink (probe/headless) → resolve with an error so
    // the round-trip still completes.
    public requestCreateProject(prefill?: CreateProjectPrefill): Promise<CreateProjectResult>
    {
        const id = `c${(this.seq += 1)}`
        const sink = this.sink
        if (sink === undefined)
            return Promise.resolve({ id, created: false, error: 'No Plexus window is available to create a project.' })
        return new Promise((resolve) =>
        {
            this.pendingCreate.set(id, resolve)
            sink({ Kind: AgentEventKind.CreateProject, Request: { id, prefill } })
        })
    }
```

In `close()`, drain the new map alongside the others:

```ts
        for (const [id, done] of [...this.pendingCreate]) { this.pendingCreate.delete(id); done({ id, created: false, error: 'Server closed.' }) }
```

In `buildServer()`, register the third tool after `refresh_project`:

```ts
        server.registerTool(
            CREATE_PROJECT_TOOL_NAME,
            {
                title: 'Create a new Plexus project',
                description:
                    'Open the New Project form in the chat so the user can create a project. Optionally '
                    + 'prefill `name`, `type`, and/or `location`; the user reviews and confirms (or cancels). '
                    + 'Returns the created project\'s folder and name, or a cancelled/error outcome.',
                inputSchema: { name: z.string().optional(), type: z.string().optional(), location: z.string().optional() },
            },
            async ({ name, type, location }) =>
            {
                const result = await this.requestCreateProject({ name, type, location })
                return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
            },
        )
```

- [ ] **Step 4: Wire main in `src/main/agent.ts`**

Add `CREATE_PROJECT_TOOL_QUALIFIED` and `type CreateProjectResult` to the imports from `../shared/agent-api.js`.
Add the qualified tool to `allowedTools`:

```ts
        allowedTools: [ASK_TOOL_QUALIFIED, REFRESH_TOOL_QUALIFIED, CREATE_PROJECT_TOOL_QUALIFIED],
```

Add an IPC handler next to the others:

```ts
    // The renderer's create outcome → unblock the create_project tool call.
    ipcMain.handle(AgentChannel.CreateProjectResult, (_e, result: CreateProjectResult): void => {
        mcpServer.resolveCreate(result)
    })
```

- [ ] **Step 5: Update the provider allow-list test** — in `src/main/agent/tests/claude-cli-provider.test.ts`, the "writes the server config…" test: extend `allowedTools` to include `'mcp__plexus__create_project'` and assert it flows through:

```ts
        allowedTools: ['mcp__plexus__ask_user_question', 'mcp__plexus__refresh_project', 'mcp__plexus__create_project'],
```
```ts
    expect(args).toContain('mcp__plexus__create_project')
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/main/agent/tests/plexus-mcp-server.test.ts src/main/agent/tests/claude-cli-provider.test.ts`
Expected: PASS (all, no worker crash).

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/plexus-mcp-server.ts src/main/agent.ts src/main/agent/tests/plexus-mcp-server.test.ts src/main/agent/tests/claude-cli-provider.test.ts
git commit -m "feat(agent): create_project tool on PlexusMcpServer + main wiring"
```

---

### Task 3: ProjectExplorerService — shared awaitable creator + form builder

**Files:**
- Modify: `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts`
- Test: `src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts`

**Interfaces:**
- Consumes: `CreateProjectPrefill` (Task 1); `NewProjectResult`, `NewProjectDialogModel` (existing, `../../../services/projects/new-project-dialog-model.js`); `OpenProject` (existing).
- Produces:
  - `applyPrefill(form: NewProjectDialogModel, prefill?: CreateProjectPrefill): void` (exported free function).
  - `ProjectExplorerService.CreateProject(data: NewProjectResult): Promise<CreateOutcome>` where `type CreateOutcome = Omit<CreateProjectResult, 'id'>`.
  - `ProjectExplorerService.NewProjectFormFor(close: (result?: NewProjectResult) => void, prefill?: CreateProjectPrefill): Promise<NewProjectDialogModel>`.
  - `createProjectAt(...)` now returns `Promise<OpenProject | undefined>`.

- [ ] **Step 1: Write the failing test for `applyPrefill`** — append to `project-explorer-service.test.ts`:

```ts
import { applyPrefill } from '../project-explorer-service.js'
import { NewProjectDialogModel, ProjectTypeChoice } from '../../../../services/projects/new-project-dialog-model.js'

function formWith(types: string[]): NewProjectDialogModel {
    const choices = types.map((t) => new ProjectTypeChoice(t, t, `${t} project`))
    // fs/validate/close are unused by applyPrefill; pass inert stubs.
    return new NewProjectDialogModel(choices, {} as never, async () => null, () => {})
}

test('applyPrefill sets name/location and selects the matching type', () => {
    const form = formWith(['diagram', 'library'])
    applyPrefill(form, { name: 'Acme', location: 'C:/acme', type: 'library' })
    expect(form.Name).toBe('Acme')
    expect(form.Location).toBe('C:/acme')
    expect(form.SelectedType?.Type).toBe('library')
})

test('applyPrefill ignores an unknown type and missing fields', () => {
    const form = formWith(['diagram'])
    applyPrefill(form, { type: 'nope' })
    expect(form.SelectedType?.Type).toBe('diagram')   // stays on the default first type
    expect(form.Name).toBe('')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts -t applyPrefill`
Expected: FAIL — `applyPrefill` is not exported.

- [ ] **Step 3: Implement `applyPrefill` + `CreateProject` + `NewProjectFormFor`; change `createProjectAt` return**

In `project-explorer-service.ts`:

Add the type + prefill import: extend the `agent-api` / prefill import (add `import type { CreateProjectPrefill, CreateProjectResult } from '../../../../../shared/agent-api.js'`). Add near the top-level exports:

```ts
export type CreateOutcome = Omit<CreateProjectResult, 'id'>

// Apply the agent's optional prefill onto a New Project form: set the name /
// location text and select the matching type (unknown/missing values are ignored,
// leaving the form's defaults).
export function applyPrefill(form: NewProjectDialogModel, prefill?: CreateProjectPrefill): void
{
    if (prefill === undefined) return
    if (prefill.name !== undefined) form.Name = prefill.name
    if (prefill.location !== undefined) form.Location = prefill.location
    if (prefill.type !== undefined)
    {
        const match = form.Types.ToArray().find((t) => t.Type === prefill.type)
        if (match?.SelectCommand !== undefined) match.SelectCommand.Execute()
    }
}
```

Change `createProjectAt`'s signature + returns:

```ts
    private async createProjectAt(
        type: string, name: string, folder: string,
        metaModel?: BaseRef, libraries?: readonly BaseRef[]): Promise<OpenProject | undefined>
    {
        const factory = this.resolveFactory(type)
        if (factory === undefined) { this.Status = `No factory for project type "${type}".`; return undefined }

        const storage = this.storageRegistry.Create(StorageProviderRegistry.DefaultBackendId, folder)
        try {
            const bindings = (metaModel !== undefined || (libraries !== undefined && libraries.length > 0))
                ? { metaModel, libraries }
                : undefined
            const project = await factory.createProject(storage, name, bindings)
            const op = await this.addOpenProject(project, factory, storage)
            await this.recents.Add({ name: op.Name, path: folder, type, openedAt: Date.now() })
            this.Status = `Created ${op.Name}.`
            return op
        } catch (e) {
            this.Status = `Create failed: ${(e as Error).message}`
            return undefined
        }
    }
```

Refactor `newProject()` to build the form via `NewProjectFormFor` and create via `CreateProject`:

```ts
    private async newProject(): Promise<void>
    {
        const choices = this.typeChoices()
        if (choices.length === 0) { this.Status = 'No project factory registered.'; return }
        const vm = await this.NewProjectFormFor((r) => this.dialogs.Close(r))
        const result = (await this.dialogs.Show({ Title: 'New Project', Content: vm, Width: 520 })) as NewProjectResult | undefined
        if (result === undefined) return
        await this.CreateProject(result)
    }
```

Add the two public methods (near `RestoreSession`):

```ts
    // Build a configured New Project form: the type choices, the published
    // meta-models/libraries pickers, and live validation — pre-filled from the
    // agent's proposal. `close` is supplied by the caller (the modal or the chat
    // card). Shared by newProject() and the agent's create_project card.
    public async NewProjectFormFor(
        close: (result?: NewProjectResult) => void,
        prefill?: CreateProjectPrefill): Promise<NewProjectDialogModel>
    {
        const vm = new NewProjectDialogModel(
            this.typeChoices(),
            this.fs,
            (r) => this.validateNewProject(r),
            close,
            await this.publishedMetaModels(),
            await this.publishedLibraries(),
        )
        applyPrefill(vm, prefill)
        return vm
    }

    // The single project creator: validate, create on disk, add to the open set,
    // and return the outcome (which a void command cannot). Shared by the toolbar
    // dialog and the agent's create card.
    public async CreateProject(data: NewProjectResult): Promise<CreateOutcome>
    {
        const error = await this.validateNewProject(data)
        if (error !== null) return { created: false, error }
        const op = await this.createProjectAt(data.type, data.name, data.location, data.metaModel, data.libraries)
        if (op === undefined) return { created: false, error: this.Status }
        return { created: true, folder: op.Folder, name: op.Name, type: data.type }
    }
```

- [ ] **Step 4: Run the `applyPrefill` test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts -t applyPrefill`
Expected: PASS.

- [ ] **Step 5: Write the failing `CreateProject` validation test**

Register a `StorageProviderRegistry` fake in `makeExplorer` (add to the harness, after the `DialogService` registration) so `validateNewProject` can probe the manifest:

```ts
import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
// …inside makeExplorer, after registering DialogService:
const occupied = new Set<string>()   // folders that already contain a project
provider.registerInstance(StorageProviderRegistry.Key, {
    Create: (_backend: string, folder: string) => ({
        Exists: (name: string) => Promise.resolve(occupied.has(folder) && name === PROJECT_MANIFEST_FILENAME),
    }),
} as unknown as StorageProviderRegistry)
// expose the set so a test can mark a folder occupied:
return { service, host, store, priv: service as unknown as ExplorerPrivates, provider, shownDialogs, rec, occupied }
```

Add `occupied: Set<string>` to `makeExplorer`'s return type. Then the test:

```ts
test('CreateProject refuses a folder that already contains a project', async () => {
    const { service, occupied } = makeExplorer()
    occupied.add('C:/taken')
    const outcome = await service.CreateProject({ type: 'diagram', name: 'X', location: 'C:/taken' })
    expect(outcome.created).toBe(false)
    expect(outcome.error).toContain('already contains a project')
})
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts -t CreateProject`
Expected: PASS (validate returns the "already contains a project" message; no factory needed on this branch).

- [ ] **Step 7: Typecheck + full explorer test file**

Run: `npx vitest run src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts`
Expected: PASS (existing tests unaffected — `createProjectAt`'s new return type is ignored by its other callers).
Run: `npm run typecheck` — clean.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/modules/project-explorer/services/project-explorer-service.ts src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts
git commit -m "feat(projects): CreateProject + NewProjectFormFor + prefill; createProjectAt returns OpenProject"
```

---

### Task 4: NewProjectCard view-model + DataTemplate

**Files:**
- Create: `src/renderer/src/modules/agent-chat/services/new-project-card.ts`
- Modify: `src/renderer/src/modules/agent-chat/agent-chat.resources.mu`
- Test: `src/renderer/src/modules/agent-chat/services/tests/new-project-card.test.ts`

**Interfaces:**
- Consumes: `CreateOutcome` (Task 3); `NewProjectDialogModel` (existing).
- Produces: `class NewProjectCard extends Model` with `readonly Id: string`; DP-backed `Form: NewProjectDialogModel | undefined`, `IsPending: boolean` (default true), `IsDone: boolean` (default false), `ResultSummary: string`; methods `showResult(outcome: CreateOutcome): void`, `showCancelled(): void`.

- [ ] **Step 1: Write the failing test** — `src/renderer/src/modules/agent-chat/services/tests/new-project-card.test.ts`:

```ts
import { test, expect } from 'vitest'
import { NewProjectCard } from '../new-project-card.js'

test('a fresh card is pending with no summary', () => {
    const card = new NewProjectCard('c1')
    expect(card.Id).toBe('c1')
    expect(card.IsPending).toBe(true)
    expect(card.IsDone).toBe(false)
    expect(card.ResultSummary).toBe('')
})

test('showResult flips to done and summarizes the created project', () => {
    const card = new NewProjectCard('c1')
    card.showResult({ created: true, folder: 'C:/acme', name: 'Acme', type: 'diagram' })
    expect(card.IsPending).toBe(false)
    expect(card.IsDone).toBe(true)
    expect(card.ResultSummary).toContain('Acme')
    expect(card.ResultSummary).toContain('C:/acme')
})

test('showResult on an error reports the error', () => {
    const card = new NewProjectCard('c1')
    card.showResult({ created: false, error: 'boom' })
    expect(card.IsDone).toBe(true)
    expect(card.ResultSummary).toContain('boom')
})

test('showCancelled marks it done with a cancelled note', () => {
    const card = new NewProjectCard('c1')
    card.showCancelled()
    expect(card.IsPending).toBe(false)
    expect(card.ResultSummary.toLowerCase()).toContain('cancel')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/modules/agent-chat/services/tests/new-project-card.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `new-project-card.ts`**

```ts
import { MetaData, Model } from '@pragmatic-tech-ai/mural/runtime'
import type { NewProjectDialogModel } from '../../../services/projects/new-project-dialog-model.js'
import type { CreateOutcome } from '../../project-explorer/services/project-explorer-service.js'

// The in-chat New Project card: hosts the reused NewProjectDialogModel form while
// pending, then collapses to a one-line recap once the project is created or the
// user cancels. The orchestration (build form, create, post back to the agent)
// lives in AgentService; this is a pure view-model.
export class NewProjectCard extends Model
{
    public static readonly FormKey = Model.RegisterProperty<NewProjectDialogModel | undefined>(
        NewProjectCard, 'Form', undefined, MetaData.None)
    public static readonly IsPendingKey = Model.RegisterProperty<boolean>(NewProjectCard, 'IsPending', true, MetaData.None)
    // Complement of IsPending (no inverse Visibility converter — bind the form to
    // $IsPending and the recap to $IsDone).
    public static readonly IsDoneKey = Model.RegisterProperty<boolean>(NewProjectCard, 'IsDone', false, MetaData.None)
    public static readonly ResultSummaryKey = Model.RegisterProperty<string>(NewProjectCard, 'ResultSummary', '', MetaData.None)

    public readonly Id: string

    constructor(id: string) { super(); this.Id = id }

    public get Form(): NewProjectDialogModel | undefined { return this.get_property_value(NewProjectCard.FormKey) }
    public set Form(v: NewProjectDialogModel | undefined) { this.set_property_value(NewProjectCard.FormKey, v) }
    public get IsPending(): boolean { return this.get_property_value(NewProjectCard.IsPendingKey) }
    public get IsDone(): boolean { return this.get_property_value(NewProjectCard.IsDoneKey) }
    public get ResultSummary(): string { return this.get_property_value(NewProjectCard.ResultSummaryKey) }

    public showResult(outcome: CreateOutcome): void
    {
        const summary = outcome.created
            ? `Created ${outcome.name} at ${outcome.folder}`
            : `Could not create the project: ${outcome.error ?? 'unknown error'}`
        this.done(summary)
    }

    public showCancelled(): void { this.done('Cancelled.') }

    private done(summary: string): void
    {
        this.set_property_value(NewProjectCard.ResultSummaryKey, summary)
        this.set_property_value(NewProjectCard.IsPendingKey, false)
        this.set_property_value(NewProjectCard.IsDoneKey, true)
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/modules/agent-chat/services/tests/new-project-card.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the DataTemplate** — in `agent-chat.resources.mu`, after the `DataTemplate[QuestionCard]` block, add the import at the top with the other imports:

```
import NewProjectCard from "./services/new-project-card.js"
```

and the template:

```
    // ── create_project card ─────────────────────────────────────────────────────
    // The agent called create_project: a bordered card hosting the reused New
    // Project form ($Form → DataTemplate[NewProjectDialogModel]) while pending;
    // after Create/Cancel it collapses to a one-line recap.
    DataTemplate [ DataType = NewProjectCard ] {
        Border [ BorderBrush = @OutlineVariant, BorderThickness = (1,1,1,1), CornerRadius = 10,
                 Background = @SurfaceContainer, Padding = (12,10,12,12), Margin = (0,4,20,4) ] {
            StackPanel [ Orientation = Vertical ] {
                ContentControl [ Content = $Form, Visibility = $IsPending << ToVisibility ]
                TextBlock [ Text = $ResultSummary, Visibility = $IsDone << ToVisibility,
                            Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
            }
        }
    }
```

**Resource-resolution caveat:** `ContentControl { Content = $Form }` must resolve `DataTemplate[NewProjectDialogModel]`, which currently lives in `project-explorer.resources.mu`. Verify at Step 6 that it resolves from the agent-chat surface. If it does not (module-scoped resources), fix by promoting that DataTemplate to an app-level resource bundle both modules load, or by loading `project-explorer.resources.mu`'s template into the agent-chat surface — do NOT duplicate the template.

- [ ] **Step 6: Build to verify the markup compiles + templates resolve**

Run: `npm run compile:mu && npm run typecheck`
Expected: `.mu` compiles; typecheck clean. (Live template resolution is verified in Task 7's smoke.)

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/modules/agent-chat/services/new-project-card.ts src/renderer/src/modules/agent-chat/services/tests/new-project-card.test.ts src/renderer/src/modules/agent-chat/agent-chat.resources.mu
git commit -m "feat(agent-chat): NewProjectCard view-model + DataTemplate"
```

---

### Task 5: TranscriptReducer pending-card seam

**Files:**
- Modify: `src/renderer/src/modules/agent-chat/services/transcript.ts`
- Test: `src/renderer/src/modules/agent-chat/services/tests/transcript.test.ts`

**Interfaces:**
- Consumes: `AgentEventKind.CreateProject` (Task 1).
- Produces: `TranscriptReducer.addPendingCard(id: string, card: Model): void`; `TranscriptReducer.releasePending(id: string): void`. `HasPendingQuestion` now reflects any blocking card (question or create).

- [ ] **Step 1: Write the failing test** — append to `transcript.test.ts`:

```ts
import { Model } from '@pragmatic-tech-ai/mural/runtime'

test('addPendingCard adds the card, blocks input, and resets the assistant bubble; releasePending clears it', () => {
    const r = new TranscriptReducer()
    let pendingChanges = 0
    r.onPendingChange = () => { pendingChanges += 1 }
    r.apply({ Kind: AgentEventKind.AssistantText, Text: 'hi' })   // opens an assistant bubble

    const card = new Model()
    r.addPendingCard('c1', card)
    expect(r.Transcript.ToArray().includes(card)).toBe(true)
    expect(r.HasPendingQuestion).toBe(true)      // input gated
    expect(pendingChanges).toBe(1)

    // A following AssistantText starts a NEW bubble (the card reset currentAssistant).
    r.apply({ Kind: AgentEventKind.AssistantText, Text: 'more' })
    const texts = r.Transcript.ToArray().filter((m) => m instanceof AssistantMessage) as AssistantMessage[]
    expect(texts.length).toBe(2)

    r.releasePending('c1')
    expect(r.HasPendingQuestion).toBe(false)
    expect(pendingChanges).toBe(2)
})
```

(Ensure `AssistantMessage` and `TranscriptReducer` are imported in the test file — `TranscriptReducer` already is; add `AssistantMessage` if missing.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/modules/agent-chat/services/tests/transcript.test.ts -t addPendingCard`
Expected: FAIL — `addPendingCard` is not a function.

- [ ] **Step 3: Implement in `transcript.ts`**

Update the comment on `pendingQuestions` to "blocking cards (questions + create-project)". Add the two methods to `TranscriptReducer` (near `beginUserTurn`):

```ts
    // Add a card built outside the reducer (e.g. the create_project card, whose
    // form is assembled asynchronously by AgentService), mirroring how the Question
    // case adds a QuestionCard: reset the open assistant bubble, track it as a
    // blocking card so input is gated, and insert it.
    public addPendingCard(id: string, card: Model): void
    {
        this.currentAssistant = null
        this.pendingQuestions.add(id)
        this.Transcript.Add(card)
        this.onPendingChange?.()
    }

    // Release a blocking card once its interaction completes.
    public releasePending(id: string): void
    {
        this.pendingQuestions.delete(id)
        this.onPendingChange?.()
    }
```

Add a no-op `CreateProject` case to `apply()` (handled by AgentService, must not disturb the assistant bubble):

```ts
            case AgentEventKind.CreateProject:
                // Handled by AgentService (it builds the form + card asynchronously);
                // not folded here, and it must not disturb the open assistant bubble.
                break
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/modules/agent-chat/services/tests/transcript.test.ts`
Expected: PASS (new test + existing).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/agent-chat/services/transcript.ts src/renderer/src/modules/agent-chat/services/tests/transcript.test.ts
git commit -m "feat(agent-chat): transcript addPendingCard/releasePending + CreateProject no-op"
```

---

### Task 6: AgentService coordination

**Files:**
- Modify: `src/renderer/src/modules/agent-chat/services/agent-service.ts`
- Test: `src/renderer/src/modules/agent-chat/services/tests/agent-service.test.ts`

**Interfaces:**
- Consumes: `AgentEventKind.CreateProject`, `CreateProjectRequest`, `NewProjectResult`, `ProjectExplorerService.{NewProjectFormFor,CreateProject}` (Task 3), `NewProjectCard` (Task 4), `TranscriptReducer.{addPendingCard,releasePending}` (Task 5), `IAgentApi.createProjectResult` (Task 1).
- Produces: `AgentService.handleCreateProject(req: CreateProjectRequest): Promise<void>` (private); event routing that diverts `CreateProject` to it.

- [ ] **Step 1: Write the failing test** — append to `agent-service.test.ts`. It reuses that file's existing `providerWith(fakeStore(...))` builder (registers `OpenProjectsStore` + `EnvironmentService`); add these imports at the top of the file:

```ts
import { Model } from '@pragmatic-tech-ai/mural/runtime'
import { ProjectExplorerService } from '../../../project-explorer/services/project-explorer-service.js'
import { NewProjectCard } from '../new-project-card.js'
import { AgentEventKind, type AgentEvent, type CreateProjectResult, type IAgentApi } from '../../../../../../shared/agent-api.js'
```

```ts
test('a CreateProject event adds a card, creates via the explorer, and posts the outcome', async () => {
    // A bridge that captures the pushed-event handler and records createProjectResult.
    const posted: CreateProjectResult[] = []
    let push: ((e: AgentEvent) => void) | undefined
    const api: IAgentApi = {
        startSession: () => Promise.resolve(),
        sendTurn: () => Promise.resolve(),
        abort: () => Promise.resolve(),
        answerQuestion: () => Promise.resolve(),
        refreshProjectResult: () => Promise.resolve(),
        createProjectResult: (r) => { posted.push(r); return Promise.resolve() },
        onEvent: (h) => { push = h; return () => {} },
    }
    ;(globalThis as unknown as { api: unknown }).api = { agent: api }   // overrides beforeEach's bridge

    const provider = providerWith(fakeStore([]))
    let created: unknown
    const form = new Model()   // stand-in for the form VM; only identity matters here
    provider.registerInstance(ProjectExplorerService.Key, {
        NewProjectFormFor: async (close: (r?: unknown) => void) => { (form as { close?: unknown }).close = close; return form },
        CreateProject: async (data: unknown) => { created = data; return { created: true, folder: 'C:/x', name: 'X', type: 'diagram' } },
    } as unknown as ProjectExplorerService)

    const svc = new AgentService(provider)
    push!({ Kind: AgentEventKind.CreateProject, Request: { id: 'c1', prefill: { name: 'X' } } } as AgentEvent)
    await new Promise((r) => setTimeout(r, 0))   // let handleCreateProject build the form + add the card

    const card = svc.Transcript.ToArray().find((m) => m instanceof NewProjectCard) as NewProjectCard | undefined
    expect(card).toBeDefined()

    // Simulate the form's Confirm → its close(result) callback (wired by AgentService).
    ;(form as { close?: (r?: unknown) => void }).close!({ type: 'diagram', name: 'X', location: 'C:/x' })
    await new Promise((r) => setTimeout(r, 0))

    expect(created).toEqual({ type: 'diagram', name: 'X', location: 'C:/x' })
    expect(posted[0]).toEqual({ id: 'c1', created: true, folder: 'C:/x', name: 'X', type: 'diagram' })
    expect(card!.IsDone).toBe(true)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/modules/agent-chat/services/tests/agent-service.test.ts -t CreateProject`
Expected: FAIL — the event is applied to the reducer (no card / no post-back).

- [ ] **Step 3: Implement in `agent-service.ts`**

Add imports: `AgentEventKind`, `type CreateProjectRequest`, `type NewProjectResult`, `ProjectExplorerService`, `NewProjectCard`.

Replace the event subscription:

```ts
        this.agent.onEvent((event) => {
            if (event.Kind === AgentEventKind.CreateProject) { void this.handleCreateProject(event.Request); return }
            this.reducer.apply(event)
        })
```

Add the handler:

```ts
    // The agent called create_project: build a pre-filled New Project form (the
    // modal's view-model), host it in a card in the transcript, and — when the
    // user submits — create the project via the shared creator and post the
    // outcome back to unblock the tool. Cancel posts a cancelled outcome.
    private async handleCreateProject(req: CreateProjectRequest): Promise<void>
    {
        const explorer = this.Provider.getRequired(ProjectExplorerService.Key)
        const card = new NewProjectCard(req.id)
        const close = (result?: NewProjectResult): void =>
        {
            if (result === undefined)
            {
                card.showCancelled()
                void this.agent.createProjectResult({ id: req.id, created: false, cancelled: true })
                this.reducer.releasePending(req.id)
                return
            }
            void (async () =>
            {
                const outcome = await explorer.CreateProject(result)
                card.showResult(outcome)
                void this.agent.createProjectResult({ id: req.id, ...outcome })
                this.reducer.releasePending(req.id)
            })()
        }
        card.Form = await explorer.NewProjectFormFor(close, req.prefill)
        this.reducer.addPendingCard(req.id, card)
    }
```

Note `this.Provider` is available on `ServiceBase`. `NewProjectResult` is imported from `../../../services/projects/new-project-dialog-model.js`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/modules/agent-chat/services/tests/agent-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/agent-chat/services/agent-service.ts src/renderer/src/modules/agent-chat/services/tests/agent-service.test.ts
git commit -m "feat(agent-chat): AgentService coordinates the create_project card round-trip"
```

---

### Task 7: Full verification + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: node + web clean.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: all files pass, **no worker crash**. Confirm the count rose by the tests added above.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: clean (renderer `.mu` compiles, main/preload bundle).

- [ ] **Step 4: Manual smoke (documented, not automated)**

Run: `npm run dev`. In the chat, prompt the agent to create a project (or invoke the tool). Verify: the New Project card renders the full form (identical to the modal), Browse opens the native folder picker, Create makes the project on disk + adds it to the tree, the card collapses to the recap, and the agent's turn resumes with the outcome. Cancel returns a cancelled outcome. If the form does not render inside the card, resolve the resource-resolution caveat from Task 4, Step 5.

- [ ] **Step 5: Finish**

Use **superpowers:finishing-a-development-branch** to verify tests, then merge to `main` (matching how `refresh_project` landed) or open a PR.

---

## Notes for the implementer

- **Reducer field name:** `pendingQuestions` now tracks all blocking cards; its name is kept to avoid churn in `AgentService` (`HasPendingQuestion` gates `CanInput`). Don't rename it in this plan.
- **Why `CreateProject` returns an outcome (not a command):** `ICommand.Execute` is `void`; the card's submit needs the created folder/error to hand back to the tool. The command (`NewProjectCommand`) is untouched — creation is factored into the awaitable `CreateProject` both paths call.
- **Native socket ceiling:** keep `plexus-mcp-server.test.ts` at ≤3 real MCP `connect()` cycles (Task 2 adds none). The create-tool behavior is unit-tested via `requestCreateProject`/`resolveCreate` + the shared "tool surface" listing.

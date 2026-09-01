# PlexusWorkspace MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `PlexusWorkspace` in-process MCP server, wired into every agent session, exposing a `refresh_project` tool that re-scans and re-validates open Plexus projects from disk and returns a validation problem summary to the agent.

**Architecture:** A second in-process HTTP MCP server (`McpServer` + `StreamableHTTPServerTransport`) is stood up beside the existing `AskUserQuestionServer` in `registerAgentHandlers()` and handed to the Claude CLI in the same `--mcp-config`. The `refresh_project` tool blocks in the main process, emits a `RefreshProject` event over the existing `AgentChannel.Event` push channel, a renderer `WorkspaceRefreshService` rescans + revalidates the target project(s) and returns a per-project problem summary via a new `AgentChannel.RefreshProjectResult` IPC channel, which resolves the blocked tool call.

**Tech Stack:** TypeScript, Electron (main/preload/renderer), `@modelcontextprotocol/sdk`, `zod`, mural runtime DI (`ServiceBase`/`ServiceKey`), node:test + tsx.

## Global Constraints

- **Tests:** every test file lives in a `tests/` subfolder next to the code it exercises (e.g. `src/main/agent/tests/plexus-workspace-server.test.ts`).
- **Enums, not string-literal unions** — extend the existing `AgentChannel` / `AgentEventKind` enums; no `type X = 'a'|'b'`.
- **Names (verbatim):** server key `PlexusWorkspace`; tool `refresh_project`; qualified tool `mcp__PlexusWorkspace__refresh_project`.
- **Timeout:** the tool waits at most **30s** (30000 ms) for the renderer before resolving with an `error`.
- **Sample messages:** each project summary carries at most the **first 5** diagnostic messages.
- **Target:** `refresh_project` takes an **optional `path`**; if given, refresh the open project whose folder contains it; if omitted, refresh **all** open projects.
- **Trigger instruction:** the appended system prompt must tell the agent to call the tool **only when a turn actually created/modified/deleted/moved/renamed a file or folder** in a project — never for read-only or conversational turns.
- **Project identity** everywhere is the absolute folder path (`OpenProject.Folder` = `Project.RootPath` = `Diagnostic.projectId`).

## File Structure

- Create `src/main/agent/plexus-workspace-server.ts` — the MCP server (Task 2).
- Create `src/main/agent/tests/plexus-workspace-server.test.ts` — its tests (Task 2).
- Modify `src/shared/agent-api.ts` — shared enums/types/constants (Task 1).
- Create `src/shared/tests/agent-api.test.ts` — constant test (Task 1).
- Modify `src/main/agent/ai-provider.ts` + `src/main/agent/claude-cli-provider.ts` — appended system prompt (Task 3).
- Create `src/main/agent/tests/claude-cli-provider.test.ts` — provider args test (Task 3).
- Modify `src/main/agent.ts` — wire the server + result IPC + instruction (Task 4).
- Modify `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts` — `RefreshProjects` (Task 5).
- Create `src/renderer/src/services/workspace/workspace-refresh-service.ts` + `.../workspace/refresh-targets.ts` — the renderer orchestrator + pure helpers (Task 6).
- Create `src/renderer/src/services/workspace/tests/*` — their tests (Task 6).
- Modify `src/preload/index.ts`, `src/renderer/src/app.mu`, `src/renderer/src/main.js`, `src/renderer/src/modules/agent-chat/services/transcript.ts` — wiring (Task 7).

---

### Task 1: Shared contract (`agent-api.ts`)

**Files:**
- Modify: `src/shared/agent-api.ts`
- Test: `src/shared/tests/agent-api.test.ts`

**Interfaces:**
- Produces: `AgentChannel.RefreshProjectResult`; `AgentEventKind.RefreshProject`; consts `WORKSPACE_SERVER_KEY`, `REFRESH_TOOL_NAME`, `REFRESH_TOOL_QUALIFIED`; interfaces `RefreshProjectRequest`, `RefreshedProjectSummary`, `RefreshProjectResult`, `RefreshProjectEvent`; `IAgentApi.refreshProjectResult`.

- [ ] **Step 1: Write the failing test**

Create `src/shared/tests/agent-api.test.ts`:

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
    REFRESH_TOOL_QUALIFIED,
    WORKSPACE_SERVER_KEY,
    REFRESH_TOOL_NAME,
    AgentChannel,
    AgentEventKind,
} from '../agent-api.js'

describe('PlexusWorkspace shared contract', () => {
    test('qualified tool name matches the mcp__<server>__<tool> shape the allow-list needs', () => {
        assert.equal(WORKSPACE_SERVER_KEY, 'PlexusWorkspace')
        assert.equal(REFRESH_TOOL_NAME, 'refresh_project')
        assert.equal(REFRESH_TOOL_QUALIFIED, 'mcp__PlexusWorkspace__refresh_project')
    })
    test('new channel and event-kind members exist', () => {
        assert.equal(AgentChannel.RefreshProjectResult, 'agent:refresh-project-result')
        assert.equal(AgentEventKind.RefreshProject, 'refresh-project')
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Plexus && npx tsx --test src/shared/tests/agent-api.test.ts`
Expected: FAIL — `REFRESH_TOOL_QUALIFIED` (and the new members) are not exported.

- [ ] **Step 3: Add the members to `agent-api.ts`**

In `src/shared/agent-api.ts`, add to the `AgentChannel` enum (after `AnswerQuestion`):

```ts
    // renderer→main: the WorkspaceRefreshService's result for a pending
    // refresh_project tool call (unblocks the tool).
    RefreshProjectResult = 'agent:refresh-project-result',
```

Add to the `AgentEventKind` enum (after `Question`):

```ts
    // The agent called refresh_project: the renderer re-scans + re-validates the
    // target project(s) and replies via AgentChannel.RefreshProjectResult.
    RefreshProject = 'refresh-project',
```

After the `ASK_TOOL_QUALIFIED` const, add:

```ts
// The PlexusWorkspace MCP tool identity — a second in-process server. Kept next
// to the ask-tool consts so the provider can allow-list it without importing the
// SDK-heavy server.
export const WORKSPACE_SERVER_KEY = 'PlexusWorkspace'
export const REFRESH_TOOL_NAME = 'refresh_project'
export const REFRESH_TOOL_QUALIFIED = `mcp__${WORKSPACE_SERVER_KEY}__${REFRESH_TOOL_NAME}`
```

After the `QuestionAnswer` interface, add:

```ts
// refresh_project payloads. `path` (optional) targets one project by containment;
// omitted ⇒ all open projects. Correlated by `id` like a Question.
export interface RefreshProjectRequest { id: string; path?: string }
// Per-project outcome the tool returns to the agent.
export interface RefreshedProjectSummary
{
    name: string
    folder: string
    errorCount: number
    warningCount: number
    sampleMessages: string[]
}
// The tool result: one summary per refreshed project. `note` explains an empty
// set (e.g. path matched nothing); `error` marks a failure to refresh at all.
export interface RefreshProjectResult
{
    id: string
    projects: RefreshedProjectSummary[]
    note?: string
    error?: string
}
```

After the `QuestionEvent` interface, add:

```ts
export interface RefreshProjectEvent { Kind: AgentEventKind.RefreshProject; Request: RefreshProjectRequest }
```

Add `RefreshProjectEvent` to the `AgentEvent` union:

```ts
export type AgentEvent =
    | SessionStartedEvent
    | AssistantTextEvent
    | ToolUseEvent
    | ToolResultEvent
    | QuestionEvent
    | RefreshProjectEvent
    | TurnCompleteEvent
    | AgentErrorEvent
```

Add to the `IAgentApi` interface (after `answerQuestion`):

```ts
    // The renderer's summary for a pending refresh_project tool call.
    refreshProjectResult(result: RefreshProjectResult): Promise<void>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Plexus && npx tsx --test src/shared/tests/agent-api.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/agent-api.ts src/shared/tests/agent-api.test.ts
git commit -m "feat(agent-api): PlexusWorkspace refresh_project contract"
```

---

### Task 2: `PlexusWorkspaceServer` (main-process MCP server)

**Files:**
- Create: `src/main/agent/plexus-workspace-server.ts`
- Test: `src/main/agent/tests/plexus-workspace-server.test.ts`

**Interfaces:**
- Consumes (Task 1): `WORKSPACE_SERVER_KEY`, `REFRESH_TOOL_NAME`, `AgentEventKind`, `RefreshProjectRequest`, `RefreshProjectResult`, `AgentEvent`.
- Produces: `class PlexusWorkspaceServer` with `constructor(timeoutMs = 30000)`, `get Url(): string`, `setSink(sink: (e: AgentEvent) => void): void`, `requestRefresh(path?: string): Promise<RefreshProjectResult>`, `resolve(result: RefreshProjectResult): void`, `listen(host?): Promise<void>`, `close(): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `src/main/agent/tests/plexus-workspace-server.test.ts`:

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { PlexusWorkspaceServer } from '../plexus-workspace-server.js'
import { AgentEventKind, type AgentEvent, type RefreshProjectResult } from '../../../shared/agent-api.js'

describe('PlexusWorkspaceServer', () => {
    test('requestRefresh emits a RefreshProject event and resolves with the posted result', async () => {
        const server = new PlexusWorkspaceServer()
        const events: AgentEvent[] = []
        server.setSink((e) => events.push(e))

        const pending = server.requestRefresh('/proj/a/file.todl')
        assert.equal(events.length, 1)
        const evt = events[0]!
        assert.equal(evt.Kind, AgentEventKind.RefreshProject)
        const req = (evt as { Request: { id: string; path?: string } }).Request
        assert.equal(req.path, '/proj/a/file.todl')

        const result: RefreshProjectResult = {
            id: req.id,
            projects: [{ name: 'A', folder: '/proj/a', errorCount: 1, warningCount: 0, sampleMessages: ['boom'] }],
        }
        server.resolve(result)
        assert.deepEqual(await pending, result)
    })

    test('requestRefresh with no sink resolves immediately with an error', async () => {
        const server = new PlexusWorkspaceServer()
        const result = await server.requestRefresh()
        assert.equal(result.projects.length, 0)
        assert.ok((result.error ?? '').length > 0)
    })

    test('requestRefresh times out with an error when the renderer never replies', async () => {
        const server = new PlexusWorkspaceServer(20) // 20ms timeout
        server.setSink(() => { /* never resolves */ })
        const result = await server.requestRefresh()
        assert.ok((result.error ?? '').toLowerCase().includes('timed out'))
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Plexus && npx tsx --test src/main/agent/tests/plexus-workspace-server.test.ts`
Expected: FAIL — cannot find module `../plexus-workspace-server.js`.

- [ ] **Step 3: Write the server**

Create `src/main/agent/plexus-workspace-server.ts`:

```ts
// An in-process HTTP MCP server hosting the workspace-management tool
// `refresh_project`, pointed at by the `claude` CLI via --mcp-config. When the
// agent calls it, the handler emits a RefreshProject event (so the renderer can
// re-scan + re-validate) and BLOCKS until the renderer posts a result via
// resolve(...); that result is returned as the tool output. Mirrors
// AskUserQuestionServer; the model sees it as mcp__PlexusWorkspace__refresh_project.
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import {
    AgentEventKind,
    REFRESH_TOOL_NAME,
    WORKSPACE_SERVER_KEY,
    type AgentEvent,
    type RefreshProjectResult,
} from '../../shared/agent-api.js'

export class PlexusWorkspaceServer
{
    private httpServer: http.Server | undefined
    private url = ''
    private sink: ((event: AgentEvent) => void) | undefined
    // Pending tool calls awaiting a renderer result, keyed by the id we minted.
    private readonly pending = new Map<string, (result: RefreshProjectResult) => void>()
    private seq = 0
    private readonly transports = new Map<string, StreamableHTTPServerTransport>()

    // timeoutMs guards against a dead/absent renderer so the tool never hangs.
    constructor(private readonly timeoutMs = 30000) {}

    public get Url(): string { return this.url }

    public setSink(sink: (event: AgentEvent) => void): void { this.sink = sink }

    // Deliver the renderer's summary to the blocked tool call; no-op if stale.
    public resolve(result: RefreshProjectResult): void
    {
        const done = this.pending.get(result.id)
        if (done === undefined) return
        this.pending.delete(result.id)
        done(result)
    }

    // Emit a RefreshProject request and await the renderer's result. No sink (probe
    // / headless test) → resolve with an error so the round-trip still completes.
    public requestRefresh(path?: string): Promise<RefreshProjectResult>
    {
        const id = `r${(this.seq += 1)}`
        const sink = this.sink
        if (sink === undefined)
        {
            return Promise.resolve({ id, projects: [], error: 'No Plexus window is available to refresh.' })
        }
        return new Promise((resolve) =>
        {
            const timer = setTimeout(() =>
            {
                if (this.pending.delete(id))
                {
                    resolve({ id, projects: [], error: 'Timed out waiting for the Plexus UI to refresh.' })
                }
            }, this.timeoutMs)
            // Register BEFORE emitting so a fast reply can't race pending.set.
            this.pending.set(id, (result) => { clearTimeout(timer); resolve(result) })
            sink({ Kind: AgentEventKind.RefreshProject, Request: { id, path } })
        })
    }

    public async listen(host = '127.0.0.1'): Promise<void>
    {
        this.httpServer = http.createServer((req, res) => { void this.handle(req, res) })
        await new Promise<void>((resolve) => this.httpServer!.listen(0, host, resolve))
        const address = this.httpServer!.address()
        const port = typeof address === 'object' && address !== null ? address.port : 0
        this.url = `http://${host}:${port}/mcp`
    }

    public async close(): Promise<void>
    {
        for (const [id, done] of [...this.pending])
        {
            this.pending.delete(id)
            done({ id, projects: [], error: 'Server closed.' })
        }
        for (const transport of this.transports.values()) await transport.close()
        this.transports.clear()
        await new Promise<void>((resolve) => { if (this.httpServer) this.httpServer.close(() => resolve()); else resolve() })
    }

    private buildServer(): McpServer
    {
        const server = new McpServer({ name: WORKSPACE_SERVER_KEY, version: '0.1.0' })
        server.registerTool(
            REFRESH_TOOL_NAME,
            {
                title: 'Refresh a Plexus project after changing files',
                description:
                    'Call this ONLY after finishing work that created, modified, deleted, moved, or '
                    + 'renamed a file or folder inside a project directory, so Plexus re-scans the project '
                    + 'from disk and re-validates its models. Optionally pass `path` (a file or folder you '
                    + 'changed) to target just that project; omit it to refresh all open projects. Do NOT '
                    + 'call it for read-only or conversational turns that changed nothing on disk. Returns '
                    + 'per-project validation problem counts and a few sample messages.',
                inputSchema: { path: z.string().optional() },
            },
            async ({ path }) =>
            {
                const result = await this.requestRefresh(path)
                return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
            },
        )
        return server
    }

    private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void>
    {
        const sessionId = req.headers['mcp-session-id'] as string | undefined
        const body = req.method === 'POST' ? await readJsonBody(req) : undefined

        let transport = sessionId !== undefined ? this.transports.get(sessionId) : undefined
        if (transport === undefined && req.method === 'POST' && isInitializeRequest(body))
        {
            const created = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (sid) => { this.transports.set(sid, created) },
            })
            created.onclose = () => { if (created.sessionId !== undefined) this.transports.delete(created.sessionId) }
            await this.buildServer().connect(created)
            transport = created
        }
        if (transport === undefined)
        {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'No valid MCP session' }, id: null }))
            return
        }
        await transport.handleRequest(req, res, body)
    }
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown>
{
    return new Promise((resolve) =>
    {
        let raw = ''
        req.on('data', (chunk) => { raw += chunk })
        req.on('end', () => { try { resolve(raw.length > 0 ? JSON.parse(raw) : undefined) } catch { resolve(undefined) } })
        req.on('error', () => resolve(undefined))
    })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Plexus && npx tsx --test src/main/agent/tests/plexus-workspace-server.test.ts`
Expected: PASS (all three tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/plexus-workspace-server.ts src/main/agent/tests/plexus-workspace-server.test.ts
git commit -m "feat(agent): PlexusWorkspaceServer with refresh_project tool"
```

---

### Task 3: Appended system prompt in `ClaudeCliProvider`

**Files:**
- Modify: `src/main/agent/ai-provider.ts` (add `appendSystemPrompt?` to `McpOptions`)
- Modify: `src/main/agent/claude-cli-provider.ts:80-91` (`mcpArgs`)
- Test: `src/main/agent/tests/claude-cli-provider.test.ts`

**Interfaces:**
- Consumes: `McpOptions` (Task's own extension).
- Produces: when `mcp.appendSystemPrompt` is a non-empty string, `start()` includes `--append-system-prompt <text>` in the spawned args, and the written `--mcp-config` file contains every server in `mcp.servers`.

- [ ] **Step 1: Write the failing test**

Create `src/main/agent/tests/claude-cli-provider.test.ts`:

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ClaudeCliProvider } from '../claude-cli-provider.js'
import type { ChildLike } from '../ai-provider.js'

function fakeChild(): ChildLike
{
    return {
        stdout: { on: () => { /* no data */ } },
        stderr: { on: () => { /* no data */ } },
        stdin:  { write: () => { /* ignore */ } },
        on: () => { /* no error/close */ },
        kill: () => { /* no-op */ },
    }
}

describe('ClaudeCliProvider MCP + system-prompt args', () => {
    test('start() writes all servers to the config and appends the system prompt', () => {
        let captured: string[] = []
        const provider = new ClaudeCliProvider('claude', (_cmd, args) => { captured = args; return fakeChild() }, {
            servers: {
                plexus:         { type: 'http', url: 'http://127.0.0.1:1111/mcp' },
                PlexusWorkspace: { type: 'http', url: 'http://127.0.0.1:2222/mcp' },
            },
            allowedTools: ['mcp__plexus__ask_user_question', 'mcp__PlexusWorkspace__refresh_project'],
            appendSystemPrompt: 'CALL REFRESH ONLY AFTER FILE CHANGES',
        })

        provider.start('/cwd', [], () => { /* ignore events */ })

        const cfgIdx = captured.indexOf('--mcp-config')
        assert.ok(cfgIdx >= 0, '--mcp-config present')
        const config = JSON.parse(readFileSync(captured[cfgIdx + 1]!, 'utf8'))
        assert.deepEqual(Object.keys(config.mcpServers).sort(), ['PlexusWorkspace', 'plexus'])

        const allowIdx = captured.indexOf('--allowedTools')
        assert.ok(captured.slice(allowIdx + 1).includes('mcp__PlexusWorkspace__refresh_project'))

        const promptIdx = captured.indexOf('--append-system-prompt')
        assert.ok(promptIdx >= 0, '--append-system-prompt present')
        assert.equal(captured[promptIdx + 1], 'CALL REFRESH ONLY AFTER FILE CHANGES')
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Plexus && npx tsx --test src/main/agent/tests/claude-cli-provider.test.ts`
Expected: FAIL — no `--append-system-prompt` in args (and `appendSystemPrompt` is not a valid `McpOptions` field, a type error at build; the test asserts its absence at runtime).

- [ ] **Step 3: Extend `McpOptions` and `mcpArgs`**

In `src/main/agent/ai-provider.ts`, add to the `McpOptions` interface (after `disallowedTools?`):

```ts
    // Text appended to the backend's system prompt each session (via
    // --append-system-prompt). Used to instruct the model to call
    // refresh_project after file-changing turns.
    appendSystemPrompt?: string;
```

In `src/main/agent/claude-cli-provider.ts`, replace the `return` line of `mcpArgs()` (currently `return ['--mcp-config', configPath, ...allow, ...disallow]`) with:

```ts
        const appendPrompt = this.mcp.appendSystemPrompt !== undefined && this.mcp.appendSystemPrompt.length > 0
            ? ['--append-system-prompt', this.mcp.appendSystemPrompt] : []
        return ['--mcp-config', configPath, ...allow, ...disallow, ...appendPrompt]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Plexus && npx tsx --test src/main/agent/tests/claude-cli-provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/ai-provider.ts src/main/agent/claude-cli-provider.ts src/main/agent/tests/claude-cli-provider.test.ts
git commit -m "feat(agent): ClaudeCliProvider --append-system-prompt option"
```

---

### Task 4: Wire the server + result IPC in `registerAgentHandlers`

**Files:**
- Modify: `src/main/agent.ts`

**Interfaces:**
- Consumes: `PlexusWorkspaceServer` (Task 2); `WORKSPACE_SERVER_KEY`, `REFRESH_TOOL_QUALIFIED`, `AgentChannel.RefreshProjectResult`, `RefreshProjectResult` (Task 1); `McpOptions.appendSystemPrompt` (Task 3).
- Produces: a live `PlexusWorkspace` server in every session + the `RefreshProjectResult` IPC handler. **This is composition-root wiring — its gate is typecheck + build, not a new unit test** (the pieces it composes are unit-tested in Tasks 1–3).

- [ ] **Step 1: Edit `agent.ts`**

Update the imports at the top of `src/main/agent.ts`:

```ts
import {
    AgentChannel, ASK_TOOL_QUALIFIED, MCP_SERVER_KEY, REFRESH_TOOL_QUALIFIED,
    WORKSPACE_SERVER_KEY, type AgentEvent, type QuestionAnswer, type RefreshProjectResult,
} from '../shared/agent-api.js'
import { AiProviderService } from './agent/ai-provider-service.js'
import { ClaudeCliProvider } from './agent/claude-cli-provider.js'
import { AgentSession } from './agent/agent-session.js'
import { AskUserQuestionServer } from './agent/ask-user-question-server.js'
import { PlexusWorkspaceServer } from './agent/plexus-workspace-server.js'
```

Add the instruction constant just below the imports (above `emitToRenderer`):

```ts
// Appended to the model's system prompt every session so it calls refresh_project
// after — and only after — a turn that changed files or folders in a project.
const REFRESH_INSTRUCTION =
    'This workspace exposes a PlexusWorkspace MCP server. Call '
    + 'mcp__PlexusWorkspace__refresh_project (optionally with a path you changed) ONLY when the '
    + 'work you just finished created, modified, deleted, moved, or renamed a file or folder inside '
    + 'a project directory, so Plexus re-scans the project from disk and re-validates its models. '
    + 'Call it once at the end of such work, not after every individual edit. Do NOT call it for '
    + 'turns that changed nothing on disk — answering a question, reading or explaining code, '
    + 'running read-only commands, or pure discussion.'
```

Inside `registerAgentHandlers()`, after the `questionServer` block and before `const providers = ...`, add:

```ts
    // Start the in-process workspace MCP server (refresh_project). Its refresh
    // requests ride the same push sink as every other agent event.
    const workspaceServer = new PlexusWorkspaceServer()
    await workspaceServer.listen()
    workspaceServer.setSink(emitToRenderer)
```

Replace the `providers.register(new ClaudeCliProvider(...))` call with:

```ts
    const providers = new AiProviderService()
    providers.register(new ClaudeCliProvider(undefined, undefined, {
        servers: {
            [MCP_SERVER_KEY]:       { type: 'http', url: questionServer.Url },
            [WORKSPACE_SERVER_KEY]: { type: 'http', url: workspaceServer.Url },
        },
        allowedTools: [ASK_TOOL_QUALIFIED, REFRESH_TOOL_QUALIFIED],
        disallowedTools: ['AskUserQuestion'],
        appendSystemPrompt: REFRESH_INSTRUCTION,
    }))
```

After the `AnswerQuestion` handler, add:

```ts
    // The renderer's refresh summary → unblock the refresh_project tool call.
    ipcMain.handle(AgentChannel.RefreshProjectResult, (_e, result: RefreshProjectResult): void => {
        workspaceServer.resolve(result)
    })
```

- [ ] **Step 2: Typecheck + build**

Run: `cd Plexus && npm run typecheck:node`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/agent.ts
git commit -m "feat(agent): wire PlexusWorkspace server + refresh result IPC"
```

---

### Task 5: `ProjectExplorerService.RefreshProjects`

**Files:**
- Modify: `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts`
- Test: `src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts` (add a case to the existing file)

**Interfaces:**
- Consumes: existing private `findByFolder`, `rescan`; `TodlValidationService.ClearBaseCache`/`Revalidate`.
- Produces: `public async RefreshProjects(folders: readonly string[]): Promise<void>` — rescans each named open project and clears its base cache, then revalidates once. Unknown folders are skipped.

- [ ] **Step 1: Write the failing test**

Open `src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts` and read its top to reuse the harness (how it constructs the service with a provider, registers a fake `StorageProviderRegistry`/factories, and opens a project). Add this test (adapt the setup calls to the harness's existing helpers — e.g. if the file has an `openTestProject(service, folder)` helper, use it; otherwise open via the same steps the other tests use):

```ts
test('RefreshProjects rescans each named project and revalidates once', async () => {
    // Arrange: a fake validator registered under TodlValidationService.Key that
    // records calls, plus one open project at folder "/proj/a" (use the file's
    // existing open-a-project helper/steps).
    const calls: string[] = []
    const fakeValidator = {
        ClearBaseCache: () => { calls.push('clear') },
        Revalidate: async () => { calls.push('revalidate') },
    }
    // provider.register(TodlValidationService.Key, () => fakeValidator)  // match the harness's registration API
    // const service = <construct ProjectExplorerService with provider>
    // await <open a project at '/proj/a' via the harness>

    const op = service.OpenProjects.ToArray()[0]!
    const factory = op.Factory as { openProject: (s: unknown) => Promise<unknown> }
    let opened = 0
    const orig = factory.openProject.bind(factory)
    factory.openProject = async (s) => { opened += 1; return orig(s) }

    // Act
    await service.RefreshProjects([op.Folder, '/does/not/exist'])

    // Assert: rescanned the known project once, cleared its bases, revalidated once.
    assert.equal(opened, 1)
    assert.deepEqual(calls, ['clear', 'revalidate'])
})
```

> Note for the implementer: match the exact provider/registration/open-project mechanics already used by the other tests in this file rather than the pseudocode comments above. The behavioural assertions (rescan count, `['clear','revalidate']`) are what matter.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Plexus && npx tsx --conditions=development --test src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts`
Expected: FAIL — `service.RefreshProjects is not a function`.

- [ ] **Step 3: Add the method**

In `project-explorer-service.ts`, add a public method next to the other public methods (e.g. after `RestoreSession`). It reuses the existing private `rescan` and `findByFolder`:

```ts
    // Re-scan the named open projects from disk and re-validate their models —
    // the agent's refresh_project path. Rescans + drops each project's cached
    // bases, then revalidates once (Revalidate covers all open projects). Unknown
    // folders are skipped. Awaitable so the caller knows validation has settled.
    public async RefreshProjects(folders: readonly string[]): Promise<void>
    {
        const validator = this.Provider.get(TodlValidationService.Key)
        let any = false
        for (const folder of folders)
        {
            const op = this.findByFolder(folder)
            if (op === undefined) continue
            await this.rescan(op)
            validator?.ClearBaseCache(op.Storage)
            any = true
        }
        if (any) await validator?.Revalidate()
    }
```

Confirm `TodlValidationService` is already imported in this file (it is — `publishProject`/`refreshBases` use it). If not, add: `import { TodlValidationService } from '../../../services/todl/todl-validation-service.js'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Plexus && npx tsx --conditions=development --test src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts`
Expected: PASS (the new test and all existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/project-explorer/services/project-explorer-service.ts src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts
git commit -m "feat(project-explorer): RefreshProjects rescans + revalidates"
```

---

### Task 6: `WorkspaceRefreshService` + pure target/summary helpers

**Files:**
- Create: `src/renderer/src/services/workspace/refresh-targets.ts` (pure helpers)
- Create: `src/renderer/src/services/workspace/workspace-refresh-service.ts`
- Test: `src/renderer/src/services/workspace/tests/refresh-targets.test.ts`
- Test: `src/renderer/src/services/workspace/tests/workspace-refresh-service.test.ts`

**Interfaces:**
- Consumes: `RefreshProjectRequest`, `RefreshedProjectSummary`, `RefreshProjectResult`, `AgentEventKind`, `IAgentApi` (Task 1); `ProjectExplorerService.OpenProjects` + `RefreshProjects` (Task 5); `DiagnosticsService.All`, `Diagnostic`, `DiagnosticSeverity`; `OpenProject.Folder`/`.Name`.
- Produces:
  - `interface OpenProjectRef { folder: string; name: string }`
  - `resolveOwningProject(open: readonly OpenProjectRef[], path: string): OpenProjectRef | undefined`
  - `summarizeProject(ref: OpenProjectRef, diagnostics: readonly Diagnostic[]): RefreshedProjectSummary`
  - `class WorkspaceRefreshService extends ServiceBase` with `static Key` and `Dispose()`.

- [ ] **Step 1: Write the failing helper test**

Create `src/renderer/src/services/workspace/tests/refresh-targets.test.ts`:

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { resolveOwningProject, summarizeProject, type OpenProjectRef } from '../refresh-targets.js'
import { DiagnosticSeverity, type Diagnostic } from '../../diagnostics/diagnostic.js'

const OPEN: OpenProjectRef[] = [
    { folder: 'C:\\Users\\me\\projA', name: 'A' },
    { folder: 'C:\\Users\\me\\projB', name: 'B' },
]

function diag(projectId: string, severity: DiagnosticSeverity, message: string): Diagnostic
{
    return { owner: 'todl', projectId, projectName: 'x', uri: 'f.todl', message, severity, span: null }
}

describe('resolveOwningProject', () => {
    test('matches a file inside a project (Windows sep + case insensitive)', () => {
        const owner = resolveOwningProject(OPEN, 'c:/users/me/projA/models/x.todl')
        assert.equal(owner?.name, 'A')
    })
    test('matches the project folder itself', () => {
        assert.equal(resolveOwningProject(OPEN, 'C:\\Users\\me\\projB')?.name, 'B')
    })
    test('does not match a sibling whose name is a string-prefix but not a path-prefix', () => {
        assert.equal(resolveOwningProject([{ folder: '/p/proj', name: 'P' }], '/p/project-x/f.todl'), undefined)
    })
    test('returns undefined when nothing contains the path', () => {
        assert.equal(resolveOwningProject(OPEN, 'D:/other/x.todl'), undefined)
    })
})

describe('summarizeProject', () => {
    test('counts by severity and caps sample messages at 5', () => {
        const diags = [
            diag('C:\\Users\\me\\projA', DiagnosticSeverity.Error, 'e1'),
            diag('C:\\Users\\me\\projA', DiagnosticSeverity.Warning, 'w1'),
            ...Array.from({ length: 6 }, (_v, i) => diag('C:\\Users\\me\\projA', DiagnosticSeverity.Error, `x${i}`)),
            diag('C:\\Users\\me\\projB', DiagnosticSeverity.Error, 'other'),
        ]
        const s = summarizeProject(OPEN[0]!, diags)
        assert.equal(s.folder, 'C:\\Users\\me\\projA')
        assert.equal(s.errorCount, 7)
        assert.equal(s.warningCount, 1)
        assert.equal(s.sampleMessages.length, 5)
        assert.ok(!s.sampleMessages.includes('other'))
    })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd Plexus && npx tsx --conditions=development --test src/renderer/src/services/workspace/tests/refresh-targets.test.ts`
Expected: FAIL — cannot find `../refresh-targets.js`.

- [ ] **Step 3: Write the pure helpers**

Create `src/renderer/src/services/workspace/refresh-targets.ts`:

```ts
import { DiagnosticSeverity, type Diagnostic } from '../diagnostics/diagnostic.js'
import type { RefreshedProjectSummary } from '../../../../shared/agent-api.js'

// The minimum an open project contributes to refresh targeting + summaries.
export interface OpenProjectRef { folder: string; name: string }

const MAX_SAMPLE_MESSAGES = 5

// Normalize a path for containment comparison: backslashes → slashes, drop a
// trailing slash, lowercase (Plexus targets Windows; folder identity is
// case-insensitive there and harmless elsewhere for our own project paths).
function normalize(path: string): string
{
    const slashed = path.replace(/\\/g, '/').replace(/\/+$/, '')
    return slashed.toLowerCase()
}

// The open project whose folder CONTAINS `path` (the folder itself, or a path
// under it at a segment boundary). undefined if none — a sibling whose name is a
// mere string prefix ("/p/proj" vs "/p/project-x") does not match.
export function resolveOwningProject(open: readonly OpenProjectRef[], path: string): OpenProjectRef | undefined
{
    const p = normalize(path)
    return open.find((o) =>
    {
        const f = normalize(o.folder)
        return p === f || p.startsWith(`${f}/`)
    })
}

// Compact per-project problem summary from the flat diagnostics set.
export function summarizeProject(ref: OpenProjectRef, diagnostics: readonly Diagnostic[]): RefreshedProjectSummary
{
    const mine = diagnostics.filter((d) => d.projectId === ref.folder)
    return {
        name: ref.name,
        folder: ref.folder,
        errorCount:   mine.filter((d) => d.severity === DiagnosticSeverity.Error).length,
        warningCount: mine.filter((d) => d.severity === DiagnosticSeverity.Warning).length,
        sampleMessages: mine.slice(0, MAX_SAMPLE_MESSAGES).map((d) => d.message),
    }
}
```

- [ ] **Step 4: Run to verify helpers pass**

Run: `cd Plexus && npx tsx --conditions=development --test src/renderer/src/services/workspace/tests/refresh-targets.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing service test**

Create `src/renderer/src/services/workspace/tests/workspace-refresh-service.test.ts`:

```ts
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { WorkspaceRefreshService } from '../workspace-refresh-service.js'
import { ProjectExplorerService } from '../../../modules/project-explorer/services/project-explorer-service.js'
import { DiagnosticsService } from '../../diagnostics/diagnostics-service.js'
import { DiagnosticSeverity } from '../../diagnostics/diagnostic.js'
import { AgentEventKind, type AgentEvent, type RefreshProjectResult } from '../../../../shared/agent-api.js'

// Minimal fakes. onEvent captures the handler so the test can push events; the
// bridge records the result the service sends back.
function harness()
{
    let handler: ((e: AgentEvent) => void) | undefined
    const results: RefreshProjectResult[] = []
    const refreshedWith: string[][] = []
    ;(globalThis as unknown as { api: unknown }).api = {
        agent: {
            onEvent: (h: (e: AgentEvent) => void) => { handler = h; return () => { handler = undefined } },
            refreshProjectResult: (r: RefreshProjectResult) => { results.push(r); return Promise.resolve() },
        },
    }
    const provider = new ServiceProvider()
    // Fake explorer: two open projects; RefreshProjects records its argument.
    provider.register(ProjectExplorerService.Key, () => ({
        OpenProjects: { ToArray: () => [
            { Folder: '/p/a', Name: 'A' },
            { Folder: '/p/b', Name: 'B' },
        ] },
        RefreshProjects: async (folders: readonly string[]) => { refreshedWith.push([...folders]) },
    }) as unknown as ProjectExplorerService)
    const diagnostics = new DiagnosticsService(provider)
    provider.register(DiagnosticsService.Key, () => diagnostics)
    diagnostics.Publish('todl', '/p/a', [
        { owner: 'todl', projectId: '/p/a', projectName: 'A', uri: 'x.todl', message: 'boom', severity: DiagnosticSeverity.Error, span: null },
    ])
    return {
        provider, results, refreshedWith,
        push: (e: AgentEvent) => handler?.(e),
    }
}

describe('WorkspaceRefreshService', () => {
    beforeEach(() => { delete (globalThis as unknown as { api?: unknown }).api })

    test('no path → refreshes all open projects and returns a summary each', async () => {
        const h = harness()
        const service = new WorkspaceRefreshService(h.provider)
        h.push({ Kind: AgentEventKind.RefreshProject, Request: { id: 'r1' } })
        await new Promise((r) => setTimeout(r, 0)) // let the async handler settle
        assert.deepEqual(h.refreshedWith[0], ['/p/a', '/p/b'])
        const result = h.results[0]!
        assert.equal(result.id, 'r1')
        assert.equal(result.projects.length, 2)
        assert.equal(result.projects.find((p) => p.folder === '/p/a')?.errorCount, 1)
        service.Dispose()
    })

    test('path inside project A → refreshes only A', async () => {
        const h = harness()
        const service = new WorkspaceRefreshService(h.provider)
        h.push({ Kind: AgentEventKind.RefreshProject, Request: { id: 'r2', path: '/p/a/models/x.todl' } })
        await new Promise((r) => setTimeout(r, 0))
        assert.deepEqual(h.refreshedWith[0], ['/p/a'])
        assert.equal(h.results[0]!.projects.length, 1)
        service.Dispose()
    })

    test('path matching nothing → empty projects with a note', async () => {
        const h = harness()
        const service = new WorkspaceRefreshService(h.provider)
        h.push({ Kind: AgentEventKind.RefreshProject, Request: { id: 'r3', path: '/nope/x.todl' } })
        await new Promise((r) => setTimeout(r, 0))
        assert.deepEqual(h.refreshedWith[0], [])
        assert.equal(h.results[0]!.projects.length, 0)
        assert.ok((h.results[0]!.note ?? '').length > 0)
        service.Dispose()
    })
})
```

> Note: match `ServiceProvider`'s real registration API used elsewhere in the renderer tests (see `todl-validation-service.test.ts` / `agent-service.test.ts` for the exact `provider.register(...)` shape). Adjust the fake-registration calls if the signature differs.

- [ ] **Step 6: Run to verify it fails**

Run: `cd Plexus && npx tsx --conditions=development --test src/renderer/src/services/workspace/tests/workspace-refresh-service.test.ts`
Expected: FAIL — cannot find `../workspace-refresh-service.js`.

- [ ] **Step 7: Write the service**

Create `src/renderer/src/services/workspace/workspace-refresh-service.ts`:

```ts
// Renderer orchestrator for the agent's refresh_project tool. Subscribes to the
// pushed agent event stream; on a RefreshProject request it resolves the target
// open project(s), re-scans + re-validates them via ProjectExplorerService, builds
// a compact problem summary from DiagnosticsService, and returns it to the agent
// bridge (which unblocks the tool call in main). Eagerly constructed at startup so
// a refresh works even if the chat panel was never opened.
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { AgentEvent, IAgentApi, RefreshProjectRequest } from '../../../../shared/agent-api.js'
import { AgentEventKind } from '../../../../shared/agent-api.js'
import { ProjectExplorerService } from '../../modules/project-explorer/services/project-explorer-service.js'
import { DiagnosticsService } from '../diagnostics/diagnostics-service.js'
import { resolveOwningProject, summarizeProject, type OpenProjectRef } from './refresh-targets.js'

export class WorkspaceRefreshService extends ServiceBase
{
    public static readonly Key = new ServiceKey<WorkspaceRefreshService>('WorkspaceRefreshService')

    private readonly agent: IAgentApi
    private readonly unsubscribe: () => void

    constructor(provider: IServiceProvider)
    {
        super(provider)
        const bridge = (globalThis as unknown as { api?: { agent?: IAgentApi } }).api
        if (bridge?.agent === undefined)
        {
            throw new Error(
                'WorkspaceRefreshService: window.api.agent is unavailable — the Electron preload '
                + 'bridge did not load. This service requires the Plexus desktop host.',
            )
        }
        this.agent = bridge.agent
        this.unsubscribe = this.agent.onEvent((event) => {
            if (event.Kind === AgentEventKind.RefreshProject) void this.handle(event.Request)
        })
    }

    public Dispose(): void { this.unsubscribe() }

    private async handle(req: RefreshProjectRequest): Promise<void>
    {
        const explorer = this.Provider.getRequired(ProjectExplorerService.Key)
        const open: OpenProjectRef[] = explorer.OpenProjects.ToArray().map((o) => ({ folder: o.Folder, name: o.Name }))

        let targets = open
        let note: string | undefined
        if (req.path !== undefined)
        {
            const owner = resolveOwningProject(open, req.path)
            if (owner === undefined) { targets = []; note = `No open project contains ${req.path}.` }
            else targets = [owner]
        }
        else if (open.length === 0)
        {
            note = 'No projects are open.'
        }

        try
        {
            await explorer.RefreshProjects(targets.map((t) => t.folder))
        }
        catch (e)
        {
            void this.agent.refreshProjectResult({ id: req.id, projects: [], error: (e as Error).message })
            return
        }

        const diagnostics = this.Provider.getRequired(DiagnosticsService.Key).All.ToArray()
        const projects = targets.map((t) => summarizeProject(t, diagnostics))
        void this.agent.refreshProjectResult({ id: req.id, projects, note })
    }
}

export default WorkspaceRefreshService
```

- [ ] **Step 8: Run both workspace test files**

Run: `cd Plexus && npx tsx --conditions=development --test "src/renderer/src/services/workspace/tests/*.test.ts"`
Expected: PASS (all cases).

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/services/workspace
git commit -m "feat(workspace): WorkspaceRefreshService + refresh target helpers"
```

---

### Task 7: Wiring — preload, registration, eager start, reducer tolerance

**Files:**
- Modify: `src/preload/index.ts:77-91` (agent bridge)
- Modify: `src/renderer/src/app.mu` (`.services:` block, ~line 194)
- Modify: `src/renderer/src/main.js` (eager construction)
- Modify: `src/renderer/src/modules/agent-chat/services/transcript.ts` (ignore the new event kind)

**Interfaces:**
- Consumes: `AgentChannel.RefreshProjectResult` (Task 1); `WorkspaceRefreshService` (Task 6).
- Produces: `window.api.agent.refreshProjectResult`; an eagerly-constructed `WorkspaceRefreshService`; a `TranscriptReducer` that ignores `RefreshProject`. **Gate: typecheck + build + manual smoke** (composition wiring).

- [ ] **Step 1: Preload — expose `refreshProjectResult`**

In `src/preload/index.ts`, inside the `agent: IAgentApi = { ... }` object, add after the `answerQuestion` line:

```ts
  refreshProjectResult: (result): Promise<void> => ipcRenderer.invoke(AgentChannel.RefreshProjectResult, result),
```

- [ ] **Step 2: Register `WorkspaceRefreshService` in `app.mu`**

Read the top-of-file import list in `src/renderer/src/app.mu` (around line 114 where `TodlValidationService` is imported) and add an import following the same syntax:

```
import WorkspaceRefreshService from "./services/workspace/workspace-refresh-service.js"
```

In the `.services:` block, add `WorkspaceRefreshService` on its own line after `TodlValidationService` (line ~194):

```
        // Agent workspace tools: subscribes to the agent event stream and services
        // refresh_project (re-scan + re-validate + reply). Eagerly resolved in
        // main.js so it's listening before the first turn.
        WorkspaceRefreshService
```

- [ ] **Step 3: Eagerly construct it in `main.js`**

In `src/renderer/src/main.js`, add an import near the other service imports (after the `ProjectExplorerService` import, line ~22):

```js
import { WorkspaceRefreshService } from './services/workspace/workspace-refresh-service.js'
```

Inside the `try { ... }` block after `app.initialize(renderTarget)` (e.g. just after the `registerThemeSchemePicker(app)` line), add:

```js
    // Construct the workspace-refresh service now so it subscribes to agent
    // events before any turn runs (it isn't tied to a visible panel).
    app.Services.get(WorkspaceRefreshService.Key)
```

- [ ] **Step 4: Make `TranscriptReducer` ignore the new event kind**

Read `src/renderer/src/modules/agent-chat/services/transcript.ts` and find `apply(event)`'s switch/if over `event.Kind`. If it has a default/else that ignores unknown kinds, no change is needed — verify and move on. If it exhaustively handles kinds (and would fall through or throw on a new one), add a no-op branch:

```ts
        case AgentEventKind.RefreshProject:
            return // handled by WorkspaceRefreshService, not part of the transcript
```

(Import `AgentEventKind` if not already imported.)

- [ ] **Step 5: Typecheck + build**

Run: `cd Plexus && npm run typecheck && npm run build`
Expected: typecheck clean; build succeeds (`✓ built`).

- [ ] **Step 6: Manual smoke (documented, not automated)**

Run the app (`npm run dev`), open a project, and in the agent chat ask it to create or edit a file in the project, then confirm: the project tree updates without a manual refresh, the Problems dock reflects the change, and the agent's transcript shows a `refresh_project` tool call whose result contains the problem summary. (This is a manual verification step; there is no automated test for the full Electron round-trip.)

- [ ] **Step 7: Commit**

```bash
git add src/preload/index.ts src/renderer/src/app.mu src/renderer/src/main.js src/renderer/src/modules/agent-chat/services/transcript.ts
git commit -m "feat(workspace): wire refresh_project round-trip end to end"
```

---

## Self-Review

**Spec coverage:**
- MCP server `PlexusWorkspace` handed to every session → Tasks 2, 4. ✓
- `refresh_project` tool, optional `path` → Tasks 2 (schema), 6 (targeting). ✓
- Rescan + revalidate → Task 5. ✓
- Round-trip returning a problem summary → Tasks 2 (block/resolve), 6 (summary), 1 (types). ✓
- Appended system prompt, "only when files/folders changed" → Tasks 3, 4. ✓
- Renderer approach A (rides agent event stream + new result channel) → Tasks 1, 6, 7. ✓
- Error handling (no match/note, no projects, revalidate throw, timeout, no sink) → Tasks 2 (timeout/no-sink/close), 6 (note/throw). ✓
- 30s timeout, 5 sample messages, project identity = folder path → Tasks 2, 6 (constants). ✓
- Tests in `tests/` subfolders → every task. ✓

**Placeholder scan:** No TBD/TODO. The two "match the harness" notes (Tasks 5, 6) point at concrete existing test files for the exact provider/registration API rather than inventing one — the assertions are fully specified.

**Type consistency:** `RefreshProjectResult`/`RefreshedProjectSummary`/`RefreshProjectRequest` field names identical across Tasks 1, 2, 6. `RefreshProjects(folders)` signature identical in Tasks 5 and 6. `resolveOwningProject`/`summarizeProject`/`OpenProjectRef` identical across Task 6 files. `WORKSPACE_SERVER_KEY`/`REFRESH_TOOL_QUALIFIED` used consistently in Tasks 1, 2, 4. `AgentChannel.RefreshProjectResult` / `AgentEventKind.RefreshProject` consistent across Tasks 1, 2, 4, 6, 7.

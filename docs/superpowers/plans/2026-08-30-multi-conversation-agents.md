# Multi-Conversation Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Plexus's single agent chat into multiple concurrent, parallel agent conversations — dock tabs plus a Conversations navigation panel — with persistence gated on whether the provider can actually resume the AI's context.

**Architecture:** A main-process `AgentSessionManager` keys N `AgentSession`s (each one subprocess) by a renderer-minted `sessionId`; every IPC command carries that id and every pushed event is wrapped `{ SessionId, Event }`. The renderer's single `AgentService` singleton is split into a per-conversation `ChatSession` VM (a dock panel) and a root `ChatSessionsService` that owns the one bridge listener, routes events by `sessionId`, and persists resumable conversations through a `ChatStore`. Interactive MCP tool events (question/approval/create-project) are attributed to a session by threading the `sessionId` through a `?session=` query on each session's per-process MCP config URL.

**Tech Stack:** TypeScript, Electron (main/preload/renderer), `@pragmatic-tech-ai/mural` (`MuralBase`/`ServiceBase`/`ObservableCollection`/`RelayCommand`/DPs), Vitest (unit), Playwright `_electron` (e2e), mural `.mu` markup compiled via `npm run compile:mu`.

**Spec:** `docs/superpowers/specs/2026-08-30-multi-conversation-agents-design.md`

## Global Constraints

- **Enums, never string-literal unions** (repo rule) — any new closed set is a real `enum`.
- **Every test file lives in a `tests/` subfolder** next to the code it exercises (`src/.../tests/foo.test.ts`), never beside the source (CLAUDE.md).
- **Render through templates only** — all chat/panel chrome lives in `.mu` DataTemplates/Styles; no hardcoded visual construction in TS.
- **No `Date.now()` / `Math.random()` in main-process code** — keep the monotonic-`seq` / deterministic style already in `plexus-mcp-server.ts`. The **renderer** may use `crypto.randomUUID()` (Chromium) to mint `sessionId`s.
- **The claude CLI stays non-bare** (rides the user's logged-in subscription) — do not add `--bare`/API-key flags.
- Builds on the already-published mural `^0.40.0` (no mural change in this plan).
- **Two distinct "session id" namespaces — do not conflate:** the renderer-minted **`sessionId`** (our stable key, in `TaggedAgentEvent.SessionId` and every command) vs. the **CLI session id** (the claude backend's own id, surfaced as `SessionStartedEvent.SessionId`, used only as the resume token). A `TaggedAgentEvent` wrapping a `SessionStartedEvent` therefore carries *both*: `msg.SessionId` = ours, `msg.Event.SessionId` = the CLI's.
- **Commit messages** end with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Work happens directly on `main` (established project flow; user has consented).

---

### Task 1: Provider resume descriptor + per-session MCP URL

Teach the provider seam two new things: whether it can resume AI context (`Resumable`), and how to start a session that (a) is addressed by our `sessionId` and (b) optionally resumes a prior CLI session via `--resume`.

**Files:**
- Modify: `src/main/agent/ai-provider.ts`
- Modify: `src/main/agent/claude-cli-provider.ts`
- Test: `src/main/agent/tests/claude-cli-provider.test.ts` (add cases)

**Interfaces:**
- Produces: `IAiProvider.Resumable: boolean`; `IAiProvider.start(sessionId: string, workingDirectory: string, addDirs: readonly string[], onEvent: (e: AgentEvent) => void, resumeToken?: string): AiProviderSession`. `AiProviderSession` is unchanged (`send`/`abort`/`dispose`).

- [ ] **Step 1: Write the failing tests**

Add to `src/main/agent/tests/claude-cli-provider.test.ts`:

```ts
import type { ChildLike, SpawnFn } from '../ai-provider.js'
import { readFileSync } from 'node:fs'

// A spawn that records (command, args, cwd) and returns an inert child.
function captureSpawn() {
    const calls: Array<{ command: string; args: string[]; cwd: string }> = []
    const spawn: SpawnFn = (command, args, options) => {
        calls.push({ command, args: [...args], cwd: options.cwd })
        return {
            stdout: { on: () => {} }, stderr: { on: () => {} },
            stdin: { write: () => {} }, on: () => {}, kill: () => {},
        } as ChildLike
    }
    return { spawn, calls }
}

test('the provider declares itself resumable', () => {
    expect(new ClaudeCliProvider().Resumable).toBe(true)
})

test('start passes --resume <token> when a resume token is supplied', () => {
    const { spawn, calls } = captureSpawn()
    new ClaudeCliProvider('claude', spawn).start('s1', '/proj', [], () => {}, 'cli-abc')
    const args = calls[0].args
    const i = args.indexOf('--resume')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(args[i + 1]).toBe('cli-abc')
})

test('start omits --resume when no token is supplied', () => {
    const { spawn, calls } = captureSpawn()
    new ClaudeCliProvider('claude', spawn).start('s1', '/proj', [], () => {})
    expect(calls[0].args).not.toContain('--resume')
})

test('the MCP config URL carries the session id so tool calls are attributable', () => {
    const { spawn, calls } = captureSpawn()
    const mcp = { servers: { plexus: { type: 'http' as const, url: 'http://127.0.0.1:9/mcp' } }, allowedTools: [] }
    new ClaudeCliProvider('claude', spawn, mcp).start('sess-42', '/proj', [], () => {})
    const args = calls[0].args
    const cfgPath = args[args.indexOf('--mcp-config') + 1]
    const written = JSON.parse(readFileSync(cfgPath, 'utf8'))
    expect(written.mcpServers.plexus.url).toBe('http://127.0.0.1:9/mcp?session=sess-42')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/agent/tests/claude-cli-provider.test.ts`
Expected: FAIL — `Resumable` undefined; `start` arity/signature mismatch; URL has no `?session=`.

- [ ] **Step 3: Implement**

In `ai-provider.ts`, extend the interface:

```ts
export interface IAiProvider
{
    readonly Id: string;
    // Can this provider restore an earlier conversation's AI context? Gates whether
    // the renderer persists a conversation for later resume.
    readonly Resumable: boolean;
    // sessionId = Plexus's stable id for this conversation (threaded into the MCP
    // config URL so tool calls are attributable). resumeToken = a prior CLI session
    // id to resume, when reopening a stored conversation.
    start(
        sessionId: string,
        workingDirectory: string,
        addDirs: readonly string[],
        onEvent: (event: AgentEvent) => void,
        resumeToken?: string,
    ): AiProviderSession;
}
```

In `claude-cli-provider.ts`:
- Add `public readonly Resumable = true`.
- Change `start(...)` to the new signature. Build args with the resume flag and pass `sessionId` to `mcpArgs`:

```ts
public start(
    sessionId: string,
    workingDirectory: string,
    addDirs: readonly string[],
    onEvent: (event: AgentEvent) => void,
    resumeToken?: string,
): AiProviderSession
{
    const resume = resumeToken !== undefined ? ['--resume', resumeToken] : []
    const args = [...CLI_ARGS, ...resume, ...addDirs.flatMap((d) => ['--add-dir', d]), ...this.mcpArgs(sessionId)]
    const child = this.spawnFn(this.binaryPath, args, { cwd: workingDirectory })
    // …parser + stdout/stderr wiring unchanged…
}
```

- Change `mcpArgs()` → `mcpArgs(sessionId: string)`. Append the session query to the server URL before writing the config file, and name the file per session so concurrent sessions don't clobber each other's config:

```ts
private mcpArgs(sessionId: string): string[]
{
    if (this.mcp === undefined) return []
    const first = Object.values(this.mcp.servers)[0]
    const port = first !== undefined ? new URL(first.url).port : '0'
    // Tag each server URL with the session so the MCP server can attribute tool
    // calls (question/approval/create-project) back to this conversation.
    const servers: Record<string, { type: 'http'; url: string }> = {}
    for (const [key, cfg] of Object.entries(this.mcp.servers))
        servers[key] = { type: 'http', url: `${cfg.url}?session=${encodeURIComponent(sessionId)}` }
    const configPath = join(tmpdir(), `plexus-mcp-${port}-${sessionId}.json`)
    writeFileSync(configPath, JSON.stringify({ mcpServers: servers }))
    // …allow/disallow/appendPrompt/promptTool assembly unchanged…
    return ['--mcp-config', configPath, ...allow, ...disallow, ...appendPrompt, ...promptTool]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/agent/tests/claude-cli-provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/ai-provider.ts src/main/agent/claude-cli-provider.ts src/main/agent/tests/claude-cli-provider.test.ts
git commit -m "feat(agent): provider resume descriptor + per-session MCP config URL"
```

---

### Task 2: `AgentSession` carries a sessionId and captures its resume token

Give `AgentSession` its `sessionId` (forwarded to `provider.start`) and let it capture the CLI's session id from the `SessionStarted` event as a resume token exposed via `ResumeToken`.

**Files:**
- Modify: `src/main/agent/agent-session.ts`
- Test: `src/main/agent/tests/agent-session.test.ts` (update the fake provider + add cases)

**Interfaces:**
- Consumes: `IAiProvider.start(sessionId, cwd, addDirs, onEvent, resumeToken?)` (Task 1).
- Produces: `new AgentSession(providers, sessionId: string, emit)`; `AgentSession.start(cwd, addDirs, resumeToken?)`; `AgentSession.ResumeToken: string | undefined`.

- [ ] **Step 1: Write the failing tests**

Update `recordingProvider()` in `src/main/agent/tests/agent-session.test.ts` so `start` matches the new signature and records `sessionId` + `resumeToken`, then adjust the existing constructor calls to pass a session id and add two cases:

```ts
function recordingProvider() {
    const started: Array<{
        sessionId: string; cwd: string; addDirs: string[]; resumeToken: string | undefined
        onEvent: (e: AgentEvent) => void; sent: string[]; disposed: boolean; aborted: boolean
    }> = []
    const provider: IAiProvider = {
        Id: 'rec',
        Resumable: true,
        start: (sessionId, cwd, addDirs, onEvent, resumeToken): AiProviderSession => {
            const rec = { sessionId, cwd, addDirs: [...addDirs], resumeToken, onEvent,
                          sent: [] as string[], disposed: false, aborted: false }
            started.push(rec)
            return { send: (t) => rec.sent.push(t), abort: () => { rec.aborted = true }, dispose: () => { rec.disposed = true } }
        },
    }
    return { provider, started }
}

// NOTE: update every existing `new AgentSession(serviceWith(provider), fn)` in this
// file to `new AgentSession(serviceWith(provider), 'sess-1', fn)`.

test('the session id is forwarded to the provider', () => {
    const { provider, started } = recordingProvider()
    new AgentSession(serviceWith(provider), 'sess-9', () => {}).start('/proj', [])
    expect(started[0].sessionId).toBe('sess-9')
})

test('ResumeToken captures the CLI session id from SessionStarted', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), 'sess-9', () => {})
    session.start('/proj', [])
    expect(session.ResumeToken).toBeUndefined()
    started[0].onEvent({ Kind: AgentEventKind.SessionStarted, SessionId: 'cli-777' })
    expect(session.ResumeToken).toBe('cli-777')
})

test('an explicit resume token is forwarded to the provider on start', () => {
    const { provider, started } = recordingProvider()
    new AgentSession(serviceWith(provider), 'sess-9', () => {}).start('/proj', [], 'cli-abc')
    expect(started[0].resumeToken).toBe('cli-abc')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/agent/tests/agent-session.test.ts`
Expected: FAIL — constructor arity, missing `ResumeToken`, resume token not forwarded.

- [ ] **Step 3: Implement**

Rewrite `agent-session.ts` to thread the id + token:

```ts
export class AgentSession
{
    private current: AiProviderSession | null = null
    private target: { cwd: string; addDirs: readonly string[] } | null = null
    private resumeToken: string | undefined = undefined

    constructor(
        private readonly providers: AiProviderService,
        private readonly sessionId: string,
        private readonly emit: (event: AgentEvent) => void,
    ) {}

    // The captured CLI session id, usable to resume this conversation later
    // (undefined until the first SessionStarted event arrives).
    public get ResumeToken(): string | undefined { return this.resumeToken }

    public start(workingDirectory: string, addDirs: readonly string[], resumeToken?: string): void
    {
        this.current?.dispose()
        if (resumeToken !== undefined) this.resumeToken = resumeToken
        this.current = this.providers.active().start(
            this.sessionId, workingDirectory, addDirs,
            (event) => {
                if (event.Kind === AgentEventKind.SessionStarted) this.resumeToken = event.SessionId
                this.emit(event)
            },
            this.resumeToken,
        )
        this.target = { cwd: workingDirectory, addDirs: [...addDirs] }
    }

    public send(workingDirectory: string, addDirs: readonly string[], text: string): void
    {
        if (this.current === null || !this.sameTarget(workingDirectory, addDirs)) this.start(workingDirectory, addDirs)
        this.current!.send(text)
    }

    // abort(), dispose(), sameTarget() unchanged from the current file.
}
```

Add the import: `import { AgentEventKind } from '../../shared/agent-api.js'` (alongside the existing `type AgentEvent`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/agent/tests/agent-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/agent-session.ts src/main/agent/tests/agent-session.test.ts
git commit -m "feat(agent): AgentSession carries sessionId + captures resume token"
```

---

### Task 3: Session-tagged shared contract

Add the `TaggedAgentEvent` wrapper, the `CloseSession` channel, and session-tag the four addressed commands + `isResumable` on `IAgentApi`. Reply methods (`answerQuestion`, `answerToolApproval`, `*Result`) stay unchanged — the MCP server resolves them by their globally-unique request `id`, so they need no `sessionId`.

**Files:**
- Modify: `src/shared/agent-api.ts`

**Interfaces:**
- Produces:
  - `interface TaggedAgentEvent { SessionId: string; Event: AgentEvent }`
  - `AgentChannel.CloseSession = 'agent:close-session'`
  - `IAgentApi.startSession(sessionId, workingDirectory, addDirs, resumeToken?)`, `.closeSession(sessionId)`, `.sendTurn(sessionId, workingDirectory, addDirs, text)`, `.abort(sessionId)`, `.isResumable(): Promise<boolean>`, `.onEvent(handler: (msg: TaggedAgentEvent) => void)`.

- [ ] **Step 1: Edit the contract (type-only; verified by the type-check in Step 2)**

In `src/shared/agent-api.ts`:

Add to the `AgentChannel` enum:

```ts
    // renderer→main: dispose one session's subprocess.
    CloseSession = 'agent:close-session',
    // renderer→main query: does the active provider support resuming AI context?
    IsResumable = 'agent:is-resumable',
```

Add the wrapper type near the `AgentEvent` union:

```ts
// A pushed agent event tagged with the Plexus conversation it belongs to. NB:
// `SessionId` here is Plexus's own conversation id (see AgentSessionManager); a
// wrapped SessionStartedEvent additionally carries the CLI's id in `Event.SessionId`.
export interface TaggedAgentEvent { SessionId: string; Event: AgentEvent }
```

Replace the addressed methods + `onEvent` in `IAgentApi` (leave `answerQuestion`, `answerToolApproval`, `refreshProjectResult`, `createProjectResult`, `getProblemsResult`, `listApprovalRules`, `revokeApprovalRule` exactly as they are):

```ts
export interface IAgentApi
{
    startSession(sessionId: string, workingDirectory: string, addDirs: readonly string[], resumeToken?: string): Promise<void>;
    closeSession(sessionId: string): Promise<void>;
    sendTurn(sessionId: string, workingDirectory: string, addDirs: readonly string[], text: string): Promise<void>;
    abort(sessionId: string): Promise<void>;
    // Whether the active provider can resume AI context (gates persistence).
    isResumable(): Promise<boolean>;
    // …unchanged reply + approval-rule methods…
    onEvent(handler: (msg: TaggedAgentEvent) => void): () => void;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.node.json` (the main/preload/shared project)
Expected: errors ONLY in the not-yet-updated call sites (`preload/index.ts`, `main/agent.ts`, renderer `agent-service.ts`) — those are Tasks 6/7/9/11. The `agent-api.ts` file itself must compile clean.

> This task has no isolated unit test — it's a pure contract change consumed by later tasks. Commit it so the contract "travels" ahead of its consumers.

- [ ] **Step 3: Commit**

```bash
git add src/shared/agent-api.ts
git commit -m "feat(agent): session-tagged IPC contract (TaggedAgentEvent, CloseSession, isResumable)"
```

---

### Task 4: `AgentSessionManager`

A main-process registry of `AgentSession`s keyed by `sessionId`, each wired to a per-session sink that wraps events as `TaggedAgentEvent`.

**Files:**
- Create: `src/main/agent/agent-session-manager.ts`
- Test: `src/main/agent/tests/agent-session-manager.test.ts`

**Interfaces:**
- Consumes: `AgentSession` (Task 2), `AiProviderService`, `TaggedAgentEvent` (Task 3).
- Produces: `class AgentSessionManager { constructor(providers: AiProviderService, emit: (t: TaggedAgentEvent) => void); create(sessionId): AgentSession; get(sessionId): AgentSession | undefined; close(sessionId): void }`.

- [ ] **Step 1: Write the failing test**

`src/main/agent/tests/agent-session-manager.test.ts`:

```ts
import { test, expect } from 'vitest'
import { AgentSessionManager } from '../agent-session-manager.js'
import { AiProviderService } from '../ai-provider-service.js'
import type { AiProviderSession, IAiProvider } from '../ai-provider.js'
import { AgentEventKind, type AgentEvent, type TaggedAgentEvent } from '../../../shared/agent-api.js'

function recordingProvider() {
    const started: Array<{ sessionId: string; onEvent: (e: AgentEvent) => void; disposed: boolean }> = []
    const provider: IAiProvider = {
        Id: 'rec', Resumable: true,
        start: (sessionId, _cwd, _dirs, onEvent): AiProviderSession => {
            const rec = { sessionId, onEvent, disposed: false }
            started.push(rec)
            return { send: () => {}, abort: () => {}, dispose: () => { rec.disposed = true } }
        },
    }
    const svc = new AiProviderService(); svc.register(provider)
    return { svc, started }
}

test('create is idempotent by id', () => {
    const { svc } = recordingProvider()
    const mgr = new AgentSessionManager(svc, () => {})
    const a = mgr.create('s1')
    expect(mgr.create('s1')).toBe(a)
})

test('each session tags its events with its own sessionId', () => {
    const { svc, started } = recordingProvider()
    const tagged: TaggedAgentEvent[] = []
    const mgr = new AgentSessionManager(svc, (t) => tagged.push(t))
    mgr.create('A').start('/p', [])
    mgr.create('B').start('/p', [])
    started[0].onEvent({ Kind: AgentEventKind.TurnComplete })
    started[1].onEvent({ Kind: AgentEventKind.Error, Message: 'x' })
    expect(tagged).toEqual([
        { SessionId: 'A', Event: { Kind: AgentEventKind.TurnComplete } },
        { SessionId: 'B', Event: { Kind: AgentEventKind.Error, Message: 'x' } },
    ])
})

test('close disposes the subprocess and forgets the id', () => {
    const { svc, started } = recordingProvider()
    const mgr = new AgentSessionManager(svc, () => {})
    mgr.create('s1').start('/p', [])
    mgr.close('s1')
    expect(started[0].disposed).toBe(true)
    expect(mgr.get('s1')).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/agent/tests/agent-session-manager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/main/agent/agent-session-manager.ts`:

```ts
// Registry of live AgentSessions keyed by Plexus's sessionId. Each session is one
// provider subprocess; N entries = N conversations running in parallel. Every
// session's events are wrapped as TaggedAgentEvent so the renderer can route them
// back to the right ChatSession.
import { AgentSession } from './agent-session.js'
import type { AiProviderService } from './ai-provider-service.js'
import type { TaggedAgentEvent } from '../../shared/agent-api.js'

export class AgentSessionManager
{
    private readonly sessions = new Map<string, AgentSession>()

    constructor(
        private readonly providers: AiProviderService,
        private readonly emit: (tagged: TaggedAgentEvent) => void,
    ) {}

    // Return the session for this id, creating it (idempotently) on first use.
    public create(sessionId: string): AgentSession
    {
        let session = this.sessions.get(sessionId)
        if (session === undefined)
        {
            session = new AgentSession(this.providers, sessionId, (event) => this.emit({ SessionId: sessionId, Event: event }))
            this.sessions.set(sessionId, session)
        }
        return session
    }

    public get(sessionId: string): AgentSession | undefined { return this.sessions.get(sessionId) }

    public close(sessionId: string): void
    {
        const session = this.sessions.get(sessionId)
        if (session === undefined) return
        session.dispose()
        this.sessions.delete(sessionId)
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/agent/tests/agent-session-manager.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/agent-session-manager.ts src/main/agent/tests/agent-session-manager.test.ts
git commit -m "feat(agent): AgentSessionManager keying parallel sessions by id"
```

---

### Task 5: Per-session event tagging in `PlexusMcpServer`

Interactive MCP tool events (question / approval / create-project / refresh / get-problems) are emitted by the shared HTTP server, which today can't say which conversation triggered them. Route them: read `?session=` from the request URL at MCP-initialize, capture it in the per-transport `buildServer(sessionId)` closure, and emit `TaggedAgentEvent`s. Resolvers stay keyed by request `id` (already globally unique).

**Files:**
- Modify: `src/main/agent/plexus-mcp-server.ts`
- Test: `src/main/agent/tests/plexus-mcp-server.test.ts` (add a tagging case)

**Interfaces:**
- Consumes: `TaggedAgentEvent` (Task 3).
- Produces: `PlexusMcpServer.setSink(sink: (tagged: TaggedAgentEvent) => void)` (signature change); internal `buildServer(sessionId: string)`; tool paths (`ask`/`requestApproval`/`requestRefresh`/`requestCreateProject`/`requestProblems`) tag their emitted event with `sessionId`.

- [ ] **Step 1: Write the failing test**

Add to `src/main/agent/tests/plexus-mcp-server.test.ts` a unit-level test of the tagging seam. Since driving a real MCP round-trip is heavy, test the smallest observable contract: an emitted event is wrapped with the session captured for that tool call. Expose a tiny test seam by making `ask`/`requestApproval` accept the sessionId (they already mint the id); assert the sink receives a `TaggedAgentEvent`:

```ts
test('requestRefresh tags its emitted event with the calling session', async () => {
    const server = new PlexusMcpServer()
    const tagged: TaggedAgentEvent[] = []
    server.setSink((t) => tagged.push(t))
    // resolve immediately so the promise settles
    const p = server.requestRefresh('sess-77', '/proj')
    expect(tagged).toHaveLength(1)
    expect(tagged[0].SessionId).toBe('sess-77')
    expect(tagged[0].Event.Kind).toBe(AgentEventKind.RefreshProject)
    const reqId = (tagged[0].Event as { Request: { id: string } }).Request.id
    server.resolveRefresh({ id: reqId, projects: [] })
    await p
})
```

Add the imports `TaggedAgentEvent` and (if absent) `AgentEventKind` to the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/agent/tests/plexus-mcp-server.test.ts`
Expected: FAIL — `requestRefresh` takes no session arg; sink shape is `AgentEvent`, not tagged.

- [ ] **Step 3: Implement**

In `plexus-mcp-server.ts`:

- Change the sink field + setter to tagged:

```ts
private sink: ((tagged: TaggedAgentEvent) => void) | undefined
public setSink(sink: (tagged: TaggedAgentEvent) => void): void { this.sink = sink }
```

- Add a small helper and thread `sessionId` through each request path. Give each `request*` / `ask` a `sessionId` parameter (default `''` for headless/probe), and wherever they call `sink({ Kind: … })`, wrap it:

```ts
private emit(sessionId: string, event: AgentEvent): void { this.sink?.({ SessionId: sessionId, Event: event }) }
```

For example `requestRefresh` becomes:

```ts
public requestRefresh(sessionId: string, path?: string): Promise<RefreshProjectResult>
{
    const id = `r${(this.seq += 1)}`
    if (this.sink === undefined)
        return Promise.resolve({ id, projects: [], error: 'No Plexus window is available to refresh.' })
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            if (this.pendingRefresh.delete(id))
                resolve({ id, projects: [], error: 'Timed out waiting for the Plexus UI to refresh.' })
        }, this.timeoutMs)
        this.pendingRefresh.set(id, (result) => { clearTimeout(timer); resolve(result) })
        this.emit(sessionId, { Kind: AgentEventKind.RefreshProject, Request: { id, path } })
    })
}
```

Apply the same `sessionId`-first change to `ask(sessionId, questions)`, `requestApproval(sessionId, toolName, input)`, `requestCreateProject(sessionId, prefill?)`, and `requestProblems(sessionId, path?, severity?)`, replacing each `sink({...})` with `this.emit(sessionId, {...})` and each remaining `const sink = this.sink; if (sink === undefined)` guard with a `this.sink === undefined` guard.

- Thread the session from the transport into the tool handlers. `buildServer` gains the id and its handlers pass it down:

```ts
private buildServer(sessionId: string): McpServer
{
    const server = new McpServer({ name: MCP_SERVER_KEY, version: '0.1.0' })
    server.registerTool(ASK_TOOL_NAME, /* schema unchanged */, async ({ questions }) => {
        const answers = await this.ask(sessionId, questions as Question[])
        return { content: [{ type: 'text' as const, text: JSON.stringify(answers) }] }
    })
    // …refresh → this.requestRefresh(sessionId, path)
    // …create → this.requestCreateProject(sessionId, {...})
    // …get_problems → this.requestProblems(sessionId, path, severity)
    // …approve_tool → this.requestApproval(sessionId, toolName, input)
    return server
}
```

- Capture `?session=` at initialize in `handle`:

```ts
const url = new URL(req.url ?? '/', 'http://localhost')
const plexusSession = url.searchParams.get('session') ?? ''
// …
if (transport === undefined && req.method === 'POST' && isInitializeRequest(body))
{
    const created = new StreamableHTTPServerTransport({ /* unchanged */ })
    created.onclose = () => { /* unchanged */ }
    await this.buildServer(plexusSession).connect(created)
    transport = created
}
```

Add `TaggedAgentEvent` to the imports from `../../shared/agent-api.js`.

> The existing tests in this file that call `requestRefresh(path)` / `resolveApproval` etc. must be updated to pass a session id (`requestRefresh('', '/p')`) — do that as part of Step 3.

- [ ] **Step 4: Run the whole file's tests**

Run: `npx vitest run src/main/agent/tests/plexus-mcp-server.test.ts`
Expected: PASS (new tagging test + updated existing cases).

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/plexus-mcp-server.ts src/main/agent/tests/plexus-mcp-server.test.ts
git commit -m "feat(agent): attribute MCP tool events to their calling session"
```

---

### Task 6: Wire main `agent.ts` + preload to the manager and tagged stream

Replace the single `AgentSession` with an `AgentSessionManager`, make `emitToRenderer` push `TaggedAgentEvent`s, add the `sessionId` args to the Start/Send/Abort handlers + a `CloseSession` + `IsResumable` handler, and update the preload bridge to match `IAgentApi`.

**Files:**
- Modify: `src/main/agent.ts`
- Modify: `src/preload/index.ts`
- Test: (covered by the existing suite compiling + the e2e in Task 12; no new unit test — this is wiring)

**Interfaces:**
- Consumes: `AgentSessionManager` (Task 4), tagged `PlexusMcpServer.setSink` (Task 5), the `IAgentApi`/`AgentChannel`/`TaggedAgentEvent` contract (Task 3).

- [ ] **Step 1: Update main `agent.ts`**

- Change the emit sink to tagged:

```ts
function emitToRenderer(tagged: TaggedAgentEvent): void
{
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    win?.webContents.send(AgentChannel.Event, tagged)
}
```

- `mcpServer.setSink(emitToRenderer)` now type-checks (tagged).
- Replace `const session = new AgentSession(providers, emitToRenderer)` with:

```ts
const manager = new AgentSessionManager(providers, emitToRenderer)
```

- Rewrite the handlers (session-addressed):

```ts
ipcMain.handle(AgentChannel.StartSession,
    (_e, sessionId: string, workingDirectory: string, addDirs: readonly string[], resumeToken?: string): void => {
        mcpServer.setRuleStore(store, workingDirectory)
        manager.create(sessionId).start(workingDirectory, addDirs, resumeToken)
    })
ipcMain.handle(AgentChannel.SendTurn,
    (_e, sessionId: string, workingDirectory: string, addDirs: readonly string[], text: string): void => {
        mcpServer.setRuleStore(store, workingDirectory)
        manager.create(sessionId).send(workingDirectory, addDirs, text)
    })
ipcMain.handle(AgentChannel.Abort, (_e, sessionId: string): void => { manager.get(sessionId)?.abort() })
ipcMain.handle(AgentChannel.CloseSession, (_e, sessionId: string): void => { manager.close(sessionId) })
ipcMain.handle(AgentChannel.IsResumable, (): boolean => providers.active().Resumable)
```

Leave the `AnswerQuestion` / `RefreshProjectResult` / `CreateProjectResult` / `GetProblemsResult` / `AnswerToolApproval` / `ListApprovalRules` / `RevokeApprovalRule` handlers exactly as they are (resolved by request id). Update imports: drop `AgentSession`, add `AgentSessionManager` and `type TaggedAgentEvent`.

> **Known v1 limitation (note in the code comment):** `mcpServer.setRuleStore(store, workingDirectory)` is process-global, so approval-rule scope tracks the most recent start/turn's cwd. All conversations share the same workspace dirs today (§6.2 of the spec), so this is correct in practice; revisit if per-session cwds diverge.

- [ ] **Step 2: Update the preload bridge**

In `src/preload/index.ts`, replace the `agent` object's addressed methods + `onEvent` and add the two new ones:

```ts
const agent: IAgentApi = {
  startSession: (sessionId, workingDirectory, addDirs, resumeToken?) =>
    ipcRenderer.invoke(AgentChannel.StartSession, sessionId, workingDirectory, addDirs, resumeToken),
  closeSession: (sessionId) => ipcRenderer.invoke(AgentChannel.CloseSession, sessionId),
  sendTurn: (sessionId, workingDirectory, addDirs, text) =>
    ipcRenderer.invoke(AgentChannel.SendTurn, sessionId, workingDirectory, addDirs, text),
  abort: (sessionId) => ipcRenderer.invoke(AgentChannel.Abort, sessionId),
  isResumable: () => ipcRenderer.invoke(AgentChannel.IsResumable),
  // …answerQuestion / refreshProjectResult / createProjectResult / getProblemsResult /
  //   answerToolApproval / listApprovalRules / revokeApprovalRule — UNCHANGED…
  onEvent: (handler: (msg: TaggedAgentEvent) => void): (() => void) => {
    const listener = (_e: unknown, msg: TaggedAgentEvent): void => handler(msg)
    ipcRenderer.on(AgentChannel.Event, listener)
    return () => { ipcRenderer.removeListener(AgentChannel.Event, listener) }
  },
}
```

Update the import to add `type TaggedAgentEvent` from `../shared/agent-api.js`.

- [ ] **Step 3: Type-check main + preload**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors in `main/`, `preload/`, `shared/`. (Renderer `agent-service.ts` still references the old `IAgentApi` shape — that's replaced in Tasks 7/9/11; if the renderer is in this same tsconfig and errors, it is expected and cleared by Task 11. If it blocks, proceed — those files are rewritten shortly.)

- [ ] **Step 4: Run the main-process agent suite**

Run: `npx vitest run src/main/agent`
Expected: PASS (all main agent tests green).

- [ ] **Step 5: Commit**

```bash
git add src/main/agent.ts src/preload/index.ts
git commit -m "feat(agent): wire main + preload to AgentSessionManager and tagged event stream"
```

---

### Task 7: `ChatSession` — the per-conversation VM (extracted from `AgentService`)

A provider-free `MuralBase` dock panel holding one conversation's transcript + input, driven by injected callbacks (so it's decoupled from the bridge and unit-testable). This is the renderer half of a `sessionId`.

**Files:**
- Create: `src/renderer/src/modules/agent-chat/services/chat-session.ts`
- Test: `src/renderer/src/modules/agent-chat/services/tests/chat-session.test.ts`

**Interfaces:**
- Consumes: `TranscriptReducer` (`transcript.js`), `ApprovalRulesVM` (`approval-rules.js`), `AgentEvent`/`QuestionAnswer`/`ToolApprovalAnswer`/`CreateProjectRequest` (`shared/agent-api.js`).
- Produces:
  - `interface ChatSessionCallbacks { send(sessionId, text); answerQuestion(sessionId, answer); answerToolApproval(sessionId, answer); createProject(sessionId, req, reducer); }`
  - `class ChatSession extends MuralBase implements IDockPanel` with DPs `Id`, `Title`, `Transcript`, `Draft`, `Status`, `CanInput`, `SendCommand`, `SubmitCommand`, `Approvals`; ctor `(sessionId, title, callbacks, approvals?)`; methods `apply(event: AgentEvent): void`, `setStatus(text: string): void`, `get Reducer(): TranscriptReducer`.

- [ ] **Step 1: Write the failing test**

`src/renderer/src/modules/agent-chat/services/tests/chat-session.test.ts`:

```ts
import { test, expect } from 'vitest'
import { Key } from '@pragmatic-tech-ai/mural/runtime'
import { AgentEventKind, type AgentEvent, type QuestionAnswer, type ToolApprovalAnswer, type CreateProjectRequest } from '../../../../../../shared/agent-api.js'
import { ChatSession, type ChatSessionCallbacks } from '../chat-session.js'
import { TranscriptReducer } from '../transcript.js'

function fakeCallbacks() {
    const calls = { sent: [] as Array<{ id: string; text: string }>, created: [] as string[] }
    const cb: ChatSessionCallbacks = {
        send: (id, text) => calls.sent.push({ id, text }),
        answerQuestion: () => {},
        answerToolApproval: () => {},
        createProject: (id) => calls.created.push(id),
    }
    return { cb, calls }
}

test('the panel identity is the session id + title', () => {
    const { cb } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    expect(s.Id).toBe('sess-1')
    expect(s.Title).toBe('Chat 1')
})

test('send forwards the trimmed draft to the callback and clears it', () => {
    const { cb, calls } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.Draft = '  hello  '
    s.SendCommand.Execute(undefined)
    expect(calls.sent).toEqual([{ id: 'sess-1', text: 'hello' }])
    expect(s.Draft).toBe('')
})

test('applying an assistant-text event grows the transcript', () => {
    const { cb } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.apply({ Kind: AgentEventKind.AssistantText, Text: 'hi' })
    expect(s.Transcript.ToArray()).toHaveLength(1)
})

test('a pending question gates input; send is a no-op while gated', () => {
    const { cb, calls } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.apply({ Kind: AgentEventKind.Question, Request: { id: 'q1', questions: [{ question: 'x?', header: 'h', multiSelect: false, options: [{ label: 'a' }] }] } })
    expect(s.CanInput).toBe(false)
    s.Draft = 'nope'
    s.SendCommand.Execute(undefined)
    expect(calls.sent).toHaveLength(0)
})

test('a create-project event is delegated to the callback with the reducer', () => {
    const { cb, calls } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.apply({ Kind: AgentEventKind.CreateProject, Request: { id: 'c1' } } as AgentEvent)
    expect(calls.created).toEqual(['sess-1'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/agent-chat/services/tests/chat-session.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/renderer/src/modules/agent-chat/services/chat-session.ts` — mirror the DP shape of today's `AgentService`, but as a `MuralBase` fed by callbacks:

```ts
import {
    Key, MetaData, MuralBase, ObservableCollection, RelayCommand,
    type ICommand,
} from '@pragmatic-tech-ai/mural/runtime'
import type { IDockPanel } from '@pragmatic-tech-ai/mural/framework'
import {
    AgentEventKind,
    type AgentEvent, type CreateProjectRequest, type QuestionAnswer, type ToolApprovalAnswer,
} from '../../../../../shared/agent-api.js'
import { TranscriptReducer } from './transcript.js'
import type { ApprovalRulesVM } from './approval-rules.js'

// The per-conversation actions ChatSession needs, injected by ChatSessionsService
// so the VM stays free of the window bridge + the environment services.
export interface ChatSessionCallbacks
{
    send(sessionId: string, text: string): void
    answerQuestion(sessionId: string, answer: QuestionAnswer): void
    answerToolApproval(sessionId: string, answer: ToolApprovalAnswer): void
    createProject(sessionId: string, req: CreateProjectRequest, reducer: TranscriptReducer): void
}

export class ChatSession extends MuralBase implements IDockPanel
{
    public static readonly IdKey = MuralBase.RegisterProperty<string>(ChatSession, 'Id', '', MetaData.None)
    public static readonly TitleKey = MuralBase.RegisterProperty<string>(ChatSession, 'Title', 'Chat', MetaData.None)
    public static readonly TranscriptKey = MuralBase.RegisterProperty<ObservableCollection<MuralBase>>(
        ChatSession, 'Transcript', undefined as unknown as ObservableCollection<MuralBase>, MetaData.None)
    public static readonly DraftKey = MuralBase.RegisterProperty<string>(ChatSession, 'Draft', '', MetaData.None)
    public static readonly StatusKey = MuralBase.RegisterProperty<string>(ChatSession, 'Status', 'idle', MetaData.None)
    public static readonly CanInputKey = MuralBase.RegisterProperty<boolean>(ChatSession, 'CanInput', true, MetaData.None)
    public static readonly SendCommandKey = MuralBase.RegisterProperty<ICommand>(
        ChatSession, 'SendCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly SubmitCommandKey = MuralBase.RegisterProperty<ICommand>(
        ChatSession, 'SubmitCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly ApprovalsKey = MuralBase.RegisterProperty<ApprovalRulesVM>(
        ChatSession, 'Approvals', undefined as unknown as ApprovalRulesVM, MetaData.None)

    private readonly reducer = new TranscriptReducer()
    private readonly sessionId: string

    constructor(sessionId: string, title: string, callbacks: ChatSessionCallbacks, approvals?: ApprovalRulesVM)
    {
        super()
        this.sessionId = sessionId
        this.set_property_value(ChatSession.IdKey, sessionId)
        this.set_property_value(ChatSession.TitleKey, title)
        this.set_property_value(ChatSession.TranscriptKey, this.reducer.Transcript)
        if (approvals !== undefined) this.set_property_value(ChatSession.ApprovalsKey, approvals)

        this.set_property_value(ChatSession.SendCommandKey, new RelayCommand(() => this.send()))
        this.set_property_value(ChatSession.SubmitCommandKey, new RelayCommand((arg) => {
            if ((arg as { Key?: unknown } | undefined)?.Key === Key.Return) this.send()
        }))

        this.reducer.onAnswerSubmitted = (answer) => callbacks.answerQuestion(this.sessionId, answer)
        this.reducer.onToolApprovalSubmitted = (answer) => callbacks.answerToolApproval(this.sessionId, answer)
        this.reducer.onPendingChange = () =>
            this.set_property_value(ChatSession.CanInputKey, !this.reducer.HasPendingQuestion)

        this.callbacks = callbacks
    }

    private readonly callbacks: ChatSessionCallbacks

    public get Id(): string { return this.get_property_value(ChatSession.IdKey) }
    public get Title(): string { return this.get_property_value(ChatSession.TitleKey) }
    public get Transcript(): ObservableCollection<MuralBase> { return this.get_property_value(ChatSession.TranscriptKey) }
    public get Draft(): string { return this.get_property_value(ChatSession.DraftKey) }
    public set Draft(value: string) { this.set_property_value(ChatSession.DraftKey, value) }
    public get Status(): string { return this.get_property_value(ChatSession.StatusKey) }
    public get CanInput(): boolean { return this.get_property_value(ChatSession.CanInputKey) }
    public get SendCommand(): ICommand { return this.get_property_value(ChatSession.SendCommandKey) }
    public get SubmitCommand(): ICommand { return this.get_property_value(ChatSession.SubmitCommandKey) }
    public get Approvals(): ApprovalRulesVM { return this.get_property_value(ChatSession.ApprovalsKey) }
    public get Reducer(): TranscriptReducer { return this.reducer }

    public setStatus(text: string): void { this.set_property_value(ChatSession.StatusKey, text) }

    // Fold one already-routed agent event into this conversation. create_project is
    // delegated (its form needs the environment); everything else goes to the reducer.
    public apply(event: AgentEvent): void
    {
        if (event.Kind === AgentEventKind.CreateProject) { this.callbacks.createProject(this.sessionId, event.Request, this.reducer); return }
        this.reducer.apply(event)
    }

    private send(): void
    {
        const text = this.Draft.trim()
        if (text === '') return
        if (!this.CanInput) return
        this.reducer.beginUserTurn(text)
        this.callbacks.send(this.sessionId, text)
        this.set_property_value(ChatSession.DraftKey, '')
    }
}

export default ChatSession
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/agent-chat/services/tests/chat-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/agent-chat/services/chat-session.ts src/renderer/src/modules/agent-chat/services/tests/chat-session.test.ts
git commit -m "feat(chat): ChatSession per-conversation VM extracted from AgentService"
```

---

### Task 8: `ChatStore` — provider-gated persistence

Persist restorable conversations to `userData/conversations.json` (mirroring `OpenProjectsStore`), plus a tiny transcript (de)serializer so a stored conversation can be shown again.

**Files:**
- Create: `src/renderer/src/modules/agent-chat/services/chat-store.ts`
- Create: `src/renderer/src/modules/agent-chat/services/transcript-serializer.ts`
- Test: `src/renderer/src/modules/agent-chat/services/tests/chat-store.test.ts`
- Test: `src/renderer/src/modules/agent-chat/services/tests/transcript-serializer.test.ts`

**Interfaces:**
- Consumes: `FileSystemService`, `EnvironmentService`, `TranscriptRole`/`UserMessage`/`AssistantMessage`/`ToolActivity` (`transcript.js`).
- Produces:
  - `interface SerializedMessage { Role: TranscriptRole; Text: string }`
  - `serializeTranscript(items: readonly MuralBase[]): SerializedMessage[]`; `rehydrateTranscript(records: readonly SerializedMessage[]): MuralBase[]`
  - `interface StoredConversation { Id: string; Title: string; Transcript: SerializedMessage[]; ResumeToken: string }`
  - `class ChatStore extends ServiceBase { static Key; List(): Promise<readonly StoredConversation[]>; Upsert(rec: StoredConversation): Promise<void>; Remove(id: string): Promise<void> }`

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/modules/agent-chat/services/tests/transcript-serializer.test.ts`:

```ts
import { test, expect } from 'vitest'
import { serializeTranscript, rehydrateTranscript } from '../transcript-serializer.js'
import { UserMessage, AssistantMessage, ToolActivity, TranscriptRole } from '../transcript.js'

test('user + assistant + tool items serialize to role-tagged text', () => {
    const assistant = new AssistantMessage(); assistant.appendText('hi there')
    const items = [new UserMessage('hello'), assistant, new ToolActivity('t1', 'Bash', { command: 'ls' })]
    const recs = serializeTranscript(items)
    expect(recs).toEqual([
        { Role: TranscriptRole.User, Text: 'hello' },
        { Role: TranscriptRole.Assistant, Text: 'hi there' },
        { Role: TranscriptRole.Tool, Text: 'Bash' },
    ])
})

test('rehydrate rebuilds display items of the right kinds', () => {
    const items = rehydrateTranscript([
        { Role: TranscriptRole.User, Text: 'hello' },
        { Role: TranscriptRole.Assistant, Text: 'world' },
    ])
    expect(items[0]).toBeInstanceOf(UserMessage)
    expect(items[1]).toBeInstanceOf(AssistantMessage)
    expect((items[1] as AssistantMessage).Text).toBe('world')
})
```

`src/renderer/src/modules/agent-chat/services/tests/chat-store.test.ts`:

```ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ChatStore, type StoredConversation } from '../chat-store.js'
import { FileSystemService } from '../../../../services/file-system/file-system-service.js'
import { EnvironmentService } from '../../../../services/environment/environment-service.js'
import { TranscriptRole } from '../transcript.js'

function fakeFs() {
    const files = new Map<string, string>()
    return {
        Exists: (p: string) => Promise.resolve(files.has(p)),
        ReadText: (p: string) => Promise.resolve(files.get(p) ?? ''),
        WriteText: (p: string, c: string) => { files.set(p, c); return Promise.resolve() },
    }
}

function providerWith(fs: unknown): ServiceProvider {
    const provider = new ServiceProvider()
    provider.registerInstance(FileSystemService.Key, fs as FileSystemService)
    provider.registerInstance(EnvironmentService.Key, { UserDataDirectory: '/data' } as EnvironmentService)
    return provider
}

const rec: StoredConversation = { Id: 's1', Title: 'Chat 1', ResumeToken: 'cli-1', Transcript: [{ Role: TranscriptRole.User, Text: 'hi' }] }

test('upsert then list round-trips a record', async () => {
    const store = new ChatStore(providerWith(fakeFs()))
    await store.Upsert(rec)
    expect(await store.List()).toEqual([rec])
})

test('upsert replaces a record with the same id', async () => {
    const store = new ChatStore(providerWith(fakeFs()))
    await store.Upsert(rec)
    await store.Upsert({ ...rec, Title: 'Renamed' })
    const list = await store.List()
    expect(list).toHaveLength(1)
    expect(list[0].Title).toBe('Renamed')
})

test('remove drops a record', async () => {
    const store = new ChatStore(providerWith(fakeFs()))
    await store.Upsert(rec)
    await store.Remove('s1')
    expect(await store.List()).toEqual([])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/modules/agent-chat/services/tests/transcript-serializer.test.ts src/renderer/src/modules/agent-chat/services/tests/chat-store.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/renderer/src/modules/agent-chat/services/transcript-serializer.ts`:

```ts
import type { MuralBase } from '@pragmatic-tech-ai/mural/runtime'
import { UserMessage, AssistantMessage, ToolActivity, TranscriptRole } from './transcript.js'

// A stored transcript entry — the minimal text-bearing shape needed to re-display
// a conversation. Tool cards / question cards are not fully round-tripped in v1;
// a tool activity is stored as its name so history reads sensibly.
export interface SerializedMessage { Role: TranscriptRole; Text: string }

export function serializeTranscript(items: readonly MuralBase[]): SerializedMessage[]
{
    const out: SerializedMessage[] = []
    for (const item of items)
    {
        if (item instanceof UserMessage) out.push({ Role: TranscriptRole.User, Text: item.Text })
        else if (item instanceof AssistantMessage) out.push({ Role: TranscriptRole.Assistant, Text: item.Text })
        else if (item instanceof ToolActivity) out.push({ Role: TranscriptRole.Tool, Text: item.Name })
    }
    return out
}

export function rehydrateTranscript(records: readonly SerializedMessage[]): MuralBase[]
{
    const out: MuralBase[] = []
    for (const rec of records)
    {
        if (rec.Role === TranscriptRole.User) out.push(new UserMessage(rec.Text))
        else if (rec.Role === TranscriptRole.Assistant) { const a = new AssistantMessage(); a.appendText(rec.Text); out.push(a) }
        else out.push(new ToolActivity(`restored-${out.length}`, rec.Text, {}))
    }
    return out
}
```

`src/renderer/src/modules/agent-chat/services/chat-store.ts` — copy the `OpenProjectsStore` file-IO shape (same private `join`, same lazy mirror), storing an array of `StoredConversation`:

```ts
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { EnvironmentService } from '../../../services/environment/environment-service.js'
import { FileSystemService } from '../../../services/file-system/file-system-service.js'
import type { SerializedMessage } from './transcript-serializer.js'

export interface StoredConversation
{
    Id: string
    Title: string
    Transcript: SerializedMessage[]
    ResumeToken: string
}

export class ChatStore extends ServiceBase
{
    public static readonly Key = new ServiceKey<ChatStore>('ChatStore')
    private static readonly FileName = 'conversations.json'
    private records: StoredConversation[] | null = null

    constructor(provider: IServiceProvider) { super(provider) }

    private get fs(): FileSystemService { return this.Provider.getRequired(FileSystemService.Key) }
    private get env(): EnvironmentService { return this.Provider.getRequired(EnvironmentService.Key) }
    private get filePath(): string { return join(this.env.UserDataDirectory, ChatStore.FileName) }

    public async List(): Promise<readonly StoredConversation[]>
    {
        if (this.records !== null) return this.records
        try {
            if (!(await this.fs.Exists(this.filePath))) { this.records = []; return this.records }
            const parsed = JSON.parse(await this.fs.ReadText(this.filePath))
            this.records = Array.isArray(parsed) ? (parsed as StoredConversation[]) : []
        } catch { this.records = [] }
        return this.records
    }

    public async Upsert(rec: StoredConversation): Promise<void>
    {
        const list = [...await this.List()]
        const i = list.findIndex((r) => r.Id === rec.Id)
        if (i >= 0) list[i] = rec; else list.push(rec)
        this.records = list
        await this.fs.WriteText(this.filePath, JSON.stringify(list, null, 2))
    }

    public async Remove(id: string): Promise<void>
    {
        const list = (await this.List()).filter((r) => r.Id !== id)
        this.records = list
        await this.fs.WriteText(this.filePath, JSON.stringify(list, null, 2))
    }
}

// Join with the directory's own separator (no node:path in the renderer). Copied
// from OpenProjectsStore.
function join(dir: string, name: string): string
{
    const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
    return dir.endsWith(sep) ? dir + name : dir + sep + name
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/modules/agent-chat/services/tests/transcript-serializer.test.ts src/renderer/src/modules/agent-chat/services/tests/chat-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/agent-chat/services/chat-store.ts src/renderer/src/modules/agent-chat/services/transcript-serializer.ts src/renderer/src/modules/agent-chat/services/tests/chat-store.test.ts src/renderer/src/modules/agent-chat/services/tests/transcript-serializer.test.ts
git commit -m "feat(chat): ChatStore + transcript serializer for conversation persistence"
```

---

### Task 9: `ChatSessionsService` — the renderer manager

The root service that owns the single bridge listener, mints/opens/closes conversations as dock tabs, routes tagged events by `sessionId`, and persists resumable ones through `ChatStore`. This is where the old `AgentService`'s shared concerns (dirs, approvals VM, create-project) now live.

**Files:**
- Create: `src/renderer/src/modules/agent-chat/services/chat-sessions-service.ts`
- Test: `src/renderer/src/modules/agent-chat/services/tests/chat-sessions-service.test.ts`

**Interfaces:**
- Consumes: `IAgentApi`/`TaggedAgentEvent` (bridge), `ChatSession`/`ChatSessionCallbacks` (Task 7), `ChatStore`/`serializeTranscript`/`rehydrateTranscript` (Task 8), `OpenProjectsStore`, `EnvironmentService`, `ProjectExplorerService`, `PanelDockService`, `ApprovalRulesVM`/`ApprovalRulesPort`, `NewProjectCard`.
- Produces: `class ChatSessionsService extends ServiceBase { static Key; Open: ObservableCollection<ChatSession>; Stored: ObservableCollection<StoredConversation>; ActiveChat: ChatSession | undefined; NewConversationCommand: ICommand; NewConversation(): ChatSession; OpenStored(id: string): Promise<ChatSession | undefined>; Close(chat: ChatSession): void; Reveal(sessionId: string): Promise<void>; RestoreSession(): Promise<void> }`.

- [ ] **Step 1: Write the failing test**

`src/renderer/src/modules/agent-chat/services/tests/chat-sessions-service.test.ts` — reuse the `fakeAgent`/`fakeStore`/`providerWith` shapes from the existing `agent-service.test.ts`, extended for the tagged bridge + a fake dock + fake ChatStore:

```ts
import { test, expect, beforeEach, afterEach } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { PanelDockService } from '@pragmatic-tech-ai/mural/framework'
import { AgentEventKind, type IAgentApi, type TaggedAgentEvent } from '../../../../../../shared/agent-api.js'
import { EnvironmentService } from '../../../../services/environment/environment-service.js'
import { OpenProjectsStore } from '../../../../services/projects/open-projects-store.js'
import { ChatStore } from '../chat-store.js'
import { ChatSessionsService } from '../chat-sessions-service.js'

function fakeAgent() {
    const turns: Array<{ sessionId: string; text: string }> = []
    const started: string[] = []
    let push: ((m: TaggedAgentEvent) => void) | undefined
    const api: IAgentApi = {
        startSession: (id) => { started.push(id); return Promise.resolve() },
        closeSession: () => Promise.resolve(),
        sendTurn: (id, _c, _d, text) => { turns.push({ sessionId: id, text }); return Promise.resolve() },
        abort: () => Promise.resolve(),
        isResumable: () => Promise.resolve(true),
        answerQuestion: () => Promise.resolve(),
        refreshProjectResult: () => Promise.resolve(),
        createProjectResult: () => Promise.resolve(),
        getProblemsResult: () => Promise.resolve(),
        answerToolApproval: () => Promise.resolve(),
        listApprovalRules: () => Promise.resolve([]),
        revokeApprovalRule: () => Promise.resolve(),
        onEvent: (h) => { push = h; return () => {} },
    }
    return { api, turns, started, emit: (m: TaggedAgentEvent) => push?.(m) }
}

function fakeStore(initial: string[] = []) {
    let folders = [...initial]
    const listeners = new Set<(f: readonly string[]) => void>()
    return {
        Current: () => folders, List: () => Promise.resolve(folders),
        Subscribe: (l: (f: readonly string[]) => void) => { listeners.add(l); return () => listeners.delete(l) },
        push: (n: string[]) => { folders = n; for (const l of listeners) l(folders) },
    }
}

let bridge: ReturnType<typeof fakeAgent>
beforeEach(() => { bridge = fakeAgent(); (globalThis as unknown as { api: unknown }).api = { agent: bridge.api } })
afterEach(() => { delete (globalThis as unknown as { api?: unknown }).api })

function makeService(store = fakeStore(['/A'])) {
    const provider = new ServiceProvider()
    provider.registerInstance(OpenProjectsStore.Key, store as unknown as OpenProjectsStore)
    provider.registerInstance(EnvironmentService.Key, { CurrentDirectory: '/fallback' } as EnvironmentService)
    provider.registerInstance(PanelDockService.Key, new PanelDockService(provider))
    // A fake ChatStore capturing upserts.
    const upserts: string[] = []
    provider.registerInstance(ChatStore.Key, {
        List: () => Promise.resolve([]),
        Upsert: (r: { Id: string }) => { upserts.push(r.Id); return Promise.resolve() },
        Remove: () => Promise.resolve(),
    } as unknown as ChatStore)
    const svc = new ChatSessionsService(provider)
    return { svc, provider, upserts, dock: provider.getRequired(PanelDockService.Key) }
}

test('NewConversation starts a session and adds a dock tab', () => {
    const { svc, dock } = makeService()
    const chat = svc.NewConversation()
    expect(bridge.started).toContain(chat.Id)
    expect(dock.Panels.ToArray()).toContain(chat)
    expect(svc.Open.ToArray()).toContain(chat)
})

test('events route to the matching session only', () => {
    const { svc } = makeService()
    const a = svc.NewConversation()
    const b = svc.NewConversation()
    bridge.emit({ SessionId: a.Id, Event: { Kind: AgentEventKind.AssistantText, Text: 'for A' } })
    expect(a.Transcript.ToArray()).toHaveLength(1)
    expect(b.Transcript.ToArray()).toHaveLength(0)
})

test('a turn addresses the session and the shared workspace cwd', () => {
    const { svc } = makeService(fakeStore(['/A', '/B']))
    const chat = svc.NewConversation()
    chat.Draft = 'hi'
    chat.SendCommand.Execute(undefined)
    expect(bridge.turns).toEqual([{ sessionId: chat.Id, text: 'hi' }])
})

test('a resumable SessionStarted upserts the conversation into the store', async () => {
    const { svc, upserts } = makeService()
    const chat = svc.NewConversation()
    await Promise.resolve()   // let the isResumable() probe settle
    bridge.emit({ SessionId: chat.Id, Event: { Kind: AgentEventKind.SessionStarted, SessionId: 'cli-1' } })
    await Promise.resolve()
    expect(upserts).toContain(chat.Id)
})

test('Close removes the tab and closes the backend session', () => {
    const { svc, dock } = makeService()
    const chat = svc.NewConversation()
    svc.Close(chat)
    expect(dock.Panels.ToArray()).not.toContain(chat)
    expect(svc.Open.ToArray()).not.toContain(chat)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/agent-chat/services/tests/chat-sessions-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/renderer/src/modules/agent-chat/services/chat-sessions-service.ts`. Key logic: resolve the bridge from `globalThis.api.agent`; build one shared `ApprovalRulesVM` keyed to `currentCwd()`; track dirs from `OpenProjectsStore`; register ONE `onEvent` router; own the `ChatSessionCallbacks`. Mint ids with `crypto.randomUUID()`.

```ts
import {
    MuralBase, ObservableCollection, RelayCommand, ServiceBase, ServiceKey,
    type ICommand, type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'
import { PanelDockService } from '@pragmatic-tech-ai/mural/framework'
import { AgentEventKind, type CreateProjectRequest, type IAgentApi } from '../../../../../shared/agent-api.js'
import { EnvironmentService } from '../../../services/environment/environment-service.js'
import { OpenProjectsStore } from '../../../services/projects/open-projects-store.js'
import { ProjectExplorerService } from '../../project-explorer/services/project-explorer-service.js'
import type { NewProjectResult } from '../../../services/projects/new-project-dialog-model.js'
import { NewProjectCard } from './new-project-card.js'
import { ApprovalRulesVM, type ApprovalRulesPort } from './approval-rules.js'
import { ChatSession, type ChatSessionCallbacks } from './chat-session.js'
import type { TranscriptReducer } from './transcript.js'
import { ChatStore, type StoredConversation } from './chat-store.js'
import { serializeTranscript, rehydrateTranscript } from './transcript-serializer.js'

export class ChatSessionsService extends ServiceBase
{
    public static readonly Key = new ServiceKey<ChatSessionsService>('ChatSessionsService')

    public static readonly OpenKey = MuralBase.RegisterProperty<ObservableCollection<ChatSession>>(
        ChatSessionsService, 'Open', undefined as unknown as ObservableCollection<ChatSession>, MetaData.None)
    public static readonly StoredKey = MuralBase.RegisterProperty<ObservableCollection<StoredConversation>>(
        ChatSessionsService, 'Stored', undefined as unknown as ObservableCollection<StoredConversation>, MetaData.None)
    public static readonly ActiveChatKey = MuralBase.RegisterProperty<ChatSession | undefined>(
        ChatSessionsService, 'ActiveChat', undefined, MetaData.None)
    public static readonly NewConversationCommandKey = MuralBase.RegisterProperty<ICommand>(
        ChatSessionsService, 'NewConversationCommand', undefined as unknown as ICommand, MetaData.None)

    private readonly agent: IAgentApi
    private readonly store: OpenProjectsStore
    private readonly fallbackCwd: string
    private readonly approvals: ApprovalRulesVM
    private workingDirs: readonly string[] = []
    private resumable = false

    constructor(provider: IServiceProvider)
    {
        super(provider)
        const bridge = (globalThis as unknown as { api?: { agent?: IAgentApi } }).api
        if (bridge?.agent === undefined)
            throw new Error('ChatSessionsService: window.api.agent is unavailable — requires the Plexus desktop host.')
        this.agent = bridge.agent
        this.store = provider.getRequired(OpenProjectsStore.Key)
        this.fallbackCwd = provider.get(EnvironmentService.Key)?.CurrentDirectory ?? ''

        this.set_property_value(ChatSessionsService.OpenKey, new ObservableCollection<ChatSession>())
        this.set_property_value(ChatSessionsService.StoredKey, new ObservableCollection<StoredConversation>())
        this.set_property_value(ChatSessionsService.NewConversationCommandKey, new RelayCommand(() => { this.NewConversation() }))

        const port: ApprovalRulesPort = {
            list: (key) => this.agent.listApprovalRules(key),
            revoke: (key, rule) => this.agent.revokeApprovalRule(key, rule),
        }
        this.approvals = new ApprovalRulesVM(port, () => this.currentCwd())

        // Track the shared workspace dirs (all conversations target the same set).
        this.applyDirs(this.store.Current())
        void this.store.List().then((dirs) => this.applyDirs(dirs))
        this.store.Subscribe((dirs) => this.applyDirs(dirs))

        // One router for the whole app: fan tagged events to the matching session.
        this.agent.onEvent((msg) => this.route(msg.SessionId, msg.Event))
        void this.agent.isResumable().then((r) => { this.resumable = r })
    }

    public get Open(): ObservableCollection<ChatSession> { return this.get_property_value(ChatSessionsService.OpenKey) }
    public get Stored(): ObservableCollection<StoredConversation> { return this.get_property_value(ChatSessionsService.StoredKey) }
    public get ActiveChat(): ChatSession | undefined { return this.get_property_value(ChatSessionsService.ActiveChatKey) }
    public get NewConversationCommand(): ICommand { return this.get_property_value(ChatSessionsService.NewConversationCommandKey) }

    private get dock(): PanelDockService { return this.Provider.getRequired(PanelDockService.Key) }
    private get chatStore(): ChatStore { return this.Provider.getRequired(ChatStore.Key) }

    private callbacks(): ChatSessionCallbacks
    {
        return {
            send: (id, text) => { void this.agent.sendTurn(id, this.currentCwd(), this.addDirs(), text) },
            answerQuestion: (_id, answer) => { void this.agent.answerQuestion(answer) },
            answerToolApproval: (_id, answer) => { void this.agent.answerToolApproval(answer) },
            createProject: (id, req, reducer) => { void this.handleCreateProject(id, req, reducer) },
        }
    }

    public NewConversation(): ChatSession
    {
        const sessionId = crypto.randomUUID()
        const title = `Chat ${this.Open.Count + 1}`
        const chat = new ChatSession(sessionId, title, this.callbacks(), this.approvals)
        this.Open.Add(chat)
        this.dock.Add(chat)
        this.dock.SelectedPanel = chat
        this.set_property_value(ChatSessionsService.ActiveChatKey, chat)
        void this.agent.startSession(sessionId, this.currentCwd(), this.addDirs())
        return chat
    }

    public async OpenStored(id: string): Promise<ChatSession | undefined>
    {
        const existing = this.Open.ToArray().find((c) => c.Id === id)
        if (existing !== undefined) { this.dock.SelectedPanel = existing; return existing }
        const rec = (await this.chatStore.List()).find((r) => r.Id === id)
        if (rec === undefined) return undefined
        const chat = new ChatSession(rec.Id, rec.Title, this.callbacks(), this.approvals)
        for (const item of rehydrateTranscript(rec.Transcript)) chat.Transcript.Add(item)
        this.Open.Add(chat)
        this.dock.Add(chat)
        this.dock.SelectedPanel = chat
        // Resume the backend context on the first new turn.
        void this.agent.startSession(rec.Id, this.currentCwd(), this.addDirs(), rec.ResumeToken)
        return chat
    }

    public Close(chat: ChatSession): void
    {
        this.dock.Remove(chat)
        this.Open.Remove(chat)
        void this.agent.closeSession(chat.Id)
    }

    public async Reveal(sessionId: string): Promise<void>
    {
        const open = this.Open.ToArray().find((c) => c.Id === sessionId)
        if (open !== undefined) { this.dock.SelectedPanel = open; return }
        await this.OpenStored(sessionId)
    }

    public async RestoreSession(): Promise<void>
    {
        for (const rec of await this.chatStore.List()) this.Stored.Add(rec)
    }

    private route(sessionId: string, event: import('../../../../../shared/agent-api.js').AgentEvent): void
    {
        const chat = this.Open.ToArray().find((c) => c.Id === sessionId)
        if (chat === undefined) return
        if (event.Kind === AgentEventKind.SessionStarted) void this.persist(chat, event.SessionId)
        chat.apply(event)
    }

    // Persist only when the provider can resume AND we have a token (per spec §6.4).
    private async persist(chat: ChatSession, resumeToken: string): Promise<void>
    {
        if (!this.resumable || resumeToken === '') return
        await this.chatStore.Upsert({
            Id: chat.Id, Title: chat.Title, ResumeToken: resumeToken,
            Transcript: serializeTranscript(chat.Transcript.ToArray()),
        })
    }

    private applyDirs(dirs: readonly string[]): void
    {
        this.workingDirs = [...dirs]
        const cwd = this.currentCwd()
        const extra = dirs.length > 1 ? ` (+${dirs.length - 1} more)` : ''
        for (const chat of this.Open.ToArray()) chat.setStatus(`Agent directory: ${cwd}${extra}`)
        void this.approvals.Refresh()
    }

    private currentCwd(): string { return this.workingDirs.length > 0 ? this.workingDirs[0] : this.fallbackCwd }
    private addDirs(): string[] { return this.workingDirs.length > 0 ? [...this.workingDirs.slice(1)] : [] }

    // Same flow as the old AgentService.handleCreateProject, but reducer + session
    // are supplied by the ChatSession that received the event.
    private async handleCreateProject(_sessionId: string, req: CreateProjectRequest, reducer: TranscriptReducer): Promise<void>
    {
        const explorer = this.Provider.getRequired(ProjectExplorerService.Key)
        const card = new NewProjectCard(req.id)
        const close = (result?: NewProjectResult): void => {
            if (result === undefined) {
                card.showCancelled()
                void this.agent.createProjectResult({ id: req.id, created: false, cancelled: true })
                reducer.releasePending(req.id)
                return
            }
            void (async () => {
                const outcome = await explorer.CreateProject(result)
                card.showResult(outcome)
                void this.agent.createProjectResult({ id: req.id, ...outcome })
                reducer.releasePending(req.id)
            })()
        }
        card.Form = await explorer.NewProjectFormFor(close, req.prefill)
        reducer.addPendingCard(req.id, card)
    }
}

export default ChatSessionsService
```

Add the missing `MetaData` import from `@pragmatic-tech-ai/mural/runtime`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/agent-chat/services/tests/chat-sessions-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/agent-chat/services/chat-sessions-service.ts src/renderer/src/modules/agent-chat/services/tests/chat-sessions-service.test.ts
git commit -m "feat(chat): ChatSessionsService — parallel conversations, event routing, persistence"
```

---

### Task 10: Conversations nav panel — icon, resources, Capability

Give the manager a left-rail Capability and a side-panel template listing New / Open (live) / Stored conversations. `.mu` markup — verified by `compile:mu` + build, not a unit test.

**Files:**
- Create: `src/renderer/src/icons/conversations.svg`
- Create: `src/renderer/src/modules/agent-chat/conversations.resources.mu`
- Modify: `src/renderer/src/modules/agent-chat/agent-chat.module.mu`
- Modify: `src/renderer/src/plexus-icons.mu`
- Modify: `src/renderer/src/app.mu`
- Modify: `package.json` (add the new `.mu` to the `compile:mu` file list)

**Interfaces:**
- Consumes: `ChatSessionsService` (Task 9) — `Open`, `Stored`, `NewConversationCommand`; `ChatSession.Title`; `StoredConversation.Title`.

- [ ] **Step 1: Add the icon**

Create `src/renderer/src/icons/conversations.svg` — a simple two-overlapping-speech-bubbles glyph on a 24×24 canvas (single `<path>`, no fill baked in), matching the style of the existing `agent.svg`. Example:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2zm14 5h2a2 2 0 0 1 2 2v9l-4-3h-6a2 2 0 0 1-2-2v-1h6a2 2 0 0 0 2-2V9z"/></svg>
```

Register it in `src/renderer/src/plexus-icons.mu`, in the agent group:

```
    include "icons/conversations.svg"            as Conversations
```

- [ ] **Step 2: Add the Capability**

In `src/renderer/src/modules/agent-chat/agent-chat.module.mu`, register `ChatSessionsService` and contribute a Capability (replace the old comment that said "no Capability"):

```
import ChatSessionsService from "./services/chat-sessions-service.js"
import ChatStore from "./services/chat-store.js"

module AgentChatModule [ Name = "Agent" ] {
    .services: {
        ChatSessionsService
        ChatStore
        TemplateGalleryService
    }
    Capability [ Name = "Conversations", Icon = @Conversations, ServiceKey = ChatSessionsService ]
}
```

(Keep the `TemplateGalleryService` import + registration; drop the `AgentService` import — its file is removed in Task 11.)

- [ ] **Step 3: Add the panel template**

Create `src/renderer/src/modules/agent-chat/conversations.resources.mu`:

```
import ChatSessionsService from "./services/chat-sessions-service.js"
import ChatSession from "./services/chat-session.js"

resources ConversationsResources {
    DataTemplate [ DataType = ChatSessionsService ] {
        DockPanel [ LastChildFill = true, Margin = (8,8,8,8) ] {
            // New conversation — pinned to the top.
            PanelButton [ DockPanel.Dock = Top, Command = $NewConversationCommand, HorizontalAlignment = Stretch, Margin = (0,0,0,8) ] {
                TextBlock [ Text = "＋ New conversation", Style = @LabelLarge, Foreground = @OnSurface, TextWrapping = Wrap ]
            }
            // Open (live) conversations, then the stored (restorable) ones.
            ScrollViewer [ HorizontalScrollEnabled = false ] {
                StackPanel [ Orientation = Vertical ] {
                    TextBlock [ Style = @LabelSmall, Text = "OPEN", Foreground = @OnSurfaceVariant, Margin = (0,0,0,4), TextWrapping = Wrap ]
                    ItemsControl [ ItemsSource = $Open, ItemsPanel = @VerticalStackPanel, ItemTemplate = @OpenConversationRow ]
                    TextBlock [ Style = @LabelSmall, Text = "STORED", Foreground = @OnSurfaceVariant, Margin = (0,10,0,4), TextWrapping = Wrap ]
                    ItemsControl [ ItemsSource = $Stored, ItemsPanel = @VerticalStackPanel, ItemTemplate = @StoredConversationRow ]
                }
            }
        }
    }

    DataTemplate x:key="OpenConversationRow" [ DataType = ChatSession ] {
        TextBlock [ Text = $Title, Style = @BodyMedium, Foreground = @OnSurface, Margin = (0,2,0,2), TextWrapping = Wrap ]
    }
}
```

> **Row-activation follow-up (note, not blocking):** wiring click-to-reveal on a row needs a per-row command; v1 lists them and relies on the dock tab strip for activation. A later pass adds `Reveal`/`OpenStored` row commands (`StoredConversationRow` template + a `RelayCommand`). Keep `StoredConversationRow` as a title-only `TextBlock` for now, mirroring `OpenConversationRow`, so the template compiles.

Add a `StoredConversationRow` template alongside `OpenConversationRow` (title-only, `DataType = StoredConversation` — import the `StoredConversation` type is not needed for a `.mu` DataType key that resolves by the exported class; since `StoredConversation` is an interface, bind the row generically: use `DataTemplate x:key="StoredConversationRow"` WITHOUT a `DataType` and let the `ItemTemplate = @StoredConversationRow` reference drive it, rendering `$Title`).

- [ ] **Step 4: Merge + register in `app.mu`**

- Add imports near the other agent imports:

```
import ChatSessionsService from "./modules/agent-chat/services/chat-sessions-service.js"
import ChatStore from "./modules/agent-chat/services/chat-store.js"
import ConversationsResources from "./modules/agent-chat/conversations.resources.mu.js"
```

- In `.services:`, register both (root-scoped so `main.js` + the nav panel share one instance):

```
        ChatSessionsService
        ChatStore
```

- In `resources:`, merge the panel dictionary:

```
        merge ConversationsResources
```

- [ ] **Step 5: Register the new `.mu` files with the compiler + compile**

In `package.json`, add `conversations.resources.mu` to the explicit `compile:mu` file list (next to `agent-chat.resources.mu`).

Run: `npm run compile:mu`
Expected: compiles with no errors; emits `conversations.resources.mu.js` and updated `agent-chat.module.mu.js` + `plexus-icons.mu.js`.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/icons/conversations.svg src/renderer/src/modules/agent-chat/conversations.resources.mu src/renderer/src/modules/agent-chat/agent-chat.module.mu src/renderer/src/plexus-icons.mu src/renderer/src/app.mu package.json
git commit -m "feat(chat): Conversations nav capability + panel + icon"
```

---

### Task 11: Rebind the chat template + seed conversations in `main.js`; retire `AgentService`

Point the transcript DataTemplate at `ChatSession`, remove the old `AgentService` singleton, and replace the `main.js` `dock.Add(agent)` seeding with `ChatSessionsService` restore + one starter conversation.

**Files:**
- Modify: `src/renderer/src/modules/agent-chat/agent-chat.resources.mu`
- Modify: `src/renderer/src/main.js`
- Delete: `src/renderer/src/modules/agent-chat/services/agent-service.ts`
- Delete: `src/renderer/src/modules/agent-chat/services/tests/agent-service.test.ts`

**Interfaces:**
- Consumes: `ChatSessionsService` (Task 9), `ChatSession` (Task 7).

- [ ] **Step 1: Rebind the transcript template**

In `agent-chat.resources.mu`:
- Change the import `import AgentService from "./services/agent-service.js"` → `import ChatSession from "./services/chat-session.js"`.
- Change `DataTemplate [ DataType = AgentService ] {` → `DataTemplate [ DataType = ChatSession ] {`.
- Everything inside the template is unchanged (it binds `$Transcript`, `$Draft`, `$SendCommand`, `$CanInput`, `$Approvals` — all present on `ChatSession`).

- [ ] **Step 2: Update `main.js` seeding**

- Remove `import { AgentService } from './modules/agent-chat/services/agent-service.js'`.
- Add `import { ChatSessionsService } from './modules/agent-chat/services/chat-sessions-service.js'`.
- Replace the dock-seeding block:

```js
    // Right panel dock: restore stored conversations into the Conversations panel,
    // then open one starter conversation as the initial Chat tab.
    const dock = app.Services.get(PanelDockService.Key)
    const chats = app.Services.get(ChatSessionsService.Key)
    if (chats !== undefined) {
        await chats.RestoreSession()
        chats.NewConversation()
    }
```

(Delete the `const agent = app.Services.get(AgentService.Key)` + `dock.Add(agent)` lines. Keep the `attachAutoOpenInspector(host, dock)` block and the disabled TemplateGallery block — the gallery still imports `TemplateGalleryService`, untouched.)

- [ ] **Step 3: Delete the retired service + its test**

```bash
git rm src/renderer/src/modules/agent-chat/services/agent-service.ts src/renderer/src/modules/agent-chat/services/tests/agent-service.test.ts
```

- [ ] **Step 4: Compile, type-check, build, and run the full renderer suite**

Run:
```
npm run compile:mu
npx tsc --noEmit -p tsconfig.web.json
npx vitest run src/renderer
npm run build
```
Expected: all green; no remaining references to `AgentService`. (If `tsconfig.web.json` is not the renderer project name, use the renderer tsconfig referenced by `package.json`'s typecheck script.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(chat): rebind chat template to ChatSession; seed conversations in bootstrap; retire AgentService"
```

---

### Task 12: e2e smoke — two parallel conversations

An Electron e2e proving two conversations open as independent dock tabs with independent transcripts, and New/Close work.

**Files:**
- Create: `src/renderer/e2e/conversations.spec.ts` (or wherever the existing `e2e/*.spec.ts` live — mirror `title-bar.spec.ts`'s `launchPlexus`/`appErrors` harness)

**Interfaces:**
- Consumes: the running app (Conversations Capability + `ChatSessionsService` on the window).

- [ ] **Step 1: Write the e2e**

Mirror the existing e2e bootstrap (`_electron` launch with `ELECTRON_RUN_AS_NODE` stripped, `PLEXUS_TEST_CORPUS` copy). Drive the manager through a small window hook rather than pixel-hunting: expose the service in `main.js` under `globalThis.__chats` (dev-only, like `__bgDemo`), then assert dock tab count.

Add to `main.js` (guarded, dev-only), right after obtaining `chats`:

```js
    if (chats !== undefined) globalThis.__chats = chats
```

Then the spec:

```ts
import { test, expect } from '@playwright/test'
import { launchPlexus, appErrors } from './helpers/plexus-app'   // match existing helper path

test('two conversations open as independent tabs with independent transcripts', async () => {
    const { app, page } = await launchPlexus()
    try {
        // One starter conversation is seeded at boot; add a second.
        const ids = await page.evaluate(() => {
            const chats = globalThis.__chats
            const a = chats.Open.ToArray()[0]
            const b = chats.NewConversation()
            // Route an assistant-text event to A only via the same path the bridge uses.
            a.apply({ Kind: 'assistant-text', Text: 'hello A' })
            return { a: a.Id, b: b.Id, aCount: a.Transcript.Count, bCount: b.Transcript.Count, open: chats.Open.Count }
        })
        expect(ids.open).toBe(2)
        expect(ids.a).not.toBe(ids.b)
        expect(ids.aCount).toBe(1)
        expect(ids.bCount).toBe(0)
        expect(appErrors()).toEqual([])
    } finally {
        await app.close()
    }
})
```

> Note: `apply` takes an `AgentEvent`; `'assistant-text'` is the literal value of `AgentEventKind.AssistantText`. Using the string literal here (in the browser-evaluated closure) is fine — it's test data crossing the `evaluate` boundary, not production code.

- [ ] **Step 2: Run the e2e**

Run: the project's e2e command (e.g. `npx playwright test src/renderer/e2e/conversations.spec.ts`), after `npm run build`.
Expected: PASS; `appErrors()` empty.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/main.js src/renderer/e2e/conversations.spec.ts
git commit -m "test(chat): e2e smoke — two independent parallel conversations"
```

---

## Self-Review

**Spec coverage (each §11 checklist item → task):**
- `AgentSessionManager` + session-tagged IPC/preload → Tasks 3, 4, 6. ✓
- Provider resume descriptor + token (claude-CLI) → Tasks 1, 2. ✓
- `ChatSession` (extracted from `AgentService`) → Task 7. ✓
- `ChatSessionsService` (open collection, new/open/close, event routing) → Task 9. ✓
- Conversations nav panel + `@Conversations` icon → Task 10. ✓
- `ChatStore` (provider-gated persist + restore) → Tasks 8, 9 (persist call), 9/11 (restore). ✓
- Dock tabs for open conversations; refactor `main.js` seeding → Tasks 9, 11. ✓
- Deferred (tear-off, global cap) → out of scope, unchanged. ✓
- **MCP attribution** (implicit in "same flow, multiplied") → Task 5. ✓

**Placeholder scan:** No "TBD"/"handle edge cases". Every code step shows real code; every test step shows real assertions. The one deliberately deferred detail — per-row activation in the nav panel — is called out inline with a compiling fallback (title-only rows), not left as a gap.

**Type consistency:**
- `TaggedAgentEvent { SessionId, Event }` used identically in Tasks 3/4/5/6/9. ✓
- `IAgentApi` addressed methods `(sessionId, …)` consistent across Tasks 3 (contract), 6 (preload), 9 (fake). ✓
- `ChatSessionCallbacks` shape (`send`/`answerQuestion`/`answerToolApproval`/`createProject`) identical in Tasks 7 and 9. ✓
- `StoredConversation` PascalCase fields (`Id`/`Title`/`Transcript`/`ResumeToken`) consistent in Tasks 8 and 9. ✓
- `ChatSession` DP getters (`Id`/`Title`/`Transcript`/`Draft`/`CanInput`/`SendCommand`/`Approvals`) match the `.mu` bindings reused in Task 11. ✓
- Provider `start(sessionId, cwd, addDirs, onEvent, resumeToken?)` consistent across Tasks 1, 2, 4. ✓

**Open risks flagged (not gaps):**
- Real claude-CLI `--resume` fidelity in long-lived stream-json mode is unverified (spec §10 open detail); Tasks 1/2 implement it behind fakes, real behaviour is an e2e/manual check. If it proves unfaithful, flip `ClaudeCliProvider.Resumable = false` (one line) and stored conversations simply won't persist — the desired fallback.
- Process-global approval-rule cwd in `agent.ts` is correct while all conversations share workspace dirs (v1); noted in Task 6.

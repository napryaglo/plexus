# Plexus Agent Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed a provider-agnostic agentic loop in Plexus — a main-process engine that drives the subscription-authed `claude` CLI as a multi-turn, token-streaming session, surfaced through a renderer chat panel.

**Architecture:** Three layers on the existing `filesystem.ts` seam. The **main process** owns a long-lived `claude -p` child behind an `IAiProvider` abstraction (registry + one CLI provider) and a single `AgentSession`. Typed **IPC** carries commands (renderer→main via `invoke`) and a new event push (main→renderer via `webContents.send`). The **renderer** consumes it through an injected `AgentService` that reduces events into an observable transcript, rendered by a chat-panel module through DataTemplates.

**Tech Stack:** TypeScript (strict), Electron (main/preload/renderer), `@pragmatic-lab/mural` runtime (Model / ObservableCollection / RelayCommand / ServiceBase), `.mu` markup compiled by the mural CLI, Vitest (node environment).

## Global Constraints

- **Enums, never string-literal unions** — every channel id, event kind, and role is a real TS `enum`. (Repo rule, e.g. `FileSystemChannel`.)
- **Shared/model properties are PascalCase; bridge verbs are camelCase** — the `window.api.*` surface uses camelCase methods (`sendTurn`), the app-facing service + Model properties use PascalCase (`SendTurn`, `Transcript`). (Mirrors `IFileSystemApi` vs `FileSystemService`.)
- **Render through templates only** — every visible chat element flows through a `DataTemplate`/`Binding` in a `.resources.mu`; no hardcoded chrome in TS.
- **Subscription auth** — the CLI is spawned **without `--bare`** so it reads the user's logged-in OAuth. Never add `--bare` or set `ANTHROPIC_API_KEY` in this component.
- **Token-by-token streaming** — always pass `--include-partial-messages`; assistant text is taken from `stream_event` text deltas, not from the full `assistant` message.
- **Permission posture** — spawn with `--permission-mode acceptEdits`; the child's `cwd` is the working directory, which bounds the blast radius. No per-action prompts in v1.
- **Don't invent test inputs** — CLI stream-json fixtures are **captured from a real `claude` run**, not hand-fabricated. Tests assert structural invariants (an event of a kind exists, ordering) rather than exact model wording.
- **Every commit message ends with:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Test runner:** `npx vitest run <path>` (config: `src/**/*.test.ts`, `environment: 'node'`). Typecheck: `npm run typecheck` (node + web projects).
- Work on the existing `agent-runtime` branch. Do not touch the unrelated pre-existing working-tree changes on `main` (`package.json` app-scripts aside — see Task 10 —, `src/main/index.ts` only where this plan directs).

**Spec:** `docs/superpowers/specs/2026-07-17-agent-runtime-design.md`

---

## File Structure

**Shared contract**
- `src/shared/agent-api.ts` (NEW) — `AgentChannel` + `AgentEventKind` enums, the `AgentEvent` union, `IAgentApi` bridge interface. Included by both tsconfig projects.

**Main process** (`src/main/agent/`)
- `ai-provider.ts` (NEW) — `IAiProvider`, `AiProviderSession`, `SpawnFn`/`ChildLike` seams. Pure types + the spawn abstraction.
- `stream-json-parser.ts` (NEW) — `StreamJsonParser`: one raw stream-json line → `AgentEvent[]`. Pure, fixture-tested. The load-bearing unit.
- `claude-cli-provider.ts` (NEW) — `ClaudeCliProvider implements IAiProvider`: spawns `claude`, line-buffers stdout through the parser, writes stdin, kills on abort. Injectable spawn.
- `ai-provider-service.ts` (NEW) — `AiProviderService`: the provider registry (register / setActive / active).
- `agent-session.ts` (NEW) — `AgentSession`: one live conversation over the active provider; start/send/abort + event relay.
- `src/main/agent.ts` (NEW) — `registerAgentHandlers()`: binds `ipcMain` command handlers and the `webContents` event push to an `AgentSession`. Thin Electron glue (typecheck-verified).
- `src/main/index.ts` (MODIFY) — call `registerAgentHandlers()` in `app.whenReady()`.

**Preload**
- `src/preload/index.ts` (MODIFY) — add the `agent` bridge (`invoke` commands + an `onEvent` subscription over `ipcRenderer.on`).

**Renderer** (`src/renderer/src/modules/agent-chat/`)
- `services/transcript.ts` (NEW) — `UserMessage` / `AssistantMessage` / `ToolActivity` Models + `TranscriptReducer` (pure event→collection logic). Unit-tested.
- `services/agent-service.ts` (NEW) — `AgentService extends ServiceBase`: wires the bridge to a `TranscriptReducer`, exposes `Transcript` / `Draft` / `Status` / `SendCommand`. Typecheck-verified.
- `agent-chat.module.mu` (NEW) — the "Agent" capability module.
- `agent-chat.resources.mu` (NEW) — DataTemplates for the panel + transcript items.

**App wiring**
- `src/renderer/src/app.mu` (MODIFY) — import/register the module, merge its resources.
- `package.json` (MODIFY) — add the two new `.mu` files to `compile:mu`.

---

## Task 1: Shared IPC contract

**Files:**
- Create: `src/shared/agent-api.ts`
- Test: `src/shared/agent-api.test.ts`

**Interfaces:**
- Produces: `enum AgentChannel { StartSession='agent:start-session', SendTurn='agent:send-turn', Abort='agent:abort', Event='agent:event' }`; `enum AgentEventKind { SessionStarted='session-started', AssistantText='assistant-text', ToolUse='tool-use', ToolResult='tool-result', TurnComplete='turn-complete', Error='error' }`; the `AgentEvent` union (all members below); `interface IAgentApi { startSession(workingDirectory: string): Promise<void>; sendTurn(workingDirectory: string, text: string): Promise<void>; abort(): Promise<void>; onEvent(handler: (event: AgentEvent) => void): () => void }`. The `sendTurn` working-directory arg lets a turn lazily start the session (Task 5) without a separate `startSession` round-trip.

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/agent-api.test.ts
import { test, expect } from 'vitest'
import { AgentChannel, AgentEventKind } from './agent-api.js'

test('channel ids are namespaced under agent:', () => {
  expect(AgentChannel.StartSession).toBe('agent:start-session')
  expect(AgentChannel.SendTurn).toBe('agent:send-turn')
  expect(AgentChannel.Abort).toBe('agent:abort')
  expect(AgentChannel.Event).toBe('agent:event')
})

test('every event kind has a distinct string value', () => {
  const values = Object.values(AgentEventKind)
  expect(new Set(values).size).toBe(values.length)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/agent-api.test.ts`
Expected: FAIL — `Cannot find module './agent-api.js'`.

- [ ] **Step 3: Write the contract**

```ts
// src/shared/agent-api.ts
// Shared agent contract across Plexus's three Electron layers (main / preload /
// renderer), mirroring file-system-api.ts. Commands go renderer→main via
// ipcRenderer.invoke; agent events are PUSHED main→renderer via
// webContents.send on AgentChannel.Event — the first push channel in Plexus
// (all prior IPC is request/response). Enums, not literals (repo rule).

export enum AgentChannel
{
    StartSession = 'agent:start-session',
    SendTurn     = 'agent:send-turn',
    Abort        = 'agent:abort',
    Event        = 'agent:event',
}

export enum AgentEventKind
{
    SessionStarted = 'session-started',
    AssistantText  = 'assistant-text',
    ToolUse        = 'tool-use',
    ToolResult     = 'tool-result',
    TurnComplete   = 'turn-complete',
    Error          = 'error',
}

// Emitted once per session from the CLI's system:init line.
export interface SessionStartedEvent { Kind: AgentEventKind.SessionStarted; SessionId: string }
// A token delta appended to the growing assistant bubble.
export interface AssistantTextEvent  { Kind: AgentEventKind.AssistantText;  Text: string }
export interface ToolUseEvent        { Kind: AgentEventKind.ToolUse;    Id: string; Name: string; Input: unknown }
export interface ToolResultEvent     { Kind: AgentEventKind.ToolResult; Id: string; Ok: boolean; Summary: string }
export interface TurnCompleteEvent   { Kind: AgentEventKind.TurnComplete }
export interface AgentErrorEvent     { Kind: AgentEventKind.Error; Message: string }

export type AgentEvent =
    | SessionStartedEvent
    | AssistantTextEvent
    | ToolUseEvent
    | ToolResultEvent
    | TurnCompleteEvent
    | AgentErrorEvent

// The low-level bridge exposed on window.api.agent. camelCase verbs mark the raw
// IPC surface; the renderer's AgentService is the PascalCase wrapper. onEvent
// subscribes to the push channel and returns an unsubscribe function.
export interface IAgentApi
{
    startSession(workingDirectory: string): Promise<void>;
    // The renderer supplies the working directory each turn; a turn lazily starts
    // the session when none is running (see AgentSession, Task 5).
    sendTurn(workingDirectory: string, text: string): Promise<void>;
    abort(): Promise<void>;
    onEvent(handler: (event: AgentEvent) => void): () => void;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/agent-api.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/agent-api.ts src/shared/agent-api.test.ts
git commit -m "feat: add shared agent IPC contract

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Stream-json parser

The pure mapping from one raw CLI stream-json line to domain `AgentEvent`s. Fixtures are captured from a real `claude` run (Global Constraints).

**Files:**
- Create: `src/main/agent/stream-json-parser.ts`
- Create: `src/main/agent/fixtures/hello.stream.jsonl` (captured)
- Create: `src/main/agent/fixtures/tool.stream.jsonl` (captured)
- Test: `src/main/agent/stream-json-parser.test.ts`

**Interfaces:**
- Consumes: `AgentEvent`, `AgentEventKind` (Task 1).
- Produces: `class StreamJsonParser { push(line: string): AgentEvent[] }`.

- [ ] **Step 1: Capture real fixtures**

On a machine where `claude` is logged in (subscription), from any directory containing a couple of files, run:

```bash
mkdir -p src/main/agent/fixtures
claude -p "Say hello in five words." \
  --output-format stream-json --include-partial-messages --verbose \
  > src/main/agent/fixtures/hello.stream.jsonl
claude -p "List the files in the current directory, then stop." \
  --output-format stream-json --include-partial-messages --verbose --permission-mode acceptEdits \
  > src/main/agent/fixtures/tool.stream.jsonl
```

Confirm each file is newline-delimited JSON whose first line has `"type":"system"`/`"subtype":"init"` with a `session_id`, and whose last line has `"type":"result"`. If `claude` is unavailable here, STOP — this task cannot proceed without a real capture (do not fabricate the fixture).

- [ ] **Step 2: Write the failing test**

```ts
// src/main/agent/stream-json-parser.test.ts
import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { StreamJsonParser } from './stream-json-parser.js'
import { AgentEventKind, type AgentEvent, type SessionStartedEvent } from '../../shared/agent-api.js'

function parseFixture(name: string): AgentEvent[] {
    const text = readFileSync(join(__dirname, 'fixtures', name), 'utf8')
    const parser = new StreamJsonParser()
    return text.split('\n').flatMap((line) => parser.push(line))
}

test('parses a hello session: SessionStarted first (with id), streamed text, TurnComplete last, no error', () => {
    const events = parseFixture('hello.stream.jsonl')
    expect(events[0].Kind).toBe(AgentEventKind.SessionStarted)
    expect((events[0] as SessionStartedEvent).SessionId).not.toBe('')
    expect(events.some((e) => e.Kind === AgentEventKind.AssistantText)).toBe(true)
    expect(events[events.length - 1].Kind).toBe(AgentEventKind.TurnComplete)
    expect(events.some((e) => e.Kind === AgentEventKind.Error)).toBe(false)
})

test('surfaces tool use and result from a tool-using session', () => {
    const events = parseFixture('tool.stream.jsonl')
    expect(events.some((e) => e.Kind === AgentEventKind.ToolUse)).toBe(true)
    expect(events.some((e) => e.Kind === AgentEventKind.ToolResult)).toBe(true)
})

test('ignores blank and malformed lines without throwing', () => {
    const parser = new StreamJsonParser()
    expect(parser.push('')).toEqual([])
    expect(parser.push('   ')).toEqual([])
    expect(parser.push('{ not json')).toEqual([])
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/agent/stream-json-parser.test.ts`
Expected: FAIL — `Cannot find module './stream-json-parser.js'`.

- [ ] **Step 4: Implement the parser**

```ts
// src/main/agent/stream-json-parser.ts
// Pure: one raw `claude -p --output-format stream-json` line → domain AgentEvents.
// Assumes --include-partial-messages is on, so assistant TEXT comes from
// stream_event text deltas; the full `assistant` message is read only for
// tool_use blocks (reading its text too would double every token). Stateless
// per line: tool_use arrives whole in the assistant message, deltas whole in a
// stream_event, so no cross-line assembly is needed.
import {
    AgentEventKind,
    type AgentEvent,
} from '../../shared/agent-api.js'

// Reduce a tool_result's content (a string or an array of text blocks) to a
// short one-line summary for the UI chip.
function summarize(content: unknown): string
{
    if (typeof content === 'string') return content.slice(0, 200)
    if (Array.isArray(content))
    {
        const text = content
            .map((b) => (b !== null && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : ''))
            .join(' ')
            .trim()
        return text.slice(0, 200)
    }
    return ''
}

export class StreamJsonParser
{
    public push(line: string): AgentEvent[]
    {
        const trimmed = line.trim()
        if (trimmed === '') return []

        let msg: Record<string, unknown>
        try { msg = JSON.parse(trimmed) as Record<string, unknown> }
        catch { return [] }   // skip malformed line, keep the stream alive

        const out: AgentEvent[] = []
        switch (msg.type)
        {
            case 'system':
                if (msg.subtype === 'init' && typeof msg.session_id === 'string')
                    out.push({ Kind: AgentEventKind.SessionStarted, SessionId: msg.session_id })
                break

            case 'stream_event':
            {
                const ev = msg.event as { type?: string; delta?: { type?: string; text?: unknown } } | undefined
                if (ev?.type === 'content_block_delta'
                    && ev.delta?.type === 'text_delta'
                    && typeof ev.delta.text === 'string')
                    out.push({ Kind: AgentEventKind.AssistantText, Text: ev.delta.text })
                break
            }

            case 'assistant':
            {
                const content = (msg.message as { content?: unknown })?.content
                if (Array.isArray(content))
                    for (const block of content as Array<Record<string, unknown>>)
                        if (block?.type === 'tool_use')
                            out.push({
                                Kind:  AgentEventKind.ToolUse,
                                Id:    String(block.id),
                                Name:  String(block.name),
                                Input: block.input,
                            })
                break
            }

            case 'user':
            {
                const content = (msg.message as { content?: unknown })?.content
                if (Array.isArray(content))
                    for (const block of content as Array<Record<string, unknown>>)
                        if (block?.type === 'tool_result')
                            out.push({
                                Kind:    AgentEventKind.ToolResult,
                                Id:      String(block.tool_use_id),
                                Ok:      block.is_error !== true,
                                Summary: summarize(block.content),
                            })
                break
            }

            case 'result':
                if (msg.is_error === true || msg.subtype === 'error_max_turns' || msg.subtype === 'error_during_execution')
                    out.push({ Kind: AgentEventKind.Error, Message: String(msg.result ?? msg.subtype ?? 'agent error') })
                else
                    out.push({ Kind: AgentEventKind.TurnComplete })
                break
        }
        return out
    }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/agent/stream-json-parser.test.ts`
Expected: PASS (3 tests). If the tool fixture lacks a `tool_result` (the model answered without a tool), re-capture Step 1 with a prompt that forces a tool call.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/stream-json-parser.ts src/main/agent/stream-json-parser.test.ts src/main/agent/fixtures/
git commit -m "feat: add stream-json parser with captured CLI fixtures

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Provider abstraction + Claude CLI provider

**Files:**
- Create: `src/main/agent/ai-provider.ts`
- Create: `src/main/agent/claude-cli-provider.ts`
- Test: `src/main/agent/claude-cli-provider.test.ts`

**Interfaces:**
- Consumes: `AgentEvent`, `AgentEventKind` (Task 1); `StreamJsonParser` (Task 2).
- Produces:
  - `interface AiProviderSession { send(text: string): void; abort(): void; dispose(): void }`
  - `interface IAiProvider { readonly Id: string; start(workingDirectory: string, onEvent: (e: AgentEvent) => void): AiProviderSession }`
  - `type SpawnFn = (command: string, args: string[], options: { cwd: string }) => ChildLike` and the `ChildLike` shape.
  - `class ClaudeCliProvider implements IAiProvider` with constructor `(binaryPath = 'claude', spawnFn = defaultSpawn)`.

- [ ] **Step 1: Write `ai-provider.ts` (types only — no test of its own)**

```ts
// src/main/agent/ai-provider.ts
// The provider abstraction — the seam that keeps the auth/billing choice out of
// every consumer. v1 has one implementation (ClaudeCliProvider); an API-key/SDK
// provider slots in later without touching the session, IPC, or renderer.
import type { AgentEvent } from '../../shared/agent-api.js'

// A single live conversation with a backend. Multi-turn: send() writes another
// user turn to the SAME process.
export interface AiProviderSession
{
    send(text: string): void;
    abort(): void;
    dispose(): void;
}

export interface IAiProvider
{
    readonly Id: string;
    start(workingDirectory: string, onEvent: (event: AgentEvent) => void): AiProviderSession;
}

// The subset of a spawned child this provider uses. Kept minimal + injectable so
// ClaudeCliProvider is unit-testable without a real process.
export interface ChildLike
{
    stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): void };
    stderr: { on(event: 'data', listener: (chunk: Buffer | string) => void): void };
    stdin:  { write(data: string): void };
    on(event: 'error', listener: (err: Error) => void): void;
    on(event: 'close', listener: (code: number | null) => void): void;
    kill(): void;
}

export type SpawnFn = (command: string, args: string[], options: { cwd: string }) => ChildLike
```

- [ ] **Step 2: Write the failing test**

```ts
// src/main/agent/claude-cli-provider.test.ts
import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ClaudeCliProvider } from './claude-cli-provider.js'
import type { ChildLike, SpawnFn } from './ai-provider.js'
import { AgentEventKind, type AgentEvent } from '../../shared/agent-api.js'

// A fake child that lets the test drive stdout/error and observe stdin/kill.
function fakeChild() {
    const stdoutListeners: Array<(c: string) => void> = []
    const errorListeners: Array<(e: Error) => void> = []
    const child = {
        stdout: { on: (_e: 'data', l: (c: Buffer | string) => void) => stdoutListeners.push(l as (c: string) => void) },
        stderr: { on: () => {} },
        stdin:  { write: (d: string) => writes.push(d) },
        on: (e: 'error' | 'close', l: (arg: never) => void) => { if (e === 'error') errorListeners.push(l as (err: Error) => void) },
        kill: () => { killed = true },
    } satisfies ChildLike
    const writes: string[] = []
    let killed = false
    return {
        child,
        writes,
        get killed() { return killed },
        emitStdout: (s: string) => stdoutListeners.forEach((l) => l(s)),
        emitError:  (e: Error) => errorListeners.forEach((l) => l(e)),
    }
}

const firstFixtureLine = readFileSync(join(__dirname, 'fixtures', 'hello.stream.jsonl'), 'utf8').split('\n')[0]

test('spawns claude (non-bare) with the streaming flags at the given cwd', () => {
    let captured: { command: string; args: string[]; options: { cwd: string } } | undefined
    const spawn: SpawnFn = (command, args, options) => { captured = { command, args, options }; return fakeChild().child }
    new ClaudeCliProvider('claude', spawn).start('/proj', () => {})
    expect(captured?.command).toBe('claude')
    expect(captured?.args).toEqual([
        '-p', '--output-format', 'stream-json', '--input-format', 'stream-json',
        '--include-partial-messages', '--verbose', '--permission-mode', 'acceptEdits',
    ])
    expect(captured?.args).not.toContain('--bare')
    expect(captured?.options.cwd).toBe('/proj')
})

test('forwards parsed events from a real stdout line', () => {
    const f = fakeChild()
    const events: AgentEvent[] = []
    new ClaudeCliProvider('claude', () => f.child).start('/proj', (e) => events.push(e))
    f.emitStdout(firstFixtureLine + '\n')
    expect(events[0].Kind).toBe(AgentEventKind.SessionStarted)
})

test('buffers a stdout chunk split mid-line until the newline arrives', () => {
    const f = fakeChild()
    const events: AgentEvent[] = []
    new ClaudeCliProvider('claude', () => f.child).start('/proj', (e) => events.push(e))
    const cut = Math.floor(firstFixtureLine.length / 2)
    f.emitStdout(firstFixtureLine.slice(0, cut))
    expect(events).toEqual([])
    f.emitStdout(firstFixtureLine.slice(cut) + '\n')
    expect(events[0].Kind).toBe(AgentEventKind.SessionStarted)
})

test('send writes a stream-json user message to stdin', () => {
    const f = fakeChild()
    const session = new ClaudeCliProvider('claude', () => f.child).start('/proj', () => {})
    session.send('hi there')
    expect(f.writes).toEqual([
        JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi there' }] } }) + '\n',
    ])
})

test('abort kills the child', () => {
    const f = fakeChild()
    const session = new ClaudeCliProvider('claude', () => f.child).start('/proj', () => {})
    session.abort()
    expect(f.killed).toBe(true)
})

test('emits an Error event when the child errors (e.g. claude not found)', () => {
    const f = fakeChild()
    const events: AgentEvent[] = []
    new ClaudeCliProvider('claude', () => f.child).start('/proj', (e) => events.push(e))
    f.emitError(new Error('spawn claude ENOENT'))
    expect(events.some((e) => e.Kind === AgentEventKind.Error)).toBe(true)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/agent/claude-cli-provider.test.ts`
Expected: FAIL — `Cannot find module './claude-cli-provider.js'`.

- [ ] **Step 4: Implement the provider**

```ts
// src/main/agent/claude-cli-provider.ts
// Wraps the console `claude` CLI as an IAiProvider. Spawns ONE long-lived
// `claude -p` in stream-json in/out mode (multi-turn over stdin) at the project
// cwd. NON-bare so it rides the user's logged-in subscription (Global
// Constraints). stdout is line-buffered through StreamJsonParser; each user turn
// is written to stdin as a stream-json user message.
import { spawn as nodeSpawn } from 'node:child_process'
import { StreamJsonParser } from './stream-json-parser.js'
import { AgentEventKind, type AgentEvent } from '../../shared/agent-api.js'
import type { AiProviderSession, ChildLike, IAiProvider, SpawnFn } from './ai-provider.js'

const CLI_ARGS = [
    '-p',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',                       // required with --print + stream-json
    '--permission-mode', 'acceptEdits', // auto-approve edits; cwd bounds blast radius
]

const defaultSpawn: SpawnFn = (command, args, options) =>
    nodeSpawn(command, args, { cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'] }) as unknown as ChildLike

export class ClaudeCliProvider implements IAiProvider
{
    public readonly Id = 'claude-cli'

    constructor(
        private readonly binaryPath: string = 'claude',
        private readonly spawnFn: SpawnFn = defaultSpawn,
    ) {}

    public start(workingDirectory: string, onEvent: (event: AgentEvent) => void): AiProviderSession
    {
        const child = this.spawnFn(this.binaryPath, CLI_ARGS, { cwd: workingDirectory })
        const parser = new StreamJsonParser()
        let buffer = ''

        child.stdout.on('data', (chunk) => {
            buffer += chunk.toString()
            let newline = buffer.indexOf('\n')
            while (newline !== -1)
            {
                const line = buffer.slice(0, newline)
                buffer = buffer.slice(newline + 1)
                for (const event of parser.push(line)) onEvent(event)
                newline = buffer.indexOf('\n')
            }
        })

        child.on('error', (err) => {
            onEvent({ Kind: AgentEventKind.Error, Message: err.message })
        })

        return {
            send: (text) => {
                const message = { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }
                child.stdin.write(JSON.stringify(message) + '\n')
            },
            abort:   () => child.kill(),
            dispose: () => child.kill(),
        }
    }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/agent/claude-cli-provider.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/ai-provider.ts src/main/agent/claude-cli-provider.ts src/main/agent/claude-cli-provider.test.ts
git commit -m "feat: add IAiProvider abstraction and Claude CLI provider

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Provider registry

**Files:**
- Create: `src/main/agent/ai-provider-service.ts`
- Test: `src/main/agent/ai-provider-service.test.ts`

**Interfaces:**
- Consumes: `IAiProvider` (Task 3).
- Produces: `class AiProviderService { register(provider: IAiProvider): void; setActive(id: string): void; active(): IAiProvider }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/main/agent/ai-provider-service.test.ts
import { test, expect } from 'vitest'
import { AiProviderService } from './ai-provider-service.js'
import type { AiProviderSession, IAiProvider } from './ai-provider.js'

function fakeProvider(id: string): IAiProvider {
    return { Id: id, start: (): AiProviderSession => ({ send: () => {}, abort: () => {}, dispose: () => {} }) }
}

test('the first registered provider becomes active by default', () => {
    const svc = new AiProviderService()
    const claude = fakeProvider('claude-cli')
    svc.register(claude)
    expect(svc.active()).toBe(claude)
})

test('setActive switches the active provider by id', () => {
    const svc = new AiProviderService()
    const a = fakeProvider('a'); const b = fakeProvider('b')
    svc.register(a); svc.register(b)
    expect(svc.active()).toBe(a)
    svc.setActive('b')
    expect(svc.active()).toBe(b)
})

test('active throws when no provider is registered', () => {
    expect(() => new AiProviderService().active()).toThrow()
})

test('setActive to an unknown id throws', () => {
    const svc = new AiProviderService()
    svc.register(fakeProvider('a'))
    expect(() => svc.setActive('nope')).toThrow()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/agent/ai-provider-service.test.ts`
Expected: FAIL — `Cannot find module './ai-provider-service.js'`.

- [ ] **Step 3: Implement the registry**

```ts
// src/main/agent/ai-provider-service.ts
// The provider registry: holds AI providers by id and names the active one. v1
// registers only ClaudeCliProvider; this is the single insertion point for an
// API-key/SDK provider later.
import type { IAiProvider } from './ai-provider.js'

export class AiProviderService
{
    private readonly providers = new Map<string, IAiProvider>()
    private activeId: string | undefined = undefined

    public register(provider: IAiProvider): void
    {
        this.providers.set(provider.Id, provider)
        if (this.activeId === undefined) this.activeId = provider.Id
    }

    public setActive(id: string): void
    {
        if (!this.providers.has(id)) throw new Error(`AiProviderService: no provider registered with id "${id}"`)
        this.activeId = id
    }

    public active(): IAiProvider
    {
        const provider = this.activeId !== undefined ? this.providers.get(this.activeId) : undefined
        if (provider === undefined) throw new Error('AiProviderService: no active provider registered')
        return provider
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/agent/ai-provider-service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/ai-provider-service.ts src/main/agent/ai-provider-service.test.ts
git commit -m "feat: add AI provider registry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Agent session

One live conversation: starts a provider session for a cwd, relays its events to a sink, and disposes the previous session when a new one starts.

**Files:**
- Create: `src/main/agent/agent-session.ts`
- Test: `src/main/agent/agent-session.test.ts`

**Interfaces:**
- Consumes: `AiProviderService` (Task 4); `AgentEvent`, `AgentEventKind` (Task 1); `IAiProvider`/`AiProviderSession` (Task 3).
- Produces: `class AgentSession { constructor(providers: AiProviderService, emit: (event: AgentEvent) => void); start(workingDirectory: string): void; send(workingDirectory: string, text: string): void; abort(): void; dispose(): void }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/main/agent/agent-session.test.ts
import { test, expect } from 'vitest'
import { AgentSession } from './agent-session.js'
import { AiProviderService } from './ai-provider-service.js'
import type { AiProviderSession, IAiProvider } from './ai-provider.js'
import { AgentEventKind, type AgentEvent } from '../../shared/agent-api.js'

// A provider that records each started session so the test can drive events and
// observe routing.
function recordingProvider() {
    const started: Array<{ cwd: string; onEvent: (e: AgentEvent) => void; sent: string[]; disposed: boolean; aborted: boolean }> = []
    const provider: IAiProvider = {
        Id: 'rec',
        start: (cwd, onEvent): AiProviderSession => {
            const rec = { cwd, onEvent, sent: [] as string[], disposed: false, aborted: false }
            started.push(rec)
            return {
                send: (t) => rec.sent.push(t),
                abort: () => { rec.aborted = true },
                dispose: () => { rec.disposed = true },
            }
        },
    }
    return { provider, started }
}

function serviceWith(provider: IAiProvider): AiProviderService {
    const svc = new AiProviderService(); svc.register(provider); return svc
}

test('send lazily starts a session at the cwd and forwards the turn', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), () => {})
    session.send('/proj', 'hello')
    expect(started).toHaveLength(1)
    expect(started[0].cwd).toBe('/proj')
    expect(started[0].sent).toEqual(['hello'])
})

test('provider events are relayed to the emit sink', () => {
    const { provider, started } = recordingProvider()
    const emitted: AgentEvent[] = []
    const session = new AgentSession(serviceWith(provider), (e) => emitted.push(e))
    session.send('/proj', 'hi')
    started[0].onEvent({ Kind: AgentEventKind.TurnComplete })
    expect(emitted).toEqual([{ Kind: AgentEventKind.TurnComplete }])
})

test('an explicit start disposes the previous session', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), () => {})
    session.start('/a')
    session.start('/b')
    expect(started[0].disposed).toBe(true)
    expect(started[1].cwd).toBe('/b')
})

test('abort forwards to the current session', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), () => {})
    session.start('/a')
    session.abort()
    expect(started[0].aborted).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/agent/agent-session.test.ts`
Expected: FAIL — `Cannot find module './agent-session.js'`.

- [ ] **Step 3: Implement the session**

```ts
// src/main/agent/agent-session.ts
// One live conversation, bound to the active provider. Holds the current
// provider session; starting a new one disposes the old (v1 = a single session).
// Emits every provider event to the sink the IPC layer supplies.
import type { AiProviderSession } from './ai-provider.js'
import type { AiProviderService } from './ai-provider-service.js'
import type { AgentEvent } from '../../shared/agent-api.js'

export class AgentSession
{
    private current: AiProviderSession | null = null

    constructor(
        private readonly providers: AiProviderService,
        private readonly emit: (event: AgentEvent) => void,
    ) {}

    public start(workingDirectory: string): void
    {
        this.current?.dispose()
        this.current = this.providers.active().start(workingDirectory, this.emit)
    }

    public send(workingDirectory: string, text: string): void
    {
        if (this.current === null) this.start(workingDirectory)
        this.current!.send(text)
    }

    public abort(): void
    {
        this.current?.abort()
    }

    public dispose(): void
    {
        this.current?.dispose()
        this.current = null
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/agent/agent-session.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/agent-session.ts src/main/agent/agent-session.test.ts
git commit -m "feat: add agent session lifecycle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Main-process IPC handlers

Thin Electron glue binding the command channels + event push to an `AgentSession`. No unit test (electron `ipcMain`/`BrowserWindow`); verified by `typecheck:node` and, at the end, manual `npm run dev`.

**Files:**
- Create: `src/main/agent.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `AgentChannel` (Task 1); `AiProviderService` (Task 4); `AgentSession` (Task 5); `ClaudeCliProvider` (Task 3).
- Produces: `function registerAgentHandlers(): void`.

- [ ] **Step 1: Write `src/main/agent.ts`**

```ts
// src/main/agent.ts
// Main-process agent capability. Owns the AiProviderService (seeded with the
// Claude CLI provider) and a single AgentSession, wired to typed IPC:
//   • commands   renderer→main via ipcMain.handle
//   • events     main→renderer via webContents.send on AgentChannel.Event
// Register once from app.whenReady(), alongside registerFileSystemHandlers().
import { BrowserWindow, ipcMain } from 'electron'
import { AgentChannel, type AgentEvent } from '../shared/agent-api.js'
import { AiProviderService } from './agent/ai-provider-service.js'
import { ClaudeCliProvider } from './agent/claude-cli-provider.js'
import { AgentSession } from './agent/agent-session.js'

// Push an agent event to the renderer (the focused window, falling back to the
// first — a single window today, but this stays correct if more open).
function emitToRenderer(event: AgentEvent): void
{
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    win?.webContents.send(AgentChannel.Event, event)
}

export function registerAgentHandlers(): void
{
    const providers = new AiProviderService()
    providers.register(new ClaudeCliProvider())
    const session = new AgentSession(providers, emitToRenderer)

    ipcMain.handle(AgentChannel.StartSession, (_e, workingDirectory: string): void => {
        session.start(workingDirectory)
    })
    ipcMain.handle(AgentChannel.SendTurn, (_e, workingDirectory: string, text: string): void => {
        session.send(workingDirectory, text)
    })
    ipcMain.handle(AgentChannel.Abort, (): void => {
        session.abort()
    })
}
```

Note: `SendTurn` carries the working directory each turn (the renderer resolves it — Task 9), so a turn can start the session lazily without a separate `StartSession` round-trip.

- [ ] **Step 2: Register in `src/main/index.ts`**

Add the import near the other handler imports (after line 6, `registerSettingsHandlers`):

```ts
import { registerAgentHandlers } from './agent.js'
```

And call it inside `app.whenReady().then(...)`, immediately after `registerSettingsHandlers()`:

```ts
  // Agent runtime — owns the claude CLI child + session, exposed to the renderer
  // as command handlers plus a pushed event stream (AgentChannel.Event).
  registerAgentHandlers()
```

- [ ] **Step 3: Verify it typechecks**

Run: `npm run typecheck:node`
Expected: PASS (no errors). This compiles the main + preload + shared node project including the new `src/main/agent.ts` and `src/main/agent/*`.

- [ ] **Step 4: Commit**

```bash
git add src/main/agent.ts src/main/index.ts
git commit -m "feat: wire agent IPC handlers into the main process

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Preload bridge

Expose the agent surface on `window.api.agent`: `invoke` commands plus an `onEvent` subscription over `ipcRenderer.on`. Verified by `typecheck:node` (preload is in the node project).

**Files:**
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `AgentChannel`, `IAgentApi`, `AgentEvent` (Task 1).
- Produces: `window.api.agent` conforming to `IAgentApi`.

- [ ] **Step 1: Add the agent bridge to the imports block**

At the top of `src/preload/index.ts`, add to the existing shared-api imports (after the `settings-api` import on line 13):

```ts
import { AgentChannel, type AgentEvent, type IAgentApi } from '../shared/agent-api.js'
```

- [ ] **Step 2: Build the `agent` bridge object**

After the `settings` const (ends line 59) and before `const api = { fs, environment, settings }`, insert:

```ts
// Agent runtime bridge. Commands are ipcRenderer.invoke round-trips; onEvent
// subscribes to the pushed AgentChannel.Event stream and returns an unsubscribe.
// sendTurn forwards the working directory + text (matching the SendTurn handler).
const agent: IAgentApi = {
  startSession: (workingDirectory: string): Promise<void> =>
    ipcRenderer.invoke(AgentChannel.StartSession, workingDirectory),
  sendTurn: (workingDirectory: string, text: string): Promise<void> =>
    ipcRenderer.invoke(AgentChannel.SendTurn, workingDirectory, text),
  abort: (): Promise<void> => ipcRenderer.invoke(AgentChannel.Abort),
  onEvent: (handler: (event: AgentEvent) => void): (() => void) => {
    const listener = (_e: unknown, event: AgentEvent): void => handler(event)
    ipcRenderer.on(AgentChannel.Event, listener)
    return () => { ipcRenderer.removeListener(AgentChannel.Event, listener) }
  },
}
```

- [ ] **Step 3: Add `agent` to the exposed api**

Change line 61 from:

```ts
const api = { fs, environment, settings }
```

to:

```ts
const api = { fs, environment, settings, agent }
```

- [ ] **Step 4: Verify it typechecks**

Run: `npm run typecheck:node`
Expected: PASS. (The `sendTurn` two-arg signature already lives in `agent-api.ts` from Task 1, so no contract change is needed here.)

- [ ] **Step 5: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat: expose agent bridge on window.api.agent

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Transcript models + reducer

The renderer-side domain: three item Models and the pure reducer that folds `AgentEvent`s into an observable transcript. This holds the interesting logic and is fully unit-tested; the `AgentService` shell (Task 9) is thin around it.

**Files:**
- Create: `src/renderer/src/modules/agent-chat/services/transcript.ts`
- Test: `src/renderer/src/modules/agent-chat/services/transcript.test.ts`

**Interfaces:**
- Consumes: `AgentEvent`, `AgentEventKind` (Task 1); `Model`, `ObservableCollection`, `MetaData` from `@pragmatic-lab/mural/runtime`.
- Produces:
  - `enum TranscriptRole { User='user', Assistant='assistant', Tool='tool' }`
  - `class UserMessage extends Model { get Text(): string }` (ctor `(text: string)`)
  - `class AssistantMessage extends Model { get Text(): string; appendText(delta: string): void }` (ctor `()`)
  - `class ToolActivity extends Model { get Name(): string; get Status(): string; readonly Id: string; setStatus(status: string): void }` (ctor `(id: string, name: string)`)
  - `class TranscriptReducer { readonly Transcript: ObservableCollection<Model>; beginUserTurn(text: string): void; apply(event: AgentEvent): void }`

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/modules/agent-chat/services/transcript.test.ts
import { test, expect } from 'vitest'
import { AgentEventKind } from '../../../../../shared/agent-api.js'
import { TranscriptReducer, UserMessage, AssistantMessage, ToolActivity } from './transcript.js'

function items(r: TranscriptReducer) { return Array.from(r.Transcript) }

test('a user turn appends a UserMessage carrying the text', () => {
    const r = new TranscriptReducer()
    r.beginUserTurn('hello')
    const list = items(r)
    expect(list).toHaveLength(1)
    expect(list[0]).toBeInstanceOf(UserMessage)
    expect((list[0] as UserMessage).Text).toBe('hello')
})

test('assistant text deltas accumulate into ONE growing bubble', () => {
    const r = new TranscriptReducer()
    r.apply({ Kind: AgentEventKind.AssistantText, Text: 'Hel' })
    r.apply({ Kind: AgentEventKind.AssistantText, Text: 'lo' })
    const list = items(r)
    expect(list).toHaveLength(1)
    expect(list[0]).toBeInstanceOf(AssistantMessage)
    expect((list[0] as AssistantMessage).Text).toBe('Hello')
})

test('a tool use starts a new bubble after assistant text', () => {
    const r = new TranscriptReducer()
    r.apply({ Kind: AgentEventKind.AssistantText, Text: 'working' })
    r.apply({ Kind: AgentEventKind.ToolUse, Id: 't1', Name: 'Read', Input: {} })
    const list = items(r)
    expect(list).toHaveLength(2)
    expect(list[1]).toBeInstanceOf(ToolActivity)
    expect((list[1] as ToolActivity).Name).toBe('Read')
    expect((list[1] as ToolActivity).Status).toBe('running')
})

test('a tool result updates the matching activity status', () => {
    const r = new TranscriptReducer()
    r.apply({ Kind: AgentEventKind.ToolUse, Id: 't1', Name: 'Read', Input: {} })
    r.apply({ Kind: AgentEventKind.ToolResult, Id: 't1', Ok: true, Summary: 'ok' })
    const activity = items(r)[0] as ToolActivity
    expect(activity.Status).toBe('done')
})

test('a failed tool result marks the activity failed', () => {
    const r = new TranscriptReducer()
    r.apply({ Kind: AgentEventKind.ToolUse, Id: 't1', Name: 'Bash', Input: {} })
    r.apply({ Kind: AgentEventKind.ToolResult, Id: 't1', Ok: false, Summary: 'boom' })
    expect((items(r)[0] as ToolActivity).Status).toBe('failed')
})

test('assistant text after a tool starts a fresh bubble (does not reopen the old one)', () => {
    const r = new TranscriptReducer()
    r.apply({ Kind: AgentEventKind.AssistantText, Text: 'a' })
    r.apply({ Kind: AgentEventKind.ToolUse, Id: 't1', Name: 'Read', Input: {} })
    r.apply({ Kind: AgentEventKind.AssistantText, Text: 'b' })
    const list = items(r)
    expect(list).toHaveLength(3)
    expect((list[2] as AssistantMessage).Text).toBe('b')
})

test('SessionStarted and TurnComplete add no transcript items', () => {
    const r = new TranscriptReducer()
    r.apply({ Kind: AgentEventKind.SessionStarted, SessionId: 'x' })
    r.apply({ Kind: AgentEventKind.TurnComplete })
    expect(items(r)).toHaveLength(0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/agent-chat/services/transcript.test.ts`
Expected: FAIL — `Cannot find module './transcript.js'`.

- [ ] **Step 3: Implement the models + reducer**

```ts
// src/renderer/src/modules/agent-chat/services/transcript.ts
// Renderer-side transcript: three item Models (bound by DataType in
// agent-chat.resources.mu) and the pure reducer that folds AgentEvents into an
// ObservableCollection. Kept free of ServiceBase/window so it is unit-testable;
// AgentService is a thin shell over it.
import { MetaData, Model, ObservableCollection } from '@pragmatic-lab/mural/runtime'
import { AgentEventKind, type AgentEvent } from '../../../../../shared/agent-api.js'

export enum TranscriptRole { User = 'user', Assistant = 'assistant', Tool = 'tool' }

export class UserMessage extends Model
{
    public static readonly TextKey = Model.RegisterProperty<string>(UserMessage, 'Text', '', MetaData.None)
    constructor(text: string) { super(); this.set_property_value(UserMessage.TextKey, text) }
    public get Text(): string { return this.get_property_value(UserMessage.TextKey) }
}

export class AssistantMessage extends Model
{
    public static readonly TextKey = Model.RegisterProperty<string>(AssistantMessage, 'Text', '', MetaData.None)
    public get Text(): string { return this.get_property_value(AssistantMessage.TextKey) }
    // Append a token delta — set_property_value fires INotifyPropertyChanged so
    // the bound TextBlock grows live.
    public appendText(delta: string): void
    {
        this.set_property_value(AssistantMessage.TextKey, this.Text + delta)
    }
}

export class ToolActivity extends Model
{
    public static readonly NameKey   = Model.RegisterProperty<string>(ToolActivity, 'Name', '', MetaData.None)
    public static readonly StatusKey = Model.RegisterProperty<string>(ToolActivity, 'Status', 'running', MetaData.None)
    public readonly Id: string
    constructor(id: string, name: string)
    {
        super()
        this.Id = id
        this.set_property_value(ToolActivity.NameKey, name)
    }
    public get Name(): string { return this.get_property_value(ToolActivity.NameKey) }
    public get Status(): string { return this.get_property_value(ToolActivity.StatusKey) }
    public setStatus(status: string): void { this.set_property_value(ToolActivity.StatusKey, status) }
}

export class TranscriptReducer
{
    public readonly Transcript = new ObservableCollection<Model>()

    // The assistant bubble currently being streamed into, or null when the next
    // text delta should open a fresh one.
    private currentAssistant: AssistantMessage | null = null
    // Tool activities awaiting their result, keyed by tool_use id.
    private readonly pendingTools = new Map<string, ToolActivity>()

    public beginUserTurn(text: string): void
    {
        this.currentAssistant = null
        this.Transcript.Add(new UserMessage(text))
    }

    public apply(event: AgentEvent): void
    {
        switch (event.Kind)
        {
            case AgentEventKind.AssistantText:
                if (this.currentAssistant === null)
                {
                    this.currentAssistant = new AssistantMessage()
                    this.Transcript.Add(this.currentAssistant)
                }
                this.currentAssistant.appendText(event.Text)
                break

            case AgentEventKind.ToolUse:
            {
                this.currentAssistant = null
                const activity = new ToolActivity(event.Id, event.Name)
                this.pendingTools.set(event.Id, activity)
                this.Transcript.Add(activity)
                break
            }

            case AgentEventKind.ToolResult:
            {
                const activity = this.pendingTools.get(event.Id)
                if (activity !== undefined)
                {
                    activity.setStatus(event.Ok ? 'done' : 'failed')
                    this.pendingTools.delete(event.Id)
                }
                break
            }

            case AgentEventKind.SessionStarted:
            case AgentEventKind.TurnComplete:
                // No transcript item; TurnComplete closes the current bubble so the
                // next turn's text starts fresh.
                this.currentAssistant = null
                break

            case AgentEventKind.Error:
            {
                // Surface the error inline as its own assistant bubble.
                this.currentAssistant = null
                const bubble = new AssistantMessage()
                bubble.appendText(`⚠ ${event.Message}`)
                this.Transcript.Add(bubble)
                break
            }
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/agent-chat/services/transcript.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/agent-chat/services/transcript.ts src/renderer/src/modules/agent-chat/services/transcript.test.ts
git commit -m "feat: add transcript models and event reducer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Renderer AgentService

The injected capability-content service: wires `window.api.agent` to a `TranscriptReducer`, exposes `Transcript` / `Draft` / `Status` / `SendCommand`. Thin over Task 8; verified by `typecheck:web`.

**Files:**
- Create: `src/renderer/src/modules/agent-chat/services/agent-service.ts`

**Interfaces:**
- Consumes: `IAgentApi`, `AgentEvent` (Task 1); `TranscriptReducer` (Task 8); `ServiceBase`, `ServiceKey`, `Model`, `MetaData`, `ObservableCollection`, `RelayCommand`, `IServiceProvider` from `@pragmatic-lab/mural/runtime`; `EnvironmentService` (`src/renderer/src/services/environment/environment-service.ts`).
- Produces: `class AgentService extends ServiceBase` with `static Key`, and bound properties `Transcript`, `Draft`, `Status`, `SendCommand`.

Note on working directory: v1 resolves the session cwd from `EnvironmentService.CurrentDirectory` (a guaranteed real path). Binding it to the *active project's* `RootPath` is a one-line change once an active-project accessor exists — tracked in the spec's out-of-scope list, not built here.

- [ ] **Step 1: Confirm the EnvironmentService accessor name**

Run: `npx vitest run --root . --reporter dot 2>/dev/null; sed -n '1,60p' src/renderer/src/services/environment/environment-service.ts` — actually just open the file and note the getter that returns the current working directory (it wraps `EnvironmentInfo.CurrentDirectory`). Use that getter's exact name in Step 2 (referred to below as `env.CurrentDirectory`).

- [ ] **Step 2: Implement the service**

```ts
// src/renderer/src/modules/agent-chat/services/agent-service.ts
// The Agent capability's content service. Subscribes to the pushed agent event
// stream (window.api.agent) and folds it into an observable transcript via
// TranscriptReducer; exposes the transcript, the input draft, a send command,
// and a coarse status for the chat DataTemplate to bind. Module-local: named by
// the agent-chat module's Capability ServiceKey.
import {
    MetaData,
    Model,
    ObservableCollection,
    RelayCommand,
    ServiceBase,
    ServiceKey,
    type ICommand,
    type IServiceProvider,
} from '@pragmatic-lab/mural/runtime'
import type { IAgentApi } from '../../../../../shared/agent-api.js'
import { EnvironmentService } from '../../../services/environment/environment-service.js'
import { TranscriptReducer } from './transcript.js'

export class AgentService extends ServiceBase
{
    public static readonly Key = new ServiceKey<AgentService>('AgentService')

    public static readonly TranscriptKey = Model.RegisterProperty<ObservableCollection<Model>>(
        AgentService, 'Transcript', undefined as unknown as ObservableCollection<Model>, MetaData.None)
    public static readonly DraftKey = Model.RegisterProperty<string>(
        AgentService, 'Draft', '', MetaData.None)
    public static readonly StatusKey = Model.RegisterProperty<string>(
        AgentService, 'Status', 'idle', MetaData.None)
    public static readonly SendCommandKey = Model.RegisterProperty<ICommand>(
        AgentService, 'SendCommand', undefined as unknown as ICommand, MetaData.None)

    private readonly reducer = new TranscriptReducer()
    private readonly agent: IAgentApi
    private readonly cwd: string

    constructor(provider: IServiceProvider)
    {
        super(provider)
        const bridge = (globalThis as unknown as { api?: { agent?: IAgentApi } }).api
        if (bridge?.agent === undefined)
        {
            throw new Error(
                'AgentService: window.api.agent is unavailable — the Electron preload '
                + 'bridge did not load. This service requires the Plexus desktop host.',
            )
        }
        this.agent = bridge.agent
        this.cwd = provider.get(EnvironmentService.Key)?.CurrentDirectory ?? ''

        this.set_property_value(AgentService.TranscriptKey, this.reducer.Transcript)
        this.set_property_value(AgentService.SendCommandKey, new RelayCommand(() => this.send()))

        // Fold every pushed agent event into the transcript.
        this.agent.onEvent((event) => this.reducer.apply(event))
    }

    public get Transcript(): ObservableCollection<Model> { return this.get_property_value(AgentService.TranscriptKey) }
    public get Draft(): string { return this.get_property_value(AgentService.DraftKey) }
    public set Draft(value: string) { this.set_property_value(AgentService.DraftKey, value) }
    public get Status(): string { return this.get_property_value(AgentService.StatusKey) }
    public get SendCommand(): ICommand { return this.get_property_value(AgentService.SendCommandKey) }

    private send(): void
    {
        const text = this.Draft.trim()
        if (text === '') return
        this.reducer.beginUserTurn(text)   // optimistic echo
        void this.agent.sendTurn(this.cwd, text)
        this.set_property_value(AgentService.DraftKey, '')
    }
}

export default AgentService
```

If `provider.get` is not the accessor mural exposes (some builds use `provider.tryGet`/`getRequired`), match how `EnvironmentService` is resolved elsewhere — search: `Grep "EnvironmentService.Key" src/renderer` and mirror that call. `CurrentDirectory` must be the real getter name confirmed in Step 1.

- [ ] **Step 3: Verify it typechecks**

Run: `npm run typecheck:web`
Expected: PASS. Fix any accessor-name mismatch (`provider.get`, `CurrentDirectory`) flagged here against the confirmed names.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/modules/agent-chat/services/agent-service.ts
git commit -m "feat: add renderer AgentService bound to the event stream

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Chat panel module, resources, and app wiring

The capability module + DataTemplates + app registration + compile wiring. Verified by `compile:mu` + `typecheck` + manual `npm run dev`. No unit test (mural/.mu integration, per the repo's vitest note).

**Files:**
- Create: `src/renderer/src/modules/agent-chat/agent-chat.module.mu`
- Create: `src/renderer/src/modules/agent-chat/agent-chat.resources.mu`
- Modify: `src/renderer/src/app.mu`
- Modify: `package.json` (the `compile:mu` script)

**Interfaces:**
- Consumes: `AgentService` (Task 9); `UserMessage`/`AssistantMessage`/`ToolActivity` (Task 8); `@VerticalStackPanel` (app.mu shared resource); an existing icon key from `plexus-icons.mu`.

- [ ] **Step 1: Write the module**

```
// src/renderer/src/modules/agent-chat/agent-chat.module.mu
// The Agent chat module — a ShellModule contributing one capability whose
// content is the AgentService, rendered by DataTemplate[DataType = AgentService]
// (agent-chat.resources.mu) in the shell's left panel. Icon reuses @Outline for
// v1 (a dedicated glyph can be added to plexus-icons.mu later).

import AgentService from "./services/agent-service.js"

module AgentChatModule [ Name = "Agent" ] {
    .services: {
        AgentService
    }

    Capability [ Name = "Agent", Icon = @Outline, ServiceKey = AgentService ]
}
```

- [ ] **Step 2: Write the resources (the chat DataTemplate + item templates)**

```
// src/renderer/src/modules/agent-chat/agent-chat.resources.mu
// View resources for the Agent capability. DataTemplate[AgentService] renders
// the transcript (an ItemsControl over $Transcript) above an input row (a
// TextBox bound to $Draft + a Send button bound to $SendCommand). Item templates
// render each transcript Model by DataType. Merged app-global by app.mu.
// Render-through-templates rule: all chat chrome lives here, none in TS.

import AgentService from "./services/agent-service.js"
import UserMessage from "./services/transcript.js"
import AssistantMessage from "./services/transcript.js"
import ToolActivity from "./services/transcript.js"

resources AgentChatResources {
    DataTemplate [ DataType = AgentService ] {
        DockPanel [ LastChildFill = true, Margin = (12,12,12,12) ] {
            // Input row pinned to the bottom.
            DockPanel [ DockPanel.Dock = Bottom, LastChildFill = true, Margin = (0,8,0,0) ] {
                Button  [ DockPanel.Dock = Right, Variant = Filled, Command = $SendCommand, Margin = (8,0,0,0) ] {
                    TextBlock [ Text = "Send" ]
                }
                TextBox [ Text = $Draft ]
            }
            // Scrolling transcript fills the rest.
            ScrollViewer {
                ItemsControl [ ItemsSource = $Transcript, ItemsPanel = @VerticalStackPanel ]
            }
        }
    }

    DataTemplate [ DataType = UserMessage ] {
        Border [ Background = @SurfaceVariant, CornerRadius = 8, Padding = (10,6,10,6), Margin = (40,3,0,3) ] {
            TextBlock [ Style = @BodyMedium, Text = $Text, Foreground = @OnSurface, TextWrapping = Wrap ]
        }
    }

    DataTemplate [ DataType = AssistantMessage ] {
        Border [ Padding = (10,6,10,6), Margin = (0,3,40,3) ] {
            TextBlock [ Style = @BodyMedium, Text = $Text, Foreground = @OnSurface, TextWrapping = Wrap ]
        }
    }

    DataTemplate [ DataType = ToolActivity ] {
        DockPanel [ LastChildFill = true, Margin = (0,2,0,2) ] {
            TextBlock [ DockPanel.Dock = Right, Style = @BodySmall, Text = $Status, Foreground = @OnSurfaceVariant, Margin = (8,0,0,0) ]
            TextBlock [ Style = @BodySmall, Text = $Name, Foreground = @OnSurfaceVariant ]
        }
    }
}
```

If the compiler rejects any control/attribute here (e.g. `ScrollViewer`, `Variant = Filled`, `CornerRadius`), check an existing `.resources.mu` for the accepted spelling — `settings.resources.mu` (Button `Variant = Outlined`, TextBox, DockPanel) and `panels.resources.mu` (ItemsControl, `@VerticalStackPanel`) are the references. Prefer the exact idioms proven there; drop cosmetic attributes rather than invent new ones.

- [ ] **Step 3: Register the module + resources in `app.mu`**

Add the module import alongside the other module imports (after line 40, `ArchitectureMetaModelsModule`):

```
import AgentChatModule from "./modules/agent-chat/agent-chat.module.mu.js"
```

Add the resources import alongside the other resource imports (after line 85, `ProjectExplorerResources`):

```
import AgentChatResources from "./modules/agent-chat/agent-chat.resources.mu.js"
```

Add `AgentChatModule` to the `.modules:` block (after `ArchitectureMetaModelsModule`, line 155):

```
        AgentChatModule
```

Add `merge AgentChatResources` to the `resources:` block (after `merge ProjectExplorerResources`, line 184):

```
        merge AgentChatResources
```

- [ ] **Step 4: Add the two `.mu` files to `compile:mu`**

In `package.json`, the `compile:mu` script lists every `.mu` file. Append these two paths to the argument list (before the final `src/renderer/src/app.mu`):

```
src/renderer/src/modules/agent-chat/agent-chat.module.mu src/renderer/src/modules/agent-chat/agent-chat.resources.mu
```

The script's tail must remain `... src/renderer/src/modules/agent-chat/agent-chat.module.mu src/renderer/src/modules/agent-chat/agent-chat.resources.mu src/renderer/src/app.mu` (app.mu last, since it imports the others).

- [ ] **Step 5: Compile the mural markup**

Run: `npm run compile:mu`
Expected: exit 0; emits `agent-chat.module.mu.js` and `agent-chat.resources.mu.js` next to their sources. Fix any markup error surfaced here against the reference `.resources.mu` idioms (Step 2 note).

- [ ] **Step 6: Typecheck the whole app**

Run: `npm run typecheck`
Expected: PASS (node + web).

- [ ] **Step 7: Manual smoke test**

Run: `npm run dev`
Expected: Plexus launches; an **Agent** entry appears in the left navigation rail. Selecting it shows the chat panel (empty transcript + input + Send). Type a prompt, click Send:
- your message appears as a user bubble immediately;
- assistant text streams in token-by-token;
- any tool the agent uses appears as a row that flips from `running` to `done`.

Precondition: `claude` is on `PATH` and logged in (subscription). If the panel shows `⚠ spawn claude ENOENT`, `claude` isn't on the launched process's `PATH` — a follow-up (out of scope here) is a configurable binary-path setting.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/modules/agent-chat/agent-chat.module.mu src/renderer/src/modules/agent-chat/agent-chat.resources.mu src/renderer/src/app.mu package.json
git commit -m "feat: add agent chat panel module and wire it into the shell

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- Provider abstraction + registry + CLI provider → Tasks 3, 4. ✓
- Subscription auth (non-bare) → Task 3 (`CLI_ARGS`, test asserts no `--bare`) + Global Constraints. ✓
- `AgentSession` (single, in-memory, session lifecycle) → Task 5. ✓
- Typed IPC: commands via `invoke`, events via `webContents.send` push channel → Tasks 1, 6, 7. ✓
- Renderer `AgentService` (observable transcript, `INotifyPropertyChanged`/`INotifyCollectionChanged` via Model/ObservableCollection) → Tasks 8, 9. ✓
- Chat panel module, render-through-templates → Task 10. ✓
- Event model (SessionStarted/AssistantText delta/ToolUse/ToolResult/TurnComplete/Error) → Task 1 union, Task 2 parser, Task 8 reducer. ✓
- Token-by-token streaming (`--include-partial-messages`, delta assembly) → Tasks 2, 3, 8. ✓
- Permissions auto-approve, cwd-scoped → Task 3 (`acceptEdits`) + working dir from Task 9. ✓
- Error handling (claude-not-found, malformed line, crash, abort) → Task 2 (malformed skip), Task 3 (spawn error → Error event, abort → kill), Task 8 (Error bubble). ✓
- Testing: fixture-driven parser, session lifecycle, transcript reducer → Tasks 2, 5, 8. ✓
- Out of scope (TODL wiring, API-key provider, per-action prompts, resume, multi-session, project-cwd binding) → not built; project-cwd noted in Task 9. ✓

**2. Placeholder scan:** No TBD/TODO. Each code step shows complete, final code; each verification names an exact command + expected result. Task 9 Step 1 requires confirming two accessor names (`provider.get`, `CurrentDirectory`) against the codebase rather than assuming — this is a real verification, not a placeholder. Task 10 Step 2 directs checking any rejected `.mu` control/attribute against the two reference resource files rather than inventing markup — also a verification, not a gap.

**3. Type consistency:** `AgentEvent` union + `AgentEventKind` are defined once (Task 1) and consumed unchanged in Tasks 2, 3, 5, 8. `IAgentApi.sendTurn(workingDirectory, text)` is reconciled across Task 1 (signature), Task 6 (`SendTurn` handler two args), Task 7 (preload forward), Task 9 (`agent.sendTurn(this.cwd, text)`). `IAiProvider.start(cwd, onEvent)` / `AiProviderSession.{send,abort,dispose}` are consistent across Tasks 3, 4, 5. `TranscriptReducer.{Transcript, beginUserTurn, apply}` and the three item Models are consistent across Tasks 8, 9, 10.

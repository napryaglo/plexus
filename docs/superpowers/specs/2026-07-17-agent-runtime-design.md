# Plexus Agent Runtime — Design

**Status:** approved design, pre-implementation
**Date:** 2026-07-17
**Scope:** v1 = a provider-agnostic agent *engine* + a *chat panel*. No TODL-specific
wiring — that is a later component that rides this engine.

## Purpose

Embed an agentic loop in Plexus. The eventual job (a later layer) is the TODL
use case: natural-language intent → validated `.todl` edits in the project, viz
updates. This spec builds the general runtime underneath that: a multi-turn
agentic session driven by Claude, surfaced in a chat panel, with tool use
auto-approved inside the current project directory.

## Decisions (the forks that shaped this)

- **Job:** TODL model builder is the north star, but v1 is the *general engine +
  chat*. TODL model-building layers on top later. (Layered, sequenced.)
- **Drive mechanism:** a **provider abstraction** (`IAiProvider`) with a
  registry (`AiProviderService`) holding AI providers, and a concrete provider
  that **wraps the `claude` console CLI** as the sole v1 backend.
- **Billing/auth:** the subscription-only constraint is decisive. The Agent SDK
  and raw API both force per-token `ANTHROPIC_API_KEY` billing (ToS forbids
  routing Free/Pro/Max credentials through them). Only the **non-`--bare`
  `claude -p` CLI**, reading the user's logged-in OAuth, rides the existing
  subscription. This is the personal/single-user lane.
  - *Caveats, accepted:* Anthropic has signalled `--bare` may become the `-p`
    default (bare skips OAuth) — subscription-via-CLI is a lane they may narrow,
    so it may need a flag pin or break on a future update. And the ToS
    restriction targets *distributing* a product that routes *other* users'
    requests through subscription credentials; a personal single-user Plexus is
    not that, but shipping to others on this subscription would be.
  - *Mitigation:* the provider abstraction is the seam. Swapping subscription-CLI
    for an API-key/SDK provider later is a new `IAiProvider` implementation, not
    a rewrite of anything downstream.
- **Placement:** forced by Electron — the runtime lives in the **main process**
  (only it can `spawn` and stream stdout); the renderer consumes it through an
  injected `AgentService` over typed IPC, same seam as `filesystem.ts`.
- **Permissions:** tool use is **auto-approved, scoped to the current project
  directory** (`acceptEdits`-style, cwd-bounded). No per-action prompts in v1;
  UI allow/deny prompts are a later addition.
- **Streaming:** **token-by-token** — `--include-partial-messages`; the parser
  assembles wrapped delta events into a growing assistant bubble.

## Architecture

Three layers matching the existing `filesystem.ts` main↔renderer pattern.

### Main process

- **`IAiProvider`** — the abstraction. Responsibilities: start a session against
  a project directory, accept a user turn, abort, and expose a stream of typed
  domain events. Knows nothing about the CLI. Pure contract.
- **`ClaudeCliProvider`** — the v1 implementation. Spawns one long-lived
  `claude -p --output-format stream-json --input-format stream-json
  --include-partial-messages` with `cwd` = the project dir and permissions
  auto-approved (`acceptEdits`, cwd-scoped). Non-`--bare`, so it rides the
  logged-in subscription. Writes user turns to stdin as stream-json; parses
  stdout JSONL into typed domain events. Owns child-process lifecycle and
  `session_id` capture. The `claude` binary path is a configurable setting
  (PATH lookup by default).
- **`AiProviderService`** — the registry. Holds providers, exposes the active
  one. v1 registers only `ClaudeCliProvider`. The insertion point for an
  API-key/SDK provider later.
- **`AgentSession`** — one conversation bound to the active provider + project.
  Holds `session_id`, status (idle / running / errored), and the transcript.
  v1 = a single live session, in-memory (the captured `session_id` leaves
  resume-across-restart open for later).
- **IPC handlers** — `registerAgentHandlers()`, registered from
  `app.whenReady()` alongside the existing `registerFileSystemHandlers()` etc.

### IPC (`src/shared/agent-api.ts`)

- **Commands** renderer→main via `ipcRenderer.invoke`: start session, send turn,
  abort.
- **Events** main→renderer via `webContents.send` on a push channel. This is
  *new* to Plexus — today all IPC is request/response (`ipcMain.handle`). It is
  a small, contained addition: one event channel, forwarded through the preload
  bridge as a subscribe callback.
- Channel names and event kinds are **real TypeScript enums**, never string
  unions (house rule).

### Renderer

- **`AgentService`** — an injected mural service (like `FileSystemService`).
  Subscribes to the IPC event stream; exposes an observable transcript and
  session state via `INotifyPropertyChanged` / `INotifyCollectionChanged` so
  Mural binding drives the UI directly; exposes `sendTurn(text)` and `abort()`.
- **Chat panel module** — a Plexus module contributing a panel + DataTemplates,
  bound to `AgentService`'s transcript. Renders **through templates only** (house
  rule): an items control over the transcript, item template selected by message
  kind (user / assistant text / tool activity), plus an input box. No hardcoded
  chrome in the renderer.

## Event model

The CLI stream-json (`system` / `assistant` / `user` / `result` lines, plus
`stream_event` partial-message deltas under `--include-partial-messages`) is
parsed inside `ClaudeCliProvider` into a small enum-tagged domain union. The
renderer never sees raw JSONL.

- `SessionStarted { sessionId }` — from the `system:init` line.
- `AssistantText { text }` — a **delta** appended to the current assistant
  bubble (assembled from `content_block_delta` / `text_delta` partial events).
- `ToolUse { id, name, input }`.
- `ToolResult { id, ok, summary }`.
- `TurnComplete { }` — from the `result` line; re-enables input.
- `AgentError { message, kind }`.

## Data flow — one turn

1. User types → `AgentService.sendTurn(text)` → IPC invoke → `AgentSession`
   writes a stream-json user message to the child's stdin.
2. Child emits stdout JSONL → `ClaudeCliProvider` parses line-by-line → typed
   events → `webContents.send` → `AgentService` appends/updates the observable
   transcript → panel re-renders via binding.
3. Tool uses auto-approve (cwd-scoped); tool activity renders as chips as it
   streams.
4. `result` → `TurnComplete` → input re-enabled; `session_id` retained.

## Error handling

Every failure maps to an `AgentError` the panel can surface — never a crash.

- `claude` not found on PATH → error + settings hint (binary path is a setting).
- Auth/subscription failure (from the `result` error / stderr) → "run
  `claude login`" hint.
- Malformed JSONL line → skip + log; keep the stream alive.
- Child crash mid-turn → mark session errored, offer restart.
- Abort → terminate/interrupt the child, reset to idle.

## Testing

- **Provider parser (load-bearing):** capture *real* `claude -p --output-format
  stream-json --include-partial-messages` output once as the canonical fixture
  (not hand-fabricated — sources are canonical, per project rule), feed it to the
  parser, assert the exact typed event sequence including delta assembly.
- **Session lifecycle:** start / turn / abort against a fake in-memory
  `IAiProvider`.
- **Renderer `AgentService`:** feed synthetic IPC events, assert transcript
  observable updates and notifications fire.
- **Chat panel:** template-binding smoke test (transcript → rendered items).

## Unit boundaries

Each unit has one job and is independently testable:

1. Contract + event types (pure types).
2. `ClaudeCliProvider` — spawn + stream-json parse (fixture-tested).
3. `AiProviderService` — registry/selection.
4. `AgentSession` — conversation state over a provider.
5. IPC layer — channel enum + handlers + preload bridge.
6. Renderer `AgentService` — IPC consumer, observable state.
7. Chat panel module — UI bound to `AgentService`.

## Out of scope (v1)

- TODL-specific wiring (agent writes `.todl`, Plexus validates via
  `@pragmatic-lab/todl`, diagnostics fed back as a repair loop) — the next
  component, riding this engine.
- API-key / Agent-SDK providers — a later `IAiProvider` implementation.
- Per-action permission prompts in the UI.
- Session resume across app restart (the `session_id` is captured to enable it).
- Multiple concurrent sessions.

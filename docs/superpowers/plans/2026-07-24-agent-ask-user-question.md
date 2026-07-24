# Agent AskUserQuestion — Implementation Plan

**Goal:** Let the in-app agent pause a turn to ask the user a structured
multiple-choice question (up to 4 questions, single/multi-select, with a free-text
"Other"), rendered as an inline chat card; the user's answer round-trips back to
the model as a real tool result and the turn continues.

**Mechanism (verified):** A first-class **MCP tool** `ask_user_question`, hosted
**in-process in Plexus main** over HTTP, exposed to the `claude` CLI via
`--mcp-config` and auto-approved via `--allowedTools`. When the model calls it,
the request lands in main, which emits a `Question` event to the renderer, blocks
on a Promise, and returns the answer as the tool result once the user submits.

**Verified against CLI 2.1.139:** `-p` + `--input-format stream-json`
+ `--output-format stream-json` supports `--mcp-config <json|file>` (stdio/HTTP/SSE),
`--strict-mcp-config`, and `--allowedTools mcp__<server>__<tool>`. Precedent:
Claude Code's own `--permission-prompt-tool` is the same "route a blocking prompt
to an MCP tool in headless mode" pattern.

> **STATUS (2026-07-24): Task 1 spike PASSED — mechanism proven end to end.**
> The live subscription CLI listed the tool as `mcp__plexus__ask_user_question`
> (in `system:init`.tools), called it with our exact schema, our in-process HTTP
> MCP server received the `Question`, and the CLI accepted the resolved answer as
> the `tool_result` (`result: success`). Shared contract (Task 2), the preload
> `answerQuestion` stub, and the fake-bridge test updates also landed; typecheck
> (node+web) is clean and the 3 server unit tests pass.
>
> **UPDATE (2026-07-24): Tasks 2–10 IMPLEMENTED.** Main side (server + provider
> MCP seam + IPC glue + chip suppression) and renderer side (QuestionCard/QuestionVM/
> OptionVM + reducer case + AgentService `CanInput` gating + the `.mu` card with
> multi-question / multi-select / free-text "Other") are all built, plus agent
> guidance in the scaffold CLAUDE.md. Typecheck (node+web) clean, `compile:mu` +
> full `npm run build` green, 53 agent tests pass (server round-trip, provider args,
> chip suppression, VM select/submit logic, reducer answer round-trip + input gate).
> **Remaining: only the interactive UI eyeball** (`npm run dev` — render the card,
> pick incl. "Other", confirm the agent continues and abort-mid-question recovers).
>
> **Findings that bind the rest of the build:**
> - **`--mcp-config` must be a temp FILE path, not inline JSON.** On Windows the
>   provider spawns with `shell:true` (the `claude.cmd` shim needs it), which
>   mangles an inline-JSON arg. Write `{mcpServers:{plexus:{type:'http',url}}}` to
>   a temp file and pass its path. (Task 4 must do this.)
> - Confirmed flags: `--strict-mcp-config` + `--mcp-config <file>` +
>   `--allowedTools mcp__plexus__ask_user_question` (auto-approve, no prompt).
> - The emit-must-precede-register ordering in the tool handler is real (a fast/sync
>   answer races `pending.set`); fixed and covered.

## Architecture

```
model --tool_use--> claude CLI --http--> AskUserQuestionServer (Plexus MAIN)
                                              │ emit Question{id,questions}  ──► renderer card
                                              │ await pendingAnswers.get(id)
 renderer: user picks ──IPC answerQuestion(id,answers)──► main resolves ─────┘
                                              │ return tool result (JSON answers)
model <--tool_result-- claude CLI <--http-----┘   turn continues
```

The stream ALSO carries this tool's `tool_use`/`tool_result` (assistant/user
lines the parser reads). The card is the rich surface, so the generic tool chip
is suppressed for this one tool name; the card is driven by the `Question` event
and closed by the answer.

## Global constraints (from the repo)

- **Enums, not string-literal unions** — every new mode/kind is a TS `enum`.
- **Tests live in a `tests/` subfolder** next to the source.
- **camelCase raw IPC verbs; PascalCase service wrappers** (mirror existing
  `IAgentApi` / `AgentService`).
- **`.mu` renders through templates** — the card is a `DataTemplate`, no chrome in TS.
- Reuse the existing `RichTextBlock`/theme-token patterns already in agent-chat.

## File map

- Create `src/main/agent/ask-user-question-server.ts` — in-process HTTP MCP host.
- Modify `src/main/agent/ai-provider.ts` — provider takes optional MCP configs.
- Modify `src/main/agent/claude-cli-provider.ts` — add `--mcp-config`/`--allowedTools`.
- Modify `src/main/agent/agent-session.ts` — expose `answer(id, answers)`.
- Modify the main IPC wiring (where `AgentSession` + channels are registered) —
  start the server, route `AnswerQuestion`, feed the server's emit into the push sink.
- Modify `src/shared/agent-api.ts` — `Question` event, `AnswerQuestion` channel,
  `IAgentApi.answerQuestion`, `QuestionRequest`/`QuestionAnswer` types.
- Modify the preload bridge (`window.api.agent`) — add `answerQuestion`.
- Modify `src/main/agent/stream-json-parser.ts` — suppress the ask-tool chip.
- Modify `src/renderer/.../agent-chat/services/transcript.ts` — `QuestionRequest`
  model + reducer case.
- Modify `src/renderer/.../agent-chat/services/agent-service.ts` — `AnswerQuestion`
  command + `IsAwaitingAnswer` state.
- Modify `src/renderer/.../agent-chat/agent-chat.resources.mu` — the card template.
- Add `@modelcontextprotocol/sdk` to Plexus deps (server side of MCP).

---

## Task 1 — Spike: prove the CLI ⇄ in-process HTTP MCP handshake

De-risk first. Before wiring UI, confirm the subscription CLI will connect to an
in-process HTTP MCP server, list the tool, call it, and accept its result.

**Files:** `src/main/agent/ask-user-question-server.ts` (create),
`src/main/agent/tests/ask-user-question-server.test.ts` (create).

**Steps:**
- [ ] Add `@modelcontextprotocol/sdk`. Build a minimal `AskUserQuestionServer`:
  a node `http` server bound to `127.0.0.1:0`, wrapping an MCP `Server` with a
  `StreamableHTTPServerTransport`, exposing one tool `ask_user_question` whose
  handler (for the spike) immediately returns a canned answer.
  - `listen(): Promise<void>` — binds, records the assigned `Url` (`http://127.0.0.1:<port>/mcp`).
  - `Url: string` getter; `close(): Promise<void>`.
- [ ] Unit test: start the server, connect an MCP **client** (`@modelcontextprotocol/sdk`
  client + HTTP transport) to `Url`, `listTools()` → contains `ask_user_question`
  with the expected schema; `callTool()` → returns the canned answer.
- [ ] **Manual probe** (documented in the task, run once): spawn
  `claude -p --input-format stream-json --output-format stream-json --verbose
  --mcp-config '{"mcpServers":{"plexus":{"type":"http","url":"<Url>"}}}'
  --allowedTools mcp__plexus__ask_user_question`, send a user turn that asks it to
  call the tool, and confirm the stream shows a `tool_use` for
  `mcp__plexus__ask_user_question` and a following `tool_result`. Record the exact
  observed tool name + JSON shapes in this plan.

**Gate:** if the CLI won't call the HTTP tool headless, STOP and fall back to the
marker/convention design (Approach B) before proceeding. Everything below assumes
the spike passes.

## Task 2 — Shared contract

**Files:** `src/shared/agent-api.ts` (modify).

- [ ] Add types:
```ts
export interface QuestionOption { label: string; description?: string }
export interface Question {
    question: string
    header: string
    multiSelect: boolean
    options: QuestionOption[]
}
export interface QuestionRequest { id: string; questions: Question[] }
export interface QuestionAnswer  { id: string; answers: Record<string, string[]> }
```
- [ ] `AgentEventKind.Question = 'question'` + `QuestionEvent { Kind; Request: QuestionRequest }`
  added to the `AgentEvent` union.
- [ ] `AgentChannel.AnswerQuestion = 'agent:answer-question'`.
- [ ] `IAgentApi.answerQuestion(answer: QuestionAnswer): Promise<void>`.

**Note:** answers are keyed by `question` text (mirrors the real tool). An "Other"
selection contributes the typed string as one of the array entries.

## Task 3 — Server: emit + block + resolve

**Files:** `ask-user-question-server.ts` (modify), its test (modify).

- [ ] Replace the spike's canned handler: on `ask_user_question(questions)`:
  1. `const id = nextId()` (a monotonic counter — no `Date.now`/`Math.random`).
  2. Validate/normalise `questions` (1–4; each option `{label, description?}`).
  3. `this.sink?.({ Kind: AgentEventKind.Question, Request: { id, questions } })`.
  4. `const answers = await new Promise(res => this.pending.set(id, res))`.
  5. Return `{ content: [{ type: 'text', text: JSON.stringify({ id, answers }) }] }`.
- [ ] API: `setSink(emit: (e: AgentEvent) => void)`, `resolve(answer: QuestionAnswer)`
  (looks up `pending`, resolves with `answer.answers`, deletes), and reject-all on
  `close()`/session dispose (so a torn-down turn doesn't hang the CLI).
- [ ] Test: `setSink` captures a `Question` event when the tool is called; calling
  `resolve` unblocks the tool handler and its result carries the answers; disposing
  with a pending question rejects it.

## Task 4 — Provider wiring (generic MCP seam)

**Files:** `ai-provider.ts`, `claude-cli-provider.ts` (+ tests).

- [ ] Extend the provider seam generically (keep it unaware of "questions"):
  `IAiProvider.start(..., opts?: { mcpServers?: Record<string, McpServerConfig>; allowedTools?: string[] })`
  — or a `ClaudeCliProvider` ctor param. `McpServerConfig = { type: 'http'; url: string }`.
- [ ] In `ClaudeCliProvider.start`, when `mcpServers` present, append
  `--mcp-config <json>` and `--allowedTools <names...>` to `CLI_ARGS`. Keep the
  existing flags. Args stay a fixed list + injected values; user text still only
  goes over stdin.
- [ ] Test (extend `claude-cli-provider.test.ts` with the injected `spawnFn`):
  assert the spawned args include `--mcp-config` with the URL and
  `--allowedTools mcp__plexus__ask_user_question`.

## Task 5 — Main IPC + session glue

**Files:** `agent-session.ts`, the main agent IPC registration module, preload bridge.

- [ ] Start one `AskUserQuestionServer` at main agent bootstrap; `await listen()`.
- [ ] When constructing the provider session, pass
  `{ mcpServers: { plexus: { type: 'http', url: server.Url } }, allowedTools: ['mcp__plexus__ask_user_question'] }`.
- [ ] Wire `server.setSink(emit)` to the SAME `emit` that pushes on
  `AgentChannel.Event` — so `Question` rides the existing push channel.
- [ ] `AgentSession.answer(answer)` → `server.resolve(answer)`.
- [ ] Register `AgentChannel.AnswerQuestion` (`ipcMain.handle`) → `session.answer(...)`.
- [ ] Preload: add `answerQuestion(answer) => ipcRenderer.invoke(AnswerQuestion, answer)`
  to `window.api.agent`.
- [ ] On session dispose/abort, `server.close()` (or reject-pending) so a killed
  turn never leaves the CLI awaiting.

## Task 6 — Suppress the tool chip for this tool

**Files:** `stream-json-parser.ts` (+ test).

- [ ] In the `assistant` tool_use and `user` tool_result cases, skip emitting
  `ToolUse`/`ToolResult` when the tool name is `mcp__plexus__ask_user_question`
  (the card is the surface). Keep a shared const for the name.
- [ ] Test: an `assistant` line whose tool_use is the ask tool yields no `ToolUse`
  event; a normal tool still does.

## Task 7 — Renderer transcript model

**Files:** `transcript.ts` (+ test).

- [ ] `QuestionRequestModel extends Model` holding the `QuestionRequest` (Id +
  Questions) and mutable selection state: per-question chosen labels, an `Other`
  text per question, and an `IsAnswered` flag. Expose `SelectOption(q, label)`,
  `SetOther(q, text)`, `IsSubmittable`, and `BuildAnswer(): QuestionAnswer`.
  - Render questions/options as child Models (`QuestionVM`, `OptionVM`) so the
    card binds them via `ItemsControl` — mirrors the existing transcript Model
    pattern. Selection is DP-backed (view-observable), per the MVVM rule.
- [ ] Reducer: on `AgentEventKind.Question`, add a `QuestionRequestModel` to the
  transcript; keep it in a `pendingQuestions` map by id. A new turn does NOT clear
  a pending question. Mark `IsAnswered` when the answer is submitted.
- [ ] Test: `Question` event adds a `QuestionRequestModel` with the right
  questions/options; `BuildAnswer` returns labels keyed by question text; an
  "Other" entry carries the typed string; multi-select accumulates.

## Task 8 — AgentService: submit + awaiting state

**Files:** `agent-service.ts` (+ test/datacontext test).

- [ ] `AnswerCommandKey` (`RelayCommand<QuestionRequestModel>`): on submit, call
  `api.agent.answerQuestion(model.BuildAnswer())`, set `model.IsAnswered = true`,
  drop it from `pendingQuestions`.
- [ ] `IsAwaitingAnswerKey` (bool) true while any question is pending; the input
  row binds it to disable send + show a "waiting for your answer…" Status.
- [ ] Single-select fires the answer immediately on option click (one question) /
  updates selection (multi-question card) — the card decides; the service just
  exposes `SelectOption`/`Submit` commands.

## Task 9 — The card template

**Files:** `agent-chat.resources.mu` (modify), `package.json` compile list if needed.

- [ ] `DataTemplate [ DataType = QuestionRequestModel ]`: a bordered card
  (`@OutlineVariant`, `@SurfaceContainer` bg, rounded) containing an `ItemsControl`
  over `$Questions`. Each question: the header chip (reuse the code-chip look:
  small tinted `Border`, theme tokens via DynamicResource), the question text
  (`RichTextBlock`/`TextBlock`), then an `ItemsControl` of option buttons:
  - single-select → a `Button` per option that fires `SelectOption` (and, if the
    card is single-question, submits);
  - multi-select → a toggle per option;
  - an auto-appended **"Other"** row: a toggle that reveals a `TextBox` bound to
    the question's `Other` text.
  - a **Submit** button (multi-question / multi-select), bound to `AnswerCommand`,
    enabled by `IsSubmittable`.
- [ ] After `IsAnswered`, collapse to a compact read-only summary of the chosen
  labels (a Style trigger on `IsAnswered` swaps the template body).
- [ ] `npm run compile:mu` emits the new `.mu.js`; fix the compile list if the
  file isn't already enumerated.

## Task 10 — Agent guidance + end-to-end

**Files:** the meta-model scaffold `CLAUDE.md` (and/or a general agent note), manual test.

- [ ] Add a short note to the scaffolded `CLAUDE.md` (and the meta-model guide):
  the agent may call `ask_user_question` to offer the user a choice when a decision
  is genuinely theirs; prefer it over guessing. (The tool self-advertises via MCP;
  this is about *when* to use it.)
- [ ] Manual end-to-end in `npm run dev`: ask the agent something ambiguous, confirm
  the card renders, pick answers (incl. "Other"), confirm the agent continues with
  the choice. Confirm abort/close mid-question doesn't hang.
- [ ] `npm run typecheck` + `npm run build` clean; renderer + main tests green.

## Open risks / notes

- **MCP HTTP session semantics.** Streamable HTTP MCP uses session ids + SSE; the
  SDK handles it, but the spike (Task 1) must confirm the CLI keeps the `tools/call`
  open across our `await` (it should — that's how blocking tools work). If the CLI
  times out long-blocking tool calls, add a keep-alive or fall back to stdio MCP.
- **One server, one session (v1).** The `pending` map is keyed by id, so it already
  tolerates >1 concurrent question, but v1 assumes a single active provider session.
- **No `Date.now`/`Math.random`** in the server for ids — use a monotonic counter.
- **Fallback ready.** If Task 1 fails, the marker/convention design (Approach B)
  reuses Tasks 2/7/8/9 (event, model, service, card) unchanged; only the transport
  (Tasks 1/3/4/5/6) swaps to parse-a-fenced-block + answer-as-user-turn.

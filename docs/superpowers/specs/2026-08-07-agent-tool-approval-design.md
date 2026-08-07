# Agent Tool Approval — Design

**Date:** 2026-08-07
**Status:** Approved, ready for planning
**Repo:** Plexus only (no TODL change)

## Problem

The in-app agent chat wraps the `claude` CLI headless
(`claude -p --output-format stream-json --input-format stream-json`) with
`--permission-mode acceptEdits` and a static `--allowedTools` list of the four
Plexus MCP tools. File edits auto-approve, but any other consequential tool —
notably **Bash** (e.g. running `python`) — needs permission, and there is **no
channel to surface a permission prompt** in the UI. Those calls fail or hang.
The agent cannot ask "may I use this tool?".

## Goal

Let the agent request tool-use approval in the chat: a card shows the tool and
its command, the user approves once / always-allows a command family / denies,
and a 10-second countdown auto-approves once if the user is away. Approvals are
remembered for the session and, on "always allow", persisted per-project.

## Mechanism

The CLI's headless permission hook, `--permission-prompt-tool
mcp__plexus__approve_tool`, is the designated approval channel. When a tool needs
permission (not auto-allowed by the mode, not in `--allowedTools`), the CLI calls
that MCP tool and waits (up to `MCP_TIMEOUT`, default 30s) for a verdict. Plexus
already runs an in-process MCP server and already round-trips `ask_user_question`
(pending-map → event → renderer card → IPC answer → unblock). Tool approval
reuses that exact pattern.

**Confirmed contract (from Claude Code docs):**
- `--permission-prompt-tool <mcp_tool>` works only in `-p` mode; value is the
  fully-qualified `mcp__<server>__<tool>` name.
- `--allowedTools` entries **skip** the prompt tool (auto-approved).
- Under `acceptEdits`, edits auto-approve; other tools (incl. Bash) fall through
  to the prompt tool.
- The tool returns `{"behavior":"allow"}` or `{"behavior":"deny"}`.

**Undocumented (must verify empirically — see §Schema spike):** the exact input
field names the CLI passes (expected `tool_name`, `input`, `tool_use_id`) and
whether `allow` accepts an `updatedInput`. We implement defensively and confirm
against the real CLI before building the UI.

## Architecture

All changes are in `Plexus/src/`.

### Schema spike (de-risk first)

Because the CLI→tool input schema is undocumented, the first increment wires a
**minimal `approve_tool`** that unconditionally allows and logs the raw arguments
it receives, spawns the real agent once against a task that triggers a Bash call,
and reads the logged shape. The observed field names (`tool_name` vs `toolName`,
`input` nesting, `tool_use_id` presence) become the parsing contract for the rest
of the work. This replaces guessing with evidence.

### Provider / spawn (`src/main/agent/claude-cli-provider.ts`, `src/main/agent.ts`)

- Add `--permission-prompt-tool mcp__plexus__approve_tool` to the spawn args.
- Keep `--permission-mode acceptEdits`.
- Expand the static `--allowedTools` (in `agent.ts`) to also include the
  read-only built-ins **Read, Glob, Grep, LS** so they never prompt. The four
  Plexus MCP tools stay allow-listed. Everything else (Bash, WebFetch, Write
  outside edits, …) routes to `approve_tool`.

### `approve_tool` (`src/main/agent/plexus-mcp-server.ts`)

Registered on the existing in-process MCP server as the permission-prompt tool.
On each call with `{ tool_name, input }`:

1. Derive the **rule key** (see §Rule model).
2. **Allow-list check** — if a session or persistent rule matches, return
   `{"behavior":"allow","updatedInput": <echoed input>}` immediately; no prompt,
   no card.
3. Miss → create a pending entry (promise + resolver keyed by id, mirroring
   `ask()`), emit `AgentEventKind.ToolApproval` to the renderer, and block on the
   promise.
4. Resolve on the user's (or timeout's) answer:
   - `allow-once` / timeout → `{"behavior":"allow","updatedInput": input}`.
   - `allow-always` → add the rule to session + persistent lists, then allow.
   - `deny` → `{"behavior":"deny","message":"Denied by user."}`.

**Server safety fallback:** if no answer arrives within ~25s (< the CLI's 30s
`MCP_TIMEOUT`) — e.g. the chat window was closed — the pending entry resolves to
allow-once so the CLI never hangs. `resolveAnswer` is first-wins (idempotent), so
the renderer's 10s auto-submit and this fallback cannot double-resolve.

### Rule model + store (`src/main/agent/tool-approval-rules.ts`, new)

- A rule is `{ tool: string; prefix?: string }`.
- **Prefix derivation:** for `Bash`, `prefix` = the leading command family of
  `input.command` — the first shell token, lowercased (e.g. `python foo.py` →
  `python`; `npm run test` → `npm`). For other tools, no prefix (rule is the
  tool name alone).
- **Match:** candidate `{tool, command?}` matches rule `r` iff `r.tool === tool`
  AND (`r.prefix` is undefined OR the candidate's command starts with
  `r.prefix` at a token boundary).
- **Session list:** in-memory in the MCP server, cleared on session dispose.
- **Persistent list:** a JSON file in Electron `userData`
  (`agent-approvals.json`), a map `{ [projectKey]: Rule[] }` keyed by the
  session's working directory (per-project scope). Loaded on session start,
  written on each `allow-always`. Non-invasive (nothing written into the user's
  project tree).

### Shared contract (`src/shared/agent-api.ts`, `src/preload/index.ts`)

- New `AgentEventKind.ToolApproval` with payload
  `{ id: string; toolName: string; command?: string; prefix?: string }`.
- New IPC channel `AgentChannel.AnswerToolApproval`; renderer→main
  `answerToolApproval(id, decision)` where `decision ∈
  { AllowOnce, AllowAlways, Deny }` (a real enum).
- New IPC/query to read + revoke persistent rules for the settings surface:
  `listApprovalRules()` / `revokeApprovalRule(rule)`.

### Renderer — approval card (`.../agent-chat/services/approval-card.ts` new,
`transcript.ts`, `agent-service.ts`, `agent-chat.resources.mu`)

- `ToolApprovalCard` model, built by the transcript reducer on the
  `ToolApproval` event (mirrors the `Question` case): shows tool name + command;
  three commands — **ApproveOnce**, **AllowAlways** (label includes the prefix,
  e.g. "Always allow `python`"), **Deny**; and a bound **countdown** (0..1
  progress + seconds-remaining) shown as a progress control to the **right of the
  button row**.
- **Countdown:** the card starts a 10s timer on creation, updates the bound
  progress each tick, and on expiry auto-submits `AllowOnce`. Any command click
  cancels the timer and submits that decision. After answered, the card renders a
  one-line recap (like the question card) and unblocks input.
- **Input gating:** reuse the existing pending-set / `CanInput` mechanism so the
  composer is disabled while an approval is pending.

### Settings surface

A small panel listing the persistent rules (tool + prefix) for the current
project with a **Revoke** action per row, backed by
`listApprovalRules()`/`revokeApprovalRule()`. Placement follows the app's
existing settings/panel conventions.

## Data flow (the `python` case)

```
CLI wants Bash "python foo.py" (not allow-listed, not an edit)
  └─► calls mcp__plexus__approve_tool { tool_name:"Bash", input:{command:"python foo.py"} }
        │  approve_tool derives prefix "python"; checks session+persistent lists → MISS
        │  emits ToolApproval { id, toolName:"Bash", command:"python foo.py", prefix:"python" }
        │  blocks on pending[id]
        ▼
   renderer card: tool+command, [Approve once][Always allow python][Deny] + 10s countdown ring
        │  user clicks "Always allow python"  (or 10s elapses → AllowOnce)
        ▼
   IPC answerToolApproval(id, AllowAlways)
        │  server adds rule {tool:"Bash", prefix:"python"} to session + persistent(userData, per project)
        ▼
   approve_tool returns { behavior:"allow", updatedInput:{command:"python foo.py"} }
  ◄─┘  CLI runs python. Next "python bar.py" → rule HIT → allowed with no card.
```

## Testing

- **Rule model** (`tool-approval-rules.ts`): prefix derivation (`python foo.py`
  → `python`; quoted/leading-space commands; non-Bash → no prefix); match
  semantics (token-boundary prefix, tool mismatch, prefix-less rule matches any
  command of that tool); persistent-store round-trip (write rule → reload →
  present; revoke → absent), keyed by project.
- **`approve_tool`** (server): list-hit returns allow **without** emitting an
  event; miss emits `ToolApproval` and blocks; `allow-once`/`allow-always`/`deny`
  produce the right `behavior` JSON; `allow-always` persists a rule; safety
  fallback resolves allow when no answer arrives.
- **Reducer**: `ToolApproval` event creates a `ToolApprovalCard`, blocks input;
  answering unblocks and records the recap.
- **Card VM**: countdown ticks and auto-submits `AllowOnce` at zero; a click
  cancels the timer and submits that decision; `AllowAlways` label carries the
  prefix.
- **Schema spike**: not a permanent test — a throwaway verification whose
  finding is folded into the parser and then removed.

## Decisions (settled)

- **Approval memory:** session + persistent, with a settings surface to
  review/revoke.
- **Rule grain:** tool + command prefix (Bash by command family; other tools by
  name).
- **Timeout:** 10s → auto **Approve once** (never persists). Renderer owns the
  countdown + progress control; server has a ~25s safety net.
- **Persistent scope:** per-project (keyed by working directory), stored in
  Electron `userData` (not in the project tree).
- **Auto-allow:** read-only built-ins (Read/Glob/Grep/LS) + the four Plexus MCP
  tools + `acceptEdits` for edits; everything else prompts.
- **Deny:** returns a deny verdict with a short message; the agent continues and
  is told no. No abort.

## Out of scope

- Per-argument / regex rule patterns beyond a leading command prefix.
- A global (cross-project) allow-list.
- Modifying tool input on approval (`updatedInput` is echoed, not edited).
- Approval for MCP tools flagged `requiresUserInteraction` (the CLI converts
  allow→deny for those; not supported via this hook).

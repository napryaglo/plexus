# Agent Tool Approval — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let the agent chat surface a tool-approval card (Approve once / Always allow `<prefix>` / Deny) with a 10s auto-approve countdown, backed by a session + per-project persistent allow-list, so consequential tools like Bash (running python) no longer fail for lack of a permission channel.

**Architecture:** Add `--permission-prompt-tool mcp__plexus__approve_tool` to the headless CLI spawn and register `approve_tool` on the existing in-process `PlexusMcpServer`. It reuses the proven `ask_user_question` round-trip: allow-list check → (miss) emit a `ToolApproval` event → block → resolve to an allow/deny verdict JSON. Rules are `{tool, prefix?}`; the renderer card mirrors `QuestionCard` and owns the countdown.

**Tech Stack:** TypeScript (ESM, strict), Electron (main/preload/renderer), `@modelcontextprotocol/sdk` + `zod` (MCP server), `@pragmatic-lab/mural` (renderer UI + `ProgressIndicator`), Vitest.

## Global Constraints

- Plexus only; no TODL change. `@pragmatic-lab/todl` floor unchanged.
- Use real enums, never string-literal unions. Every renderer view-bound property is a registered mural DP (`Model.RegisterProperty`), read via `get_property_value`.
- Every test file lives in a `tests/` subfolder next to its source.
- No relative `../src` imports into framework packages.
- `--permission-prompt-tool` value is the fully-qualified `mcp__plexus__approve_tool`; it works only in `-p` mode (already in use). `--allowedTools` entries skip the prompt tool.
- The permission tool must return content `[{type:'text', text: JSON.stringify(verdict)}]` where `verdict` is `{behavior:'allow', updatedInput}` or `{behavior:'deny', message}`.
- Timeout = 10s → auto **Approve once** (never persists). Renderer owns the countdown; server safety net ~25s (< the CLI's 30s `MCP_TIMEOUT`).
- Persistent scope = per-project (keyed by working directory), stored in Electron `userData/agent-approvals.json` (never in the project tree).
- Commit per task on branch `feat/agent-tool-approval`; do not push/merge until the finishing gate.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

**Schema note (undocumented wire format):** the exact field names the CLI passes to the permission tool are not public. The `approve_tool` input is parsed **tolerantly** (accept `tool_name` or `toolName`; `input` or `tool_input`; optional `tool_use_id`), and on first call logs the raw arguments once (`console.error('[approve_tool] raw args:', JSON.stringify(args))`) so the real shape is confirmed from a dev run. This replaces a hard spike dependency with defensive parsing + a one-time log.

---

### Task 1: Shared contract + rule model + persistent store

**Files:**
- Modify: `src/shared/agent-api.ts` (event kind, channel, payloads, enum, IAgentApi verbs)
- Create: `src/main/agent/tool-approval-rules.ts`
- Create: `src/main/agent/tests/tool-approval-rules.test.ts`

**Interfaces:**
- Produces:
  - `AgentEventKind.ToolApproval`; `AgentChannel.AnswerToolApproval`, `AgentChannel.ListApprovalRules`, `AgentChannel.RevokeApprovalRule`.
  - `enum ToolApprovalDecision { AllowOnce, AllowAlways, Deny }`.
  - `interface ToolApprovalRequest { id: string; toolName: string; command?: string; prefix?: string }`, `ToolApprovalEvent`, `ToolApprovalAnswer { id: string; decision: ToolApprovalDecision }`.
  - `interface ApprovalRule { tool: string; prefix?: string }`.
  - `tool-approval-rules.ts`: `derivePrefix(toolName, input): string | undefined`, `ruleFor(toolName, input): ApprovalRule`, `matches(rule, toolName, input): boolean`, and a `RuleStore` class over a JSON file.

- [ ] **Step 1: Extend the shared contract**

In `src/shared/agent-api.ts`:
- Add to `AgentChannel`: `AnswerToolApproval = 'agent:answer-tool-approval'`, `ListApprovalRules = 'agent:list-approval-rules'`, `RevokeApprovalRule = 'agent:revoke-approval-rule'`.
- Add to `AgentEventKind`: `ToolApproval = 'tool-approval'`.
- Add the qualified tool name next to the others:
  ```ts
  export const APPROVE_TOOL_NAME = 'approve_tool'
  export const APPROVE_TOOL_QUALIFIED = `mcp__${MCP_SERVER_KEY}__${APPROVE_TOOL_NAME}`
  ```
- Add payloads + enum:
  ```ts
  export enum ToolApprovalDecision { AllowOnce = 'allow-once', AllowAlways = 'allow-always', Deny = 'deny' }
  export interface ApprovalRule { tool: string; prefix?: string }
  export interface ToolApprovalRequest { id: string; toolName: string; command?: string; prefix?: string }
  export interface ToolApprovalAnswer { id: string; decision: ToolApprovalDecision }
  export interface ToolApprovalEvent { Kind: AgentEventKind.ToolApproval; Request: ToolApprovalRequest }
  ```
- Add `ToolApprovalEvent` to the `AgentEvent` union.
- Add to `IAgentApi`:
  ```ts
  answerToolApproval(answer: ToolApprovalAnswer): Promise<void>;
  listApprovalRules(projectKey: string): Promise<ApprovalRule[]>;
  revokeApprovalRule(projectKey: string, rule: ApprovalRule): Promise<void>;
  ```

- [ ] **Step 2: Write the failing rule-model tests**

Create `src/main/agent/tests/tool-approval-rules.test.ts`:
```ts
import { test, expect } from 'vitest'
import { derivePrefix, ruleFor, matches, RuleStore } from '../tool-approval-rules.js'
import type { ApprovalRule } from '../../../shared/agent-api.js'

test('derivePrefix takes the leading command token for Bash, lowercased', () => {
    expect(derivePrefix('Bash', { command: 'python foo.py' })).toBe('python')
    expect(derivePrefix('Bash', { command: '  NPM run test ' })).toBe('npm')
    expect(derivePrefix('Bash', { command: 'python3 -m venv .v' })).toBe('python3')
})

test('derivePrefix is undefined for non-Bash tools and empty commands', () => {
    expect(derivePrefix('WebFetch', { url: 'https://x' })).toBeUndefined()
    expect(derivePrefix('Bash', {})).toBeUndefined()
    expect(derivePrefix('Bash', { command: '' })).toBeUndefined()
})

test('ruleFor yields tool+prefix for Bash, tool-only otherwise', () => {
    expect(ruleFor('Bash', { command: 'python foo.py' })).toEqual({ tool: 'Bash', prefix: 'python' })
    expect(ruleFor('WebFetch', { url: 'x' })).toEqual({ tool: 'WebFetch' })
})

test('matches respects tool identity and token-boundary prefix', () => {
    const bashPython: ApprovalRule = { tool: 'Bash', prefix: 'python' }
    expect(matches(bashPython, 'Bash', { command: 'python bar.py' })).toBe(true)
    expect(matches(bashPython, 'Bash', { command: 'pythonic thing' })).toBe(false) // token boundary
    expect(matches(bashPython, 'Bash', { command: 'node x' })).toBe(false)
    expect(matches(bashPython, 'WebFetch', { url: 'x' })).toBe(false)
    const anyWeb: ApprovalRule = { tool: 'WebFetch' }
    expect(matches(anyWeb, 'WebFetch', { url: 'anything' })).toBe(true) // prefix-less matches all
})

test('RuleStore round-trips rules per project and revokes them', () => {
    const io = new Map<string, string>()
    const store = new RuleStore({ read: (p) => io.get(p), write: (p, s) => { io.set(p, s) } }, 'file.json')
    expect(store.list('/proj/a')).toEqual([])
    store.add('/proj/a', { tool: 'Bash', prefix: 'python' })
    store.add('/proj/a', { tool: 'WebFetch' })
    store.add('/proj/b', { tool: 'Bash', prefix: 'npm' })
    expect(store.list('/proj/a')).toEqual([{ tool: 'Bash', prefix: 'python' }, { tool: 'WebFetch' }])
    // reload from the same backing store sees persisted rules
    const store2 = new RuleStore({ read: (p) => io.get(p), write: (p, s) => { io.set(p, s) } }, 'file.json')
    expect(store2.list('/proj/a').length).toBe(2)
    store2.remove('/proj/a', { tool: 'WebFetch' })
    expect(store2.list('/proj/a')).toEqual([{ tool: 'Bash', prefix: 'python' }])
    // adding a duplicate is a no-op
    store2.add('/proj/a', { tool: 'Bash', prefix: 'python' })
    expect(store2.list('/proj/a').length).toBe(1)
})
```

- [ ] **Step 3: Run to verify the tests fail**

Run: `cd Plexus && npx vitest run src/main/agent/tests/tool-approval-rules.test.ts`
Expected: FAIL — module not found / exports missing.

- [ ] **Step 4: Implement `tool-approval-rules.ts`**

Create `src/main/agent/tool-approval-rules.ts`:
```ts
// Pure rule model + a small persistent store for agent tool-approval decisions.
// A rule is { tool, prefix? }: prefix (Bash only) is the leading command family,
// so "always allow python" grants `python …`, not all shell access. The store is
// a JSON map { [projectKey]: ApprovalRule[] } behind an injectable IO seam (no
// direct fs here — the caller wires Electron userData in).
import type { ApprovalRule } from '../../shared/agent-api.js'

// The first shell token of a Bash command, lowercased; undefined for non-Bash or
// an empty command. `input` is the tool's raw input object.
export function derivePrefix(toolName: string, input: unknown): string | undefined
{
    if (toolName !== 'Bash') return undefined
    const command = (input as { command?: unknown } | null)?.command
    if (typeof command !== 'string') return undefined
    const first = command.trim().split(/\s+/)[0]
    return first !== undefined && first.length > 0 ? first.toLowerCase() : undefined
}

export function ruleFor(toolName: string, input: unknown): ApprovalRule
{
    const prefix = derivePrefix(toolName, input)
    return prefix === undefined ? { tool: toolName } : { tool: toolName, prefix }
}

// True when `rule` authorises using `toolName` with `input`. A prefix-less rule
// matches any input of that tool; a prefixed rule matches when the command's
// first token equals the prefix (token boundary — "python" ≠ "pythonic").
export function matches(rule: ApprovalRule, toolName: string, input: unknown): boolean
{
    if (rule.tool !== toolName) return false
    if (rule.prefix === undefined) return true
    return derivePrefix(toolName, input) === rule.prefix
}

function sameRule(a: ApprovalRule, b: ApprovalRule): boolean
{
    return a.tool === b.tool && (a.prefix ?? '') === (b.prefix ?? '')
}

// Minimal synchronous file IO seam so the store is unit-testable without fs.
export interface RuleIo { read(path: string): string | undefined; write(path: string, contents: string): void }

// Persistent per-project allow-list. Loads the whole map on construction; each
// mutation rewrites the file. Keys are opaque project identifiers (the agent
// working directory).
export class RuleStore
{
    private readonly map: Record<string, ApprovalRule[]>

    constructor(private readonly io: RuleIo, private readonly path: string)
    {
        const raw = io.read(path)
        let parsed: Record<string, ApprovalRule[]> = {}
        if (raw !== undefined) { try { parsed = JSON.parse(raw) as Record<string, ApprovalRule[]> } catch { parsed = {} } }
        this.map = parsed
    }

    public list(projectKey: string): ApprovalRule[] { return [...(this.map[projectKey] ?? [])] }

    public add(projectKey: string, rule: ApprovalRule): void
    {
        const rules = this.map[projectKey] ?? []
        if (rules.some((r) => sameRule(r, rule))) return
        this.map[projectKey] = [...rules, rule]
        this.flush()
    }

    public remove(projectKey: string, rule: ApprovalRule): void
    {
        const rules = this.map[projectKey]
        if (rules === undefined) return
        this.map[projectKey] = rules.filter((r) => !sameRule(r, rule))
        this.flush()
    }

    public matches(projectKey: string, toolName: string, input: unknown): boolean
    {
        return (this.map[projectKey] ?? []).some((r) => matches(r, toolName, input))
    }

    private flush(): void { this.io.write(this.path, JSON.stringify(this.map, null, 2)) }
}
```

- [ ] **Step 5: Run to verify the tests pass**

Run: `cd Plexus && npx vitest run src/main/agent/tests/tool-approval-rules.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
cd Plexus && git add src/shared/agent-api.ts src/main/agent/tool-approval-rules.ts src/main/agent/tests/tool-approval-rules.test.ts
git commit -m "feat(agent): tool-approval contract + rule model + persistent store

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `approve_tool` on the MCP server + spawn flag + wiring

**Files:**
- Modify: `src/main/agent/ai-provider.ts` (McpOptions gains `permissionPromptTool`)
- Modify: `src/main/agent/claude-cli-provider.ts` (emit `--permission-prompt-tool`)
- Modify: `src/main/agent/plexus-mcp-server.ts` (register `approve_tool`, pending map, `ask`-style block, verdict, session+persistent lists, resolver, safety timeout)
- Modify: `src/main/agent.ts` (allow-list read-only built-ins, set `permissionPromptTool`, IPC handlers, inject RuleStore)
- Modify: `src/main/agent/tests/plexus-mcp-server.test.ts` (or create if absent)

**Interfaces:**
- Consumes: Task 1's `ruleFor`/`matches`/`RuleStore`, the shared enums/payloads.
- Produces: a working permission channel — the CLI's approval requests resolve to allow/deny; `allow-always` persists a rule.

- [ ] **Step 1: Add `permissionPromptTool` to McpOptions**

In `ai-provider.ts` `McpOptions`, add:
```ts
    // The fully-qualified MCP tool the headless CLI calls to approve tool use
    // (`mcp__plexus__approve_tool`). Emitted as --permission-prompt-tool.
    permissionPromptTool?: string;
```

- [ ] **Step 2: Emit the flag in the provider**

In `claude-cli-provider.ts` `mcpArgs()`, after the `appendPrompt` line, add:
```ts
        const promptTool = this.mcp.permissionPromptTool !== undefined
            ? ['--permission-prompt-tool', this.mcp.permissionPromptTool] : []
```
and include `...promptTool` in the returned array.

- [ ] **Step 3: Write failing server tests**

In `src/main/agent/tests/plexus-mcp-server.test.ts`, add tests that drive the new public methods directly (mirroring how `ask` is exercised — via the sink + resolver, no HTTP):
```ts
import { test, expect } from 'vitest'
import { PlexusMcpServer } from '../plexus-mcp-server.js'
import { AgentEventKind, ToolApprovalDecision, type AgentEvent } from '../../../shared/agent-api.js'
import { RuleStore } from '../tool-approval-rules.js'

function memStore(): RuleStore {
    const io = new Map<string, string>()
    return new RuleStore({ read: (p) => io.get(p), write: (p, s) => { io.set(p, s) } }, 'x.json')
}

test('requestApproval on a list MISS emits a ToolApproval event and blocks until answered', async () => {
    const events: AgentEvent[] = []
    const server = new PlexusMcpServer()
    server.setSink((e) => events.push(e))
    server.setRuleStore(memStore(), '/proj')
    const p = server.requestApproval('Bash', { command: 'python foo.py' })
    const evt = events.find((e) => e.Kind === AgentEventKind.ToolApproval)
    expect(evt).toBeDefined()
    const id = (evt as { Request: { id: string; prefix?: string } }).Request.id
    expect((evt as { Request: { prefix?: string } }).Request.prefix).toBe('python')
    server.resolveApproval({ id, decision: ToolApprovalDecision.AllowOnce })
    expect(await p).toEqual({ behavior: 'allow', updatedInput: { command: 'python foo.py' } })
})

test('a persisted-rule HIT allows immediately without emitting an event', async () => {
    const events: AgentEvent[] = []
    const store = memStore()
    store.add('/proj', { tool: 'Bash', prefix: 'python' })
    const server = new PlexusMcpServer()
    server.setSink((e) => events.push(e))
    server.setRuleStore(store, '/proj')
    const result = await server.requestApproval('Bash', { command: 'python bar.py' })
    expect(result).toEqual({ behavior: 'allow', updatedInput: { command: 'python bar.py' } })
    expect(events.some((e) => e.Kind === AgentEventKind.ToolApproval)).toBe(false)
})

test('allow-always persists a rule; a later matching call is auto-allowed', async () => {
    const store = memStore()
    const server = new PlexusMcpServer()
    server.setSink(() => {})
    server.setRuleStore(store, '/proj')
    const p = server.requestApproval('Bash', { command: 'python a.py' })
    // find the pending id via the store-independent seq: resolve the only pending one
    server.resolveApproval({ id: server.LastApprovalId, decision: ToolApprovalDecision.AllowAlways })
    await p
    expect(store.list('/proj')).toEqual([{ tool: 'Bash', prefix: 'python' }])
})

test('deny returns a deny verdict', async () => {
    const server = new PlexusMcpServer()
    server.setSink(() => {})
    server.setRuleStore(memStore(), '/proj')
    const p = server.requestApproval('Bash', { command: 'rm -rf /' })
    server.resolveApproval({ id: server.LastApprovalId, decision: ToolApprovalDecision.Deny })
    expect(await p).toEqual({ behavior: 'deny', message: 'Denied by the user in Plexus.' })
})
```

- [ ] **Step 4: Run to verify they fail**

Run: `cd Plexus && npx vitest run src/main/agent/tests/plexus-mcp-server.test.ts`
Expected: FAIL — `requestApproval`/`resolveApproval`/`setRuleStore`/`LastApprovalId` not present.

- [ ] **Step 5: Implement the approval path on `PlexusMcpServer`**

In `plexus-mcp-server.ts`:
- Import the rule helpers + new types:
  ```ts
  import { ruleFor, matches, type RuleStore } from './tool-approval-rules.js'
  import { APPROVE_TOOL_NAME, ToolApprovalDecision, type ApprovalRule, type ToolApprovalAnswer } from '../../shared/agent-api.js'
  ```
  (extend the existing shared import.)
- Add fields:
  ```ts
  private readonly pendingApprovals = new Map<string, (verdict: ApprovalVerdict) => void>()
  private readonly sessionRules: ApprovalRule[] = []
  private ruleStore: RuleStore | undefined
  private projectKey = ''
  public LastApprovalId = ''   // test aid: id of the most recent pending approval
  ```
  and a local type near the top of the file:
  ```ts
  interface ApprovalVerdict { behavior: 'allow'; updatedInput: unknown } // | deny
  type Verdict = { behavior: 'allow'; updatedInput: unknown } | { behavior: 'deny'; message: string }
  ```
  (Use `Verdict` as the resolver/return type; drop the placeholder `ApprovalVerdict` — keep one union type `Verdict`.)
- Add wiring + resolver + the blocking request:
  ```ts
  public setRuleStore(store: RuleStore, projectKey: string): void { this.ruleStore = store; this.projectKey = projectKey }

  public resolveApproval(answer: ToolApprovalAnswer): void
  {
      const done = this.pendingApprovals.get(answer.id)
      if (done === undefined) return
      this.pendingApprovals.delete(answer.id)
      if (answer.decision === ToolApprovalDecision.Deny) { done({ behavior: 'deny', message: 'Denied by the user in Plexus.' }); return }
      // recorded on request; allow-always persists (see requestApproval closure)
      this.onApprovalDecision?.(answer.id, answer.decision)
      done(this.allowVerdictFor(answer.id))
  }
  ```
  Because the verdict needs the original input, keep the input in the pending closure instead of a side map. Replace the sketch above with a single closure per request:
  ```ts
  public requestApproval(toolName: string, input: unknown): Promise<Verdict>
  {
      // 1. Allow-list check (session first, then persistent) — no card on a hit.
      if (this.sessionRules.some((r) => matches(r, toolName, input))
          || (this.ruleStore?.matches(this.projectKey, toolName, input) ?? false))
      {
          return Promise.resolve({ behavior: 'allow', updatedInput: input })
      }
      const id = `a${(this.seq += 1)}`
      this.LastApprovalId = id
      const sink = this.sink
      const rule = ruleFor(toolName, input)
      const command = typeof (input as { command?: unknown })?.command === 'string'
          ? (input as { command: string }).command : undefined
      // No sink (probe/headless) → auto allow-once so the tool round-trip completes.
      if (sink === undefined) return Promise.resolve({ behavior: 'allow', updatedInput: input })
      return new Promise<Verdict>((resolve) =>
      {
          // Safety net: if the renderer never answers (window closed), allow-once
          // before the CLI's 30s MCP_TIMEOUT so it can't hang.
          const timer = setTimeout(() =>
          {
              if (this.pendingApprovals.delete(id)) resolve({ behavior: 'allow', updatedInput: input })
          }, 25000)
          this.pendingApprovals.set(id, (decision: ToolApprovalDecision) =>
          {
              clearTimeout(timer)
              if (decision === ToolApprovalDecision.Deny) { resolve({ behavior: 'deny', message: 'Denied by the user in Plexus.' }); return }
              if (decision === ToolApprovalDecision.AllowAlways)
              {
                  this.sessionRules.push(rule)
                  this.ruleStore?.add(this.projectKey, rule)
              }
              resolve({ behavior: 'allow', updatedInput: input })
          })
          sink({ Kind: AgentEventKind.ToolApproval, Request: { id, toolName, command, prefix: rule.prefix } })
      })
  }

  public resolveApproval(answer: ToolApprovalAnswer): void
  {
      const done = this.pendingApprovals.get(answer.id)
      if (done === undefined) return
      this.pendingApprovals.delete(answer.id)
      done(answer.decision)
  }
  ```
  Change `pendingApprovals` to `Map<string, (decision: ToolApprovalDecision) => void>`.
- Register the tool in `buildServer()` (tolerant input schema; log raw once):
  ```ts
  server.registerTool(
      APPROVE_TOOL_NAME,
      {
          title: 'Approve a tool use',
          description: 'Internal permission hook — not called by the model directly.',
          inputSchema: { tool_name: z.string().optional(), toolName: z.string().optional(),
                         input: z.unknown().optional(), tool_input: z.unknown().optional(),
                         tool_use_id: z.string().optional() },
      },
      async (args) =>
      {
          if (!this.loggedApprovalArgs) { this.loggedApprovalArgs = true; console.error('[approve_tool] raw args:', JSON.stringify(args)) }
          const a = args as Record<string, unknown>
          const toolName = (a.tool_name ?? a.toolName ?? 'unknown') as string
          const input = (a.input ?? a.tool_input ?? {})
          const verdict = await this.requestApproval(toolName, input)
          return { content: [{ type: 'text' as const, text: JSON.stringify(verdict) }] }
      },
  )
  ```
  Add `private loggedApprovalArgs = false`.
- In `close()`, unblock pending approvals with an allow-once so the CLI can't hang:
  ```ts
  for (const [id, done] of [...this.pendingApprovals]) { this.pendingApprovals.delete(id); done(ToolApprovalDecision.AllowOnce) }
  ```

- [ ] **Step 6: Wire the server + provider in `agent.ts`**

In `src/main/agent.ts`:
- Import `APPROVE_TOOL_QUALIFIED`, `ToolApprovalAnswer`, `ApprovalRule` from the shared module; `RuleStore` from `./agent/tool-approval-rules.js`; `app` from electron; `join` from `node:path`; `readFileSync`/`writeFileSync`/`existsSync` from `node:fs`.
- After `mcpServer.setSink(emitToRenderer)`, build + attach the rule store:
  ```ts
  const rulesPath = join(app.getPath('userData'), 'agent-approvals.json')
  const store = new RuleStore(
      { read: (p) => (existsSync(p) ? readFileSync(p, 'utf8') : undefined), write: (p, s) => writeFileSync(p, s, 'utf8') },
      rulesPath,
  )
  // projectKey is the session's cwd, set on start/send (see below).
  mcpServer.setRuleStore(store, process.cwd())
  ```
- Add the read-only built-ins to `allowedTools` and set `permissionPromptTool`:
  ```ts
  allowedTools: [ASK_TOOL_QUALIFIED, REFRESH_TOOL_QUALIFIED, CREATE_PROJECT_TOOL_QUALIFIED, GET_PROBLEMS_TOOL_QUALIFIED,
                 'Read', 'Glob', 'Grep', 'LS'],
  permissionPromptTool: APPROVE_TOOL_QUALIFIED,
  ```
- Re-point the rule store's project key to the working directory on each start/turn so per-project scope is correct. In the `StartSession` and `SendTurn` handlers, call `mcpServer.setRuleStore(store, workingDirectory)` before `session.start/send`.
- Add IPC handlers:
  ```ts
  ipcMain.handle(AgentChannel.AnswerToolApproval, (_e, answer: ToolApprovalAnswer): void => { mcpServer.resolveApproval(answer) })
  ipcMain.handle(AgentChannel.ListApprovalRules, (_e, projectKey: string): ApprovalRule[] => store.list(projectKey))
  ipcMain.handle(AgentChannel.RevokeApprovalRule, (_e, projectKey: string, rule: ApprovalRule): void => { store.remove(projectKey, rule) })
  ```

- [ ] **Step 7: Run server tests + typecheck**

Run: `cd Plexus && npx vitest run src/main/agent/tests/plexus-mcp-server.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 8: Commit**

```bash
cd Plexus && git add src/main/agent/ai-provider.ts src/main/agent/claude-cli-provider.ts src/main/agent/plexus-mcp-server.ts src/main/agent.ts src/main/agent/tests/plexus-mcp-server.test.ts
git commit -m "feat(agent): approve_tool permission channel + spawn flag + rule store wiring

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Renderer approval card (model + reducer + service + preload + template)

**Files:**
- Create: `src/renderer/src/modules/agent-chat/services/approval-card.ts`
- Create: `src/renderer/src/modules/agent-chat/services/tests/approval-card.test.ts`
- Modify: `src/renderer/src/modules/agent-chat/services/transcript.ts` (reducer case)
- Modify: `src/renderer/src/modules/agent-chat/services/agent-service.ts` (submit wiring)
- Modify: `src/renderer/src/modules/agent-chat/agent-chat.resources.mu` (DataTemplate)
- Modify: `src/preload/index.ts` (bridge verb)

**Interfaces:**
- Consumes: `ToolApprovalEvent`, `ToolApprovalDecision`, `ToolApprovalAnswer` (Task 1).
- Produces: `ToolApprovalCard` with a 10s countdown that auto-submits `AllowOnce`; three commands; a recap after answering.

- [ ] **Step 1: Write the failing card VM test**

Create `.../services/tests/approval-card.test.ts`:
```ts
import { test, expect, vi } from 'vitest'
import { ToolApprovalCard } from '../approval-card.js'
import { ToolApprovalDecision, type ToolApprovalAnswer } from '../../../../../shared/agent-api.js'

function card(onSubmit: (a: ToolApprovalAnswer) => void) {
    return new ToolApprovalCard({ id: 'a1', toolName: 'Bash', command: 'python foo.py', prefix: 'python' }, onSubmit, 10000)
}

test('exposes tool, command, and an always-allow label carrying the prefix', () => {
    const c = card(() => {})
    expect(c.ToolName).toBe('Bash')
    expect(c.Command).toBe('python foo.py')
    expect(c.AllowAlwaysLabel).toBe('Always allow python')
    c.dispose()
})

test('a click submits that decision and stops the countdown', () => {
    const seen: ToolApprovalAnswer[] = []
    const c = card((a) => seen.push(a))
    c.DenyCommand.Execute(undefined)
    expect(seen).toEqual([{ id: 'a1', decision: ToolApprovalDecision.Deny }])
    expect(c.IsAnswered).toBe(true)
    c.dispose()
})

test('countdown auto-submits AllowOnce at expiry', () => {
    vi.useFakeTimers()
    const seen: ToolApprovalAnswer[] = []
    const c = card((a) => seen.push(a))
    vi.advanceTimersByTime(10000)
    expect(seen).toEqual([{ id: 'a1', decision: ToolApprovalDecision.AllowOnce }])
    expect(c.Countdown).toBeLessThanOrEqual(0)
    vi.useRealTimers()
    c.dispose()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/agent-chat/services/tests/approval-card.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `ToolApprovalCard`**

Create `.../services/approval-card.ts`:
```ts
// View-model for a tool-approval card. Shows the tool + command with three
// commands (Approve once / Always allow <prefix> / Deny) and a depleting
// countdown ring; on expiry it auto-submits AllowOnce. Every view-bound property
// is a registered DP (mural binds via get_property_value).
import { MetaData, Model, RelayCommand, type ICommand } from '@pragmatic-lab/mural/runtime'
import { ToolApprovalDecision, type ToolApprovalAnswer, type ToolApprovalRequest } from '../../../../../shared/agent-api.js'

const TICK_MS = 100

export class ToolApprovalCard extends Model
{
    public static readonly ToolNameKey        = Model.RegisterProperty<string>(ToolApprovalCard, 'ToolName', '', MetaData.None)
    public static readonly CommandKey         = Model.RegisterProperty<string>(ToolApprovalCard, 'Command', '', MetaData.None)
    public static readonly HasCommandKey      = Model.RegisterProperty<boolean>(ToolApprovalCard, 'HasCommand', false, MetaData.None)
    public static readonly AllowAlwaysLabelKey= Model.RegisterProperty<string>(ToolApprovalCard, 'AllowAlwaysLabel', '', MetaData.None)
    public static readonly CanAllowAlwaysKey  = Model.RegisterProperty<boolean>(ToolApprovalCard, 'CanAllowAlways', false, MetaData.None)
    // Remaining fraction 1..0 for the ProgressIndicator ring (Value clamps 0..1).
    public static readonly CountdownKey       = Model.RegisterProperty<number>(ToolApprovalCard, 'Countdown', 1, MetaData.None)
    public static readonly IsPendingKey       = Model.RegisterProperty<boolean>(ToolApprovalCard, 'IsPending', true, MetaData.None)
    public static readonly IsAnsweredKey      = Model.RegisterProperty<boolean>(ToolApprovalCard, 'IsAnswered', false, MetaData.None)
    public static readonly RecapKey           = Model.RegisterProperty<string>(ToolApprovalCard, 'Recap', '', MetaData.None)
    public static readonly ApproveOnceCommandKey = Model.RegisterProperty<ICommand>(ToolApprovalCard, 'ApproveOnceCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly AllowAlwaysCommandKey = Model.RegisterProperty<ICommand>(ToolApprovalCard, 'AllowAlwaysCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly DenyCommandKey        = Model.RegisterProperty<ICommand>(ToolApprovalCard, 'DenyCommand', undefined as unknown as ICommand, MetaData.None)

    public readonly Id: string
    private timer: ReturnType<typeof setInterval> | undefined
    private remainingMs: number

    constructor(request: ToolApprovalRequest, private readonly onSubmit: (a: ToolApprovalAnswer) => void, durationMs = 10000)
    {
        super()
        this.Id = request.id
        this.remainingMs = durationMs
        const prefix = request.prefix
        this.set_property_value(ToolApprovalCard.ToolNameKey, request.toolName)
        this.set_property_value(ToolApprovalCard.CommandKey, request.command ?? '')
        this.set_property_value(ToolApprovalCard.HasCommandKey, (request.command ?? '') !== '')
        this.set_property_value(ToolApprovalCard.AllowAlwaysLabelKey, prefix !== undefined ? `Always allow ${prefix}` : `Always allow ${request.toolName}`)
        this.set_property_value(ToolApprovalCard.CanAllowAlwaysKey, true)
        this.set_property_value(ToolApprovalCard.ApproveOnceCommandKey, new RelayCommand(() => this.answer(ToolApprovalDecision.AllowOnce)))
        this.set_property_value(ToolApprovalCard.AllowAlwaysCommandKey, new RelayCommand(() => this.answer(ToolApprovalDecision.AllowAlways)))
        this.set_property_value(ToolApprovalCard.DenyCommandKey, new RelayCommand(() => this.answer(ToolApprovalDecision.Deny)))
        this.timer = setInterval(() => this.tick(durationMs), TICK_MS)
    }

    public get ToolName(): string { return this.get_property_value(ToolApprovalCard.ToolNameKey) }
    public get Command(): string { return this.get_property_value(ToolApprovalCard.CommandKey) }
    public get HasCommand(): boolean { return this.get_property_value(ToolApprovalCard.HasCommandKey) }
    public get AllowAlwaysLabel(): string { return this.get_property_value(ToolApprovalCard.AllowAlwaysLabelKey) }
    public get CanAllowAlways(): boolean { return this.get_property_value(ToolApprovalCard.CanAllowAlwaysKey) }
    public get Countdown(): number { return this.get_property_value(ToolApprovalCard.CountdownKey) }
    public get IsPending(): boolean { return this.get_property_value(ToolApprovalCard.IsPendingKey) }
    public get IsAnswered(): boolean { return this.get_property_value(ToolApprovalCard.IsAnsweredKey) }
    public get Recap(): string { return this.get_property_value(ToolApprovalCard.RecapKey) }
    public get ApproveOnceCommand(): ICommand { return this.get_property_value(ToolApprovalCard.ApproveOnceCommandKey) }
    public get AllowAlwaysCommand(): ICommand { return this.get_property_value(ToolApprovalCard.AllowAlwaysCommandKey) }
    public get DenyCommand(): ICommand { return this.get_property_value(ToolApprovalCard.DenyCommandKey) }

    public dispose(): void { if (this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined } }

    private tick(durationMs: number): void
    {
        this.remainingMs -= TICK_MS
        this.set_property_value(ToolApprovalCard.CountdownKey, Math.max(0, this.remainingMs / durationMs))
        if (this.remainingMs <= 0) this.answer(ToolApprovalDecision.AllowOnce)
    }

    private answer(decision: ToolApprovalDecision): void
    {
        if (this.IsAnswered) return
        this.dispose()
        this.set_property_value(ToolApprovalCard.IsAnsweredKey, true)
        this.set_property_value(ToolApprovalCard.IsPendingKey, false)
        const verb = decision === ToolApprovalDecision.Deny ? 'Denied'
            : decision === ToolApprovalDecision.AllowAlways ? 'Always allowed' : 'Approved'
        this.set_property_value(ToolApprovalCard.RecapKey, `${verb} ${this.ToolName}${this.HasCommand ? `: ${this.Command}` : ''}`)
        this.onSubmit({ id: this.Id, decision })
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/agent-chat/services/tests/approval-card.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Fold the event into the reducer**

In `transcript.ts`:
- Import: `import { ToolApprovalCard } from './approval-card.js'` and add `type ToolApprovalAnswer` to the shared import.
- Add a field `public onToolApprovalSubmitted: ((answer: ToolApprovalAnswer) => void) | undefined`.
- Add a case (mirroring `Question`) before `default`:
  ```ts
  case AgentEventKind.ToolApproval:
  {
      this.currentAssistant = null
      const request = event.Request
      this.pendingQuestions.add(request.id)
      const card = new ToolApprovalCard(request, (answer) =>
      {
          this.pendingQuestions.delete(request.id)
          this.onToolApprovalSubmitted?.(answer)
          this.onPendingChange?.()
      })
      this.Transcript.Add(card)
      this.onPendingChange?.()
      break
  }
  ```

- [ ] **Step 6: Wire the submit + bridge**

In `agent-service.ts`, next to the `onAnswerSubmitted` wiring:
```ts
  this.reducer.onToolApprovalSubmitted = (answer) => { void this.agent.answerToolApproval(answer) }
```

In `src/preload/index.ts`, add to the agent bridge object (mirroring `answerQuestion`):
```ts
  answerToolApproval: (answer) => ipcRenderer.invoke(AgentChannel.AnswerToolApproval, answer),
  listApprovalRules: (projectKey) => ipcRenderer.invoke(AgentChannel.ListApprovalRules, projectKey),
  revokeApprovalRule: (projectKey, rule) => ipcRenderer.invoke(AgentChannel.RevokeApprovalRule, projectKey, rule),
```
(Match the existing bridge's typing/pattern; import `AgentChannel` is already there.)

- [ ] **Step 7: Add the DataTemplate**

In `agent-chat.resources.mu`, after the `QuestionCard` template, add:
```
    // ── tool-approval card ──────────────────────────────────────────────────────
    // The agent asked to use a tool needing permission: tool + command, a button
    // row (Approve once / Always allow <prefix> / Deny) with a depleting countdown
    // ring at the right; on 10s expiry the card auto-approves once. Collapses to a
    // recap after answering.
    DataTemplate [ DataType = ToolApprovalCard ] {
        Border [ BorderBrush = @OutlineVariant, BorderThickness = (1,1,1,1), CornerRadius = 10,
                 Background = @SurfaceContainer, Padding = (12,10,12,12), Margin = (0,4,20,4) ] {
            StackPanel [ Orientation = Vertical ] {
                StackPanel [ Orientation = Vertical, Visibility = $IsPending << ToVisibility ] {
                    TextBlock [ Text = $ToolName, Foreground = @OnSurface, Style = @BodyMedium ]
                    Border [ Style = @ToolMonoBox, Visibility = $HasCommand << ToVisibility, Margin = (0,6,0,0) ] {
                        TextBlock [ Text = $Command, Foreground = @OnSurface, TextWrapping = Wrap ]
                    }
                    DockPanel [ LastChildFill = false, Margin = (0,10,0,0) ] {
                        ProgressIndicator [ DockPanel.Dock = Right, Variant = Circular, Value = $Countdown,
                                            Width = 20, Height = 20, Margin = (8,0,0,0) ]
                        Button [ DockPanel.Dock = Left, Command = $ApproveOnceCommand, Template = @CompactButton, Margin = (0,0,6,0) ] {
                            TextBlock [ Text = "Approve once" ]
                        }
                        Button [ DockPanel.Dock = Left, Command = $AllowAlwaysCommand, Template = @CompactButton, Margin = (0,0,6,0) ] {
                            TextBlock [ Text = $AllowAlwaysLabel ]
                        }
                        Button [ DockPanel.Dock = Left, Command = $DenyCommand, Template = @CompactButton ] {
                            TextBlock [ Text = "Deny" ]
                        }
                    }
                }
                TextBlock [ Text = $Recap, Visibility = $IsAnswered << ToVisibility,
                            Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
            }
        }
    }
```
(If `@CompactButton` is not the template key used elsewhere, use the same button template the QuestionCard's Submit uses — confirm the key in this file, e.g. `@CompactButton`, and reuse it.)

- [ ] **Step 8: Compile mural + run renderer tests + typecheck**

Run: `cd Plexus && npm run compile:mu && npx vitest run src/renderer/src/modules/agent-chat/ && npm run typecheck`
Expected: PASS — mural template compiles, card + reducer tests green, types clean.

- [ ] **Step 9: Commit**

```bash
cd Plexus && git add src/renderer/src/modules/agent-chat/ src/preload/index.ts
git commit -m "feat(agent-chat): tool-approval card with countdown + reducer/bridge wiring

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Settings surface + end-to-end verification

**Files:**
- Create/modify: a settings panel listing per-project approval rules with a Revoke action (follow the app's existing panel/settings convention; place under the agent-chat module if no general settings panel exists).
- Test: unit-test the settings VM (list reflects the bridge; revoke calls the bridge).

**Interfaces:**
- Consumes: `listApprovalRules(projectKey)`, `revokeApprovalRule(projectKey, rule)` (Task 1/2 bridge).

- [ ] **Step 1: Decide placement**

Inspect the app for an existing settings/preferences surface (search `Settings`, `Preferences`, a panel registry). If one exists, add an "Agent approvals" section there; otherwise add a small "Approvals" collapsible at the top of the agent-chat panel showing the current project's rules. Record the choice in a one-line comment.

- [ ] **Step 2: Implement the rules VM + view (TDD)**

Write a VM (registered DPs) exposing an `ObservableCollection` of rule rows (each `{ tool, prefix?, RevokeCommand }`) sourced from `listApprovalRules(currentProjectKey)`, with `RevokeCommand` calling `revokeApprovalRule` then refreshing the list. Unit-test: given a fake bridge returning two rules, the VM lists two rows; invoking a row's `RevokeCommand` calls the bridge with that rule and drops the row. Add the mural DataTemplate for the rows.

- [ ] **Step 3: Run renderer tests + typecheck + mural compile**

Run: `cd Plexus && npm run compile:mu && npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd Plexus && git add -A
git commit -m "feat(agent-chat): settings surface to review/revoke persistent approvals

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 5: Manual end-to-end smoke (human-run) + schema confirmation**

Run `npm run dev`, open the Chat panel on a project, and ask the agent to run a shell command (e.g. "run `python --version`"). Verify:
1. A tool-approval card appears with the command and a countdown ring; the input row is disabled while pending.
2. **Approve once** → the command runs; a second identical request prompts again.
3. **Always allow python** → runs; a later `python …` runs with **no** card; the rule appears in the settings surface and survives an app restart; **Revoke** removes it.
4. **Deny** → the agent is told no and continues.
5. Leaving the card untouched for 10s auto-approves once (ring empties).
6. Read the one-time `[approve_tool] raw args:` log line and confirm the parsed `tool_name`/`input` field names match the tolerant parser; if the CLI uses different names, widen the parser in `plexus-mcp-server.ts` Step 5 accordingly and re-run.

Record the observed schema in a comment above the `approve_tool` registration.

---

## Notes for the executor

- **Cross-layer ordering:** Task 1 (contract) precedes everything; Task 2 (main) precedes Task 3 (renderer, needs the bridge verbs + event); Task 4 last.
- **Reuse, don't reinvent:** the approval round-trip mirrors `ask_user_question` exactly (pending map, sink event, resolver, input gating via `pendingQuestions`/`CanInput`). Keep the shapes parallel.
- **Determinism:** no `Date.now`/`Math.random` in main-process id minting — reuse the existing `seq` counter (ids `a1`, `a2`, …).
- **The undocumented wire schema is the one real risk** — the tolerant parser + one-time log + Task 4 Step 6 confirmation close it without blocking on live access during earlier tasks.

## Self-Review

- **Spec coverage:** permission-prompt-tool spawn + `approve_tool` (Task 2), rule model + per-project persistent store (Task 1/2), session list + allow-always persistence (Task 2), approval card + 10s countdown/ProgressIndicator + auto-approve (Task 3), settings review/revoke (Task 4), schema-uncertainty handling (tolerant parse + log + smoke, Tasks 2/4). Auto-allow read-only built-ins + keep acceptEdits (Task 2 Step 6). Out-of-scope items (regex patterns, global list, input editing, requiresUserInteraction) are not implemented, per spec.
- **No placeholders:** load-bearing code is given inline; the only deferred specifics are the settings-panel placement (Task 4 Step 1 decides against the real app) and the exact CLI field names (Task 2 tolerant parse + Task 4 Step 6 confirmation) — both are explicit investigations, not vague steps.
- **Type consistency:** `Verdict` union is the single resolver/return type; `pendingApprovals` maps id→`(decision)=>void`; `ToolApprovalDecision`/`ToolApprovalAnswer`/`ApprovalRule` names are stable across main, preload, renderer; `requestApproval`/`resolveApproval`/`setRuleStore` signatures match their call sites and tests.

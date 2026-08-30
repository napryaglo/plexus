# Project Agent/Skill Background Runner — Design (Spec B)

- **Date:** 2026-08-30
- **Status:** Approved shape, pending spec review → implementation plan
- **Scope:** Let a user **run a project's declared agent or skill** from the project node's context menu. Discovery is via the AI provider; the run executes headlessly, surfaced as a **Background Work task** whose open-action opens the run's **conversation**.
- **Depends on:**
  - [Spec A — Multi-Conversation Agents](2026-08-30-multi-conversation-agents-design.md) — `ChatSession`, `ChatSessionsService`, `AgentSessionManager`, session-tagged IPC.
  - The shipped **Background Work** subsystem (`BackgroundWorkService`, `TaskHandle`, `ITaskExecutor`, `TaskOutputDocument`) — `docs/superpowers/specs/2026-08-30-background-work-service-design.md`.

## 1. Goal & motivation

A project can declare its own agents (subagents) and skills under `.claude/`. Users want to launch one against the project without hand-typing a prompt: right-click the project → pick from a submenu → it runs in the background → click to watch/continue the conversation. This threads together the three subsystems — provider discovery, the session engine (Spec A), and Background Work.

## 2. Non-goals

- No authoring/editing of agents or skills — discovery + run only.
- No new provider *runtime* — reuse `AgentSessionManager` to run the turn.
- No scheduling/recurrence — one run per invocation (it becomes a Background Work task; concurrency is governed there).

## 3. Concepts & vocabulary

| Term | Meaning |
| --- | --- |
| **Agent** | A project-declared subagent (`.claude/agents/<name>.md`): name + description + system prompt. |
| **Skill** | A project-declared skill (`.claude/skills/<name>/SKILL.md`): name + description + instructions. |
| **Catalog** | The `{ agents[], skills[] }` a provider discovers for a project directory. |
| **Run** | A headless conversation seeded to invoke one agent/skill, tracked as a Background Work task. |

## 4. Architecture overview

```
 right-click project node
        │
        ▼
 AgentRunNodeContributor.contribute(op, node)
        │  queries
        ▼
 ProjectAgentCatalog (renderer)  ──IPC──▶  IAiProvider.listAgentsAndSkills(dir)  (scan .claude/)
        │  builds submenu
        ▼
 context menu:  Run Agent/Skill ▸  ┌ agent: reviewer
                                   ├ agent: planner
                                   └ skill: security-review
        │  select
        ▼
 ChatSessionsService.RunAgentSkill(op, item)
        ├─ creates a ChatSession (Spec A) seeded to invoke `item`
        └─ BackgroundWorkService.submit({ kind: AgentRun, open: () => open that ChatSession })
                 │
                 ▼
        status-bar task  ⟳ "reviewer on Billing"   ── click ──▶ opens the conversation tab
```

## 5. Discovery (via AiProvider)

`IAiProvider` gains discovery; the claude-CLI provider implements it by scanning the project directory's `.claude/`:

```ts
interface AgentInfo { name: string; description: string }
interface SkillInfo { name: string; description: string }
interface ProjectCatalog { agents: AgentInfo[]; skills: SkillInfo[] }

interface IAiProvider {
    // …Id, Resumable, start (Spec A)
    listAgentsAndSkills(projectDir: string): Promise<ProjectCatalog>   // NEW
}
```

- **Where it looks:** `<projectDir>/.claude/agents/*.md` (front-matter `name`/`description`) and `<projectDir>/.claude/skills/*/SKILL.md` (front-matter `name`/`description`). Provider-owned so a different provider can discover differently. (**Open detail:** whether to also include user-global `~/.claude` items — default **project-only** for v1, since the menu hangs off the project node.)
- **IPC:** a `listCapabilities(dir)` channel on `window.api.agent`; a renderer **`ProjectAgentCatalog`** service caches the result per project (invalidated on project rescan — the app already has `ProjectRescanService`/`FileWatchService`).

## 6. Context-menu submenu

Today `INodeCommandContributor.contribute(op, node)` returns a single `NodeAction`, and there is one `NodeCommandContributorKey`. Two small extensions:

1. **Submenu:** `NodeAction` gains an optional `children?: NodeAction[]`; the ProjectExplorer renders a child list as a submenu. A parent action with `children` and no `command` is a pure submenu.
2. **Multiple contributors:** allow more than one `INodeCommandContributor` (the architecture module already registers one). Aggregate: the explorer collects actions from every registered contributor. `contribute` returns `NodeAction[]` (0..n) instead of a single optional action.

`AgentRunNodeContributor` (registered by the `conversations`/agent module) returns, **only for a project-root node whose catalog is non-empty**, a single `Run Agent/Skill ▸` parent whose children are one `NodeAction` per catalog item (agents first, then skills), each invoking `ChatSessionsService.RunAgentSkill(op, item)`.

## 7. Launching a run

`ChatSessionsService.RunAgentSkill(op, item)`:

1. Mint a `sessionId`; create a **`ChatSession`** (Spec A) titled e.g. `reviewer · Billing`, targeting the project's `(cwd, addDirs)`.
2. **Seed the invocation:** send the first turn that invokes the item — for a **skill**, the turn text is the skill invocation (e.g. a `/skill-name` command); for an **agent**, start the session bound to that subagent. *(Open detail: exact claude-CLI form for invoking a named subagent vs. a skill — confirm; the seam (`ChatSession` seeded via `sendTurn`/`startSession`) is the same regardless.)*
3. **Register a Background Work task** so the run is visible headlessly:
   ```ts
   backgroundWork.submit({
       kind: TaskKind.AgentRun,
       title: `${item.name} · ${op.Project.Name}`,
       payload: { sessionId },
       open: () => chatSessions.reveal(sessionId),   // custom open-target (see §8)
   })
   ```
   An **`AgentRunExecutor`** (`kind = AgentRun`) drives the seeded turn to completion: it `report`s progress (running → done), `log`s key events, and resolves when the turn ends (or fails/cancels). The `ChatSession` remains open/continuable afterward.

## 8. Background Work extension: custom open-target

The shipped `BackgroundWorkService` sets each task's `OpenOutputCommand` to open a `TaskOutputDocument`. Add an **optional `open?: () => void`** to the `submit` task: when present, the manager wires `OpenOutputCommand` to it instead of the default output doc. This lets an agent-run task open its **conversation tab** rather than a plain log — a clean, minimal generalization (default behaviour unchanged). One-line branch in `submit()`; unit-tested by asserting the override is invoked.

## 9. Data flow

Right-click project node → `AgentRunNodeContributor` asks `ProjectAgentCatalog` (cached; IPC → provider scan) → submenu built → user picks `reviewer` → `RunAgentSkill` creates a `ChatSession` (seeded) + submits an `AgentRun` Background Work task with `open → reveal(sessionId)` → `AgentRunExecutor` runs the turn, reporting progress → the status-bar dock shows it; clicking the task (or the Conversations panel entry) opens the conversation.

## 10. Testing

- **Discovery** — `listAgentsAndSkills` over a fake FS with `.claude/agents/*.md` + `.claude/skills/*/SKILL.md` returns the expected catalog (names/descriptions parsed from front-matter); empty `.claude` → empty catalog.
- **`ProjectAgentCatalog`** — caches per project; invalidates on rescan.
- **Submenu contributor** — non-empty catalog on a project-root node yields a `Run Agent/Skill ▸` parent with the right children; empty catalog / non-root node yields none; multiple contributors aggregate.
- **`RunAgentSkill`** — creates a `ChatSession` and submits a task whose `open` reveals that session (fake `BackgroundWorkService` + `ChatSessionsService`).
- **Background Work `open` override** — a task submitted with `open` wires `OpenOutputCommand` to it (add to `background-work-service.test.ts`).

## 11. Open questions

- Exact claude-CLI invocation for a **named subagent** vs a **skill** (start-flag vs slash-command-in-turn) — confirm; the `ChatSession` seam is invariant to it.
- **Approvals for headless runs** — reuse the existing tool-approval rules; default posture (auto-approve safe tools vs. surface prompts in the conversation) to decide. Since the run opens as a real conversation, surfacing approval cards there (as today) is the natural default.
- Whether to include **user-global** `~/.claude` items (default: project-only).

## 12. First-cut scope (YAGNI)

- [ ] `IAiProvider.listAgentsAndSkills` + claude-CLI `.claude` scan + IPC.
- [ ] `ProjectAgentCatalog` (cache + rescan invalidation).
- [ ] `NodeAction.children` submenu + multi-contributor aggregation in ProjectExplorer.
- [ ] `AgentRunNodeContributor` (project-root, non-empty-catalog submenu).
- [ ] `ChatSessionsService.RunAgentSkill` + `AgentRunExecutor`.
- [ ] Background Work `submit({ open })` custom open-target.
- [ ] Deferred: global `.claude` discovery; run scheduling/recurrence.

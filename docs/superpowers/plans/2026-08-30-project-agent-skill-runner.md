# Project Agent/Skill Background Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user right-click a project and launch one of its declared `.claude/` agents or skills; the run executes headlessly as a Background Work task whose click opens the run's live conversation.

**Architecture:** The claude-CLI provider discovers a project's `.claude/agents/*.md` + `.claude/skills/*/SKILL.md` (via a pure scanner behind an injectable IO seam), exposed through a new IPC method and cached per-project by a renderer `ProjectAgentCatalog`. The project-header context menu (`ProjectContextMenu`, bound to `OpenProject`) gains a dynamic **"Run Agent / Skill ▸"** submenu — reusing the exact `ItemsSource`/`ItemTemplate` pattern the existing "Add New" submenu uses — whose items call `ChatSessionsService.RunAgentSkill`. That seeds a new `ChatSession` (from the Multi-Conversation foundation) with the invocation turn and submits a Background Work task (the built-in Inline executor) whose `open` override reveals the conversation.

**Tech Stack:** TypeScript, Electron (main/preload/renderer), `@pragmatic-lab/mural`, Vitest, Playwright `_electron`, mural `.mu` markup (`npm run compile:mu`).

**Spec:** `docs/superpowers/specs/2026-08-30-project-agent-skill-runner-design.md`

**Depends on (both shipped, on `main`):** the Multi-Conversation Agents foundation (`ChatSession`, `ChatSessionsService`, `TaggedAgentEvent`, session-tagged IPC) and the Background Work subsystem (`BackgroundWorkService`, `TaskHandle`, `TaskKind.Inline`, `TaskOutputDocument`).

## Global Constraints

- **Enums, never string-literal unions** (repo rule).
- **Every test file lives in a `tests/` subfolder** next to the code it exercises (CLAUDE.md).
- **Render through templates only** — the menu lives in `.mu`; no visual construction in TS.
- **The claude CLI stays non-bare.**
- **No `Date.now()` / `Math.random()` in main-process code.** The renderer may use `crypto.randomUUID()` (already how `sessionId`s are minted).
- Builds on mural `^0.40.0` (no mural change).
- **Commit messages** end with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Work happens directly on `main` (established project flow).

## Deviations from the spec (with rationale)

Two implementation refinements — the **user-facing behavior is exactly the spec's** (right-click project → submenu of agents/skills → runs in background → click opens the conversation):

1. **Menu surface:** the spec routed the submenu through `INodeCommandContributor` + a new `NodeAction.children` + a multi-contributor registry. Instead this hangs the submenu off the **project-header menu** (`ProjectContextMenu`, `OpenProject`-bound) — the actual "right-click the project" surface, which already hosts per-project actions (Publish, Generate Presentation) and a *dynamic* submenu ("Add New" via `ItemsControl.ItemsSource`). No change to the node-contributor seam; far less surface area.
2. **Executor:** the spec proposed `TaskKind.AgentRun` + an `AgentRunExecutor`. Instead the run is a one-off async fn on the built-in **Inline executor** (await the seeded turn's completion), with the spec's **`open` override** on `submit` pointing the task at the conversation. No new executor kind.

---

### Task 1: `.claude` catalog scanner (main, pure)

A dependency-free scanner that reads a project's `.claude/agents/*.md` and `.claude/skills/*/SKILL.md`, parsing each file's YAML front-matter `name`/`description`. Behind an injectable IO seam so it unit-tests without a real filesystem.

**Files:**
- Create: `src/main/agent/claude-catalog.ts`
- Modify: `src/shared/agent-api.ts` (add the shared catalog types — consumed by the renderer too)
- Test: `src/main/agent/tests/claude-catalog.test.ts`

**Interfaces:**
- Produces (in `shared/agent-api.ts`):
  - `enum AgentSkillKind { Agent = 'agent', Skill = 'skill' }`
  - `interface CatalogItem { kind: AgentSkillKind; name: string; description: string }`
  - `interface ProjectCatalog { agents: CatalogItem[]; skills: CatalogItem[] }`
- Produces (in `claude-catalog.ts`):
  - `interface CatalogIo { exists(path: string): Promise<boolean>; readDir(path: string): Promise<string[]>; readFile(path: string): Promise<string> }`
  - `parseFrontMatter(text: string): { name?: string; description?: string }`
  - `scanClaudeCatalog(projectDir: string, io: CatalogIo): Promise<ProjectCatalog>`

- [ ] **Step 1: Add the shared types**

In `src/shared/agent-api.ts`, near the other agent enums:

```ts
// A project's declared .claude/ capabilities, discovered by the provider.
export enum AgentSkillKind { Agent = 'agent', Skill = 'skill' }
export interface CatalogItem { kind: AgentSkillKind; name: string; description: string }
export interface ProjectCatalog { agents: CatalogItem[]; skills: CatalogItem[] }
```

- [ ] **Step 2: Write the failing test**

`src/main/agent/tests/claude-catalog.test.ts`:

```ts
import { test, expect } from 'vitest'
import { scanClaudeCatalog, parseFrontMatter, type CatalogIo } from '../claude-catalog.js'
import { AgentSkillKind } from '../../../shared/agent-api.js'

// An in-memory filesystem: dirs → child names, files → contents.
function fakeIo(files: Record<string, string>, dirs: Record<string, string[]>): CatalogIo {
    return {
        exists: (p) => Promise.resolve(p in files || p in dirs),
        readDir: (p) => Promise.resolve(dirs[p] ?? []),
        readFile: (p) => Promise.resolve(files[p] ?? ''),
    }
}

const AGENT_MD = `---
name: reviewer
description: Reviews changes for bugs
---
You are a careful reviewer.`

const SKILL_MD = `---
name: security-review
description: Audits for security issues
---
Do a security review.`

test('parseFrontMatter reads name + description from the YAML fence', () => {
    expect(parseFrontMatter(AGENT_MD)).toEqual({ name: 'reviewer', description: 'Reviews changes for bugs' })
})

test('parseFrontMatter tolerates a file with no front-matter', () => {
    expect(parseFrontMatter('just prose, no fence')).toEqual({})
})

test('scan reads agents and skills with parsed metadata', async () => {
    const io = fakeIo(
        {
            '/p/.claude/agents/reviewer.md': AGENT_MD,
            '/p/.claude/skills/security-review/SKILL.md': SKILL_MD,
        },
        {
            '/p/.claude/agents': ['reviewer.md', 'notes.txt'],   // non-.md ignored
            '/p/.claude/skills': ['security-review'],
        },
    )
    const catalog = await scanClaudeCatalog('/p', io)
    expect(catalog.agents).toEqual([{ kind: AgentSkillKind.Agent, name: 'reviewer', description: 'Reviews changes for bugs' }])
    expect(catalog.skills).toEqual([{ kind: AgentSkillKind.Skill, name: 'security-review', description: 'Audits for security issues' }])
})

test('a missing .claude directory yields an empty catalog', async () => {
    const catalog = await scanClaudeCatalog('/p', fakeIo({}, {}))
    expect(catalog).toEqual({ agents: [], skills: [] })
})

test('an agent md with no name falls back to its file basename', async () => {
    const io = fakeIo(
        { '/p/.claude/agents/planner.md': 'no front matter here' },
        { '/p/.claude/agents': ['planner.md'] },
    )
    const catalog = await scanClaudeCatalog('/p', io)
    expect(catalog.agents).toEqual([{ kind: AgentSkillKind.Agent, name: 'planner', description: '' }])
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/agent/tests/claude-catalog.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

`src/main/agent/claude-catalog.ts`:

```ts
// Pure scanner for a project's declared .claude/ capabilities. Behind a small IO
// seam (exists/readDir/readFile) so it unit-tests without a real filesystem; the
// provider injects a node:fs-backed impl.
import { AgentSkillKind, type CatalogItem, type ProjectCatalog } from '../../shared/agent-api.js'

export interface CatalogIo
{
    exists(path: string): Promise<boolean>
    readDir(path: string): Promise<string[]>
    readFile(path: string): Promise<string>
}

// Read `name` / `description` from a leading `--- … ---` YAML fence. Deliberately
// minimal (no YAML dep): only these two scalar keys, first fence only.
export function parseFrontMatter(text: string): { name?: string; description?: string }
{
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
    if (match === null) return {}
    const out: { name?: string; description?: string } = {}
    for (const line of match[1].split(/\r?\n/))
    {
        const kv = /^(name|description)\s*:\s*(.*)$/.exec(line.trim())
        if (kv === null) continue
        const value = kv[2].replace(/^["']|["']$/g, '').trim()
        if (kv[1] === 'name') out.name = value
        else out.description = value
    }
    return out
}

// Join with a forward slash (main runs on the scanned host; node:fs accepts '/').
function join(a: string, b: string): string { return a.endsWith('/') ? a + b : `${a}/${b}` }

async function readAgents(dir: string, io: CatalogIo): Promise<CatalogItem[]>
{
    if (!(await io.exists(dir))) return []
    const items: CatalogItem[] = []
    for (const entry of await io.readDir(dir))
    {
        if (!entry.endsWith('.md')) continue
        const fm = parseFrontMatter(await io.readFile(join(dir, entry)))
        items.push({ kind: AgentSkillKind.Agent, name: fm.name ?? entry.replace(/\.md$/, ''), description: fm.description ?? '' })
    }
    return items
}

async function readSkills(dir: string, io: CatalogIo): Promise<CatalogItem[]>
{
    if (!(await io.exists(dir))) return []
    const items: CatalogItem[] = []
    for (const name of await io.readDir(dir))
    {
        const skillFile = join(join(dir, name), 'SKILL.md')
        if (!(await io.exists(skillFile))) continue
        const fm = parseFrontMatter(await io.readFile(skillFile))
        items.push({ kind: AgentSkillKind.Skill, name: fm.name ?? name, description: fm.description ?? '' })
    }
    return items
}

export async function scanClaudeCatalog(projectDir: string, io: CatalogIo): Promise<ProjectCatalog>
{
    const claude = join(projectDir, '.claude')
    if (!(await io.exists(claude))) return { agents: [], skills: [] }
    const agents = await readAgents(join(claude, 'agents'), io)
    const skills = await readSkills(join(claude, 'skills'), io)
    return { agents, skills }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/agent/tests/claude-catalog.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/claude-catalog.ts src/shared/agent-api.ts src/main/agent/tests/claude-catalog.test.ts
git commit -m "feat(agent): pure .claude agents/skills catalog scanner"
```

---

### Task 2: Provider discovery + IPC + preload

Add `listAgentsAndSkills` to the provider seam, implement it on `ClaudeCliProvider` (node:fs IO), and thread it through IPC + preload so the renderer can query a project's catalog.

**Files:**
- Modify: `src/main/agent/ai-provider.ts` (interface), `src/main/agent/claude-cli-provider.ts` (impl)
- Modify: `src/shared/agent-api.ts` (`AgentChannel.ListAgentsAndSkills`, `IAgentApi.listAgentsAndSkills`)
- Modify: `src/main/agent.ts` (handler), `src/preload/index.ts` (bridge method)
- Modify fakes: `src/main/agent/tests/agent-session.test.ts`, `agent-session-manager.test.ts`, `ai-provider-service.test.ts` (add `listAgentsAndSkills` to their `IAiProvider` fakes)
- Test: add a case to `src/main/agent/tests/claude-cli-provider.test.ts`

**Interfaces:**
- Consumes: `scanClaudeCatalog`, `CatalogIo` (Task 1), `ProjectCatalog` (Task 1).
- Produces: `IAiProvider.listAgentsAndSkills(projectDir: string): Promise<ProjectCatalog>`; `AgentChannel.ListAgentsAndSkills = 'agent:list-agents-and-skills'`; `IAgentApi.listAgentsAndSkills(projectDir: string): Promise<ProjectCatalog>`.

- [ ] **Step 1: Write the failing test**

Add to `src/main/agent/tests/claude-cli-provider.test.ts` (it already imports `ClaudeCliProvider`; add `AgentSkillKind`):

```ts
import { AgentSkillKind } from '../../../shared/agent-api.js'
import type { CatalogIo } from '../claude-catalog.js'

test('listAgentsAndSkills scans the project .claude via the injected IO', async () => {
    const io: CatalogIo = {
        exists: (p) => Promise.resolve(p === '/p/.claude' || p === '/p/.claude/agents' || p === '/p/.claude/agents/reviewer.md'),
        readDir: (p) => Promise.resolve(p === '/p/.claude/agents' ? ['reviewer.md'] : []),
        readFile: () => Promise.resolve('---\nname: reviewer\ndescription: d\n---\n'),
    }
    const provider = new ClaudeCliProvider('claude', undefined, undefined, io)
    const catalog = await provider.listAgentsAndSkills('/p')
    expect(catalog.agents).toEqual([{ kind: AgentSkillKind.Agent, name: 'reviewer', description: 'd' }])
    expect(catalog.skills).toEqual([])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/agent/tests/claude-cli-provider.test.ts`
Expected: FAIL — 4th constructor arg + `listAgentsAndSkills` don't exist.

- [ ] **Step 3: Implement the provider seam**

In `ai-provider.ts`, add to `IAiProvider` (after `start`):

```ts
    // Discover the project's declared .claude/ agents + skills (provider-owned so a
    // different provider can discover differently).
    listAgentsAndSkills(projectDir: string): Promise<ProjectCatalog>;
```

Add the import: `import type { ProjectCatalog } from '../../shared/agent-api.js'` (extend the existing `AgentEvent` import line).

In `claude-cli-provider.ts`:
- Add imports: `import { existsSync } from 'node:fs'`, `import { readdir, readFile } from 'node:fs/promises'`, `import { scanClaudeCatalog, type CatalogIo } from './claude-catalog.js'`, `import type { ProjectCatalog } from '../../shared/agent-api.js'`.
- Add a default node:fs IO and a 4th constructor param:

```ts
const defaultCatalogIo: CatalogIo = {
    exists: (p) => Promise.resolve(existsSync(p)),
    readDir: (p) => readdir(p),
    readFile: (p) => readFile(p, 'utf8'),
}
```

```ts
    constructor(
        private readonly binaryPath: string = 'claude',
        private readonly spawnFn: SpawnFn = defaultSpawn,
        private readonly mcp: McpOptions | undefined = undefined,
        private readonly catalogIo: CatalogIo = defaultCatalogIo,
    ) {}
```

- Add the method:

```ts
    public listAgentsAndSkills(projectDir: string): Promise<ProjectCatalog>
    {
        return scanClaudeCatalog(projectDir, this.catalogIo)
    }
```

- [ ] **Step 4: Update the provider fakes**

In each of `agent-session.test.ts`, `agent-session-manager.test.ts`, `ai-provider-service.test.ts`, add to the `IAiProvider` fake object (alongside `Resumable`):

```ts
        listAgentsAndSkills: () => Promise.resolve({ agents: [], skills: [] }),
```

- [ ] **Step 5: Add IPC + preload**

In `shared/agent-api.ts`, add to `AgentChannel`:

```ts
    // renderer→main query: a project's declared .claude/ agents + skills.
    ListAgentsAndSkills = 'agent:list-agents-and-skills',
```

Add to `IAgentApi` (near `isResumable`):

```ts
    // Discover a project's declared .claude/ agents + skills.
    listAgentsAndSkills(projectDir: string): Promise<ProjectCatalog>;
```

Add the `ProjectCatalog` import to the existing `shared/agent-api.ts` type set (it's defined in this file — no import needed; just ensure the interface references it).

In `src/main/agent.ts`, add a handler (near `IsResumable`):

```ts
    ipcMain.handle(AgentChannel.ListAgentsAndSkills, (_e, projectDir: string): Promise<ProjectCatalog> =>
        providers.active().listAgentsAndSkills(projectDir))
```

Add `type ProjectCatalog` to its `shared/agent-api.js` import.

In `src/preload/index.ts`, add to the `agent` bridge object:

```ts
  listAgentsAndSkills: (projectDir: string): Promise<ProjectCatalog> =>
    ipcRenderer.invoke(AgentChannel.ListAgentsAndSkills, projectDir),
```

Add `type ProjectCatalog` to its `shared/agent-api.js` import.

- [ ] **Step 6: Run the provider test + type-check node**

Run: `npx vitest run src/main/agent/tests/claude-cli-provider.test.ts && npx tsc -p tsconfig.node.json --noEmit`
Expected: PASS; node type-check clean.

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/ai-provider.ts src/main/agent/claude-cli-provider.ts src/shared/agent-api.ts src/main/agent.ts src/preload/index.ts src/main/agent/tests/
git commit -m "feat(agent): provider listAgentsAndSkills discovery + IPC/preload"
```

---

### Task 3: `ProjectAgentCatalog` (renderer, cached)

A renderer service that fetches + caches a project's catalog per project directory, with an `Invalidate` for rescans.

**Files:**
- Create: `src/renderer/src/modules/agent-chat/services/project-agent-catalog.ts`
- Test: `src/renderer/src/modules/agent-chat/services/tests/project-agent-catalog.test.ts`

**Interfaces:**
- Consumes: `IAgentApi.listAgentsAndSkills` (Task 2), `ProjectCatalog`.
- Produces: `class ProjectAgentCatalog extends ServiceBase { static Key; CatalogFor(projectDir: string): Promise<ProjectCatalog>; Invalidate(projectDir: string): void }`.

- [ ] **Step 1: Write the failing test**

`src/renderer/src/modules/agent-chat/services/tests/project-agent-catalog.test.ts`:

```ts
import { test, expect, beforeEach, afterEach } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { AgentSkillKind, type IAgentApi, type ProjectCatalog } from '../../../../../../shared/agent-api.js'
import { ProjectAgentCatalog } from '../project-agent-catalog.js'

let calls: string[]
function install(catalog: ProjectCatalog) {
    calls = []
    const agent = {
        listAgentsAndSkills: (dir: string) => { calls.push(dir); return Promise.resolve(catalog) },
    } as unknown as IAgentApi
    ;(globalThis as unknown as { api: unknown }).api = { agent }
}
afterEach(() => { delete (globalThis as unknown as { api?: unknown }).api })

const CATALOG: ProjectCatalog = { agents: [{ kind: AgentSkillKind.Agent, name: 'reviewer', description: 'd' }], skills: [] }

test('CatalogFor fetches once and caches by directory', async () => {
    install(CATALOG)
    const svc = new ProjectAgentCatalog(new ServiceProvider())
    expect(await svc.CatalogFor('/p')).toEqual(CATALOG)
    await svc.CatalogFor('/p')
    expect(calls).toEqual(['/p'])   // second call served from cache
})

test('Invalidate forces a refetch for that directory', async () => {
    install(CATALOG)
    const svc = new ProjectAgentCatalog(new ServiceProvider())
    await svc.CatalogFor('/p')
    svc.Invalidate('/p')
    await svc.CatalogFor('/p')
    expect(calls).toEqual(['/p', '/p'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/agent-chat/services/tests/project-agent-catalog.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/renderer/src/modules/agent-chat/services/project-agent-catalog.ts`:

```ts
// Caches each open project's .claude/ catalog (agents + skills), fetched once via
// the agent bridge and refetched only after Invalidate (call on project rescan).
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import type { IAgentApi, ProjectCatalog } from '../../../../../shared/agent-api.js'

export class ProjectAgentCatalog extends ServiceBase
{
    public static readonly Key = new ServiceKey<ProjectAgentCatalog>('ProjectAgentCatalog')

    private readonly agent: IAgentApi
    private readonly cache = new Map<string, Promise<ProjectCatalog>>()

    constructor(provider: IServiceProvider)
    {
        super(provider)
        const bridge = (globalThis as unknown as { api?: { agent?: IAgentApi } }).api
        if (bridge?.agent === undefined)
            throw new Error('ProjectAgentCatalog: window.api.agent is unavailable — requires the Plexus desktop host.')
        this.agent = bridge.agent
    }

    public CatalogFor(projectDir: string): Promise<ProjectCatalog>
    {
        let pending = this.cache.get(projectDir)
        if (pending === undefined)
        {
            pending = this.agent.listAgentsAndSkills(projectDir)
            this.cache.set(projectDir, pending)
        }
        return pending
    }

    public Invalidate(projectDir: string): void { this.cache.delete(projectDir) }
}

export default ProjectAgentCatalog
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/agent-chat/services/tests/project-agent-catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/agent-chat/services/project-agent-catalog.ts src/renderer/src/modules/agent-chat/services/tests/project-agent-catalog.test.ts
git commit -m "feat(agent): ProjectAgentCatalog — per-project .claude catalog cache"
```

---

### Task 4: Background Work `open` override

Add an optional `open?: () => void` to a submitted task; when present, the manager wires the task's `OpenOutputCommand` to it instead of the default output document. Default behavior unchanged.

**Files:**
- Modify: `src/renderer/src/modules/background-work/services/task-executor.ts` (add `open?` to `BackgroundTask`)
- Modify: `src/renderer/src/modules/background-work/services/background-work-service.ts` (honor it in `submit`)
- Test: add a case to `src/renderer/src/modules/background-work/services/tests/background-work-service.test.ts`

**Interfaces:**
- Produces: `BackgroundTask.open?: () => void`; `submit` sets `handle.OpenOutputCommand` to `new RelayCommand(open)` when `open` is present.

- [ ] **Step 1: Write the failing test**

Add to `src/renderer/src/modules/background-work/services/tests/background-work-service.test.ts` (reuse its existing provider/service setup helper; if the file constructs the service via a helper like `makeService()`, use it):

```ts
import { TaskKind } from '../task-executor.js'

test('submit with an open override wires OpenOutputCommand to it', () => {
    const svc = makeService()   // existing helper in this test file
    let opened = 0
    const { handle } = svc.submit({ kind: TaskKind.Inline, title: 'run', payload: async () => 'ok', open: () => { opened++ } })
    handle.OpenOutputCommand.Execute(undefined)
    expect(opened).toBe(1)
})
```

> If the test file has no `makeService()` helper, construct the service the same way the neighboring tests in that file do (they already build a `BackgroundWorkService` with a `ServiceProvider`); mirror that construction here.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/background-work/services/tests/background-work-service.test.ts`
Expected: FAIL — `open` is not on `BackgroundTask`; the default `OpenOutputCommand` opens a doc, doesn't call `opened`.

- [ ] **Step 3: Implement**

In `task-executor.ts`, extend `BackgroundTask`:

```ts
export interface BackgroundTask<P = unknown> {
    kind:    TaskKind | string
    title:   string
    payload: P
    // Optional custom "open" target for the task's status-bar row. When present the
    // manager wires OpenOutputCommand to it instead of opening the default output
    // document (e.g. an agent-run task opens its conversation).
    open?:   () => void
}
```

In `background-work-service.ts`, in `submit`, replace the unconditional `OpenOutputCommand` line:

```ts
        const handle = new TaskHandle({ id: `task-${++this.seq}`, title: task.title, kind: String(task.kind) })
        handle.OpenOutputCommand = task.open !== undefined
            ? new RelayCommand(task.open)
            : new RelayCommand(() => this.openOutput(handle))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/background-work/services/tests/background-work-service.test.ts`
Expected: PASS (new case + all existing cases).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/background-work/services/task-executor.ts src/renderer/src/modules/background-work/services/background-work-service.ts src/renderer/src/modules/background-work/services/tests/background-work-service.test.ts
git commit -m "feat(background-work): optional open override for a submitted task"
```

---

### Task 5: `ChatSessionsService.RunAgentSkill` + seed + run completion

Seed a new conversation with the invocation turn, submit a Background Work task that awaits the turn's completion, and reveal the conversation on click.

**Files:**
- Modify: `src/renderer/src/modules/agent-chat/services/chat-sessions-service.ts`
- Modify: `src/renderer/src/modules/agent-chat/services/tests/chat-sessions-service.test.ts`

**Interfaces:**
- Consumes: `CatalogItem`/`AgentSkillKind` (Task 1), `BackgroundWorkService` + `TaskKind.Inline` + `BackgroundTask.open` (Task 4), the existing `ChatSession`, `crypto.randomUUID`.
- Produces:
  - `seedInvocation(item: CatalogItem): string` (module-exported pure fn)
  - `ChatSessionsService.RunAgentSkill(item: CatalogItem, projectDir: string, projectName: string): ChatSession`
  - internal `pendingRuns: Map<string, () => void>` resolved on `TurnComplete` in `route`.

- [ ] **Step 1: Write the failing test**

Add to `src/renderer/src/modules/agent-chat/services/tests/chat-sessions-service.test.ts`. Extend the existing `makeService()` to also register a fake `BackgroundWorkService`, and add cases. First, the pure seed fn and the run:

```ts
import { AgentSkillKind, type CatalogItem } from '../../../../../../shared/agent-api.js'
import { BackgroundWorkService } from '../../../background-work/services/background-work-service.js'
import { seedInvocation } from '../chat-sessions-service.js'

test('seedInvocation builds a slash command for a skill and a subagent instruction for an agent', () => {
    expect(seedInvocation({ kind: AgentSkillKind.Skill, name: 'security-review', description: '' })).toBe('/security-review')
    expect(seedInvocation({ kind: AgentSkillKind.Agent, name: 'reviewer', description: '' }))
        .toBe('Use the "reviewer" subagent for this task.')
})
```

Then, in the `makeService()` helper, register a fake background-work that records submissions:

```ts
    const submitted: Array<{ title: string; open?: () => void }> = []
    provider.registerInstance(BackgroundWorkService.Key, {
        submit: (t: { title: string; open?: () => void }) => { submitted.push({ title: t.title, open: t.open }); return { handle: {}, done: Promise.resolve() } },
    } as unknown as BackgroundWorkService)
```

and return `submitted` from `makeService`. Then:

```ts
test('RunAgentSkill opens a titled conversation and submits a background task', () => {
    const { svc, submitted } = makeService()
    const item: CatalogItem = { kind: AgentSkillKind.Skill, name: 'security-review', description: '' }
    const chat = svc.RunAgentSkill(item, '/A', 'Billing')
    expect(chat.Title).toBe('security-review · Billing')
    expect(bridge.started).toContain(chat.Id)
    expect(bridge.turns).toEqual([{ sessionId: chat.Id, text: '/security-review' }])   // seeded turn
    expect(submitted).toHaveLength(1)
    expect(submitted[0].title).toBe('security-review · Billing')
    // The task's open target reveals the conversation.
    expect(typeof submitted[0].open).toBe('function')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/agent-chat/services/tests/chat-sessions-service.test.ts`
Expected: FAIL — `seedInvocation` + `RunAgentSkill` don't exist.

- [ ] **Step 3: Implement**

In `chat-sessions-service.ts`:

- Add imports:

```ts
import { AgentSkillKind, type CatalogItem } from '../../../../../shared/agent-api.js'
import { BackgroundWorkService } from '../../background-work/services/background-work-service.js'
import { TaskKind } from '../../background-work/services/task-executor.js'
```

- Add the exported pure fn (module scope, below the class or above it):

```ts
// The first-turn text that invokes a catalog item. Skill → its slash command;
// agent → a natural-language instruction to use that subagent. (The exact CLI form
// for a named subagent is an open detail; this seam is trivial to adjust.)
export function seedInvocation(item: CatalogItem): string
{
    return item.kind === AgentSkillKind.Skill
        ? `/${item.name}`
        : `Use the "${item.name}" subagent for this task.`
}
```

- Refactor `NewConversation` to delegate to an internal `newSession(title)` so a custom title is possible:

```ts
    public NewConversation(): ChatSession { return this.newSession(`Chat ${this.Open.Count + 1}`) }

    private newSession(title: string): ChatSession
    {
        const sessionId = crypto.randomUUID()
        const chat = new ChatSession(sessionId, title, this.callbacks(), this.approvals)
        chat.setStatus(this.statusText())
        this.Open.Add(chat)
        this.dock.Add(chat)
        this.dock.SelectedPanel = chat
        this.set_property_value(ChatSessionsService.ActiveChatKey, chat)
        void this.agent.startSession(sessionId, this.currentCwd(), this.addDirs())
        return chat
    }
```

- Add a pending-runs map + the run method:

```ts
    // sessionId → resolver, fired when the seeded run's turn completes.
    private readonly pendingRuns = new Map<string, () => void>()

    // Launch a project's declared agent/skill as a seeded conversation tracked by a
    // Background Work task; clicking the task reveals the conversation.
    public RunAgentSkill(item: CatalogItem, _projectDir: string, projectName: string): ChatSession
    {
        const chat = this.newSession(`${item.name} · ${projectName}`)
        const seed = seedInvocation(item)
        // Optimistic echo + send through the shared bridge (same path as a user turn).
        chat.Reducer.beginUserTurn(seed)
        void this.agent.sendTurn(chat.Id, this.currentCwd(), this.addDirs(), seed)

        const turnDone = new Promise<void>((resolve) => this.pendingRuns.set(chat.Id, resolve))
        const bg = this.Provider.get(BackgroundWorkService.Key)
        bg?.submit({
            kind: TaskKind.Inline,
            title: `${item.name} · ${projectName}`,
            payload: async (ctx: { log(l: string): void }) => { ctx.log(`Running ${item.name}…`); await turnDone; return 'done' },
            open: () => { void this.Reveal(chat.Id) },
        })
        return chat
    }
```

- In `route`, resolve a pending run when its turn completes (add to the existing method, before/after `chat.apply(event)`):

```ts
    private route(sessionId: string, event: AgentEvent): void
    {
        const chat = this.Open.ToArray().find((c) => c.Id === sessionId)
        if (chat === undefined) return
        if (event.Kind === AgentEventKind.SessionStarted) void this.persist(chat, event.SessionId)
        if (event.Kind === AgentEventKind.TurnComplete)
        {
            const done = this.pendingRuns.get(sessionId)
            if (done !== undefined) { this.pendingRuns.delete(sessionId); done() }
        }
        chat.apply(event)
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/agent-chat/services/tests/chat-sessions-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/agent-chat/services/chat-sessions-service.ts src/renderer/src/modules/agent-chat/services/tests/chat-sessions-service.test.ts
git commit -m "feat(chat): RunAgentSkill — seed a conversation + track it as background work"
```

---

### Task 6: The "Run Agent / Skill" project submenu

Add a dynamic submenu to the project-header context menu, populated from the project's catalog, each item launching `RunAgentSkill`. Reuses the "Add New" `ItemsSource`/`ItemTemplate` pattern.

**Files:**
- Create: `src/renderer/src/modules/agent-chat/services/agent-skill-choice.ts` (`AgentSkillChoice` VM + `buildAgentSkillChoices`)
- Modify: `src/renderer/src/services/projects/open-project.ts` (add `AgentSkillChoices` + `HasAgentSkills` DPs)
- Modify: `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts` (populate them in `wireProjectCommands`)
- Modify: `src/renderer/src/modules/project-explorer/project-explorer.resources.mu` (the submenu + item template)
- Modify: `src/renderer/src/main.js` (ensure `ProjectAgentCatalog` is constructed)
- Modify: `src/renderer/src/app.mu` (register `ProjectAgentCatalog` service — via the agent-chat module `.services`)
- Modify: `src/renderer/src/modules/agent-chat/agent-chat.module.mu` (register `ProjectAgentCatalog`)
- Test: `src/renderer/src/modules/agent-chat/services/tests/agent-skill-choice.test.ts`

**Interfaces:**
- Consumes: `CatalogItem`, `ChatSessionsService.RunAgentSkill` (Task 5), `ProjectCatalog`.
- Produces:
  - `class AgentSkillChoice extends MuralBase { Label: string; Command: ICommand }`
  - `buildAgentSkillChoices(catalog: ProjectCatalog, run: (item: CatalogItem) => void): AgentSkillChoice[]` (agents first, then skills; label `agent: <name>` / `skill: <name>`)
  - `OpenProject.AgentSkillChoices: ObservableCollection<AgentSkillChoice>`, `OpenProject.HasAgentSkills: boolean`

- [ ] **Step 1: Write the failing test**

`src/renderer/src/modules/agent-chat/services/tests/agent-skill-choice.test.ts`:

```ts
import { test, expect } from 'vitest'
import { AgentSkillKind, type CatalogItem, type ProjectCatalog } from '../../../../../../shared/agent-api.js'
import { AgentSkillChoice, buildAgentSkillChoices } from '../agent-skill-choice.js'

const CATALOG: ProjectCatalog = {
    agents: [{ kind: AgentSkillKind.Agent, name: 'reviewer', description: 'd' }],
    skills: [{ kind: AgentSkillKind.Skill, name: 'security-review', description: 'd' }],
}

test('builds one choice per item, agents first, labelled by kind', () => {
    const chosen: CatalogItem[] = []
    const choices = buildAgentSkillChoices(CATALOG, (item) => chosen.push(item))
    expect(choices.map((c) => c.Label)).toEqual(['agent: reviewer', 'skill: security-review'])
    choices[1].Command.Execute(undefined)
    expect(chosen).toEqual([{ kind: AgentSkillKind.Skill, name: 'security-review', description: 'd' }])
})

test('an empty catalog yields no choices', () => {
    expect(buildAgentSkillChoices({ agents: [], skills: [] }, () => {})).toEqual([])
})

test('AgentSkillChoice exposes Label + Command', () => {
    const c = new AgentSkillChoice('agent: x', () => {})
    expect(c.Label).toBe('agent: x')
    expect(typeof c.Command.Execute).toBe('function')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/agent-chat/services/tests/agent-skill-choice.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the VM + builder**

`src/renderer/src/modules/agent-chat/services/agent-skill-choice.ts`:

```ts
// One row in the project's "Run Agent / Skill" submenu: a label + the command that
// launches that catalog item. Mirrors NewItemChoice (the "Add New" submenu row).
import { MetaData, MuralBase, RelayCommand, type ICommand } from '@pragmatic-lab/mural/runtime'
import { AgentSkillKind, type CatalogItem, type ProjectCatalog } from '../../../../../shared/agent-api.js'

export class AgentSkillChoice extends MuralBase
{
    public static readonly LabelKey = MuralBase.RegisterProperty<string>(AgentSkillChoice, 'Label', '', MetaData.None)
    public static readonly CommandKey = MuralBase.RegisterProperty<ICommand>(
        AgentSkillChoice, 'Command', undefined as unknown as ICommand, MetaData.None)

    constructor(label: string, run: () => void)
    {
        super()
        this.set_property_value(AgentSkillChoice.LabelKey, label)
        this.set_property_value(AgentSkillChoice.CommandKey, new RelayCommand(run))
    }

    public get Label(): string { return this.get_property_value(AgentSkillChoice.LabelKey) }
    public get Command(): ICommand { return this.get_property_value(AgentSkillChoice.CommandKey) }
}

// One choice per catalog item — agents first, then skills — each running `run(item)`.
export function buildAgentSkillChoices(catalog: ProjectCatalog, run: (item: CatalogItem) => void): AgentSkillChoice[]
{
    const items = [...catalog.agents, ...catalog.skills]
    return items.map((item) => new AgentSkillChoice(
        `${item.kind === AgentSkillKind.Agent ? 'agent' : 'skill'}: ${item.name}`,
        () => run(item),
    ))
}

export default AgentSkillChoice
```

- [ ] **Step 4: Run the VM/builder test**

Run: `npx vitest run src/renderer/src/modules/agent-chat/services/tests/agent-skill-choice.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the OpenProject DPs**

In `src/renderer/src/services/projects/open-project.ts`, add (mirroring `NewItemChoices`):

```ts
    // The "Run Agent / Skill" submenu choices — one per the project's declared
    // .claude/ agents + skills, populated async by ProjectExplorerService. Empty
    // (and HasAgentSkills=false) for a project with no .claude catalog.
    static readonly AgentSkillChoicesKey = MuralBase.RegisterProperty<ObservableCollection<import('../../modules/agent-chat/services/agent-skill-choice.js').AgentSkillChoice>>(
        OpenProject, 'AgentSkillChoices', undefined as unknown as ObservableCollection<import('../../modules/agent-chat/services/agent-skill-choice.js').AgentSkillChoice>, MetaData.None)
    static readonly HasAgentSkillsKey = MuralBase.RegisterProperty<boolean>(
        OpenProject, 'HasAgentSkills', false, MetaData.None)
```

and the accessors (near the other getters/setters):

```ts
    public get AgentSkillChoices(): ObservableCollection<import('../../modules/agent-chat/services/agent-skill-choice.js').AgentSkillChoice> { return this.get_property_value(OpenProject.AgentSkillChoicesKey) }
    public set AgentSkillChoices(v: ObservableCollection<import('../../modules/agent-chat/services/agent-skill-choice.js').AgentSkillChoice>) { this.set_property_value(OpenProject.AgentSkillChoicesKey, v) }
    public get HasAgentSkills(): boolean { return this.get_property_value(OpenProject.HasAgentSkillsKey) }
    public set HasAgentSkills(v: boolean) { this.set_property_value(OpenProject.HasAgentSkillsKey, v) }
```

> Using an inline `import('…')` type keeps `open-project.ts` free of a top-level dependency cycle on the agent-chat module. If the repo's lint forbids inline import types, add a top `import type { AgentSkillChoice } from '../../modules/agent-chat/services/agent-skill-choice.js'` instead and use the bare name.

- [ ] **Step 6: Populate in the explorer**

In `project-explorer-service.ts`, add imports:

```ts
import { ProjectAgentCatalog } from '../../agent-chat/services/project-agent-catalog.js'
import { ChatSessionsService } from '../../agent-chat/services/chat-sessions-service.js'
import { buildAgentSkillChoices } from '../../agent-chat/services/agent-skill-choice.js'
import { ObservableCollection } from '@pragmatic-lab/mural/runtime'   // if not already imported
```

At the end of `wireProjectCommands(op)`, add:

```ts
        void this.wireAgentSkillChoices(op)
```

and the new private method:

```ts
    // Fetch the project's .claude catalog and populate its "Run Agent / Skill"
    // submenu, each choice launching a background run via ChatSessionsService.
    private async wireAgentSkillChoices(op: OpenProject): Promise<void>
    {
        const catalog = this.Provider.get(ProjectAgentCatalog.Key)
        const chats = this.Provider.get(ChatSessionsService.Key)
        if (catalog === undefined || chats === undefined) return
        const found = await catalog.CatalogFor(op.Folder)
        const choices = buildAgentSkillChoices(found, (item) => { chats.RunAgentSkill(item, op.Folder, op.Name) })
        const collection = new ObservableCollection<ReturnType<typeof buildAgentSkillChoices>[number]>()
        for (const c of choices) collection.Add(c)
        op.AgentSkillChoices = collection
        op.HasAgentSkills = choices.length > 0
    }
```

- [ ] **Step 7: Add the menu markup**

In `project-explorer.resources.mu`, add an item-row template near `NewItemChoiceTemplate`:

```
    // One row in the "Run Agent / Skill" submenu.
    DataTemplate x:key="AgentSkillChoiceTemplate" [ DataType = AgentSkillChoice ] {
        MenuItem [ Header = $Label, Command = $Command ]
    }
```

Add its import at the top of the file (with the other imports):

```
import AgentSkillChoice from "./../agent-chat/services/agent-skill-choice.js"
```

> Confirm the relative path resolves from `modules/project-explorer/` to `modules/agent-chat/services/` — it is `../agent-chat/services/agent-skill-choice.js`.

In the `ProjectContextMenu` block, add the submenu item (place it just above `MenuSeparator` / `Close Project`):

```
        MenuItem
            [ Header = "Run Agent / Skill",
              Visibility = $HasAgentSkills << ToVisibility,
              ItemsControl.ItemsSource  = $AgentSkillChoices,
              ItemsControl.ItemTemplate = @AgentSkillChoiceTemplate ]
```

- [ ] **Step 8: Register `ProjectAgentCatalog` + construct it**

In `agent-chat.module.mu`, add to `.services`:

```
import ProjectAgentCatalog from "./services/project-agent-catalog.js"
```
```
        ProjectAgentCatalog
```

In `main.js`, construct it eagerly alongside the chat manager (so the explorer's async populate resolves the same instance):

```js
    app.Services.get(ProjectAgentCatalog.Key)
```
add its import:
```js
import { ProjectAgentCatalog } from './modules/agent-chat/services/project-agent-catalog.js'
```

- [ ] **Step 9: Compile, type-check, build, run affected tests**

Run:
```
npm run compile:mu
npx tsc -p tsconfig.web.json --noEmit
npx vitest run src/renderer/src/modules/agent-chat src/renderer/src/modules/background-work
npm run build
```
Expected: compile OK; the only type error is the pre-existing `toolbox-service-populate.test.ts` (TS2416, not ours); tests green; build succeeds.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/modules/agent-chat/services/agent-skill-choice.ts src/renderer/src/modules/agent-chat/services/tests/agent-skill-choice.test.ts src/renderer/src/services/projects/open-project.ts src/renderer/src/modules/project-explorer/services/project-explorer-service.ts src/renderer/src/modules/project-explorer/project-explorer.resources.mu src/renderer/src/modules/agent-chat/agent-chat.module.mu src/renderer/src/main.js
git commit -m "feat(agent): Run Agent / Skill project submenu + wiring"
```

---

### Task 7: e2e smoke — discovery + launch

Prove, in the real app, that a project's catalog is discoverable and that `RunAgentSkill` opens a conversation + submits a background task.

**Files:**
- Modify: `src/renderer/src/main.js` (expose `globalThis.__runAgent` dev hook)
- Create: `e2e/agent-skill-runner.spec.ts`

**Interfaces:**
- Consumes: `window.api.agent.listAgentsAndSkills`, `globalThis.__chats` (from the multi-conversation e2e), `globalThis.__runAgent`.

- [ ] **Step 1: Add the dev hook**

In `main.js`, right after `globalThis.__chats = chats`, add a small hook that runs a synthetic catalog item (so the e2e needs no real `.claude` fixture):

```js
        globalThis.__runAgent = () => chats.RunAgentSkill(
            { kind: 'skill', name: 'demo-skill', description: '' }, '/tmp/x', 'Demo')
```

- [ ] **Step 2: Write the e2e**

`e2e/agent-skill-runner.spec.ts`:

```ts
// Project agent/skill runner smoke.
//
// listAgentsAndSkills returns a well-formed catalog for a directory (no throw), and
// RunAgentSkill opens a titled conversation + submits a Background Work task —
// exercising discovery + run wiring end-to-end. Uses the dev hooks wired in main.js.
import { test, expect } from '@playwright/test'
import { launchPlexus, appErrors, type Launched } from './plexus-app'

let L: Launched

test.beforeAll(async () => { L = await launchPlexus(); await L.win.waitForTimeout(800) })
test.afterAll(async () => { await L?.app?.close() })

test('listAgentsAndSkills returns a catalog shape without error', async () => {
    const shape = await L.win.evaluate(async () => {
        const c = await globalThis.api.agent.listAgentsAndSkills('/tmp/does-not-exist')
        return { agents: Array.isArray(c.agents), skills: Array.isArray(c.skills) }
    })
    expect(shape).toEqual({ agents: true, skills: true })
    expect(appErrors(L.errors), appErrors(L.errors).join('\n')).toEqual([])
})

test('RunAgentSkill opens a titled conversation and adds a background task', async () => {
    const result = await L.win.evaluate(() => {
        const before = globalThis.__chats.Open.Count
        const chat = globalThis.__runAgent()
        return { title: chat.Title, grew: globalThis.__chats.Open.Count === before + 1 }
    })
    expect(result.title).toBe('demo-skill · Demo')
    expect(result.grew).toBe(true)
    expect(appErrors(L.errors), appErrors(L.errors).join('\n')).toEqual([])
})
```

- [ ] **Step 3: Build + run the e2e**

Run:
```
npm run build
npx playwright test agent-skill-runner.spec.ts
```
Expected: both tests PASS; no app errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/main.js e2e/agent-skill-runner.spec.ts
git commit -m "test(agent): e2e smoke — catalog discovery + RunAgentSkill launch"
```

---

## Self-Review

**Spec coverage (§12 first-cut scope → task):**
- `IAiProvider.listAgentsAndSkills` + `.claude` scan + IPC → Tasks 1, 2. ✓
- `ProjectAgentCatalog` (cache + invalidation) → Task 3. ✓
- Submenu of the project's agents/skills → Task 6 (project-header menu — see Deviation #1). ✓
- `AgentRunNodeContributor` (project-root, non-empty catalog) → **superseded** by the project-header `HasAgentSkills`-gated submenu (Deviation #1); same "only shows when the catalog is non-empty" behavior. ✓
- `ChatSessionsService.RunAgentSkill` + run tracking → Task 5 (Inline executor, not a new `AgentRunExecutor` — Deviation #2). ✓
- Background Work `submit({ open })` custom open-target → Task 4. ✓
- Discovery/`ProjectAgentCatalog`/submenu/run/open-override tests → Tasks 1,3,4,5,6 + e2e Task 7. ✓
- Deferred (global `~/.claude`, scheduling/recurrence) → out of scope, untouched. ✓

**Placeholder scan:** No "TBD"/"handle edge cases". Every code step has real code; every test step real assertions. The one genuinely-open detail from the spec — the exact CLI form to invoke a *named subagent* vs a *skill* — is isolated in the pure, unit-tested `seedInvocation` (a one-line change if the real CLI form differs), and flagged inline. The `makeService()` reuse in Tasks 4/5 references an existing helper; a fallback instruction is given if the file lacks one.

**Type consistency:**
- `CatalogItem { kind: AgentSkillKind; name; description }` / `ProjectCatalog { agents; skills }` identical across Tasks 1,2,3,5,6. ✓
- `listAgentsAndSkills(projectDir): Promise<ProjectCatalog>` consistent on `IAiProvider` (Task 2), `IAgentApi` (Task 2), `ProjectAgentCatalog.CatalogFor` (Task 3). ✓
- `RunAgentSkill(item, projectDir, projectName): ChatSession` consistent between Task 5 (def) and Task 6 (call). ✓
- `buildAgentSkillChoices(catalog, run)` + `AgentSkillChoice(label, run)` consistent Task 6. ✓
- `BackgroundTask.open?` consistent Task 4 (def) → Task 5 (use). ✓
- `seedInvocation` returns `/${name}` (skill) and the subagent instruction (agent) — asserted identically in Tasks 5. ✓

**Open risks flagged (not gaps):**
- Real CLI behavior for `/skill-name` and subagent invocation in headless stream-json mode is unverified; isolated in `seedInvocation` and behind fakes in every unit test (Deviation-independent).
- Catalog cache is not auto-invalidated on external `.claude` edits in v1; `ProjectAgentCatalog.Invalidate` exists for a future `ProjectRescanService` hook (noted, not wired — YAGNI until a rescan path needs it).

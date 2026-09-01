# Agent Tracks Open-Project Directories — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The in-app agent runs against the set of open project directories (first = `cwd`, rest = `--add-dir`), re-targeting the next turn whenever a project is opened/created/closed.

**Architecture:** `OpenProjectsStore` becomes the observable source of open-project folders. The agent IPC + provider carry an `addDirs` list. `AgentSession` restarts the CLI when the `(cwd, addDirs)` target changes. `AgentService` derives the target from the store and passes it every turn.

**Tech Stack:** TypeScript (main + renderer), Electron IPC, Vitest.

## Global Constraints

- Every test file in a `tests/` subfolder next to its source.
- Real TS enums; no new string-literal union types.
- Commits authored `Eugene Napryaglo <evgen.napryaglo@gmail.com>`; message ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Do NOT stage `src/renderer/src/modules/ontologies/services/ontologies-service.ts`.
- Verify from `Plexus/`: `npm test`, `npm run typecheck`.
- Between Task 1 and Task 3 the main-process IPC handler and the renderer bridge are momentarily out of step (main expects `addDirs`, renderer not yet sending it). Each task stays green (unit tests don't cross the IPC boundary); the app is consistent again after Task 3.

---

## Task 0: Branch

- [ ] **Step 1** — `git checkout -b agent-open-projects-dirs` (spec committed to `main`).

---

## Task 1: Provider + session carry `addDirs` (main process)

**Files:**
- Modify: `src/main/agent/ai-provider.ts`
- Modify: `src/main/agent/claude-cli-provider.ts`
- Modify: `src/main/agent/agent-session.ts`
- Modify: `src/main/agent.ts`
- Test: `src/main/agent/tests/agent-session.test.ts` (update signature + add restart cases)
- Test: `src/main/agent/tests/claude-cli-provider.test.ts` (update signature + add `--add-dir` case)

**Interfaces:**
- Produces: `IAiProvider.start(workingDirectory, addDirs: readonly string[], onEvent)`; `AgentSession.start(cwd, addDirs)`, `AgentSession.send(cwd, addDirs, text)` (restarts on target change).

- [ ] **Step 1: Update `ai-provider.ts`** — add `addDirs` to the provider contract:

```ts
export interface IAiProvider
{
    readonly Id: string;
    start(workingDirectory: string, addDirs: readonly string[], onEvent: (event: AgentEvent) => void): AiProviderSession;
}
```

- [ ] **Step 2: Update `claude-cli-provider.test.ts`** — the existing spawn test now passes `[]`, plus a new `--add-dir` case:

Change the existing spawn test's call to `.start('/proj', [], () => {})` (args assertion unchanged — no add-dirs). Change the other two `start('/proj', () => {})` calls in that file to `start('/proj', [], () => {})`. Then add:

```ts
test('appends --add-dir for each extra directory, spawning at the cwd', () => {
    let captured: { args: string[]; options: { cwd: string } } | undefined
    const spawn: SpawnFn = (_command, args, options) => { captured = { args, options }; return fakeChild().child }
    new ClaudeCliProvider('claude', spawn).start('/proj', ['/lib-a', '/lib-b'], () => {})
    expect(captured?.options.cwd).toBe('/proj')
    expect(captured?.args).toEqual([
        '-p', '--output-format', 'stream-json', '--input-format', 'stream-json',
        '--include-partial-messages', '--verbose', '--permission-mode', 'acceptEdits',
        '--add-dir', '/lib-a', '--add-dir', '/lib-b',
    ])
})
```

- [ ] **Step 3: Run — fail** (`npx vitest run src/main/agent/tests/claude-cli-provider.test.ts`). Expected: signature/arg mismatch.

- [ ] **Step 4: Update `claude-cli-provider.ts`** — thread `addDirs` into the spawn args:

```ts
    public start(workingDirectory: string, addDirs: readonly string[], onEvent: (event: AgentEvent) => void): AiProviderSession
    {
        const args = [...CLI_ARGS, ...addDirs.flatMap((d) => ['--add-dir', d])]
        const child = this.spawnFn(this.binaryPath, args, { cwd: workingDirectory })
```

(the rest of `start` is unchanged).

- [ ] **Step 5: Run — pass** (`npx vitest run src/main/agent/tests/claude-cli-provider.test.ts`).

- [ ] **Step 6: Update `agent-session.test.ts`** — new `recordingProvider` signature + restart cases. Replace the `start` in `recordingProvider`:

```ts
        start: (cwd, addDirs, onEvent): AiProviderSession => {
            const rec = { cwd, addDirs: [...addDirs], onEvent, sent: [] as string[], disposed: false, aborted: false }
            started.push(rec)
```

and widen the `started` element type to include `addDirs: string[]`. Update the existing calls: `session.send('/proj', 'hello')` → `session.send('/proj', [], 'hello')` (both send tests); `session.start('/a')`/`session.start('/b')` → `session.start('/a', [])`/`session.start('/b', [])`. Fix the two `started[0].cwd` assertions (still valid). Add:

```ts
test('send reuses the session when the (cwd, addDirs) target is unchanged', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), () => {})
    session.send('/proj', ['/lib'], 'one')
    session.send('/proj', ['/lib'], 'two')
    expect(started).toHaveLength(1)
    expect(started[0].sent).toEqual(['one', 'two'])
})

test('send restarts the session when the cwd changes', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), () => {})
    session.send('/a', [], 'one')
    session.send('/b', [], 'two')
    expect(started).toHaveLength(2)
    expect(started[0].disposed).toBe(true)
    expect(started[1].cwd).toBe('/b')
})

test('send restarts the session when the addDirs set changes', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), () => {})
    session.send('/proj', ['/lib-a'], 'one')
    session.send('/proj', ['/lib-a', '/lib-b'], 'two')
    expect(started).toHaveLength(2)
    expect(started[1].addDirs).toEqual(['/lib-a', '/lib-b'])
})
```

- [ ] **Step 7: Run — fail** (`npx vitest run src/main/agent/tests/agent-session.test.ts`). Expected: `send`/`start` arity + restart behavior.

- [ ] **Step 8: Rewrite `agent-session.ts`** — track the target, restart on change:

```ts
import type { AiProviderSession } from './ai-provider.js'
import type { AiProviderService } from './ai-provider-service.js'
import type { AgentEvent } from '../../shared/agent-api.js'

// One live conversation, bound to the active provider. Holds the current
// provider session + its target directories; starting a new one disposes the
// old (v1 = a single session). The target is (cwd, addDirs); a send whose target
// differs re-spawns the provider so the agent tracks the open projects.
export class AgentSession
{
    private current: AiProviderSession | null = null
    private target: { cwd: string; addDirs: readonly string[] } | null = null

    constructor(
        private readonly providers: AiProviderService,
        private readonly emit: (event: AgentEvent) => void,
    ) {}

    public start(workingDirectory: string, addDirs: readonly string[]): void
    {
        this.current?.dispose()
        this.current = this.providers.active().start(workingDirectory, addDirs, this.emit)
        this.target = { cwd: workingDirectory, addDirs: [...addDirs] }
    }

    public send(workingDirectory: string, addDirs: readonly string[], text: string): void
    {
        if (this.current === null || !this.sameTarget(workingDirectory, addDirs)) this.start(workingDirectory, addDirs)
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
        this.target = null
    }

    private sameTarget(cwd: string, addDirs: readonly string[]): boolean
    {
        const t = this.target
        return t !== null && t.cwd === cwd
            && t.addDirs.length === addDirs.length
            && t.addDirs.every((d, i) => d === addDirs[i])
    }
}
```

- [ ] **Step 9: Update `agent.ts`** — the IPC handlers forward `addDirs`:

```ts
    ipcMain.handle(AgentChannel.StartSession, (_e, workingDirectory: string, addDirs: readonly string[]): void => {
        session.start(workingDirectory, addDirs)
    })
    ipcMain.handle(AgentChannel.SendTurn, (_e, workingDirectory: string, addDirs: readonly string[], text: string): void => {
        session.send(workingDirectory, addDirs, text)
    })
```

- [ ] **Step 10: Run — pass** (`npx vitest run src/main/agent/tests/`) + `npm run typecheck`.

- [ ] **Step 11: Commit** (main-process files + their tests; NOT `ontologies-service.ts`):

```bash
git add src/main/agent/ai-provider.ts src/main/agent/claude-cli-provider.ts \
        src/main/agent/agent-session.ts src/main/agent.ts \
        src/main/agent/tests/agent-session.test.ts src/main/agent/tests/claude-cli-provider.test.ts
git commit -m "feat(agent): sessions carry an addDirs list; restart on target change

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `OpenProjectsStore` becomes observable

**Files:**
- Modify: `src/renderer/src/services/projects/open-projects-store.ts`
- Test: `src/renderer/src/services/projects/tests/open-projects-store.test.ts` (extend)

**Interfaces:**
- Produces: `OpenProjectsStore.Subscribe(listener: (folders: readonly string[]) => void): () => void`; `Current(): readonly string[]`; `Add`/`Remove` notify on an actual change (dedup no-op does not).

- [ ] **Step 1: Read** the existing `tests/open-projects-store.test.ts` to see its fake-fs harness (it stubs `FileSystemService` + `EnvironmentService`). Reuse that harness for the new cases.

- [ ] **Step 2: Add tests** — append:

```ts
test('Add notifies subscribers with the updated folder list', async () => {
    const store = makeStore()   // per the existing harness in this file
    const seen: string[][] = []
    store.Subscribe((f) => seen.push([...f]))
    await store.Add('/a')
    await store.Add('/b')
    expect(seen).toEqual([['/a'], ['/a', '/b']])
})

test('a duplicate Add does not notify (the set did not change)', async () => {
    const store = makeStore()
    await store.Add('/a')
    const seen: string[][] = []
    store.Subscribe((f) => seen.push([...f]))
    await store.Add('/a')   // already present
    expect(seen).toEqual([])
})

test('Remove notifies; Current reflects the mirror; unsubscribe stops delivery', async () => {
    const store = makeStore()
    await store.Add('/a'); await store.Add('/b')
    const seen: string[][] = []
    const off = store.Subscribe((f) => seen.push([...f]))
    await store.Remove('/a')
    expect(store.Current()).toEqual(['/b'])
    off()
    await store.Remove('/b')
    expect(seen).toEqual([['/b']])   // only the pre-unsubscribe change delivered
})
```

If the existing file has no `makeStore()` helper, construct the store the same way the existing tests do (a `ServiceProvider` with fake `FileSystemService` + `EnvironmentService` instances) and inline it.

- [ ] **Step 3: Run — fail** (`Subscribe`/`Current` missing).

- [ ] **Step 4: Implement** — add the in-memory mirror + notification to `open-projects-store.ts`:

```ts
    // In-memory mirror of the persisted list, so Current() is synchronous and
    // Add/Remove can notify with the new set. Lazily loaded on first List().
    private folders: string[] | null = null
    private readonly listeners = new Set<(folders: readonly string[]) => void>()

    // The stored open-project folders. Tolerates a missing/corrupt file → [].
    public async List(): Promise<readonly string[]>
    {
        if (this.folders !== null) return this.folders
        try {
            if (!(await this.fs.Exists(this.filePath))) { this.folders = []; return this.folders }
            const parsed = JSON.parse(await this.fs.ReadText(this.filePath))
            this.folders = Array.isArray(parsed) ? (parsed as string[]) : []
        } catch {
            this.folders = []
        }
        return this.folders
    }

    // The current open folders (the in-memory mirror; [] until first load).
    public Current(): readonly string[] { return this.folders ?? [] }

    // Subscribe to open-set changes; returns an unsubscribe thunk. Fired by
    // Add/Remove when the set actually changes.
    public Subscribe(listener: (folders: readonly string[]) => void): () => void
    {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    public async Add(folder: string): Promise<void>
    {
        const list = [...await this.List()]
        if (list.includes(folder)) return
        list.push(folder)
        this.folders = list
        await this.write(list)
        this.notify()
    }

    public async Remove(folder: string): Promise<void>
    {
        const list = (await this.List()).filter((f) => f !== folder)
        this.folders = list
        await this.write(list)
        this.notify()
    }

    private notify(): void
    {
        for (const l of this.listeners) l(this.Current())
    }
```

(Replace the existing `List`/`Add`/`Remove` bodies; keep `filePath`, `write`, `fs`, `env`, `join`.) Note: `Remove` notifies unconditionally — removing an absent folder produces the same list, but the explorer only removes open folders, and an extra identical notification is harmless. If you prefer symmetry with `Add`, guard: only notify when `list.length` changed.

- [ ] **Step 5: Run — pass.** Typecheck.

- [ ] **Step 6: Commit** `feat(projects): OpenProjectsStore is observable (Subscribe/Current + notify on change)`.

---

## Task 3: IPC surface + `AgentService` derives directories from open projects

**Files:**
- Modify: `src/shared/agent-api.ts` (`IAgentApi` signatures)
- Modify: `src/preload/index.ts` (bridge passes `addDirs`)
- Modify: `src/renderer/src/modules/agent-chat/services/agent-service.ts`
- Test: `src/renderer/src/modules/agent-chat/services/tests/agent-service.test.ts` (create)

**Interfaces:**
- Consumes: `OpenProjectsStore.Subscribe`/`Current` (Task 2); `AgentSession.send(cwd, addDirs, text)` via IPC (Task 1).
- Produces: `IAgentApi.startSession(cwd, addDirs)`, `sendTurn(cwd, addDirs, text)`; `AgentService` targeting the open-project set.

- [ ] **Step 1: Update `shared/agent-api.ts`** — the bridge contract:

```ts
export interface IAgentApi
{
    startSession(workingDirectory: string, addDirs: readonly string[]): Promise<void>;
    // The renderer supplies the working directory + extra dirs each turn; a turn
    // lazily starts (or re-targets) the session (see AgentSession).
    sendTurn(workingDirectory: string, addDirs: readonly string[], text: string): Promise<void>;
    abort(): Promise<void>;
    onEvent(handler: (event: AgentEvent) => void): () => void;
}
```

- [ ] **Step 2: Update `preload/index.ts`** — pass `addDirs` through `invoke` (lines ~74-77):

```ts
const agent: IAgentApi = {
  startSession: (workingDirectory: string, addDirs: readonly string[]): Promise<void> =>
    ipcRenderer.invoke(AgentChannel.StartSession, workingDirectory, addDirs),
  sendTurn: (workingDirectory: string, addDirs: readonly string[], text: string): Promise<void> =>
    ipcRenderer.invoke(AgentChannel.SendTurn, workingDirectory, addDirs, text),
  // abort + onEvent unchanged
```

(keep the existing `abort` and `onEvent` bodies).

- [ ] **Step 3: Write the failing test** — `tests/agent-service.test.ts`:

```ts
import { test, expect, beforeEach, afterEach } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import type { IAgentApi, AgentEvent } from '../../../../../shared/agent-api.js'
import { EnvironmentService } from '../../../services/environment/environment-service.js'
import { OpenProjectsStore } from '../../../services/projects/open-projects-store.js'
import AgentService from '../agent-service.js'

// A fake bridge recording turns; a fake store we can drive; a fake env.
function fakeAgent(): { api: IAgentApi; turns: Array<{ cwd: string; addDirs: readonly string[]; text: string }> } {
    const turns: Array<{ cwd: string; addDirs: readonly string[]; text: string }> = []
    const api: IAgentApi = {
        startSession: () => Promise.resolve(),
        sendTurn: (cwd, addDirs, text) => { turns.push({ cwd, addDirs, text }); return Promise.resolve() },
        abort: () => Promise.resolve(),
        onEvent: () => () => {},
    }
    return { api, turns }
}

// A minimal fake OpenProjectsStore (Current + Subscribe + a test-only push).
function fakeStore(initial: string[] = []) {
    let folders = [...initial]
    const listeners = new Set<(f: readonly string[]) => void>()
    return {
        Current: () => folders,
        List: () => Promise.resolve(folders),
        Subscribe: (l: (f: readonly string[]) => void) => { listeners.add(l); return () => listeners.delete(l) },
        push: (next: string[]) => { folders = next; for (const l of listeners) l(folders) },
    }
}

function providerWith(store: unknown): ServiceProvider {
    const provider = new ServiceProvider()
    provider.registerInstance(OpenProjectsStore.Key, store as OpenProjectsStore)
    provider.registerInstance(EnvironmentService.Key, { CurrentDirectory: '/fallback' } as EnvironmentService)
    return provider
}

let agentApi: ReturnType<typeof fakeAgent>
beforeEach(() => { agentApi = fakeAgent(); (globalThis as unknown as { api: unknown }).api = { agent: agentApi.api } })
afterEach(() => { delete (globalThis as unknown as { api?: unknown }).api })

test('a turn targets the open projects: first = cwd, rest = addDirs', () => {
    const store = fakeStore(['/A', '/B', '/C'])
    const svc = new AgentService(providerWith(store))
    svc.Draft = 'hi'
    svc.SendCommand.Execute(undefined)
    expect(agentApi.turns).toEqual([{ cwd: '/A', addDirs: ['/B', '/C'], text: 'hi' }])
})

test('with no open project the turn falls back to CurrentDirectory, no addDirs', () => {
    const svc = new AgentService(providerWith(fakeStore([])))
    svc.Draft = 'hi'
    svc.SendCommand.Execute(undefined)
    expect(agentApi.turns).toEqual([{ cwd: '/fallback', addDirs: [], text: 'hi' }])
})

test('a store change re-targets the next turn and updates Status', () => {
    const store = fakeStore(['/A'])
    const svc = new AgentService(providerWith(store))
    store.push(['/A', '/B'])
    expect(svc.Status).toMatch(/\/A/)
    svc.Draft = 'go'
    svc.SendCommand.Execute(undefined)
    expect(agentApi.turns[0]).toEqual({ cwd: '/A', addDirs: ['/B'], text: 'go' })
})
```

- [ ] **Step 4: Run — fail** (`AgentService` still sends `(cwd, text)`; no store wiring).

- [ ] **Step 5: Rewrite `agent-service.ts`** — derive the directory set from the store:

Replace the imports/fields/constructor/send. Key changes:

```ts
import { EnvironmentService } from '../../../services/environment/environment-service.js'
import { OpenProjectsStore } from '../../../services/projects/open-projects-store.js'
// ...
    private readonly agent: IAgentApi
    private readonly fallbackCwd: string
    private readonly store: OpenProjectsStore
    private workingDirs: readonly string[] = []
    private unsubscribe: (() => void) | undefined

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
        this.fallbackCwd = provider.get(EnvironmentService.Key)?.CurrentDirectory ?? ''
        this.store = provider.getRequired(OpenProjectsStore.Key)

        this.set_property_value(AgentService.TranscriptKey, this.reducer.Transcript)
        this.set_property_value(AgentService.SendCommandKey, new RelayCommand(() => this.send()))
        this.set_property_value(AgentService.SubmitCommandKey, new RelayCommand((arg) => {
            if ((arg as { Key?: unknown } | undefined)?.Key === Key.Return) this.send()
        }))

        this.agent.onEvent((event) => this.reducer.apply(event))

        // Track the open-project set: seed from the store (force a load), then
        // follow changes. Each change re-targets the NEXT turn + updates Status.
        this.applyDirs(this.store.Current())
        void this.store.List().then((dirs) => this.applyDirs(dirs))
        this.unsubscribe = this.store.Subscribe((dirs) => this.applyDirs(dirs))
    }

    private applyDirs(dirs: readonly string[]): void
    {
        this.workingDirs = [...dirs]
        const cwd = dirs.length > 0 ? dirs[0] : this.fallbackCwd
        const extra = dirs.length > 1 ? ` (+${dirs.length - 1} more)` : ''
        this.set_property_value(AgentService.StatusKey, `Agent directory: ${cwd}${extra}`)
    }

    public Dispose(): void { this.unsubscribe?.() }

    private send(): void
    {
        const text = this.Draft.trim()
        if (text === '') return
        const dirs = this.workingDirs
        const cwd = dirs.length > 0 ? dirs[0] : this.fallbackCwd
        const addDirs = dirs.length > 0 ? dirs.slice(1) : []
        this.reducer.beginUserTurn(text)
        void this.agent.sendTurn(cwd, addDirs, text)
        this.set_property_value(AgentService.DraftKey, '')
    }
```

Remove the old `private readonly cwd: string` field and its assignment. Keep everything else (transcript, accessors).

- [ ] **Step 6: Run — pass** (`npx vitest run src/renderer/src/modules/agent-chat/services/tests/agent-service.test.ts`).

- [ ] **Step 7: Full typecheck + suite** — `npm run typecheck && npm test`. All green.

- [ ] **Step 8: Commit** (shared + preload + renderer service + test):

```bash
git add src/shared/agent-api.ts src/preload/index.ts \
        src/renderer/src/modules/agent-chat/services/agent-service.ts \
        src/renderer/src/modules/agent-chat/services/tests/agent-service.test.ts
git commit -m "feat(agent): run against the open-project directories, re-targeting on change

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Finish the branch

- [ ] **Step 1: Gate** — `npm run typecheck && npm test` green; `git status` shows only `ontologies-service.ts` unstaged.
- [ ] **Step 2:** Invoke `superpowers:finishing-a-development-branch` — verify, present the 4 options, execute the choice (established pattern: merge to `main` + push).

---

## Self-Review Notes

- **Spec coverage:** unit 1 → Task 2; unit 2 (IPC) → Task 1 (main handler) + Task 3 (shared/preload); unit 3 → Task 1; unit 4 → Task 1; unit 5 → Task 3. Status line → Task 3 `applyDirs`. Fallback → Task 3 `send`/`applyDirs`.
- **Type consistency:** `start(cwd, addDirs, onEvent)` / `send(cwd, addDirs, text)` uniform across provider, session, IPC handler, bridge, `sendTurn`. `addDirs: readonly string[]` everywhere. `Subscribe`/`Current` names match between store impl, its test, and `AgentService`.
- **Ripple check:** existing `agent-session.test.ts` + `claude-cli-provider.test.ts` calls updated to the new arity in Task 1 Steps 2/6.
- **No placeholders:** every code step shows full code; `makeStore()` in Task 2 is resolved against the existing test harness in Step 1.
```

# Background Work Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable Plexus renderer subsystem that runs background operations behind a pluggable-executor abstraction and surfaces each one as a live entry in a status-bar list, with per-task progress, cancellation, a result/error, and an output panel that opens as a document tab.

**Architecture:** Three seams — a **task** (kind + payload + observable handle), an **`ITaskExecutor`** strategy registered per kind (inline async now; Web Worker / IPC later behind the same seam), and a root-registered **`BackgroundWorkService`** manager that schedules by per-executor capacity, owns the observable task registry, and drives a status-bar dock. Mirrors the existing `ProblemsService` + `@ProblemsDock` pattern for the surfacing.

**Tech Stack:** TypeScript, `@pragmatic-tech-ai/mural` (`ServiceBase`, `MuralBase` DPs, `ObservableCollection`, `RelayCommand`), mural `.mu` markup compiled via `compile:mu`, Vitest (tests in `tests/` subfolders), Playwright/Electron e2e.

**Spec:** [docs/superpowers/specs/2026-08-30-background-work-service-design.md](../specs/2026-08-30-background-work-service-design.md)

## Global Constraints

- **Enums, never string-literal unions** — `TaskKind`, `TaskStatus` are real `enum`s with explicit string values (PascalCase members). No `x === 'running'` against a raw literal.
- **Every test file lives in a `tests/` subfolder** next to the code it exercises (`services/tests/foo.test.ts`, never `services/foo.test.ts`).
- **MVVM / mural conventions** — view-observable state lives on `MuralBase` DPs via `MuralBase.RegisterProperty`; services extend `ServiceBase` and resolve siblings via `this.Provider.get(Key)`.
- **Render through templates only** — all visible chrome via `DataTemplate`/`Style`/binding in `.mu`; no hardcoded visuals in TS.
- **New `.mu` files must be added to the `compile:mu` script's explicit file list** in `package.json`, before `app.mu`.
- **Consumed mural version:** `@pragmatic-tech-ai/mural` `^0.40.0` (already installed).
- **Scope of this plan:** the reusable subsystem + one **demo task** for end-to-end UI validation. Completion toasts, publish migration, and layout migration are follow-up plans (see end).

---

## File Structure

```
modules/background-work/
  background-work.module.mu            # module: .ShellControls (status-bar dock)
  background-work.resources.mu         # @BackgroundWorkDock + DataTemplate[TaskHandle] + DataTemplate[TaskOutputDocument]
  services/
    task-executor.ts                   # TaskKind enum, BackgroundTask, ITaskContext, ITaskExecutor, TaskExecutorRegistry
    task-handle.ts                     # TaskStatus enum, TaskHandle (MuralBase VM)
    inline-executor.ts                 # InlineExecutor (reference executor)
    task-output-document.ts            # TaskOutputDocument (IDocument)
    background-work-service.ts         # BackgroundWorkService manager + BackgroundWorkServiceKey
    tests/
      task-executor.test.ts
      task-handle.test.ts
      inline-executor.test.ts
      background-work-service.test.ts
      task-output-document.test.ts
```

App wiring touches: `app.mu` (register service + module + merge resources), `main.js` (eager-construct + dev demo hook), `package.json` (`compile:mu` list). e2e: `e2e/background-work.spec.ts`.

Each file has one responsibility; the manager is the only stateful hub, everything else is a small value/VM/strategy that can be understood and tested in isolation.

---

### Task 1: Executor seam + registry

**Files:**
- Create: `src/renderer/src/modules/background-work/services/task-executor.ts`
- Test: `src/renderer/src/modules/background-work/services/tests/task-executor.test.ts`

**Interfaces:**
- Produces: `enum TaskKind { Inline='inline', Publish='publish', Layout='layout' }`; `interface BackgroundTask<P>{ kind:TaskKind|string; title:string; payload:P }`; `interface ITaskContext{ report(fraction:number,note?:string):void; log(line:string):void; readonly signal:AbortSignal; throwIfCancelled():void }`; `interface ITaskExecutor<P,R>{ readonly kind:TaskKind|string; readonly capacity:number; run(payload:P,ctx:ITaskContext):Promise<R> }`; `class TaskExecutorRegistry { register(e:ITaskExecutor):void; get(kind:TaskKind|string):ITaskExecutor|undefined }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/task-executor.test.ts
import { describe, it, expect } from 'vitest'
import { TaskExecutorRegistry, TaskKind, type ITaskExecutor } from '../task-executor.js'

function stub(kind: string): ITaskExecutor {
    return { kind, capacity: 1, run: async () => undefined }
}

describe('TaskExecutorRegistry', () => {
    it('returns undefined for an unregistered kind', () => {
        expect(new TaskExecutorRegistry().get(TaskKind.Publish)).toBeUndefined()
    })
    it('registers and resolves an executor by kind', () => {
        const r = new TaskExecutorRegistry()
        const e = stub(TaskKind.Publish)
        r.register(e)
        expect(r.get(TaskKind.Publish)).toBe(e)
    })
    it('later registration for the same kind overrides the earlier one', () => {
        const r = new TaskExecutorRegistry()
        const first = stub(TaskKind.Layout), second = stub(TaskKind.Layout)
        r.register(first); r.register(second)
        expect(r.get(TaskKind.Layout)).toBe(second)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/background-work/services/tests/task-executor.test.ts`
Expected: FAIL — cannot resolve `../task-executor.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// task-executor.ts
// The pluggable background-work seam: a task is a `kind` + `title` + `payload`;
// an executor registered for that kind actually runs it, talking back only
// through ITaskContext (so a Web Worker executor can relay the same calls over
// postMessage). See docs/superpowers/specs/2026-08-30-background-work-service-design.md.

export enum TaskKind {
    Inline  = 'inline',   // payload IS an async fn — convenience for one-off jobs
    Publish = 'publish',
    Layout  = 'layout',
}

export interface BackgroundTask<P = unknown> {
    kind:    TaskKind | string
    title:   string
    payload: P
}

// The executor's only channel back to the task while it runs.
export interface ITaskContext {
    report(fraction: number, note?: string): void   // 0..1; omit to stay indeterminate
    log(line: string): void                         // -> the task's output panel
    readonly signal: AbortSignal                    // cancellation
    throwIfCancelled(): void
}

// One execution strategy, registered by kind.
export interface ITaskExecutor<P = unknown, R = unknown> {
    readonly kind:     TaskKind | string
    readonly capacity: number                       // max concurrent of this kind (Infinity ok)
    run(payload: P, ctx: ITaskContext): Promise<R>
}

// Kind -> executor. Last registration wins (lets an app override a default).
export class TaskExecutorRegistry {
    private readonly byKind = new Map<string, ITaskExecutor>()
    public register(executor: ITaskExecutor): void { this.byKind.set(String(executor.kind), executor) }
    public get(kind: TaskKind | string): ITaskExecutor | undefined { return this.byKind.get(String(kind)) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/background-work/services/tests/task-executor.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/background-work/services/task-executor.ts src/renderer/src/modules/background-work/services/tests/task-executor.test.ts
git commit -m "feat(background-work): task/executor seam + registry"
```

---

### Task 2: TaskStatus + TaskHandle VM

**Files:**
- Create: `src/renderer/src/modules/background-work/services/task-handle.ts`
- Test: `src/renderer/src/modules/background-work/services/tests/task-handle.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 at type level (self-contained).
- Produces: `enum TaskStatus { Queued, Running, Succeeded, Failed, Cancelling, Cancelled }` (string values); `class TaskHandle extends MuralBase` with read DPs `Title,Status,Progress,IsIndeterminate,Note,Output,Error,IsRunning,IsQueued,IsDone` and command DPs `CancelCommand,OpenOutputCommand`; readonly `Id:string`, `Kind:string`, `Signal:AbortSignal`, `Done:Promise<unknown>`; methods `report(f,note?)`, `log(line)`, `markRunning()`, `succeed(r)`, `fail(e)`, `cancel()`, `finishCancelled()`. Constructor: `new TaskHandle({ id, title, kind })`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/task-handle.test.ts
import { describe, it, expect } from 'vitest'
import { TaskHandle, TaskStatus } from '../task-handle.js'

const make = () => new TaskHandle({ id: 't1', title: 'Job', kind: 'inline' })

describe('TaskHandle', () => {
    it('starts Queued and indeterminate', () => {
        const h = make()
        expect(h.Status).toBe(TaskStatus.Queued)
        expect(h.IsQueued).toBe(true)
        expect(h.IsIndeterminate).toBe(true)
        expect(h.IsDone).toBe(false)
    })

    it('report() sets determinate progress + note', () => {
        const h = make()
        h.report(0.4, 'step 2')
        expect(h.IsIndeterminate).toBe(false)
        expect(h.Progress).toBeCloseTo(0.4)
        expect(h.Note).toBe('step 2')
    })

    it('report() clamps to 0..1', () => {
        const h = make(); h.report(1.5)
        expect(h.Progress).toBe(1)
    })

    it('log() accumulates output lines', () => {
        const h = make(); h.log('a'); h.log('b')
        expect(h.Output).toBe('a\nb\n')
    })

    it('succeed() resolves Done with the result and marks Succeeded', async () => {
        const h = make(); h.markRunning(); h.succeed(42)
        expect(h.Status).toBe(TaskStatus.Succeeded)
        expect(h.IsDone).toBe(true)
        expect(h.IsRunning).toBe(false)
        await expect(h.Done).resolves.toBe(42)
    })

    it('fail() rejects Done and records the error', async () => {
        const h = make(); h.markRunning(); h.fail(new Error('boom'))
        expect(h.Status).toBe(TaskStatus.Failed)
        expect(h.Error).toBe('boom')
        await expect(h.Done).rejects.toThrow('boom')
    })

    it('cancel() on a queued task goes straight to Cancelled and aborts the signal', async () => {
        const h = make()
        expect(h.Signal.aborted).toBe(false)
        h.cancel()
        expect(h.Status).toBe(TaskStatus.Cancelled)
        expect(h.Signal.aborted).toBe(true)
        await expect(h.Done).rejects.toMatchObject({ name: 'AbortError' })
    })

    it('cancel() on a running task enters Cancelling and aborts; finishCancelled() completes it', async () => {
        const h = make(); h.markRunning(); h.cancel()
        expect(h.Status).toBe(TaskStatus.Cancelling)
        expect(h.Signal.aborted).toBe(true)
        h.finishCancelled()
        expect(h.Status).toBe(TaskStatus.Cancelled)
        await expect(h.Done).rejects.toMatchObject({ name: 'AbortError' })
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/background-work/services/tests/task-handle.test.ts`
Expected: FAIL — cannot resolve `../task-handle.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// task-handle.ts
import { MuralBase, MetaData, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'

// Lifecycle of one background task.
export enum TaskStatus {
    Queued     = 'queued',
    Running    = 'running',
    Succeeded  = 'succeeded',
    Failed     = 'failed',
    Cancelling = 'cancelling',
    Cancelled  = 'cancelled',
}

function abortError(): DOMException { return new DOMException('Task cancelled', 'AbortError') }

// The live view-model for one background task — one row in the status-bar list
// and the backing model for its output document. A MuralBase so the .mu
// templates bind $Title / $Progress / $Status / $Output etc. The manager drives
// it via markRunning / succeed / fail / finishCancelled; the row UI drives it via
// CancelCommand / OpenOutputCommand.
export class TaskHandle extends MuralBase {
    public static readonly TitleKey           = MuralBase.RegisterProperty<string>(TaskHandle, 'Title', '', MetaData.None)
    public static readonly StatusKey          = MuralBase.RegisterProperty<TaskStatus>(TaskHandle, 'Status', TaskStatus.Queued, MetaData.None)
    public static readonly ProgressKey        = MuralBase.RegisterProperty<number>(TaskHandle, 'Progress', 0, MetaData.None)
    public static readonly IsIndeterminateKey = MuralBase.RegisterProperty<boolean>(TaskHandle, 'IsIndeterminate', true, MetaData.None)
    public static readonly NoteKey            = MuralBase.RegisterProperty<string>(TaskHandle, 'Note', '', MetaData.None)
    public static readonly OutputKey          = MuralBase.RegisterProperty<string>(TaskHandle, 'Output', '', MetaData.None)
    public static readonly ErrorKey           = MuralBase.RegisterProperty<string>(TaskHandle, 'Error', '', MetaData.None)
    public static readonly IsRunningKey       = MuralBase.RegisterProperty<boolean>(TaskHandle, 'IsRunning', false, MetaData.None)
    public static readonly IsQueuedKey        = MuralBase.RegisterProperty<boolean>(TaskHandle, 'IsQueued', true, MetaData.None)
    public static readonly IsDoneKey          = MuralBase.RegisterProperty<boolean>(TaskHandle, 'IsDone', false, MetaData.None)
    public static readonly CancelCommandKey     = MuralBase.RegisterProperty<ICommand | undefined>(TaskHandle, 'CancelCommand', undefined, MetaData.None)
    public static readonly OpenOutputCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(TaskHandle, 'OpenOutputCommand', undefined, MetaData.None)

    public readonly Id: string
    public readonly Kind: string
    public readonly Done: Promise<unknown>
    private readonly controller = new AbortController()
    private _resolve!: (v: unknown) => void
    private _reject!:  (e: unknown) => void

    constructor(init: { id: string; title: string; kind: string })
    {
        super()
        this.Id = init.id
        this.Kind = init.kind
        this.set_property_value(TaskHandle.TitleKey, init.title)
        this.Done = new Promise<unknown>((res, rej) => { this._resolve = res; this._reject = rej })
        // Mark internally-handled so an ignored rejection (e.g. a fire-and-forget
        // cancel) never warns; callers get the same promise and may attach their own.
        this.Done.catch(() => {})
        this.set_property_value(TaskHandle.CancelCommandKey, new RelayCommand(() => this.cancel(), () => !this.IsDone))
    }

    public get Title(): string { return this.get_property_value(TaskHandle.TitleKey) }
    public get Status(): TaskStatus { return this.get_property_value(TaskHandle.StatusKey) }
    public get Progress(): number { return this.get_property_value(TaskHandle.ProgressKey) }
    public get IsIndeterminate(): boolean { return this.get_property_value(TaskHandle.IsIndeterminateKey) }
    public get Note(): string { return this.get_property_value(TaskHandle.NoteKey) }
    public get Output(): string { return this.get_property_value(TaskHandle.OutputKey) }
    public get Error(): string { return this.get_property_value(TaskHandle.ErrorKey) }
    public get IsRunning(): boolean { return this.get_property_value(TaskHandle.IsRunningKey) }
    public get IsQueued(): boolean { return this.get_property_value(TaskHandle.IsQueuedKey) }
    public get IsDone(): boolean { return this.get_property_value(TaskHandle.IsDoneKey) }
    public get OpenOutputCommand(): ICommand | undefined { return this.get_property_value(TaskHandle.OpenOutputCommandKey) }
    public set OpenOutputCommand(v: ICommand | undefined) { this.set_property_value(TaskHandle.OpenOutputCommandKey, v) }
    public get Signal(): AbortSignal { return this.controller.signal }

    public report(fraction: number, note?: string): void
    {
        this.set_property_value(TaskHandle.IsIndeterminateKey, false)
        this.set_property_value(TaskHandle.ProgressKey, Math.max(0, Math.min(1, fraction)))
        if (note !== undefined) this.set_property_value(TaskHandle.NoteKey, note)
    }

    public log(line: string): void
    {
        this.set_property_value(TaskHandle.OutputKey, this.Output + line + '\n')
    }

    public throwIfCancelled(): void { if (this.controller.signal.aborted) throw abortError() }

    public markRunning(): void { this.setStatus(TaskStatus.Running) }

    public succeed(result: unknown): void
    {
        if (!this.IsIndeterminate) this.set_property_value(TaskHandle.ProgressKey, 1)
        this.setStatus(TaskStatus.Succeeded)
        this._resolve(result)
    }

    public fail(error: unknown): void
    {
        this.set_property_value(TaskHandle.ErrorKey, error instanceof Error ? error.message : String(error))
        this.setStatus(TaskStatus.Failed)
        this._reject(error)
    }

    // User-initiated cancel. A queued task never ran, so it completes immediately;
    // a running task is asked to stop (Cancelling) and the executor is expected to
    // observe the signal, after which the manager calls finishCancelled().
    public cancel(): void
    {
        if (this.IsDone) return
        this.controller.abort()
        if (this.Status === TaskStatus.Queued) { this.setStatus(TaskStatus.Cancelled); this._reject(abortError()) }
        else this.setStatus(TaskStatus.Cancelling)
    }

    public finishCancelled(): void
    {
        if (this.Status === TaskStatus.Cancelled) return
        this.setStatus(TaskStatus.Cancelled)
        this._reject(abortError())
    }

    private setStatus(status: TaskStatus): void
    {
        this.set_property_value(TaskHandle.StatusKey, status)
        this.set_property_value(TaskHandle.IsRunningKey, status === TaskStatus.Running)
        this.set_property_value(TaskHandle.IsQueuedKey, status === TaskStatus.Queued)
        const done = status === TaskStatus.Succeeded || status === TaskStatus.Failed || status === TaskStatus.Cancelled
        this.set_property_value(TaskHandle.IsDoneKey, done)
        const cancel = this.get_property_value(TaskHandle.CancelCommandKey) as RelayCommand | undefined
        cancel?.RaiseCanExecuteChanged?.()
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/background-work/services/tests/task-handle.test.ts`
Expected: PASS (8 tests). If `RelayCommand.RaiseCanExecuteChanged` is named differently in this mural version, adjust the optional call (`cancel?.RaiseCanExecuteChanged?.()`) — it is guarded with `?.` so a rename cannot crash the test.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/background-work/services/task-handle.ts src/renderer/src/modules/background-work/services/tests/task-handle.test.ts
git commit -m "feat(background-work): TaskHandle VM + TaskStatus lifecycle"
```

---

### Task 3: InlineExecutor (reference executor)

**Files:**
- Create: `src/renderer/src/modules/background-work/services/inline-executor.ts`
- Test: `src/renderer/src/modules/background-work/services/tests/inline-executor.test.ts`

**Interfaces:**
- Consumes: `ITaskExecutor`, `ITaskContext`, `TaskKind` (Task 1).
- Produces: `type InlineJob<R> = (ctx: ITaskContext) => Promise<R>`; `class InlineExecutor implements ITaskExecutor<InlineJob<unknown>, unknown>` with `kind = TaskKind.Inline`, `capacity = Infinity`, `run(fn, ctx) => fn(ctx)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/inline-executor.test.ts
import { describe, it, expect } from 'vitest'
import { InlineExecutor } from '../inline-executor.js'
import { TaskKind, type ITaskContext } from '../task-executor.js'

const ctx: ITaskContext = {
    report: () => {}, log: () => {},
    signal: new AbortController().signal, throwIfCancelled: () => {},
}

describe('InlineExecutor', () => {
    it('is the Inline kind with unbounded capacity', () => {
        const e = new InlineExecutor()
        expect(e.kind).toBe(TaskKind.Inline)
        expect(e.capacity).toBe(Infinity)
    })
    it('runs the job function with the context and returns its result', async () => {
        let seen: ITaskContext | undefined
        const result = await new InlineExecutor().run(async (c) => { seen = c; return 7 }, ctx)
        expect(result).toBe(7)
        expect(seen).toBe(ctx)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/background-work/services/tests/inline-executor.test.ts`
Expected: FAIL — cannot resolve `../inline-executor.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// inline-executor.ts
import { TaskKind, type ITaskContext, type ITaskExecutor } from './task-executor.js'

// The reference executor: the payload IS the async job, so `run` just invokes it
// with the context. Backs BackgroundWorkService.run(title, fn) for one-off inline
// work. Unbounded capacity — inline async jobs don't contend for a worker slot.
export type InlineJob<R = unknown> = (ctx: ITaskContext) => Promise<R>

export class InlineExecutor implements ITaskExecutor<InlineJob<unknown>, unknown> {
    public readonly kind = TaskKind.Inline
    public readonly capacity = Infinity
    public run(payload: InlineJob<unknown>, ctx: ITaskContext): Promise<unknown> { return payload(ctx) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/background-work/services/tests/inline-executor.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/background-work/services/inline-executor.ts src/renderer/src/modules/background-work/services/tests/inline-executor.test.ts
git commit -m "feat(background-work): inline reference executor"
```

---

### Task 4: BackgroundWorkService (manager)

**Files:**
- Create: `src/renderer/src/modules/background-work/services/background-work-service.ts`
- Test: `src/renderer/src/modules/background-work/services/tests/background-work-service.test.ts`

**Interfaces:**
- Consumes: `TaskExecutorRegistry`, `ITaskExecutor`, `ITaskContext`, `TaskKind`, `BackgroundTask` (Task 1); `TaskHandle`, `TaskStatus` (Task 2); `InlineExecutor` (Task 3).
- Produces: `const BackgroundWorkServiceKey = new ServiceKey<BackgroundWorkService>('BackgroundWorkService')`; `interface SubmitResult<R>{ handle:TaskHandle; done:Promise<R> }`; `class BackgroundWorkService extends ServiceBase` with `Key = BackgroundWorkServiceKey`; DPs `Tasks:ObservableCollection<TaskHandle>`, `RunningCount`, `QueuedCount`, `SummaryText`, `IsOpen`, `ClearCompletedCommand`; methods `Register(e:ITaskExecutor):void`, `submit<P,R>(task:BackgroundTask<P>):SubmitResult<R>`, `run<R>(title:string, fn:(ctx:ITaskContext)=>Promise<R>):SubmitResult<R>`. Constructor registers an `InlineExecutor`. `OpenOutput` wiring lands in Task 6 (this task leaves `OpenOutputCommand` unset).

- [ ] **Step 1: Write the failing test**

```ts
// tests/background-work-service.test.ts
import { describe, it, expect, vi } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { BackgroundWorkService } from '../background-work-service.js'
import { TaskStatus } from '../task-handle.js'
import { TaskKind, type ITaskContext, type ITaskExecutor } from '../task-executor.js'

function svc(): BackgroundWorkService { return new BackgroundWorkService(new ServiceProvider()) }

// An executor whose run() is resolved manually so tests control timing.
function gatedExecutor(kind: string, capacity: number) {
    const gates: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void; ctx: ITaskContext }> = []
    const executor: ITaskExecutor = {
        kind, capacity,
        run: (_p, ctx) => new Promise((resolve, reject) => { gates.push({ resolve, reject, ctx }) }),
    }
    return { executor, gates }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('BackgroundWorkService', () => {
    it('summarises an empty queue', () => {
        expect(svc().SummaryText).toBe('No background tasks')
    })

    it('runs up to capacity and queues the rest', async () => {
        const s = svc()
        const { executor } = gatedExecutor('k', 2)
        s.Register(executor)
        s.submit({ kind: 'k', title: 'A', payload: null })
        s.submit({ kind: 'k', title: 'B', payload: null })
        s.submit({ kind: 'k', title: 'C', payload: null })
        await tick()
        expect(s.RunningCount).toBe(2)
        expect(s.QueuedCount).toBe(1)
        expect(s.SummaryText).toBe('2 running, 1 queued')
    })

    it('admits a queued task when a running one completes', async () => {
        const s = svc()
        const { executor, gates } = gatedExecutor('k', 1)
        s.Register(executor)
        s.submit({ kind: 'k', title: 'A', payload: null })
        s.submit({ kind: 'k', title: 'B', payload: null })
        await tick()
        expect(s.RunningCount).toBe(1)
        gates[0].resolve(undefined)
        await tick(); await tick()
        expect(s.RunningCount).toBe(1)      // B now running
        expect(s.QueuedCount).toBe(0)
    })

    it('resolves the submit done-promise with the executor result', async () => {
        const s = svc()
        const { executor, gates } = gatedExecutor('k', 1)
        s.Register(executor)
        const { done } = s.submit<null, number>({ kind: 'k', title: 'A', payload: null })
        await tick()
        gates[0].resolve(99)
        await expect(done).resolves.toBe(99)
    })

    it('marks Failed and rejects done on executor error', async () => {
        const s = svc()
        const { executor, gates } = gatedExecutor('k', 1)
        s.Register(executor)
        const { handle, done } = s.submit({ kind: 'k', title: 'A', payload: null })
        await tick()
        gates[0].reject(new Error('nope'))
        await expect(done).rejects.toThrow('nope')
        expect(handle.Status).toBe(TaskStatus.Failed)
    })

    it('cancelling a queued task never runs it', async () => {
        const s = svc()
        const { executor, gates } = gatedExecutor('k', 1)
        s.Register(executor)
        s.submit({ kind: 'k', title: 'A', payload: null })
        const { handle: b } = s.submit({ kind: 'k', title: 'B', payload: null })
        await tick()
        b.cancel()
        gates[0].resolve(undefined)
        await tick(); await tick()
        expect(b.Status).toBe(TaskStatus.Cancelled)
        expect(gates.length).toBe(1)        // B never entered run()
    })

    it('finishes a running task as Cancelled when its executor rejects with AbortError after cancel', async () => {
        const s = svc()
        const { executor, gates } = gatedExecutor('k', 1)
        s.Register(executor)
        const { handle } = s.submit({ kind: 'k', title: 'A', payload: null })
        await tick()
        handle.cancel()                     // aborts ctx.signal
        expect(gates[0].ctx.signal.aborted).toBe(true)
        gates[0].reject(new DOMException('x', 'AbortError'))
        await tick()
        expect(handle.Status).toBe(TaskStatus.Cancelled)
    })

    it('run() executes an inline job and resolves its result', async () => {
        const s = svc()
        const { done } = s.run('inline', async () => 5)
        await expect(done).resolves.toBe(5)
    })

    it('ClearCompleted removes only finished tasks', async () => {
        const s = svc()
        const { executor, gates } = gatedExecutor('k', 2)
        s.Register(executor)
        s.submit({ kind: 'k', title: 'A', payload: null })
        s.submit({ kind: 'k', title: 'B', payload: null })
        await tick()
        gates[0].resolve(undefined)
        await tick()
        s.ClearCompletedCommand.Execute(undefined)
        expect(s.Tasks.Count).toBe(1)       // only the still-running B remains
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/background-work/services/tests/background-work-service.test.ts`
Expected: FAIL — cannot resolve `../background-work-service.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// background-work-service.ts
import {
    MuralBase, MetaData, ObservableCollection, RelayCommand, ServiceBase, ServiceKey,
    type ICommand, type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'
import { TaskExecutorRegistry, TaskKind, type BackgroundTask, type ITaskContext, type ITaskExecutor } from './task-executor.js'
import { TaskHandle, TaskStatus } from './task-handle.js'
import { InlineExecutor, type InlineJob } from './inline-executor.js'

export interface SubmitResult<R> { handle: TaskHandle; done: Promise<R> }

// Standalone key (like ProblemsServiceKey) — the status-bar ShellControl uses it
// as its DataContext (provider.get(token), no class->Key normalization).
export const BackgroundWorkServiceKey = new ServiceKey<BackgroundWorkService>('BackgroundWorkService')

// One queued item awaiting a free executor slot.
interface QueuedItem { handle: TaskHandle; payload: unknown }

// The background-work manager: accepts submissions, routes each to the executor
// registered for its kind, admits up to that executor's capacity at once, and
// owns the observable task list + status-bar summary. Root-registered so any
// service can resolve it and submit. Mirrors ProblemsService's shape.
export class BackgroundWorkService extends ServiceBase {
    public static readonly Key = BackgroundWorkServiceKey

    public static readonly TasksKey = MuralBase.RegisterProperty<ObservableCollection<TaskHandle>>(
        BackgroundWorkService, 'Tasks', undefined as unknown as ObservableCollection<TaskHandle>, MetaData.None)
    public static readonly RunningCountKey = MuralBase.RegisterProperty<number>(BackgroundWorkService, 'RunningCount', 0, MetaData.None)
    public static readonly QueuedCountKey  = MuralBase.RegisterProperty<number>(BackgroundWorkService, 'QueuedCount', 0, MetaData.None)
    public static readonly SummaryTextKey  = MuralBase.RegisterProperty<string>(BackgroundWorkService, 'SummaryText', 'No background tasks', MetaData.None)
    public static readonly IsOpenKey       = MuralBase.RegisterProperty<boolean>(BackgroundWorkService, 'IsOpen', false, MetaData.None)
    public static readonly ClearCompletedCommandKey = MuralBase.RegisterProperty<ICommand>(
        BackgroundWorkService, 'ClearCompletedCommand', undefined as unknown as ICommand, MetaData.None)

    private readonly registry = new TaskExecutorRegistry()
    private readonly queues = new Map<string, QueuedItem[]>()   // per-kind FIFO of waiting tasks
    private readonly running = new Map<string, number>()        // per-kind in-flight count
    private seq = 0

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.set_property_value(BackgroundWorkService.TasksKey, new ObservableCollection<TaskHandle>())
        this.set_property_value(BackgroundWorkService.ClearCompletedCommandKey, new RelayCommand(() => this.clearCompleted()))
        this.registry.register(new InlineExecutor())
    }

    public get Tasks(): ObservableCollection<TaskHandle> { return this.get_property_value(BackgroundWorkService.TasksKey) }
    public get RunningCount(): number { return this.get_property_value(BackgroundWorkService.RunningCountKey) }
    public get QueuedCount(): number { return this.get_property_value(BackgroundWorkService.QueuedCountKey) }
    public get SummaryText(): string { return this.get_property_value(BackgroundWorkService.SummaryTextKey) }
    public get IsOpen(): boolean { return this.get_property_value(BackgroundWorkService.IsOpenKey) }
    public set IsOpen(v: boolean) { this.set_property_value(BackgroundWorkService.IsOpenKey, v) }
    public get ClearCompletedCommand(): ICommand { return this.get_property_value(BackgroundWorkService.ClearCompletedCommandKey) }

    // Register an executor for its kind (last wins). Domains call this to add
    // Publish/Layout/Worker executors; the InlineExecutor is built in.
    public Register(executor: ITaskExecutor): void { this.registry.register(executor) }

    public submit<P, R>(task: BackgroundTask<P>): SubmitResult<R>
    {
        const handle = new TaskHandle({ id: `task-${++this.seq}`, title: task.title, kind: String(task.kind) })
        this.Tasks.Add(handle)
        const kind = String(task.kind)
        const q = this.queues.get(kind) ?? []
        q.push({ handle, payload: task.payload })
        this.queues.set(kind, q)
        this.updateCounts()
        this.pump(kind)
        return { handle, done: handle.Done as Promise<R> }
    }

    public run<R>(title: string, fn: InlineJob<R>): SubmitResult<R>
    {
        return this.submit<InlineJob<R>, R>({ kind: TaskKind.Inline, title, payload: fn })
    }

    // Admit as many queued tasks of `kind` as the executor's capacity allows.
    private pump(kind: string): void
    {
        const executor = this.registry.get(kind)
        const q = this.queues.get(kind)
        if (executor === undefined || q === undefined) return
        while (q.length > 0 && (this.running.get(kind) ?? 0) < executor.capacity) {
            const item = q.shift() as QueuedItem
            if (item.handle.IsDone) continue          // cancelled while queued — skip
            this.startOne(kind, executor, item)
        }
        this.updateCounts()
    }

    private startOne(kind: string, executor: ITaskExecutor, item: QueuedItem): void
    {
        const { handle } = item
        handle.markRunning()
        this.running.set(kind, (this.running.get(kind) ?? 0) + 1)
        this.updateCounts()
        const ctx: ITaskContext = {
            report: (f, n) => handle.report(f, n),
            log: (l) => handle.log(l),
            signal: handle.Signal,
            throwIfCancelled: () => handle.throwIfCancelled(),
        }
        executor.run(item.payload, ctx)
            .then((r) => handle.succeed(r))
            .catch((e) => { if (isAbort(e)) handle.finishCancelled(); else handle.fail(e) })
            .finally(() => {
                this.running.set(kind, (this.running.get(kind) ?? 1) - 1)
                this.pump(kind)
                this.updateCounts()
            })
    }

    private clearCompleted(): void
    {
        const keep = [...this.Tasks].filter((t) => !t.IsDone)
        this.Tasks.Clear()
        for (const t of keep) this.Tasks.Add(t)
        this.updateCounts()
    }

    private updateCounts(): void
    {
        const all = [...this.Tasks]
        const running = all.filter((t) => t.Status === TaskStatus.Running).length
        const queued  = all.filter((t) => t.Status === TaskStatus.Queued).length
        this.set_property_value(BackgroundWorkService.RunningCountKey, running)
        this.set_property_value(BackgroundWorkService.QueuedCountKey, queued)
        this.set_property_value(BackgroundWorkService.SummaryTextKey, summarize(running, queued))
    }
}

function isAbort(e: unknown): boolean { return e instanceof Error && e.name === 'AbortError' }

function summarize(running: number, queued: number): string
{
    if (running === 0 && queued === 0) return 'No background tasks'
    const parts: string[] = []
    if (running > 0) parts.push(`${running} running`)
    if (queued > 0) parts.push(`${queued} queued`)
    return parts.join(', ')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/background-work/services/tests/background-work-service.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/background-work/services/background-work-service.ts src/renderer/src/modules/background-work/services/tests/background-work-service.test.ts
git commit -m "feat(background-work): manager service (queue, concurrency, cancel, result)"
```

---

### Task 5: TaskOutputDocument

**Files:**
- Create: `src/renderer/src/modules/background-work/services/task-output-document.ts`
- Test: `src/renderer/src/modules/background-work/services/tests/task-output-document.test.ts`

**Interfaces:**
- Consumes: `TaskHandle` (Task 2); `IDocument` from `@pragmatic-tech-ai/mural/framework`.
- Produces: `class TaskOutputDocument implements IDocument` — `Id = 'task-output:' + handle.Id`, `Title = handle.Title + ' — output'`, `IsDirty = false`, `Save()` no-op; readonly `Handle: TaskHandle` (the `.mu` view binds `$Handle.Output` / `$Handle.Status`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/task-output-document.test.ts
import { describe, it, expect } from 'vitest'
import { TaskOutputDocument } from '../task-output-document.js'
import { TaskHandle } from '../task-handle.js'

describe('TaskOutputDocument', () => {
    it('derives a stable Id and Title from its handle and is never dirty', () => {
        const h = new TaskHandle({ id: 't9', title: 'Publish Billing', kind: 'publish' })
        const doc = new TaskOutputDocument(h)
        expect(doc.Id).toBe('task-output:t9')
        expect(doc.Title).toContain('Publish Billing')
        expect(doc.IsDirty).toBe(false)
        expect(doc.Handle).toBe(h)
    })
    it('Save() is a no-op that resolves', async () => {
        const doc = new TaskOutputDocument(new TaskHandle({ id: 't', title: 'x', kind: 'inline' }))
        await expect(Promise.resolve(doc.Save())).resolves.toBeUndefined()
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/background-work/services/tests/task-output-document.test.ts`
Expected: FAIL — cannot resolve `../task-output-document.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// task-output-document.ts
import type { IDocument } from '@pragmatic-tech-ai/mural/framework'
import type { TaskHandle } from './task-handle.js'

// A read-only document tab showing one task's live output log. Opened via
// host.Open() when the user clicks the task's row; the DataTemplate[TaskOutputDocument]
// (in background-work.resources.mu) binds $Handle.Output / $Handle.Status. Id is
// derived from the task id so re-opening re-activates the existing tab rather than
// stacking duplicates (DocumentsContentHostService dedupes by Id).
export class TaskOutputDocument implements IDocument {
    public readonly Handle: TaskHandle
    public readonly Id: string
    public readonly Title: string
    public readonly IsDirty = false

    constructor(handle: TaskHandle)
    {
        this.Handle = handle
        this.Id = `task-output:${handle.Id}`
        this.Title = `${handle.Title} — output`
    }

    public Save(): void { /* read-only: nothing to save */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/background-work/services/tests/task-output-document.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/background-work/services/task-output-document.ts src/renderer/src/modules/background-work/services/tests/task-output-document.test.ts
git commit -m "feat(background-work): read-only task output document"
```

---

### Task 6: Wire OpenOutput → host.Open

**Files:**
- Modify: `src/renderer/src/modules/background-work/services/background-work-service.ts`
- Test: `src/renderer/src/modules/background-work/services/tests/background-work-service.test.ts` (add cases)

**Interfaces:**
- Consumes: `ContentHostService`, `DocumentsContentHostService` from `@pragmatic-tech-ai/mural/framework`; `TaskOutputDocument` (Task 5).
- Produces: each submitted `TaskHandle` gets its `OpenOutputCommand` set; invoking it calls `host.Open(new TaskOutputDocument(handle))` (cached per handle so re-open re-activates the same doc).

- [ ] **Step 1: Write the failing test (append to background-work-service.test.ts)**

```ts
it('sets OpenOutputCommand which opens a task-output document on the content host', async () => {
    const provider = new ServiceProvider()
    const opened: Array<{ Id: string }> = []
    // Register a fake DocumentsContentHostService under ContentHostService.Key.
    const { ContentHostService } = await import('@pragmatic-tech-ai/mural/framework')
    provider.register(ContentHostService.Key, () => ({ Open: (d: { Id: string }) => opened.push(d) }) as never)
    const s = new (await import('../background-work-service.js')).BackgroundWorkService(provider)
    const { handle } = s.run('inline', async () => 1)
    handle.OpenOutputCommand?.Execute(undefined)
    expect(opened.length).toBe(1)
    expect(opened[0].Id).toBe(`task-output:${handle.Id}`)
    // Re-open returns the SAME document instance (dedupe by identity + Id).
    handle.OpenOutputCommand?.Execute(undefined)
    expect(opened[1]).toBe(opened[0])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/background-work/services/tests/background-work-service.test.ts -t OpenOutputCommand`
Expected: FAIL — `handle.OpenOutputCommand` is undefined.

- [ ] **Step 3: Write minimal implementation**

Add imports and wire the command in `submit()`. In `background-work-service.ts`:

```ts
// add to imports:
import { ContentHostService, type DocumentsContentHostService } from '@pragmatic-tech-ai/mural/framework'
import { TaskOutputDocument } from './task-output-document.js'
import { RelayCommand } from '@pragmatic-tech-ai/mural/runtime'   // already imported — keep single import line
```

Add a per-handle output-doc cache field:

```ts
private readonly outputDocs = new WeakMap<TaskHandle, TaskOutputDocument>()
```

In `submit()`, after `this.Tasks.Add(handle)` and before enqueuing, set the command:

```ts
handle.OpenOutputCommand = new RelayCommand(() => this.openOutput(handle))
```

Add the method:

```ts
private openOutput(handle: TaskHandle): void
{
    let doc = this.outputDocs.get(handle)
    if (doc === undefined) { doc = new TaskOutputDocument(handle); this.outputDocs.set(handle, doc) }
    const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
    host?.Open(doc)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/background-work/services/tests/background-work-service.test.ts`
Expected: PASS (10 tests — the new one plus the prior 9).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/background-work/services/background-work-service.ts src/renderer/src/modules/background-work/services/tests/background-work-service.test.ts
git commit -m "feat(background-work): open a task's output as a document tab"
```

---

### Task 7: Status-bar dock + row + output templates

**Files:**
- Create: `src/renderer/src/modules/background-work/background-work.resources.mu`
- Create: `src/renderer/src/modules/background-work/background-work.module.mu`

**Interfaces:**
- Consumes: `BackgroundWorkService` + `BackgroundWorkServiceKey` (Task 4); `TaskHandle` (Task 2); `TaskOutputDocument` (Task 5).
- Produces: keyed template `@BackgroundWorkDock`; `DataTemplate[TaskHandle]`; `DataTemplate[TaskOutputDocument]`; the `BackgroundWorkModule` with a `.ShellControls` entry (`Region = StatusBar`). Resource dictionary export name: `BackgroundWorkResources`.

- [ ] **Step 1: Write the dock + row + output resources**

Model closely on `modules/problems/problems.resources.mu` (`@ProblemsDock`: a `MenuButton` cell whose face shows the summary and whose popup lists rows in a `ScrollViewer`, width bound to the service). Reference mural `ProgressIndicator` for the bar. Create `background-work.resources.mu`:

```
// The status-bar background-work dock (@BackgroundWorkDock) + the task row and
// output-document views. Mirrors problems.resources.mu (@ProblemsDock). Bound to
// BackgroundWorkService via $service(BackgroundWorkService) inside the dock, and
// to the TaskHandle / TaskOutputDocument DataContext inside the item templates.
import BackgroundWorkService from "./services/background-work-service.js"
import TaskHandle from "./services/task-handle.js"
import TaskOutputDocument from "./services/task-output-document.js"

resources BackgroundWorkResources {
    // Status-bar cell: a spinner while work runs + the summary text; click opens
    // the popup list. IsOpen binds one-way to the service so code can surface it.
    Template x:key="BackgroundWorkDock" [TargetType = MenuButton] {
        MenuButton
            [ IsOpen  = $IsOpen,
              Content = StackPanel [ Orientation = Horizontal ] {
                  ProgressIndicator [ IsIndeterminate = true, Width = 14, Height = 14,
                                      Visibility = $RunningCount << ToVisibility, Margin = (0,0,6,0) ]
                  TextBlock [ Text = $SummaryText, VerticalAlignment = Center ]
              } ] {
            // Popup body: a header row + the scrollable task list + a footer.
            Border [ Fill = @SurfaceContainer, Width = $PopupWidth, Padding = (0) ] {
                DockPanel [ LastChildFill = true ] {
                    // Footer: clear-completed.
                    Border [ DockPanel.Dock = Bottom, Padding = (8,4,8,4) ] {
                        Button [ Content = "Clear completed", Command = $ClearCompletedCommand,
                                 HorizontalAlignment = Right ]
                    }
                    ScrollViewer [ MaxHeight = 320 ] {
                        ItemsControl [ ItemsSource = $Tasks, ItemsPanel = @VerticalStackPanel ]
                    }
                }
            }
        }
    }

    // One task row: title + note, a progress bar (determinate/indeterminate), and
    // a cancel button. Clicking the row (title button) opens its output document.
    DataTemplate [DataType = TaskHandle] {
        Border [ Padding = (8,4,8,4) ] {
            DockPanel [ LastChildFill = true ] {
                Button [ DockPanel.Dock = Right, Content = "✕", Command = $CancelCommand,
                         Visibility = $IsDone << ToInverseVisibility, Margin = (6,0,0,0) ]
                StackPanel [ Orientation = Vertical ] {
                    Button [ Content = $Title, Command = $OpenOutputCommand, HorizontalAlignment = Left ]
                    ProgressIndicator [ Value = $Progress, IsIndeterminate = $IsIndeterminate,
                                        Visibility = $IsRunning << ToVisibility, Height = 4 ]
                    TextBlock [ Text = $Note, Foreground = @OnSurfaceVariant, FontSize = 11 ]
                    TextBlock [ Text = $Error, Foreground = @Error, FontSize = 11,
                                Visibility = $Error << ToVisibility ]
                }
            }
        }
    }

    // The output document view: a scrolling, read-only monospace log.
    DataTemplate [DataType = TaskOutputDocument] {
        ScrollViewer [ Padding = (8) ] {
            TextBlock [ Text = $Handle.Output, FontFamily = "monospace", FontSize = 12,
                        Foreground = @OnSurface ]
        }
    }
}
```

Notes for the implementer: verify the exact converter names against `problems.resources.mu` — it uses `<< ToVisibility`; if there is no `ToInverseVisibility`, drive the cancel button's collapse with a `when` trigger on `$IsDone` instead (as `problems.resources.mu` / other templates do). Verify `ProgressIndicator`'s value/indeterminate property names against `Mural/src/framework/notifications/progress-indicator.ts`; adjust `Value`/`IsIndeterminate` to the real DP names. `@VerticalStackPanel` is the app-level ItemsPanel already defined in `app.mu`.

- [ ] **Step 2: Write the module**

Create `background-work.module.mu` (mirror `problems.module.mu`):

```
// Registers the BackgroundWorkService status-bar dock as a StatusBar ShellControl.
// DataContext must be the ServiceKey INSTANCE (BackgroundWorkServiceKey), not the
// class — provider.get does no class->Key normalization.
import BackgroundWorkService from "./services/background-work-service.js"
import BackgroundWorkServiceKey from "./services/background-work-service.js"

module BackgroundWorkModule [ Name = "Background Work" ] {
    .ShellControls: {
        ShellControlDefinition
            [ Template    = @BackgroundWorkDock,
              DataContext = BackgroundWorkServiceKey,
              Region      = StatusBar ]
    }
}
```

- [ ] **Step 3: Add both files to the `compile:mu` list and compile**

Modify `package.json` → `scripts.compile:mu`: append `src/renderer/src/modules/background-work/background-work.module.mu src/renderer/src/modules/background-work/background-work.resources.mu` immediately before `src/renderer/src/app.mu`.

Run: `npm run compile:mu`
Expected: compiles all files including the two new ones with no errors. Fix any markup errors surfaced (unknown symbol → add an `import`; unknown converter/DP → correct per the notes above) and re-run until clean.

- [ ] **Step 4: Verify**

Run: `npm run compile:mu`
Expected: "compiled N files" with no error lines.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/background-work/background-work.resources.mu src/renderer/src/modules/background-work/background-work.module.mu package.json
git commit -m "feat(background-work): status-bar dock, task row, and output templates"
```

---

### Task 8: App wiring + end-to-end demo smoke

**Files:**
- Modify: `src/renderer/src/app.mu` (register service, add module, merge resources)
- Modify: `src/renderer/src/main.js` (eager-construct the service + a dev-only demo hook)
- Create: `e2e/background-work.spec.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `BackgroundWorkService` registered at the app root and reachable via `app.Services.get(BackgroundWorkService.Key)`; the status-bar dock visible; `window.__bgDemo` available in dev to submit a demo task.

- [ ] **Step 1: Register in app.mu**

In `app.mu`: add imports near the other service imports —

```
import BackgroundWorkService from "./modules/background-work/services/background-work-service.js"
import BackgroundWorkModule from "./modules/background-work/background-work.module.mu.js"
import BackgroundWorkResources from "./modules/background-work/background-work.resources.mu.js"
```

Add `BackgroundWorkService` to the `.services:` block (root registration, like `TitleService`). Add `BackgroundWorkModule` to the `.modules:` block. Add `merge BackgroundWorkResources` to the `resources:` block (near the other `merge` lines).

- [ ] **Step 2: Eager-construct + dev demo hook in main.js**

In `main.js`, add the import and, after `attachTitleBar(app)` / the other eager `app.Services.get(...)` calls, construct the service and expose a dev-only demo trigger:

```js
import { BackgroundWorkService } from './modules/background-work/services/background-work-service.js'
// …inside the mount try-block, after the other eager service gets:
const bg = app.Services.get(BackgroundWorkService.Key)
// Dev-only demo hook for the e2e smoke: a 3-step fake task with progress + output.
if (bg !== undefined) {
    globalThis.__bgDemo = () => bg.run('Demo task', async (ctx) => {
        for (let i = 1; i <= 3; i++) { ctx.throwIfCancelled(); ctx.log(`step ${i}/3`); ctx.report(i / 3, `step ${i}/3`); await new Promise((r) => setTimeout(r, 150)) }
        return 'done'
    })
}
```

- [ ] **Step 3: Write the e2e smoke**

Create `e2e/background-work.spec.ts` (model on `e2e/title-bar.spec.ts` for launch/teardown):

```ts
import { test, expect } from '@playwright/test'
import { launchPlexus, appErrors, type Launched } from './plexus-app'

let L: Launched
test.beforeAll(async () => { L = await launchPlexus(); await L.win.waitForTimeout(800) })
test.afterAll(async () => { await L?.app?.close() })

test('boots without app errors', async () => {
    expect(appErrors(L.errors)).toEqual([])
})

test('a submitted task appears, runs, and completes', async () => {
    // Trigger a demo task via the dev hook, then wait for it to finish.
    const finished = await L.win.evaluate(async () => {
        const { done } = globalThis.__bgDemo()
        return await done
    })
    expect(finished).toBe('done')
})
```

- [ ] **Step 4: Build + run the smoke**

Run: `npm run build`
Then: `npx playwright test e2e/background-work.spec.ts`
Expected: both tests PASS (boots clean; the demo task resolves to `'done'`). If `launchPlexus`/`appErrors` signatures differ, copy the exact usage from `e2e/title-bar.spec.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/app.mu src/renderer/src/main.js e2e/background-work.spec.ts
git commit -m "feat(background-work): wire service + module + status-bar dock; e2e smoke"
```

---

## Self-Review

**Spec coverage:**
- Task abstraction + pluggable executor seam → Task 1. ✓
- Task capabilities (cancel, determinate progress, result+error, output log) → Task 2 (`TaskHandle`). ✓
- Manager (submit/run, per-executor concurrency, registry, summary, clear) → Task 4. ✓
- Inline reference executor → Task 3. ✓
- Output document opened as a tab on row click → Tasks 5 + 6. ✓
- Status-bar surface (dock + rows) → Task 7. ✓
- App wiring + end-to-end validation → Task 8. ✓
- **Deferred (own follow-up plans, by scope decision):** completion toast (needs a notification-overlay host), publish migration, layout migration, Web Worker executor impl. Listed below.

**Placeholder scan:** No "TBD"/"implement later". The two "verify the exact name against <file>" notes in Task 7 are for markup converter/DP names that only exist in `.mu` (not type-checkable here); each has a concrete fallback, so no step is left open.

**Type consistency:** `TaskHandle` methods (`markRunning/succeed/fail/finishCancelled/cancel/report/log`) are used identically in Tasks 2, 4, 6. `ITaskContext` shape matches between Task 1 (definition), Task 3 (test stub), and Task 4 (construction). `BackgroundWorkServiceKey` / `BackgroundWorkService.Key` referenced consistently in Tasks 4, 7, 8. `TaskOutputDocument.Id` format (`task-output:<id>`) matches between Task 5 and the Task 6 test.

---

## Follow-up plans (out of scope here — each ships on its own)

1. **Completion toasts** — build a notification-overlay host (anchor a mural `Snackbar` on the shell overlay, mirroring how `DialogService` anchors), a small `NotificationService`, and fire a toast from the manager on task settle (success/failure; failure toast action opens the output doc).
2. **Route publish through the service** — in `project-explorer-service.ts::publishProject`, wrap `op.Factory.publish(op.Project, op.Storage, this.Provider)` in `bg.run('Publish ' + op.Project.Name, async (ctx) => { … })`, preserving the existing Status/Problems handling by awaiting the returned `done`.
3. **Route layout through the service** — in `LayoutPipelineService.Run()`, submit a `Layout` task (register a `LayoutExecutor`, or wrap the run body), reporting stage progress.
4. **Web Worker executor** — implement `WorkerTaskExecutor` (pool + postMessage relay of report/log + cancel via terminate) against the `ITaskExecutor` seam; migrate layout onto it (serializable graph-in → positions-out payload).
```

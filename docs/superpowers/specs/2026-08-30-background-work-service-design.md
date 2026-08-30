# Background Work Service — Design

- **Date:** 2026-08-30
- **Status:** Approved shape, pending spec review → implementation plan
- **Scope:** A Plexus renderer subsystem that runs background operations behind a
  uniform, pluggable-executor abstraction and surfaces every operation as a live
  entry in a status-bar list (mirroring the Problems dock), with per-task
  progress, cancellation, a result/error, a completion toast, and an output panel
  that opens as a document tab.

## 1. Goal & motivation

Long-running operations (project publish, diagram auto-layout, and more to come)
currently run ad-hoc with no shared UI, no cancellation, and no progress. We want
one abstraction for "background work" that:

- decouples **what the work is** (a task) from **how it runs** (an executor
  strategy — inline async now, Web Worker / IPC later) from **how it is shown**
  (a status-bar list + output document + toast);
- lets a caller `submit` work from anywhere and optionally `await` its result;
- gives the user glanceable feedback, the ability to cancel, and a readable log.

The Problems dock (`ProblemsService` + `@ProblemsDock` status-bar control) is the
structural template for the surfacing; this design mirrors it deliberately.

## 2. Non-goals

- Not a real OS thread pool. "Threadpool-like" = a concurrency-limited scheduler
  over async/executor strategies. Real parallelism is one executor kind (Web
  Worker), designed for but not implemented in the first cut.
- No persistence of task history across app restarts.
- No rich two-way task↔user dialogs in the first cut (a `ctx.ask()` hook is
  designed as a future extension; "interaction" in v1 = streaming status/log
  lines to the output panel).

## 3. Concepts & vocabulary

| Term | Meaning |
| --- | --- |
| **Task** | A submission: a `kind`, a display `title`, and a `payload`. |
| **Kind** (`TaskKind`) | Selects which executor runs the task. |
| **Executor** (`ITaskExecutor`) | A strategy registered per kind that actually runs a task's payload. |
| **Context** (`ITaskContext`) | The executor's only channel back to the task: progress, log, cancellation. |
| **Handle** (`TaskHandle`) | The live, observable view-model of one task (status/progress/output/result). One row in the list. |
| **Manager** (`BackgroundWorkService`) | Accepts submissions, schedules by executor capacity, owns the registry + status-bar state. |

## 4. Architecture overview

```
 caller (publish / layout / …)
        │  submit(kind, title, payload) -> { handle, done }
        ▼
 ┌─────────────────────────── BackgroundWorkService (root) ───────────────────────────┐
 │  ObservableCollection<TaskHandle>   per-kind queues + concurrency gating            │
 │  SummaryText / IsOpen (status bar)  ClearCompleted                                  │
 └───────────────┬───────────────────────────────────────────────┬────────────────────┘
                 │ routes by kind                                 │ drives
                 ▼                                                ▼
        TaskExecutorRegistry                          Status-bar surface (module)
        kind -> ITaskExecutor                         @BackgroundWorkDock cell + popup list
                 │ run(payload, ctx)                          │ row click
                 ▼                                            ▼
   InlineExecutor | PublishExecutor | LayoutExecutor    host.Open(TaskOutputDocument)
   | (future) WorkerExecutor                            + Snackbar toast on finish
                 │ ctx.report/log/throwIfCancelled
                 ▼
        updates the TaskHandle (live) ── bound by the dock rows + output document
```

## 5. Core interfaces

Sketches (final types match existing mural runtime conventions — real `enum`s per
the enums-over-string-literals rule; VMs are `MuralBase` with DPs).

```ts
// task-kinds are an open registry; built-ins are an enum, domains can add more.
export enum TaskKind {
    Inline  = 'inline',   // payload IS an async fn — convenience for one-off jobs
    Publish = 'publish',
    Layout  = 'layout',
}

export enum TaskStatus {
    Queued     = 'queued',
    Running    = 'running',
    Succeeded  = 'succeeded',
    Failed     = 'failed',
    Cancelling = 'cancelling',
    Cancelled  = 'cancelled',
}

// A submission. payload shape is per-kind (the executor for `kind` knows it).
export interface BackgroundTask<P = unknown> {
    kind:    TaskKind | string;
    title:   string;
    payload: P;
}

// The executor's channel back to the task. A Worker executor relays these over
// postMessage; an inline executor calls them directly.
export interface ITaskContext {
    report(fraction: number, note?: string): void;   // 0..1; omit for indeterminate
    log(line: string): void;                         // -> output panel buffer
    readonly signal: AbortSignal;                    // cancellation
    throwIfCancelled(): void;
    // Future extension (not first cut): ask(question): Promise<answer>
}

// One execution strategy, registered by kind.
export interface ITaskExecutor<P = unknown, R = unknown> {
    readonly kind:     TaskKind | string;
    readonly capacity: number;                       // max concurrent of this kind (Infinity ok)
    run(payload: P, ctx: ITaskContext): Promise<R>;
}

export interface TaskExecutorRegistry {
    register(executor: ITaskExecutor): void;
    get(kind: TaskKind | string): ITaskExecutor | undefined;
}

// submit() returns the live handle plus a promise for the result — callers may
// ignore `done` (fire-and-forget) or await it.
export interface SubmitResult<R> { handle: TaskHandle; done: Promise<R>; }
```

## 6. `TaskHandle` (the row VM)

A `MuralBase` with DPs so the dock template and the output document bind to it —
same shape as `ProblemsRow`:

- `Title: string`
- `Status: TaskStatus`, plus derived `IsRunning` / `IsQueued` / `IsDone` booleans
  for template triggers
- `Progress: number` (0–1) and `IsIndeterminate: boolean`
- `Note: string` (the latest short status line, shown under the title)
- `Output: string` (the accumulating log buffer; the output document binds this)
- `Error: string` (empty unless `Failed`)
- `CancelCommand: ICommand` (enabled while `Queued`/`Running`)
- `OpenOutputCommand: ICommand` (opens the output document)

Internally the handle also holds its `AbortController`, the `resolve/reject` of the
`done` promise, and a lazily-created `TaskOutputDocument`.

## 7. `BackgroundWorkService` (the manager)

- **A `ServiceBase`** with a **standalone `BackgroundWorkServiceKey`** (like
  `ProblemsServiceKey`) referenced as the status-bar control's `DataContext`.
- **Root-registered** (in `app.mu` `.services:`), so any service can resolve it to
  submit — the same reasoning that makes `ContentHostService`/`PanelDockService`
  root singletons.
- **State (DPs):** `Tasks: ObservableCollection<TaskHandle>`, `RunningCount`,
  `QueuedCount`, `SummaryText` (e.g. "2 running, 1 queued" / "No background tasks"),
  `IsOpen` (popup), `ListMaxHeight`/`PopupWidth` (from `ViewportService`, copied
  from `ProblemsService`), `ClearCompletedCommand`.
- **API:**
  - `submit<P, R>(task: BackgroundTask<P>): SubmitResult<R>` — routes by kind.
  - `run<R>(title, fn: (ctx) => Promise<R>): SubmitResult<R>` — convenience over the
    built-in `InlineExecutor` (payload is the fn) for one-off inline jobs.
- **Scheduling:** per-kind queue. On submit → create handle (`Queued`, add to
  `Tasks`). A pump admits tasks whose executor has a free slot (`running-of-kind <
  executor.capacity`), sets `Running`, builds an `ITaskContext` bound to the
  handle, calls `executor.run`. On settle → set `Succeeded`+result or
  `Failed`+error, resolve/reject `done`, fire the toast, re-run the pump.
- **Counts/summary** recomputed on every status change (drives the status-bar cell).

## 8. Status-bar surface

A `BackgroundWorkModule` mirroring `ProblemsModule`:

```
module BackgroundWorkModule [ Name = "Background Work" ] {
    .services: { /* executors that live in this module, if any */ }
    .ShellControls: {
        ShellControlDefinition
            [ Template = @BackgroundWorkDock, DataContext = BackgroundWorkServiceKey, Region = StatusBar ]
    }
}
```

`@BackgroundWorkDock` (in `background-work.resources.mu`):

- **Cell:** a spinner (mural `ProgressIndicator`/`LoadingIndicator`, shown while
  `RunningCount > 0`) + `SummaryText`. Click opens a `MenuButton` popup
  (`IsOpen = $IsOpen`), width = window width, list capped at 30% window height —
  all copied from `@ProblemsDock`.
- **Rows:** `DataTemplate[TaskHandle]` — title + `Note`, a `ProgressIndicator`
  (determinate bound to `Progress`, indeterminate when `IsIndeterminate`), a status
  glyph (running/✓/✗), a cancel (✕) button bound to `CancelCommand`. The row's
  primary click invokes `OpenOutputCommand`. A footer "Clear completed" action.

## 9. Output document

Clicking a row opens the task's output as a normal document tab:

- `TaskOutputDocument` implements `IDocument` (like `CodeDocument`/`MarkdownDocument`):
  `Title` = task title, read-only, `IsDirty = false`, no save.
- It wraps the handle; its view is a `DataTemplate[TaskOutputDocument]` — a
  scrolling, monospace read-only text view bound to the handle's `Output`, appended
  live as `ctx.log(...)` arrives (auto-scroll to bottom). A small header shows
  status + progress.
- `OpenOutputCommand` resolves `ContentHostService.Key` (as
  `DocumentsContentHostService`) and calls `host.Open(doc)` — the exact path the
  code editor uses. Re-opening focuses the existing tab (dedupe by handle id).

## 10. Completion toast

On settle, the manager raises a mural `Snackbar`: "✓ {title}" on success, "✗ {title}
— {error}" on failure with an action that opens the output document. A tiny
`NotificationService` (or a direct snackbar host on the shell overlay, matching how
`DialogService` anchors to the shell) owns presentation; the manager just calls it.
Confirm the exact snackbar host mechanism at implementation.

## 11. Executors

- **`InlineExecutor`** (`kind = Inline`, `capacity = Infinity`) — reference impl;
  `run(fn, ctx) => fn(ctx)`. Backs `service.run(title, fn)`.
- **`PublishExecutor`** (`kind = Publish`) — wraps the existing project-publish flow;
  reports per-step progress and logs emitted artifacts. `capacity` = 1 or small.
  Registered from the project/publish domain.
- **`LayoutExecutor`** (`kind = Layout`) — wraps a Fresco layout run on the active
  diagram; reports progress, applies positions on success. Registered from the
  diagram/layout domain. **This is the eventual Web Worker candidate** — see below.
- **`WorkerExecutor` (designed, deferred):** a base that owns a pool of Web Workers,
  `postMessage`s the payload, relays `report`/`log` back as messages, and cancels
  via a cancel message or `worker.terminate()`. **Constraint:** worker-bound
  executors require **serializable** payload + result (no closures over renderer
  services). Inline/Publish/Layout keep rich payloads while they run inline; moving
  `LayoutExecutor` onto a worker later means giving it a serializable graph-in →
  positions-out payload. The `ITaskExecutor`/`ITaskContext` seam is identical either
  way, so call sites do not change.

## 12. Cancellation model

Each handle owns an `AbortController`; `ctx.signal` is its signal and
`throwIfCancelled()` throws `AbortError` when aborted. `CancelCommand` sets status
`Cancelling` and aborts. A queued (not-yet-running) task cancels immediately →
`Cancelled`, never entering `run`. A running executor is expected to observe the
signal at checkpoints; on `AbortError` the manager records `Cancelled` (not
`Failed`). Worker executor cancellation = post cancel / terminate the worker.

## 13. Concurrency model

Per-executor `capacity`; the manager keeps one queue per kind and admits up to
`capacity` running of that kind. No global ceiling in v1 (add later if needed).
Cheap async kinds use `Infinity`; a worker pool uses its worker count; publish
uses 1.

## 14. File layout

```
modules/background-work/
  background-work.module.mu           # .ShellControls (status-bar dock)
  background-work.resources.mu        # @BackgroundWorkDock + DataTemplate[TaskHandle] + DataTemplate[TaskOutputDocument]
  services/
    background-work-service.ts        # manager (ServiceBase + BackgroundWorkServiceKey)
    task-executor.ts                  # ITaskExecutor, ITaskContext, TaskKind, TaskExecutorRegistry
    task-handle.ts                    # TaskHandle VM + TaskStatus enum
    inline-executor.ts                # reference executor
    task-output-document.ts           # TaskOutputDocument (IDocument)
    notification-service.ts           # completion toast (Snackbar) — or fold into manager
    tests/                            # background-work-service.test.ts, inline-executor.test.ts, task-handle.test.ts
modules/… (domain-owned executors)
  …/services/publish-executor.ts      # registered by the project/publish domain
  …/services/layout-executor.ts       # registered by the diagram/layout domain
```

App wiring: register `BackgroundWorkService` in `app.mu` `.services:` (root);
`.modules:` gains `BackgroundWorkModule`; merge `BackgroundWorkResources`; add
`background-work.resources.mu` to the `compile:mu` file list.

## 15. Testing

- **Manager** (`background-work-service.test.ts`) with a **fake executor** whose
  `run` is controllable: queueing order, per-kind concurrency cap (submit 3 with
  capacity 2 → 2 running / 1 queued → completing one admits the third), cancel of a
  queued vs running task, `Succeeded`+result vs `Failed`+error, `SummaryText`/counts
  transitions, `done` promise resolves/rejects. Same style as
  `ProblemsService`/`TitleService`.
- **`InlineExecutor`** and **`TaskHandle`** unit-tested independently.
- **Status-bar cell + output-doc open** covered by an e2e smoke (submit a demo task,
  assert the cell summary, open the output tab).

## 16. First-cut scope checklist (YAGNI)

- [ ] Core seams: `task-executor.ts`, `task-handle.ts`, `background-work-service.ts`.
- [ ] `InlineExecutor` + `service.run(title, fn)`.
- [ ] Status-bar dock (`@BackgroundWorkDock`) + rows with progress + cancel.
- [ ] `TaskOutputDocument` + open-on-row-click.
- [ ] Completion `Snackbar`.
- [ ] Real consumers: route **publish** and **layout** through the service.
- [ ] `WorkerExecutor` seam defined; implementation deferred.

## 17. Future extensions

- Web Worker executor implementation (layout first).
- IPC/main-process executor kind (e.g., long file operations in main).
- `ctx.ask()` two-way prompts (reuse the agent's question-card mechanism).
- Global concurrency ceiling; task priorities; retry.
- Persist/restore an in-flight task list note across reloads.

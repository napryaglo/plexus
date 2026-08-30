import {
    MuralBase, MetaData, ObservableCollection, RelayCommand, ServiceBase, ServiceKey,
    type ICommand, type IServiceProvider,
} from '@pragmatic-lab/mural/runtime'
import { ContentHostService, type DocumentsContentHostService } from '@pragmatic-lab/mural/framework'
import { TaskExecutorRegistry, TaskKind, type BackgroundTask, type ITaskContext, type ITaskExecutor } from './task-executor.js'
import { TaskHandle, TaskStatus } from './task-handle.js'
import { InlineExecutor, type InlineJob } from './inline-executor.js'
import { TaskOutputDocument } from './task-output-document.js'

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
    private readonly outputDocs = new WeakMap<TaskHandle, TaskOutputDocument>()
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
        handle.OpenOutputCommand = task.open !== undefined
            ? new RelayCommand(task.open)
            : new RelayCommand(() => this.openOutput(handle))
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

    // Open (or re-activate) the task's live output log as a document tab. The doc
    // is cached per handle so re-opening focuses the existing tab.
    private openOutput(handle: TaskHandle): void
    {
        let doc = this.outputDocs.get(handle)
        if (doc === undefined) { doc = new TaskOutputDocument(handle); this.outputDocs.set(handle, doc) }
        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        host?.Open(doc)
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

// The Agent capability's content service. Subscribes to the pushed agent event
// stream (window.api.agent) and folds it into an observable transcript via
// TranscriptReducer; exposes the transcript, the input draft, a send command,
// and a coarse status for the chat DataTemplate to bind. Module-local: named by
// the agent-chat module's Capability ServiceKey.
import {
    Key,
    MetaData,
    Model,
    ObservableCollection,
    RelayCommand,
    ServiceBase,
    ServiceKey,
    type ICommand,
    type IServiceProvider,
} from '@pragmatic-lab/mural/runtime'
import type { IDockPanel } from '@pragmatic-lab/mural/framework'
import { AgentEventKind, type CreateProjectRequest, type IAgentApi } from '../../../../../shared/agent-api.js'
import { EnvironmentService } from '../../../services/environment/environment-service.js'
import { OpenProjectsStore } from '../../../services/projects/open-projects-store.js'
import { ProjectExplorerService } from '../../project-explorer/services/project-explorer-service.js'
import type { NewProjectResult } from '../../../services/projects/new-project-dialog-model.js'
import { NewProjectCard } from './new-project-card.js'
import { TranscriptReducer } from './transcript.js'
import { ApprovalRulesVM, type ApprovalRulesPort } from './approval-rules.js'

export class AgentService extends ServiceBase implements IDockPanel
{
    public static readonly Key = new ServiceKey<AgentService>('AgentService')

    // IDockPanel: identify + label the Chat tab in the right panel dock.
    public static readonly IdKey = Model.RegisterProperty<string>(
        AgentService, 'Id', 'agent', MetaData.None)
    public static readonly TitleKey = Model.RegisterProperty<string>(
        AgentService, 'Title', 'Chat', MetaData.None)

    public static readonly TranscriptKey = Model.RegisterProperty<ObservableCollection<Model>>(
        AgentService, 'Transcript', undefined as unknown as ObservableCollection<Model>, MetaData.None)
    public static readonly DraftKey = Model.RegisterProperty<string>(
        AgentService, 'Draft', '', MetaData.None)
    public static readonly StatusKey = Model.RegisterProperty<string>(
        AgentService, 'Status', 'idle', MetaData.None)
    // False while the agent is blocked on a pending AskUserQuestion card — the
    // input row binds IsEnabled = $CanInput so a turn can't be sent mid-question.
    public static readonly CanInputKey = Model.RegisterProperty<boolean>(
        AgentService, 'CanInput', true, MetaData.None)
    public static readonly SendCommandKey = Model.RegisterProperty<ICommand>(
        AgentService, 'SendCommand', undefined as unknown as ICommand, MetaData.None)
    // Bound to a KeyDown EventTrigger on the input row; fires the turn only when
    // the pressed key is Return (the trigger fires for every bubbled keystroke).
    public static readonly SubmitCommandKey = Model.RegisterProperty<ICommand>(
        AgentService, 'SubmitCommand', undefined as unknown as ICommand, MetaData.None)
    // The current project's persistent tool-approval rules (review + revoke). The
    // chat template shows it as a collapsible "Approved tools" section (only when
    // the project has rules).
    public static readonly ApprovalsKey = Model.RegisterProperty<ApprovalRulesVM>(
        AgentService, 'Approvals', undefined as unknown as ApprovalRulesVM, MetaData.None)

    private readonly reducer = new TranscriptReducer()
    private readonly agent: IAgentApi
    private readonly fallbackCwd: string
    private readonly store: OpenProjectsStore
    // The agent's target directories = the open-project folders. The first is the
    // CLI cwd; the rest ride as --add-dir. Kept in sync with the store.
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
        // Receives the KeyDown's KeyEventArgs; sends only on Return so plain typing
        // in the input doesn't post a turn.
        this.set_property_value(AgentService.SubmitCommandKey, new RelayCommand((arg) => {
            if ((arg as { Key?: unknown } | undefined)?.Key === Key.Return) this.send()
        }))

        // A submitted answer goes back to the agent bridge; a change in the pending
        // set gates the input row (CanInput).
        this.reducer.onAnswerSubmitted = (answer) => { void this.agent.answerQuestion(answer) }
        this.reducer.onToolApprovalSubmitted = (answer) => { void this.agent.answerToolApproval(answer) }
        this.reducer.onPendingChange = () =>
            this.set_property_value(AgentService.CanInputKey, !this.reducer.HasPendingQuestion)

        // Fold every pushed agent event into the transcript. create_project is
        // diverted: its card + creation are assembled asynchronously here.
        this.agent.onEvent((event) => {
            if (event.Kind === AgentEventKind.CreateProject) { void this.handleCreateProject(event.Request); return }
            this.reducer.apply(event)
        })

        // Persistent-approvals surface: a VM over the bridge, keyed live to the
        // current agent cwd, so it always shows the active project's rules.
        const port: ApprovalRulesPort = {
            list: (key) => this.agent.listApprovalRules(key),
            revoke: (key, rule) => this.agent.revokeApprovalRule(key, rule),
        }
        this.set_property_value(AgentService.ApprovalsKey, new ApprovalRulesVM(port, () => this.currentCwd()))

        // Track the open-project set: seed from the store (forcing a load), then
        // follow changes. Each change re-targets the NEXT turn + refreshes Status.
        this.applyDirs(this.store.Current())
        void this.store.List().then((dirs) => this.applyDirs(dirs))
        this.unsubscribe = this.store.Subscribe((dirs) => this.applyDirs(dirs))
    }

    // Adopt a new open-project directory set: cache it and reflect the resulting
    // agent target (cwd + optional extras) in the Status line.
    private applyDirs(dirs: readonly string[]): void
    {
        this.workingDirs = [...dirs]
        const cwd = dirs.length > 0 ? dirs[0] : this.fallbackCwd
        const extra = dirs.length > 1 ? ` (+${dirs.length - 1} more)` : ''
        this.set_property_value(AgentService.StatusKey, `Agent directory: ${cwd}${extra}`)
        // The active project changed → reload its persistent approval rules.
        void this.Approvals?.Refresh()
    }

    // The agent's cwd = the first open-project folder, or the environment fallback.
    // Also the key the persistent approval rules are scoped under.
    private currentCwd(): string
    {
        return this.workingDirs.length > 0 ? this.workingDirs[0] : this.fallbackCwd
    }

    // Drop the store subscription (the shell calls this when the service is torn
    // down; harmless if it isn't).
    public Dispose(): void { this.unsubscribe?.() }

    public get Id(): string { return this.get_property_value(AgentService.IdKey) }
    public get Title(): string { return this.get_property_value(AgentService.TitleKey) }
    public get Transcript(): ObservableCollection<Model> { return this.get_property_value(AgentService.TranscriptKey) }
    public get Draft(): string { return this.get_property_value(AgentService.DraftKey) }
    public set Draft(value: string) { this.set_property_value(AgentService.DraftKey, value) }
    public get Status(): string { return this.get_property_value(AgentService.StatusKey) }
    public get CanInput(): boolean { return this.get_property_value(AgentService.CanInputKey) }
    public get SendCommand(): ICommand { return this.get_property_value(AgentService.SendCommandKey) }
    public get SubmitCommand(): ICommand { return this.get_property_value(AgentService.SubmitCommandKey) }
    public get Approvals(): ApprovalRulesVM { return this.get_property_value(AgentService.ApprovalsKey) }

    private send(): void
    {
        const text = this.Draft.trim()
        if (text === '') return
        // Blocked on a pending question — the user must answer the card first.
        if (!this.CanInput) return
        const dirs = this.workingDirs
        const cwd = this.currentCwd()
        const addDirs = dirs.length > 0 ? dirs.slice(1) : []
        this.reducer.beginUserTurn(text)   // optimistic echo
        void this.agent.sendTurn(cwd, addDirs, text)
        this.set_property_value(AgentService.DraftKey, '')
    }

    // The agent called create_project: build a pre-filled New Project form (the
    // modal's view-model), host it in a card in the transcript, and — when the
    // user submits — create the project via the shared creator and post the
    // outcome back to unblock the tool. Cancel posts a cancelled outcome.
    private async handleCreateProject(req: CreateProjectRequest): Promise<void>
    {
        const explorer = this.Provider.getRequired(ProjectExplorerService.Key)
        const card = new NewProjectCard(req.id)
        const close = (result?: NewProjectResult): void =>
        {
            if (result === undefined)
            {
                card.showCancelled()
                void this.agent.createProjectResult({ id: req.id, created: false, cancelled: true })
                this.reducer.releasePending(req.id)
                return
            }
            void (async () =>
            {
                const outcome = await explorer.CreateProject(result)
                card.showResult(outcome)
                void this.agent.createProjectResult({ id: req.id, ...outcome })
                this.reducer.releasePending(req.id)
            })()
        }
        card.Form = await explorer.NewProjectFormFor(close, req.prefill)
        this.reducer.addPendingCard(req.id, card)
    }
}

export default AgentService

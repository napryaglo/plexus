// ChatSessionsService — the renderer manager for multiple parallel agent
// conversations. Owns the single window.api.agent listener, mints/opens/closes
// conversations as right-dock tabs, routes each tagged event to the matching
// ChatSession by sessionId, and persists resumable conversations via ChatStore.
// Backs the Conversations nav panel. Root-registered (like ProblemsService).
import {
    MetaData, MuralBase, ObservableCollection, RelayCommand, ServiceBase, ServiceKey,
    type ICommand, type IServiceProvider,
} from '@pragmatic-lab/mural/runtime'
import { PanelDockService } from '@pragmatic-lab/mural/framework'
import {
    AgentEventKind,
    type AgentEvent, type CreateProjectRequest, type IAgentApi,
} from '../../../../../shared/agent-api.js'
import { EnvironmentService } from '../../../services/environment/environment-service.js'
import { OpenProjectsStore } from '../../../services/projects/open-projects-store.js'
import { ProjectExplorerService } from '../../project-explorer/services/project-explorer-service.js'
import type { NewProjectResult } from '../../../services/projects/new-project-dialog-model.js'
import { NewProjectCard } from './new-project-card.js'
import { ApprovalRulesVM, type ApprovalRulesPort } from './approval-rules.js'
import { ChatSession, type ChatSessionCallbacks } from './chat-session.js'
import type { TranscriptReducer } from './transcript.js'
import { ChatStore } from './chat-store.js'
import { StoredConversationRow } from './stored-conversation-row.js'
import { serializeTranscript, rehydrateTranscript } from './transcript-serializer.js'

export class ChatSessionsService extends ServiceBase
{
    public static readonly Key = new ServiceKey<ChatSessionsService>('ChatSessionsService')

    public static readonly OpenKey = MuralBase.RegisterProperty<ObservableCollection<ChatSession>>(
        ChatSessionsService, 'Open', undefined as unknown as ObservableCollection<ChatSession>, MetaData.None)
    public static readonly StoredKey = MuralBase.RegisterProperty<ObservableCollection<StoredConversationRow>>(
        ChatSessionsService, 'Stored', undefined as unknown as ObservableCollection<StoredConversationRow>, MetaData.None)
    public static readonly ActiveChatKey = MuralBase.RegisterProperty<ChatSession | undefined>(
        ChatSessionsService, 'ActiveChat', undefined, MetaData.None)
    public static readonly NewConversationCommandKey = MuralBase.RegisterProperty<ICommand>(
        ChatSessionsService, 'NewConversationCommand', undefined as unknown as ICommand, MetaData.None)

    private readonly agent: IAgentApi
    private readonly store: OpenProjectsStore
    private readonly fallbackCwd: string
    private readonly approvals: ApprovalRulesVM
    private workingDirs: readonly string[] = []
    private resumable = false

    constructor(provider: IServiceProvider)
    {
        super(provider)
        const bridge = (globalThis as unknown as { api?: { agent?: IAgentApi } }).api
        if (bridge?.agent === undefined)
            throw new Error('ChatSessionsService: window.api.agent is unavailable — requires the Plexus desktop host.')
        this.agent = bridge.agent
        this.store = provider.getRequired(OpenProjectsStore.Key)
        this.fallbackCwd = provider.get(EnvironmentService.Key)?.CurrentDirectory ?? ''

        this.set_property_value(ChatSessionsService.OpenKey, new ObservableCollection<ChatSession>())
        this.set_property_value(ChatSessionsService.StoredKey, new ObservableCollection<StoredConversationRow>())
        this.set_property_value(ChatSessionsService.NewConversationCommandKey, new RelayCommand(() => { this.NewConversation() }))

        // Shared persistent-approvals VM keyed to the current agent cwd — all
        // conversations target the same workspace, so they share one rules view.
        const port: ApprovalRulesPort = {
            list: (key) => this.agent.listApprovalRules(key),
            revoke: (key, rule) => this.agent.revokeApprovalRule(key, rule),
        }
        this.approvals = new ApprovalRulesVM(port, () => this.currentCwd())

        // Track the shared workspace dirs (seed, then follow changes).
        this.applyDirs(this.store.Current())
        void this.store.List().then((dirs) => this.applyDirs(dirs))
        this.store.Subscribe((dirs) => this.applyDirs(dirs))

        // One router for the whole app: fan tagged events to the matching session.
        this.agent.onEvent((msg) => this.route(msg.SessionId, msg.Event))
        void this.agent.isResumable().then((r) => { this.resumable = r })
    }

    public get Open(): ObservableCollection<ChatSession> { return this.get_property_value(ChatSessionsService.OpenKey) }
    public get Stored(): ObservableCollection<StoredConversationRow> { return this.get_property_value(ChatSessionsService.StoredKey) }
    public get ActiveChat(): ChatSession | undefined { return this.get_property_value(ChatSessionsService.ActiveChatKey) }
    public get NewConversationCommand(): ICommand { return this.get_property_value(ChatSessionsService.NewConversationCommandKey) }

    private get dock(): PanelDockService { return this.Provider.getRequired(PanelDockService.Key) }
    private get chatStore(): ChatStore { return this.Provider.getRequired(ChatStore.Key) }

    private callbacks(): ChatSessionCallbacks
    {
        return {
            send: (id, text) => { void this.agent.sendTurn(id, this.currentCwd(), this.addDirs(), text) },
            answerQuestion: (_id, answer) => { void this.agent.answerQuestion(answer) },
            answerToolApproval: (_id, answer) => { void this.agent.answerToolApproval(answer) },
            createProject: (id, req, reducer) => { void this.handleCreateProject(id, req, reducer) },
        }
    }

    // Mint a brand-new empty conversation, start its backend session, and show it.
    public NewConversation(): ChatSession
    {
        const sessionId = crypto.randomUUID()
        const title = `Chat ${this.Open.Count + 1}`
        const chat = new ChatSession(sessionId, title, this.callbacks(), this.approvals)
        chat.setStatus(this.statusText())
        this.Open.Add(chat)
        this.dock.Add(chat)
        this.dock.SelectedPanel = chat
        this.set_property_value(ChatSessionsService.ActiveChatKey, chat)
        void this.agent.startSession(sessionId, this.currentCwd(), this.addDirs())
        return chat
    }

    // Rehydrate a stored conversation into a live tab (resuming its AI context on the
    // first new turn). Activates it if already open.
    public async OpenStored(id: string): Promise<ChatSession | undefined>
    {
        const existing = this.Open.ToArray().find((c) => c.Id === id)
        if (existing !== undefined) { this.dock.SelectedPanel = existing; return existing }
        const rec = (await this.chatStore.List()).find((r) => r.Id === id)
        if (rec === undefined) return undefined
        const chat = new ChatSession(rec.Id, rec.Title, this.callbacks(), this.approvals)
        chat.setStatus(this.statusText())
        for (const item of rehydrateTranscript(rec.Transcript)) chat.Transcript.Add(item)
        this.Open.Add(chat)
        this.dock.Add(chat)
        this.dock.SelectedPanel = chat
        this.set_property_value(ChatSessionsService.ActiveChatKey, chat)
        void this.agent.startSession(rec.Id, this.currentCwd(), this.addDirs(), rec.ResumeToken)
        return chat
    }

    public Close(chat: ChatSession): void
    {
        this.dock.Remove(chat)
        this.Open.Remove(chat)
        void this.agent.closeSession(chat.Id)
    }

    public async Reveal(sessionId: string): Promise<void>
    {
        const open = this.Open.ToArray().find((c) => c.Id === sessionId)
        if (open !== undefined) { this.dock.SelectedPanel = open; return }
        await this.OpenStored(sessionId)
    }

    // Load stored (restorable) conversations into the nav panel's Stored list. Not
    // auto-spawned as live subprocesses — the user opens one to resume it.
    public async RestoreSession(): Promise<void>
    {
        for (const rec of await this.chatStore.List())
            this.Stored.Add(new StoredConversationRow(rec, (id) => { void this.Reveal(id) }))
    }

    private route(sessionId: string, event: AgentEvent): void
    {
        const chat = this.Open.ToArray().find((c) => c.Id === sessionId)
        if (chat === undefined) return
        if (event.Kind === AgentEventKind.SessionStarted) void this.persist(chat, event.SessionId)
        chat.apply(event)
    }

    // Persist only when the provider can resume AND we have a token (per spec §6.4).
    private async persist(chat: ChatSession, resumeToken: string): Promise<void>
    {
        if (!this.resumable || resumeToken === '') return
        await this.chatStore.Upsert({
            Id: chat.Id, Title: chat.Title, ResumeToken: resumeToken,
            Transcript: serializeTranscript(chat.Transcript.ToArray()),
        })
    }

    private applyDirs(dirs: readonly string[]): void
    {
        this.workingDirs = [...dirs]
        const status = this.statusText()
        for (const chat of this.Open.ToArray()) chat.setStatus(status)
        void this.approvals.Refresh()
    }

    private statusText(): string
    {
        const cwd = this.currentCwd()
        const extra = this.workingDirs.length > 1 ? ` (+${this.workingDirs.length - 1} more)` : ''
        return `Agent directory: ${cwd}${extra}`
    }

    private currentCwd(): string { return this.workingDirs.length > 0 ? this.workingDirs[0] : this.fallbackCwd }
    private addDirs(): string[] { return this.workingDirs.length > 0 ? [...this.workingDirs.slice(1)] : [] }

    // The agent called create_project on this session: build a pre-filled New Project
    // form, host it in a card in that conversation's transcript, and post the outcome
    // back to unblock the tool. Same flow as the old AgentService.handleCreateProject.
    private async handleCreateProject(_sessionId: string, req: CreateProjectRequest, reducer: TranscriptReducer): Promise<void>
    {
        const explorer = this.Provider.getRequired(ProjectExplorerService.Key)
        const card = new NewProjectCard(req.id)
        const close = (result?: NewProjectResult): void => {
            if (result === undefined) {
                card.showCancelled()
                void this.agent.createProjectResult({ id: req.id, created: false, cancelled: true })
                reducer.releasePending(req.id)
                return
            }
            void (async () => {
                const outcome = await explorer.CreateProject(result)
                card.showResult(outcome)
                void this.agent.createProjectResult({ id: req.id, ...outcome })
                reducer.releasePending(req.id)
            })()
        }
        card.Form = await explorer.NewProjectFormFor(close, req.prefill)
        reducer.addPendingCard(req.id, card)
    }
}

export default ChatSessionsService

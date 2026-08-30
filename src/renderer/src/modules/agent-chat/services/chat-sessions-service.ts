// ChatSessionsService — the renderer manager for multiple parallel agent
// conversations. Owns the single window.api.agent listener, mints/opens/closes
// conversations as right-dock tabs, routes each tagged event to the matching
// ChatSession by sessionId, and persists resumable conversations via ChatStore.
// Backs the Conversations nav panel. Root-registered (like ProblemsService).
import {
    MetaData, MuralBase, ObservableCollection, RelayCommand, ServiceBase, ServiceKey,
    type ICommand, type IServiceProvider,
} from '@pragmatic-lab/mural/runtime'
import { DialogService, PanelDockService } from '@pragmatic-lab/mural/framework'
import {
    AgentEventKind, AgentSkillKind,
    type AgentEvent, type CatalogItem, type CreateProjectRequest, type IAgentApi,
} from '../../../../../shared/agent-api.js'
import { BackgroundWorkService } from '../../background-work/services/background-work-service.js'
import { TaskKind } from '../../background-work/services/task-executor.js'
import { EnvironmentService } from '../../../services/environment/environment-service.js'
import { OpenProjectsStore } from '../../../services/projects/open-projects-store.js'
import { ProjectExplorerService } from '../../project-explorer/services/project-explorer-service.js'
import type { NewProjectResult } from '../../../services/projects/new-project-dialog-model.js'
import { NewProjectCard } from './new-project-card.js'
import { ApprovalRulesVM, type ApprovalRulesPort } from './approval-rules.js'
import { ChatSession, type ChatSessionCallbacks } from './chat-session.js'
import type { TranscriptReducer } from './transcript.js'
import { ChatStore } from './chat-store.js'
import { StoredConversationRow, type ConversationRowCallbacks } from './stored-conversation-row.js'
import { serializeTranscript, rehydrateTranscript } from './transcript-serializer.js'

// The first-turn text that invokes a catalog item. Skill → its slash command;
// agent → a natural-language instruction to use that subagent. (The exact CLI form
// for a named subagent is an open detail; this seam is trivial to adjust.)
export function seedInvocation(item: CatalogItem): string
{
    return item.kind === AgentSkillKind.Skill
        ? `/${item.name}`
        : `Use the "${item.name}" subagent for this task.`
}

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
    // Opens the shared workspace approved-tools list (the persistent approval rules)
    // in a modal dialog — one list scoped to the agent cwd, so it lives here at the
    // panel level rather than duplicated inside every conversation.
    public static readonly OpenApprovedToolsCommandKey = MuralBase.RegisterProperty<ICommand>(
        ChatSessionsService, 'OpenApprovedToolsCommand', undefined as unknown as ICommand, MetaData.None)
    // The search box (two-way) and the filtered views the nav panel actually binds.
    // VisibleOpen/VisibleStored are rebuilt from Open/Stored whenever the query or
    // either master list changes — the master collections stay unfiltered.
    public static readonly SearchTextKey = MuralBase.RegisterProperty<string>(
        ChatSessionsService, 'SearchText', '', MetaData.None)
    public static readonly VisibleOpenKey = MuralBase.RegisterProperty<ObservableCollection<ChatSession>>(
        ChatSessionsService, 'VisibleOpen', undefined as unknown as ObservableCollection<ChatSession>, MetaData.None)
    public static readonly VisibleStoredKey = MuralBase.RegisterProperty<ObservableCollection<StoredConversationRow>>(
        ChatSessionsService, 'VisibleStored', undefined as unknown as ObservableCollection<StoredConversationRow>, MetaData.None)
    // True while the search box is empty — drives the "Search sessions…" placeholder.
    public static readonly SearchEmptyKey = MuralBase.RegisterProperty<boolean>(
        ChatSessionsService, 'SearchEmpty', true, MetaData.None)

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
        this.set_property_value(ChatSessionsService.VisibleOpenKey, new ObservableCollection<ChatSession>())
        this.set_property_value(ChatSessionsService.VisibleStoredKey, new ObservableCollection<StoredConversationRow>())
        this.set_property_value(ChatSessionsService.NewConversationCommandKey, new RelayCommand(() => { this.NewConversation() }))
        this.set_property_value(ChatSessionsService.OpenApprovedToolsCommandKey, new RelayCommand(() => { void this.openApprovedTools() }))

        // Keep the filtered views in step with the query and either master list.
        this.Open.Subscribe(() => this.rebuildVisible())
        this.Stored.Subscribe(() => this.rebuildVisible())
        this.AddPropertyChangedListener(ChatSessionsService.SearchTextKey, () => {
            this.set_property_value(ChatSessionsService.SearchEmptyKey, this.SearchText.trim() === '')
            this.rebuildVisible()
        })

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
    public get VisibleOpen(): ObservableCollection<ChatSession> { return this.get_property_value(ChatSessionsService.VisibleOpenKey) }
    public get VisibleStored(): ObservableCollection<StoredConversationRow> { return this.get_property_value(ChatSessionsService.VisibleStoredKey) }
    public get ActiveChat(): ChatSession | undefined { return this.get_property_value(ChatSessionsService.ActiveChatKey) }
    public get NewConversationCommand(): ICommand { return this.get_property_value(ChatSessionsService.NewConversationCommandKey) }
    public get OpenApprovedToolsCommand(): ICommand { return this.get_property_value(ChatSessionsService.OpenApprovedToolsCommandKey) }
    public get SearchText(): string { return this.get_property_value(ChatSessionsService.SearchTextKey) }
    public set SearchText(value: string) { this.set_property_value(ChatSessionsService.SearchTextKey, value) }
    public get SearchEmpty(): boolean { return this.get_property_value(ChatSessionsService.SearchEmptyKey) }

    private get dock(): PanelDockService { return this.Provider.getRequired(PanelDockService.Key) }
    private get chatStore(): ChatStore { return this.Provider.getRequired(ChatStore.Key) }

    private callbacks(): ChatSessionCallbacks
    {
        return {
            send: (id, text) => { void this.agent.sendTurn(id, this.currentCwd(), this.addDirs(), text) },
            answerQuestion: (_id, answer) => { void this.agent.answerQuestion(answer) },
            answerToolApproval: (_id, answer) => { void this.agent.answerToolApproval(answer) },
            createProject: (id, req, reducer) => { void this.handleCreateProject(id, req, reducer) },
            rename: (id, title) => { void this.Rename(id, title) },
            close: (id) => { const c = this.Open.ToArray().find((x) => x.Id === id); if (c !== undefined) this.Close(c) },
            reveal: (id) => { void this.Reveal(id) },
        }
    }

    // Mint a brand-new empty conversation, start its backend session, and show it.
    public NewConversation(): ChatSession { return this.newSession(`Chat ${this.Open.Count + 1}`) }

    // Show the shared approved-tools list (persistent approval rules for the current
    // agent cwd) in a modal dialog. Refresh first so it reflects the latest grants;
    // scrim-click dismisses. Revoke on a row refreshes the list in place.
    private async openApprovedTools(): Promise<void>
    {
        await this.approvals.Refresh()
        const dialogs = this.Provider.get(DialogService.Key)
        await dialogs?.Show({ Title: 'Approved tools', Content: this.approvals, Width: 420, DismissOnScrimClick: true })
    }

    // Create a titled conversation, start its backend session, add it as a tab, and
    // make it active.
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

    // sessionId → resolver, fired when a seeded run's turn completes (see route()).
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
        // Seed the resume token now: a resumed CLI session may not re-emit
        // SessionStarted, so without this a later TurnComplete (and close/quit flush)
        // would find no token and skip persisting the resumed conversation's new turns.
        if (rec.ResumeToken !== '') this.tokens.set(rec.Id, rec.ResumeToken)
        void this.agent.startSession(rec.Id, this.currentCwd(), this.addDirs(), rec.ResumeToken)
        return chat
    }

    public Close(chat: ChatSession): void
    {
        // Flush the latest transcript before dropping the tab (serialize is
        // synchronous, so the snapshot is captured even as we remove the chat).
        void this.persistIfPossible(chat)
        this.dock.Remove(chat)
        this.Open.Remove(chat)
        void this.agent.closeSession(chat.Id)
    }

    // Persist every open conversation — called on application close so nothing typed
    // or received since the last turn is lost. Resolves once all writes settle.
    public async FlushAll(): Promise<void>
    {
        await Promise.all(this.Open.ToArray().map((c) => this.persistIfPossible(c)))
    }

    // Persist a chat if we hold its resume token (and the provider can resume).
    private persistIfPossible(chat: ChatSession): Promise<void>
    {
        const token = this.tokens.get(chat.Id)
        return token === undefined ? Promise.resolve() : this.persist(chat, token)
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
            this.Stored.Add(new StoredConversationRow(rec, this.rowCallbacks()))
    }

    // Row actions for the Stored list: reveal, rename (persist), delete.
    private rowCallbacks(): ConversationRowCallbacks
    {
        return {
            open: (id) => { void this.Reveal(id) },
            rename: (id, title) => { void this.Rename(id, title) },
            delete: (id) => { void this.DeleteConversation(id) },
        }
    }

    // Retitle a conversation everywhere it appears: the live tab (if open), its
    // Stored row (if listed), and the persisted record. Persists from whichever
    // source carries the resume token + transcript — the live session or the stored
    // record — so it never depends on re-reading the store. A no-op for unknown ids.
    public async Rename(id: string, title: string): Promise<void>
    {
        const live = this.Open.ToArray().find((c) => c.Id === id)
        if (live !== undefined && live.Title !== title) live.setTitle(title)
        const row = this.Stored.ToArray().find((r) => r.Record.Id === id)
        if (row !== undefined) row.Record.Title = title

        const token = this.tokens.get(id)
        if (live !== undefined && token !== undefined) await this.persist(live, token)
        else if (row !== undefined) await this.chatStore.Upsert({ ...row.Record, Title: title, UpdatedAt: now() })
        this.rebuildVisible()
    }

    // Delete a conversation: close it if live, drop its Stored row, and remove the
    // persisted record. Permanent — the CLI session (if any) is also closed.
    public async DeleteConversation(id: string): Promise<void>
    {
        const live = this.Open.ToArray().find((c) => c.Id === id)
        if (live !== undefined) this.Close(live)
        const row = this.Stored.ToArray().find((r) => r.Record.Id === id)
        if (row !== undefined) this.Stored.Remove(row)
        await this.chatStore.Remove(id)
    }

    // Rebuild the filtered views: case-insensitive title match against SearchText,
    // refreshing each stored row's relative-time label against the current clock.
    private rebuildVisible(): void
    {
        const q = this.SearchText.trim().toLowerCase()
        const clock = now()
        const openHits = this.Open.ToArray().filter((c) => q === '' || c.Title.toLowerCase().includes(q))
        const rows = this.Stored.ToArray()
        for (const r of rows) r.RefreshTime(clock)
        const storedHits = rows.filter((r) => q === '' || r.Title.toLowerCase().includes(q))
        replaceAll(this.VisibleOpen, openHits)
        replaceAll(this.VisibleStored, storedHits)
    }

    private route(sessionId: string, event: AgentEvent): void
    {
        const chat = this.Open.ToArray().find((c) => c.Id === sessionId)
        if (chat === undefined) return
        if (event.Kind === AgentEventKind.SessionStarted) { this.tokens.set(sessionId, event.SessionId); void this.persist(chat, event.SessionId) }
        if (event.Kind === AgentEventKind.TurnComplete)
        {
            // Bump the persisted record's UpdatedAt (and transcript) so "last
            // activity" time-ago stays fresh across turns.
            const token = this.tokens.get(sessionId)
            if (token !== undefined) void this.persist(chat, token)
            const done = this.pendingRuns.get(sessionId)
            if (done !== undefined) { this.pendingRuns.delete(sessionId); done() }
        }
        chat.apply(event)
    }

    // CLI resume tokens by sessionId, captured on SessionStarted — lets a later
    // TurnComplete re-persist without waiting for another SessionStarted.
    private readonly tokens = new Map<string, string>()

    // Persist only when the provider can resume AND we have a token (per spec §6.4).
    private async persist(chat: ChatSession, resumeToken: string): Promise<void>
    {
        if (!this.resumable || resumeToken === '') return
        await this.chatStore.Upsert({
            Id: chat.Id, Title: chat.Title, ResumeToken: resumeToken, UpdatedAt: now(),
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

// Wall-clock now (epoch ms). Isolated so the Date.now() call has one home — this
// is renderer code, where the no-Date.now rule (main-process only) does not apply.
function now(): number { return Date.now() }

// Replace a collection's contents in place (the panel binds these instances, so
// swapping the reference would drop the binding — clear + re-add instead).
function replaceAll<T>(target: ObservableCollection<T>, items: readonly T[]): void
{
    target.Clear()
    for (const item of items) target.Add(item)
}

export default ChatSessionsService

// One agent conversation as a dock panel: its transcript, input draft, status,
// approvals — a per-conversation VM (≈ the old AgentService, minus the singleton
// and the window bridge). Provider-free: the send/answer/create actions are
// injected as callbacks by ChatSessionsService, which owns the one IPC stream and
// routes each session's events here.
import {
    Key, MetaData, MuralBase, ObservableCollection, RelayCommand,
    type ICommand,
} from '@pragmatic-lab/mural/runtime'
import type { IDockPanel, IDocument } from '@pragmatic-lab/mural/framework'
import {
    AgentEventKind,
    type AgentEvent, type CreateProjectRequest, type QuestionAnswer, type ToolApprovalAnswer,
} from '../../../../../shared/agent-api.js'
import { TranscriptReducer } from './transcript.js'
import type { ApprovalRulesVM } from './approval-rules.js'

// The per-conversation actions ChatSession needs, injected by ChatSessionsService
// so the VM stays free of the window bridge + the environment services.
export interface ChatSessionCallbacks
{
    send(sessionId: string, text: string): void
    answerQuestion(sessionId: string, answer: QuestionAnswer): void
    answerToolApproval(sessionId: string, answer: ToolApprovalAnswer): void
    createProject(sessionId: string, req: CreateProjectRequest, reducer: TranscriptReducer): void
    // Persist a title change (and keep the store in sync); close the whole session;
    // focus this conversation's tab from the nav list.
    rename(sessionId: string, title: string): void
    close(sessionId: string): void
    reveal(sessionId: string): void
}

// A conversation is both an IDockPanel (the primary "Agent Chat" lives in the
// right dock) and an IDocument (every other session opens as an editor tab) — the
// same DataTemplate[ChatSession] renders it in either host.
export class ChatSession extends MuralBase implements IDockPanel, IDocument
{
    public static readonly IdKey = MuralBase.RegisterProperty<string>(ChatSession, 'Id', '', MetaData.None)
    public static readonly TitleKey = MuralBase.RegisterProperty<string>(ChatSession, 'Title', 'Chat', MetaData.None)
    public static readonly TranscriptKey = MuralBase.RegisterProperty<ObservableCollection<MuralBase>>(
        ChatSession, 'Transcript', undefined as unknown as ObservableCollection<MuralBase>, MetaData.None)
    public static readonly DraftKey = MuralBase.RegisterProperty<string>(ChatSession, 'Draft', '', MetaData.None)
    public static readonly StatusKey = MuralBase.RegisterProperty<string>(ChatSession, 'Status', 'idle', MetaData.None)
    // False while the agent is blocked on a pending card — the input row binds
    // IsEnabled = $CanInput so a turn can't be sent mid-question.
    public static readonly CanInputKey = MuralBase.RegisterProperty<boolean>(ChatSession, 'CanInput', true, MetaData.None)
    public static readonly SendCommandKey = MuralBase.RegisterProperty<ICommand>(
        ChatSession, 'SendCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly SubmitCommandKey = MuralBase.RegisterProperty<ICommand>(
        ChatSession, 'SubmitCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly ApprovalsKey = MuralBase.RegisterProperty<ApprovalRulesVM>(
        ChatSession, 'Approvals', undefined as unknown as ApprovalRulesVM, MetaData.None)
    // Inline-rename state for the nav-panel row (IsEditing swaps a TextBox in for
    // the title, EditTitle two-ways the draft — same shape as StoredConversationRow).
    public static readonly IsEditingKey = MuralBase.RegisterProperty<boolean>(ChatSession, 'IsEditing', false, MetaData.None)
    public static readonly EditTitleKey = MuralBase.RegisterProperty<string>(ChatSession, 'EditTitle', '', MetaData.None)
    public static readonly BeginRenameCommandKey = MuralBase.RegisterProperty<ICommand>(
        ChatSession, 'BeginRenameCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly RenameKeyCommandKey = MuralBase.RegisterProperty<ICommand>(
        ChatSession, 'RenameKeyCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly CloseCommandKey = MuralBase.RegisterProperty<ICommand>(
        ChatSession, 'CloseCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly RevealCommandKey = MuralBase.RegisterProperty<ICommand>(
        ChatSession, 'RevealCommand', undefined as unknown as ICommand, MetaData.None)

    private readonly reducer = new TranscriptReducer()
    private readonly sessionId: string
    private readonly callbacks: ChatSessionCallbacks

    constructor(sessionId: string, title: string, callbacks: ChatSessionCallbacks, approvals?: ApprovalRulesVM)
    {
        super()
        this.sessionId = sessionId
        this.callbacks = callbacks
        this.set_property_value(ChatSession.IdKey, sessionId)
        this.set_property_value(ChatSession.TitleKey, title)
        this.set_property_value(ChatSession.TranscriptKey, this.reducer.Transcript)
        if (approvals !== undefined) this.set_property_value(ChatSession.ApprovalsKey, approvals)

        this.set_property_value(ChatSession.SendCommandKey, new RelayCommand(() => this.send()))
        this.set_property_value(ChatSession.SubmitCommandKey, new RelayCommand((arg) => {
            if ((arg as { Key?: unknown } | undefined)?.Key === Key.Return) this.send()
        }))
        this.set_property_value(ChatSession.CloseCommandKey, new RelayCommand(() => this.callbacks.close(this.sessionId)))
        this.set_property_value(ChatSession.RevealCommandKey, new RelayCommand(() => this.callbacks.reveal(this.sessionId)))
        this.set_property_value(ChatSession.BeginRenameCommandKey, new RelayCommand(() => this.beginRename()))
        this.set_property_value(ChatSession.RenameKeyCommandKey, new RelayCommand((arg) => this.onRenameKey(arg)))

        this.reducer.onAnswerSubmitted = (answer) => this.callbacks.answerQuestion(this.sessionId, answer)
        this.reducer.onToolApprovalSubmitted = (answer) => this.callbacks.answerToolApproval(this.sessionId, answer)
        this.reducer.onPendingChange = () =>
            this.set_property_value(ChatSession.CanInputKey, !this.reducer.HasPendingQuestion)
    }

    public get Id(): string { return this.get_property_value(ChatSession.IdKey) }
    public get Title(): string { return this.get_property_value(ChatSession.TitleKey) }
    public get Transcript(): ObservableCollection<MuralBase> { return this.get_property_value(ChatSession.TranscriptKey) }
    public get Draft(): string { return this.get_property_value(ChatSession.DraftKey) }
    public set Draft(value: string) { this.set_property_value(ChatSession.DraftKey, value) }
    public get Status(): string { return this.get_property_value(ChatSession.StatusKey) }
    public get CanInput(): boolean { return this.get_property_value(ChatSession.CanInputKey) }
    public get SendCommand(): ICommand { return this.get_property_value(ChatSession.SendCommandKey) }
    public get SubmitCommand(): ICommand { return this.get_property_value(ChatSession.SubmitCommandKey) }
    public get Approvals(): ApprovalRulesVM { return this.get_property_value(ChatSession.ApprovalsKey) }
    public get Reducer(): TranscriptReducer { return this.reducer }
    public get IsEditing(): boolean { return this.get_property_value(ChatSession.IsEditingKey) }
    public get EditTitle(): string { return this.get_property_value(ChatSession.EditTitleKey) }
    public set EditTitle(value: string) { this.set_property_value(ChatSession.EditTitleKey, value) }
    public get CloseCommand(): ICommand { return this.get_property_value(ChatSession.CloseCommandKey) }
    public get RevealCommand(): ICommand { return this.get_property_value(ChatSession.RevealCommandKey) }
    public get BeginRenameCommand(): ICommand { return this.get_property_value(ChatSession.BeginRenameCommandKey) }
    public get RenameKeyCommand(): ICommand { return this.get_property_value(ChatSession.RenameKeyCommandKey) }

    // IDocument surface — conversations auto-persist (ChatSessionsService flushes on
    // turn-complete / close / quit), so the editor tab never shows a dirty dot and
    // Save is a no-op.
    public get IsDirty(): boolean { return false }
    public Save(): void { /* conversations persist themselves; nothing to flush here */ }

    public setStatus(text: string): void { this.set_property_value(ChatSession.StatusKey, text) }

    // Set the tab title directly — used when a Stored row renames a conversation
    // that is currently open, so the live tab reflects the new name.
    public setTitle(title: string): void { this.set_property_value(ChatSession.TitleKey, title) }

    private beginRename(): void
    {
        this.set_property_value(ChatSession.EditTitleKey, this.Title)
        this.set_property_value(ChatSession.IsEditingKey, true)
    }

    // Return commits, Escape cancels — mirrors StoredConversationRow / SubmitCommand.
    private onRenameKey(arg: unknown): void
    {
        const key = (arg as { Key?: unknown } | undefined)?.Key
        if (key === Key.Return) this.commitRename()
        else if (key === Key.Escape) this.set_property_value(ChatSession.IsEditingKey, false)
    }

    private commitRename(): void
    {
        this.set_property_value(ChatSession.IsEditingKey, false)
        const next = this.EditTitle.trim()
        if (next === '' || next === this.Title) return
        this.setTitle(next)
        this.callbacks.rename(this.sessionId, next)
    }

    // Fold one already-routed agent event into this conversation. create_project is
    // delegated (its form needs the environment); everything else goes to the reducer.
    public apply(event: AgentEvent): void
    {
        if (event.Kind === AgentEventKind.CreateProject) { this.callbacks.createProject(this.sessionId, event.Request, this.reducer); return }
        this.reducer.apply(event)
    }

    private send(): void
    {
        const text = this.Draft.trim()
        if (text === '') return
        if (!this.CanInput) return
        this.reducer.beginUserTurn(text)   // optimistic echo
        this.callbacks.send(this.sessionId, text)
        this.set_property_value(ChatSession.DraftKey, '')
    }
}

export default ChatSession

// One agent conversation as a dock panel: its transcript, input draft, status,
// approvals — a per-conversation VM (≈ the old AgentService, minus the singleton
// and the window bridge). Provider-free: the send/answer/create actions are
// injected as callbacks by ChatSessionsService, which owns the one IPC stream and
// routes each session's events here.
import {
    Key, MetaData, MuralBase, ObservableCollection, RelayCommand,
    type ICommand,
} from '@pragmatic-lab/mural/runtime'
import type { IDockPanel } from '@pragmatic-lab/mural/framework'
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
}

export class ChatSession extends MuralBase implements IDockPanel
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

    public setStatus(text: string): void { this.set_property_value(ChatSession.StatusKey, text) }

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

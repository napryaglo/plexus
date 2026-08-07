// Renderer-side transcript: three item Models (bound by DataType in
// agent-chat.resources.mu) and the pure reducer that folds AgentEvents into an
// ObservableCollection. Kept free of ServiceBase/window so it is unit-testable;
// AgentService is a thin shell over it.
import { MetaData, Model, ObservableCollection, RelayCommand, type ICommand } from '@pragmatic-lab/mural/runtime'
import { type FlowDocument } from '@pragmatic-lab/mural/basic'
import { AgentEventKind, type AgentEvent, type QuestionAnswer, type ToolApprovalAnswer } from '../../../../../shared/agent-api.js'
import { buildFlowDocument } from './markdown-document.js'
import { QuestionCard } from './question-card.js'
import { ToolApprovalCard } from './approval-card.js'

export enum TranscriptRole { User = 'user', Assistant = 'assistant', Tool = 'tool' }

export class UserMessage extends Model
{
    public static readonly TextKey = Model.RegisterProperty<string>(UserMessage, 'Text', '', MetaData.None)
    constructor(text: string) { super(); this.set_property_value(UserMessage.TextKey, text) }
    public get Text(): string { return this.get_property_value(UserMessage.TextKey) }
}

export class AssistantMessage extends Model
{
    public static readonly TextKey = Model.RegisterProperty<string>(AssistantMessage, 'Text', '', MetaData.None)
    // The formatted view of Text — the agent writes markdown, so we parse it into
    // a FlowDocument the RichTextBlock lays out (headings, bold, code, lists, …).
    // Rebuilt on every delta so formatting appears live as the response streams.
    public static readonly DocumentKey = Model.RegisterProperty<FlowDocument | undefined>(
        AssistantMessage, 'Document', undefined, MetaData.None)

    public get Text(): string { return this.get_property_value(AssistantMessage.TextKey) }
    public get Document(): FlowDocument | undefined { return this.get_property_value(AssistantMessage.DocumentKey) }

    // Append a token delta — set_property_value fires INotifyPropertyChanged so
    // the bound RichTextBlock re-renders live. Reparsing the whole text each time
    // is O(n) per delta; fine for chat-sized responses.
    public appendText(delta: string): void
    {
        const text = this.Text + delta
        this.set_property_value(AssistantMessage.TextKey, text)
        this.set_property_value(AssistantMessage.DocumentKey, buildFlowDocument(text))
    }
}

// A tool the agent invoked. The header (Name + Description + Status) is always
// shown; the body — IN (the tool's command / input) and OUT (a capped slice of
// the result) — collapses. Starts collapsed; ToggleCommand flips it. Every
// view-bound field is a DP (mural binds via get_property_value).
export class ToolActivity extends Model
{
    public static readonly NameKey           = Model.RegisterProperty<string>(ToolActivity, 'Name', '', MetaData.None)
    public static readonly DescriptionKey    = Model.RegisterProperty<string>(ToolActivity, 'Description', '', MetaData.None)
    public static readonly HasDescriptionKey = Model.RegisterProperty<boolean>(ToolActivity, 'HasDescription', false, MetaData.None)
    public static readonly CommandKey        = Model.RegisterProperty<string>(ToolActivity, 'Command', '', MetaData.None)
    public static readonly HasCommandKey     = Model.RegisterProperty<boolean>(ToolActivity, 'HasCommand', false, MetaData.None)
    public static readonly OutputKey         = Model.RegisterProperty<string>(ToolActivity, 'Output', '', MetaData.None)
    public static readonly HasOutputKey      = Model.RegisterProperty<boolean>(ToolActivity, 'HasOutput', false, MetaData.None)
    public static readonly StatusKey         = Model.RegisterProperty<string>(ToolActivity, 'Status', 'running', MetaData.None)
    // IsExpanded + its inverse — no inverse Visibility converter exists, so the
    // collapsed-caret binds $IsCollapsed and the body binds $IsExpanded.
    public static readonly IsExpandedKey     = Model.RegisterProperty<boolean>(ToolActivity, 'IsExpanded', false, MetaData.None)
    public static readonly IsCollapsedKey    = Model.RegisterProperty<boolean>(ToolActivity, 'IsCollapsed', true, MetaData.None)
    public static readonly ToggleCommandKey  = Model.RegisterProperty<ICommand>(
        ToolActivity, 'ToggleCommand', undefined as unknown as ICommand, MetaData.None)

    public readonly Id: string

    constructor(id: string, name: string, input: unknown)
    {
        super()
        this.Id = id
        const description = toolDescription(input)
        const command = toolDetail(input)
        this.set_property_value(ToolActivity.NameKey, name)
        this.set_property_value(ToolActivity.DescriptionKey, description)
        this.set_property_value(ToolActivity.HasDescriptionKey, description !== '')
        this.set_property_value(ToolActivity.CommandKey, command)
        this.set_property_value(ToolActivity.HasCommandKey, command !== '')
        this.set_property_value(ToolActivity.ToggleCommandKey, new RelayCommand(() => this.toggle()))
    }

    public get Name(): string { return this.get_property_value(ToolActivity.NameKey) }
    public get Description(): string { return this.get_property_value(ToolActivity.DescriptionKey) }
    public get HasDescription(): boolean { return this.get_property_value(ToolActivity.HasDescriptionKey) }
    public get Command(): string { return this.get_property_value(ToolActivity.CommandKey) }
    public get HasCommand(): boolean { return this.get_property_value(ToolActivity.HasCommandKey) }
    public get Output(): string { return this.get_property_value(ToolActivity.OutputKey) }
    public get HasOutput(): boolean { return this.get_property_value(ToolActivity.HasOutputKey) }
    public get Status(): string { return this.get_property_value(ToolActivity.StatusKey) }
    public get IsExpanded(): boolean { return this.get_property_value(ToolActivity.IsExpandedKey) }
    public get IsCollapsed(): boolean { return this.get_property_value(ToolActivity.IsCollapsedKey) }
    public get ToggleCommand(): ICommand { return this.get_property_value(ToolActivity.ToggleCommandKey) }

    public setStatus(status: string): void { this.set_property_value(ToolActivity.StatusKey, status) }
    public setOutput(output: string): void
    {
        this.set_property_value(ToolActivity.OutputKey, output)
        this.set_property_value(ToolActivity.HasOutputKey, output !== '')
    }

    private toggle(): void
    {
        const next = !this.IsExpanded
        this.set_property_value(ToolActivity.IsExpandedKey, next)
        this.set_property_value(ToolActivity.IsCollapsedKey, !next)
    }
}

// Header subtitle — the agent's own one-line description (e.g. Bash's
// `description` param). Empty for tools that don't supply one.
function toolDescription(input: unknown): string
{
    if (input !== null && typeof input === 'object')
    {
        const d = (input as Record<string, unknown>).description
        if (typeof d === 'string') return d
    }
    return ''
}

// The IN block — a tool's `command` (Bash) verbatim, otherwise its remaining
// input fields as `key: value` lines. `description` is dropped (header subtitle).
function toolDetail(input: unknown): string
{
    if (input === null || input === undefined) return ''
    if (typeof input !== 'object') return String(input)
    const o = input as Record<string, unknown>
    if (typeof o.command === 'string') return o.command
    return Object.entries(o)
        .filter(([k]) => k !== 'description')
        .map(([k, v]) => `${k}: ${typeof v === 'string' || typeof v === 'number' ? v : JSON.stringify(v)}`)
        .join('\n')
}

export class TranscriptReducer
{
    public readonly Transcript = new ObservableCollection<Model>()

    // The assistant bubble currently being streamed into, or null when the next
    // text delta should open a fresh one.
    private currentAssistant: AssistantMessage | null = null
    // Tool activities awaiting their result, keyed by tool_use id.
    private readonly pendingTools = new Map<string, ToolActivity>()
    // Blocking cards awaiting the user (question + create-project cards), by
    // request id — while any is open the input row is gated.
    private readonly pendingQuestions = new Set<string>()

    // Set by AgentService: forward a submitted answer to the agent bridge, and
    // react when the pending-question set changes (to gate input).
    public onAnswerSubmitted: ((answer: QuestionAnswer) => void) | undefined
    public onPendingChange: (() => void) | undefined
    // Set by AgentService: forward a submitted tool-approval verdict to the bridge.
    public onToolApprovalSubmitted: ((answer: ToolApprovalAnswer) => void) | undefined

    // True while any card is still awaiting an answer (the turn is blocked).
    public get HasPendingQuestion(): boolean { return this.pendingQuestions.size > 0 }

    public beginUserTurn(text: string): void
    {
        this.currentAssistant = null
        this.Transcript.Add(new UserMessage(text))
    }

    // Add a card built outside the reducer (e.g. the create_project card, whose
    // form AgentService assembles asynchronously), mirroring how the Question case
    // adds a QuestionCard: reset the open assistant bubble, track it as a blocking
    // card so input is gated, and insert it.
    public addPendingCard(id: string, card: Model): void
    {
        this.currentAssistant = null
        this.pendingQuestions.add(id)
        this.Transcript.Add(card)
        this.onPendingChange?.()
    }

    // Release a blocking card once its interaction completes.
    public releasePending(id: string): void
    {
        this.pendingQuestions.delete(id)
        this.onPendingChange?.()
    }

    public apply(event: AgentEvent): void
    {
        switch (event.Kind)
        {
            case AgentEventKind.AssistantText:
                if (this.currentAssistant === null)
                {
                    this.currentAssistant = new AssistantMessage()
                    this.Transcript.Add(this.currentAssistant)
                }
                this.currentAssistant.appendText(event.Text)
                break

            case AgentEventKind.ToolUse:
            {
                this.currentAssistant = null
                const activity = new ToolActivity(event.Id, event.Name, event.Input)
                this.pendingTools.set(event.Id, activity)
                this.Transcript.Add(activity)
                break
            }

            case AgentEventKind.ToolResult:
            {
                const activity = this.pendingTools.get(event.Id)
                if (activity !== undefined)
                {
                    activity.setStatus(event.Ok ? 'done' : 'failed')
                    activity.setOutput(event.Summary)
                    this.pendingTools.delete(event.Id)
                }
                break
            }

            case AgentEventKind.Question:
            {
                // The agent asked a structured question: render a card and block
                // the turn until the user submits (see PlexusMcpServer).
                this.currentAssistant = null
                const request = event.Request
                this.pendingQuestions.add(request.id)
                const card = new QuestionCard(request, (answer) =>
                {
                    this.pendingQuestions.delete(request.id)
                    this.onAnswerSubmitted?.(answer)
                    this.onPendingChange?.()
                })
                this.Transcript.Add(card)
                this.onPendingChange?.()
                break
            }

            case AgentEventKind.ToolApproval:
            {
                // The CLI's permission hook asked whether a consequential tool may
                // run: render an approval card and block the turn until the user
                // answers or the card's countdown auto-approves once.
                this.currentAssistant = null
                const request = event.Request
                this.pendingQuestions.add(request.id)
                const card = new ToolApprovalCard(request, (answer) =>
                {
                    this.pendingQuestions.delete(request.id)
                    this.onToolApprovalSubmitted?.(answer)
                    this.onPendingChange?.()
                })
                this.Transcript.Add(card)
                this.onPendingChange?.()
                break
            }

            case AgentEventKind.RefreshProject:
                // Handled entirely by WorkspaceRefreshService — not part of the
                // transcript, and it must not disturb the open assistant bubble.
                break

            case AgentEventKind.CreateProject:
                // Handled by AgentService (it builds the form + card asynchronously);
                // not folded here, and it must not disturb the open assistant bubble.
                break

            case AgentEventKind.SessionStarted:
            case AgentEventKind.TurnComplete:
                // No transcript item; TurnComplete closes the current bubble so the
                // next turn's text starts fresh.
                this.currentAssistant = null
                break

            case AgentEventKind.Error:
            {
                // Surface the error inline as its own assistant bubble.
                this.currentAssistant = null
                const bubble = new AssistantMessage()
                bubble.appendText(`⚠ ${event.Message}`)
                this.Transcript.Add(bubble)
                break
            }
        }
    }
}

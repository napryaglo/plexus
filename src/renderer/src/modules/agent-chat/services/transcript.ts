// Renderer-side transcript: three item Models (bound by DataType in
// agent-chat.resources.mu) and the pure reducer that folds AgentEvents into an
// ObservableCollection. Kept free of ServiceBase/window so it is unit-testable;
// AgentService is a thin shell over it.
import { MetaData, Model, ObservableCollection } from '@pragmatic-lab/mural/runtime'
import { type FlowDocument } from '@pragmatic-lab/mural/basic'
import { AgentEventKind, type AgentEvent, type QuestionAnswer } from '../../../../../shared/agent-api.js'
import { buildFlowDocument } from './markdown-document.js'
import { QuestionCard } from './question-card.js'

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

export class ToolActivity extends Model
{
    public static readonly NameKey   = Model.RegisterProperty<string>(ToolActivity, 'Name', '', MetaData.None)
    public static readonly StatusKey = Model.RegisterProperty<string>(ToolActivity, 'Status', 'running', MetaData.None)
    public readonly Id: string
    constructor(id: string, name: string)
    {
        super()
        this.Id = id
        this.set_property_value(ToolActivity.NameKey, name)
    }
    public get Name(): string { return this.get_property_value(ToolActivity.NameKey) }
    public get Status(): string { return this.get_property_value(ToolActivity.StatusKey) }
    public setStatus(status: string): void { this.set_property_value(ToolActivity.StatusKey, status) }
}

export class TranscriptReducer
{
    public readonly Transcript = new ObservableCollection<Model>()

    // The assistant bubble currently being streamed into, or null when the next
    // text delta should open a fresh one.
    private currentAssistant: AssistantMessage | null = null
    // Tool activities awaiting their result, keyed by tool_use id.
    private readonly pendingTools = new Map<string, ToolActivity>()
    // Question cards awaiting the user's answer, by request id.
    private readonly pendingQuestions = new Set<string>()

    // Set by AgentService: forward a submitted answer to the agent bridge, and
    // react when the pending-question set changes (to gate input).
    public onAnswerSubmitted: ((answer: QuestionAnswer) => void) | undefined
    public onPendingChange: (() => void) | undefined

    // True while any card is still awaiting an answer (the turn is blocked).
    public get HasPendingQuestion(): boolean { return this.pendingQuestions.size > 0 }

    public beginUserTurn(text: string): void
    {
        this.currentAssistant = null
        this.Transcript.Add(new UserMessage(text))
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
                const activity = new ToolActivity(event.Id, event.Name)
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
                    this.pendingTools.delete(event.Id)
                }
                break
            }

            case AgentEventKind.Question:
            {
                // The agent asked a structured question: render a card and block
                // the turn until the user submits (see AskUserQuestionServer).
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

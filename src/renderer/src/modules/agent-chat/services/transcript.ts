// Renderer-side transcript: three item Models (bound by DataType in
// agent-chat.resources.mu) and the pure reducer that folds AgentEvents into an
// ObservableCollection. Kept free of ServiceBase/window so it is unit-testable;
// AgentService is a thin shell over it.
import { MetaData, Model, ObservableCollection } from '@pragmatic-lab/mural/runtime'
import { AgentEventKind, type AgentEvent } from '../../../../../shared/agent-api.js'

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
    public get Text(): string { return this.get_property_value(AssistantMessage.TextKey) }
    // Append a token delta — set_property_value fires INotifyPropertyChanged so
    // the bound TextBlock grows live.
    public appendText(delta: string): void
    {
        this.set_property_value(AssistantMessage.TextKey, this.Text + delta)
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

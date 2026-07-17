// Shared agent contract across Plexus's three Electron layers (main / preload /
// renderer), mirroring file-system-api.ts. Commands go renderer→main via
// ipcRenderer.invoke; agent events are PUSHED main→renderer via
// webContents.send on AgentChannel.Event — the first push channel in Plexus
// (all prior IPC is request/response). Enums, not literals (repo rule).

export enum AgentChannel
{
    StartSession = 'agent:start-session',
    SendTurn     = 'agent:send-turn',
    Abort        = 'agent:abort',
    Event        = 'agent:event',
}

export enum AgentEventKind
{
    SessionStarted = 'session-started',
    AssistantText  = 'assistant-text',
    ToolUse        = 'tool-use',
    ToolResult     = 'tool-result',
    TurnComplete   = 'turn-complete',
    Error          = 'error',
}

// Emitted once per session from the CLI's system:init line.
export interface SessionStartedEvent { Kind: AgentEventKind.SessionStarted; SessionId: string }
// A token delta appended to the growing assistant bubble.
export interface AssistantTextEvent  { Kind: AgentEventKind.AssistantText;  Text: string }
export interface ToolUseEvent        { Kind: AgentEventKind.ToolUse;    Id: string; Name: string; Input: unknown }
export interface ToolResultEvent     { Kind: AgentEventKind.ToolResult; Id: string; Ok: boolean; Summary: string }
export interface TurnCompleteEvent   { Kind: AgentEventKind.TurnComplete }
export interface AgentErrorEvent     { Kind: AgentEventKind.Error; Message: string }

export type AgentEvent =
    | SessionStartedEvent
    | AssistantTextEvent
    | ToolUseEvent
    | ToolResultEvent
    | TurnCompleteEvent
    | AgentErrorEvent

// The low-level bridge exposed on window.api.agent. camelCase verbs mark the raw
// IPC surface; the renderer's AgentService is the PascalCase wrapper. onEvent
// subscribes to the push channel and returns an unsubscribe function.
export interface IAgentApi
{
    startSession(workingDirectory: string): Promise<void>;
    // The renderer supplies the working directory each turn; a turn lazily starts
    // the session when none is running (see AgentSession).
    sendTurn(workingDirectory: string, text: string): Promise<void>;
    abort(): Promise<void>;
    onEvent(handler: (event: AgentEvent) => void): () => void;
}

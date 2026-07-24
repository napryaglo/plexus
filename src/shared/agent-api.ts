// Shared agent contract across Plexus's three Electron layers (main / preload /
// renderer), mirroring file-system-api.ts. Commands go renderer→main via
// ipcRenderer.invoke; agent events are PUSHED main→renderer via
// webContents.send on AgentChannel.Event — the first push channel in Plexus
// (all prior IPC is request/response). Enums, not literals (repo rule).

export enum AgentChannel
{
    StartSession   = 'agent:start-session',
    SendTurn       = 'agent:send-turn',
    Abort          = 'agent:abort',
    Event          = 'agent:event',
    // renderer→main: the user's answer to a pending AskUserQuestion card.
    AnswerQuestion = 'agent:answer-question',
    // renderer→main: the WorkspaceRefreshService's result for a pending
    // refresh_project tool call (unblocks the tool).
    RefreshProjectResult = 'agent:refresh-project-result',
}

export enum AgentEventKind
{
    SessionStarted = 'session-started',
    AssistantText  = 'assistant-text',
    ToolUse        = 'tool-use',
    ToolResult     = 'tool-result',
    // The agent called the ask_user_question tool: render a choice card and block
    // until the user answers (see AskUserQuestionServer + AnswerQuestion).
    Question       = 'question',
    // The agent called refresh_project: the renderer re-scans + re-validates the
    // target project(s) and replies via AgentChannel.RefreshProjectResult.
    RefreshProject = 'refresh-project',
    TurnComplete   = 'turn-complete',
    Error          = 'error',
}

// One selectable choice within a Question. `description` is optional helper text.
export interface QuestionOption { label: string; description?: string }
// One question in a card: prompt + a short header chip + its options. multiSelect
// allows more than one option; the card also offers a free-text "Other".
export interface Question { question: string; header: string; multiSelect: boolean; options: QuestionOption[] }
// The tool payload: 1–4 questions the user answers together, correlated by `id`.
export interface QuestionRequest { id: string; questions: Question[] }
// The user's reply, keyed by question text (mirrors the AskUserQuestion tool); an
// "Other" pick contributes the typed string as one of the array entries.
export interface QuestionAnswer { id: string; answers: Record<string, string[]> }

// refresh_project payloads. `path` (optional) targets one project by containment;
// omitted ⇒ all open projects. Correlated by `id` like a Question.
export interface RefreshProjectRequest { id: string; path?: string }
// Per-project outcome the tool returns to the agent.
export interface RefreshedProjectSummary
{
    name: string
    folder: string
    errorCount: number
    warningCount: number
    sampleMessages: string[]
}
// The tool result: one summary per refreshed project. `note` explains an empty
// set (e.g. path matched nothing); `error` marks a failure to refresh at all.
export interface RefreshProjectResult
{
    id: string
    projects: RefreshedProjectSummary[]
    note?: string
    error?: string
}

// The ask-user-question MCP tool identity. `MCP_SERVER_KEY` is the --mcp-config
// key, so the CLI re-exposes the tool to the model as ASK_TOOL_QUALIFIED. Kept in
// this dep-free shared module so the stream parser can suppress the tool's chip and
// the provider can allow-list it without importing the SDK-heavy server.
export const MCP_SERVER_KEY = 'plexus'
export const ASK_TOOL_NAME = 'ask_user_question'
export const ASK_TOOL_QUALIFIED = `mcp__${MCP_SERVER_KEY}__${ASK_TOOL_NAME}`

// The PlexusWorkspace MCP tool identity — a second in-process server. Kept next
// to the ask-tool consts so the provider can allow-list it without importing the
// SDK-heavy server.
export const WORKSPACE_SERVER_KEY = 'PlexusWorkspace'
export const REFRESH_TOOL_NAME = 'refresh_project'
export const REFRESH_TOOL_QUALIFIED = `mcp__${WORKSPACE_SERVER_KEY}__${REFRESH_TOOL_NAME}`

// Emitted once per session from the CLI's system:init line.
export interface SessionStartedEvent { Kind: AgentEventKind.SessionStarted; SessionId: string }
// A token delta appended to the growing assistant bubble.
export interface AssistantTextEvent  { Kind: AgentEventKind.AssistantText;  Text: string }
export interface ToolUseEvent        { Kind: AgentEventKind.ToolUse;    Id: string; Name: string; Input: unknown }
export interface ToolResultEvent     { Kind: AgentEventKind.ToolResult; Id: string; Ok: boolean; Summary: string }
export interface QuestionEvent       { Kind: AgentEventKind.Question; Request: QuestionRequest }
export interface RefreshProjectEvent { Kind: AgentEventKind.RefreshProject; Request: RefreshProjectRequest }
export interface TurnCompleteEvent   { Kind: AgentEventKind.TurnComplete }
export interface AgentErrorEvent     { Kind: AgentEventKind.Error; Message: string }

export type AgentEvent =
    | SessionStartedEvent
    | AssistantTextEvent
    | ToolUseEvent
    | ToolResultEvent
    | QuestionEvent
    | RefreshProjectEvent
    | TurnCompleteEvent
    | AgentErrorEvent

// The low-level bridge exposed on window.api.agent. camelCase verbs mark the raw
// IPC surface; the renderer's AgentService is the PascalCase wrapper. onEvent
// subscribes to the push channel and returns an unsubscribe function.
export interface IAgentApi
{
    startSession(workingDirectory: string, addDirs: readonly string[]): Promise<void>;
    // The renderer supplies the working directory + extra dirs each turn; a turn
    // lazily starts (or re-targets) the session (see AgentSession).
    sendTurn(workingDirectory: string, addDirs: readonly string[], text: string): Promise<void>;
    abort(): Promise<void>;
    // Reply to a pending AskUserQuestion card; unblocks the agent's tool call.
    answerQuestion(answer: QuestionAnswer): Promise<void>;
    // The renderer's summary for a pending refresh_project tool call.
    refreshProjectResult(result: RefreshProjectResult): Promise<void>;
    onEvent(handler: (event: AgentEvent) => void): () => void;
}

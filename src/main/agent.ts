// Main-process agent capability. Owns the AiProviderService (seeded with the
// Claude CLI provider) and a single AgentSession, wired to typed IPC:
//   • commands   renderer→main via ipcMain.handle
//   • events     main→renderer via webContents.send on AgentChannel.Event
// Register once from app.whenReady(), alongside registerFileSystemHandlers().
import { BrowserWindow, ipcMain } from 'electron'
import {
    AgentChannel, ASK_TOOL_QUALIFIED, CREATE_PROJECT_TOOL_QUALIFIED, MCP_SERVER_KEY, REFRESH_TOOL_QUALIFIED,
    type AgentEvent, type CreateProjectResult, type QuestionAnswer, type RefreshProjectResult,
} from '../shared/agent-api.js'
import { AiProviderService } from './agent/ai-provider-service.js'
import { ClaudeCliProvider } from './agent/claude-cli-provider.js'
import { AgentSession } from './agent/agent-session.js'
import { PlexusMcpServer } from './agent/plexus-mcp-server.js'

// Appended to the model's system prompt every session so it calls refresh_project
// after — and only after — a turn that changed files or folders in a project.
const REFRESH_INSTRUCTION =
    `Call ${REFRESH_TOOL_QUALIFIED} (optionally with a path you changed) ONLY when the `
    + 'work you just finished created, modified, deleted, moved, or renamed a file or folder inside '
    + 'a project directory, so Plexus re-scans the project from disk and re-validates its models. '
    + 'Call it once at the end of such work, not after every individual edit. Do NOT call it for '
    + 'turns that changed nothing on disk — answering a question, reading or explaining code, '
    + 'running read-only commands, or pure discussion.'

// Push an agent event to the renderer (the focused window, falling back to the
// first — a single window today, but this stays correct if more open).
function emitToRenderer(event: AgentEvent): void
{
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    win?.webContents.send(AgentChannel.Event, event)
}

export async function registerAgentHandlers(): Promise<void>
{
    // Start the single in-process MCP server hosting both agent tools
    // (ask_user_question + refresh_project) and point the CLI at it. Its Question
    // and RefreshProject events ride the same push sink as every other agent event.
    const mcpServer = new PlexusMcpServer()
    await mcpServer.listen()
    mcpServer.setSink(emitToRenderer)

    const providers = new AiProviderService()
    providers.register(new ClaudeCliProvider(undefined, undefined, {
        servers: {
            [MCP_SERVER_KEY]: { type: 'http', url: mcpServer.Url },
        },
        allowedTools: [ASK_TOOL_QUALIFIED, REFRESH_TOOL_QUALIFIED, CREATE_PROJECT_TOOL_QUALIFIED],
        // Turn off Claude Code's built-in AskUserQuestion (it can't render in
        // headless -p mode → fails), so the model uses our MCP tool instead.
        disallowedTools: ['AskUserQuestion'],
        appendSystemPrompt: REFRESH_INSTRUCTION,
    }))
    const session = new AgentSession(providers, emitToRenderer)

    ipcMain.handle(AgentChannel.StartSession, (_e, workingDirectory: string, addDirs: readonly string[]): void => {
        session.start(workingDirectory, addDirs)
    })
    ipcMain.handle(AgentChannel.SendTurn, (_e, workingDirectory: string, addDirs: readonly string[], text: string): void => {
        session.send(workingDirectory, addDirs, text)
    })
    ipcMain.handle(AgentChannel.Abort, (): void => {
        session.abort()
    })
    // The user's answer to a pending card → unblock the ask_user_question call.
    ipcMain.handle(AgentChannel.AnswerQuestion, (_e, answer: QuestionAnswer): void => {
        mcpServer.resolveAnswer(answer)
    })
    // The renderer's refresh summary → unblock the refresh_project tool call.
    ipcMain.handle(AgentChannel.RefreshProjectResult, (_e, result: RefreshProjectResult): void => {
        mcpServer.resolveRefresh(result)
    })
    // The renderer's create outcome → unblock the create_project tool call.
    ipcMain.handle(AgentChannel.CreateProjectResult, (_e, result: CreateProjectResult): void => {
        mcpServer.resolveCreate(result)
    })
}

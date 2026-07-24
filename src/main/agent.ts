// Main-process agent capability. Owns the AiProviderService (seeded with the
// Claude CLI provider) and a single AgentSession, wired to typed IPC:
//   • commands   renderer→main via ipcMain.handle
//   • events     main→renderer via webContents.send on AgentChannel.Event
// Register once from app.whenReady(), alongside registerFileSystemHandlers().
import { BrowserWindow, ipcMain } from 'electron'
import { AgentChannel, ASK_TOOL_QUALIFIED, MCP_SERVER_KEY, type AgentEvent, type QuestionAnswer } from '../shared/agent-api.js'
import { AiProviderService } from './agent/ai-provider-service.js'
import { ClaudeCliProvider } from './agent/claude-cli-provider.js'
import { AgentSession } from './agent/agent-session.js'
import { AskUserQuestionServer } from './agent/ask-user-question-server.js'

// Push an agent event to the renderer (the focused window, falling back to the
// first — a single window today, but this stays correct if more open).
function emitToRenderer(event: AgentEvent): void
{
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    win?.webContents.send(AgentChannel.Event, event)
}

export async function registerAgentHandlers(): Promise<void>
{
    // Start the in-process ask-user-question MCP tool and point the CLI at it. Its
    // Question events ride the same push sink as every other agent event.
    const questionServer = new AskUserQuestionServer()
    await questionServer.listen()
    questionServer.setSink(emitToRenderer)

    const providers = new AiProviderService()
    providers.register(new ClaudeCliProvider(undefined, undefined, {
        servers: { [MCP_SERVER_KEY]: { type: 'http', url: questionServer.Url } },
        allowedTools: [ASK_TOOL_QUALIFIED],
        // Turn off Claude Code's built-in AskUserQuestion (it can't render in
        // headless -p mode → fails), so the model uses our MCP tool instead.
        disallowedTools: ['AskUserQuestion'],
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
    // The user's answer to a pending card → unblock the tool call.
    ipcMain.handle(AgentChannel.AnswerQuestion, (_e, answer: QuestionAnswer): void => {
        questionServer.resolve(answer)
    })
}

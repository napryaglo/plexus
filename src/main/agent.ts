// Main-process agent capability. Owns the AiProviderService (seeded with the
// Claude CLI provider) and a single AgentSession, wired to typed IPC:
//   • commands   renderer→main via ipcMain.handle
//   • events     main→renderer via webContents.send on AgentChannel.Event
// Register once from app.whenReady(), alongside registerFileSystemHandlers().
import { BrowserWindow, ipcMain } from 'electron'
import { AgentChannel, type AgentEvent } from '../shared/agent-api.js'
import { AiProviderService } from './agent/ai-provider-service.js'
import { ClaudeCliProvider } from './agent/claude-cli-provider.js'
import { AgentSession } from './agent/agent-session.js'

// Push an agent event to the renderer (the focused window, falling back to the
// first — a single window today, but this stays correct if more open).
function emitToRenderer(event: AgentEvent): void
{
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    win?.webContents.send(AgentChannel.Event, event)
}

export function registerAgentHandlers(): void
{
    const providers = new AiProviderService()
    providers.register(new ClaudeCliProvider())
    const session = new AgentSession(providers, emitToRenderer)

    ipcMain.handle(AgentChannel.StartSession, (_e, workingDirectory: string): void => {
        session.start(workingDirectory)
    })
    ipcMain.handle(AgentChannel.SendTurn, (_e, workingDirectory: string, text: string): void => {
        session.send(workingDirectory, text)
    })
    ipcMain.handle(AgentChannel.Abort, (): void => {
        session.abort()
    })
}

// An in-process HTTP MCP server hosting the workspace-management tool
// `refresh_project`, pointed at by the `claude` CLI via --mcp-config. When the
// agent calls it, the handler emits a RefreshProject event (so the renderer can
// re-scan + re-validate) and BLOCKS until the renderer posts a result via
// resolve(...); that result is returned as the tool output. Mirrors
// AskUserQuestionServer; the model sees it as mcp__PlexusWorkspace__refresh_project.
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import {
    AgentEventKind,
    REFRESH_TOOL_NAME,
    WORKSPACE_SERVER_KEY,
    type AgentEvent,
    type RefreshProjectResult,
} from '../../shared/agent-api.js'

export class PlexusWorkspaceServer
{
    private httpServer: http.Server | undefined
    private url = ''
    private sink: ((event: AgentEvent) => void) | undefined
    // Pending tool calls awaiting a renderer result, keyed by the id we minted.
    private readonly pending = new Map<string, (result: RefreshProjectResult) => void>()
    private seq = 0
    private readonly transports = new Map<string, StreamableHTTPServerTransport>()

    // timeoutMs guards against a dead/absent renderer so the tool never hangs.
    constructor(private readonly timeoutMs = 30000) {}

    public get Url(): string { return this.url }

    public setSink(sink: (event: AgentEvent) => void): void { this.sink = sink }

    // Deliver the renderer's summary to the blocked tool call; no-op if stale.
    public resolve(result: RefreshProjectResult): void
    {
        const done = this.pending.get(result.id)
        if (done === undefined) return
        this.pending.delete(result.id)
        done(result)
    }

    // Emit a RefreshProject request and await the renderer's result. No sink (probe
    // / headless test) → resolve with an error so the round-trip still completes.
    public requestRefresh(path?: string): Promise<RefreshProjectResult>
    {
        const id = `r${(this.seq += 1)}`
        const sink = this.sink
        if (sink === undefined)
        {
            return Promise.resolve({ id, projects: [], error: 'No Plexus window is available to refresh.' })
        }
        return new Promise((resolve) =>
        {
            const timer = setTimeout(() =>
            {
                if (this.pending.delete(id))
                {
                    resolve({ id, projects: [], error: 'Timed out waiting for the Plexus UI to refresh.' })
                }
            }, this.timeoutMs)
            // Register BEFORE emitting so a fast reply can't race pending.set.
            this.pending.set(id, (result) => { clearTimeout(timer); resolve(result) })
            sink({ Kind: AgentEventKind.RefreshProject, Request: { id, path } })
        })
    }

    public async listen(host = '127.0.0.1'): Promise<void>
    {
        this.httpServer = http.createServer((req, res) => { void this.handle(req, res) })
        await new Promise<void>((resolve) => this.httpServer!.listen(0, host, resolve))
        const address = this.httpServer!.address()
        const port = typeof address === 'object' && address !== null ? address.port : 0
        this.url = `http://${host}:${port}/mcp`
    }

    public async close(): Promise<void>
    {
        for (const [id, done] of [...this.pending])
        {
            this.pending.delete(id)
            done({ id, projects: [], error: 'Server closed.' })
        }
        for (const transport of this.transports.values()) await transport.close()
        this.transports.clear()
        await new Promise<void>((resolve) => { if (this.httpServer) this.httpServer.close(() => resolve()); else resolve() })
    }

    private buildServer(): McpServer
    {
        const server = new McpServer({ name: WORKSPACE_SERVER_KEY, version: '0.1.0' })
        server.registerTool(
            REFRESH_TOOL_NAME,
            {
                title: 'Refresh a Plexus project after changing files',
                description:
                    'Call this ONLY after finishing work that created, modified, deleted, moved, or '
                    + 'renamed a file or folder inside a project directory, so Plexus re-scans the project '
                    + 'from disk and re-validates its models. Optionally pass `path` (a file or folder you '
                    + 'changed) to target just that project; omit it to refresh all open projects. Do NOT '
                    + 'call it for read-only or conversational turns that changed nothing on disk. Returns '
                    + 'per-project validation problem counts and a few sample messages.',
                inputSchema: { path: z.string().optional() },
            },
            async ({ path }) =>
            {
                const result = await this.requestRefresh(path)
                return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
            },
        )
        return server
    }

    private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void>
    {
        const sessionId = req.headers['mcp-session-id'] as string | undefined
        const body = req.method === 'POST' ? await readJsonBody(req) : undefined

        let transport = sessionId !== undefined ? this.transports.get(sessionId) : undefined
        if (transport === undefined && req.method === 'POST' && isInitializeRequest(body))
        {
            const created = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (sid) => { this.transports.set(sid, created) },
            })
            created.onclose = () => { if (created.sessionId !== undefined) this.transports.delete(created.sessionId) }
            await this.buildServer().connect(created)
            transport = created
        }
        if (transport === undefined)
        {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'No valid MCP session' }, id: null }))
            return
        }
        await transport.handleRequest(req, res, body)
    }
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown>
{
    return new Promise((resolve) =>
    {
        let raw = ''
        req.on('data', (chunk) => { raw += chunk })
        req.on('end', () => { try { resolve(raw.length > 0 ? JSON.parse(raw) : undefined) } catch { resolve(undefined) } })
        req.on('error', () => resolve(undefined))
    })
}

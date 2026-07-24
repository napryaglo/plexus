// One in-process HTTP MCP server hosting Plexus's agent-facing tools, pointed at
// by the `claude` CLI via --mcp-config. It exposes two tools under the single
// server key `plexus`:
//
//   • ask_user_question  — surfaces a choice card and BLOCKS until the user
//     answers (resolveAnswer), returning the answer as the tool result.
//   • refresh_project    — asks the renderer to re-scan + re-validate a project
//     and BLOCKS until it posts a summary (resolveRefresh), returned as output.
//
// Both tool calls land in Plexus main (same process as the event push), so there
// is no separate MCP subprocess or bridge: the call arrives here, an event rides
// the shared sink to the renderer, and the reply flows back over the still-open
// HTTP tool-call response. The model sees the tools as
// `mcp__plexus__ask_user_question` and `mcp__plexus__refresh_project`; allow-list
// both via --allowedTools to skip the headless permission prompt.
//
// (Formerly two separate servers — AskUserQuestionServer + PlexusWorkspaceServer
// — merged into one listener with two registered tools.)
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import {
    AgentEventKind,
    ASK_TOOL_NAME,
    MCP_SERVER_KEY,
    REFRESH_TOOL_NAME,
    type AgentEvent,
    type Question,
    type QuestionAnswer,
    type RefreshProjectResult,
} from '../../shared/agent-api.js'

const optionSchema = z.object({ label: z.string(), description: z.string().optional() })
const questionSchema = z.object({
    question: z.string(),
    header: z.string(),
    multiSelect: z.boolean(),
    options: z.array(optionSchema),
})

export class PlexusMcpServer
{
    private httpServer: http.Server | undefined
    private url = ''
    private sink: ((event: AgentEvent) => void) | undefined
    // Pending tool calls awaiting a UI reply, keyed by the id we minted. Kept in
    // two typed maps — answer resolvers vs refresh resolvers — but the id space is
    // shared (`q…` vs `r…` prefixes keep them distinct).
    private readonly pendingAnswers = new Map<string, (answers: QuestionAnswer['answers']) => void>()
    private readonly pendingRefresh = new Map<string, (result: RefreshProjectResult) => void>()
    // Monotonic id source — no Date.now/Math.random (keeps behaviour deterministic
    // and dependency-free).
    private seq = 0
    // One transport per MCP session (the CLI initialises once, then reuses it).
    private readonly transports = new Map<string, StreamableHTTPServerTransport>()

    // timeoutMs guards refresh_project against a dead/absent renderer so the tool
    // never hangs. ask_user_question has no timeout — the user may take their time.
    constructor(private readonly timeoutMs = 30000) {}

    // The MCP endpoint URL to hand the CLI via --mcp-config (empty until listen()).
    public get Url(): string { return this.url }

    // Wire the event push so tool calls can surface UI. Set by the agent IPC layer
    // to the same sink that feeds AgentChannel.Event.
    public setSink(sink: (event: AgentEvent) => void): void { this.sink = sink }

    // Deliver the user's answer to a blocked ask_user_question call; no-op if stale.
    public resolveAnswer(answer: QuestionAnswer): void
    {
        const done = this.pendingAnswers.get(answer.id)
        if (done === undefined) return
        this.pendingAnswers.delete(answer.id)
        done(answer.answers)
    }

    // Deliver the renderer's summary to a blocked refresh_project call; no-op if stale.
    public resolveRefresh(result: RefreshProjectResult): void
    {
        const done = this.pendingRefresh.get(result.id)
        if (done === undefined) return
        this.pendingRefresh.delete(result.id)
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
                if (this.pendingRefresh.delete(id))
                {
                    resolve({ id, projects: [], error: 'Timed out waiting for the Plexus UI to refresh.' })
                }
            }, this.timeoutMs)
            // Register BEFORE emitting so a fast reply can't race pending.set.
            this.pendingRefresh.set(id, (result) => { clearTimeout(timer); resolve(result) })
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
        // Unblock any in-flight tool call so the CLI doesn't hang on a dead session.
        for (const [id, done] of [...this.pendingAnswers]) { this.pendingAnswers.delete(id); done({}) }
        for (const [id, done] of [...this.pendingRefresh]) { this.pendingRefresh.delete(id); done({ id, projects: [], error: 'Server closed.' }) }
        for (const transport of this.transports.values()) await transport.close()
        this.transports.clear()
        await new Promise<void>((resolve) => { if (this.httpServer) this.httpServer.close(() => resolve()); else resolve() })
    }

    // A fresh McpServer per session, registering BOTH tools against this instance's
    // handlers (all sessions share the same pending maps + sink).
    private buildServer(): McpServer
    {
        const server = new McpServer({ name: MCP_SERVER_KEY, version: '0.1.0' })

        server.registerTool(
            ASK_TOOL_NAME,
            {
                title: 'Ask the user a question',
                description:
                    'Ask the user to choose from options when a decision is genuinely theirs. '
                    + 'Provide 1–4 questions, each with a short header, its options, and whether '
                    + 'multiple may be selected. Returns the chosen labels per question.',
                inputSchema: { questions: z.array(questionSchema).min(1).max(4) },
            },
            async ({ questions }) =>
            {
                const answers = await this.ask(questions as Question[])
                return { content: [{ type: 'text' as const, text: JSON.stringify(answers) }] }
            },
        )

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

    // Emit a Question and await the answer. With no sink wired (spike / probe /
    // headless test) there is no UI to answer, so resolve to an empty answer so the
    // tool round-trip still completes rather than hanging.
    private ask(questions: Question[]): Promise<QuestionAnswer['answers']>
    {
        const id = `q${(this.seq += 1)}`
        const sink = this.sink
        if (sink === undefined) return Promise.resolve({})
        // Register the resolver BEFORE emitting, so an answer that arrives
        // synchronously (or very fast) can't race ahead of pending.set.
        return new Promise((resolve) =>
        {
            this.pendingAnswers.set(id, resolve)
            sink({ Kind: AgentEventKind.Question, Request: { id, questions } })
        })
    }

    // Streamable-HTTP routing: initialise creates a session-bound transport; later
    // requests reuse it by the mcp-session-id header. Standard SDK boilerplate.
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

// Read and JSON-parse a request body; undefined for an empty/invalid body.
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

// An in-process HTTP MCP server hosting one tool — `ask_user_question` — that the
// `claude` CLI is pointed at via `--mcp-config`. When the agent calls the tool,
// the handler emits a Question event (so the renderer can render a choice card)
// and BLOCKS on a Promise until the user's answer arrives via `resolve(...)`; the
// resolved answer is returned as the tool result, so the model's turn continues.
//
// Living in Plexus main (same process as the event push) means no separate MCP
// subprocess or bridge: the tool call lands here directly, and the answer flows
// back over the already-open HTTP tool-call response.
//
// The model sees the tool as `mcp__plexus__ask_user_question` (server key from
// --mcp-config is "plexus"); allow-list that name via --allowedTools to skip the
// permission prompt in headless mode.
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
    type AgentEvent,
    type Question,
    type QuestionAnswer,
} from '../../shared/agent-api.js'

const optionSchema = z.object({ label: z.string(), description: z.string().optional() })
const questionSchema = z.object({
    question: z.string(),
    header: z.string(),
    multiSelect: z.boolean(),
    options: z.array(optionSchema),
})

export class AskUserQuestionServer
{
    private httpServer: http.Server | undefined
    private url = ''
    private sink: ((event: AgentEvent) => void) | undefined
    // Pending tool calls awaiting a UI answer, keyed by the question id we minted.
    private readonly pending = new Map<string, (answers: QuestionAnswer['answers']) => void>()
    // Monotonic id source — no Date.now/Math.random (keeps behaviour deterministic
    // and dependency-free).
    private seq = 0
    // One transport per MCP session (the CLI initialises once, then reuses it).
    private readonly transports = new Map<string, StreamableHTTPServerTransport>()

    // The MCP endpoint URL to hand the CLI via --mcp-config (empty until listen()).
    public get Url(): string { return this.url }

    // Wire the event push so tool calls can surface a Question card. Set by the
    // agent IPC layer to the same sink that feeds AgentChannel.Event.
    public setSink(sink: (event: AgentEvent) => void): void { this.sink = sink }

    // Deliver the user's answer to the blocked tool call; a no-op if unknown/stale.
    public resolve(answer: QuestionAnswer): void
    {
        const done = this.pending.get(answer.id)
        if (done === undefined) return
        this.pending.delete(answer.id)
        done(answer.answers)
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
        for (const [id, done] of [...this.pending]) { this.pending.delete(id); done({}) }
        for (const transport of this.transports.values()) await transport.close()
        this.transports.clear()
        await new Promise<void>((resolve) => { if (this.httpServer) this.httpServer.close(() => resolve()); else resolve() })
    }

    // A fresh McpServer per session, all sharing this instance's tool handler.
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
            this.pending.set(id, resolve)
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

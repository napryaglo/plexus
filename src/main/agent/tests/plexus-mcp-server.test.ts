import { describe, test, expect, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { PlexusMcpServer } from '../plexus-mcp-server.js'
import {
    AgentEventKind, ASK_TOOL_NAME, REFRESH_TOOL_NAME, CREATE_PROJECT_TOOL_NAME, GET_PROBLEMS_TOOL_NAME,
    ProblemSeverity,
    type AgentEvent, type QuestionRequest, type RefreshProjectResult, type CreateProjectResult,
    type GetProblemsResult,
} from '../../../shared/agent-api.js'

// Proves the merged server hosts BOTH tools under one listener at the MCP protocol
// level: a real MCP client can initialise over Streamable HTTP, list both tools,
// and call them — each surfacing its event and blocking until resolved. (The live
// `claude` CLI probe is manual; this locks server behaviour without spawning it.)

let server: PlexusMcpServer | undefined
let client: Client | undefined

afterEach(async () => {
    await client?.close()
    await server?.close()
    server = undefined
    client = undefined
})

async function connect(timeoutMs?: number): Promise<{ server: PlexusMcpServer; client: Client }>
{
    server = new PlexusMcpServer(timeoutMs)
    await server.listen()
    client = new Client({ name: 'test-client', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(server.Url)))
    return { server, client }
}

const QUESTIONS = [{
    question: 'Which approach?', header: 'Approach', multiSelect: false,
    options: [{ label: 'A', description: 'first' }, { label: 'B' }],
}]

describe('PlexusMcpServer — tool surface', () => {
    test('lists both tools under one server', async () => {
        const { client } = await connect()
        const { tools } = await client.listTools()
        const names = tools.map((t) => t.name)
        expect(names).toContain(ASK_TOOL_NAME)
        expect(names).toContain(REFRESH_TOOL_NAME)
        expect(names).toContain(CREATE_PROJECT_TOOL_NAME)
        expect(names).toContain(GET_PROBLEMS_TOOL_NAME)
        expect(tools.find((t) => t.name === ASK_TOOL_NAME)!.inputSchema.properties).toHaveProperty('questions')
        expect(tools.find((t) => t.name === REFRESH_TOOL_NAME)!.inputSchema.properties).toHaveProperty('path')
        const problems = tools.find((t) => t.name === GET_PROBLEMS_TOOL_NAME)!
        expect(problems.inputSchema.properties).toHaveProperty('path')
        expect(problems.inputSchema.properties).toHaveProperty('severity')
    })
})

describe('PlexusMcpServer — get_problems', () => {
    test('requestProblems emits a GetProblems event and resolves with the posted list', async () => {
        const server = new PlexusMcpServer()
        const events: AgentEvent[] = []
        server.setSink((e) => events.push(e))

        const pending = server.requestProblems('/proj/a/file.todl', ProblemSeverity.Error)
        expect(events.length).toBe(1)
        const evt = events[0]!
        expect(evt.Kind).toBe(AgentEventKind.GetProblems)
        const req = (evt as { Request: { id: string; path?: string; severity?: ProblemSeverity } }).Request
        expect(req.path).toBe('/proj/a/file.todl')
        expect(req.severity).toBe(ProblemSeverity.Error)

        const result: GetProblemsResult = {
            id: req.id, problems: [{ project: 'A', folder: '/proj/a', uri: 'file.todl', severity: ProblemSeverity.Error, message: 'boom', owner: 'todl', line: 1, column: 1 }],
            errorCount: 1, warningCount: 0, total: 1, truncated: false,
        }
        server.resolveProblems(result)
        expect(await pending).toEqual(result)
    })

    test('requestProblems with no sink resolves immediately with an error', async () => {
        const server = new PlexusMcpServer()
        const result = await server.requestProblems()
        expect(result.problems.length).toBe(0)
        expect((result.error ?? '').length).toBeGreaterThan(0)
    })

    test('requestProblems times out with an error when the renderer never replies', async () => {
        const server = new PlexusMcpServer(20)
        server.setSink(() => { /* never resolves */ })
        const result = await server.requestProblems()
        expect((result.error ?? '').toLowerCase()).toContain('timed out')
    })
})

describe('PlexusMcpServer — create_project', () => {
    test('requestCreateProject emits a CreateProject event and resolves with the posted result', async () => {
        const server = new PlexusMcpServer()
        const events: AgentEvent[] = []
        server.setSink((e) => events.push(e))

        const pending = server.requestCreateProject({ name: 'Acme', type: 'diagram' })
        expect(events.length).toBe(1)
        const evt = events[0]!
        expect(evt.Kind).toBe(AgentEventKind.CreateProject)
        const req = (evt as { Request: { id: string; prefill?: { name?: string } } }).Request
        expect(req.prefill?.name).toBe('Acme')

        const result: CreateProjectResult = { id: req.id, created: true, folder: '/p/acme', name: 'Acme', type: 'diagram' }
        server.resolveCreate(result)
        expect(await pending).toEqual(result)
    })

    test('requestCreateProject with no sink resolves immediately with an error', async () => {
        const server = new PlexusMcpServer()
        const result = await server.requestCreateProject()
        expect(result.created).toBe(false)
        expect((result.error ?? '').length).toBeGreaterThan(0)
    })
})

describe('PlexusMcpServer — ask_user_question', () => {
    test('a tool call emits a Question event and blocks until resolveAnswer answers', async () => {
        const { server, client } = await connect()

        let captured: QuestionRequest | undefined
        server.setSink((event: AgentEvent) => {
            if (event.Kind !== AgentEventKind.Question) return
            captured = event.Request
            server.resolveAnswer({ id: event.Request.id, answers: { [event.Request.questions[0]!.question]: ['A'] } })
        })

        const result = await client.callTool({ name: ASK_TOOL_NAME, arguments: { questions: QUESTIONS } })
        expect(captured?.questions[0]!.header).toBe('Approach')
        const text = (result.content as Array<{ type: string; text: string }>)[0]!.text
        expect(JSON.parse(text)).toEqual({ 'Which approach?': ['A'] })
    })

    test('with no sink wired the call still completes (empty answer, no hang)', async () => {
        const { client } = await connect()
        const result = await client.callTool({ name: ASK_TOOL_NAME, arguments: { questions: QUESTIONS } })
        const text = (result.content as Array<{ type: string; text: string }>)[0]!.text
        expect(JSON.parse(text)).toEqual({})
    })
})

describe('PlexusMcpServer — refresh_project', () => {
    test('requestRefresh emits a RefreshProject event and resolves with the posted result', async () => {
        const server = new PlexusMcpServer()
        const events: AgentEvent[] = []
        server.setSink((e) => events.push(e))

        const pending = server.requestRefresh('/proj/a/file.todl')
        expect(events.length).toBe(1)
        const evt = events[0]!
        expect(evt.Kind).toBe(AgentEventKind.RefreshProject)
        const req = (evt as { Request: { id: string; path?: string } }).Request
        expect(req.path).toBe('/proj/a/file.todl')

        const result: RefreshProjectResult = {
            id: req.id,
            projects: [{ name: 'A', folder: '/proj/a', errorCount: 1, warningCount: 0, sampleMessages: ['boom'] }],
        }
        server.resolveRefresh(result)
        expect(await pending).toEqual(result)
    })

    test('requestRefresh with no sink resolves immediately with an error', async () => {
        const server = new PlexusMcpServer()
        const result = await server.requestRefresh()
        expect(result.projects.length).toBe(0)
        expect((result.error ?? '').length).toBeGreaterThan(0)
    })

    test('requestRefresh times out with an error when the renderer never replies', async () => {
        const server = new PlexusMcpServer(20) // 20ms timeout
        server.setSink(() => { /* never resolves */ })
        const result = await server.requestRefresh()
        expect((result.error ?? '').toLowerCase()).toContain('timed out')
    })

    // The refresh tool's HTTP round-trip is structurally identical to
    // ask_user_question's (same handle/transport/buildServer), which the
    // 'tool surface' + ask tests exercise over a real MCP client; here we cover
    // refresh's own logic (event emission, resolve, timeout) as unit tests.
})

import { test, expect, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { AskUserQuestionServer } from '../ask-user-question-server.js'
import { AgentEventKind, ASK_TOOL_NAME, type AgentEvent, type QuestionRequest } from '../../../shared/agent-api.js'

// Proves the Task-1 spike contract at the MCP protocol level: a real MCP client
// can initialise over Streamable HTTP, list the tool, and call it — and that a
// tool call surfaces a Question event and blocks until resolve() delivers the
// answer. (The live `claude` CLI probe is documented in the plan; this locks the
// server behaviour without spawning the CLI.)

let server: AskUserQuestionServer | undefined
let client: Client | undefined

afterEach(async () => {
    await client?.close()
    await server?.close()
    server = undefined
    client = undefined
})

async function connect(): Promise<{ server: AskUserQuestionServer; client: Client }>
{
    server = new AskUserQuestionServer()
    await server.listen()
    client = new Client({ name: 'test-client', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(server.Url)))
    return { server, client }
}

const QUESTIONS = [{
    question: 'Which approach?', header: 'Approach', multiSelect: false,
    options: [{ label: 'A', description: 'first' }, { label: 'B' }],
}]

test('lists the ask_user_question tool with a questions input schema', async () => {
    const { client } = await connect()
    const { tools } = await client.listTools()
    const tool = tools.find((t) => t.name === ASK_TOOL_NAME)
    expect(tool).toBeDefined()
    expect(tool!.inputSchema.properties).toHaveProperty('questions')
})

test('a tool call emits a Question event and blocks until resolve() answers', async () => {
    const { server, client } = await connect()

    let captured: QuestionRequest | undefined
    server.setSink((event: AgentEvent) => {
        if (event.Kind !== AgentEventKind.Question) return
        captured = event.Request
        // Answer as soon as the card would appear.
        server.resolve({ id: event.Request.id, answers: { [event.Request.questions[0]!.question]: ['A'] } })
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

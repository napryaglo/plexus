// Wraps the console `claude` CLI as an IAiProvider. Spawns ONE long-lived
// `claude -p` in stream-json in/out mode (multi-turn over stdin) at the project
// cwd. NON-bare so it rides the user's logged-in subscription (Global
// Constraints). stdout is line-buffered through StreamJsonParser; each user turn
// is written to stdin as a stream-json user message.
import { spawn as nodeSpawn } from 'node:child_process'
import { StreamJsonParser } from './stream-json-parser.js'
import { AgentEventKind, type AgentEvent } from '../../shared/agent-api.js'
import type { AiProviderSession, ChildLike, IAiProvider, SpawnFn } from './ai-provider.js'

const CLI_ARGS = [
    '-p',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',                       // required with --print + stream-json
    '--permission-mode', 'acceptEdits', // auto-approve edits; cwd bounds blast radius
]

const defaultSpawn: SpawnFn = (command, args, options) =>
    nodeSpawn(command, args, { cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'] }) as unknown as ChildLike

export class ClaudeCliProvider implements IAiProvider
{
    public readonly Id = 'claude-cli'

    constructor(
        private readonly binaryPath: string = 'claude',
        private readonly spawnFn: SpawnFn = defaultSpawn,
    ) {}

    public start(workingDirectory: string, onEvent: (event: AgentEvent) => void): AiProviderSession
    {
        const child = this.spawnFn(this.binaryPath, CLI_ARGS, { cwd: workingDirectory })
        const parser = new StreamJsonParser()
        let buffer = ''

        child.stdout.on('data', (chunk) => {
            buffer += chunk.toString()
            let newline = buffer.indexOf('\n')
            while (newline !== -1)
            {
                const line = buffer.slice(0, newline)
                buffer = buffer.slice(newline + 1)
                for (const event of parser.push(line)) onEvent(event)
                newline = buffer.indexOf('\n')
            }
        })

        child.on('error', (err) => {
            onEvent({ Kind: AgentEventKind.Error, Message: err.message })
        })

        return {
            send: (text) => {
                const message = { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }
                child.stdin.write(JSON.stringify(message) + '\n')
            },
            abort:   () => child.kill(),
            dispose: () => child.kill(),
        }
    }
}

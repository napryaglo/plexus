// Wraps the console `claude` CLI as an IAiProvider. Spawns ONE long-lived
// `claude -p` in stream-json in/out mode (multi-turn over stdin) at the project
// cwd. NON-bare so it rides the user's logged-in subscription (Global
// Constraints). stdout is line-buffered through StreamJsonParser; each user turn
// is written to stdin as a stream-json user message.
import { spawn as nodeSpawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { StreamJsonParser } from './stream-json-parser.js'
import { AgentEventKind, type AgentEvent } from '../../shared/agent-api.js'
import type { AiProviderSession, ChildLike, IAiProvider, McpHttpServerConfig, McpOptions, SpawnFn } from './ai-provider.js'

const CLI_ARGS = [
    '-p',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',                       // required with --print + stream-json
    '--permission-mode', 'acceptEdits', // auto-approve edits; cwd bounds blast radius
]

// shell:true is required on Windows, where `claude` is a `.cmd` shim that Node
// (≥20) refuses to spawn directly. Args are a fixed flag list and the user's
// text goes over stdin (never interpolated into the command line), so there is
// no shell-injection surface.
const defaultSpawn: SpawnFn = (command, args, options) =>
    nodeSpawn(command, args, { cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: true }) as unknown as ChildLike

export class ClaudeCliProvider implements IAiProvider
{
    public readonly Id = 'claude-cli'
    // The claude CLI can restore an earlier conversation via --resume, so Plexus
    // may persist a conversation and reopen it later. Gates ChatStore persistence.
    public readonly Resumable = true

    constructor(
        private readonly binaryPath: string = 'claude',
        private readonly spawnFn: SpawnFn = defaultSpawn,
        // Optional extra MCP tools (the ask-user-question server). When present,
        // the CLI is pointed at them via --mcp-config and they're allow-listed.
        private readonly mcp: McpOptions | undefined = undefined,
    ) {}

    public start(
        sessionId: string,
        workingDirectory: string,
        addDirs: readonly string[],
        onEvent: (event: AgentEvent) => void,
        resumeToken?: string,
    ): AiProviderSession
    {
        const resume = resumeToken !== undefined ? ['--resume', resumeToken] : []
        const args = [...CLI_ARGS, ...resume, ...addDirs.flatMap((d) => ['--add-dir', d]), ...this.mcpArgs(sessionId)]
        const child = this.spawnFn(this.binaryPath, args, { cwd: workingDirectory })
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

    // Build the --mcp-config / --allowedTools args. The config is written to a temp
    // FILE (not passed inline): on Windows the provider spawns with shell:true (the
    // `claude.cmd` shim needs it), which mangles an inline-JSON arg. The file is
    // named by the server port so concurrent Plexus instances don't collide. Not
    // strict — the user's own MCP servers still load alongside ours.
    private mcpArgs(sessionId: string): string[]
    {
        if (this.mcp === undefined) return []
        const first = Object.values(this.mcp.servers)[0]
        const port = first !== undefined ? new URL(first.url).port : '0'
        // Tag each server URL with the session so the MCP server can attribute tool
        // calls (question/approval/create-project) back to this conversation.
        const servers: Record<string, McpHttpServerConfig> = {}
        for (const [key, cfg] of Object.entries(this.mcp.servers))
            servers[key] = { type: 'http', url: `${cfg.url}?session=${encodeURIComponent(sessionId)}` }
        // Named by port + session so concurrent sessions don't clobber the config file.
        const configPath = join(tmpdir(), `plexus-mcp-${port}-${sessionId}.json`)
        writeFileSync(configPath, JSON.stringify({ mcpServers: servers }))
        const allow = this.mcp.allowedTools.length > 0 ? ['--allowedTools', ...this.mcp.allowedTools] : []
        const disallow = this.mcp.disallowedTools !== undefined && this.mcp.disallowedTools.length > 0
            ? ['--disallowedTools', ...this.mcp.disallowedTools] : []
        const appendPrompt = this.mcp.appendSystemPrompt !== undefined && this.mcp.appendSystemPrompt.length > 0
            ? ['--append-system-prompt', this.mcp.appendSystemPrompt] : []
        const promptTool = this.mcp.permissionPromptTool !== undefined
            ? ['--permission-prompt-tool', this.mcp.permissionPromptTool] : []
        return ['--mcp-config', configPath, ...allow, ...disallow, ...appendPrompt, ...promptTool]
    }
}

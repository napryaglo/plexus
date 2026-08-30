import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ClaudeCliProvider } from '../claude-cli-provider.js'
import type { ChildLike, SpawnFn } from '../ai-provider.js'
import { AgentEventKind, AgentSkillKind, type AgentEvent } from '../../../shared/agent-api.js'
import type { CatalogIo } from '../claude-catalog.js'

// A fake child that lets the test drive stdout/error and observe stdin/kill.
function fakeChild() {
    const stdoutListeners: Array<(c: string) => void> = []
    const errorListeners: Array<(e: Error) => void> = []
    const writes: string[] = []
    let killed = false
    const child = {
        stdout: { on: (_e: 'data', l: (c: Buffer | string) => void) => stdoutListeners.push(l as (c: string) => void) },
        stderr: { on: () => {} },
        stdin:  { write: (d: string) => writes.push(d) },
        on: (e: 'error' | 'close', l: (arg: never) => void) => { if (e === 'error') errorListeners.push(l as (err: Error) => void) },
        kill: () => { killed = true },
    } satisfies ChildLike
    return {
        child,
        writes,
        get killed() { return killed },
        emitStdout: (s: string) => stdoutListeners.forEach((l) => l(s)),
        emitError:  (e: Error) => errorListeners.forEach((l) => l(e)),
    }
}

const helloFixture = readFileSync(join(__dirname, 'fixtures', 'hello.stream.jsonl'), 'utf8')
const initLine = helloFixture.split('\n').find((l) => l.includes('"subtype":"init"')) as string

// A spawn that records (command, args, cwd) and returns an inert child.
function captureSpawn() {
    const calls: Array<{ command: string; args: string[]; cwd: string }> = []
    const spawn: SpawnFn = (command, args, options) => {
        calls.push({ command, args: [...args], cwd: options.cwd })
        return {
            stdout: { on: () => {} }, stderr: { on: () => {} },
            stdin: { write: () => {} }, on: () => {}, kill: () => {},
        } as ChildLike
    }
    return { spawn, calls }
}

test('the provider declares itself resumable', () => {
    expect(new ClaudeCliProvider().Resumable).toBe(true)
})

test('listAgentsAndSkills scans the project .claude via the injected IO', async () => {
    const io: CatalogIo = {
        exists: (p) => Promise.resolve(p === '/p/.claude/agents' || p === '/p/.claude/agents/reviewer.md'),
        readDir: (p) => Promise.resolve(p === '/p/.claude/agents' ? ['reviewer.md'] : []),
        readFile: () => Promise.resolve('---\nname: reviewer\ndescription: d\n---\n'),
    }
    const provider = new ClaudeCliProvider('claude', undefined, undefined, io)
    const catalog = await provider.listAgentsAndSkills('/p')
    expect(catalog.agents).toEqual([{ kind: AgentSkillKind.Agent, name: 'reviewer', description: 'd' }])
    expect(catalog.skills).toEqual([])
})

test('start passes --resume <token> when a resume token is supplied', () => {
    const { spawn, calls } = captureSpawn()
    new ClaudeCliProvider('claude', spawn).start('s1', '/proj', [], () => {}, 'cli-abc')
    const args = calls[0].args
    const i = args.indexOf('--resume')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(args[i + 1]).toBe('cli-abc')
})

test('start omits --resume when no token is supplied', () => {
    const { spawn, calls } = captureSpawn()
    new ClaudeCliProvider('claude', spawn).start('s1', '/proj', [], () => {})
    expect(calls[0].args).not.toContain('--resume')
})

test('the MCP config URL carries the session id so tool calls are attributable', () => {
    const { spawn, calls } = captureSpawn()
    const mcp = { servers: { plexus: { type: 'http' as const, url: 'http://127.0.0.1:9/mcp' } }, allowedTools: [] }
    new ClaudeCliProvider('claude', spawn, mcp).start('sess-42', '/proj', [], () => {})
    const args = calls[0].args
    const cfgPath = args[args.indexOf('--mcp-config') + 1]
    const written = JSON.parse(readFileSync(cfgPath, 'utf8'))
    expect(written.mcpServers.plexus.url).toBe('http://127.0.0.1:9/mcp?session=sess-42')
})

test('spawns claude (non-bare) with the streaming flags at the given cwd', () => {
    let captured: { command: string; args: string[]; options: { cwd: string } } | undefined
    const spawn: SpawnFn = (command, args, options) => { captured = { command, args, options }; return fakeChild().child }
    new ClaudeCliProvider('claude', spawn).start('s1', '/proj', [], () => {})
    expect(captured?.command).toBe('claude')
    expect(captured?.args).toEqual([
        '-p', '--output-format', 'stream-json', '--input-format', 'stream-json',
        '--include-partial-messages', '--verbose', '--permission-mode', 'acceptEdits',
    ])
    expect(captured?.args).not.toContain('--bare')
    expect(captured?.options.cwd).toBe('/proj')
})

test('appends --add-dir for each extra directory, spawning at the cwd', () => {
    let captured: { args: string[]; options: { cwd: string } } | undefined
    const spawn: SpawnFn = (_command, args, options) => { captured = { args, options }; return fakeChild().child }
    new ClaudeCliProvider('claude', spawn).start('s1', '/proj', ['/lib-a', '/lib-b'], () => {})
    expect(captured?.options.cwd).toBe('/proj')
    expect(captured?.args).toEqual([
        '-p', '--output-format', 'stream-json', '--input-format', 'stream-json',
        '--include-partial-messages', '--verbose', '--permission-mode', 'acceptEdits',
        '--add-dir', '/lib-a', '--add-dir', '/lib-b',
    ])
})

test('adds --mcp-config (a temp file) + --allowedTools when MCP options are given', () => {
    let captured: { args: string[] } | undefined
    const spawn: SpawnFn = (_command, args) => { captured = { args }; return fakeChild().child }
    new ClaudeCliProvider('claude', spawn, {
        servers: { plexus: { type: 'http', url: 'http://127.0.0.1:12345/mcp' } },
        allowedTools: ['mcp__plexus__ask_user_question'],
        disallowedTools: ['AskUserQuestion'],
    }).start('s1', '/proj', [], () => {})

    const args = captured!.args
    const i = args.indexOf('--mcp-config')
    expect(i).toBeGreaterThan(-1)
    // Config is a FILE path (inline JSON is mangled by the Windows shell), named by
    // port + session (so concurrent sessions don't clobber each other's config).
    expect(args[i + 1]).toContain('plexus-mcp-12345-s1.json')
    expect(args).toContain('--allowedTools')
    expect(args).toContain('mcp__plexus__ask_user_question')
    // The built-in AskUserQuestion is disabled so the model uses our MCP tool.
    expect(args).toContain('--disallowedTools')
    expect(args).toContain('AskUserQuestion')
    // The file really holds our server config, its URL tagged with the session.
    const cfg = JSON.parse(readFileSync(args[i + 1]!, 'utf8'))
    expect(cfg.mcpServers.plexus.url).toBe('http://127.0.0.1:12345/mcp?session=s1')
})

test('writes the server config, allow-lists every tool, and appends the system prompt when given', () => {
    let captured: { args: string[] } | undefined
    const spawn: SpawnFn = (_command, args) => { captured = { args }; return fakeChild().child }
    new ClaudeCliProvider('claude', spawn, {
        servers: {
            plexus: { type: 'http', url: 'http://127.0.0.1:11111/mcp' },
        },
        allowedTools: ['mcp__plexus__ask_user_question', 'mcp__plexus__refresh_project', 'mcp__plexus__create_project'],
        appendSystemPrompt: 'CALL REFRESH ONLY AFTER FILE CHANGES',
    }).start('s1', '/proj', [], () => {})

    const args = captured!.args
    const i = args.indexOf('--mcp-config')
    const cfg = JSON.parse(readFileSync(args[i + 1]!, 'utf8'))
    // One server hosting both tools.
    expect(Object.keys(cfg.mcpServers)).toEqual(['plexus'])
    // Both tools are allow-listed so they run without a permission prompt.
    expect(args).toContain('mcp__plexus__ask_user_question')
    expect(args).toContain('mcp__plexus__refresh_project')
    expect(args).toContain('mcp__plexus__create_project')
    // The instruction rides --append-system-prompt.
    const p = args.indexOf('--append-system-prompt')
    expect(p).toBeGreaterThan(-1)
    expect(args[p + 1]).toBe('CALL REFRESH ONLY AFTER FILE CHANGES')
})

test('forwards parsed events from a real stdout line', () => {
    const f = fakeChild()
    const events: AgentEvent[] = []
    new ClaudeCliProvider('claude', () => f.child).start('s1', '/proj', [], (e) => events.push(e))
    // The init line carries session_id → SessionStarted.
    f.emitStdout(initLine + '\n')
    expect(events[0].Kind).toBe(AgentEventKind.SessionStarted)
})

test('buffers a stdout chunk split mid-line until the newline arrives', () => {
    const f = fakeChild()
    const events: AgentEvent[] = []
    new ClaudeCliProvider('claude', () => f.child).start('s1', '/proj', [], (e) => events.push(e))
    // Split the init line (carries session_id → SessionStarted) mid-way.
    const cut = Math.floor(initLine.length / 2)
    f.emitStdout(initLine.slice(0, cut))
    expect(events).toEqual([])
    f.emitStdout(initLine.slice(cut) + '\n')
    expect(events[0].Kind).toBe(AgentEventKind.SessionStarted)
})

test('send writes a stream-json user message to stdin', () => {
    const f = fakeChild()
    const session = new ClaudeCliProvider('claude', () => f.child).start('s1', '/proj', [], () => {})
    session.send('hi there')
    expect(f.writes).toEqual([
        JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi there' }] } }) + '\n',
    ])
})

test('abort kills the child', () => {
    const f = fakeChild()
    const session = new ClaudeCliProvider('claude', () => f.child).start('s1', '/proj', [], () => {})
    session.abort()
    expect(f.killed).toBe(true)
})

test('emits an Error event when the child errors (e.g. claude not found)', () => {
    const f = fakeChild()
    const events: AgentEvent[] = []
    new ClaudeCliProvider('claude', () => f.child).start('s1', '/proj', [], (e) => events.push(e))
    f.emitError(new Error('spawn claude ENOENT'))
    expect(events.some((e) => e.Kind === AgentEventKind.Error)).toBe(true)
})

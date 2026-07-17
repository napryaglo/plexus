import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ClaudeCliProvider } from '../claude-cli-provider.js'
import type { ChildLike, SpawnFn } from '../ai-provider.js'
import { AgentEventKind, type AgentEvent } from '../../../shared/agent-api.js'

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

test('spawns claude (non-bare) with the streaming flags at the given cwd', () => {
    let captured: { command: string; args: string[]; options: { cwd: string } } | undefined
    const spawn: SpawnFn = (command, args, options) => { captured = { command, args, options }; return fakeChild().child }
    new ClaudeCliProvider('claude', spawn).start('/proj', () => {})
    expect(captured?.command).toBe('claude')
    expect(captured?.args).toEqual([
        '-p', '--output-format', 'stream-json', '--input-format', 'stream-json',
        '--include-partial-messages', '--verbose', '--permission-mode', 'acceptEdits',
    ])
    expect(captured?.args).not.toContain('--bare')
    expect(captured?.options.cwd).toBe('/proj')
})

test('forwards parsed events from a real stdout line', () => {
    const f = fakeChild()
    const events: AgentEvent[] = []
    new ClaudeCliProvider('claude', () => f.child).start('/proj', (e) => events.push(e))
    // The init line carries session_id → SessionStarted.
    f.emitStdout(initLine + '\n')
    expect(events[0].Kind).toBe(AgentEventKind.SessionStarted)
})

test('buffers a stdout chunk split mid-line until the newline arrives', () => {
    const f = fakeChild()
    const events: AgentEvent[] = []
    new ClaudeCliProvider('claude', () => f.child).start('/proj', (e) => events.push(e))
    // Split the init line (carries session_id → SessionStarted) mid-way.
    const cut = Math.floor(initLine.length / 2)
    f.emitStdout(initLine.slice(0, cut))
    expect(events).toEqual([])
    f.emitStdout(initLine.slice(cut) + '\n')
    expect(events[0].Kind).toBe(AgentEventKind.SessionStarted)
})

test('send writes a stream-json user message to stdin', () => {
    const f = fakeChild()
    const session = new ClaudeCliProvider('claude', () => f.child).start('/proj', () => {})
    session.send('hi there')
    expect(f.writes).toEqual([
        JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi there' }] } }) + '\n',
    ])
})

test('abort kills the child', () => {
    const f = fakeChild()
    const session = new ClaudeCliProvider('claude', () => f.child).start('/proj', () => {})
    session.abort()
    expect(f.killed).toBe(true)
})

test('emits an Error event when the child errors (e.g. claude not found)', () => {
    const f = fakeChild()
    const events: AgentEvent[] = []
    new ClaudeCliProvider('claude', () => f.child).start('/proj', (e) => events.push(e))
    f.emitError(new Error('spawn claude ENOENT'))
    expect(events.some((e) => e.Kind === AgentEventKind.Error)).toBe(true)
})

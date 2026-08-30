import { test, expect } from 'vitest'
import { AgentSession } from '../agent-session.js'
import { AiProviderService } from '../ai-provider-service.js'
import type { AiProviderSession, IAiProvider } from '../ai-provider.js'
import { AgentEventKind, type AgentEvent } from '../../../shared/agent-api.js'

// A provider that records each started session so the test can drive events and
// observe routing.
function recordingProvider() {
    const started: Array<{
        sessionId: string; cwd: string; addDirs: string[]; resumeToken: string | undefined
        onEvent: (e: AgentEvent) => void; sent: string[]; disposed: boolean; aborted: boolean
    }> = []
    const provider: IAiProvider = {
        Id: 'rec',
        Resumable: true,
        start: (sessionId, cwd, addDirs, onEvent, resumeToken): AiProviderSession => {
            const rec = { sessionId, cwd, addDirs: [...addDirs], resumeToken, onEvent,
                          sent: [] as string[], disposed: false, aborted: false }
            started.push(rec)
            return {
                send: (t) => rec.sent.push(t),
                abort: () => { rec.aborted = true },
                dispose: () => { rec.disposed = true },
            }
        },
    }
    return { provider, started }
}

function serviceWith(provider: IAiProvider): AiProviderService {
    const svc = new AiProviderService(); svc.register(provider); return svc
}

test('send lazily starts a session at the cwd and forwards the turn', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), 'sess-1', () => {})
    session.send('/proj', [], 'hello')
    expect(started).toHaveLength(1)
    expect(started[0].cwd).toBe('/proj')
    expect(started[0].sent).toEqual(['hello'])
})

test('provider events are relayed to the emit sink', () => {
    const { provider, started } = recordingProvider()
    const emitted: AgentEvent[] = []
    const session = new AgentSession(serviceWith(provider), 'sess-1', (e) => emitted.push(e))
    session.send('/proj', [], 'hi')
    started[0].onEvent({ Kind: AgentEventKind.TurnComplete })
    expect(emitted).toEqual([{ Kind: AgentEventKind.TurnComplete }])
})

test('an explicit start disposes the previous session', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), 'sess-1', () => {})
    session.start('/a', [])
    session.start('/b', [])
    expect(started[0].disposed).toBe(true)
    expect(started[1].cwd).toBe('/b')
})

test('abort forwards to the current session', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), 'sess-1', () => {})
    session.start('/a', [])
    session.abort()
    expect(started[0].aborted).toBe(true)
})

test('send reuses the session when the (cwd, addDirs) target is unchanged', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), 'sess-1', () => {})
    session.send('/proj', ['/lib'], 'one')
    session.send('/proj', ['/lib'], 'two')
    expect(started).toHaveLength(1)
    expect(started[0].sent).toEqual(['one', 'two'])
})

test('send restarts the session when the cwd changes', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), 'sess-1', () => {})
    session.send('/a', [], 'one')
    session.send('/b', [], 'two')
    expect(started).toHaveLength(2)
    expect(started[0].disposed).toBe(true)
    expect(started[1].cwd).toBe('/b')
})

test('send restarts the session when the addDirs set changes', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), 'sess-1', () => {})
    session.send('/proj', ['/lib-a'], 'one')
    session.send('/proj', ['/lib-a', '/lib-b'], 'two')
    expect(started).toHaveLength(2)
    expect(started[1].addDirs).toEqual(['/lib-a', '/lib-b'])
})

test('the session id is forwarded to the provider', () => {
    const { provider, started } = recordingProvider()
    new AgentSession(serviceWith(provider), 'sess-9', () => {}).start('/proj', [])
    expect(started[0].sessionId).toBe('sess-9')
})

test('ResumeToken captures the CLI session id from SessionStarted', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), 'sess-9', () => {})
    session.start('/proj', [])
    expect(session.ResumeToken).toBeUndefined()
    started[0].onEvent({ Kind: AgentEventKind.SessionStarted, SessionId: 'cli-777' })
    expect(session.ResumeToken).toBe('cli-777')
})

test('an explicit resume token is forwarded to the provider on start', () => {
    const { provider, started } = recordingProvider()
    new AgentSession(serviceWith(provider), 'sess-9', () => {}).start('/proj', [], 'cli-abc')
    expect(started[0].resumeToken).toBe('cli-abc')
})

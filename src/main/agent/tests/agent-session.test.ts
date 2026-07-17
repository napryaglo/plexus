import { test, expect } from 'vitest'
import { AgentSession } from '../agent-session.js'
import { AiProviderService } from '../ai-provider-service.js'
import type { AiProviderSession, IAiProvider } from '../ai-provider.js'
import { AgentEventKind, type AgentEvent } from '../../../shared/agent-api.js'

// A provider that records each started session so the test can drive events and
// observe routing.
function recordingProvider() {
    const started: Array<{ cwd: string; onEvent: (e: AgentEvent) => void; sent: string[]; disposed: boolean; aborted: boolean }> = []
    const provider: IAiProvider = {
        Id: 'rec',
        start: (cwd, onEvent): AiProviderSession => {
            const rec = { cwd, onEvent, sent: [] as string[], disposed: false, aborted: false }
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
    const session = new AgentSession(serviceWith(provider), () => {})
    session.send('/proj', 'hello')
    expect(started).toHaveLength(1)
    expect(started[0].cwd).toBe('/proj')
    expect(started[0].sent).toEqual(['hello'])
})

test('provider events are relayed to the emit sink', () => {
    const { provider, started } = recordingProvider()
    const emitted: AgentEvent[] = []
    const session = new AgentSession(serviceWith(provider), (e) => emitted.push(e))
    session.send('/proj', 'hi')
    started[0].onEvent({ Kind: AgentEventKind.TurnComplete })
    expect(emitted).toEqual([{ Kind: AgentEventKind.TurnComplete }])
})

test('an explicit start disposes the previous session', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), () => {})
    session.start('/a')
    session.start('/b')
    expect(started[0].disposed).toBe(true)
    expect(started[1].cwd).toBe('/b')
})

test('abort forwards to the current session', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), () => {})
    session.start('/a')
    session.abort()
    expect(started[0].aborted).toBe(true)
})

// Registry of live AgentSessions keyed by Plexus's sessionId. Each session is one
// provider subprocess; N entries = N conversations running in parallel. Every
// session's events are wrapped as TaggedAgentEvent so the renderer can route them
// back to the right ChatSession.
import { AgentSession } from './agent-session.js'
import type { AiProviderService } from './ai-provider-service.js'
import type { TaggedAgentEvent } from '../../shared/agent-api.js'

export class AgentSessionManager
{
    private readonly sessions = new Map<string, AgentSession>()

    constructor(
        private readonly providers: AiProviderService,
        private readonly emit: (tagged: TaggedAgentEvent) => void,
    ) {}

    // Return the session for this id, creating it (idempotently) on first use.
    public create(sessionId: string): AgentSession
    {
        let session = this.sessions.get(sessionId)
        if (session === undefined)
        {
            session = new AgentSession(this.providers, sessionId, (event) => this.emit({ SessionId: sessionId, Event: event }))
            this.sessions.set(sessionId, session)
        }
        return session
    }

    public get(sessionId: string): AgentSession | undefined { return this.sessions.get(sessionId) }

    public close(sessionId: string): void
    {
        const session = this.sessions.get(sessionId)
        if (session === undefined) return
        session.dispose()
        this.sessions.delete(sessionId)
    }
}

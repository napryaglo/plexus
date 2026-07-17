// One live conversation, bound to the active provider. Holds the current
// provider session; starting a new one disposes the old (v1 = a single session).
// Emits every provider event to the sink the IPC layer supplies.
import type { AiProviderSession } from './ai-provider.js'
import type { AiProviderService } from './ai-provider-service.js'
import type { AgentEvent } from '../../shared/agent-api.js'

export class AgentSession
{
    private current: AiProviderSession | null = null

    constructor(
        private readonly providers: AiProviderService,
        private readonly emit: (event: AgentEvent) => void,
    ) {}

    public start(workingDirectory: string): void
    {
        this.current?.dispose()
        this.current = this.providers.active().start(workingDirectory, this.emit)
    }

    public send(workingDirectory: string, text: string): void
    {
        if (this.current === null) this.start(workingDirectory)
        this.current!.send(text)
    }

    public abort(): void
    {
        this.current?.abort()
    }

    public dispose(): void
    {
        this.current?.dispose()
        this.current = null
    }
}

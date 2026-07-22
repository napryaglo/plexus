// One live conversation, bound to the active provider. Holds the current
// provider session + its target directories; starting a new one disposes the
// old (v1 = a single session). The target is (cwd, addDirs); a send whose target
// differs re-spawns the provider so the agent tracks the open projects. Emits
// every provider event to the sink the IPC layer supplies.
import type { AiProviderSession } from './ai-provider.js'
import type { AiProviderService } from './ai-provider-service.js'
import type { AgentEvent } from '../../shared/agent-api.js'

export class AgentSession
{
    private current: AiProviderSession | null = null
    private target: { cwd: string; addDirs: readonly string[] } | null = null

    constructor(
        private readonly providers: AiProviderService,
        private readonly emit: (event: AgentEvent) => void,
    ) {}

    public start(workingDirectory: string, addDirs: readonly string[]): void
    {
        this.current?.dispose()
        this.current = this.providers.active().start(workingDirectory, addDirs, this.emit)
        this.target = { cwd: workingDirectory, addDirs: [...addDirs] }
    }

    public send(workingDirectory: string, addDirs: readonly string[], text: string): void
    {
        if (this.current === null || !this.sameTarget(workingDirectory, addDirs)) this.start(workingDirectory, addDirs)
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
        this.target = null
    }

    // True when the running session already targets exactly (cwd, addDirs) — same
    // cwd and the same extra directories in the same order.
    private sameTarget(cwd: string, addDirs: readonly string[]): boolean
    {
        const t = this.target
        return t !== null && t.cwd === cwd
            && t.addDirs.length === addDirs.length
            && t.addDirs.every((d, i) => d === addDirs[i])
    }
}

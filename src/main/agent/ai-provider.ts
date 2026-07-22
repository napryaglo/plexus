// The provider abstraction — the seam that keeps the auth/billing choice out of
// every consumer. v1 has one implementation (ClaudeCliProvider); an API-key/SDK
// provider slots in later without touching the session, IPC, or renderer.
import type { AgentEvent } from '../../shared/agent-api.js'

// A single live conversation with a backend. Multi-turn: send() writes another
// user turn to the SAME process.
export interface AiProviderSession
{
    send(text: string): void;
    abort(): void;
    dispose(): void;
}

export interface IAiProvider
{
    readonly Id: string;
    start(workingDirectory: string, addDirs: readonly string[], onEvent: (event: AgentEvent) => void): AiProviderSession;
}

// The subset of a spawned child this provider uses. Kept minimal + injectable so
// ClaudeCliProvider is unit-testable without a real process.
export interface ChildLike
{
    stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): void };
    stderr: { on(event: 'data', listener: (chunk: Buffer | string) => void): void };
    stdin:  { write(data: string): void };
    on(event: 'error', listener: (err: Error) => void): void;
    on(event: 'close', listener: (code: number | null) => void): void;
    kill(): void;
}

export type SpawnFn = (command: string, args: string[], options: { cwd: string }) => ChildLike

import type { DiagramStorage } from '@pragmatic-lab/mural/framework'
import type { FileSystemService } from '../../../services/file-system/file-system-service.js'

// Backs a single `.diagram` file through mural's DiagramStorage seam, so a
// DiagramDocument's native Save() / Load() persist the full scene (nodes,
// connectors, shape text) as JSON to disk — no bespoke serializer needed.
//
// DiagramStorage is a synchronous key/value contract, but file I/O is async,
// so this mirrors the settings-store pattern: reads are served from an
// in-memory snapshot (seeded from the file when the document is opened), and
// SetItem caches synchronously while firing the disk write in the background.
// Await WhenWritten() after Save() to be sure the bytes hit disk.
//
// A file holds exactly one diagram, so the storage KEY is ignored — there is a
// single slot. (mural writes/reads under one fixed internal key.)
export class FileDiagramStorage implements DiagramStorage
{
    private snapshot: string | null
    private pending: Promise<void> = Promise.resolve()

    constructor(
        public readonly Path: string,
        private readonly fs: FileSystemService,
        seed: string | null,
    )
    {
        this.snapshot = seed
    }

    public GetItem(_key: string): string | null
    {
        return this.snapshot
    }

    public SetItem(_key: string, value: string): void
    {
        this.snapshot = value
        this.pending = this.fs.WriteText(this.Path, value)
    }

    // Resolves when the most recent SetItem's disk write has completed.
    public WhenWritten(): Promise<void>
    {
        return this.pending
    }
}

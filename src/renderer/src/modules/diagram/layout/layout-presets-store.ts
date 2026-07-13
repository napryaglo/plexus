import { ElectronSettingsStore } from '../../../services/settings/settings-store.js'
import type { PipelineConfiguration } from '@pragmatic-lab/fresco'

// Named layout-pipeline presets, persisted globally (across diagrams)
// through the host settings store under a single key. Each preset is a
// Fresco PipelineConfiguration, so saving/loading is plain JSON with no
// bespoke serializer. The settings snapshot is frozen, so every write
// builds a fresh object rather than mutating it.
const KEY = 'layout.presets'

export class LayoutPresetsStore
{
    private readonly store = new ElectronSettingsStore()

    public list(): Record<string, PipelineConfiguration>
    {
        return (this.store.Load()[KEY] as Record<string, PipelineConfiguration> | undefined) ?? {}
    }

    public names(): string[]
    {
        return Object.keys(this.list())
    }

    public get(name: string): PipelineConfiguration | undefined
    {
        return this.list()[name]
    }

    public save(name: string, cfg: PipelineConfiguration): void
    {
        const all = this.store.Load()
        this.store.Save({ ...all, [KEY]: { ...this.list(), [name]: cfg } })
    }

    public delete(name: string): void
    {
        const presets = { ...this.list() }
        delete presets[name]
        const all = this.store.Load()
        this.store.Save({ ...all, [KEY]: presets })
    }
}

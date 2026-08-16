import { test, expect } from 'vitest'
import { ServiceProvider, ObservableCollection } from '@pragmatic-lab/mural/runtime'
import {
    ConnectorEndpoint,
    ContentHostService,
    DiagramDocument,
    type DocumentsContentHostService,
    type IDocument,
} from '@pragmatic-lab/mural/framework'
import { Point } from '@pragmatic-lab/mural/runtime'
import { ArchNodeVM } from '../../../architecture-projects/services/arch-node-vm.js'
import { LayoutPipelineService } from '../layout-pipeline-service.js'
import { GetPipelineCatalog, type PipelineConfiguration } from '@pragmatic-lab/fresco'
import { EnvironmentService } from '../../../../services/environment/environment-service.js'
import { FileSystemService } from '../../../../services/file-system/file-system-service.js'

// A provider whose content host reports `doc` as the active document — the
// same ActiveDocument source the arch binding / viewpoint-scope services read.
function providerWithActive(doc: IDocument | undefined): ServiceProvider {
    const host = {
        ActiveDocument: doc,
        OpenDocuments: new ObservableCollection<IDocument>(doc ? [doc] : []),
    } as unknown as DocumentsContentHostService
    const provider = new ServiceProvider()
    provider.registerInstance(ContentHostService.Key, host as unknown as ContentHostService)
    return provider
}

// A provider with an in-memory filesystem host seeded with `presets`
// (name -> config), plus the active-document host, so LoadPreset / SelectedPreset
// can read real preset files.
function providerWithPresets(doc: IDocument | undefined, presets: Record<string, PipelineConfiguration>): ServiceProvider {
    const provider = providerWithActive(doc)
    const files = new Map<string, string>()
    for (const [name, cfg] of Object.entries(presets)) files.set(`/data/layout-presets/${name}.json`, JSON.stringify(cfg))
    const fs = {
        CreateDirectory: () => Promise.resolve(),
        WriteText: (p: string, c: string) => { files.set(p, c); return Promise.resolve() },
        ReadText: (p: string) => files.has(p) ? Promise.resolve(files.get(p)!) : Promise.reject(new Error('ENOENT')),
        Delete: (p: string) => { files.delete(p); return Promise.resolve() },
        ListDirectory: (dir: string) => {
            const prefix = dir.endsWith('/') ? dir : dir + '/'
            return Promise.resolve([...files.keys()]
                .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
                .map((k) => ({ Name: k.slice(prefix.length), IsDirectory: false })))
        },
    } as unknown as FileSystemService
    provider.registerInstance(FileSystemService.Key, fs)
    provider.registerInstance(EnvironmentService.Key, { UserDataDirectory: '/data' } as unknown as EnvironmentService)
    return provider
}

// The catalog's first real strategy for a given slot — used to build a preset
// whose className the stage VM can resolve.
function firstStrategy(slotId: string): { name: string; className: string } {
    const slot = GetPipelineCatalog().find((s) => s.slotId === slotId && s.kind === 'strategy-slot')!
    const strat = (slot as unknown as { strategies: { name: string; className: string }[] }).strategies[0]
    return { name: strat.name, className: strat.className }
}

test('Run lays out the ACTIVE diagram document, not a workspace singleton', () => {
    const doc = new DiagramDocument()
    const a = new ArchNodeVM(); a.Id = 'a'; a.Left = 0;   a.Top = 0
    const b = new ArchNodeVM(); b.Id = 'b'; b.Left = 300; b.Top = 0
    doc.AddNode(a); doc.AddNode(b)

    const svc = new LayoutPipelineService(providerWithActive(doc))
    svc.Run()

    // Reached the active doc and found its two nodes (the old wiring read an
    // empty workspace singleton → 'no nodes').
    expect(svc.Status).toContain('Laid out')
    expect(svc.Status).not.toContain('no nodes')
})

test('running the layout clears connector waypoints (reset to auto)', () => {
    const doc = new DiagramDocument()
    const a = new ArchNodeVM(); a.Id = 'a'; a.Left = 0;   a.Top = 0
    const b = new ArchNodeVM(); b.Id = 'b'; b.Left = 300; b.Top = 0
    doc.AddNode(a); doc.AddNode(b)
    const c = doc.CreateConnector(new ConnectorEndpoint({ Node: a }), new ConnectorEndpoint({ Node: b }))!
    c.Waypoints = [{ point: new Point(150, 60), userAltered: true }]   // a user pin
    expect(c.Waypoints!.length).toBe(1)

    new LayoutPipelineService(providerWithActive(doc)).Run()

    // Layout is the reset — the pin is gone and the route rebuilds automatically.
    expect(c.Waypoints).toBeUndefined()
})

test('Run lays out a CYCLIC diagram without a DAG pipeline error', () => {
    // Reproduces the reported failure: an architecture diagram with a cycle
    // (a → b → a) drove the longest-path layer assigner to throw
    // 'longest-path depths require a DAG'. The default config now runs
    // MakeAcyclicTransform first, so the cycle is broken and layout succeeds.
    const doc = new DiagramDocument()
    const a = new ArchNodeVM(); a.Id = 'a'; a.Left = 0;   a.Top = 0
    const b = new ArchNodeVM(); b.Id = 'b'; b.Left = 300; b.Top = 0
    doc.AddNode(a); doc.AddNode(b)
    doc.CreateConnector(new ConnectorEndpoint({ Node: a }), new ConnectorEndpoint({ Node: b }))
    doc.CreateConnector(new ConnectorEndpoint({ Node: b }), new ConnectorEndpoint({ Node: a }))   // closes the cycle

    const svc = new LayoutPipelineService(providerWithActive(doc))
    svc.Run()

    expect(svc.Status).toContain('Laid out')
    expect(svc.Status).not.toContain('Pipeline error')
})

test('Run reports when the active document is not a diagram', () => {
    const svc = new LayoutPipelineService(providerWithActive(undefined))
    svc.Run()
    expect(svc.Status).toBe('Active document is not a diagram.')
})

test('LoadPreset clones the preset into Config and restores the matching stage', async () => {
    const strat = firstStrategy('layer-assigner')
    const preset: PipelineConfiguration = {
        name: 'p1', transforms: ['MakeAcyclicTransform'],
        layout: { layerAssigner: { className: strat.className, params: {} } },
    }
    const svc = new LayoutPipelineService(providerWithPresets(undefined, { p1: preset }))

    await svc.LoadPreset('p1')

    expect(svc.Config.name).toBe('p1')
    expect(svc.Config).not.toBe(preset)   // a clone, not the same reference
    const stage = svc.Stages.ToArray().find((s) => s.Label === 'Layer Assigner')!
    expect(stage.Selected).toBe(strat.name)
})

test('LoadPreset of an unknown name leaves Config unchanged', async () => {
    const svc = new LayoutPipelineService(providerWithPresets(undefined, {}))
    const before = svc.Config
    await svc.LoadPreset('missing')
    expect(svc.Config).toBe(before)
})

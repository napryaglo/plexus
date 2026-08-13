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

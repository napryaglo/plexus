import { test, expect } from 'vitest'
import { ServiceProvider, type ICommand } from '@pragmatic-lab/mural/runtime'
import { ContentHostService, DiagramDocument, type DocumentsContentHostService } from '@pragmatic-lab/mural/framework'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-lab/todl'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBindingService } from '../arch-diagram-binding-service.js'
import { DiagramViewpointScopeService, ViewpointToggleRow } from '../diagram-viewpoint-scope-service.js'

const MM = `namespace archmm {
  concept component {}
  viewpoint ComponentView : frames component
  viewpoint DeploymentView : frames component
}`
function buildModel() {
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))], [], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

function wire(doc: DiagramDocument, model: ArchModel, scope: Set<string>) {
    const calls: Array<[unknown, string[]]> = []
    const provider = new ServiceProvider()
    const host = { ActiveDocument: doc } as unknown as DocumentsContentHostService
    provider.registerInstance(ContentHostService.Key, host as unknown as ContentHostService)
    provider.registerInstance(ArchDiagramBindingService.Key, {
        modelForDocument: (d: unknown) => (d === doc ? model : undefined),
        scopeForDocument: (d: unknown) => (d === doc ? scope : undefined),
        setDocumentScope: async (d: unknown, vps: string[]) => { calls.push([d, vps]) },
    } as unknown as ArchDiagramBindingService)
    return { provider, calls }
}

test('refresh lists the project viewpoints with correct IsSelected', () => {
    const doc = new DiagramDocument()
    const model = buildModel()
    const { provider } = wire(doc, model, new Set(['ComponentView']))
    const svc = new DiagramViewpointScopeService(provider)
    svc.refresh()
    const rows = svc.Rows.ToArray()
    expect(rows.map((r: ViewpointToggleRow) => r.Label).sort()).toEqual(['ComponentView', 'DeploymentView'])
    expect(rows.find((r) => r.Label === 'ComponentView')!.IsSelected).toBe(true)
    expect(rows.find((r) => r.Label === 'DeploymentView')!.IsSelected).toBe(false)
})

test('toggling a row calls setDocumentScope with the new selected set', () => {
    const doc = new DiagramDocument()
    const model = buildModel()
    const { provider, calls } = wire(doc, model, new Set(['ComponentView']))
    const svc = new DiagramViewpointScopeService(provider)
    svc.refresh()
    const deployment = svc.Rows.ToArray().find((r) => r.Label === 'DeploymentView')!
    ;(deployment.ToggleCommand as ICommand).Execute(undefined)
    // Selecting DeploymentView (already-on ComponentView stays) → both selected.
    expect(calls).toHaveLength(1)
    expect([...calls[0][1]].sort()).toEqual(['ComponentView', 'DeploymentView'])
})

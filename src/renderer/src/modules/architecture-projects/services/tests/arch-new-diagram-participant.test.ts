import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-lab/todl'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { PROJECT_MANIFEST_FILENAME } from '../../../../services/projects/project-factory.js'
import { ArchitectureModelService } from '../architecture-model-service.js'
import { DiagramViewpointPickerService, ArchNewDiagramParticipant } from '../arch-new-diagram-participant.js'
import { Project, ProjectNode } from '../../../../services/projects/project.js'
import { ArchModel } from '../arch-model.js'
import type { OpenProject } from '../../../../services/projects/open-project.js'

const MM = `namespace archmm {
  concept component {}
  viewpoint ComponentView : frames component
  viewpoint DeploymentView : frames component
}`
function buildModel(storage: FakeStorage): ArchModel {
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))], [], { namespace: 'archmm' })
    return new ArchModel(draft, storage, 'archmm')
}
function op(storage: FakeStorage, type = 'architecture'): OpenProject {
    const project = new Project(type, 'Acme', storage.Root, new ProjectNode('Acme', '', 'folder'))
    return { Project: project, Storage: storage } as unknown as OpenProject
}

test('for an architecture .diagram, the picked viewpoints are written to the manifest', async () => {
    const storage = new FakeStorage('fake://Acme')
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'architecture', name: 'Acme', version: 1 }))
    const model = buildModel(storage)
    const provider = new ServiceProvider()
    provider.registerInstance(ArchitectureModelService.Key, { modelFor: async () => model } as unknown as ArchitectureModelService)
    provider.registerInstance(DiagramViewpointPickerService.Key, { pick: async () => ['DeploymentView'] } as unknown as DiagramViewpointPickerService)

    await new ArchNewDiagramParticipant(provider).OnCreated(op(storage), 'x.diagram')

    const m = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
    expect(m.diagrams['x.diagram'].viewpoints).toEqual(['DeploymentView'])
})

test('a non-architecture project is ignored', async () => {
    const storage = new FakeStorage('fake://Plain')
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'diagram', name: 'Plain', version: 1 }))
    const provider = new ServiceProvider()
    await new ArchNewDiagramParticipant(provider).OnCreated(op(storage, 'diagram'), 'x.diagram')
    const m = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
    expect('diagrams' in m).toBe(false)
})

test('a non-.diagram path is ignored', async () => {
    const storage = new FakeStorage('fake://Acme')
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'architecture', name: 'Acme', version: 1 }))
    const provider = new ServiceProvider()
    await new ArchNewDiagramParticipant(provider).OnCreated(op(storage), 'notes.todl')
    const m = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
    expect('diagrams' in m).toBe(false)
})

test('picker confirm resolves the selected labels', async () => {
    const picker = new DiagramViewpointPickerService(new ServiceProvider())
    const p = picker.pick(['ComponentView', 'DeploymentView'])
    picker.Rows.ToArray()[1].IsSelected = true      // select DeploymentView
    picker.ConfirmCommand!.Execute(undefined)
    expect(await p).toEqual(['DeploymentView'])
    expect(picker.IsOpen).toBe(false)
})

import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-lab/todl'
import { DiagramDocument, Figure } from '@pragmatic-lab/mural/framework'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBinding } from '../arch-diagram-binding.js'

const MM = `namespace archmm {
  concept component {}
  viewpoint ComponentView : frames component
}`
function buildModel(): ArchModel {
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))], [], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

test('a figure added after attach is bound + labelled on the next model change', () => {
    const model = buildModel()
    const doc = new DiagramDocument()
    const binding = new ArchDiagramBinding(doc, model)
    binding.attach()

    // Simulate a drop: create the entity, add a figure, set its Id, notify.
    const e = model.createInViewpoint('component', 'ComponentView')
    const fig = doc.CreateNode('rectangle', 0, 0)!
    fig.Id = e.id
    model.notifyChanged()

    expect(fig.LabelText).toBe(e.id)     // bound via rescan (no label field → id)

    // Deleting the entity removes the figure.
    model.remove(e.id)
    expect(doc.Nodes.ToArray().filter((n): n is Figure => n instanceof Figure).map((f) => f.Id)).not.toContain(e.id)
})

test('model is exposed for the binding service', () => {
    const model = buildModel()
    const binding = new ArchDiagramBinding(new DiagramDocument(), model)
    expect(binding.model).toBe(model)
})

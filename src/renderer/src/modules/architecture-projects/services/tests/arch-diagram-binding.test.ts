import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-lab/todl'
import { DiagramDocument, Figure } from '@pragmatic-lab/mural/framework'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBinding } from '../arch-diagram-binding.js'

const MM = `namespace archmm {
  concept Component {}
  concept Node {}
  viewpoint ComponentView : frames Component
  viewpoint DeploymentView : frames Node, Component
}`
const fileA = { uri: 'model-a.todl', text: `namespace archmm {
  model Arch : archmm conforms ComponentView { Component web {} }
}` }
const fileB = { uri: 'model-b.todl', text: `namespace archmm {
  model Arch : archmm conforms DeploymentView { Node host {} }
}` }

function buildModel(): ArchModel {
    const mmDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
    const baseRepo = new Repository(graphFromJSON(mmDoc))
    const draft = ModelDraft.fromSources([baseRepo], [fileA, fileB], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

// Add a Figure to a doc and give it a specific Id (CreateNode auto-assigns one).
function addFigure(doc: DiagramDocument, id: string): Figure {
    const f = doc.CreateNode('rectangle', 0, 0)
    if (f === null) throw new Error('CreateNode returned null')
    f.Id = id
    return f
}

test('attach binds figures whose Id is an entity and labels them; unknown figures untouched', () => {
    const model = buildModel()
    const doc = new DiagramDocument()
    const web = addFigure(doc, 'web')
    const ghost = addFigure(doc, 'ghost')
    ghost.LabelText = 'freeform'
    const host = addFigure(doc, 'host')

    new ArchDiagramBinding(doc, model).attach()

    expect(web.LabelText).toBe('web')     // id fallback (no label/name field)
    expect(host.LabelText).toBe('host')
    expect(ghost.LabelText).toBe('freeform')   // not an entity — left as-is
})

test('model label change re-syncs the bound figure; delete removes its figure', () => {
    const model = buildModel()
    const doc = new DiagramDocument()
    const web = addFigure(doc, 'web')
    const host = addFigure(doc, 'host')
    const binding = new ArchDiagramBinding(doc, model)
    binding.attach()
    void web
    void host

    model.setField('web', 'label', 'Web App')
    expect(web.LabelText).toBe('Web App')

    model.remove('host')
    const ids = doc.Nodes.ToArray().filter((n): n is Figure => n instanceof Figure).map((f) => f.Id)
    expect(ids).toContain('web')
    expect(ids).not.toContain('host')
})

test('dispose stops further syncing', () => {
    const model = buildModel()
    const doc = new DiagramDocument()
    const web = addFigure(doc, 'web')
    const binding = new ArchDiagramBinding(doc, model)
    binding.attach()
    model.setField('web', 'label', 'First')
    expect(web.LabelText).toBe('First')

    binding.dispose()
    model.setField('web', 'label', 'Second')
    expect(web.LabelText).toBe('First')   // no longer updating
})

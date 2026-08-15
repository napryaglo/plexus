import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-lab/todl'
import { ConnectorEndpoint, DiagramDocument } from '@pragmatic-lab/mural/framework'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBinding } from '../arch-diagram-binding.js'
import { ArchNodeVM } from '../arch-node-vm.js'

const MM = `namespace archmm {
  concept service {}
  concept component { relationship uses -> service; }
  viewpoint V : frames component, service
}`

function buildModel(): ArchModel {
    const draft = ModelDraft.fromSources(
        [new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))],
        [], { namespace: 'archmm' })
    return new ArchModel(draft, new FakeStorage('fake://Arch'), 'archmm')
}

// Place two related entities as nodes, attach, and expect one projected connector.
function setup(): { doc: DiagramDocument; model: ArchModel; a: ArchNodeVM; b: ArchNodeVM } {
    const model = buildModel()
    const comp = model.createInViewpoint('component', 'V')
    const svc = model.createInViewpoint('service', 'V')
    model.addRef(comp.id, 'uses', svc.id)

    const doc = new DiagramDocument()
    const a = new ArchNodeVM(); a.Id = comp.id
    const b = new ArchNodeVM(); b.Id = svc.id
    doc.Nodes.Add(a)
    doc.Nodes.Add(b)

    const binding = new ArchDiagramBinding(doc, model)
    binding.attach()
    return { doc, model, a, b }
}

test('a relationship between two placed nodes projects as one connector', () => {
    const { doc, a, b } = setup()
    const connectors = doc.Connectors.ToArray()
    expect(connectors.length).toBe(1)
    expect(connectors[0].Source?.Node).toBe(a)
    expect(connectors[0].Target?.Node).toBe(b)
})

test('a raw user-drawn connector between two bound nodes is reconciled away on rescan', () => {
    const { doc, model, a, b } = setup()
    // Simulate a user-drawn raw connector (not model-backed) between the two nodes.
    doc.CreateConnector(new ConnectorEndpoint({ Node: a }), new ConnectorEndpoint({ Node: b }))
    expect(doc.Connectors.ToArray().length).toBe(2)   // projected + raw

    model.notifyChanged()   // triggers rescan → connector-authoritative reconcile

    const connectors = doc.Connectors.ToArray()
    expect(connectors.length).toBe(1)                 // raw removed, projected kept
    expect(connectors[0].Source?.Node).toBe(a)
    expect(connectors[0].Target?.Node).toBe(b)
})

test('removing a node reconciles its projected connector away', () => {
    const { doc, model, a } = setup()
    expect(doc.Connectors.ToArray().length).toBe(1)

    model.remove(a.Id!)   // deletes the component entity → node removed → edge gone
    expect(doc.Connectors.ToArray().length).toBe(0)
})

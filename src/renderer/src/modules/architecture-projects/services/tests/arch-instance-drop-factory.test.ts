import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { DiagramDocument, ShapeNodeVM, type ToolboxDropContext } from '@pragmatic-lab/mural/framework'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-lab/todl'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBindingService } from '../arch-diagram-binding-service.js'
import { DropCandidateChooserService } from '../drop-candidate-chooser-service.js'
import { ArchInstanceDropFactory } from '../arch-instance-drop-factory.js'
import { ArchNodeVM } from '../arch-node-vm.js'

const MM = `namespace archmm {
  concept technology {}
  concept component { relationship realisedBy -> technology; }
  viewpoint ComponentView : frames component
  taxonomy Stack : represents technology { term azure {} }
}`
function buildModel(storage: FakeStorage): ArchModel {
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))], [], { namespace: 'archmm' })
    return new ArchModel(draft, storage, 'archmm')
}

// A provider whose ArchDiagramBindingService maps `doc` → `model`.
function wire(doc: DiagramDocument, model: ArchModel | undefined) {
    const provider = new ServiceProvider()
    provider.registerInstance(ArchDiagramBindingService.Key, {
        modelForDocument: (d: unknown) => (d === doc ? model : undefined),
        scopeForDocument: () => undefined,   // falls back to all viewpoints
    } as unknown as ArchDiagramBindingService)
    provider.registerInstance(DropCandidateChooserService.Key, new DropCandidateChooserService(provider))
    return provider
}

function ctx(doc: DiagramDocument, key: string): ToolboxDropContext {
    return { Descriptor: { Key: key }, Position: { X: 5, Y: 6 }, Diagram: {}, Mutator: doc } as unknown as ToolboxDropContext
}

test('a single-candidate drop creates the routed entity + an ArchNodeVM at the drop position', () => {
    const storage = new FakeStorage('fake://Acme')
    const model = buildModel(storage)
    const doc = new DiagramDocument()
    const factory = new ArchInstanceDropFactory(wire(doc, model))

    const result = factory.CreateDropped(ctx(doc, 'Stack.azure')) as ArchNodeVM
    expect(result).toBeInstanceOf(ArchNodeVM)
    // Entity created: a component that references azure via realisedBy.
    const comp = model.entities().find((e) => e.concept === 'component')!
    expect(comp).toBeDefined()
    expect(result.Id).toBe(comp.id)
    // Position must match the drop context (X=5, Y=6).
    expect(result.Left).toBe(5)
    expect(result.Top).toBe(6)
    // Label/Descriptor are NOT set by this task (T6 fills them via rescan).
    // The node must be present in the document's Nodes collection.
    expect([...doc.Nodes].includes(result)).toBe(true)
})

test('a no-candidate drop returns null and mutates nothing', () => {
    const storage = new FakeStorage('fake://Acme')
    const model = buildModel(storage)
    const doc = new DiagramDocument()
    const factory = new ArchInstanceDropFactory(wire(doc, model))
    const before = model.entities().length
    expect(factory.CreateDropped(ctx(doc, 'nonesuch'))).toBeNull()
    expect(model.entities().length).toBe(before)
})

test('a non-architecture document falls back to a plain CreateNode', () => {
    const doc = new DiagramDocument()
    const factory = new ArchInstanceDropFactory(wire(doc, undefined))   // no model
    const result = factory.CreateDropped(ctx(doc, 'rectangle')) as ShapeNodeVM
    expect(result).toBeInstanceOf(ShapeNodeVM)
    expect(result.Kind).toBe('rectangle')
})

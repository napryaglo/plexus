import { test, expect, beforeAll } from 'vitest'
import { Application } from '@pragmatic-lab/mural/runtime'
import { DiagramDocument, DiagramSettings } from '@pragmatic-lab/mural/framework'
import { serializerByType } from '@pragmatic-lab/mural/framework'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { FileDiagramStorage } from '../../../diagram/persistence/file-diagram-storage.js'
import { ArchNodeVM } from '../arch-node-vm.js'
import { registerArchNodeSerializer } from '../arch-node-serializer.js'

beforeAll(() => {
    Application.current = null
    new Application()
    // NOTE: intentionally NOT calling registerArchNodeSerializer() here — the
    // round-trip tests below rely purely on the module-import side-effect that
    // registers it. If someone removes that side-effect, those tests fail.
})

// Helper: build a FileDiagramStorage backed by an in-memory FakeStorage.
function makeStorage(): { diagStore: FileDiagramStorage; raw: FakeStorage } {
    const raw = new FakeStorage()
    const diagStore = new FileDiagramStorage('test.diagram', raw, null)
    return { diagStore, raw }
}

test('the arch serializer is registered at module-import time (no explicit call)', () => {
    // Guards the load-ordering fix: importing arch-node-serializer.js (done at
    // the top of this file, as the bootstrap does) is enough to register "arch"
    // — no ArchDiagramBindingService construction, no explicit call here. So a
    // diagram can Load() before the binding service exists and keep its arch
    // nodes (and their connectors) intact.
    expect(serializerByType('arch')).toBeDefined()
})

test('registerArchNodeSerializer registers type "arch" idempotently', () => {
    // Calling it explicitly (on top of the import-time registration) must not
    // throw or double-register.
    registerArchNodeSerializer()
    const s = serializerByType('arch')
    expect(s).toBeDefined()
    expect(s!.type).toBe('arch')
})

test('ArchNodeVM seeds IconSize from the shared shape-default-size setting', () => {
    // The arch icon renders at the same size as a geometric shape — both read
    // DiagramSettings.ShapeDefaultSize() at construction. With no settings host
    // the helper returns its compiled-in default (80).
    const vm = new ArchNodeVM()
    expect(vm.IconSize).toBe(DiagramSettings.ShapeDefaultSize())
})

test('ArchNodeVM serialized record carries type "arch" and empty data', () => {
    const { diagStore } = makeStorage()
    const doc = new DiagramDocument(diagStore)

    const vm = new ArchNodeVM()
    vm.Id = 'a1'
    doc.Nodes.Add(vm)

    doc.Save()

    const json = diagStore.GetItem('') as string
    const parsed = JSON.parse(json) as { nodes: Array<{ type: string; data: Record<string, unknown>; id: string }> }
    expect(parsed.nodes).toHaveLength(1)
    const record = parsed.nodes[0]
    expect(record.type).toBe('arch')
    expect(record.data).toEqual({})   // content-only; geometry rides the `visuals` section
    expect(record.id).toBe('a1')
})

test('ArchNodeVM round-trips id + content (geometry is the container/store concern)', () => {
    const { diagStore } = makeStorage()

    // Save a doc with one ArchNodeVM. Geometry is set on the container (or the
    // store) in production; here we assert the serializer round-trips id + the
    // geometry-free content — position round-trip is mural's store responsibility.
    const saveDoc = new DiagramDocument(diagStore)
    const vm = new ArchNodeVM()
    vm.Id = 'a1'
    saveDoc.Nodes.Add(vm)
    saveDoc.Save()

    // Load into a fresh doc backed by the same storage (snapshot is already set).
    const loadDoc = new DiagramDocument(diagStore)
    loadDoc.Load()

    expect(loadDoc.Nodes.Count).toBe(1)
    const reloaded = loadDoc.Nodes.Get(0)
    expect(reloaded).toBeInstanceOf(ArchNodeVM)
    const archVM = reloaded as ArchNodeVM
    expect(archVM.Id).toBe('a1')

    // Icon / label must NOT be persisted — binding re-derives them on open.
    expect(archVM.Label).toBe('')
    expect(archVM.Descriptor).toBeUndefined()
})

test('without serializer registration the node is dropped on reload', () => {
    // Simulate what would happen with no "arch" serializer:
    // we get the saved JSON and manipulate the type to something unregistered.
    const { diagStore } = makeStorage()
    const saveDoc = new DiagramDocument(diagStore)
    const vm = new ArchNodeVM()
    vm.Id = 'b1'
    saveDoc.Nodes.Add(vm)
    saveDoc.Save()

    // Corrupt the type in the stored JSON to simulate a missing serializer.
    const json = diagStore.GetItem('') as string
    const broken = json.replace('"type":"arch"', '"type":"unknown-x"')
    diagStore.SetItem('', broken)

    const loadDoc = new DiagramDocument(diagStore)
    loadDoc.Load()

    // The node should be dropped because "unknown-x" has no registered serializer.
    expect(loadDoc.Nodes.Count).toBe(0)
})

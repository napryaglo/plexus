import { test, expect, beforeAll } from 'vitest'
import { Application } from '@pragmatic-lab/mural/runtime'
import { DiagramDocument } from '@pragmatic-lab/mural/framework'
import { serializerByType } from '@pragmatic-lab/mural/framework'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { FileDiagramStorage } from '../../../diagram/persistence/file-diagram-storage.js'
import { ArchNodeVM } from '../arch-node-vm.js'
import { registerArchNodeSerializer } from '../arch-node-serializer.js'

beforeAll(() => {
    Application.current = null
    new Application()
    registerArchNodeSerializer()
})

// Helper: build a FileDiagramStorage backed by an in-memory FakeStorage.
function makeStorage(): { diagStore: FileDiagramStorage; raw: FakeStorage } {
    const raw = new FakeStorage()
    const diagStore = new FileDiagramStorage('test.diagram', raw, null)
    return { diagStore, raw }
}

test('registerArchNodeSerializer registers type "arch" idempotently', () => {
    // Calling it again (already called in beforeAll) must not throw or double-register.
    registerArchNodeSerializer()
    const s = serializerByType('arch')
    expect(s).toBeDefined()
    expect(s!.type).toBe('arch')
})

test('ArchNodeVM serialized record carries type "arch" and empty data', () => {
    const { diagStore } = makeStorage()
    const doc = new DiagramDocument(diagStore)

    const vm = new ArchNodeVM()
    vm.Id = 'a1'
    vm.Left = 30
    vm.Top = 40
    doc.Nodes.Add(vm)

    doc.Save()

    const json = diagStore.GetItem('') as string
    const parsed = JSON.parse(json) as { nodes: Array<{ type: string; data: Record<string, unknown>; id: string }> }
    expect(parsed.nodes).toHaveLength(1)
    const record = parsed.nodes[0]
    expect(record.type).toBe('arch')
    expect(record.data).toEqual({})   // Label/Descriptor NOT persisted
    expect(record.id).toBe('a1')
})

test('ArchNodeVM round-trips id and position through Save/Load', () => {
    const { diagStore } = makeStorage()

    // Save a doc with one ArchNodeVM.
    const saveDoc = new DiagramDocument(diagStore)
    const vm = new ArchNodeVM()
    vm.Id = 'a1'
    vm.Left = 30
    vm.Top = 40
    vm.Width = 72
    vm.Height = 56
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
    expect(archVM.Left).toBe(30)
    expect(archVM.Top).toBe(40)

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
    vm.Left = 10
    vm.Top = 20
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

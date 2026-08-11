import { registerNodeSerializer, serializerByType, type NodeBaseRecord } from '@pragmatic-lab/mural/framework'
import { ArchNodeVM } from './arch-node-vm.js'

// Idempotent — safe to call more than once (production wiring + tests).
export function registerArchNodeSerializer(): void {
    if (serializerByType('arch') !== undefined) return
    registerNodeSerializer({
        type: 'arch',
        matches: (n: unknown) => n instanceof ArchNodeVM,
        // id + position ride the base record; icon/label re-derive on open from the entity
        serialize: (_node: unknown): Record<string, unknown> => ({}),
        deserialize: (_data: Record<string, unknown>, base: NodeBaseRecord): ArchNodeVM => {
            const vm = new ArchNodeVM()
            vm.Left = base.left
            vm.Top = base.top
            vm.Width = base.w
            vm.Height = base.h
            vm.Id = base.id
            return vm
        },
    })
}

// Register at module-import time, NOT only when ArchDiagramBindingService is
// constructed. The renderer bootstrap statically imports the binding service
// (hence this module), so this runs at bundle evaluation — before session
// restore or any DiagramDocument.Load(). Without it, a diagram that loads
// before the service is constructed drops every `arch` node, and each of their
// connectors permanently collapses to the diagram origin (its nodeId can no
// longer resolve). Idempotent, so the service ctor's call is a harmless no-op.
registerArchNodeSerializer()

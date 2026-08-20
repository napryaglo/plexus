import { registerNodeSerializer, serializerByType } from '@pragmatic-lab/mural/framework'
import { ArchNodeVM } from './arch-node-vm.js'

// Idempotent — safe to call more than once (production wiring + tests).
export function registerArchNodeSerializer(): void {
    if (serializerByType('arch') !== undefined) return
    registerNodeSerializer({
        type: 'arch',
        matches: (n: unknown) => n instanceof ArchNodeVM,
        // Content-only: an arch node has no persisted content of its own (icon /
        // label re-derive on open from the entity via ArchDiagramBinding). Geometry
        // — position, size, and the userSized latch — rides the document's `visuals`
        // section (the container Figure owns it), not the node record. The document
        // assigns .Id and applies geometry after construction.
        serialize: (): Record<string, unknown> => ({}),
        deserialize: (): ArchNodeVM => new ArchNodeVM(),
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

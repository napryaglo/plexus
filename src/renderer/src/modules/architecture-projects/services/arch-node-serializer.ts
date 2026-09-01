import { registerNodeSerializer, serializerByType } from '@pragmatic-tech-ai/mural/framework'
import { Color, SolidColorBrush, type FontStyle, type FontWeight, type TextAlignment, type TextDecorations } from '@pragmatic-tech-ai/mural/visual-engine'
import { ArchNodeVM } from './arch-node-vm.js'

// The label-style overrides the user set on a node's title (Format Shape → Text
// page). Each DP is undefined until touched, so an unstyled node serializes to a
// bare `{}` exactly as before — only styled labels carry a `labelStyle` block.
function serializeLabelStyle(vm: ArchNodeVM): Record<string, unknown> | undefined {
    const s: Record<string, unknown> = {}
    if (vm.LabelFontFamily !== undefined) s.fontFamily = vm.LabelFontFamily
    if (vm.LabelFontSize !== undefined) s.fontSize = vm.LabelFontSize
    if (vm.LabelForeground instanceof SolidColorBrush) s.foreground = vm.LabelForeground.Color.ToHex()
    if (vm.LabelFontWeight !== undefined) s.fontWeight = vm.LabelFontWeight
    if (vm.LabelFontStyle !== undefined) s.fontStyle = vm.LabelFontStyle
    if (vm.LabelTextDecorations !== undefined) s.textDecorations = vm.LabelTextDecorations
    if (vm.LabelTextAlignment !== undefined) s.textAlignment = vm.LabelTextAlignment
    return Object.keys(s).length > 0 ? s : undefined
}

// Restore the persisted overrides. The enum values (weight / style / decorations /
// alignment) round-trip as their raw wire form, so a guarded cast is enough.
function applyLabelStyle(vm: ArchNodeVM, data: unknown): void {
    if (data === null || typeof data !== 'object') return
    const s = data as Record<string, unknown>
    if (typeof s.fontFamily === 'string') vm.LabelFontFamily = s.fontFamily
    if (typeof s.fontSize === 'number') vm.LabelFontSize = s.fontSize
    if (typeof s.foreground === 'string') vm.LabelForeground = new SolidColorBrush(Color.FromHex(s.foreground))
    if (s.fontWeight !== undefined) vm.LabelFontWeight = s.fontWeight as FontWeight
    if (s.fontStyle !== undefined) vm.LabelFontStyle = s.fontStyle as FontStyle
    if (s.textDecorations !== undefined) vm.LabelTextDecorations = s.textDecorations as TextDecorations
    if (s.textAlignment !== undefined) vm.LabelTextAlignment = s.textAlignment as TextAlignment
}

// Idempotent — safe to call more than once (production wiring + tests).
export function registerArchNodeSerializer(): void {
    if (serializerByType('arch') !== undefined) return
    registerNodeSerializer({
        type: 'arch',
        matches: (n: unknown) => n instanceof ArchNodeVM,
        // Content-only: an arch node has no persisted content of its own (icon /
        // label re-derive on open from the entity via ArchDiagramBinding). Geometry
        // — position, size, and the userSized latch — rides the document's `visuals`
        // section (the container Figure owns it), not the node record. The one
        // exception is the label's text-style overrides, which are presentation the
        // user set (not derivable from the entity) → persisted as `labelStyle`. The
        // document assigns .Id and applies geometry after construction.
        serialize: (node: unknown): Record<string, unknown> => {
            const labelStyle = serializeLabelStyle(node as ArchNodeVM)
            return labelStyle !== undefined ? { labelStyle } : {}
        },
        deserialize: (data: Record<string, unknown>): ArchNodeVM => {
            const vm = new ArchNodeVM()
            applyLabelStyle(vm, data.labelStyle)
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

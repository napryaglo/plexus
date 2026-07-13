import type { LayoutOutcome, PositionSet } from './diagram-graph-adapter.js'

// How a pipeline run affects the diagram, chosen before running:
//   positions — write new positions; keep every node (nodes the
//               transforms drop stay where they were, just excluded from
//               the layout computation)
//   preview   — commit nothing; the service renders a ghost overlay of
//               the target positions and an explicit Apply commits them
//
// A destructive mode (actually removing dropped nodes) is intentionally
// out of scope for v1: mural exposes no undo/transaction API, so removal
// could not be made reversible. Revisit when it does.
export type RunMode = 'positions' | 'preview'

export interface DiagramMutation
{
    setPositions: PositionSet[]
}

export interface RunPlan
{
    mutation:    DiagramMutation
    previewOnly: boolean
}

export function planForMode(mode: RunMode, outcome: LayoutOutcome): RunPlan
{
    switch (mode) {
        case 'positions':
            return { previewOnly: false, mutation: { setPositions: outcome.setPositions } }
        case 'preview':
            return { previewOnly: true, mutation: { setPositions: [] } }
    }
}

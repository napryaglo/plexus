import type { LayoutOutcome, PositionSet } from './diagram-graph-adapter.js'

// How a pipeline run affects the diagram, chosen before running:
//   positions   — write new positions; keep every node (dropped nodes
//                 stay where they were, just excluded from the layout)
//   preview     — commit nothing; the service renders a ghost overlay of
//                 the target positions and an explicit Apply commits them
//   destructive — write positions AND remove the nodes the transforms
//                 dropped (applied as one undoable command by the service)
export type RunMode = 'positions' | 'preview' | 'destructive'

export interface DiagramMutation
{
    setPositions:  PositionSet[]
    removeNodeIds: string[]
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
            return { previewOnly: false, mutation: { setPositions: outcome.setPositions, removeNodeIds: [] } }
        case 'destructive':
            return { previewOnly: false, mutation: { setPositions: outcome.setPositions, removeNodeIds: outcome.droppedNodeIds } }
        case 'preview':
            return { previewOnly: true, mutation: { setPositions: [], removeNodeIds: [] } }
    }
}

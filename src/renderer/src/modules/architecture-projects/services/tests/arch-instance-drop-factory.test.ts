import { describe, it, expect } from 'vitest'
import { Point } from '@pragmatic-lab/mural/runtime'
import { ToolboxVisualDescriptor } from '@pragmatic-lab/mural/framework'
import { ArchInstanceDropFactory } from '../arch-instance-drop-factory.js'

describe('ArchInstanceDropFactory', () => {
  it('delegates to Mutator.CreateNode(descriptor.Key, x, y) and returns the node', () => {
    const calls: Array<[string, number, number]> = []
    const node = { id: 'n1' }
    const mutator = { CreateNode(kind: string, x: number, y: number) { calls.push([kind, x, y]); return node } }
    const factory = new ArchInstanceDropFactory()
    const desc = new ToolboxVisualDescriptor({} as never, 'Stack.AzureOpenAI')
    const result = factory.CreateDropped({
      Item: {} as never, Descriptor: desc, Position: new Point(120, 80),
      Diagram: {} as never, Mutator: mutator as never,
    })
    expect(calls).toEqual([['Stack.AzureOpenAI', 120, 80]])
    expect(result).toBe(node)
  })

  it('returns null when CreateNode resolves nothing', () => {
    const mutator = { CreateNode() { return null } }
    const factory = new ArchInstanceDropFactory()
    const result = factory.CreateDropped({
      Item: {} as never, Descriptor: new ToolboxVisualDescriptor({} as never, 'x'),
      Position: new Point(0, 0), Diagram: {} as never, Mutator: mutator as never,
    })
    expect(result).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'
import { ServiceKey } from '@pragmatic-lab/mural/runtime'
import { ToolboxVisualDescriptor, TOOLBOX_ITEM_FORMAT, type IToolboxVisualResolver, type IToolboxDropFactory } from '@pragmatic-lab/mural/framework'
import { ArchToolboxItem } from '../arch-toolbox-item.js'

describe('ArchToolboxItem', () => {
  const rk = new ServiceKey<IToolboxVisualResolver>('R')
  const fk = new ServiceKey<IToolboxDropFactory>('F')

  it('exposes Display = label and the base item surface', () => {
    const desc = new ToolboxVisualDescriptor(rk, 'Stack.AzureOpenAI')
    const item = new ArchToolboxItem('term:Stack.AzureOpenAI', 'Azure OpenAI', desc, fk)
    expect(item.Id).toBe('term:Stack.AzureOpenAI')
    expect(item.Label).toBe('Azure OpenAI')
    expect(item.Display).toBe('Azure OpenAI')
    expect(item.Descriptor).toBe(desc)
    expect(item.FactoryKey).toBe(fk)
  })

  it('BeginDragData carries the Id under TOOLBOX_ITEM_FORMAT', () => {
    const item = new ArchToolboxItem('term:x', 'X', new ToolboxVisualDescriptor(rk, 'x'), fk)
    const payload = item.BeginDragData!()
    expect(payload.data.Get(TOOLBOX_ITEM_FORMAT)).toBe('term:x')
  })
})

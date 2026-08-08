import { describe, it, expect } from 'vitest'
import * as fw from '@pragmatic-lab/mural/framework'

describe('mural 0.3.0 toolbox exports', () => {
  it('exposes the toolbox subsystem and drops the old symbols', () => {
    expect(fw.ToolboxRepository).toBeTypeOf('function')
    expect(fw.ToolboxItem).toBeTypeOf('function')
    expect(fw.ToolboxPage).toBeTypeOf('function')
    expect(fw.ToolboxVisualDescriptor).toBeTypeOf('function')
    expect(fw.ToolboxVisualPresenter).toBeTypeOf('function')
    expect(fw.VisualContext).toBeDefined()
    expect(fw.TOOLBOX_ITEM_FORMAT).toBeTypeOf('string')
    expect((fw as Record<string, unknown>).ToolboxShape).toBeUndefined()
    expect((fw as Record<string, unknown>).TOOLBOX_NODE_KIND_FORMAT).toBeUndefined()
  })
})

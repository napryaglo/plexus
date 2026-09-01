import { test, expect } from 'vitest'
import { ToolboxVisualDescriptor } from '@pragmatic-tech-ai/mural/framework'
import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import { ArchToolboxItem } from '../arch-toolbox-item.js'

test('ArchToolboxItem carries Concept and a settable HasWiki', () => {
    const desc = new ToolboxVisualDescriptor(new ServiceKey('x'), 'k')
    const item = new ArchToolboxItem('instance:a', 'A', desc, new ServiceKey('f'), 'service')
    expect(item.Concept).toBe('service')
    expect(item.HasWiki).toBe(false)
    item.HasWiki = true
    expect(item.HasWiki).toBe(true)
})

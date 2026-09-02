import { describe, it, expect } from 'vitest'
import { ToolboxVisualDescriptor } from '@pragmatic-tech-ai/mural/framework'
import { ArchToolboxItem } from '../../../diagram/services/arch-toolbox-item.js'
import { TodlVisualResolverKey } from '../../../diagram/services/todl-visual-resolver.js'
import { ArchModelInstanceDropFactoryKey } from '../arch-model-instance-drop-factory.js'
import { ModelToolboxPage, ScenarioToolboxPage } from '../scoped-toolbox-page.js'

const item = (id: string): ArchToolboxItem =>
    new ArchToolboxItem('instance:' + id, id, new ToolboxVisualDescriptor(TodlVisualResolverKey, id), ArchModelInstanceDropFactoryKey, 'component')

describe('context-scoped model / scenario pages', () => {
    it('reconciles on source change and on becoming the active context, keeping instances', () => {
        let items = [item('e1')]
        let cb: (() => void) | undefined
        const page = new ModelToolboxPage('arch:model:model:proj', 'Model: proj', 'model:proj', {
            resolveItems: () => items,
            onSourceChanged: (f) => { cb = f; return () => {} },
        })
        page.attach()
        expect(page.Context).toBe('model:proj')
        expect(page.Items.ToArray().map((i) => i.Id)).toEqual(['instance:e1'])

        const first = page.Items.Get(0)
        items = [item('e1'), item('e2')]
        cb!()                                          // the model/source changed
        expect(page.Items.ToArray().map((i) => i.Id)).toEqual(['instance:e1', 'instance:e2'])
        expect(page.Items.Get(0)).toBe(first)          // e1 kept its instance

        items = [item('e2')]                           // e1 now placed → drops out of the palette
        page.applyContext(new Set(['model:proj']))     // becomes the active context
        expect(page.IsVisible).toBe(true)
        expect(page.Items.ToArray().map((i) => i.Id)).toEqual(['instance:e2'])
    })

    it('does not recompute items while hidden by context', () => {
        let calls = 0
        const page = new ScenarioToolboxPage('arch:scenarios:model:proj', 'Scenarios: proj', 'model:proj', {
            resolveItems: () => { calls++; return [] },
            onSourceChanged: () => () => {},
        })
        page.attach()                                  // 1 initial refresh
        const before = calls
        page.applyContext(new Set(['other']))          // out of context → hidden, no recompute
        expect(page.IsVisible).toBe(false)
        expect(calls).toBe(before)
    })
})

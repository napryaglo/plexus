import { test, expect, afterEach } from 'vitest'
import { Application, type Visual } from '@pragmatic-lab/mural/runtime'
import { DataTemplate, TextBlock, TextWrapping } from '@pragmatic-lab/mural/basic'
import { ToolboxVisualPresenter } from '@pragmatic-lab/mural/framework'

import { ArchitectureProjectsResources } from '../../architecture-projects.resources.mu.js'
import { InstanceNodeVM } from '../instance-node-vm.js'
import type { ArchInstanceModel } from '../architecture-instance-model.js'

// View-level regression for a canvas node. Each node presents its figure through the
// shared ToolboxVisualPresenter (Figure context, figure/icon ONLY) with the node's
// caption ($Display, wrapping) beneath it — the node, not the visual, owns the label.

let priorApp: Application | null = null

function withApp(): Application {
    priorApp = Application.current
    const app = new Application()
    Application.current = app
    app.Resources.AddMergedDictionary(ArchitectureProjectsResources.Clone())
    return app
}

afterEach(() => { Application.current = priorApp })

function find(root: Visual, pred: (v: Visual) => boolean): Visual | undefined {
    if (pred(root)) return root
    for (const c of root.visualChildren) { const r = find(c, pred); if (r !== undefined) return r }
    return undefined
}

// A minimal ArchInstanceModel stand-in: InstanceNodeVM only reads onChanged / node /
// document.edges. The node has a label (its Display) and a concept (its typeOf).
function vmWith(label: string): InstanceNodeVM {
    const model = {
        onChanged: () => () => {},
        node: () => ({ attrs: { label }, typeOf: 'technology' }),
        document: { edges: [] },
    } as unknown as ArchInstanceModel
    return new InstanceNodeVM(model, 'n1')
}

test('a canvas node hosts the figure presenter + a wrapping $Display caption', () => {
    const app = withApp()
    const tmpl = app.Resources.Resolve(InstanceNodeVM) as DataTemplate
    expect(tmpl).toBeInstanceOf(DataTemplate)

    const vm = vmWith('Azure Cognitive Services')
    expect(vm.Display).toBe('Azure Cognitive Services')
    const root = tmpl.Apply(vm); root.DataContext = vm

    expect(find(root, (v) => v instanceof ToolboxVisualPresenter)).toBeDefined()

    const caption = find(root, (v) => v instanceof TextBlock && (v as TextBlock).Text === 'Azure Cognitive Services') as TextBlock | undefined
    expect(caption).toBeDefined()
    expect(caption!.TextWrapping).toBe(TextWrapping.Wrap)
})

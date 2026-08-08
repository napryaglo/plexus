import { test, expect, afterEach } from 'vitest'
import { Application, type Visual } from '@pragmatic-lab/mural/runtime'
import { DataTemplate, TextBlock, TextWrapping } from '@pragmatic-lab/mural/basic'
import { ShapeToolboxItem, ToolboxItem, ToolboxVisualPresenter } from '@pragmatic-lab/mural/framework'

import { DiagramResources } from '../../diagram.resources.mu.js'

// View-level regression for the toolbox tile. The tile renders any repository item
// through the shared ToolboxVisualPresenter (figure/icon ONLY) with a host-owned
// caption below it — bound to the item's $Label, wrapping. Resolving the implicit
// DataTemplate[ToolboxItem] for a shape item must host the presenter AND the caption.

let priorApp: Application | null = null

function withApp(): Application {
    priorApp = Application.current
    const app = new Application()
    Application.current = app
    app.Resources.AddMergedDictionary(DiagramResources.Clone())
    return app
}

afterEach(() => { Application.current = priorApp })

function find(root: Visual, pred: (v: Visual) => boolean): Visual | undefined {
    if (pred(root)) return root
    for (const c of root.visualChildren) { const r = find(c, pred); if (r !== undefined) return r }
    return undefined
}

test('the tile hosts the figure presenter + a wrapping $Label caption', () => {
    const app = withApp()
    const tmpl = app.Resources.Resolve(ToolboxItem) as DataTemplate
    expect(tmpl).toBeInstanceOf(DataTemplate)   // implicit-by-type template is registered

    const item = new ShapeToolboxItem('rectangle', 'Rectangle')
    const root = tmpl.Apply(item); root.DataContext = item

    expect(find(root, (v) => v instanceof ToolboxVisualPresenter)).toBeDefined()

    const caption = find(root, (v) => v instanceof TextBlock && (v as TextBlock).Text === 'Rectangle') as TextBlock | undefined
    expect(caption).toBeDefined()                       // the item Label rendered as the caption
    expect(caption!.TextWrapping).toBe(TextWrapping.Wrap)   // long names wrap in the tile
})

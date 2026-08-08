import { test, expect, afterEach } from 'vitest'
import { Application } from '@pragmatic-lab/mural/runtime'

import { DiagramResources } from '../../diagram.resources.mu.js'

// The fallback glyph IconKeyConverter resolves when an entity's icon annotation
// resolves nothing. Baked from the Material Symbols font into DiagramResources,
// which app.mu merges app-global (mirrors toolbox-tile-render.test.ts).

let priorApp: Application | null = null
afterEach(() => { Application.current = priorApp })

test('ships a resolvable @category fallback glyph geometry', () => {
    priorApp = Application.current
    const app = new Application()
    Application.current = app
    app.Resources.AddMergedDictionary(DiagramResources.Clone())

    expect(app.Resources.CanResolve('category')).toBe(true)
    expect(app.Resources.Resolve('category')).toBeDefined()
})

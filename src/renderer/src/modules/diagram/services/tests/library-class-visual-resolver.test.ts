import { describe, it, expect } from 'vitest'
import { DataTemplate, Border } from '@pragmatic-lab/mural/basic'
import { VisualContext, ToolboxVisualDescriptor } from '@pragmatic-lab/mural/framework'
import { LibraryClassVisualResolver } from '../library-class-visual-resolver.js'

function fakeRegistry() {
  const listeners = new Set<(id: string) => void>()
  return {
    resolved: [] as string[],
    resolve(id: string, _c: string) { this.resolved.push(id); return new DataTemplate(() => new Border()) },
    onChanged(cb: (id: string) => void) { listeners.add(cb); return () => listeners.delete(cb) },
    fire(id: string) { for (const l of listeners) l(id) },
    listenerCount() { return listeners.size },
  }
}

describe('LibraryClassVisualResolver', () => {
  it('resolves the class template and makes a Tile non-hit-test, a Figure interactive', () => {
    const reg = fakeRegistry()
    const r = new LibraryClassVisualResolver(reg as never)
    const desc = new ToolboxVisualDescriptor({} as never, 'Stack.AzureOpenAI')
    const tile = r.Resolve(desc, VisualContext.Tile) as Border
    const fig = r.Resolve(desc, VisualContext.Figure) as Border
    expect(reg.resolved).toEqual(['Stack.AzureOpenAI', 'Stack.AzureOpenAI'])
    expect(tile.IsHitTestVisible).toBe(false)
    expect(fig.IsHitTestVisible).not.toBe(false)
  })

  it('bridges registry.onChanged to the changed signal and unsubscribes', () => {
    const reg = fakeRegistry()
    const r = new LibraryClassVisualResolver(reg as never)
    const seen: string[] = []
    const cb = (k: string) => seen.push(k)
    r.AddChangedListener(cb)
    reg.fire('Stack.AzureOpenAI')
    expect(seen).toEqual(['Stack.AzureOpenAI'])
    r.RemoveChangedListener(cb)
    expect(reg.listenerCount()).toBe(0)
    reg.fire('Stack.AzureOpenAI')
    expect(seen).toEqual(['Stack.AzureOpenAI'])
  })
})

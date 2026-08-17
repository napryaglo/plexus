import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { FileSystemService } from '../../file-system/file-system-service.js'
import { CodeEditorService } from '../../../modules/code-editor/code-editor-service.js'
import { WikiLocator } from '../wiki-locator.js'
import { WikiService } from '../wiki-service.js'

function svc(opts: {
    resolve?: { root: string; relPath: string }
    exists?: boolean
}): { wiki: WikiService; opened: string[] } {
    const opened: string[] = []
    const provider = new ServiceProvider()
    provider.registerInstance(FileSystemService.Key, {
        Exists: () => Promise.resolve(opts.exists ?? true),
    } as unknown as FileSystemService)
    provider.registerInstance(CodeEditorService.Key, {
        OpenFile: (p: string) => { opened.push(p) },
    } as unknown as CodeEditorService)
    provider.registerInstance(WikiLocator.Key, {
        resolveWiki: () => Promise.resolve(opts.resolve),
    } as unknown as WikiLocator)
    return { wiki: new WikiService(provider), opened }
}

test('openWiki opens join(root, relPath) when it resolves and exists', async () => {
    const { wiki, opened } = svc({ resolve: { root: '/mm', relPath: 'wiki/service.md' }, exists: true })
    await wiki.openWiki('service')
    expect(opened).toEqual(['/mm/wiki/service.md'])
})

test('openWiki is a no-op with a status when the concept does not resolve', async () => {
    const { wiki, opened } = svc({ resolve: undefined })
    await wiki.openWiki('service')
    expect(opened).toEqual([])
    expect(wiki.Status.length).toBeGreaterThan(0)
})

test('openWiki is a no-op with a status when the file is missing', async () => {
    const { wiki, opened } = svc({ resolve: { root: '/mm', relPath: 'wiki/service.md' }, exists: false })
    await wiki.openWiki('service')
    expect(opened).toEqual([])
    expect(wiki.Status.length).toBeGreaterThan(0)
})

test('hasWiki reflects whether the concept resolves', async () => {
    expect(await svc({ resolve: { root: '/mm', relPath: 'w.md' } }).wiki.hasWiki('service')).toBe(true)
    expect(await svc({ resolve: undefined }).wiki.hasWiki('service')).toBe(false)
})

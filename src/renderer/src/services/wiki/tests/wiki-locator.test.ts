import { test, expect } from 'vitest'
import { ServiceProvider, ObservableCollection } from '@pragmatic-lab/mural/runtime'
import { ProjectExplorerService } from '../../../modules/project-explorer/services/project-explorer-service.js'
import { WikiLocator } from '../wiki-locator.js'

// A fake OpenProject: its Storage yields one .todl source (its own model text).
// collectTodlSources walks with storage.List(dir) → [{Name, IsDirectory}] and
// reads with storage.ReadText(path); the fake models exactly those two calls.
function fakeProject(root: string, name: string, todl: string): unknown {
    const storage = {
        List: () => Promise.resolve([{ Name: 'model.todl', IsDirectory: false }]),
        ReadText: () => Promise.resolve(todl),
    }
    return { Project: { RootPath: root, Name: name }, Storage: storage }
}

function locatorWith(...projects: unknown[]): WikiLocator {
    const explorer = { OpenProjects: new ObservableCollection(projects) } as unknown as ProjectExplorerService
    const provider = new ServiceProvider()
    provider.registerInstance(ProjectExplorerService.Key, explorer)
    return new WikiLocator(provider)
}

const MM = `namespace mm { concept service { annotate wiki { path = "wiki/service.md"; } } }`
const ARCH = `namespace app { import mm; model M conforms mm.Model { service s1 {} } }`

test('resolves a concept declared in an open meta-model project', async () => {
    const loc = locatorWith(fakeProject('/mm', 'mm', MM), fakeProject('/app', 'app', ARCH))
    expect(await loc.resolveWiki('service')).toEqual({ root: '/mm', relPath: 'wiki/service.md' })
})

test('returns undefined when no open project declares the concept', async () => {
    const loc = locatorWith(fakeProject('/app', 'app', ARCH))
    expect(await loc.resolveWiki('service')).toBeUndefined()
})

test('returns undefined for a concept without a wiki annotation', async () => {
    const bare = `namespace mm { concept widget {} }`
    const loc = locatorWith(fakeProject('/mm', 'mm', bare))
    expect(await loc.resolveWiki('widget')).toBeUndefined()
})

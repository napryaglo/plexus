import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { ContentHostService, DocumentsContentHostService, ProjectFactoryRegistry, type IDocument } from '@pragmatic-lab/mural/framework'

import { EnvironmentService } from '../../../../services/environment/environment-service.js'
import { FileSystemService } from '../../../../services/file-system/file-system-service.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { Project, ProjectNode } from '../../../../services/projects/project.js'
import { OpenProject } from '../../../../services/projects/open-project.js'
import { OpenProjectsStore } from '../../../../services/projects/open-projects-store.js'
import { PROJECT_MANIFEST_FILENAME, type IProjectFactory, type IPublishableProjectFactory } from '../../../../services/projects/project-factory.js'
import { ProjectExplorerService } from '../project-explorer-service.js'

// A recording fake factory declaring one 'todl' format. openProject returns a
// fresh tree (used by New File refresh); openFile records + returns a stub doc.
interface Rec { opened: string[]; saved: IDocument[] }
function fakeFactory(rec: Rec, publishable = true): IProjectFactory
{
    const doc = (id: string): IDocument => ({ Id: id, Title: id, IsDirty: false, Save() {} })
    const base: IProjectFactory = {
        formats: [{ extension: '.todl', kind: 'todl', displayName: 'TODL Definition' }],
        createProject: async (_s, name) => projectWith(name, 'C:/x'),
        openProject: async () => projectWith('P', 'C:/x'),
        saveProject: async () => {},
        openFile: async (_s, path) => { rec.opened.push(path); return doc(path) },
        saveFile: async (d) => { rec.saved.push(d) },
        newFile: async (_s, _fmt, name) => `${name}.todl`,
    }
    if (!publishable) return base
    const pub: IProjectFactory & IPublishableProjectFactory = { ...base, publish: async () => ({ ok: true, message: 'Published.' }) }
    return pub
}

function projectWith(name: string, folder: string): Project
{
    const root = new ProjectNode(name, '', 'folder')
    root.Children.Add(new ProjectNode('core.todl', 'core.todl', 'todl'))
    return new Project('meta-model', name, folder, root)
}

function fakeFs(): FileSystemService
{
    const files = new Map<string, string>()
    return {
        Exists: (p: string) => Promise.resolve(files.has(p)),
        ReadText: (p: string) => Promise.resolve(files.get(p) ?? ''),
        WriteText: (p: string, c: string) => { files.set(p, c); return Promise.resolve() },
    } as unknown as FileSystemService
}

interface ExplorerPrivates
{
    addOpenProject(p: Project, f: IProjectFactory, s: FakeStorage): Promise<OpenProject>
    openNode(node: ProjectNode, op: OpenProject): Promise<void>
    closeProject(op: OpenProject): Promise<void>
    saveActive(): Promise<void>
}

function makeExplorer(): {
    service: ProjectExplorerService
    host: DocumentsContentHostService
    store: OpenProjectsStore
    priv: ExplorerPrivates
}
{
    const provider = new ServiceProvider()
    const host = new DocumentsContentHostService(provider)
    provider.registerInstance(ContentHostService.Key, host)
    provider.registerInstance(FileSystemService.Key, fakeFs())
    provider.registerInstance(EnvironmentService.Key, { UserDataDirectory: '/data' } as unknown as EnvironmentService)
    const store = new OpenProjectsStore(provider)
    provider.registerInstance(OpenProjectsStore.Key, store)
    const service = new ProjectExplorerService(provider)
    return { service, host, store, priv: service as unknown as ExplorerPrivates }
}

function childNode(op: OpenProject): ProjectNode
{
    return op.Root.Children.ToArray()[0]!
}

test('opening two projects adds two roots; reopening one dedupes', async () => {
    const { service, priv, store } = makeExplorer()
    const rec: Rec = { opened: [], saved: [] }
    await priv.addOpenProject(projectWith('A', 'C:/a'), fakeFactory(rec), new FakeStorage('C:/a'))
    await priv.addOpenProject(projectWith('B', 'C:/b'), fakeFactory(rec), new FakeStorage('C:/b'))
    await priv.addOpenProject(projectWith('A2', 'C:/a'), fakeFactory(rec), new FakeStorage('C:/a'))   // same folder

    expect(service.OpenProjects.Count).toBe(2)
    expect((await store.List()).slice().sort()).toEqual(['C:/a', 'C:/b'])
})

test('a node opens through its OWN project factory', async () => {
    const { priv } = makeExplorer()
    const recA: Rec = { opened: [], saved: [] }
    const recB: Rec = { opened: [], saved: [] }
    await priv.addOpenProject(projectWith('A', 'C:/a'), fakeFactory(recA), new FakeStorage('C:/a'))
    const opB = await priv.addOpenProject(projectWith('B', 'C:/b'), fakeFactory(recB), new FakeStorage('C:/b'))

    await priv.openNode(childNode(opB), opB)

    expect(recB.opened).toEqual(['core.todl'])
    expect(recA.opened).toEqual([])
})

test('the active document saves through its owning project factory', async () => {
    const { host, priv } = makeExplorer()
    const recA: Rec = { opened: [], saved: [] }
    const opA = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeFactory(recA), new FakeStorage('C:/a'))

    await priv.openNode(childNode(opA), opA)
    host.ActiveDocument = host.OpenDocuments.ToArray()[0]

    await priv.saveActive()
    expect(recA.saved.length).toBe(1)
})

test('closing a project removes it, closes its tabs, and unpersists it', async () => {
    const { service, host, store, priv } = makeExplorer()
    const rec: Rec = { opened: [], saved: [] }
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeFactory(rec), new FakeStorage('C:/a'))

    await priv.openNode(childNode(op), op)
    expect(host.OpenDocuments.Count).toBe(1)

    await priv.closeProject(op)

    expect(service.OpenProjects.Count).toBe(0)
    expect(host.OpenDocuments.Count).toBe(0)
    expect(await store.List()).toEqual([])
})

test('Publish is disabled for a non-publishable project', async () => {
    const { priv } = makeExplorer()
    const rec: Rec = { opened: [], saved: [] }
    const pub = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeFactory(rec, true), new FakeStorage('C:/a'))
    const plain = await priv.addOpenProject(projectWith('B', 'C:/b'), fakeFactory(rec, false), new FakeStorage('C:/b'))

    expect(pub.PublishCommand!.CanExecute(undefined)).toBe(true)
    expect(plain.PublishCommand!.CanExecute(undefined)).toBe(false)
})

test('RestoreSession reopens folders that exist and prunes missing ones', async () => {
    const provider = new ServiceProvider()
    const host = new DocumentsContentHostService(provider)
    provider.registerInstance(ContentHostService.Key, host)
    provider.registerInstance(FileSystemService.Key, fakeFs())
    provider.registerInstance(EnvironmentService.Key, { UserDataDirectory: '/data' } as unknown as EnvironmentService)
    const store = new OpenProjectsStore(provider)
    provider.registerInstance(OpenProjectsStore.Key, store)

    // Per-folder FakeStorage; only C:/a has a project manifest.
    const storages = new Map<string, FakeStorage>()
    const storageFor = (folder: string): FakeStorage => {
        let s = storages.get(folder)
        if (s === undefined) { s = new FakeStorage(folder); storages.set(folder, s) }
        return s
    }
    const registry = new StorageProviderRegistry(provider)
    registry.Register(StorageProviderRegistry.DefaultBackendId, (folder) => storageFor(folder))
    provider.registerInstance(StorageProviderRegistry.Key, registry)
    // A fake factory registry (the real one's ctor needs the ApplicationService).
    // GetByType returns undefined → C:/a is opened-attempted but its type has no
    // factory, so it's kept (not pruned); only manifest-less C:/b is pruned.
    provider.registerInstance(ProjectFactoryRegistry.Key, { GetByType: () => undefined } as unknown as ProjectFactoryRegistry)
    await storageFor('C:/a').WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'unregistered' }))

    await store.Add('C:/a')
    await store.Add('C:/b')   // no manifest → should be pruned

    const service = new ProjectExplorerService(provider)
    await service.RestoreSession()

    // C:/b pruned (missing manifest); C:/a kept (it has a manifest, even though
    // its factory type isn't registered in this test, so it isn't removed).
    expect(await store.List()).toEqual(['C:/a'])
})

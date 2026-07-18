import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { ContentHostService, DocumentsContentHostService, type IDocument } from '@pragmatic-lab/mural/framework'

import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { Project, ProjectNode } from '../../../../services/projects/project.js'
import type {
    IProjectFactory,
    IPublishableProjectFactory,
    ProjectFileFormat,
} from '../../../../services/projects/project-factory.js'
import { ProjectExplorerService } from '../project-explorer-service.js'

// A recording fake factory declaring a single 'todl' format. Publishable unless
// `publishable: false` — to exercise the isPublishable feature-test.
function fakeFactory(opened: string[], publishable = true): IProjectFactory
{
    const doc = (id: string): IDocument => ({ Id: id, Title: id, IsDirty: false, Save() {} })
    const base: IProjectFactory = {
        formats: [{ extension: '.todl', kind: 'todl', displayName: 'TODL Definition' } as ProjectFileFormat],
        createProject: async (_s, name) => new Project('meta-model', name, 'root', new ProjectNode('root', '', 'folder')),
        openProject: async () => new Project('meta-model', 'P', 'root', new ProjectNode('root', '', 'folder')),
        saveProject: async () => {},
        openFile: async (_s, path) => { opened.push(path); return doc(path) },
        saveFile: async () => {},
        newFile: async (_s, _fmt, name) => `${name}.todl`,
    }
    if (!publishable) return base
    const pub: IProjectFactory & IPublishableProjectFactory = {
        ...base,
        publish: async () => ({ ok: true, message: 'Published p@0.1.0.' }),
    }
    return pub
}

// Build an explorer with a real content host, and force-activate a factory +
// storage + project (bypassing the dialog-driven open flow).
function activated(factory: IProjectFactory): {
    service: ProjectExplorerService
    host: DocumentsContentHostService
    priv: { openNode(n: ProjectNode): Promise<void>; newFile(): Promise<void>; publish(): Promise<void> }
}
{
    const provider = new ServiceProvider()
    const host = new DocumentsContentHostService(provider)
    provider.registerInstance(ContentHostService.Key, host)
    const service = new ProjectExplorerService(provider)

    const reach = service as unknown as {
        activeFactory: IProjectFactory
        activeStorage: FakeStorage
        openNode(n: ProjectNode): Promise<void>
        newFile(): Promise<void>
        publish(): Promise<void>
    }
    reach.activeFactory = factory
    reach.activeStorage = new FakeStorage()
    service.set_property_value(ProjectExplorerService.ProjectKey, new Project('meta-model', 'P', 'root', new ProjectNode('root', '', 'folder')))
    return { service, host, priv: reach }
}

test('openNode opens a format-kind node in a tab', async () => {
    const opened: string[] = []
    const { host, priv } = activated(fakeFactory(opened))

    await priv.openNode(new ProjectNode('core.todl', 'defs/core.todl', 'todl'))

    expect(opened).toEqual(['defs/core.todl'])
    expect(host.OpenDocuments.Count).toBe(1)
})

test('openNode does not open a plain file in a tab (no OS access on fake storage)', async () => {
    const opened: string[] = []
    const { service, host, priv } = activated(fakeFactory(opened))

    await priv.openNode(new ProjectNode('notes.txt', 'notes.txt', 'file'))

    expect(opened).toEqual([])
    expect(host.OpenDocuments.Count).toBe(0)
    expect(service.Status).toMatch(/no OS access/i)
})

test('newFile creates and opens the active factory first format', async () => {
    const opened: string[] = []
    const { priv } = activated(fakeFactory(opened))

    await priv.newFile()

    expect(opened).toEqual(['todl-1.todl'])   // `${kind}-${count+1}` → newFile → openFile
})

test('publish delegates and surfaces the factory message', async () => {
    const { service, priv } = activated(fakeFactory([]))
    await priv.publish()
    expect(service.Status).toBe('Published p@0.1.0.')
})

test('publish refuses a non-publishable project type', async () => {
    const { service, priv } = activated(fakeFactory([], false))
    await priv.publish()
    expect(service.Status).toMatch(/can't be published/i)
})

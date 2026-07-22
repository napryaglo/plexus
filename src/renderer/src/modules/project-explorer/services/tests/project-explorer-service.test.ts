import { test, expect } from 'vitest'
import { Key, ServiceProvider, type KeyEventArgs } from '@pragmatic-lab/mural/runtime'
import { ContentHostService, DialogService, DocumentsContentHostService, DocumentTypeRegistry, ProjectFactoryRegistry, type IDocument } from '@pragmatic-lab/mural/framework'

import { EnvironmentService } from '../../../../services/environment/environment-service.js'
import { FileSystemService } from '../../../../services/file-system/file-system-service.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { Project, ProjectNode } from '../../../../services/projects/project.js'
import { OpenProject } from '../../../../services/projects/open-project.js'
import { OpenProjectsStore } from '../../../../services/projects/open-projects-store.js'
import { PROJECT_MANIFEST_FILENAME, type IProjectFactory, type IPublishableProjectFactory } from '../../../../services/projects/project-factory.js'
import type { IDocumentFactory, IRelocatableDocumentFactory } from '../../../../services/documents/document-factory.js'
import { ConfirmDialogModel } from '../../../../services/dialogs/confirm-dialog-model.js'
import { ProjectExplorerService, importFilters, uniqueStorageName } from '../project-explorer-service.js'

// A picked file as the OS dialog would hand it back (absolute path + raw bytes).
type Picked = { Path: string; Bytes: Uint8Array }
const bytesOf = (s: string): Uint8Array => new TextEncoder().encode(s)

// Editors own files, not projects. The document factory (below) records file
// I/O; a project factory now provides only lifecycle + formats + publish.
interface Rec { opened: string[]; saved: IDocument[]; relocated: Array<[IDocument, string]> }

// A marker class: the DocumentDefinition.Factory token the explorer resolves for
// the `.todl` extension. Registered in the provider to a recording fake below.
class TodlDocFactoryToken {}

function fakeDocFactory(rec: Rec): IDocumentFactory & IRelocatableDocumentFactory
{
    const doc = (id: string): IDocument => ({ Id: id, Title: id, IsDirty: false, Save() {} })
    return {
        openFile: async (_s, path) => { rec.opened.push(path); return doc(path) },
        saveFile: async (d) => { rec.saved.push(d) },
        newFile: async (_s, name) => (name.endsWith('.todl') ? name : `${name}.todl`),
        relocateOpenFile: (d, newPath) => { rec.relocated.push([d, newPath]) },
    }
}

// A project factory: lifecycle + one 'todl' format + optional publish. No file
// I/O — that lives on the document factory, resolved by extension.
function fakeProjectFactory(publishable = true): IProjectFactory
{
    const base: IProjectFactory = {
        formats: [{ extension: '.todl', kind: 'todl', displayName: 'TODL Definition' }],
        createProject: async (_s, name) => projectWith(name, 'C:/x'),
        openProject: async () => projectWith('P', 'C:/x'),
        saveProject: async () => {},
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

function fakeFs(openFiles: Picked[] | null = null): FileSystemService
{
    const files = new Map<string, string>()
    return {
        Exists: (p: string) => Promise.resolve(files.has(p)),
        ReadText: (p: string) => Promise.resolve(files.get(p) ?? ''),
        WriteText: (p: string, c: string) => { files.set(p, c); return Promise.resolve() },
        OpenFiles: () => Promise.resolve(openFiles),
    } as unknown as FileSystemService
}

interface ExplorerPrivates
{
    addOpenProject(p: Project, f: IProjectFactory, s: FakeStorage): Promise<OpenProject>
    openNode(node: ProjectNode, op: OpenProject): Promise<void>
    addExistingFilesTo(op: OpenProject): Promise<void>
    newFileIn(op: OpenProject, parentFolder?: string): Promise<void>
    newFolderIn(op: OpenProject, parentFolder?: string): Promise<void>
    beginRename(op: OpenProject, node: ProjectNode): void
    commitRename(op: OpenProject, node: ProjectNode): Promise<void>
    handleTreeKey(op: OpenProject, args: KeyEventArgs): void
    deleteNodes(op: OpenProject, nodes: readonly ProjectNode[]): Promise<void>
    deleteFromNode(op: OpenProject, node: ProjectNode): Promise<void>
    moveNodes(op: OpenProject, nodes: readonly ProjectNode[], destParentPath: string): Promise<void>
    closeProject(op: OpenProject): Promise<void>
    saveActive(): Promise<void>
}

// A fake DialogService: Show records the shown content and resolves the preset
// confirm answer (so the confirm-then-delete flow runs without a real dialog).
function fakeDialogs(confirm: boolean, shown: unknown[]): DialogService
{
    return {
        Show: (opts: { Content: unknown }) => { shown.push(opts.Content); return Promise.resolve(confirm) },
        Close: () => {},
    } as unknown as DialogService
}

function makeExplorer(openFiles: Picked[] | null = null, confirm = true): {
    service: ProjectExplorerService
    host: DocumentsContentHostService
    store: OpenProjectsStore
    priv: ExplorerPrivates
    shownDialogs: unknown[]
    rec: Rec
}
{
    const provider = new ServiceProvider()
    const host = new DocumentsContentHostService(provider)
    provider.registerInstance(ContentHostService.Key, host)
    provider.registerInstance(FileSystemService.Key, fakeFs(openFiles))
    provider.registerInstance(EnvironmentService.Key, { UserDataDirectory: '/data' } as unknown as EnvironmentService)
    const shownDialogs: unknown[] = []
    provider.registerInstance(DialogService.Key, fakeDialogs(confirm, shownDialogs))
    const store = new OpenProjectsStore(provider)
    provider.registerInstance(OpenProjectsStore.Key, store)
    // Editor routing: a recording `.todl` document factory + a registry that
    // resolves the extension to its token.
    const rec: Rec = { opened: [], saved: [], relocated: [] }
    provider.registerInstance(ServiceProvider.tokenFor(TodlDocFactoryToken), fakeDocFactory(rec))
    provider.registerInstance(DocumentTypeRegistry.Key, {
        GetByExtension: (ext: string) => (ext === '.todl' ? { Factory: TodlDocFactoryToken } : undefined),
    } as unknown as DocumentTypeRegistry)
    const service = new ProjectExplorerService(provider)
    return { service, host, store, priv: service as unknown as ExplorerPrivates, shownDialogs, rec }
}

function childNode(op: OpenProject): ProjectNode
{
    return op.Root.Children.ToArray()[0]!
}

test('opening two projects adds two roots; reopening one dedupes', async () => {
    const { service, priv, store } = makeExplorer()
    await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), new FakeStorage('C:/a'))
    await priv.addOpenProject(projectWith('B', 'C:/b'), fakeProjectFactory(), new FakeStorage('C:/b'))
    await priv.addOpenProject(projectWith('A2', 'C:/a'), fakeProjectFactory(), new FakeStorage('C:/a'))   // same folder

    expect(service.OpenProjects.Count).toBe(2)
    expect((await store.List()).slice().sort()).toEqual(['C:/a', 'C:/b'])
})

test('opening a node opens it through the registered document editor', async () => {
    const { priv, host, rec } = makeExplorer()
    await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), new FakeStorage('C:/a'))
    const opB = await priv.addOpenProject(projectWith('B', 'C:/b'), fakeProjectFactory(), new FakeStorage('C:/b'))

    await priv.openNode(childNode(opB), opB)

    expect(rec.opened).toEqual(['core.todl'])
    expect(host.OpenDocuments.Count).toBe(1)
})

test('the active document saves through the registered document editor', async () => {
    const { host, priv, rec } = makeExplorer()
    const opA = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), new FakeStorage('C:/a'))

    await priv.openNode(childNode(opA), opA)
    host.ActiveDocument = host.OpenDocuments.ToArray()[0]

    await priv.saveActive()
    expect(rec.saved.length).toBe(1)
})

test('closing a project removes it, closes its tabs, and unpersists it', async () => {
    const { service, host, store, priv } = makeExplorer()
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), new FakeStorage('C:/a'))

    await priv.openNode(childNode(op), op)
    expect(host.OpenDocuments.Count).toBe(1)

    await priv.closeProject(op)

    expect(service.OpenProjects.Count).toBe(0)
    expect(host.OpenDocuments.Count).toBe(0)
    expect(await store.List()).toEqual([])
})

test('Publish is disabled for a non-publishable project', async () => {
    const { priv } = makeExplorer()
    const pub = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(true), new FakeStorage('C:/a'))
    const plain = await priv.addOpenProject(projectWith('B', 'C:/b'), fakeProjectFactory(false), new FakeStorage('C:/b'))

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

test('Add Existing Files copies each picked file into the project storage', async () => {
    const picked: Picked[] = [
        { Path: 'C:/ext/logo.png', Bytes: bytesOf('PNG') },
        { Path: 'C:/ext/notes.txt', Bytes: bytesOf('hello') },
    ]
    const { service, priv } = makeExplorer(picked)
    const storage = new FakeStorage('C:/a')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.addExistingFilesTo(op)

    expect(await storage.Exists('logo.png')).toBe(true)
    expect(await storage.Exists('notes.txt')).toBe(true)
    expect(service.Status).toBe('Added 2 files.')
})

test('Add Existing Files auto-renames on a name collision, leaving the original', async () => {
    const picked: Picked[] = [{ Path: 'C:/ext/core.todl', Bytes: bytesOf('imported') }]
    const { priv } = makeExplorer(picked)
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('core.todl', 'existing')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.addExistingFilesTo(op)

    expect(await storage.Exists('core-2.todl')).toBe(true)   // imported under a fresh name
    expect(await storage.ReadText('core.todl')).toBe('existing')   // original untouched
})

test('Add Existing Files is a no-op when the picker is cancelled', async () => {
    const { priv } = makeExplorer(null)
    const storage = new FakeStorage('C:/a')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)
    const before = storage.size

    await priv.addExistingFilesTo(op)

    expect(storage.size).toBe(before)
})

test('uniqueStorageName returns the name when free, else the next stem-N.ext', async () => {
    const s = new FakeStorage()
    expect(await uniqueStorageName(s, 'a.diagram')).toBe('a.diagram')
    await s.WriteText('a.diagram', '')
    expect(await uniqueStorageName(s, 'a.diagram')).toBe('a-2.diagram')
    await s.WriteText('a-2.diagram', '')
    expect(await uniqueStorageName(s, 'a.diagram')).toBe('a-3.diagram')
})

test('uniqueStorageName keeps a dotfile name whole (no false extension split)', async () => {
    const s = new FakeStorage()
    await s.WriteText('.gitignore', '')
    expect(await uniqueStorageName(s, '.gitignore')).toBe('.gitignore-2')
})

test('New Folder creates "New Folder" under the given parent, auto-numbering on collision', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.newFolderIn(op, '')
    expect(await storage.Exists('New Folder')).toBe(true)

    await priv.newFolderIn(op, '')
    expect(await storage.Exists('New Folder-2')).toBe(true)
})

test('New Folder nests under a subfolder', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.CreateDirectory('src')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.newFolderIn(op, 'src')
    expect(await storage.Exists('src/New Folder')).toBe(true)
})

test('New File in a subfolder is created and opened under that folder', async () => {
    const { priv, rec } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.CreateDirectory('src')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.newFileIn(op, 'src')
    expect(rec.opened).toEqual(['src/todl.todl'])
})

test('a folder node is wired to create inside itself (container-aware)', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.CreateDirectory('src')
    const root = new ProjectNode('A', '', 'folder')
    root.Children.Add(new ProjectNode('src', 'src', 'folder'))
    const op = await priv.addOpenProject(new Project('meta-model', 'A', 'C:/a', root), fakeProjectFactory(), storage)

    const folder = op.Root.Children.ToArray().find((n) => n.Kind === 'folder')!
    folder.NewFolderCommand!.Execute(undefined)
    await new Promise((r) => setTimeout(r, 0))   // let the fire-and-forget command settle

    expect(await storage.Exists('src/New Folder')).toBe(true)
})

test('commitRename moves the file on storage under the same parent', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('core.todl', 'x')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)
    const node = childNode(op)

    priv.beginRename(op, node)
    node.EditingName = 'renamed.todl'
    await priv.commitRename(op, node)

    expect(await storage.Exists('renamed.todl')).toBe(true)
    expect(await storage.Exists('core.todl')).toBe(false)
})

test('commitRename rejects a name that collides and leaves the file put', async () => {
    const { service, priv } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('core.todl', 'x')
    await storage.WriteText('taken.todl', 'y')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)
    const node = childNode(op)

    priv.beginRename(op, node)
    node.EditingName = 'taken.todl'
    await priv.commitRename(op, node)

    expect(service.Status).toContain('already exists')
    expect(await storage.Exists('core.todl')).toBe(true)
    expect(node.IsEditing).toBe(false)
})

test('commitRename with an unchanged name is a no-op that closes the editor', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('core.todl', 'x')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)
    const node = childNode(op)

    priv.beginRename(op, node)
    node.EditingName = 'core.todl'   // unchanged
    await priv.commitRename(op, node)

    expect(node.IsEditing).toBe(false)
    expect(op.EditingNode).toBeUndefined()
})

test('renaming an open file re-points its document to the new path', async () => {
    const { priv, rec } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('core.todl', 'x')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)
    const node = childNode(op)
    await priv.openNode(node, op)   // opens core.todl → tracked as an open document

    priv.beginRename(op, node)
    node.EditingName = 'renamed.todl'
    await priv.commitRename(op, node)

    expect(rec.relocated.map(([, p]) => p)).toEqual(['renamed.todl'])
})

test('F2 begins rename on the selected node; Escape cancels it', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)
    const node = childNode(op)
    op.SelectedNode = node

    const f2 = { Key: Key.F2, Handled: false } as unknown as KeyEventArgs
    priv.handleTreeKey(op, f2)
    expect(node.IsEditing).toBe(true)
    expect(f2.Handled).toBe(true)

    const esc = { Key: Key.Escape, Handled: false } as unknown as KeyEventArgs
    priv.handleTreeKey(op, esc)
    expect(node.IsEditing).toBe(false)
    expect(op.EditingNode).toBeUndefined()
    expect(esc.Handled).toBe(true)
})

test('importFilters lists each format plus an All-files catch-all', () => {
    const filters = importFilters([{ extension: '.todl', kind: 'todl', displayName: 'TODL Definition' }])
    expect(filters).toEqual([
        { Name: 'TODL Definition', Extensions: ['todl'] },
        { Name: 'All files', Extensions: ['*'] },
    ])
})

// ── Delete ───────────────────────────────────────────────────────────────

// A root with two todl files and a subfolder holding one — for delete tests
// that need multiple siblings and a nested file.
function projectWithTree(folder: string): Project
{
    const root = new ProjectNode('A', '', 'folder')
    root.Children.Add(new ProjectNode('a.todl', 'a.todl', 'todl'))
    root.Children.Add(new ProjectNode('b.todl', 'b.todl', 'todl'))
    const src = new ProjectNode('src', 'src', 'folder')
    src.Children.Add(new ProjectNode('c.todl', 'src/c.todl', 'todl'))
    root.Children.Add(src)
    return new Project('meta-model', 'A', folder, root)
}

test('deleting a confirmed file removes it from storage and closes its open tab', async () => {
    const { priv, host } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('core.todl', 'x')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)
    const node = childNode(op)
    await priv.openNode(node, op)
    expect(host.OpenDocuments.Count).toBe(1)

    await priv.deleteNodes(op, [node])

    expect(await storage.Exists('core.todl')).toBe(false)
    expect(host.OpenDocuments.Count).toBe(0)
})

test('cancelling the confirm dialog leaves the file in place', async () => {
    const { priv } = makeExplorer(null, false)   // dialog resolves "not confirmed"
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('core.todl', 'x')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.deleteNodes(op, [childNode(op)])

    expect(await storage.Exists('core.todl')).toBe(true)
})

test('deleting a folder removes its whole subtree and closes tabs underneath', async () => {
    const { priv, host } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('src/c.todl', 'x')
    const op = await priv.addOpenProject(projectWithTree('C:/a'), fakeProjectFactory(), storage)
    const src = op.Root.Children.ToArray().find((n) => n.Kind === 'folder')!
    await priv.openNode(src.Children.ToArray()[0]!, op)   // open src/c.todl
    expect(host.OpenDocuments.Count).toBe(1)

    await priv.deleteNodes(op, [src])

    expect(await storage.Exists('src/c.todl')).toBe(false)
    expect(await storage.Exists('src')).toBe(false)
    expect(host.OpenDocuments.Count).toBe(0)
})

test('deleting one node of a multi-selection removes the whole selected set', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('a.todl', 'x')
    await storage.WriteText('b.todl', 'y')
    const op = await priv.addOpenProject(projectWithTree('C:/a'), fakeProjectFactory(), storage)
    const [a, b] = op.Root.Children.ToArray()
    op.SelectedNodes = [a!, b!]

    await priv.deleteFromNode(op, a!)   // right-clicked a, but b is selected too

    expect(await storage.Exists('a.todl')).toBe(false)
    expect(await storage.Exists('b.todl')).toBe(false)
})

test('a selection of a folder and a file inside it deletes without a double-removal error', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('src/c.todl', 'x')
    const op = await priv.addOpenProject(projectWithTree('C:/a'), fakeProjectFactory(), storage)
    const src = op.Root.Children.ToArray().find((n) => n.Kind === 'folder')!
    const child = src.Children.ToArray()[0]!

    await priv.deleteNodes(op, [src, child])

    expect(await storage.Exists('src')).toBe(false)
})

test('the Delete key deletes the selected node', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('core.todl', 'x')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)
    op.SelectedNode = childNode(op)

    const del = { Key: Key.Delete, Handled: false } as unknown as KeyEventArgs
    priv.handleTreeKey(op, del)
    await new Promise((r) => setTimeout(r, 0))   // let the fire-and-forget delete settle

    expect(await storage.Exists('core.todl')).toBe(false)
    expect(del.Handled).toBe(true)
})

test('the Delete key does nothing while a rename editor is open', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('core.todl', 'x')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)
    const node = childNode(op)
    priv.beginRename(op, node)   // editor open

    const del = { Key: Key.Delete, Handled: false } as unknown as KeyEventArgs
    priv.handleTreeKey(op, del)
    await new Promise((r) => setTimeout(r, 0))

    expect(await storage.Exists('core.todl')).toBe(true)   // not deleted
    expect(del.Handled).toBe(false)
})

test('deleting the project root is refused (no dialog, nothing removed)', async () => {
    const { priv, shownDialogs } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('core.todl', 'x')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.deleteNodes(op, [op.Root])   // root's Path is ''

    expect(shownDialogs.length).toBe(0)
    expect(await storage.Exists('core.todl')).toBe(true)
})

test('the delete confirmation names the file and labels the button "Delete"', async () => {
    const { priv, shownDialogs } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('core.todl', 'x')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.deleteNodes(op, [childNode(op)])

    expect(shownDialogs.length).toBe(1)
    const vm = shownDialogs[0] as ConfirmDialogModel
    expect(vm.Message).toContain('core.todl')
    expect(vm.ConfirmLabel).toBe('Delete')
})

test('ConfirmDialogModel resolves true on confirm and false on cancel', () => {
    let result: boolean | undefined
    const confirm = new ConfirmDialogModel('msg', 'Delete', (r) => { result = r })

    confirm.ConfirmCommand.Execute(undefined)
    expect(result).toBe(true)

    confirm.CancelCommand.Execute(undefined)
    expect(result).toBe(false)
})

test('moveNodes renames a file into a subfolder on storage', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/p')
    await storage.WriteText('a.todl', 'x')
    await storage.CreateDirectory('src')
    const op = await priv.addOpenProject(projectWith('P', 'C:/p'), fakeProjectFactory(), storage)
    await priv.moveNodes(op, [new ProjectNode('a.todl', 'a.todl', 'todl')], 'src')
    expect(await storage.Exists('src/a.todl')).toBe(true)
    expect(await storage.Exists('a.todl')).toBe(false)
})

test('moveNodes skips a name collision, leaving both paths intact', async () => {
    const { priv, service } = makeExplorer()
    const storage = new FakeStorage('C:/p')
    await storage.WriteText('a.todl', 'x')
    await storage.WriteText('src/a.todl', 'y')
    const op = await priv.addOpenProject(projectWith('P', 'C:/p'), fakeProjectFactory(), storage)
    await priv.moveNodes(op, [new ProjectNode('a.todl', 'a.todl', 'todl')], 'src')
    expect(await storage.ReadText('a.todl')).toBe('x')        // not moved
    expect(await storage.ReadText('src/a.todl')).toBe('y')    // untouched
    expect(service.Status).toMatch(/exist/i)
})

test('moveNodes into the current parent is a silent no-op', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/p')
    await storage.WriteText('src/a.todl', 'x')
    const op = await priv.addOpenProject(projectWith('P', 'C:/p'), fakeProjectFactory(), storage)
    await priv.moveNodes(op, [new ProjectNode('a.todl', 'src/a.todl', 'todl')], 'src')
    expect(await storage.Exists('src/a.todl')).toBe(true)
})

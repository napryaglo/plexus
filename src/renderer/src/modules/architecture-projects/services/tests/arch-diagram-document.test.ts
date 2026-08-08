import { test, expect } from 'vitest'
import { ObservableCollection, ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { Figure, ConnectorEndpoint } from '@pragmatic-lab/mural/framework'
import { check, checkAgainst, toJSON } from '@pragmatic-lab/todl'

import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { META_MODELS_BACKEND_ID } from '../../../meta-model/services/meta-models-backend.js'
import { LIBRARIES_BACKEND_ID } from '../../../library/services/libraries-backend.js'
import { ProjectExplorerService } from '../../../project-explorer/services/project-explorer-service.js'
import { WorkspaceBaseResolver } from '../../../../services/projects/workspace-base-resolver.js'
import { LibraryRegistry } from '../../../library/services/library-registry.js'
import { TodlVisualResolverKey } from '../../../diagram/services/todl-visual-resolver.js'
import { ArchDiagramDocumentFactory } from '../arch-diagram-document-factory.js'
import { ArchDiagramDocument } from '../arch-diagram-document.js'
import { InstanceNodeVM } from '../instance-node-vm.js'

async function openNew(provider: ServiceProvider, project: FakeStorage): Promise<ArchDiagramDocument> {
    const f = new ArchDiagramDocumentFactory(provider)
    const path = await f.newFile(project, 'system')
    return await f.openFile(project, path) as ArchDiagramDocument
}

// A provider whose meta-models + libraries backends hold a published EA meta-model
// and a technology library, plus a project whose manifest binds them.
function env(): { provider: ServiceProvider; project: FakeStorage } {
    const provider = new ServiceProvider()
    const reg = new StorageProviderRegistry(provider)
    const meta = new FakeStorage('fake://meta-models')
    const libs = new FakeStorage('fake://libraries')
    reg.Register(META_MODELS_BACKEND_ID, () => meta)
    reg.Register(LIBRARIES_BACKEND_ID, () => libs)
    provider.registerInstance(StorageProviderRegistry.Key, reg)

    const metaDoc = toJSON(check([{ uri: 'ea.todl', text: 'namespace ea { concept Technology { label : string; } concept Component { label : string; realisedBy : Technology?; } }' }]).model)
    void meta.WriteText('ea/1/model.json', JSON.stringify(metaDoc))
    const libDoc = toJSON(checkAgainst([metaDoc], [{ uri: 'ms.todl', text: 'namespace ms { taxonomy Stack : represents Technology { Technology AzureOpenai { label = "Azure OpenAI"; } } }' }]).model)
    void libs.WriteText('ms/1/model.json', JSON.stringify(libDoc))

    const project = new FakeStorage('fake://proj')
    void project.WriteText('project.plexus', JSON.stringify({ type: 'architecture', name: 'Proj', metaModel: { id: 'ea', version: '1' }, libraries: [{ id: 'ms', version: '1' }] }))
    // No producer projects are open, so the resolver falls back to the published
    // backends set up above (its behavior when nothing local matches).
    provider.registerInstance(ProjectExplorerService.Key, { OpenProjects: new ObservableCollection() } as unknown as ProjectExplorerService)
    provider.registerInstance(WorkspaceBaseResolver.Key, new WorkspaceBaseResolver(provider))
    // A published library bundle defining a visual for the term the tests reference,
    // so the LibraryRegistry can lazily compile it for canvas nodes.
    void libs.WriteText('viz/0.1.0/library.json', JSON.stringify({
        id: 'viz', version: '0.1.0', name: 'Viz', metaModel: { id: 'ea', version: '1' },
        classes: [{ id: 'Stack.AzureOpenai', localId: 'AzureOpenai', label: 'Azure OpenAI', concept: 'Technology', template: 'visuals/x.mural' }],
        assets: [], docs: [], samples: [],
    }))
    void libs.WriteText('viz/0.1.0/visuals/x.mural', 'TextBlock [ Text = $Display ]')
    provider.registerInstance(LibraryRegistry.Key, new LibraryRegistry(provider))
    return { provider, project }
}

test('newFile then Save writes a .archdiagram + sibling .todl; open restores model + layout', async () => {
    const { provider, project } = env()
    const f = new ArchDiagramDocumentFactory(provider)
    const path = await f.newFile(project, 'system')
    const doc = await f.openFile(project, path) as ArchDiagramDocument

    const id = doc.Model.createInstance('Component')
    doc.Model.setField(id, 'label', 'Gateway')
    doc.Model.addRelationship(id, 'realisedBy', 'Stack.AzureOpenai')
    doc.SetLayout(id, 120, 80)
    await f.saveFile(doc)

    expect(await project.Exists('system.archdiagram')).toBe(true)
    const todl = await project.ReadText('system.todl')
    expect(todl).toContain('Component ')
    expect(todl).toContain('realisedBy = Stack.AzureOpenai;')
    const layout = JSON.parse(await project.ReadText('system.archdiagram'))
    expect(layout.layout[id]).toEqual({ x: 120, y: 80 })

    const reopened = await f.openFile(project, path) as ArchDiagramDocument
    expect(reopened.Model.ownInstances()).toEqual([id])
    expect(reopened.LayoutOf(id)).toEqual({ x: 120, y: 80 })
})

// ── DiagramMutator: the surface the base Diagram auto-wires from DataContext ──

test('CreateNode drops a term into a positioned concept instance referencing it', async () => {
    const { provider, project } = env()
    const doc = await openNew(provider, project)

    const node = doc.CreateNode('Stack.AzureOpenai', 40, 60) as InstanceNodeVM
    expect(node).toBeInstanceOf(InstanceNodeVM)
    expect(node.Concept).toBe('Component')
    expect(node.ReferencedTerm).toBe('Stack.AzureOpenai')
    expect(node.Left).toBe(40)
    expect(node.Top).toBe(60)
    expect(doc.Nodes.Count).toBe(1)
    expect(doc.Model.document.edges.some((e) => e.kind === 'Relationship' && e.from === node.Id && e.to === 'Stack.AzureOpenai')).toBe(true)
})

test('CreateNode returns null for a term nothing can reference (no node created)', async () => {
    const { provider, project } = env()
    const doc = await openNew(provider, project)
    expect(doc.CreateNode('nonexistent.term', 0, 0)).toBeNull()
    expect(doc.Nodes.Count).toBe(0)
})

test('CreateConnector maps endpoint Figures to node ids and sets the reference member', async () => {
    const { provider, project } = env()
    const doc = await openNew(provider, project)

    const compId = doc.Model.createInstance('Component')
    const techId = doc.Model.createInstance('Technology')
    const compVm = doc.AddNode(compId)
    const techVm = doc.AddNode(techId)
    const src = new Figure(); src.Content = compVm
    const tgt = new Figure(); tgt.Content = techVm

    doc.CreateConnector(new ConnectorEndpoint({ Node: src }), new ConnectorEndpoint({ Node: tgt }))
    expect(doc.Model.document.edges.some((e) => e.kind === 'Relationship' && e.from === compId && e.to === techId)).toBe(true)
})

test('DeleteNodes removes the instance from the model and its node from the canvas', async () => {
    const { provider, project } = env()
    const doc = await openNew(provider, project)

    const node = doc.CreateNode('Stack.AzureOpenai', 10, 10) as InstanceNodeVM
    expect(doc.Nodes.Count).toBe(1)
    doc.DeleteNodes([node])
    expect(doc.Nodes.Count).toBe(0)
    expect(doc.Model.ownInstances()).toEqual([])
})

test('a dropped node carries a library-class descriptor keyed on its term', async () => {
    const { provider, project } = env()
    const doc = await openNew(provider, project)

    // The node's visual now flows through its Descriptor + ToolboxVisualPresenter
    // (which owns the lazy-compile upgrade via the resolver's changed signal); the
    // document no longer resolves or upgrades templates itself.
    const node = doc.CreateNode('Stack.AzureOpenai', 10, 10) as InstanceNodeVM
    expect(node.Descriptor?.ResolverKey).toBe(TodlVisualResolverKey)
    expect(node.Descriptor?.Key).toBe('Stack.AzureOpenai')
})

import { test, expect } from 'vitest'
import { ObservableCollection, ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { check, checkAgainst, toJSON } from '@pragmatic-lab/todl'

import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { META_MODELS_BACKEND_ID } from '../../../meta-model/services/meta-models-backend.js'
import { LIBRARIES_BACKEND_ID } from '../../../library/services/libraries-backend.js'
import { ProjectExplorerService } from '../../../project-explorer/services/project-explorer-service.js'
import { WorkspaceBaseResolver } from '../../../../services/projects/workspace-base-resolver.js'
import { ArchDiagramDocumentFactory } from '../arch-diagram-document-factory.js'
import { ArchDiagramDocument } from '../arch-diagram-document.js'
import { ArchInstanceModel } from '../architecture-instance-model.js'
import { applyTermDrop, applyConnect } from '../arch-canvas-ops.js'

function env(): { provider: ServiceProvider; project: FakeStorage } {
    const provider = new ServiceProvider()
    const reg = new StorageProviderRegistry(provider)
    const meta = new FakeStorage('fake://meta-models')
    const libs = new FakeStorage('fake://libraries')
    reg.Register(META_MODELS_BACKEND_ID, () => meta)
    reg.Register(LIBRARIES_BACKEND_ID, () => libs)
    provider.registerInstance(StorageProviderRegistry.Key, reg)
    const metaDoc = toJSON(check([{ uri: 'ea.todl', text: 'namespace ea { concept technology { label : string; } concept component { label : string; realised-by : technology?; } }' }]).model)
    void meta.WriteText('ea/1/model.json', JSON.stringify(metaDoc))
    const libDoc = toJSON(checkAgainst([metaDoc], [{ uri: 'ms.todl', text: 'namespace ms { taxonomy stack : represents technology { technology azure-openai { label = "Azure OpenAI"; } } }' }]).model)
    void libs.WriteText('ms/1/model.json', JSON.stringify(libDoc))
    const project = new FakeStorage('fake://proj')
    void project.WriteText('project.plexus', JSON.stringify({ type: 'architecture', name: 'Proj', metaModel: { id: 'ea', version: '1' }, libraries: [{ id: 'ms', version: '1' }] }))
    // No producer projects are open, so the resolver falls back to the published
    // backends set up above (its behavior when nothing local matches).
    provider.registerInstance(ProjectExplorerService.Key, { OpenProjects: new ObservableCollection() } as unknown as ProjectExplorerService)
    provider.registerInstance(WorkspaceBaseResolver.Key, new WorkspaceBaseResolver(provider))
    return { provider, project }
}

async function doc(): Promise<ArchDiagramDocument> {
    const { provider, project } = env()
    const f = new ArchDiagramDocumentFactory(provider)
    const path = await f.newFile(project, 'system')
    return await f.openFile(project, path) as ArchDiagramDocument
}

test('applyTermDrop creates a concept instance referencing the term, positioned + node added', async () => {
    const d = await doc()
    const result = applyTermDrop(d, 'stack.azure-openai', 200, 140)
    expect('created' in result).toBe(true)
    const id = (result as { created: string }).created
    expect(d.Model.ownInstances()).toEqual([id])
    expect(d.LayoutOf(id)).toEqual({ x: 200, y: 140 })
    expect(d.Nodes.Count).toBe(1)
    expect(d.Model.emit()).toContain('realised-by = stack.azure-openai;')
})

test('applyTermDrop is unresolved and mutates nothing when no concept can reference the term', async () => {
    const d = await doc()
    expect(applyTermDrop(d, 'unknown.term', 0, 0)).toEqual({ unresolved: true })
    expect(d.Model.ownInstances()).toEqual([])   // no instance created
    expect(d.Nodes.Count).toBe(0)                 // no node added
})

test('CreateNode on an out-of-scope term returns null and warns (graceful no-op)', async () => {
    const d = await doc()
    const warnings: string[] = []
    const original = console.warn
    console.warn = (...args: unknown[]): void => { warnings.push(String(args[0])) }
    try {
        expect(d.CreateNode('unknown.term', 0, 0)).toBe(null)
    } finally {
        console.warn = original
    }
    expect(d.Nodes.Count).toBe(0)
    expect(warnings.some((w) => w.includes('unknown.term') && w.includes('scope'))).toBe(true)
})

test('applyConnect sets the reference member linking two nodes', () => {
    // A minimal model: a component and a technology term to connect it to.
    const metaDoc = toJSON(check([{ uri: 'ea.todl', text: 'namespace ea { concept technology { label : string; } concept component { label : string; realised-by : technology?; } }' }]).model)
    const libDoc = toJSON(checkAgainst([metaDoc], [{ uri: 'ms.todl', text: 'namespace ms { taxonomy stack : represents technology { technology azure-openai { label = "Azure OpenAI"; } } }' }]).model)
    const model = ArchInstanceModel.load([metaDoc, libDoc], '', 'app')
    const from = model.createInstance('component')

    expect(applyConnect(model, from, 'stack.azure-openai')).toBe('ok')
    expect(model.emit()).toContain('realised-by = stack.azure-openai;')
    expect(applyConnect(model, from, 'nope.nope')).toBe('none')
})

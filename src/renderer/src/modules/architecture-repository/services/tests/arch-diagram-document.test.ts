import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { check, checkAgainst, toJSON } from '@pragmatic-lab/todl'

import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { META_MODELS_BACKEND_ID } from '../../../meta-model/services/meta-models-backend.js'
import { LIBRARIES_BACKEND_ID } from '../../../library/services/libraries-backend.js'
import { ArchDiagramDocumentFactory } from '../arch-diagram-document-factory.js'
import { ArchDiagramDocument } from '../arch-diagram-document.js'

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

    const metaDoc = toJSON(check([{ uri: 'ea.todl', text: 'namespace ea { concept technology { label : string; } concept component { label : string; realised-by : technology?; } }' }]).model)
    void meta.WriteText('ea/1/model.json', JSON.stringify(metaDoc))
    const libDoc = toJSON(checkAgainst([metaDoc], [{ uri: 'ms.todl', text: 'namespace ms { taxonomy stack : represents technology { technology azure-openai { label = "Azure OpenAI"; } } }' }]).model)
    void libs.WriteText('ms/1/model.json', JSON.stringify(libDoc))

    const project = new FakeStorage('fake://proj')
    void project.WriteText('project.plexus', JSON.stringify({ type: 'architecture', name: 'Proj', metaModel: { id: 'ea', version: '1' }, libraries: [{ id: 'ms', version: '1' }] }))
    return { provider, project }
}

test('newFile then Save writes a .archdiagram + sibling .todl; open restores model + layout', async () => {
    const { provider, project } = env()
    const f = new ArchDiagramDocumentFactory(provider)
    const path = await f.newFile(project, 'system')
    const doc = await f.openFile(project, path) as ArchDiagramDocument

    const id = doc.Model.createInstance('component')
    doc.Model.setField(id, 'label', 'Gateway')
    doc.Model.addRelationship(id, 'realised-by', 'stack.azure-openai')
    doc.SetLayout(id, 120, 80)
    await f.saveFile(doc)

    expect(await project.Exists('system.archdiagram')).toBe(true)
    const todl = await project.ReadText('system.todl')
    expect(todl).toContain('component ')
    expect(todl).toContain('realised-by = &stack.azure-openai;')
    const layout = JSON.parse(await project.ReadText('system.archdiagram'))
    expect(layout.layout[id]).toEqual({ x: 120, y: 80 })

    const reopened = await f.openFile(project, path) as ArchDiagramDocument
    expect(reopened.Model.ownInstances()).toEqual([id])
    expect(reopened.LayoutOf(id)).toEqual({ x: 120, y: 80 })
})

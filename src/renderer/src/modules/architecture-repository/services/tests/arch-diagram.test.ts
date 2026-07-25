import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { Figure } from '@pragmatic-lab/mural/framework'
import { check, checkAgainst, toJSON } from '@pragmatic-lab/todl'

import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { LIBRARIES_BACKEND_ID } from '../../../library/services/libraries-backend.js'
import { LibraryRegistry } from '../../../library/services/library-registry.js'
import { ArchInstanceModel } from '../architecture-instance-model.js'
import { ArchDiagramDocument } from '../arch-diagram-document.js'
import { ArchDiagram } from '../arch-diagram.js'

function registry(): LibraryRegistry {
    const provider = new ServiceProvider()
    const reg = new StorageProviderRegistry(provider)
    reg.Register(LIBRARIES_BACKEND_ID, () => new FakeStorage('fake://libraries'))
    provider.registerInstance(StorageProviderRegistry.Key, reg)
    return new LibraryRegistry(provider)
}

test('GetContainerForItemOverride builds a Figure carrying the VM, its resolved template, and its saved position', () => {
    const metaDoc = toJSON(check([{ uri: 'ea.todl', text: 'namespace ea { concept technology { label : string; } concept component { label : string; realised-by : technology?; } }' }]).model)
    const libDoc = toJSON(checkAgainst([metaDoc], [{ uri: 'ms.todl', text: 'namespace ms { taxonomy stack : represents technology { technology azure-openai { label = "Azure OpenAI"; } } }' }]).model)
    const model = ArchInstanceModel.load([metaDoc, libDoc], '', 'app')
    const id = model.createInstance('component')
    model.addRelationship(id, 'realised-by', 'stack.azure-openai')

    const reg = registry()
    const doc = new ArchDiagramDocument('sys.archdiagram', model, new FakeStorage('fake://proj'), 'sys.todl', { [id]: { x: 10, y: 20 } }, 'Sys', reg)
    const vm = doc.Nodes.Get(0)!

    const ad = new ArchDiagram()
    ad.Document = doc
    const fig = ad.GetContainerForItemOverride(vm) as Figure

    expect(fig).toBeInstanceOf(Figure)
    expect(fig.Content).toBe(vm)
    expect(vm.Template).toBe(reg.resolve('stack.azure-openai', 'component'))
    expect(fig.Left).toBe(10)
    expect(fig.Top).toBe(20)
    expect(fig.Id).toBe(id)
})

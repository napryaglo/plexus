import { test, expect } from 'vitest'
import { DataObject, ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { Figure, TOOLBOX_NODE_KIND_FORMAT, type ItemDroppedArgs, type ConnectorCreatedArgs } from '@pragmatic-lab/mural/framework'
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

test('OnTermDropped reads the term id off the drop payload and creates a referencing node', () => {
    const metaDoc = toJSON(check([{ uri: 'ea.todl', text: 'namespace ea { concept technology { label : string; } concept component { label : string; realised-by : technology?; } }' }]).model)
    const libDoc = toJSON(checkAgainst([metaDoc], [{ uri: 'ms.todl', text: 'namespace ms { taxonomy stack : represents technology { technology azure-openai { label = "Azure OpenAI"; } } }' }]).model)
    const model = ArchInstanceModel.load([metaDoc, libDoc], '', 'app')

    const doc = new ArchDiagramDocument('sys.archdiagram', model, new FakeStorage('fake://proj'), 'sys.todl', {}, 'Sys', registry())
    const ad = new ArchDiagram()
    ad.Document = doc

    const data = new DataObject().Set(TOOLBOX_NODE_KIND_FORMAT, 'stack.azure-openai')
    ad.OnTermDropped({ Data: data, Position: { X: 40, Y: 60 } } as unknown as ItemDroppedArgs)

    expect(model.ownInstances().length).toBe(1)
    const created = model.ownInstances()[0]
    expect(model.node(created)!.typeOf).toBe('component')
    expect(model.document.edges.some((e) => e.kind === 'Relationship' && e.from === created && e.to === 'stack.azure-openai')).toBe(true)
    expect(doc.LayoutOf(created)).toEqual({ x: 40, y: 60 })
    expect(doc.Nodes.Count).toBe(1)
})

test('OnConnectorCreated maps the endpoint Figures to node ids and sets the reference member', () => {
    const metaDoc = toJSON(check([{ uri: 'ea.todl', text: 'namespace ea { concept technology { label : string; } concept component { label : string; realised-by : technology?; } }' }]).model)
    const model = ArchInstanceModel.load([metaDoc], '', 'app')
    const compId = model.createInstance('component')
    const techId = model.createInstance('technology')

    const doc = new ArchDiagramDocument('sys.archdiagram', model, new FakeStorage('fake://proj'), 'sys.todl', {}, 'Sys', registry())
    const compVm = doc.Nodes.ToArray().find((v) => v.Id === compId)!
    const techVm = doc.Nodes.ToArray().find((v) => v.Id === techId)!

    const ad = new ArchDiagram()
    ad.Document = doc
    const src = new Figure(); src.Content = compVm
    const tgt = new Figure(); tgt.Content = techVm
    ad.OnConnectorCreated({ Source: { Node: src }, Target: { Node: tgt } } as unknown as ConnectorCreatedArgs)

    expect(model.document.edges.some((e) => e.kind === 'Relationship' && e.from === compId && e.to === techId)).toBe(true)
})

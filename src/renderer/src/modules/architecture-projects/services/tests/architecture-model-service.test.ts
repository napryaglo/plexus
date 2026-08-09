import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { load, toJSON, type TodlDocument } from '@pragmatic-lab/todl'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { WorkspaceBaseResolver } from '../../../../services/projects/workspace-base-resolver.js'
import { Project, ProjectNode } from '../../../../services/projects/project.js'
import type { OpenProject } from '../../../project-explorer/services/open-project.js'
import { ArchitectureModelService } from '../architecture-model-service.js'

const MM = `namespace archmm {
  concept Component {}
  concept Node {}
  viewpoint ComponentView : frames Component
  viewpoint DeploymentView : frames Node, Component
}`

// A fake OpenProject: only .Project + .Storage are read by the service.
function fakeOpenProject(storage: FakeStorage): OpenProject {
    const project = new Project('architecture', 'Acme', storage.Root, new ProjectNode('Acme', '', 'folder'))
    return { Project: project, Storage: storage } as unknown as OpenProject
}

// A provider whose WorkspaceBaseResolver returns the meta-model as the base doc.
function providerWithBase(baseDoc: TodlDocument): ServiceProvider {
    const provider = new ServiceProvider()
    provider.registerInstance(WorkspaceBaseResolver.Key, {
        ResolveForStorage: async () => ({ bases: [baseDoc], problems: [] }),
    } as unknown as WorkspaceBaseResolver)
    return provider
}

async function seededStorage(): Promise<FakeStorage> {
    const storage = new FakeStorage('fake://Acme')
    await storage.WriteText('model-a.todl', `namespace archmm {\n  model Arch : archmm conforms ComponentView { Component web {} }\n}`)
    await storage.WriteText('model-b.todl', `namespace archmm {\n  model Arch : archmm conforms DeploymentView { Node host {} }\n}`)
    return storage
}

function baseDoc(): TodlDocument {
    return toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
}

test('modelFor composes bases + all .todl files into one ArchModel', async () => {
    const service = new ArchitectureModelService(providerWithBase(baseDoc()))
    const model = await service.modelFor(fakeOpenProject(await seededStorage()))
    expect(model.namespace).toBe('archmm')
    expect(model.entities().map((e) => e.id).sort()).toEqual(['host', 'web'])
    expect(model.viewpoints().map((v) => v.id).sort()).toEqual(['ComponentView', 'DeploymentView'])
})

test('modelFor is idempotent — a second call returns the cached instance', async () => {
    const service = new ArchitectureModelService(providerWithBase(baseDoc()))
    const op = fakeOpenProject(await seededStorage())
    const first = await service.modelFor(op)
    const second = await service.modelFor(op)
    expect(second).toBe(first)
})

test('peek returns the cached model; close drops it', async () => {
    const service = new ArchitectureModelService(providerWithBase(baseDoc()))
    const op = fakeOpenProject(await seededStorage())
    await service.modelFor(op)
    expect(service.peek(op.Project.RootPath)).toBeDefined()
    service.close(op.Project.RootPath)
    expect(service.peek(op.Project.RootPath)).toBeUndefined()
})

test('namespace derives from the first .todl file', async () => {
    const service = new ArchitectureModelService(providerWithBase(baseDoc()))
    const model = await service.modelFor(fakeOpenProject(await seededStorage()))
    expect(model.namespace).toBe('archmm')
})

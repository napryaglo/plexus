import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'

import { PROJECT_MANIFEST_FILENAME } from '../../../../services/projects/project-factory.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { ArchitectureProjectFactory } from '../architecture-project-factory.js'

function factory(): ArchitectureProjectFactory
{
    return new ArchitectureProjectFactory(new ServiceProvider())
}

test('createProject writes an architecture manifest and returns the project', async () => {
    const storage = new FakeStorage('fake://Acme')
    const project = await factory().createProject(storage, 'Acme')

    expect(project.Type).toBe('architecture')
    expect(project.Name).toBe('Acme')
    const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
    expect(manifest.type).toBe('architecture')
    expect(manifest.name).toBe('Acme')
})

test('openProject scans storage into a tree, hiding the manifest', async () => {
    const storage = new FakeStorage()
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'architecture', name: 'P' }))
    await storage.WriteText('diagrams/city.diagram', '{}')
    await storage.WriteText('notes.txt', 'hi')

    const project = await factory().openProject(storage)
    const names = project.Root.Children.ToArray().map((n) => n.Name)
    expect(names).toContain('diagrams')
    expect(names).toContain('notes.txt')
    expect(names).not.toContain(PROJECT_MANIFEST_FILENAME)

    const diagramsFolder = project.Root.Children.ToArray().find((n) => n.Name === 'diagrams')!
    expect(diagramsFolder.Kind).toBe('folder')
    const cityDiagram = diagramsFolder.Children.ToArray()[0]
    expect(cityDiagram.Kind).toBe('diagram')
    expect(cityDiagram.Path).toBe('diagrams/city.diagram')   // project-relative
    const notes = project.Root.Children.ToArray().find((n) => n.Name === 'notes.txt')!
    expect(notes.Kind).toBe('file')
})

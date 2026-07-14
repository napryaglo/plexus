import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'

import { PROJECT_MANIFEST_FILENAME } from '../../../../services/projects/project-factory.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { DiagramProjectFactory } from '../diagram-project-factory.js'

// The factory's storage-facing behavior, exercised against a FakeStorage — the
// whole point of the abstraction: no Electron, no disk, real read/write/list.

function factory(): DiagramProjectFactory
{
    return new DiagramProjectFactory(new ServiceProvider())
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

test('newFile returns a project-relative .diagram path and writes an empty scene', async () => {
    const storage = new FakeStorage()
    const path = await factory().newFile(storage, 'diagram', 'city')
    expect(path).toBe('city.diagram')
    expect(await storage.Exists('city.diagram')).toBe(true)
})

test('openFile round-trips a diagram written by newFile, titled by basename', async () => {
    const storage = new FakeStorage()
    const f = factory()
    const path = await f.newFile(storage, 'diagram', 'city')
    const doc = await f.openFile(storage, path)
    expect(doc.Title).toBe('city.diagram')
})

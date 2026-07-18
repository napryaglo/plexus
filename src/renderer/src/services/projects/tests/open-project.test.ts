import { test, expect } from 'vitest'
import { RelayCommand } from '@pragmatic-lab/mural/runtime'

import { Project, ProjectNode } from '../project.js'
import { OpenProject } from '../open-project.js'
import type { IProjectFactory } from '../project-factory.js'
import type { IStorage } from '../storage/storage.js'

const fakeFactory = { formats: [] } as unknown as IProjectFactory
const fakeStorage = { Root: 'C:/proj' } as unknown as IStorage

function project(): Project
{
    return new Project('meta-model', 'Acme', 'C:/proj', new ProjectNode('proj', '', 'folder'))
}

test('exposes Name/Root/Folder from the project and the given factory/storage', () => {
    const p = project()
    const op = new OpenProject(p, fakeFactory, fakeStorage)
    expect(op.Name).toBe('Acme')
    expect(op.Root).toBe(p.Root)
    expect(op.Folder).toBe('C:/proj')
    expect(op.Factory).toBe(fakeFactory)
    expect(op.Storage).toBe(fakeStorage)
})

test('command DPs are settable and gettable', () => {
    const op = new OpenProject(project(), fakeFactory, fakeStorage)
    expect(op.NewFileCommand).toBeUndefined()
    const cmd = new RelayCommand(() => {})
    op.NewFileCommand = cmd
    op.PublishCommand = cmd
    op.CloseCommand = cmd
    expect(op.NewFileCommand).toBe(cmd)
    expect(op.PublishCommand).toBe(cmd)
    expect(op.CloseCommand).toBe(cmd)
})

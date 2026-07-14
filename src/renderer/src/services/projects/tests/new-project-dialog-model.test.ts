import { test, expect } from 'vitest'

import type { FileSystemService } from '../../file-system/file-system-service.js'
import {
    NewProjectDialogModel,
    ProjectTypeChoice,
    type NewProjectResult,
} from '../new-project-dialog-model.js'

const flush = () => new Promise((r) => setTimeout(r, 0))

function choices(): ProjectTypeChoice[]
{
    return [
        new ProjectTypeChoice('architecture', 'Architecture Project', 'A node-and-connector model.'),
        new ProjectTypeChoice('flow', 'Flow Project', 'A flow model.'),
    ]
}

// A FileSystemService stub whose OpenFolder returns a preset folder (or null).
function stubFs(folder: string | null): FileSystemService
{
    return { OpenFolder: () => Promise.resolve(folder) } as unknown as FileSystemService
}

function build(opts: { fs?: FileSystemService; validate?: (r: NewProjectResult) => Promise<string | null> } = {})
{
    let result: NewProjectResult | undefined | 'uncalled' = 'uncalled'
    const vm = new NewProjectDialogModel(
        choices(),
        opts.fs ?? stubFs('/picked'),
        opts.validate ?? (() => Promise.resolve(null)),
        (r) => { result = r },
    )
    return { vm, closed: () => result }
}

test('defaults to the first type, marked selected', () => {
    const { vm } = build()
    expect(vm.SelectedType?.Type).toBe('architecture')
    expect(vm.Types.ToArray().map((c) => c.Marker)).toEqual(['●', '○'])
})

test('selecting a type moves the marker and SelectedType', () => {
    const { vm } = build()
    vm.Types.ToArray()[1].SelectCommand!.Execute(undefined)
    expect(vm.SelectedType?.Type).toBe('flow')
    expect(vm.Types.ToArray().map((c) => c.Marker)).toEqual(['○', '●'])
})

test('CanConfirm requires a name and a location', () => {
    const { vm } = build()
    expect(vm.CanConfirm).toBe(false)
    vm.Name = 'Acme'
    expect(vm.CanConfirm).toBe(false)
    vm.Location = '/work/acme'
    expect(vm.CanConfirm).toBe(true)
})

test('Browse sets the location from the folder picker', async () => {
    const { vm } = build({ fs: stubFs('/work/acme') })
    vm.BrowseCommand.Execute(undefined)
    await flush()
    expect(vm.Location).toBe('/work/acme')
})

test('confirm blocked by validation shows the error and does not close', async () => {
    const { vm, closed } = build({ validate: () => Promise.resolve('Folder already contains a project.') })
    vm.Name = 'Acme'
    vm.Location = '/work/acme'
    vm.ConfirmCommand.Execute(undefined)
    await flush()
    expect(vm.Error).toBe('Folder already contains a project.')
    expect(closed()).toBe('uncalled')
})

test('confirm success closes with the result', async () => {
    const { vm, closed } = build()
    vm.Name = '  Acme  '
    vm.Location = '/work/acme'
    vm.Types.ToArray()[1].SelectCommand!.Execute(undefined)
    vm.ConfirmCommand.Execute(undefined)
    await flush()
    expect(closed()).toEqual({ type: 'flow', name: 'Acme', location: '/work/acme' })
})

test('cancel closes with undefined', () => {
    const { vm, closed } = build()
    vm.CancelCommand.Execute(undefined)
    expect(closed()).toBeUndefined()
})

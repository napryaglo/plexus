import { test, expect } from 'vitest'

import type { BaseRef } from '../base-binding.js'
import { AddLibraryReferenceDialogModel } from '../add-library-reference-dialog-model.js'

function build(addable: BaseRef[])
{
    let result: readonly BaseRef[] | undefined | 'uncalled' = 'uncalled'
    const vm = new AddLibraryReferenceDialogModel(addable, (r) => { result = r })
    return { vm, closed: () => result }
}

const ms: BaseRef = { id: 'microsoft', version: '0.1.0' }
const aws: BaseRef = { id: 'aws', version: '0.2.0' }

test('lists every addable library as a row, none checked initially', () => {
    const { vm } = build([ms, aws])
    expect(vm.Libraries.ToArray().map((l) => l.Ref)).toEqual([ms, aws])
    expect(vm.SelectedLibraries).toEqual([])
    expect(vm.CanConfirm).toBe(false)
    expect(vm.EmptyLabel).toBe('')
})

test('checking a row enables confirm and includes it in the result', () => {
    const { vm, closed } = build([ms, aws])
    vm.Libraries.ToArray()[0].IsSelected = true
    expect(vm.CanConfirm).toBe(true)
    expect(vm.SelectedLibraries).toEqual([ms])

    vm.ConfirmCommand.Execute(undefined)
    expect(closed()).toEqual([ms])
})

test('cancel closes with undefined (no binding added)', () => {
    const { vm, closed } = build([ms])
    vm.CancelCommand.Execute(undefined)
    expect(closed()).toBeUndefined()
})

test('no addable libraries shows guidance and keeps confirm disabled', () => {
    const { vm } = build([])
    expect(vm.Libraries.Count).toBe(0)
    expect(vm.EmptyLabel).toBe('Every published library is already referenced.')
    expect(vm.CanConfirm).toBe(false)
})

test('unchecking the last row disables confirm again', () => {
    const { vm } = build([ms])
    const row = vm.Libraries.ToArray()[0]
    row.IsSelected = true
    expect(vm.CanConfirm).toBe(true)
    row.IsSelected = false
    expect(vm.CanConfirm).toBe(false)
    expect(vm.SelectedLibraries).toEqual([])
})

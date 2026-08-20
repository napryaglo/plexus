import { test, expect, beforeAll } from 'vitest'
import { Application } from '@pragmatic-lab/mural/runtime'
import { ToolboxVisualDescriptor } from '@pragmatic-lab/mural/framework'
import { ArchNodeVM } from '../arch-node-vm.js'

beforeAll(() => {
    Application.current = null
    new Application()
})

test('default Label is empty string', () => {
    const vm = new ArchNodeVM()
    expect(vm.Label).toBe('')
})

test('default Descriptor is undefined', () => {
    const vm = new ArchNodeVM()
    expect(vm.Descriptor).toBeUndefined()
})

test('carries no geometry — the container Figure owns it', () => {
    const vm = new ArchNodeVM() as unknown as Record<string, unknown>
    // Geometry (position/size + sizing mode) moved to the container Figure +
    // the document's NodeVisualStore; the VM is content + Id only.
    for (const prop of ['Left', 'Top', 'Width', 'Height', 'SizeToContent', 'UserSized']) {
        expect(vm[prop], `${prop} must not exist on a content VM`).toBeUndefined()
    }
})

test('IconSize is seeded from the shape-default-size setting', () => {
    const vm = new ArchNodeVM()
    expect(vm.IconSize).toBeGreaterThan(0)
})

test('Label setter round-trips', () => {
    const vm = new ArchNodeVM()
    vm.Label = 'My Component'
    expect(vm.Label).toBe('My Component')
})

test('Descriptor setter round-trips', () => {
    const vm = new ArchNodeVM()
    const desc = new ToolboxVisualDescriptor({} as any, 'some-key')
    vm.Descriptor = desc
    expect(vm.Descriptor).toBe(desc)
})

test('Id setter round-trips and EntityId returns Id', () => {
    const vm = new ArchNodeVM()
    vm.Id = 'entity-42'
    expect(vm.Id).toBe('entity-42')
    expect(vm.EntityId).toBe('entity-42')
})

test('EntityId equals Id (default undefined)', () => {
    const vm = new ArchNodeVM()
    expect(vm.EntityId).toBe(vm.Id)
})

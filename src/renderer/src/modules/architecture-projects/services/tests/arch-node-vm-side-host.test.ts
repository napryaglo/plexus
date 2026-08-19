import { test, expect } from 'vitest'
import { PortSide } from '@pragmatic-lab/mural/framework'
import { ArchNodeVM } from '../arch-node-vm.js'

// Regression: connector side-slot behavior differed between shapes and arch
// items because ArchNodeVM did not implement the side-endpoint host surface
// (ISideEndpointHost) that a shape Figure has. The connector gates side-slot
// registration on a duck-typed `GetSideSlot` method (asSideSlotHost); without
// it, endpoints anchored to an arch item never join the side distribution.

test('ArchNodeVM is a side-endpoint host (has GetSideSlot)', () => {
    const vm = new ArchNodeVM()
    expect(typeof (vm as unknown as { GetSideSlot?: unknown }).GetSideSlot).toBe('function')
})

test('ArchNodeVM exposes bounding-box ports', () => {
    const vm = new ArchNodeVM()
    const ports = (vm as unknown as { Ports?: readonly unknown[] }).Ports
    expect(Array.isArray(ports)).toBe(true)
    expect(ports!.length).toBe(4) // one per cardinal side
})

test('ArchNodeVM reports a per-side endpoint count', () => {
    const vm = new ArchNodeVM()
    const host = vm as unknown as { GetSideEndpointCount(s: PortSide): number }
    expect(host.GetSideEndpointCount(PortSide.E)).toBe(0)
})

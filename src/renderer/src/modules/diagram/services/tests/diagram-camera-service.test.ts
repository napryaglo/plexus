import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { DiagramDocument, ContentHostService, Diagram } from '@pragmatic-lab/mural/framework'
import { ObservableCollection } from '@pragmatic-lab/mural/runtime'
import { DiagramCameraService } from '../diagram-camera-service.js'
import { writeCamera, readCamera, type DiagramCameraState } from '../../persistence/diagram-camera-store.js'

// A lightweight stand-in for the live Diagram control: it exposes only the
// camera surface the service touches (Camera getter, SetCamera, and per-key
// property-change listeners over the three camera DPs). Using a fake avoids
// having to mount the mural theme to construct a real Diagram under jsdom.
class FakeView {
    private state: DiagramCameraState = { zoom: 1, panX: 0, panY: 0 }
    private readonly listeners = new Map<unknown, Set<() => void>>()
    public get Camera(): DiagramCameraState { return this.state }
    public SetCamera(c: DiagramCameraState): void {
        this.state = { zoom: c.zoom, panX: c.panX, panY: c.panY }
        for (const key of [Diagram.ZoomKey, Diagram.PanXKey, Diagram.PanYKey]) {
            for (const fn of this.listeners.get(key) ?? []) fn()
        }
    }
    public AddPropertyChangedListener(key: unknown, fn: () => void): void {
        if (!this.listeners.has(key)) this.listeners.set(key, new Set())
        this.listeners.get(key)!.add(fn)
    }
    public RemovePropertyChangedListener(key: unknown, fn: () => void): void {
        this.listeners.get(key)?.delete(fn)
    }
}

function providerWith(host: unknown): { get(k: unknown): unknown; getRequired(k: unknown): unknown } {
    return {
        get: (k: unknown) => (k === ContentHostService.Key ? host : undefined),
        getRequired: (k: unknown) => (k === ContentHostService.Key ? host : undefined),
    }
}

function fakeHost() {
    const OpenDocuments = new ObservableCollection<unknown>()
    return { OpenDocuments } as unknown as { OpenDocuments: ObservableCollection<unknown> }
}

function publish(doc: DiagramDocument, view: FakeView): void {
    doc.ActiveView = view as unknown as Diagram
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

test('hydrates the published view from stored metadata without re-persisting', () => {
    const host = fakeHost()
    new DiagramCameraService(providerWith(host) as never, 500)

    const doc = new DiagramDocument()
    writeCamera(doc, { zoom: 2, panX: 10, panY: 20 })
    host.OpenDocuments.Add(doc)              // triggers the open-docs subscription

    const view = new FakeView()
    publish(doc, view)                        // publishes the view → hydrate

    expect(view.Camera).toEqual({ zoom: 2, panX: 10, panY: 20 })
    // Hydration must NOT schedule a persist (guarded): advancing time does not save.
    const save = vi.spyOn(doc, 'Save')
    vi.advanceTimersByTime(1000)
    expect(save).not.toHaveBeenCalled()
})

test('persists (debounced) when the view camera changes', () => {
    const host = fakeHost()
    new DiagramCameraService(providerWith(host) as never, 500)
    const doc = new DiagramDocument()
    host.OpenDocuments.Add(doc)
    const view = new FakeView()
    publish(doc, view)

    const save = vi.spyOn(doc, 'Save')
    view.SetCamera({ zoom: 3, panX: 5, panY: 6 })   // user zoom
    view.SetCamera({ zoom: 3, panX: 7, panY: 8 })   // and pan — coalesced
    expect(save).not.toHaveBeenCalled()             // still within the debounce window
    vi.advanceTimersByTime(500)
    expect(save).toHaveBeenCalledTimes(1)
    expect(readCamera(doc)).toEqual({ zoom: 3, panX: 7, panY: 8 })
})

test('stops persisting after the document closes', () => {
    const host = fakeHost()
    new DiagramCameraService(providerWith(host) as never, 500)
    const doc = new DiagramDocument()
    host.OpenDocuments.Add(doc)
    const view = new FakeView()
    publish(doc, view)

    const save = vi.spyOn(doc, 'Save')
    host.OpenDocuments.Remove(doc)                   // close → detach
    view.SetCamera({ zoom: 2, panX: 0, panY: 0 })
    vi.advanceTimersByTime(500)
    expect(save).not.toHaveBeenCalled()
})

# Diagram Zoom & Camera (SP2 — Plexus) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn on the mural `Diagram` camera in Plexus's `.diagram` editor, persist the camera (zoom + pan) per diagram, and give the host a zoom toolbar + keyboard shortcuts driving the camera command API mural exposes.

**Architecture:** SP1 shipped the whole camera engine in mural 0.7.0 (camera DPs, gestures via `CameraEnabled`, `ZoomIn/Out/Reset`/`Fit`/`FitToSelection` methods + command DPs, constant-size adorners). SP2 is host wiring only: (1) bump the dependency and set `CameraEnabled = true` on the canvas in markup so gestures light up; (2) persist the camera in the `.diagram` file's opaque `DiagramDocument.Metadata` slot — the exact mechanism the viewpoints store already uses — hydrating on open and writing (debounced) on camera change; (3) build a host zoom toolbar (a shell-region control binding the live view's command DPs + a `%` readout) and Ctrl `+`/`-`/`0` shortcuts.

**Tech Stack:** TypeScript, mural framework (consumed from local Verdaccio), `.mu` markup compiled by `npm run compile:mu`, Vitest (`npm test`), electron-vite. Renderer UI is mural markup, **not** React.

## Prerequisite (blocks Task 1 — human release step)

`@pragmatic-lab/mural@0.7.0` (the SP1 result) is committed on mural `main` but **not yet published to the local Verdaccio registry**. Task 1 runs `npm install @pragmatic-lab/mural@^0.7.0`, which fails until 0.7.0 is on Verdaccio. Publishing is the repo's human-run release step (per finishing-a-development-branch); **do not publish from this plan.** Confirm 0.7.0 is published before starting Task 1.

## Global Constraints

- **mural version floor:** `@pragmatic-lab/mural` at `^0.7.0` (was `^0.6.24`). The camera API (`CameraEnabled`, `Zoom`/`PanX`/`PanY` DPs, `SetCamera`, `Camera`, `ZoomIn`/`ZoomOut`/`ResetZoom`/`Fit`/`FitToSelection`, and the `*Command` DPs) exists only from 0.7.0.
- **Test location:** every test file lives in a `tests/` subfolder next to the code it exercises (e.g. `src/renderer/src/modules/diagram/persistence/tests/…`), never beside the source. Vitest globs `src/**/*.test.ts` either way — this is organizational.
- **Enums over string-literal unions:** any fixed set of named string values is a real `enum`, never a union type or bare literals.
- **`.mu`-facing value converters** are exported `ValueConverter` objects in a `.ts` file, imported into the `.mu` by the exported identifier (`import ZoomPercent from "./services/diagram-zoom-percent.js"`) and used as `$Prop << ZoomPercent` — mirroring `KindToGeometry` in `services/projects/project-node-icon.ts`.
- **Camera scope:** persistence + wiring apply to **every** `.diagram` document, not only architecture ones — so the new code lives in the generic `diagram` module, not `architecture-projects`.
- **Secrets:** never commit `.npmrc` (carries the Verdaccio token; gitignored/untracked). Never commit secrets.
- **Commit** after each task with a green suite (`npm test`) + a clean `npm run typecheck` and `npm run compile:mu`.

## File Structure

- `src/renderer/src/modules/diagram/persistence/diagram-camera-store.ts` — **NEW.** `DiagramCameraState` type + `readCamera(doc)` / `writeCamera(doc, state)` over `DiagramDocument.Metadata`. Mirrors `arch-diagram-viewpoints-store.ts`.
- `src/renderer/src/modules/diagram/persistence/tests/diagram-camera-store.test.ts` — **NEW.** Round-trip through a real `DiagramDocument`.
- `src/renderer/src/modules/diagram/services/diagram-camera-service.ts` — **NEW.** App-scoped observer of open documents: per `DiagramDocument`, hydrate the camera from metadata onto the published `ActiveView` and persist (debounced) on camera-DP change. Mirrors `ArchDiagramBindingService` (open-docs subscription) + `attachAutoOpenInspector` (`ActiveViewKey` rebind).
- `src/renderer/src/modules/diagram/services/tests/diagram-camera-service.test.ts` — **NEW.** Hydrate-on-publish + debounced-persist-on-change, with the hydrate guard.
- `src/renderer/src/modules/diagram/services/diagram-zoom-percent.ts` — **NEW.** `ZoomPercent` value converter (number → `"NNN%"`).
- `src/renderer/src/modules/diagram/services/tests/diagram-zoom-percent.test.ts` — **NEW.** Converter unit test.
- `src/renderer/src/modules/diagram/behaviors/zoom-shortcuts.ts` — **NEW.** `attachZoomShortcuts(host)`: Ctrl `+`/`-`/`0` → the active diagram view's zoom methods. Mirrors `services/documents/save-shortcuts.ts`.
- `src/renderer/src/modules/diagram/behaviors/tests/zoom-shortcuts.test.ts` — **NEW.** Chord → method dispatch.
- `src/renderer/src/modules/diagram/diagram.resources.mu` — **MODIFY.** `CameraEnabled = true` on the `canvas` Diagram; add `zoom_in`/`zoom_out`/`fit_screen` glyphs; add the `@ZoomControlEditor` shell-control template.
- `src/renderer/src/modules/diagram/diagram.module.mu` — **MODIFY.** Register `@ZoomControlEditor` as a `ShellControlDefinition` (Commands region).
- `src/renderer/src/main.js` — **MODIFY.** Construct `DiagramCameraService` at boot; wire `attachZoomShortcuts(host)`.
- `package.json` — **MODIFY.** Bump `@pragmatic-lab/mural` to `^0.7.0`.

---

### Task 1: Bump mural + enable the camera on the canvas

**Files:**
- Modify: `package.json` (`@pragmatic-lab/mural`: `^0.6.24` → `^0.7.0`)
- Modify: `src/renderer/src/modules/diagram/diagram.resources.mu` (the `canvas` Diagram, ~L87-99)

**Interfaces:**
- Consumes: mural 0.7.0 `Diagram.CameraEnabled` boolean DP (default false; gates the `ZoomPanBehavior`).
- Produces: a diagram canvas with wheel/trackpad/grab gestures live. No new host code API.

- [ ] **Step 1: Confirm the prerequisite**

Verify `@pragmatic-lab/mural@0.7.0` resolves from Verdaccio:

```bash
npm view @pragmatic-lab/mural@0.7.0 version
```

Expected: prints `0.7.0`. If it errors (`E404`), STOP — the mural release hasn't been published yet (see Prerequisite above).

- [ ] **Step 2: Bump the dependency + install**

Edit `package.json`: `"@pragmatic-lab/mural": "^0.6.24"` → `"@pragmatic-lab/mural": "^0.7.0"`. Then:

```bash
npm install
```

Expected: installs 0.7.0; `.npmrc` stays untracked (do not stage it).

- [ ] **Step 3: Enable the camera in markup**

In `diagram.resources.mu`, add `CameraEnabled = true` to the `canvas` Diagram's property block (alongside `Focusable = true`):

```
Diagram x:name="canvas"
    [ ItemsSource                  = $Nodes,
      Connectors                   = $Connectors,
      ItemsPanel                   = @DiagramCanvasPanel,
      SelectionMode                = Extended,
      AllowMarqueeSelection        = true,
      AlignmentGuidesEnabled       = true,
      SelectionResizeEnabled       = true,
      ConnectorInteractionsEnabled = true,
      ReflectSelectionToItems      = true,
      CameraEnabled                = true,
      DropReceiver                 = $Self,
      Focusable                    = true,
      ContextMenuService.ContextMenu = @DiagramContextMenu ]
```

- [ ] **Step 4: Compile + typecheck**

```bash
npm run compile:mu
npm run typecheck
```

Expected: `.mu` compiles (the `CameraEnabled` DP resolves), typecheck clean. Gesture behavior itself is live-smoke (jsdom lacks `getScreenCTM`), out of scope for the unit suite.

- [ ] **Step 5: Full suite**

```bash
npm test
```

Expected: green (no regressions from the bump).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/renderer/src/modules/diagram/diagram.resources.mu
git commit -m "feat(diagram): consume mural 0.7.0 and enable the canvas camera"
```

---

### Task 2: Diagram camera store (metadata read/write)

**Files:**
- Create: `src/renderer/src/modules/diagram/persistence/diagram-camera-store.ts`
- Test: `src/renderer/src/modules/diagram/persistence/tests/diagram-camera-store.test.ts`

**Interfaces:**
- Consumes: `DiagramDocument.Metadata` (a `Record<string, unknown>` getter returning a shallow copy; setter replaces — round-trips through `.diagram` save/load). From `@pragmatic-lab/mural/framework`.
- Produces:
  - `interface DiagramCameraState { readonly zoom: number; readonly panX: number; readonly panY: number }`
  - `const DIAGRAM_CAMERA_KEY = 'camera'`
  - `function readCamera(doc: DiagramDocument): DiagramCameraState | undefined`
  - `function writeCamera(doc: DiagramDocument, state: DiagramCameraState): void`

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/modules/diagram/persistence/tests/diagram-camera-store.test.ts
import { test, expect } from 'vitest'
import { DiagramDocument } from '@pragmatic-lab/mural/framework'
import { readCamera, writeCamera } from '../diagram-camera-store.js'

test('writeCamera then readCamera round-trips a camera through document metadata', () => {
    const doc = new DiagramDocument()
    expect(readCamera(doc)).toBeUndefined()
    writeCamera(doc, { zoom: 2, panX: 30, panY: -40 })
    expect(readCamera(doc)).toEqual({ zoom: 2, panX: 30, panY: -40 })
})

test('writeCamera preserves other metadata keys', () => {
    const doc = new DiagramDocument()
    doc.Metadata = { 'arch.viewpoints': ['logical'] }
    writeCamera(doc, { zoom: 1, panX: 0, panY: 0 })
    expect(doc.Metadata['arch.viewpoints']).toEqual(['logical'])
    expect(readCamera(doc)).toEqual({ zoom: 1, panX: 0, panY: 0 })
})

test('readCamera rejects a malformed stored value', () => {
    const doc = new DiagramDocument()
    doc.Metadata = { camera: { zoom: 'big', panX: 0, panY: 0 } }
    expect(readCamera(doc)).toBeUndefined()
})

test('camera survives a real serialize -> deserialize cycle', () => {
    const seed = new DiagramDocument()
    writeCamera(seed, { zoom: 1.5, panX: 12, panY: 34 })
    const payload = (seed as unknown as { _serialize(): unknown })._serialize()
    const opened = new DiagramDocument()
    ;(opened as unknown as { _deserialize(p: unknown): void })._deserialize(payload)
    expect(readCamera(opened)).toEqual({ zoom: 1.5, panX: 12, panY: 34 })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- diagram-camera-store
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```ts
// src/renderer/src/modules/diagram/persistence/diagram-camera-store.ts
import type { DiagramDocument } from '@pragmatic-lab/mural/framework'

// The diagram camera (zoom + pan) is serialized WITH the diagram, in the
// document's opaque metadata (DiagramDocument.Metadata) under this namespaced
// key, so it travels with the .diagram file and restores on open. Mirrors the
// viewpoints store (arch-diagram-viewpoints-store.ts). Applies to every
// .diagram, not just architecture ones — hence the generic key.
export const DIAGRAM_CAMERA_KEY = 'camera'

export interface DiagramCameraState { readonly zoom: number; readonly panX: number; readonly panY: number }

function isState(v: unknown): v is DiagramCameraState {
    if (typeof v !== 'object' || v === null) return false
    const r = v as Record<string, unknown>
    return typeof r.zoom === 'number' && typeof r.panX === 'number' && typeof r.panY === 'number'
}

// The camera recorded on the document, or undefined when none is set (or the
// stored value is malformed). Undefined lets the caller keep the identity default.
export function readCamera(doc: DiagramDocument): DiagramCameraState | undefined {
    const raw = doc.Metadata[DIAGRAM_CAMERA_KEY]
    if (!isState(raw)) return undefined
    return { zoom: raw.zoom, panX: raw.panX, panY: raw.panY }
}

// Merge the camera into the document metadata, preserving any other keys. The
// caller persists by saving the document.
export function writeCamera(doc: DiagramDocument, state: DiagramCameraState): void {
    doc.Metadata = { ...doc.Metadata, [DIAGRAM_CAMERA_KEY]: { zoom: state.zoom, panX: state.panX, panY: state.panY } }
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test -- diagram-camera-store
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/diagram/persistence/diagram-camera-store.ts src/renderer/src/modules/diagram/persistence/tests/diagram-camera-store.test.ts
git commit -m "feat(diagram): camera-state metadata store"
```

---

### Task 3: Camera persistence service (hydrate + debounced persist)

**Files:**
- Create: `src/renderer/src/modules/diagram/services/diagram-camera-service.ts`
- Modify: `src/renderer/src/main.js` (construct the service at boot)
- Test: `src/renderer/src/modules/diagram/services/tests/diagram-camera-service.test.ts`

**Interfaces:**
- Consumes: `ContentHostService.Key` → `DocumentsContentHostService` with `OpenDocuments.Subscribe(fn)` + `OpenDocuments.ToArray()`; `DiagramDocument` (`instanceof`, `.ActiveView: Diagram | undefined`, `.AddPropertyChangedListener(DiagramDocument.ActiveViewKey, fn)` / `Remove…`, `.Save()`, `.Storage`); `Diagram` (`.Camera` getter, `.SetCamera({zoom,panX,panY})`, `.AddPropertyChangedListener(Diagram.ZoomKey|PanXKey|PanYKey, fn)` / `Remove…`); `FileDiagramStorage` (`.WhenWritten()`); `readCamera`/`writeCamera` (Task 2). `ServiceBase`, `ServiceKey`, `IServiceProvider` from `@pragmatic-lab/mural/runtime`.
- Produces: `class DiagramCameraService extends ServiceBase` with `static readonly Key`. Self-wiring on construction (subscribes to open documents). No public methods needed beyond construction; a private `_persistDelayMs` field (default 500) is overridable via the constructor's second arg for tests.

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/modules/diagram/services/tests/diagram-camera-service.test.ts
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { DiagramDocument, Diagram } from '@pragmatic-lab/mural/framework'
import { ObservableCollection } from '@pragmatic-lab/mural/runtime'
import { ContentHostService } from '@pragmatic-lab/mural/framework'
import { DiagramCameraService } from '../diagram-camera-service.js'
import { writeCamera, readCamera } from '../../persistence/diagram-camera-store.js'

// A minimal provider exposing just the content host under ContentHostService.Key.
function providerWith(host: unknown): { get(k: unknown): unknown; getRequired(k: unknown): unknown } {
    return {
        get: (k: unknown) => (k === ContentHostService.Key ? host : undefined),
        getRequired: (k: unknown) => (k === ContentHostService.Key ? host : undefined),
    }
}

// A fake DocumentsContentHostService: an ObservableCollection of open docs the
// service subscribes to, matching the surface the service reads.
function fakeHost() {
    const OpenDocuments = new ObservableCollection<unknown>()
    return { OpenDocuments } as unknown as { OpenDocuments: ObservableCollection<unknown> }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

test('hydrates the published view from stored metadata without re-persisting', () => {
    const host = fakeHost()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _service = new DiagramCameraService(providerWith(host) as never, 500)

    const doc = new DiagramDocument()
    writeCamera(doc, { zoom: 2, panX: 10, panY: 20 })
    host.OpenDocuments.Add(doc)                 // triggers the open-docs subscription

    const view = new Diagram()
    doc.ActiveView = view                        // publishes the view → hydrate

    expect(view.Camera).toEqual({ zoom: 2, panX: 10, panY: 20 })
    // Hydration must NOT schedule a persist (guarded): advancing time does not save.
    const save = vi.spyOn(doc, 'Save')
    vi.advanceTimersByTime(1000)
    expect(save).not.toHaveBeenCalled()
})

test('persists (debounced) when the view camera changes', () => {
    const host = fakeHost()
    const _service = new DiagramCameraService(providerWith(host) as never, 500)
    const doc = new DiagramDocument()
    host.OpenDocuments.Add(doc)
    const view = new Diagram()
    doc.ActiveView = view

    const save = vi.spyOn(doc, 'Save')
    view.SetCamera({ zoom: 3, panX: 5, panY: 6 })   // user zoom
    view.SetCamera({ zoom: 3, panX: 7, panY: 8 })   // and pan — coalesced
    expect(save).not.toHaveBeenCalled()             // still within debounce window
    vi.advanceTimersByTime(500)
    expect(save).toHaveBeenCalledTimes(1)
    expect(readCamera(doc)).toEqual({ zoom: 3, panX: 7, panY: 8 })
})
```

*(If constructing a live `new Diagram()` under jsdom proves too heavy in this suite, the fallback is a hand-rolled `FakeView` object exposing `Camera`, `SetCamera`, and `Add/RemovePropertyChangedListener` over the three camera keys — the service only touches that surface. Prefer the real objects; drop to the fake only if `new Diagram()` throws.)*

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- diagram-camera-service
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```ts
// src/renderer/src/modules/diagram/services/diagram-camera-service.ts
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import {
    ContentHostService, Diagram, DiagramDocument,
    type DocumentsContentHostService, type IDocument,
} from '@pragmatic-lab/mural/framework'
import { FileDiagramStorage } from '../persistence/file-diagram-storage.js'
import { readCamera, writeCamera } from '../persistence/diagram-camera-store.js'

// App-scoped observer: for every open DiagramDocument, restore the persisted
// camera onto the document's published ActiveView when it mounts, and write the
// camera back (debounced) into the document metadata whenever it changes. The
// metadata round-trips through the .diagram file, so a diagram reopens where the
// user left it. Applies to EVERY diagram — the generic module owns it.
//
// Mirrors ArchDiagramBindingService (open-docs subscription) and
// attachAutoOpenInspector (rebinding on DiagramDocument.ActiveViewKey).
export class DiagramCameraService extends ServiceBase
{
    public static readonly Key = new ServiceKey<DiagramCameraService>('DiagramCameraService')

    private readonly bindings = new Map<IDocument, () => void>()   // doc → detach

    public constructor(provider: IServiceProvider, private readonly persistDelayMs = 500)
    {
        super(provider)
        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        host?.OpenDocuments.Subscribe(() => this.sync(host))
    }

    private sync(host: DocumentsContentHostService): void
    {
        const current = new Set(host.OpenDocuments.ToArray())
        for (const [doc, detach] of [...this.bindings]) {
            if (!current.has(doc)) { detach(); this.bindings.delete(doc) }
        }
        for (const doc of current) this.attach(doc)
    }

    // Idempotent per document. Subscribes to ActiveView (re)publication; on each,
    // hydrates the camera (guarded so the hydrate write doesn't loop back into a
    // persist) and (re)subscribes camera-change persistence.
    private attach(doc: IDocument): void
    {
        if (this.bindings.has(doc) || !(doc instanceof DiagramDocument)) return

        let detachView: (() => void) | undefined
        let timer: ReturnType<typeof setTimeout> | undefined
        let hydrating = false

        const persist = (): void => {
            const view = doc.ActiveView
            if (view === undefined) return
            writeCamera(doc, view.Camera)
            doc.Save()
            const store = doc.Storage
            if (store instanceof FileDiagramStorage) void store.WhenWritten()
        }

        const onCameraChanged = (): void => {
            if (hydrating) return
            if (timer !== undefined) clearTimeout(timer)
            timer = setTimeout(persist, this.persistDelayMs)
        }

        const rebindView = (): void => {
            detachView?.()
            detachView = undefined
            const view = doc.ActiveView
            if (view === undefined) return
            // Hydrate: apply persisted camera without triggering a persist.
            const saved = readCamera(doc)
            if (saved !== undefined) {
                hydrating = true
                try { view.SetCamera(saved) } finally { hydrating = false }
            }
            for (const key of [Diagram.ZoomKey, Diagram.PanXKey, Diagram.PanYKey]) {
                view.AddPropertyChangedListener(key, onCameraChanged)
            }
            detachView = (): void => {
                for (const key of [Diagram.ZoomKey, Diagram.PanXKey, Diagram.PanYKey]) {
                    view.RemovePropertyChangedListener(key, onCameraChanged)
                }
            }
        }

        doc.AddPropertyChangedListener(DiagramDocument.ActiveViewKey, rebindView)
        rebindView()

        this.bindings.set(doc, () => {
            if (timer !== undefined) clearTimeout(timer)
            detachView?.()
            doc.RemovePropertyChangedListener(DiagramDocument.ActiveViewKey, rebindView)
        })
    }
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test -- diagram-camera-service
```

Expected: PASS.

- [ ] **Step 5: Wire at boot** (`main.js`)

Near the other eager service constructions (after the `ArchDiagramBindingService` line, ~L88), register + construct the camera service so its open-docs subscription is live from boot:

```js
// Diagram camera persistence: restore each diagram's saved zoom/pan on open and
// write it back (debounced) on change, via the document's metadata slot.
app.Services.register(DiagramCameraService.Key, (p) => new DiagramCameraService(p))
app.Services.get(DiagramCameraService.Key)
```

Add the import at the top of `main.js` alongside the other module-service imports:

```js
import { DiagramCameraService } from './modules/diagram/services/diagram-camera-service.js'
```

- [ ] **Step 6: Typecheck + full suite**

```bash
npm run typecheck
npm test
```

Expected: clean + green.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/modules/diagram/services/diagram-camera-service.ts src/renderer/src/modules/diagram/services/tests/diagram-camera-service.test.ts src/renderer/src/main.js
git commit -m "feat(diagram): persist camera per diagram via document metadata"
```

---

### Task 4: Zoom toolbar control + `%` readout

**Files:**
- Create: `src/renderer/src/modules/diagram/services/diagram-zoom-percent.ts`
- Test: `src/renderer/src/modules/diagram/services/tests/diagram-zoom-percent.test.ts`
- Modify: `src/renderer/src/modules/diagram/diagram.resources.mu` (glyphs + `@ZoomControlEditor` template)
- Modify: `src/renderer/src/modules/diagram/diagram.module.mu` (`.ShellControls:` entry)

**Interfaces:**
- Consumes: `Diagram.ZoomInCommand`/`ZoomOutCommand`/`FitCommand` command DPs + `Diagram.Zoom` number DP on the document's published `ActiveView`; `ValueConverter` from `@pragmatic-lab/mural/runtime`.
- Produces: `export const ZoomPercent: ValueConverter` (`number → "NNN%"`); a Commands-region shell control `− [NNN%] +  Fit` bound to the live view. No new host code API beyond the converter.

- [ ] **Step 1: Write the failing converter test**

```ts
// src/renderer/src/modules/diagram/services/tests/diagram-zoom-percent.test.ts
import { test, expect } from 'vitest'
import { ZoomPercent } from '../diagram-zoom-percent.js'

test('formats a zoom factor as a whole-number percentage', () => {
    expect(ZoomPercent.convert(1)).toBe('100%')
    expect(ZoomPercent.convert(0.5)).toBe('50%')
    expect(ZoomPercent.convert(2.5)).toBe('250%')
    expect(ZoomPercent.convert(0.333)).toBe('33%')
})

test('tolerates a nullish zoom (view not yet mounted)', () => {
    expect(ZoomPercent.convert(undefined)).toBe('')
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- diagram-zoom-percent
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the converter**

```ts
// src/renderer/src/modules/diagram/services/diagram-zoom-percent.ts
import type { ValueConverter } from '@pragmatic-lab/mural/runtime'

// Formats a camera zoom factor (1 = 100%) as a whole-number percentage for the
// zoom toolbar readout. Nullish (no live view yet) renders as blank. Used in
// markup as `$Zoom << ZoomPercent`.
export const ZoomPercent: ValueConverter = {
    convert: (zoom: unknown) =>
        typeof zoom === 'number' ? `${Math.round(zoom * 100)}%` : '',
}
```

- [ ] **Step 4: Add the glyphs + template** (`diagram.resources.mu`)

Add three Material Symbols to the existing `glyphs "assets/material-symbols-outlined.ttf" { … }` block (after `text_decrease`):

```
        // Zoom toolbar (host-built camera UI).
        zoom_in
        zoom_out
        fit_screen
```

Add the shell-control template (place it after `@FontFormatEditor`, before `@ConnectorModeIndicator`). Retargeting the inner panel's DataContext to `$ActiveView` (the live Diagram the document publishes) makes every binding a SINGLE reactive segment on the control — the same idiom the DiagramInspector uses with `$View` (a two-segment `ActiveView.Zoom` would go stale). When no view is mounted yet, the commands resolve to nothing (inert buttons) and the readout is blank — a transient the shell tolerates, matching the context menu's `$ActiveView.*` command bindings.

```
    // ── Zoom control — a Commands-region toolbar CONTROL (host-built camera UI) ──
    // Hosted in the shell command bar by the module's .ShellControls: entry. The
    // shell applies this with the active DiagramDocument as DataContext; the inner
    // StackPanel retargets to $ActiveView (the live Diagram) so the command DPs and
    // the Zoom readout bind as single reactive segments (mirrors the inspector's
    // $View retarget). Buttons drive the mural camera commands; the label shows the
    // current zoom via ZoomPercent. Reached only by key — never implicit type
    // resolution — so it can't shadow the keyless canvas template.
    DataTemplate x:key="ZoomControlEditor" [DataType = DiagramDocument] {
        StackPanel [ Orientation = Horizontal, VerticalAlignment = Center, DataContext = $ActiveView ] {
            ToolBar {
                ToolBarButton [ Command = $ZoomOutCommand ] {
                    Shape [ Geometry = @zoom_out, Fill = @OnSurfaceVariant, Width = 16, Height = 16, Margin = (2) ]
                }
            }
            TextBlock
                [ Text              = $Zoom << ZoomPercent,
                  Width             = 44,
                  TextAlignment     = Center,
                  VerticalAlignment = Center,
                  Foreground        = @OnSurfaceVariant ]
            ToolBar {
                ToolBarButton [ Command = $ZoomInCommand ] {
                    Shape [ Geometry = @zoom_in, Fill = @OnSurfaceVariant, Width = 16, Height = 16, Margin = (2) ]
                }
                ToolBarButton [ Command = $FitCommand ] {
                    Shape [ Geometry = @fit_screen, Fill = @OnSurfaceVariant, Width = 16, Height = 16, Margin = (2) ]
                }
            }
        }
    }
```

Add the converter import at the top of `diagram.resources.mu` (with the other `import` clauses):

```
import ZoomPercent from "./services/diagram-zoom-percent.js"
```

- [ ] **Step 5: Register the shell control** (`diagram.module.mu`, `.ShellControls:` block)

Add before the `@FontFormatEditor` entry so zoom sits ahead of the text controls (Order 320 < 330):

```
        // Zoom control — host-built camera UI (Commands region). Binds the live
        // canvas's zoom command DPs + Zoom readout through the published ActiveView.
        ShellControlDefinition
            [ Template = @ZoomControlEditor,
              Context  = DiagramEditingContext,
              Order    = 320 ]
```

- [ ] **Step 6: Converter test + compile + typecheck + suite**

```bash
npm test -- diagram-zoom-percent
npm run compile:mu
npm run typecheck
npm test
```

Expected: converter PASS; `.mu` compiles (glyphs + template + import resolve); typecheck clean; full suite green. Visual placement + button behavior are live-smoke.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/modules/diagram/services/diagram-zoom-percent.ts src/renderer/src/modules/diagram/services/tests/diagram-zoom-percent.test.ts src/renderer/src/modules/diagram/diagram.resources.mu src/renderer/src/modules/diagram/diagram.module.mu
git commit -m "feat(diagram): host zoom toolbar with %-readout bound to the camera commands"
```

---

### Task 5: Keyboard shortcuts (Ctrl +/−/0)

**Files:**
- Create: `src/renderer/src/modules/diagram/behaviors/zoom-shortcuts.ts`
- Test: `src/renderer/src/modules/diagram/behaviors/tests/zoom-shortcuts.test.ts`
- Modify: `src/renderer/src/main.js` (wire it)

**Interfaces:**
- Consumes: the content host's active document handle — `{ ActiveDocument: IDocument | undefined }` (the same `ContentHostService` the save shortcuts receive); `DiagramDocument` (`instanceof`, `.ActiveView: Diagram | undefined`); `Diagram` methods `ZoomIn()`/`ZoomOut()`/`ResetZoom()`.
- Produces: `export function attachZoomShortcuts(host: ZoomHost, target?): () => void` — window capture-phase keydown mapping Ctrl/⌘ `+`/`=` → `ZoomIn`, `-` → `ZoomOut`, `0` → `ResetZoom`, dispatched to the active diagram's live view. Returns a detach thunk. Mirrors `save-shortcuts.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/modules/diagram/behaviors/tests/zoom-shortcuts.test.ts
import { test, expect, vi } from 'vitest'
import { attachZoomShortcuts } from '../zoom-shortcuts.js'

// A fake window capturing the single keydown listener.
function fakeTarget() {
    let handler: ((e: KeyboardEvent) => void) | undefined
    return {
        addEventListener: (_t: string, h: EventListenerOrEventListenerObject) => { handler = h as (e: KeyboardEvent) => void },
        removeEventListener: () => { handler = undefined },
        fire: (init: Partial<KeyboardEvent>) => handler?.({ preventDefault() {}, stopPropagation() {}, ...init } as KeyboardEvent),
    }
}

// A host whose active document is a diagram exposing a spy-able live view.
function hostWithView() {
    const view = { ZoomIn: vi.fn(), ZoomOut: vi.fn(), ResetZoom: vi.fn() }
    // Duck-typed DiagramDocument: the behavior checks instanceof, so we stub that
    // via a shared marker in the real implementation's guard (see note in Step 3).
    const doc = { __isDiagramDocument: true, ActiveView: view }
    return { host: { ActiveDocument: doc }, view }
}

test('Ctrl+= zooms in, Ctrl+- zooms out, Ctrl+0 resets — on the active diagram view', () => {
    const { host, view } = hostWithView()
    const t = fakeTarget()
    attachZoomShortcuts(host as never, t as never)

    t.fire({ ctrlKey: true, key: '=' })
    t.fire({ ctrlKey: true, key: '-' })
    t.fire({ ctrlKey: true, key: '0' })

    expect(view.ZoomIn).toHaveBeenCalledTimes(1)
    expect(view.ZoomOut).toHaveBeenCalledTimes(1)
    expect(view.ResetZoom).toHaveBeenCalledTimes(1)
})

test('ignores the chord when no modifier is held', () => {
    const { host, view } = hostWithView()
    const t = fakeTarget()
    attachZoomShortcuts(host as never, t as never)
    t.fire({ key: '=' })
    expect(view.ZoomIn).not.toHaveBeenCalled()
})

test('detach removes the listener', () => {
    const { host, view } = hostWithView()
    const t = fakeTarget()
    const detach = attachZoomShortcuts(host as never, t as never)
    detach()
    t.fire({ ctrlKey: true, key: '=' })
    expect(view.ZoomIn).not.toHaveBeenCalled()
})
```

*(The test duck-types the document with `__isDiagramDocument`. Rather than a brittle marker, the implementation should guard with a real `instanceof DiagramDocument`; adjust the test to construct a real `DiagramDocument` with its `ActiveView` set to the spy view if `new DiagramDocument()` is cheap in this suite — same choice as Task 3. Keep whichever the suite supports; the dispatch logic under test is identical.)*

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- zoom-shortcuts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```ts
// src/renderer/src/modules/diagram/behaviors/zoom-shortcuts.ts
import { Diagram, DiagramDocument, type IDocument } from '@pragmatic-lab/mural/framework'

// The bit of the document host the shortcuts read.
interface ZoomHost { readonly ActiveDocument: IDocument | undefined }

// The live diagram view of the active document, if the active document is a
// diagram whose canvas has mounted (published its ActiveView). Undefined
// otherwise → the chord is ignored (nothing swallowed).
function activeView(host: ZoomHost): Diagram | undefined {
    const doc = host.ActiveDocument
    return doc instanceof DiagramDocument ? doc.ActiveView : undefined
}

// Wire Ctrl/⌘ +/−/0 → zoom-in / zoom-out / reset on the active diagram's camera,
// at the window CAPTURE phase (parity with save-shortcuts: fires before editor
// key-swallow boundaries). Only these chords are intercepted, and only when there
// is a live diagram view to receive them. Returns a detach thunk.
export function attachZoomShortcuts(
    host: ZoomHost,
    target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
): () => void {
    const onKeyDown = (e: KeyboardEvent): void => {
        const mod = e.ctrlKey || e.metaKey
        if (!mod) return
        const view = activeView(host)
        if (view === undefined) return
        // '+' and '=' share a physical key; accept both for zoom-in.
        if (e.key === '+' || e.key === '=') { e.preventDefault(); e.stopPropagation(); view.ZoomIn(); return }
        if (e.key === '-') { e.preventDefault(); e.stopPropagation(); view.ZoomOut(); return }
        if (e.key === '0') { e.preventDefault(); e.stopPropagation(); view.ResetZoom(); return }
    }
    target.addEventListener('keydown', onKeyDown, { capture: true })
    return () => target.removeEventListener('keydown', onKeyDown, { capture: true } as EventListenerOptions)
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test -- zoom-shortcuts
```

Expected: PASS.

- [ ] **Step 5: Wire at boot** (`main.js`)

After `attachSaveShortcuts(host)` (~L132):

```js
// Ctrl +/−/0 → zoom in / out / reset on the active diagram's camera.
if (host !== undefined) attachZoomShortcuts(host)
```

Add the import at the top of `main.js`:

```js
import { attachZoomShortcuts } from './modules/diagram/behaviors/zoom-shortcuts.js'
```

- [ ] **Step 6: Typecheck + full suite**

```bash
npm run typecheck
npm test
```

Expected: clean + green.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/modules/diagram/behaviors/zoom-shortcuts.ts src/renderer/src/modules/diagram/behaviors/tests/zoom-shortcuts.test.ts src/renderer/src/main.js
git commit -m "feat(diagram): Ctrl +/-/0 zoom keyboard shortcuts"
```

---

## Self-Review

**Spec coverage (SP2 = design §Plexus P1–P3):**
- **P1 (bump + recompile `.mu`)** → Task 1.
- **P2 (persist camera in `.diagram` metadata; read on open → set DPs; write on change debounced; default when absent)** → Task 2 (store) + Task 3 (service: hydrate on `ActiveView` publish, debounced persist on camera-DP change, absent → identity default untouched).
- **P3 (surface/keyboard wiring)** → Task 4 (host zoom toolbar: buttons + `%` readout on the command DPs — the "host-built in Plexus" decision) + Task 5 (Ctrl +/−/0).
- **Enable gestures** (design locked-decision 1, the `CameraEnabled` gate) → Task 1 markup flag.

**Placeholder scan:** The two test-construction fallbacks (real `new Diagram()`/`new DiagramDocument()` vs a hand-rolled fake in Tasks 3 & 5) are called out explicitly with the exact minimal surface to fake — not vague. All implementation code is complete. No TODOs.

**Type consistency:** `DiagramCameraState {zoom,panX,panY}` is written by `writeCamera`, read by `readCamera`, produced by `view.Camera`, and consumed by `view.SetCamera` (structural match to mural's `Camera`) across Tasks 2/3. `DIAGRAM_CAMERA_KEY = 'camera'` single source. `ActiveViewKey`/`Diagram.ZoomKey|PanXKey|PanYKey` used consistently in Task 3. `attachZoomShortcuts(host, target?)` signature matches its `main.js` call site.

**Ordering note:** Task 1 is the only task gated on the Verdaccio publish. Tasks 2 & 4-converter/2-store are pure host code and could be written before the bump, but their tests import `@pragmatic-lab/mural/framework` types that only need to resolve (not run camera code), so keeping Task 1 first is simplest.

## Out of scope (this plan / v1)

- Auto-Fit on first open (default is the identity camera — decision 5).
- Minimap / overview navigator, animated zoom, LOD/culling.
- A preset-stop `%` dropdown (the readout is display-only in v1; buttons + wheel + keyboard cover input).
- Space-hold grab-pan cursor affordance polish (middle-drag grab-pan ships from mural; space-hold is a live-smoke follow-up if desired).

## Live-smoke checklist (whole feature, user-run — jsdom can't cover `getScreenCTM`)

- Wheel-zoom-at-cursor + trackpad pinch; plain-wheel / two-finger pan; middle-drag grab-pan (pointer capture + DeltaMode feel).
- Constant-size selection handles under zoom; drag / marquee-selection / connector-waypoint correctness under zoom (watch for any behavior using raw host coords vs the CTM inverse).
- ScrollViewer neutralization not fighting drag-to-edge auto-scroll or scroll-into-view.
- Toolbar buttons + `%` readout track the live camera; Ctrl +/−/0 act on the focused diagram; Fit frames content.
- Reopen a saved diagram → camera restored; a never-touched diagram opens at 100% / origin.

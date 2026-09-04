# Diagram Export SP1 (engine + context menu) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export the active Plexus diagram to SVG or PPTX from an "Export" submenu on the diagram's right-click context menu — selection if any, else the whole diagram.

**Architecture:** A new `diagram-export` renderer module contributes a `DiagramExportService` (a `ServiceBase` exposing two `RelayCommand` `ICommand`s). Both commands resolve the active `DiagramDocument` via `ContentHostService`, render its diagram to an SVG string with Mural's headless `SvgDrawingContext`, and save via the existing `FileSystemService` — SVG as text, PPTX as a single-slide PNG (rasterized in-renderer via `canvas`) built with `pptxgenjs`. The context menu binds the commands via `$service(DiagramExportService).…` — sidestepping the single-instance `DiagramCommandExtensionKey` seam (already owned by `ArchEditViewpointsCommand`).

**Tech Stack:** Mural (`@pragmatic-tech-ai/mural` — `HeadlessTarget`, `SvgDrawingContext`, `RelayCommand`, `ServiceBase`, `DiagramDocument`, `ContentHostService`), `pptxgenjs` (new), the existing `FileSystemService` IPC, electron-vite + Playwright `_electron`.

**Spec:** `docs/superpowers/specs/2026-09-04-diagram-export.md` (SP1 = §4 "Export engine + context menu").

## Global Constraints

- **Renderer-only.** No new main-process/IPC code — reuse `FileSystemService.SaveFileAs` (text) and `WriteBytes` (binary).
- **Command wiring is via `$service(...)`, NOT the `IDiagramCommandExtension` seam** — `PlexusDiagramDocument.Execute` resolves `DiagramCommandExtensionKey` as a single instance already taken by `ArchEditViewpointsCommand`, so a second extension would conflict.
- **Extent:** selection if `Diagram.SelectionCount > 0`, else the whole diagram (union of `doc.Nodes` bounds).
- **PPTX = one slide, diagram as a rasterized PNG** (via `pptxgenjs`). No native editable shapes.
- **Extensions in dialog filters carry NO leading dot** (`"svg"`, `"pptx"`).
- **Tests live in a `tests/` subfolder next to source** (repo convention). Renderer tests run under Vitest; end-to-end runs under Playwright `_electron` (`npm run test:e2e`).
- **Commits** on a feature branch; never `git push`. Build check for `.mu` changes: `npm run compile:mu` then `npm run build`.

---

### Task 1: Module scaffold + service + context-menu submenu (Export appears, commands wired but inert)

Deliver a loadable module whose two commands appear as "Export ▸ Vector Graphics (SVG) / PowerPoint (PPTX)" on the diagram context menu, correctly enabled only when a diagram with ≥1 node is active. The command bodies are stubbed to a single private `exportActive(format)` that resolves the active diagram and (this task) does nothing but is unit-tested for enable/resolve logic.

**Files:**
- Create: `src/renderer/src/modules/diagram-export/diagram-export.module.mu`
- Create: `src/renderer/src/modules/diagram-export/services/diagram-export-service.ts`
- Create: `src/renderer/src/modules/diagram-export/services/tests/diagram-export-service.test.ts`
- Modify: `src/renderer/src/app.mu` (import + `.modules:` list)
- Modify: `src/renderer/src/modules/diagram/diagram.resources.mu` (import + Export submenu)
- Modify: `package.json` (`compile:mu` — add the new `.module.mu`; `dependencies` — add `pptxgenjs`)

**Interfaces:**
- Produces: `DiagramExportService` (`ServiceBase`) with `static readonly Key`, public `ExportSvgCommand: ICommand`, `ExportPptxCommand: ICommand`, and a protected/private `exportActive(format: 'svg' | 'pptx'): Promise<void>` that later tasks flesh out. Also a testable `canExportActive(): boolean`.

- [ ] **Step 1: Add the dependency**

In `package.json` `dependencies`, add `"pptxgenjs": "^3.12.0"`. Run `npm install`. Expected: installs (pure JS, no native build).

- [ ] **Step 2: Write the failing service test**

`src/renderer/src/modules/diagram-export/services/tests/diagram-export-service.test.ts`:

```ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService } from '@pragmatic-tech-ai/mural/framework'
import { DiagramExportService } from '../diagram-export-service.js'

// A minimal fake content host exposing just ActiveDocument.
function providerWith(activeDoc: unknown) {
  const provider = new ServiceProvider()
  provider.registerInstance(ContentHostService.Key, { ActiveDocument: activeDoc } as never)
  return provider
}

test('canExportActive is false when no document is active', () => {
  const svc = new DiagramExportService(providerWith(undefined))
  expect(svc.canExportActive()).toBe(false)
})

test('canExportActive is false for a non-diagram document', () => {
  const svc = new DiagramExportService(providerWith({ notADiagram: true }))
  expect(svc.canExportActive()).toBe(false)
})

test('ExportSvgCommand / ExportPptxCommand are ICommands', () => {
  const svc = new DiagramExportService(providerWith(undefined))
  expect(typeof svc.ExportSvgCommand.Execute).toBe('function')
  expect(typeof svc.ExportPptxCommand.CanExecute).toBe('function')
  expect(svc.ExportSvgCommand.CanExecute()).toBe(false) // no active diagram
})
```

> If `ServiceProvider`/`registerInstance` differ in this codebase, mirror the construction used in an existing renderer service test (search `src/renderer/**/tests/*.test.ts` for `new ServiceProvider` or a test provider helper) — adapt the fake, keep the assertions.

- [ ] **Step 3: Run it — expect failure**

Run: `npx vitest run src/renderer/src/modules/diagram-export`
Expected: FAIL — `DiagramExportService` not found.

- [ ] **Step 4: Implement the service**

`src/renderer/src/modules/diagram-export/services/diagram-export-service.ts`:

```ts
import {
  MetaData, MuralBase, RelayCommand, ServiceBase, ServiceKey,
  type ICommand, type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'
import {
  ContentHostService, DiagramDocument,
  type DocumentsContentHostService,
} from '@pragmatic-tech-ai/mural/framework'

// Exports the active diagram's visual (selection if any, else the whole diagram)
// to SVG or PPTX. Exposes two ICommands bound by the diagram context menu (and,
// in SP2, the title-bar File menu) via `$service(DiagramExportService).…`.
export class DiagramExportService extends ServiceBase
{
  public static readonly Key = new ServiceKey<DiagramExportService>('DiagramExportService')

  public static readonly ExportSvgCommandKey = MuralBase.RegisterProperty<ICommand>(
    DiagramExportService, 'ExportSvgCommand', undefined as unknown as ICommand, MetaData.None)
  public static readonly ExportPptxCommandKey = MuralBase.RegisterProperty<ICommand>(
    DiagramExportService, 'ExportPptxCommand', undefined as unknown as ICommand, MetaData.None)

  public constructor(provider: IServiceProvider)
  {
    super(provider)
    const gate = (): boolean => this.canExportActive()
    this.set_property_value(DiagramExportService.ExportSvgCommandKey,
      new RelayCommand(() => { void this.exportActive('svg') }, gate))
    this.set_property_value(DiagramExportService.ExportPptxCommandKey,
      new RelayCommand(() => { void this.exportActive('pptx') }, gate))
  }

  public get ExportSvgCommand(): ICommand { return this.get_property_value(DiagramExportService.ExportSvgCommandKey) }
  public get ExportPptxCommand(): ICommand { return this.get_property_value(DiagramExportService.ExportPptxCommandKey) }

  // The active document if it is a diagram with at least one node, else undefined.
  protected activeDiagram(): DiagramDocument | undefined
  {
    const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
    const doc = host?.ActiveDocument
    if (!(doc instanceof DiagramDocument)) return undefined
    return doc.Nodes.Count > 0 ? doc : undefined
  }

  public canExportActive(): boolean { return this.activeDiagram() !== undefined }

  // Fleshed out in Tasks 2 (svg) and 3 (pptx).
  protected async exportActive(_format: 'svg' | 'pptx'): Promise<void> { /* Task 2/3 */ }
}
```

> Verify `doc.Nodes.Count` is the collection's count accessor (Mural `ObservableCollection`); if it is `.length` or `.Length`, use that. Check `node_modules/@pragmatic-tech-ai/mural/dist/framework/diagram/diagram-document.d.ts` for the `Nodes` type.

- [ ] **Step 5: Run the test — expect pass**

Run: `npx vitest run src/renderer/src/modules/diagram-export`
Expected: PASS (3 tests).

- [ ] **Step 6: Create the module**

`src/renderer/src/modules/diagram-export/diagram-export.module.mu`:

```mu
// diagram-export.module.mu — registers DiagramExportService, which backs the
// diagram context-menu "Export" submenu (SVG / PPTX). No nav capability, no
// project type — a pure service contribution.
import DiagramExportService from "./services/diagram-export-service.js"

module DiagramExportModule [ Name = "Diagram Export" ] {
    .services: {
        DiagramExportService
    }
}
```

- [ ] **Step 7: Register the module in `app.mu`**

Add the import beside the other module imports (near `app.mu:36-44`):
```
import DiagramExportModule from "./modules/diagram-export/diagram-export.module.mu.js"
```
Add `DiagramExportModule` to the `.modules:` list (near `app.mu:328-338`), after `DiagramModule`.

- [ ] **Step 8: Add the module `.mu` to `compile:mu`**

In `package.json`, append `src/renderer/src/modules/diagram-export/diagram-export.module.mu` to the space-separated file list of the `compile:mu` script.

- [ ] **Step 9: Add the Export submenu to the diagram context menu**

In `src/renderer/src/modules/diagram/diagram.resources.mu`: add the service import at the top alongside the other service imports (find `import ... PanelDockService`-style imports; add `import DiagramExportService from "../diagram-export/services/diagram-export-service.js"` — match the file's existing import style). Then, inside `ContextMenu x:key="DiagramContextMenu"`, immediately before the `MenuItem [ Header = "Format Shape" … ]` (around line 339), insert:

```mu
        MenuSeparator
        MenuItem [ Header = "Export" ] {
            MenuItem [ Header = "Vector Graphics (SVG)", Command = $service(DiagramExportService).ExportSvgCommand ]
            MenuItem [ Header = "PowerPoint (PPTX)",     Command = $service(DiagramExportService).ExportPptxCommand ]
        }
```

- [ ] **Step 10: Build**

Run: `npm run compile:mu && npm run build`
Expected: compiles + builds clean (the `.mu` resolves `DiagramExportService`, the module list resolves the import).

- [ ] **Step 11: Commit**

```bash
git add src/renderer/src/modules/diagram-export src/renderer/src/app.mu src/renderer/src/modules/diagram/diagram.resources.mu package.json package-lock.json
git commit -m "feat(diagram-export): module + service + context-menu Export submenu (inert)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: SVG export — `renderDiagramSvg` + `exportSvg`

Render the active diagram (selection or whole) to an SVG string and save it. This is the riskiest piece (the headless render/translation), so it carries an end-to-end proof.

**Files:**
- Create: `src/renderer/src/modules/diagram-export/services/diagram-svg-renderer.ts`
- Create: `src/renderer/src/modules/diagram-export/services/tests/diagram-svg-renderer.test.ts`
- Modify: `src/renderer/src/modules/diagram-export/services/diagram-export-service.ts` (fill `exportActive('svg')`)
- Create (e2e): `src/renderer/src/modules/diagram-export/tests/export-svg.e2e.ts` (or wherever the repo keeps `_electron` specs — mirror the existing e2e location)

**Interfaces:**
- Consumes: `DiagramExportService.activeDiagram()`.
- Produces: `unionOfNodeBounds(nodes): Rect`, `renderDiagramSvg(doc: DiagramDocument): { svg: string; width: number; height: number }`.

- [ ] **Step 1: Failing unit test for `unionOfNodeBounds`**

`src/renderer/src/modules/diagram-export/services/tests/diagram-svg-renderer.test.ts`:

```ts
import { test, expect } from 'vitest'
import { unionOfNodeBounds } from '../diagram-svg-renderer.js'

test('unionOfNodeBounds unions Left/Top/BaseWidth/BaseHeight', () => {
  const nodes = [
    { Left: 10, Top: 10, BaseWidth: 20, BaseHeight: 20 },   // → (10,10)-(30,30)
    { Left: 40, Top: 5,  BaseWidth: 10, BaseHeight: 50 },   // → (40,5)-(50,55)
  ]
  const r = unionOfNodeBounds(nodes as never)
  expect(r.X).toBe(10); expect(r.Y).toBe(5)
  expect(r.Width).toBe(40); expect(r.Height).toBe(50) // 50-10 , 55-5
})

test('unionOfNodeBounds of empty is a zero rect', () => {
  const r = unionOfNodeBounds([] as never)
  expect(r.Width).toBe(0); expect(r.Height).toBe(0)
})
```

> Confirm `Rect`'s field names (`X/Y/Width/Height` vs `Left/Top/…`) from `node_modules/@pragmatic-tech-ai/mural/dist/visual-engine/primitives.d.ts` and match the assertions to it.

- [ ] **Step 2: Run — expect failure** (`npx vitest run src/renderer/src/modules/diagram-export` → FAIL, no `unionOfNodeBounds`).

- [ ] **Step 3: Implement `diagram-svg-renderer.ts`**

```ts
import { Rect } from '@pragmatic-tech-ai/mural/visual-engine'
import type { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import { HeadlessTarget, SvgDrawingContext } from '@pragmatic-tech-ai/mural/visual-engine'

interface NodeBox { Left: number; Top: number; BaseWidth: number; BaseHeight: number }

// Union of every node's canvas-space box. Zero rect when there are no nodes.
export function unionOfNodeBounds(nodes: Iterable<NodeBox>): Rect
{
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.Left);              minY = Math.min(minY, n.Top)
    maxX = Math.max(maxX, n.Left + n.BaseWidth); maxY = Math.max(maxY, n.Top + n.BaseHeight)
  }
  if (!isFinite(minX)) return new Rect(0, 0, 0, 0)
  return new Rect(minX, minY, maxX - minX, maxY - minY)
}

// Render the diagram — selection if any, else the whole content — to an SVG
// string sized to those bounds, with the bounds' origin mapped to (0,0).
export function renderDiagramSvg(doc: DiagramDocument): { svg: string; width: number; height: number }
{
  const diagram = doc.ActiveView
  if (diagram === undefined) throw new Error('diagram has no active view to export')

  const bounds = diagram.SelectionCount > 0
    ? new Rect(diagram.SelectionLeft, diagram.SelectionTop, diagram.SelectionWidth, diagram.SelectionHeight)
    : unionOfNodeBounds(doc.Nodes as unknown as Iterable<NodeBox>)

  const width = Math.max(1, Math.ceil(bounds.Width))
  const height = Math.max(1, Math.ceil(bounds.Height))

  const target = new HeadlessTarget(width, height, diagram.ItemsPanelInstance)
  const dc = new SvgDrawingContext()
  // Map content origin → (0,0): translate by -bounds.X/-bounds.Y before rendering.
  dc.PushTransform(translate(-bounds.X, -bounds.Y))
  target.Render(dc)
  dc.Pop()
  return { svg: dc.ToSvg(width, height), width, height }
}
```

> **Spike inside this step:** the exact origin-translation mechanism is the one real unknown. Options, in order of preference — confirm which the API supports by reading `svg-drawing-context.d.ts`/`headless-target.d.ts` and trying in `npm run dev`:
> 1. `dc.PushTransform(Transform.Translate(-x,-y))` around `target.Render(dc)` (shown above — needs the correct `Transform` factory; import from `visual-engine`).
> 2. If `HeadlessTarget` already offsets by content bounds, drop the transform and just size to `width/height`.
> 3. Post-process: set the `<svg viewBox="x y w h">` on the `ToSvg` output.
> Pick the one that yields a correctly-cropped SVG of a real diagram; delete the others. Record the choice in the file's comment.

- [ ] **Step 4: Run unit test — expect pass** (`unionOfNodeBounds` tests green).

- [ ] **Step 5: Wire `exportSvg` into the service**

In `diagram-export-service.ts`, import `renderDiagramSvg` and `FileSystemService`, and replace `exportActive`:

```ts
protected async exportActive(format: 'svg' | 'pptx'): Promise<void>
{
  const doc = this.activeDiagram()
  if (doc === undefined) return
  if (format === 'svg') return this.exportSvg(doc)
  return this.exportPptx(doc) // Task 3
}

private async exportSvg(doc: DiagramDocument): Promise<void>
{
  const { svg } = renderDiagramSvg(doc)
  const fs = this.Provider.getRequired(FileSystemService.Key)
  await fs.SaveFileAs(svg, {
    Title: 'Export as SVG',
    DefaultPath: `${doc.Title ?? 'diagram'}.svg`,
    Filters: [{ Name: 'SVG Image', Extensions: ['svg'] }],
  })
}

private async exportPptx(_doc: DiagramDocument): Promise<void> { /* Task 3 */ }
```

> Confirm `DiagramDocument.Title` exists (else use another label, e.g. the storage path stem).

- [ ] **Step 6: End-to-end proof (Playwright `_electron`)**

Add an e2e that launches the app, opens/creates a diagram with a node, invokes SVG export, and asserts a `.svg` was written. Mirror the repo's existing `_electron` spec structure (search for `_electron` under the repo; match its launch helper, and drive the save dialog by stubbing `window.api.fs.saveFileAs` to a temp path, or by asserting the service returns the SVG through a test hook). Concretely:

```ts
// export-svg.e2e.ts — pseudocode; adapt to the repo's _electron harness
// 1. launch electron, open a project with a .diagram containing ≥1 node
// 2. evaluate in renderer: resolve DiagramExportService, call ExportSvgCommand.Execute()
//    with window.api.fs.saveFileAs stubbed to write to a temp path
// 3. assert the temp file exists and its content starts with '<svg'
```

If the repo has no `_electron` harness to mirror, instead expose a test-only `renderActiveSvg(): string | undefined` on the service and assert via a focused renderer test in the running app; note the gap in the report.

- [ ] **Step 7: Build + run** (`npm run compile:mu && npm run build`; `npx vitest run src/renderer/src/modules/diagram-export`; the e2e per the repo's `test:e2e`). Manually verify in `npm run dev`: right-click → Export ▸ SVG writes a valid, correctly-cropped `.svg`.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/modules/diagram-export
git commit -m "feat(diagram-export): SVG export (selection or whole diagram)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: PPTX export — raster + `pptxgenjs`

Rasterize the SVG to PNG and place it on one slide; save the `.pptx` bytes.

**Files:**
- Create: `src/renderer/src/modules/diagram-export/services/svg-raster.ts`
- Create: `src/renderer/src/modules/diagram-export/services/pptx-builder.ts`
- Create: `src/renderer/src/modules/diagram-export/services/tests/pptx-builder.test.ts`
- Modify: `src/renderer/src/modules/diagram-export/services/diagram-export-service.ts` (fill `exportPptx`)

**Interfaces:**
- Consumes: `renderDiagramSvg` (Task 2), `FileSystemService.SaveFileAs`/`WriteBytes`.
- Produces: `rasterizeSvgToPng(svg, width, height, scale): Promise<Uint8Array>`, `buildPptx(pngDataUrl, widthPx, heightPx): Promise<Uint8Array>`.

- [ ] **Step 1: Failing test for `buildPptx` (produces a real .pptx zip)**

`src/renderer/src/modules/diagram-export/services/tests/pptx-builder.test.ts`:

```ts
import { test, expect } from 'vitest'
import { buildPptx } from '../pptx-builder.js'

// A 1x1 transparent PNG data URL.
const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

test('buildPptx returns a non-empty PPTX (ZIP) buffer', async () => {
  const bytes = await buildPptx(PNG_1x1, 800, 600)
  expect(bytes.length).toBeGreaterThan(0)
  // PPTX is a ZIP: first two bytes are 'PK' (0x50 0x4B).
  expect(bytes[0]).toBe(0x50)
  expect(bytes[1]).toBe(0x4b)
})
```

- [ ] **Step 2: Run — expect failure** (no `buildPptx`).

- [ ] **Step 3: Implement `pptx-builder.ts`**

```ts
import PptxGenJS from 'pptxgenjs'

// One slide sized to the diagram's aspect, the diagram PNG filling it (with a
// small margin). Returns the .pptx as bytes.
export async function buildPptx(pngDataUrl: string, widthPx: number, heightPx: number): Promise<Uint8Array>
{
  const pptx = new PptxGenJS()
  // Slide in inches at 96 DPI; keep the diagram aspect, cap to a 10x7.5in slide.
  const inW = widthPx / 96, inH = heightPx / 96
  const scale = Math.min(10 / inW, 7.5 / inH, 1)
  const w = inW * scale, h = inH * scale
  pptx.defineLayout({ name: 'DIAGRAM', width: Math.max(w, 1), height: Math.max(h, 1) })
  pptx.layout = 'DIAGRAM'
  const slide = pptx.addSlide()
  slide.addImage({ data: pngDataUrl, x: 0, y: 0, w: Math.max(w, 1), h: Math.max(h, 1) })
  const out = await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer
  return new Uint8Array(out)
}
```

> Confirm the `pptxgenjs` `write` signature for the installed version (some expose `write('arraybuffer')`, others `write({ outputType })`). Adjust to whichever the `^3.12` types provide; the return must become a `Uint8Array`.

- [ ] **Step 4: Run test — expect pass** (PK magic present).

- [ ] **Step 5: Implement `svg-raster.ts`** (browser canvas; no unit test — needs a real canvas, covered by the manual/e2e check)

```ts
// Rasterize an SVG string to PNG bytes at `scale`× for crisp output. Renderer-only
// (uses the DOM Image + canvas). Rejects if the SVG fails to load.
export async function rasterizeSvgToPng(svg: string, width: number, height: number, scale = 2): Promise<Uint8Array>
{
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('failed to rasterize SVG'))
    img.src = url
  })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

// Convenience: PNG bytes → data URL (pptxgenjs addImage wants a data URI).
export function pngToDataUrl(bytes: Uint8Array): string
{
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return 'data:image/png;base64,' + btoa(bin)
}
```

- [ ] **Step 6: Wire `exportPptx` into the service**

Replace the Task-2 stub in `diagram-export-service.ts`:

```ts
private async exportPptx(doc: DiagramDocument): Promise<void>
{
  const { svg, width, height } = renderDiagramSvg(doc)
  const png = await rasterizeSvgToPng(svg, width, height, 2)
  const pptx = await buildPptx(pngToDataUrl(png), width, height)
  const fs = this.Provider.getRequired(FileSystemService.Key)
  const path = await fs.SaveFileAs('', {
    Title: 'Export as PowerPoint',
    DefaultPath: `${doc.Title ?? 'diagram'}.pptx`,
    Filters: [{ Name: 'PowerPoint Presentation', Extensions: ['pptx'] }],
  })
  if (path !== null) await fs.WriteBytes(path, pptx)
}
```

(`SaveFileAs('')` shows the dialog + returns the chosen path — writing an empty placeholder — then `WriteBytes` overwrites it with the real bytes.)

- [ ] **Step 7: Build + run** (`npm run compile:mu && npm run build`; `npx vitest run src/renderer/src/modules/diagram-export`). Manually verify in `npm run dev`: right-click → Export ▸ PPTX writes a `.pptx` that opens in PowerPoint with the diagram on one slide.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/modules/diagram-export
git commit -m "feat(diagram-export): PPTX export (single-slide raster via pptxgenjs)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage (SP1):** DiagramExportService + unified handler → Task 1/2/3 ✓ · SVG via HeadlessTarget+SvgDrawingContext, selection-or-whole → Task 2 ✓ · PPTX raster + pptxgenjs + WriteBytes → Task 3 ✓ · context-menu Export submenu → Task 1 ✓ · pptxgenjs dependency → Task 1 ✓ · `$service` binding instead of the single-instance extension seam (spec Open Item #2) → resolved, Global Constraints + Task 1 ✓.

**2. Placeholder scan:** Code is concrete. Three explicitly-flagged verify points (Nodes count accessor, Rect field names, pptxgenjs `write` signature) and one spike (SVG origin translation, Task 2 Step 3) are genuine API confirmations with named fallbacks — not hand-waves. The e2e harness step names a fallback if no `_electron` harness exists.

**3. Type/name consistency:** `DiagramExportService.Key`, `ExportSvgCommand`/`ExportPptxCommand`, `activeDiagram()`/`canExportActive()`, `exportActive('svg'|'pptx')` consistent across tasks. `renderDiagramSvg` returns `{svg,width,height}` consumed identically in `exportSvg`/`exportPptx`. `unionOfNodeBounds` signature stable. `rasterizeSvgToPng`/`pngToDataUrl`/`buildPptx` names match their call sites in `exportPptx`.

## Open Items Carried To SP2

- Title-bar File menu (a net-new in-renderer menu-bar host) surfaces the same two commands — its own plan.
- Selection *fidelity*: this plan clips to selection bounds (may show slivers of adjacent shapes); refine to selected-visuals-only if it reads poorly.

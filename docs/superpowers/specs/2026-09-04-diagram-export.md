# Plexus Diagram Export (SVG + PPTX)

**Status**: Design — approved forks, pending spec review
**Date**: 2026-09-04

## 1. Goal

Let the user export the active diagram's visual to **Vector Graphics (SVG)** or
**PowerPoint (PPTX)** from two surfaces — the diagram's right-click context menu
and a new **File** menu in the title bar — through one unified handler that picks
a save location/filename via a native dialog and writes the chosen format.

Export captures the **current selection if any, else the whole diagram**.

## 2. Locked Decisions

| Fork | Decision |
| --- | --- |
| Surfaces | **Both**: diagram context menu **and** a new title-bar File menu. |
| PPTX content | **One slide, diagram embedded as a high-res PNG** (rasterized from the SVG). |
| Extent | **Selection if any, else whole diagram** (fit to content). |
| SVG production | Mural `HeadlessTarget` + `SvgDrawingContext.ToSvg(w,h)` — renderer-only. |
| Save | Existing `FileSystemService` — `SaveFileAs` (SVG text) / `WriteBytes` (PPTX). |
| New dependency | `pptxgenjs` (pure-JS, renderer-compatible). |

## 3. Architecture

All export logic runs in the **renderer** (no new main-process code; the existing
`fs` IPC handles the file dialog + writes). Three parts:

1. **Export engine** — `DiagramExportService` (renderer service): the unified
   handler. Renders the diagram to SVG once, then finalizes per format.
2. **Command seam** — two `CommandDefinition`s + one `IDiagramCommandExtension`
   so both menus reference command ids, not the service directly.
3. **Two menu surfaces** — the existing `DiagramContextMenu`, and a net-new
   in-renderer **title-bar menu bar** (there is no app menu today; the frameless
   custom title bar means a native Electron menu can't be shown).

### 3.1 Export engine — `DiagramExportService`

`src/renderer/src/modules/diagram-export/services/diagram-export-service.ts`

```
renderDiagramSvg(doc: DiagramDocument): { svg: string; width: number; height: number }
  diagram = doc.ActiveView                                  // Mural Diagram (Selector)
  bounds  = diagram.SelectionCount > 0
              ? Rect(diagram.SelectionLeft/Top/Width/Height) // selection
              : unionOfNodeBounds(doc.Nodes)                 // whole diagram
  target  = new HeadlessTarget(bounds.Width, bounds.Height, diagram.ItemsPanelInstance)
  dc      = new SvgDrawingContext(); target.Render(dc)       // Render() calls Flush() first
  svg     = dc.ToSvg(bounds.Width, bounds.Height)
  (translate content so `bounds` origin maps to 0,0 — see §5 open item)

exportSvg(doc):  { svg } = renderDiagramSvg(doc)
                 fs.SaveFileAs(svg, { Title:"Export as SVG", DefaultPath: doc.Title+".svg",
                                      Filters:[{ Name:"SVG Image", Extensions:["svg"] }] })

exportPptx(doc): { svg, width, height } = renderDiagramSvg(doc)
                 png  = await rasterize(svg, width, height, scale=2)   // Image + canvas.toBlob
                 pptx = new pptxgenjs(); slide = pptx.addSlide()
                 slide.addImage({ data: png-dataURI, x,y,w,h fit to slide })
                 bytes = await pptx.write("arraybuffer")               // Uint8Array
                 path  = await fs.SaveFileAs("", { ...pptx filter })   // dialog → path
                 if (path) await fs.WriteBytes(path, bytes)
```

- `unionOfNodeBounds` unions `Figure.Left/Top/BaseWidth/BaseHeight` over `doc.Nodes`
  (Mural's whole-diagram content bounds are private; replicate).
- `rasterize`: build an `Image` from the SVG data URL, draw to a `canvas` at
  `scale×` for crispness, `canvas.toBlob("image/png")` → `Uint8Array`. Pure browser,
  no native deps. (`FileTarget.Save()` is a stub in this Mural build — not used.)
- **Binary save**: `SaveFileAs` writes UTF-8 only, so PPTX uses `SaveFileAs("")` to
  get the path via the dialog, then `WriteBytes(path, bytes)`. Both already exist on
  `FileSystemService`. (Alternative: add a `SaveFileBytesAs` IPC — deferred; the
  two-step reuses existing infra.)

### 3.2 Command seam

`src/renderer/src/modules/diagram-export/diagram-export.module.mu`

Two `CommandDefinition`s bound to `DiagramEditingContext`:
`diagram.export.svg` ("Vector Graphics (SVG)") and `diagram.export.pptx`
("PowerPoint (PPTX)"), `Group = "export"`.

`src/renderer/src/modules/diagram-export/services/diagram-export-command.ts` —
`IDiagramCommandExtension` (registered under `DiagramCommandExtensionKey`):
`handles(id)` matches the two ids; `execute(doc, id)` calls the service's
`exportSvg`/`exportPptx`; `canExecute(doc)` = has an active diagram with ≥1 node.

**Open integration point (verify in plan):** `PlexusDiagramDocument.Execute`
resolves `DiagramCommandExtensionKey` — confirm the DI resolves **all** registered
extensions (composite) or only one. Today `arch-edit-viewpoints` is the sole
extension. If single-resolution, either (a) register a composite that fans out, or
(b) fold export handling into the existing routing. Resolve during planning.

### 3.3 Surface 1 — context menu

Add to `@DiagramContextMenu` (`diagram.resources.mu`, before "Format Shape"):
```
MenuSeparator
MenuItem [ Header = "Export" ] {
    MenuItem [ Header = "Vector Graphics (SVG)", Command = <diagram.export.svg> ]
    MenuItem [ Header = "PowerPoint (PPTX)",     Command = <diagram.export.pptx> ]
}
```
(nested-`MenuItem` submenu, the project-explorer "Generate Presentation" pattern.)

### 3.4 Surface 2 — title-bar File menu (net-new)

`src/renderer/src/window/title-bar.resources.mu` gains a horizontal **menu bar**
strip: a `File` button that opens a dropdown containing `Export ▸ SVG / PPTX`,
bound to the same command ids. Minimal but structured to add `Edit`/`View` later.

**Implementation unknown (resolve in plan):** the exact Mural composition for a
menu-bar dropdown — a `Button` + `Popup`/`ContextMenu`, or a dedicated `Menu`
control. The context menu proves the item/command primitives exist; the menu-bar
**host** is the new UI. A short spike confirms the control before building.

## 4. Decomposition

Two sub-projects, each independently useful; build in order:

- **SP1 — Export engine + context menu.** Delivers working SVG/PPTX exports via
  right-click. Includes: `DiagramExportService`, the two commands + extension, the
  context-menu submenu, `pptxgenjs` dependency, the raster + save wiring. Verifiable
  end-to-end (right-click → save → file on disk).
- **SP2 — Title-bar File menu.** The in-renderer menu-bar host in the title bar,
  surfacing the same two command ids. Pure UI + wiring on top of SP1's commands.

## 5. Open Items (resolve during planning/spikes)

1. **SVG origin translation** — `HeadlessTarget` renders `ItemsPanelInstance` in
   canvas coordinates; the export must translate so `bounds` maps to `(0,0)` and
   size to `bounds`. Confirm whether to pass a clipped/transformed content root or
   post-process the SVG viewBox.
2. **`DiagramCommandExtensionKey` cardinality** — single vs composite (§3.2).
3. **Menu-bar control** — the Mural dropdown-host composition (§3.4).
4. **Selection fidelity** — rendering `ItemsPanelInstance` draws ALL nodes; for a
   *selection* export, either clip to the selection bounds (simplest, may show
   partial neighbors) or render only selected `Visual`s. Start with bounds-clip;
   refine if needed.

## 6. Testing

- Engine unit-ish: `unionOfNodeBounds` over synthetic `Figure`s; `renderDiagramSvg`
  returns non-empty `<svg>` with expected width/height for a fixture diagram.
- Raster: `rasterize` yields a PNG `Uint8Array` (PNG magic bytes) for a known SVG.
- PPTX: `exportPptx` produces a non-empty zip (PK magic) via `pptxgenjs.write`.
- Playwright `_electron`: right-click → Export ▸ SVG writes a `.svg`; the File menu
  path triggers the same command. (Follows the repo's `_electron` test convention.)

## 7. Out of Scope

- Native editable PPTX shapes (raster image only).
- PDF/PNG direct export (SVG + PPTX only for now).
- Additional title-bar menus (Edit/View) — the bar is built to grow, unused now.
- A `SaveFileBytesAs` IPC (the two-step `SaveFileAs`+`WriteBytes` suffices).

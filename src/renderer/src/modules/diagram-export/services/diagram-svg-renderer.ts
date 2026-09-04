import { Visual, Visibility, type DrawingContext } from '@pragmatic-tech-ai/mural/runtime'
import { Rect, SvgDrawingContext, TranslateTransform } from '@pragmatic-tech-ai/mural/visual-engine'
import type { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'

// ── Rendering approach ─────────────────────────────────────────────────────────
// We CANNOT hand the live diagram's ItemsPanelInstance to a HeadlessTarget:
// PresentationTarget's ctor calls SetTarget on the content visual, which throws
// "Visual is already attached to a host" because that panel is still mounted in
// the live diagram. Instead we walk the (already-arranged) visual tree in place
// and paint each node into an SvgDrawingContext — a faithful, read-only replica
// of HeadlessTarget.renderTree (translate by ArrangedRect, honour Clip/ChildClip,
// call Render, recurse). Nothing is reparented, so the live view is untouched.
//
// The tree is rendered at canvas-space coordinates (the panel sits BELOW the
// camera transform), so we shift the context by (-bounds.X, -bounds.Y) first,
// mapping the chosen bounds' top-left to (0,0); ToSvg(w,h) then emits
// viewBox="0 0 w h", cropping the SVG to those bounds.
//
// Content bounds come from the panel's ARRANGED children, not from doc.Nodes: a
// diagram's content VMs (NodeViewModel / ArchNodeVM) carry NO geometry — their
// container Figures own it, and those exist only once the Diagram has arranged
// them. The panel's visual children ARE those arranged figures (plus connector
// visuals, which mount into the same panel), each carrying a canvas-space
// ArrangedRect. Reading geometry off doc.Nodes yields a zero rect → a 1×1 SVG.
// ─────────────────────────────────────────────────────────────────────────────

// Shared SVG renderer for a diagram's visual tree, used by both the live-editor
// export (DiagramExportService) and the headless explorer export
// (DiagramHeadlessRenderer). Stateless — all members are static.
export class DiagramSvgRenderer
{
  // Render a document's active view — the selection if any items are selected,
  // else the whole arranged content — to an SVG string sized to those bounds with
  // the origin at (0,0). Throws if the document has no active view.
  public static renderDocument(doc: DiagramDocument): { svg: string; width: number; height: number }
  {
    const diagram = doc.ActiveView
    if (diagram === undefined) throw new Error('diagram has no active view to export')

    const selection = diagram.SelectionCount > 0
      ? new Rect(diagram.SelectionLeft, diagram.SelectionTop, diagram.SelectionWidth, diagram.SelectionHeight)
      : undefined

    return this.renderPanel(diagram.ItemsPanelInstance as unknown as Visual | undefined, selection)
  }

  // Render an arranged items-panel to SVG. `selection`, when given, crops to that
  // canvas-space rect; otherwise the panel's arranged content box is used. The
  // headless renderer calls this directly with its offscreen panel (no selection).
  public static renderPanel(
    panel: Visual | undefined,
    selection?: Rect,
  ): { svg: string; width: number; height: number }
  {
    const bounds = selection ?? this.contentBounds(panel)
    const width  = Math.max(1, Math.ceil(bounds.Width))
    const height = Math.max(1, Math.ceil(bounds.Height))

    const dc = new SvgDrawingContext()

    // Map content origin → (0,0): translate by -bounds.X / -bounds.Y so the chosen
    // bounds' top-left lands at the SVG's coordinate origin, then paint the live
    // tree in place (no reparenting — see the header note).
    dc.PushTransform(new TranslateTransform(-bounds.X, -bounds.Y))
    if (panel !== undefined) this.paintVisualTree(panel, dc)
    dc.Pop()

    return { svg: dc.ToSvg(width, height), width, height }
  }

  // Union of the panel's arranged children (canvas-space). Returns a zero Rect
  // when the panel is absent or has no arranged content.
  public static contentBounds(panel: Visual | undefined): Rect
  {
    if (panel === undefined) return new Rect(0, 0, 0, 0)

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const child of panel.visualChildren) {
      const r = child.ArrangedRect
      if (r.Width <= 0 || r.Height <= 0) continue
      minX = Math.min(minX, r.X); minY = Math.min(minY, r.Y)
      maxX = Math.max(maxX, r.X + r.Width); maxY = Math.max(maxY, r.Y + r.Height)
    }
    if (!Number.isFinite(minX)) return new Rect(0, 0, 0, 0)
    return new Rect(minX, minY, maxX - minX, maxY - minY)
  }

  // Paint a visual subtree into `dc` without taking ownership of it — mirrors
  // HeadlessTarget.renderTree using only public Visual APIs.
  public static paintVisualTree(visual: Visual, dc: DrawingContext): void
  {
    if (visual.Visibility !== Visibility.Visible) return

    const rect = visual.ArrangedRect
    const needsTranslate = rect.X !== 0 || rect.Y !== 0
    if (needsTranslate) dc.PushTransform(new TranslateTransform(rect.X, rect.Y))

    const clip = visual.Clip
    if (clip !== undefined) dc.PushClip(clip)

    visual.Render(dc)

    const childClip = visual.ChildClip
    if (childClip !== undefined) dc.PushClip(childClip)
    for (const child of visual.visualChildren) this.paintVisualTree(child, dc)
    if (childClip !== undefined) dc.Pop()

    if (clip !== undefined) dc.Pop()
    if (needsTranslate) dc.Pop()
  }
}

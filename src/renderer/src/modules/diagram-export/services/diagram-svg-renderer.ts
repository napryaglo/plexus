import { Rect, HeadlessTarget, SvgDrawingContext, TranslateTransform } from '@pragmatic-tech-ai/mural/visual-engine'
import type { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'

// ── Translation approach (SPIKE result) ───────────────────────────────────────
// HeadlessTarget.renderTree renders every child at its canvas-space ArrangedRect
// coordinates — it does NOT auto-translate to a content origin. Therefore we
// must shift the drawing context by (-bounds.X, -bounds.Y) before calling
// target.Render(dc) so that the bounds' top-left maps to (0,0) in the SVG.
// We chose Fallback 1: dc.PushTransform(new TranslateTransform(-x, -y)) around
// target.Render(dc). ToSvg(width, height) then emits viewBox="0 0 w h" and the
// SVG is correctly cropped to the chosen bounds.
// ─────────────────────────────────────────────────────────────────────────────

interface NodeBox { Left: number; Top: number; BaseWidth: number; BaseHeight: number }

// Union of every node's canvas-space bounding box.  Returns a zero Rect when
// there are no nodes (the diagram is empty and export is guarded upstream).
export function unionOfNodeBounds(nodes: Iterable<NodeBox>): Rect
{
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.Left);               minY = Math.min(minY, n.Top)
    maxX = Math.max(maxX, n.Left + n.BaseWidth);  maxY = Math.max(maxY, n.Top + n.BaseHeight)
  }
  if (!isFinite(minX)) return new Rect(0, 0, 0, 0)
  return new Rect(minX, minY, maxX - minX, maxY - minY)
}

// Render the diagram — the selection if any items are selected, else the full
// node content — to an SVG string sized to those bounds with the origin at
// (0,0). Throws if the document has no active view.
export function renderDiagramSvg(
  doc: DiagramDocument,
): { svg: string; width: number; height: number }
{
  const diagram = doc.ActiveView
  if (diagram === undefined) throw new Error('diagram has no active view to export')

  const bounds = diagram.SelectionCount > 0
    ? new Rect(
        diagram.SelectionLeft,
        diagram.SelectionTop,
        diagram.SelectionWidth,
        diagram.SelectionHeight,
      )
    : unionOfNodeBounds(doc.Nodes as unknown as Iterable<NodeBox>)

  const width  = Math.max(1, Math.ceil(bounds.Width))
  const height = Math.max(1, Math.ceil(bounds.Height))

  const panel = diagram.ItemsPanelInstance
  const content = panel ?? diagram

  const target = new HeadlessTarget(width, height, content)
  const dc = new SvgDrawingContext()

  // Map content origin → (0,0): translate by -bounds.X / -bounds.Y so the
  // chosen bounds' top-left lands at the SVG's coordinate origin.
  dc.PushTransform(new TranslateTransform(-bounds.X, -bounds.Y))
  target.Render(dc)
  dc.Pop()

  return { svg: dc.ToSvg(width, height), width, height }
}

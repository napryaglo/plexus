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
// ─────────────────────────────────────────────────────────────────────────────

// Paint a visual subtree into `dc` without taking ownership of it — mirrors
// HeadlessTarget.renderTree using only public Visual APIs. Exported for tests.
export function paintVisualTree(visual: Visual, dc: DrawingContext): void
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
  for (const child of visual.visualChildren) paintVisualTree(child, dc)
  if (childClip !== undefined) dc.Pop()

  if (clip !== undefined) dc.Pop()
  if (needsTranslate) dc.Pop()
}

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

  const content = (diagram.ItemsPanelInstance ?? diagram) as unknown as Visual

  const dc = new SvgDrawingContext()

  // Map content origin → (0,0): translate by -bounds.X / -bounds.Y so the
  // chosen bounds' top-left lands at the SVG's coordinate origin, then paint the
  // live tree in place (no reparenting — see the header note).
  dc.PushTransform(new TranslateTransform(-bounds.X, -bounds.Y))
  paintVisualTree(content, dc)
  dc.Pop()

  return { svg: dc.ToSvg(width, height), width, height }
}

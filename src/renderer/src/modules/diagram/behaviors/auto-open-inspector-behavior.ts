import { Diagram, DiagramDocument, type InspectorService } from '@visualisation-sub/mural/framework'

// Auto-open the document's Format Shape inspector the FIRST time a shape is
// selected on its canvas. After that first open it does nothing — if the user
// closes the panel it stays closed, and they reopen it via the canvas context
// menu ("Format Shape"). This is the primary way the panel appears; the menu
// command is the manual fallback.
//
// A behavior (MVVM's third leg): it reads VIEW state (the Diagram's
// SelectionCount) — which a view-model may not — and translates it into a
// service write (InspectorService.Add). It holds only view-transient lifecycle
// state (the one-shot `opened` latch + listener handles); the inspector VM and
// its selection tracking live on the DiagramDocument.
//
// Wired from the bootstrap (main.js) after the document is created. It watches
// the document's published ActiveView rather than the canvas Visual directly, so
// it needs no hook into the template-materialized tree: when the canvas mounts
// and publishes itself onto ActiveView, we attach the selection listener then.
export function attachAutoOpenInspector(
    doc: DiagramDocument,
    inspectors: InspectorService,
): () => void
{
    let opened = false
    let detachSelection: (() => void) | undefined

    const onSelectionCountChanged = (): void =>
    {
        if (opened) return
        const view = doc.ActiveView
        if (view === undefined || view.SelectionCount === 0) return
        inspectors.Add(doc.Inspector)
        opened = true
        // One-shot: drop the selection listener so later selections don't re-add
        // (the Add() dedupe would re-surface it anyway, defeating "respect close").
        detachSelection?.()
        detachSelection = undefined
    }

    // (Re)attach the selection listener to whatever Diagram is currently the
    // document's ActiveView. Fired on ActiveView changes (the canvas publishing
    // itself, or a tab switch) and once eagerly at attach time.
    const rebindView = (): void =>
    {
        detachSelection?.()
        detachSelection = undefined
        const view = doc.ActiveView
        if (opened || view === undefined) return
        view.AddPropertyChangedListener(Diagram.SelectionCountKey, onSelectionCountChanged)
        detachSelection = (): void =>
            view.RemovePropertyChangedListener(Diagram.SelectionCountKey, onSelectionCountChanged)
        // A shape may already be selected by the time the view mounts.
        onSelectionCountChanged()
    }

    doc.AddPropertyChangedListener(DiagramDocument.ActiveViewKey, rebindView)
    rebindView()

    return (): void =>
    {
        doc.RemovePropertyChangedListener(DiagramDocument.ActiveViewKey, rebindView)
        detachSelection?.()
    }
}

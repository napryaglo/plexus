import {
    MetaData,
    Model,
    ServiceBase,
    ServiceKey,
    type IServiceProvider,
} from '@visualisation-sub/mural/runtime'
import {
    ConnectorEndpoint,
    DiagramDocument,
} from '@visualisation-sub/mural/framework'

// DiagramWorkspaceService — owns Plexus's seeded diagram DOCUMENT (an IDocument),
// ported from the Diagrammer demo (demo/demos/diagram).
//
// The service no longer builds or holds a Diagram control. The document is what
// the editor hosts: the app opens it into the DocumentsContentHostService (see
// main.js), which presents it in the Content region through
// `DataTemplate[DataType=DiagramDocument]` — a markup template that materializes
// the Diagram control IN-TREE (so its adorners mount against a live AdornerLayer
// with no detached-build re-assert workaround). The control publishes itself
// back onto the document's ActiveView (IDiagramViewHost), so the shell's
// Commands / Inspector regions reach its editing commands + selection-format
// state via `$service(ContentHostService).ActiveDocument.ActiveView.<X>`.
//
// In-memory only: no DiagramStorageKey backend, so the seeded scene resets each
// session (matches the demo's optional-storage default).
export class DiagramWorkspaceService extends ServiceBase
{
    public static readonly Key = new ServiceKey<DiagramWorkspaceService>('DiagramWorkspaceService')

    public static readonly DocumentKey = Model.RegisterProperty<DiagramDocument>(
        DiagramWorkspaceService, 'Document', undefined as unknown as DiagramDocument, MetaData.None)

    constructor(provider: IServiceProvider)
    {
        super(provider)

        const doc = new DiagramDocument()
        doc.Title = 'Untitled Diagram'
        this.seed(doc)
        this.set_property_value(DiagramWorkspaceService.DocumentKey, doc)
    }

    public get Document(): DiagramDocument { return this.get_property_value(DiagramWorkspaceService.DocumentKey) }

    // Seed a small scene so the editor doesn't open empty — same shapes and
    // connectors the demo bootstrap places.
    private seed(doc: DiagramDocument): void
    {
        const rect    = doc.CreateNode('rectangle', 60, 60)
        const ellipse = doc.CreateNode('ellipse', 220, 60)
        const squir   = doc.CreateNode('squircle', 60, 200)
        const flower  = doc.CreateNode('flower', 220, 200)
        doc.CreateNode('heart', 380, 60)
        if (rect !== null && ellipse !== null)
        {
            doc.CreateConnector(new ConnectorEndpoint({ Node: rect }), new ConnectorEndpoint({ Node: ellipse }))
        }
        if (squir !== null && flower !== null)
        {
            doc.CreateConnector(new ConnectorEndpoint({ Node: squir }), new ConnectorEndpoint({ Node: flower }))
        }
        doc.Status = `Ready. ${doc.Nodes.Count} nodes, ${doc.Connectors.Count} connectors.`
    }
}

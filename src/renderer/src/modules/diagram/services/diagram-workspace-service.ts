import {
    MetaData,
    MuralBase,
    ServiceBase,
    ServiceKey,
    type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'
import {
    DiagramDocument,
} from '@pragmatic-tech-ai/mural/framework'

// DiagramWorkspaceService — owns Plexus's in-memory diagram DOCUMENT (an
// IDocument), ported from the Diagrammer demo (demo/demos/diagram).
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
// The document opens EMPTY — the seeded demo canvas (sample shapes/connectors)
// was retired in SP4a; architecture diagrams get their content from the bound
// ArchModel, standalone diagrams from their own `.diagram` file.
export class DiagramWorkspaceService extends ServiceBase
{
    public static readonly Key = new ServiceKey<DiagramWorkspaceService>('DiagramWorkspaceService')

    public static readonly DocumentKey = MuralBase.RegisterProperty<DiagramDocument>(
        DiagramWorkspaceService, 'Document', undefined as unknown as DiagramDocument, MetaData.None)

    constructor(provider: IServiceProvider)
    {
        super(provider)

        const doc = new DiagramDocument()
        doc.Title = 'Untitled Diagram'
        this.set_property_value(DiagramWorkspaceService.DocumentKey, doc)
    }

    public get Document(): DiagramDocument { return this.get_property_value(DiagramWorkspaceService.DocumentKey) }
}

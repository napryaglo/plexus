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

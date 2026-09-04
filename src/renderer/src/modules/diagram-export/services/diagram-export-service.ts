import {
  MetaData, MuralBase, RelayCommand, ServiceBase, ServiceKey,
  type ICommand, type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'
import {
  ContentHostService, DiagramDocument,
  type DocumentsContentHostService,
} from '@pragmatic-tech-ai/mural/framework'
import { FileSystemService } from '../../../services/file-system/file-system-service.js'
import { DiagramSvgRenderer } from './diagram-svg-renderer.js'
import { rasterizeSvgToPng, pngToDataUrl } from './svg-raster.js'
import { buildPptx } from './pptx-builder.js'

// The two diagram export formats.
export enum ExportFormat
{
  Svg  = 'svg',
  Pptx = 'pptx',
}

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
      new RelayCommand(() => { void this.exportActive(ExportFormat.Svg) }, gate))
    this.set_property_value(DiagramExportService.ExportPptxCommandKey,
      new RelayCommand(() => { void this.exportActive(ExportFormat.Pptx) }, gate))
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

  // Test-only: render the active diagram's SVG synchronously for e2e assertions.
  public _renderSvgForTest(): string | undefined
  {
    const doc = this.activeDiagram()
    return doc ? DiagramSvgRenderer.renderDocument(doc).svg : undefined
  }

  protected async exportActive(format: ExportFormat): Promise<void>
  {
    const doc = this.activeDiagram()
    if (doc === undefined) return
    if (format === ExportFormat.Svg) return this.exportSvg(doc)
    return this.exportPptx(doc) // Task 3
  }

  private async exportSvg(doc: DiagramDocument): Promise<void>
  {
    const { svg } = DiagramSvgRenderer.renderDocument(doc)
    const fs = this.Provider.getRequired(FileSystemService.Key)
    await fs.SaveFileAs(svg, {
      Title:       'Export as SVG',
      DefaultPath: `${doc.Title || 'diagram'}.svg`,
      Filters:     [{ Name: 'SVG Image', Extensions: ['svg'] }],
    })
  }

  private async exportPptx(doc: DiagramDocument): Promise<void>
  {
    const { svg, width, height } = DiagramSvgRenderer.renderDocument(doc)
    const png = await rasterizeSvgToPng(svg, width, height, 2)
    const pptx = await buildPptx(pngToDataUrl(png), width, height)
    const fs = this.Provider.getRequired(FileSystemService.Key)
    const path = await fs.SaveFileAs('', {
      Title:       'Export as PowerPoint',
      DefaultPath: `${doc.Title || 'diagram'}.pptx`,
      Filters:     [{ Name: 'PowerPoint Presentation', Extensions: ['pptx'] }],
    })
    if (path !== null) await fs.WriteBytes(path, pptx)
  }
}

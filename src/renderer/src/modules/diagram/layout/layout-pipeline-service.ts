import {
    MetaData,
    Model,
    RelayCommand,
    ServiceBase,
    ServiceKey,
    type ICommand,
    type IServiceProvider,
} from '@pragmatic-lab/mural/runtime'
import {
    GetPipelineCatalog,
    BuildPipeline,
    LoadElementRepository,
    type PipelineConfiguration,
    type CatalogSlot,
} from '@pragmatic-lab/fresco'

import {
    extract,
    computeOutcome,
    type FigureLike,
    type ConnectorLike,
    type NodeSize,
    type PositionSet,
} from './diagram-graph-adapter.js'
import { planForMode, type RunMode } from './run-modes.js'
import { LayoutPresetsStore } from './layout-presets-store.js'
import { LayoutInspector } from './layout-inspector.js'
import { DiagramWorkspaceService } from '../services/diagram-workspace-service.js'

// Fallback node size when a figure has not been measured yet (RenderSize 0).
const FALLBACK_SIZE: NodeSize = { width: 80, height: 40 }

const DEFAULT_CONFIG: PipelineConfiguration = { name: 'default', transforms: [], layout: {} }

// LayoutPipelineService — composes a Fresco layout pipeline and runs it on
// the active diagram. Holds the current PipelineConfiguration and run mode,
// exposes the catalog for the builder UI, manages named presets, and applies
// results (or stages a preview) via the pure adapter + run-mode logic.
//
// The pure work (extract / computeOutcome / planForMode) lives in unit-tested
// modules; this service is the mural-framework seam that reaches the active
// document and writes positions back.
export class LayoutPipelineService extends ServiceBase
{
    public static readonly Key = new ServiceKey<LayoutPipelineService>('LayoutPipelineService')

    // Observable so the run-mode selector and status readout update in the UI.
    public static readonly ModeKey = Model.RegisterProperty<RunMode>(
        LayoutPipelineService, 'Mode', 'positions', MetaData.None)
    public static readonly StatusKey = Model.RegisterProperty<string>(
        LayoutPipelineService, 'Status', '', MetaData.None)

    // The catalog is static data; the builder UI enumerates it.
    public readonly Catalog: CatalogSlot[] = GetPipelineCatalog()

    // A read-only, catalog-derived summary of the pipeline slots and how
    // many strategies each offers — shown in the builder until per-slot
    // interactive editing lands.
    public readonly StagesSummary: string = GetPipelineCatalog()
        .map((s) => `${s.slotId}  (${s.strategies.length})`)
        .join('\n')

    // The pipeline the user is composing. Mutated by the builder UI; read
    // afresh on each Run. Persisted per-diagram in a later task.
    public Config: PipelineConfiguration = structuredClone(DEFAULT_CONFIG)

    // Target positions staged by a preview run, awaiting an explicit Apply.
    public PreviewPositions: PositionSet[] | undefined

    // The inspector panel host added to the shell's Inspector region. The
    // builder template renders against this; its bindings reach back here
    // via $service(LayoutPipelineService).
    public readonly Inspector = new LayoutInspector()

    // Selectable run modes, for the mode buttons in the builder.
    public readonly ModeOptions: RunMode[] = ['positions', 'preview']

    public readonly RunCommand: ICommand = new RelayCommand(() => this.Run())
    public readonly ApplyPreviewCommand: ICommand = new RelayCommand(() => this.applyPreview())
    public readonly CancelPreviewCommand: ICommand = new RelayCommand(() => this.cancelPreview())
    public readonly UsePositionsModeCommand: ICommand = new RelayCommand(() => { this.Mode = 'positions' })
    public readonly UsePreviewModeCommand: ICommand = new RelayCommand(() => { this.Mode = 'preview' })

    private _presets: LayoutPresetsStore | undefined

    constructor(provider: IServiceProvider)
    {
        super(provider)
    }

    public get Mode(): RunMode { return this.get_property_value(LayoutPipelineService.ModeKey) }
    public set Mode(v: RunMode) { this.set_property_value(LayoutPipelineService.ModeKey, v) }

    public get Status(): string { return this.get_property_value(LayoutPipelineService.StatusKey) }
    private set Status(v: string) { this.set_property_value(LayoutPipelineService.StatusKey, v) }

    // Lazily created so a non-desktop context (should not happen in the
    // renderer) doesn't fail at construction just because presets are unused.
    public get Presets(): LayoutPresetsStore
    {
        return (this._presets ??= new LayoutPresetsStore())
    }

    // Compose the pipeline from Config and run it on the active diagram.
    // In 'positions' mode the new positions are written to the figures; in
    // 'preview' mode they are staged in PreviewPositions for a ghost overlay
    // and an explicit Apply (see applyPreview).
    public Run(): void
    {
        const doc = this.Provider.getRequired(DiagramWorkspaceService.Key).Document

        // Figures (not Groups) carry Left/Top; treat those as the node set.
        const figures = (doc.Nodes.ToArray() as unknown as FigureLike[]).filter(
            (n) => typeof n.Left === 'number' && typeof n.Top === 'number',
        )
        if (figures.length === 0) { this.Status = 'Diagram has no nodes to lay out.'; return }
        const connectors = doc.Connectors.ToArray() as unknown as ConnectorLike[]

        const { graph, index } = extract(figures, connectors)

        let outcome
        try {
            const { graphPipeline, layoutPipeline } = BuildPipeline(this.Config, LoadElementRepository())
            const transformed = graphPipeline.Apply(graph)
            const positions = layoutPipeline.Apply(transformed)
            outcome = computeOutcome(index, transformed, positions, (f) => this.sizeOf(f))
        } catch (err) {
            this.Status = `Pipeline error: ${(err as Error).message}`
            return
        }

        const plan = planForMode(this.Mode, outcome)

        if (plan.previewOnly) {
            this.PreviewPositions = outcome.setPositions
            this.Status = `Preview: ${outcome.setPositions.length} nodes. Apply to commit.`
            return
        }

        this.applyPositions(index, plan.mutation.setPositions)
        this.PreviewPositions = undefined
        this.Status = `Laid out ${plan.mutation.setPositions.length} nodes.`
    }

    // Commit a staged preview (positions mode) and clear it.
    public applyPreview(): void
    {
        if (this.PreviewPositions === undefined) return
        const doc = this.Provider.getRequired(DiagramWorkspaceService.Key).Document
        const index = new Map<string, FigureLike>()
        for (const n of doc.Nodes.ToArray()) {
            const f = n as FigureLike
            if (f.Id !== undefined) index.set(f.Id, f)
        }
        this.applyPositions(index, this.PreviewPositions)
        this.Status = `Applied ${this.PreviewPositions.length} nodes.`
        this.PreviewPositions = undefined
    }

    public cancelPreview(): void
    {
        this.PreviewPositions = undefined
        this.Status = 'Preview cancelled.'
    }

    private applyPositions(index: Map<string, FigureLike>, sets: PositionSet[]): void
    {
        for (const s of sets) {
            const fig = index.get(s.id)
            if (fig === undefined) continue
            fig.Left = s.left
            fig.Top = s.top
        }
    }

    private sizeOf(fig: FigureLike): NodeSize
    {
        const rs = (fig as unknown as { RenderSize?: { Width: number; Height: number } }).RenderSize
        if (rs && rs.Width > 0 && rs.Height > 0) return { width: rs.Width, height: rs.Height }
        return FALLBACK_SIZE
    }
}

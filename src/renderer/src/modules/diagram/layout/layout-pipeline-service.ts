import {
    MetaData,
    Model,
    ObservableCollection,
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
import { LayoutStageVM } from './layout-stage-vm.js'
import { DiagramWorkspaceService } from '../services/diagram-workspace-service.js'

// Maps a catalog strategy-slot id to its PipelineConfiguration.layout field.
// graph-transforms is intentionally absent — it is a transform list, not a
// single-select stage.
const SLOT_CONFIG_KEY: Record<string, string> = {
    'layer-assigner':      'layerAssigner',
    'layer-improver':      'layerImprover',
    'first-layer-orderer': 'firstLayerOrderer',
    'dummy-inserter':      'dummyInserter',
    'reorderer':           'reorderer',
    'improver':            'improver',
    'position-computer':   'positionComputer',
    'vertical-aligner':    'verticalAligner',
    'edge-router':         'edgeRouter',
    'port-assigner':       'portAssigner',
}

// 'layer-assigner' -> 'Layer Assigner'
function stageLabel(slotId: string): string
{
    return slotId.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

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

    // Every member bound from the .mu template MUST be a registered property:
    // mural's binding engine reads a path on a Model only via a registered
    // PropertyKey (get_property_value) — it does NOT fall back to plain fields.
    // Plain fields below (Catalog/Config/etc.) are used only from TS.
    public static readonly ModeKey = Model.RegisterProperty<RunMode>(
        LayoutPipelineService, 'Mode', 'positions', MetaData.None)
    public static readonly StatusKey = Model.RegisterProperty<string>(
        LayoutPipelineService, 'Status', '', MetaData.None)
    public static readonly StagesKey = Model.RegisterProperty<ObservableCollection<LayoutStageVM>>(
        LayoutPipelineService, 'Stages', undefined as unknown as ObservableCollection<LayoutStageVM>, MetaData.None)
    public static readonly InspectorKey = Model.RegisterProperty<LayoutInspector>(
        LayoutPipelineService, 'Inspector', undefined as unknown as LayoutInspector, MetaData.None)
    public static readonly RunCommandKey = Model.RegisterProperty<ICommand>(
        LayoutPipelineService, 'RunCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly ApplyPreviewCommandKey = Model.RegisterProperty<ICommand>(
        LayoutPipelineService, 'ApplyPreviewCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly CancelPreviewCommandKey = Model.RegisterProperty<ICommand>(
        LayoutPipelineService, 'CancelPreviewCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly UsePositionsModeCommandKey = Model.RegisterProperty<ICommand>(
        LayoutPipelineService, 'UsePositionsModeCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly UsePreviewModeCommandKey = Model.RegisterProperty<ICommand>(
        LayoutPipelineService, 'UsePreviewModeCommand', undefined as unknown as ICommand, MetaData.None)

    // Plain fields — used only from TS (not bound in markup).
    public readonly Catalog: CatalogSlot[] = GetPipelineCatalog()
    public readonly ModeOptions: RunMode[] = ['positions', 'preview']
    public Config: PipelineConfiguration = structuredClone(DEFAULT_CONFIG)
    public PreviewPositions: PositionSet[] | undefined

    private _presets: LayoutPresetsStore | undefined

    constructor(provider: IServiceProvider)
    {
        super(provider)

        // The inspector panel host added to the shell's Inspector region.
        this.set_property_value(LayoutPipelineService.InspectorKey, new LayoutInspector())

        // One ComboBox row per configurable strategy slot (the transform-list
        // slot is excluded). Selecting a strategy writes its className into
        // Config.layout; "(default)" clears it (framework default applies).
        const stages = new ObservableCollection<LayoutStageVM>()
        for (const slot of this.Catalog)
        {
            if (slot.kind !== 'strategy-slot') continue
            const key = SLOT_CONFIG_KEY[slot.slotId]
            if (key === undefined) continue
            stages.Add(new LayoutStageVM(stageLabel(slot.slotId), slot.strategies, (className) => {
                const layout = this.Config.layout as Record<string, string | null | undefined>
                if (className === undefined) delete layout[key]
                else layout[key] = className
            }))
        }
        this.set_property_value(LayoutPipelineService.StagesKey, stages)

        this.set_property_value(LayoutPipelineService.RunCommandKey, new RelayCommand(() => this.Run()))
        this.set_property_value(LayoutPipelineService.ApplyPreviewCommandKey, new RelayCommand(() => this.applyPreview()))
        this.set_property_value(LayoutPipelineService.CancelPreviewCommandKey, new RelayCommand(() => this.cancelPreview()))
        this.set_property_value(LayoutPipelineService.UsePositionsModeCommandKey, new RelayCommand(() => { this.Mode = 'positions' }))
        this.set_property_value(LayoutPipelineService.UsePreviewModeCommandKey, new RelayCommand(() => { this.Mode = 'preview' }))
    }

    public get Mode(): RunMode { return this.get_property_value(LayoutPipelineService.ModeKey) }
    public set Mode(v: RunMode) { this.set_property_value(LayoutPipelineService.ModeKey, v) }

    public get Status(): string { return this.get_property_value(LayoutPipelineService.StatusKey) }
    private set Status(v: string) { this.set_property_value(LayoutPipelineService.StatusKey, v) }

    public get Stages(): ObservableCollection<LayoutStageVM> { return this.get_property_value(LayoutPipelineService.StagesKey) }
    public get Inspector(): LayoutInspector { return this.get_property_value(LayoutPipelineService.InspectorKey) }
    public get RunCommand(): ICommand { return this.get_property_value(LayoutPipelineService.RunCommandKey) }
    public get ApplyPreviewCommand(): ICommand { return this.get_property_value(LayoutPipelineService.ApplyPreviewCommandKey) }
    public get CancelPreviewCommand(): ICommand { return this.get_property_value(LayoutPipelineService.CancelPreviewCommandKey) }
    public get UsePositionsModeCommand(): ICommand { return this.get_property_value(LayoutPipelineService.UsePositionsModeCommandKey) }
    public get UsePreviewModeCommand(): ICommand { return this.get_property_value(LayoutPipelineService.UsePreviewModeCommandKey) }

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

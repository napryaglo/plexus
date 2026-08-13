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
import { Connector, ContentHostService, DiagramDocument, type DocumentsContentHostService } from '@pragmatic-lab/mural/framework'
import {
    GetPipelineCatalog,
    BuildPipeline,
    LoadElementRepository,
    type PipelineConfiguration,
    type CatalogSlot,
    type EdgeRouting,
    type Edge,
} from '@pragmatic-lab/fresco'

import {
    extract,
    computeOutcome,
    applySides,
    nodeSize,
    type FigureLike,
    type ConnectorLike,
    type ConnectorEdge,
    type EdgeSideLike,
    type NodeSize,
    type PositionSet,
    type SizedLike,
} from './diagram-graph-adapter.js'
import { planForMode, type RunMode } from './run-modes.js'
import { LayoutPresetsStore } from './layout-presets-store.js'
import { LayoutInspector } from './layout-inspector.js'
import { LayoutStageVM } from './layout-stage-vm.js'

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

// Fresco's edge router that emits cardinal sides for the host diagram to
// route natively (rather than Fresco polyline points). When it's the
// selected edge router, the diagram owns port assignment, so the Port
// Assigner stage is disabled and turned off in the config.
const CARDINAL_SIDE_ROUTER = 'CardinalSideRouter'

// Fallback node size when a figure has not been measured yet (RenderSize 0).
const FALLBACK_SIZE: NodeSize = { width: 80, height: 40 }

// MakeAcyclic runs first so a cyclic diagram (feedback / bidirectional
// architecture relationships) is broken into a DAG before the longest-path
// layer assigner — which refuses cyclic input ('longest-path depths require a
// DAG') — ever sees it. It reverses the minimal feedback-arc set; on an
// already-acyclic graph it is a no-op.
const DEFAULT_CONFIG: PipelineConfiguration = { name: 'default', transforms: ['MakeAcyclicTransform'], layout: {} }

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
        // Captured so selecting the native side router (CardinalSideRouter)
        // in the Edge Router can disable + turn off the Port Assigner stage
        // — under native routing the diagram assigns ports itself.
        let portAssignerStage: LayoutStageVM | undefined
        for (const slot of this.Catalog)
        {
            if (slot.kind !== 'strategy-slot') continue
            const key = SLOT_CONFIG_KEY[slot.slotId]
            if (key === undefined) continue

            const isEdgeRouter = slot.slotId === 'edge-router'

            const stage = new LayoutStageVM(stageLabel(slot.slotId), slot.strategies, (spec) => {
                const layout = this.Config.layout as Record<string, unknown>
                if (spec === undefined) delete layout[key]
                else layout[key] = spec

                if (isEdgeRouter && portAssignerStage !== undefined) {
                    if (spec?.className === CARDINAL_SIDE_ROUTER) {
                        // Native routing owns port assignment: skip Fresco's
                        // port assigner and disable its combobox.
                        layout.portAssigner = { off: true }
                        portAssignerStage.Enabled = false
                    } else {
                        // Re-enable and restore the port assigner from its
                        // own current selection.
                        portAssignerStage.Enabled = true
                        portAssignerStage.Reapply()
                    }
                }
            })
            stages.Add(stage)
            if (slot.slotId === 'port-assigner') portAssignerStage = stage
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
        const doc = this.activeDiagram()
        if (doc === undefined) { this.Status = 'Active document is not a diagram.'; return }

        // Figures (not Groups) carry Left/Top; treat those as the node set.
        const figures = (doc.Nodes.ToArray() as unknown as FigureLike[]).filter(
            (n) => typeof n.Left === 'number' && typeof n.Top === 'number',
        )
        if (figures.length === 0) { this.Status = 'Diagram has no nodes to lay out.'; return }
        const connectors = doc.Connectors.ToArray() as unknown as ConnectorLike[]

        const { graph, index, connectorEdges } = extract(figures, connectors)

        let outcome
        let lastRoutes: Map<Edge, EdgeRouting> | undefined
        try {
            const { graphPipeline, layoutPipeline } = BuildPipeline(this.Config, LoadElementRepository())
            const transformed = graphPipeline.Apply(graph)
            const positions = layoutPipeline.Apply(transformed)
            outcome = computeOutcome(index, transformed, positions, (f) => this.sizeOf(f))
            lastRoutes = layoutPipeline.LastRoutes
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
        this.clearConnectorWaypoints(doc)   // layout is the reset: drop user pins, rebuild routing
        this.PreviewPositions = undefined

        let status = `Laid out ${plan.mutation.setPositions.length} nodes.`
        const n = this.applyDiagramSides(connectorEdges, lastRoutes)
        if (n > 0) status += ` Assigned sides to ${n} connectors.`
        this.Status = status
    }

    // Apply any `sides` routing directives the edge router produced onto the
    // connectors, keyed by node-id pair so parallel connectors share a side
    // (the diagram fans them into slots). A point-based router yields no
    // `sides` entries, so this is a no-op unless the native side router ran.
    // Returns the count of connectors assigned.
    private applyDiagramSides(
        connectorEdges: ConnectorEdge[],
        lastRoutes: Map<Edge, EdgeRouting> | undefined,
    ): number
    {
        if (lastRoutes === undefined) return 0
        const byPair = new Map<string, EdgeSideLike>()
        for (const [edge, routing] of lastRoutes) {
            if (routing.kind === 'sides') {
                byPair.set(`${edge.From}|${edge.To}`, { source: routing.source, target: routing.target })
            }
        }
        if (byPair.size === 0) return 0
        return applySides(connectorEdges, byPair)
    }

    // Commit a staged preview (positions mode) and clear it.
    public applyPreview(): void
    {
        if (this.PreviewPositions === undefined) return
        const doc = this.activeDiagram()
        if (doc === undefined) { this.Status = 'Active document is not a diagram.'; return }
        const index = new Map<string, FigureLike>()
        for (const n of doc.Nodes.ToArray()) {
            const f = n as FigureLike
            if (f.Id !== undefined) index.set(f.Id, f)
        }
        this.applyPositions(index, this.PreviewPositions)
        this.clearConnectorWaypoints(doc)   // committing a layout resets manual routing
        this.Status = `Applied ${this.PreviewPositions.length} nodes.`
        this.PreviewPositions = undefined
    }

    // Layout is the single "reset to auto" operation: drop every connector's
    // waypoints (user pins included) so the route rebuilds from scratch. Without
    // this, moving nodes preserves pins (mural's per-move behaviour), leaving a
    // stale hand-route distorting the freshly laid-out diagram.
    private clearConnectorWaypoints(doc: DiagramDocument): void
    {
        for (const c of doc.Connectors.ToArray()) {
            if (c instanceof Connector) c.Waypoints = undefined
        }
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

    // The active tab's document when it's a diagram. In the multi-document
    // shell each diagram (architecture or standalone) opens as its OWN
    // DiagramDocument via the content host; layout must run on whichever is
    // active, not the fixed workspace singleton — same ActiveDocument source
    // the arch binding / viewpoint-scope services read.
    private activeDiagram(): DiagramDocument | undefined
    {
        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        const doc = host?.ActiveDocument
        return doc instanceof DiagramDocument ? doc : undefined
    }

    // Node footprint: VM nodes (Model) expose Width/Height but no RenderSize;
    // Figures expose both. nodeSize prefers Width/Height so VMs don't collapse
    // to the fallback size. See diagram-graph-adapter.nodeSize.
    private sizeOf(fig: FigureLike): NodeSize
    {
        return nodeSize(fig as unknown as SizedLike, FALLBACK_SIZE)
    }
}

import { Connector, ConnectorEndpoint, DiagramDocument, Figure, ToolboxVisualDescriptor } from '@pragmatic-lab/mural/framework'
import type { Entity } from '@pragmatic-lab/todl'
import { TodlVisualResolverKey } from '../../diagram/services/todl-visual-resolver.js'
import type { ArchModel } from './arch-model.js'
import { ArchNodeVM } from './arch-node-vm.js'
import { iconEntityKey } from './arch-icon.js'
import { desiredEdges, edgeKey } from './edge-projection.js'
import { resolveConnectorActions, type ConnectorAction } from './arch-connector-resolver.js'
import { scenarioStepPairs, type FlowEntity } from './scenario-flow.js'
import type { DropCandidateChooserService } from './drop-candidate-chooser-service.js'
import type { WikiService } from '../../../services/wiki/wiki-service.js'

// Synthetic relationship member for a projected scenario step edge, so its
// edgeKey never collides with a real model relationship member.
const SCENARIO_STEP_MEMBER = '__scenario_step__'

// Binds an opened diagram to a project's ArchModel. On every model change it
// rescans doc.Nodes: ArchNodeVMs (and legacy Figures) whose Id is a live entity
// are tracked + labelled (this binds drop-created nodes too, since the drop fires
// notifyChanged after setting the Id); tracked nodes whose entity was deleted are
// removed. Nodes whose Id matches no entity are freeform shapes, left untouched.
export class ArchDiagramBinding
{
    private off: (() => void) | undefined
    private detachView: (() => void) | undefined
    private readonly bound = new Map<string, Figure | ArchNodeVM>()   // entityId -> node
    private readonly boundEdges = new Map<string, Connector>()         // edgeKey -> projected connector
    private scope: string[] = []                                       // selected viewpoints ([] = all)
    private scenarios: string[] = []                                   // scenarios whose steps are shown
    private readonly onActiveViewChanged = (): void => this.attachView()

    public constructor(
        private readonly doc: DiagramDocument,
        public readonly model: ArchModel,
        private readonly chooser?: DropCandidateChooserService,
        private readonly wiki?: WikiService,
    ) {}

    public attach(): void
    {
        this.rescan()
        this.off = this.model.onChanged(() => this.rescan())
        // The canvas view publishes itself on mount (ActiveView); (re)wire the
        // connector-authoring listener whenever it changes.
        this.attachView()
        this.doc.AddPropertyChangedListener(DiagramDocument.ActiveViewKey, this.onActiveViewChanged)
    }

    // Attach the ConnectorCreated listener to the current canvas view. A user-drawn
    // connector routes to handleConnectorCreated (turns the draw into a model ref).
    private attachView(): void
    {
        this.detachView?.()
        this.detachView = undefined
        const view = this.doc.ActiveView
        if (view === undefined) return
        const onConnector = (args: { Source?: ConnectorEndpoint; Target?: ConnectorEndpoint }): void =>
            this.handleConnectorCreated(args.Source?.Node, args.Target?.Node)
        const onDelete = (args: { Items: readonly unknown[]; Shift: boolean }): void =>
            this.handleDeleteRequested(args.Items, args.Shift)
        view.AddConnectorCreatedListener(onConnector)
        view.AddDeleteRequestedListener(onDelete)
        this.detachView = () => {
            view.RemoveConnectorCreatedListener(onConnector)
            view.RemoveDeleteRequestedListener(onDelete)
        }
    }

    // Delete routing: plain Delete is view-only (the standard mutator removes the
    // figures; the entity stays and re-appears in the Model page). Shift+Delete
    // ALSO removes the underlying entity from the model (→ rescan drops the node +
    // its edges everywhere).
    public handleDeleteRequested(items: readonly unknown[], shift: boolean): void
    {
        if (!shift) return
        let removed = false
        for (const it of items) {
            const id = (it as { Id?: string } | undefined)?.Id
            if (id !== undefined && this.bound.has(id)) { this.model.remove(id); removed = true }
        }
        if (removed) void this.model.save()
    }

    // A user drew a connector between two nodes. Reconcile away the raw connector
    // the standard mutator just created (arch diagrams are connector-authoritative),
    // then, when both endpoints are bound arch nodes, resolve the meta-model
    // relationship member(s) and write the ref (0 reject / 1 auto / many chooser).
    // The projection redraws it as a model-backed edge on the ensuing rescan.
    public handleConnectorCreated(source: unknown, target: unknown): void
    {
        const fromId = (source as { Id?: string } | undefined)?.Id
        const toId = (target as { Id?: string } | undefined)?.Id
        this.model.notifyChanged()   // drops the raw connector via reconcile
        if (fromId === undefined || toId === undefined) return
        if (!this.bound.has(fromId) || !this.bound.has(toId)) return
        const srcConcept = this.conceptOf(fromId)
        const tgtConcept = this.conceptOf(toId)
        if (srcConcept === undefined || tgtConcept === undefined) return
        const actions = resolveConnectorActions(this.model.repository(), srcConcept, tgtConcept, this.scopeSet())
        if (actions.length === 0) return
        const apply = (a: ConnectorAction): void => { this.model.addRef(fromId, a.member, toId); void this.model.save() }
        if (actions.length === 1) { apply(actions[0]); return }
        this.chooser?.Show(actions, apply)
    }

    // The concept an already-placed entity instantiates (from the live model).
    private conceptOf(id: string): string | undefined
    {
        return this.model.entities().find((e) => e.id === id)?.concept
    }

    private rescan(): void
    {
        const byId = new Map(this.model.entities().map((e) => [e.id, e]))
        // Bind + derive label/icon for every node that maps to a live entity.
        for (const node of this.doc.Nodes.ToArray()) {
            if (node instanceof ArchNodeVM) {
                const id = node.Id
                if (id === undefined) continue
                const entity = byId.get(id)
                if (entity === undefined) continue
                this.bound.set(id, node)
                node.Label = displayLabel(entity)
                // Key the icon by the entity's stamped icon-annotation resource key
                // (referenced term first, then own concept); fall back to the bare
                // concept when nothing carries an icon (→ default glyph).
                const key = iconEntityKey(this.model.repository(), entity) ?? entity.concept
                node.Descriptor = new ToolboxVisualDescriptor(TodlVisualResolverKey, key)
                node.Concept = entity.concept
                if (this.wiki !== undefined) {
                    const concept = entity.concept
                    void this.wiki.hasWiki(concept).then((h) => {
                        // Guard against a stale rebind: only apply if the node still shows this concept.
                        if (node.Concept === concept) node.HasWiki = h
                    })
                }
            } else if (node instanceof Figure) {
                // Back-compat for any freeform Figure with a matching entity id.
                const id = node.Id
                if (id === undefined) continue
                const entity = byId.get(id)
                if (entity === undefined) continue
                this.bound.set(id, node)
                node.LabelText = displayLabel(entity)
            }
        }
        // Remove tracked nodes whose entity is gone.
        for (const [id, node] of [...this.bound]) {
            if (!byId.has(id)) {
                this.doc.DeleteNodes([node])
                this.bound.delete(id)
            }
        }

        this.projectEdges(byId)
    }

    // Project the model's relationships between placed nodes as connectors, and
    // keep the diagram connector-authoritative: the ONLY connectors between two
    // bound arch nodes are the ones we derive from the model. A raw user-drawn
    // connector (added by the standard mutator) is removed here — SP3 turns the
    // draw gesture into a model ref, which then projects back as a real edge.
    private projectEdges(byId: ReadonlyMap<string, Entity>): void
    {
        const placed = new Map<string, Entity>()
        for (const id of this.bound.keys()) {
            const e = byId.get(id)
            if (e !== undefined) placed.set(id, e)
        }
        const desired = desiredEdges(this.model.repository(), placed, this.scopeSet())

        // Scenario overlay: each active scenario projects its steps as connectors
        // between placed participants. These are model-derived (the steps live in
        // the model), so they are "ours" — the sweep below keeps them and a reload
        // re-projects them from the persisted scenario ids.
        if (this.scenarios.length > 0) {
            const scEnts = this.scenarios
                .map((id) => byId.get(id))
                .filter((e): e is Entity => e !== undefined) as unknown as FlowEntity[]
            for (const [s, d] of scenarioStepPairs(scEnts, new Set(this.bound.keys())))
                desired.add(edgeKey(s, SCENARIO_STEP_MEMBER, d))
        }

        // Add missing projected connectors.
        for (const key of desired) {
            if (this.boundEdges.has(key)) continue
            const [fromId, , toId] = key.split('|')
            const src = this.bound.get(fromId)
            const tgt = this.bound.get(toId)
            if (src === undefined || tgt === undefined) continue
            const c = this.doc.CreateConnector(
                new ConnectorEndpoint({ Node: src }),
                new ConnectorEndpoint({ Node: tgt }),
            )
            if (c !== null) this.boundEdges.set(key, c)
        }
        // Remove projected connectors no longer desired.
        for (const [key, c] of [...this.boundEdges]) {
            if (!desired.has(key)) {
                this.doc.DeleteConnectors([c])
                this.boundEdges.delete(key)
            }
        }
        // Drop any connector between two bound arch nodes that isn't one of ours.
        const ours = new Set<Connector>(this.boundEdges.values())
        const boundNodes = new Set<unknown>(this.bound.values())
        for (const c of this.doc.Connectors.ToArray()) {
            if (ours.has(c)) continue
            if (boundNodes.has(c.Source?.Node) && boundNodes.has(c.Target?.Node)) this.doc.DeleteConnectors([c])
        }
    }

    // Whether an entity is currently placed as a node on this diagram.
    public isPlaced(entityId: string): boolean
    {
        return this.bound.has(entityId)
    }

    // The set of entity ids currently placed on this diagram.
    public placedIds(): ReadonlySet<string>
    {
        return new Set(this.bound.keys())
    }

    // Replace the diagram's selected-viewpoint scope (empty = all).
    public setScope(viewpoints: string[]): void
    {
        this.scope = [...viewpoints]
    }

    // Replace the set of scenarios whose steps are projected as connectors.
    public setScenarios(ids: readonly string[]): void
    {
        this.scenarios = [...new Set(ids)]
    }

    // Add one scenario to the projected set (deduped). Caller triggers a rescan
    // (via the model's notifyChanged) to draw its step connectors.
    public addScenario(id: string): void
    {
        if (!this.scenarios.includes(id)) this.scenarios.push(id)
    }

    // The scenarios currently projected on this diagram.
    public scenarioIds(): string[]
    {
        return [...this.scenarios]
    }

    // The scope as a set; empty falls back to every viewpoint the model declares.
    public scopeSet(): Set<string>
    {
        return this.scope.length > 0
            ? new Set(this.scope)
            : new Set(this.model.viewpoints().map((v) => v.id))
    }

    public dispose(): void
    {
        this.off?.()
        this.off = undefined
        this.doc.RemovePropertyChangedListener(DiagramDocument.ActiveViewKey, this.onActiveViewChanged)
        this.detachView?.()
        this.detachView = undefined
    }
}

// An entity's display label: its `label`, else `name`, else its id.
function displayLabel(entity: Entity): string
{
    const v = entity.field('label') ?? entity.field('name')
    return v !== undefined ? String(v) : entity.id
}

import { ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { DiagramDocument, type IDocument, type IToolboxDropFactory, type ToolboxDropContext } from '@pragmatic-lab/mural/framework'

import { ArchDiagramBindingService } from './arch-diagram-binding-service.js'
import { ArchNodeVM, ARCH_TILE_DEFAULT } from './arch-node-vm.js'
import { planScenarioDrop, type FlowEntity } from './scenario-flow.js'

export const ArchScenarioDropFactoryKey = new ServiceKey<IToolboxDropFactory>('ArchScenarioDropFactory')

// Scenario-page items are keyed `scenario:<entityId>`; recover the entity id.
export function scenarioIdOf(itemId: string): string | undefined {
  return itemId.startsWith('scenario:') ? itemId.slice('scenario:'.length) : undefined
}

// Places an EXISTING scenario as a flow: one ArchNodeVM per participating entity
// (reuse-first, no duplicates), then registers the scenario with the binding,
// which PROJECTS its steps as connectors between the placed nodes. Projection
// (not drawing connectors here) is required because the binding is
// connector-authoritative — it sweeps away any connector between two bound nodes
// that it did not derive, so a raw drawn connector would be reconciled away on
// the next rescan. Pure visualization — no create/addRef; the binding's rescan
// derives each node's label/icon; addScenario persists the shown-scenario id.
// Meant for a Scenarios-viewpoint diagram, where structural edges are out of scope.
export class ArchScenarioDropFactory implements IToolboxDropFactory {
  public constructor(private readonly provider: IServiceProvider) {}

  public CreateDropped(context: ToolboxDropContext): unknown | null {
    const doc = context.Mutator as unknown as DiagramDocument
    const bindingSvc = this.provider.get(ArchDiagramBindingService.Key)
    const model = bindingSvc?.modelForDocument(doc as unknown as IDocument)
    if (bindingSvc === undefined || model === undefined) return null

    const scenarioId = scenarioIdOf(context.Item.Id)
    if (scenarioId === undefined) return null
    const scenario = model.entities().find((e) => e.id === scenarioId) as unknown as FlowEntity | undefined
    if (scenario === undefined) return null

    // Existing arch nodes on the canvas, by entity id (reuse targets).
    const placed = new Set<string>()
    for (const n of doc.Nodes.ToArray())
      if (n instanceof ArchNodeVM && typeof n.Id === 'string') placed.add(n.Id)

    const plan = planScenarioDrop(scenario, placed, { x: context.Position.X, y: context.Position.Y })
    for (const nd of plan.nodes) {
      if (!nd.isNew) continue
      const vm = new ArchNodeVM()
      vm.Id = nd.id
      // Geometry lives on the container Figure + the document store, not the VM.
      doc.SetNodeVisual(nd.id, { left: nd.left, top: nd.top, ...ARCH_TILE_DEFAULT })
      context.Mutator.AddNode(vm)
    }
    // Persist the scenario + re-notify; the binding projects its step connectors
    // (and binds the just-added nodes' labels/icons in the same rescan).
    void bindingSvc.addScenario(doc as unknown as IDocument, scenarioId)
    return null
  }
}

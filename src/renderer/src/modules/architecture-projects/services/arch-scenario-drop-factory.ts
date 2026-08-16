import { ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { ConnectorEndpoint, DiagramDocument, type IDocument, type IToolboxDropFactory, type ToolboxDropContext } from '@pragmatic-lab/mural/framework'

import { ArchDiagramBindingService } from './arch-diagram-binding-service.js'
import { ArchNodeVM } from './arch-node-vm.js'
import { planScenarioDrop, type FlowEntity } from './scenario-flow.js'

export const ArchScenarioDropFactoryKey = new ServiceKey<IToolboxDropFactory>('ArchScenarioDropFactory')

// Scenario-page items are keyed `scenario:<entityId>`; recover the entity id.
export function scenarioIdOf(itemId: string): string | undefined {
  return itemId.startsWith('scenario:') ? itemId.slice('scenario:'.length) : undefined
}

// Places an EXISTING scenario as a flow: one ArchNodeVM per participating
// entity (reuse-first, no duplicates) and one directional connector per step.
// Pure visualization — no create/addRef/save; the binding's rescan (fired by
// notifyChanged) derives each node's label/icon. Meant for a Scenarios-viewpoint
// diagram, where structural edges are out of scope.
export class ArchScenarioDropFactory implements IToolboxDropFactory {
  public constructor(private readonly provider: IServiceProvider) {}

  public CreateDropped(context: ToolboxDropContext): unknown | null {
    const doc = context.Mutator as unknown as DiagramDocument
    const model = this.provider.get(ArchDiagramBindingService.Key)?.modelForDocument(doc as unknown as IDocument)
    if (model === undefined) return null

    const scenarioId = scenarioIdOf(context.Item.Id)
    if (scenarioId === undefined) return null
    const scenario = model.entities().find((e) => e.id === scenarioId) as unknown as FlowEntity | undefined
    if (scenario === undefined) return null

    // Existing arch nodes on the canvas, by entity id (reuse targets).
    const byId = new Map<string, ArchNodeVM>()
    for (const n of doc.Nodes.ToArray())
      if (n instanceof ArchNodeVM && typeof n.Id === 'string') byId.set(n.Id, n)

    const plan = planScenarioDrop(scenario, new Set(byId.keys()), { x: context.Position.X, y: context.Position.Y })

    for (const nd of plan.nodes) {
      if (!nd.isNew) continue
      const vm = new ArchNodeVM()
      vm.Id = nd.id
      vm.Left = nd.left
      vm.Top = nd.top
      context.Mutator.AddNode(vm)
      byId.set(nd.id, vm)
    }
    for (const [s, d] of plan.edges) {
      const sv = byId.get(s)
      const dv = byId.get(d)
      if (sv !== undefined && dv !== undefined)
        doc.CreateConnector(new ConnectorEndpoint({ Node: sv }), new ConnectorEndpoint({ Node: dv }))
    }
    model.notifyChanged()   // rescan binds labels/icons; step connectors are left as-is
    return null
  }
}

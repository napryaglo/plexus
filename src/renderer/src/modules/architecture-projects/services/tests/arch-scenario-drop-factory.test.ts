import { test, expect, vi } from 'vitest'
import { Point, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { DiagramDocument, ToolboxVisualDescriptor, type ToolboxDropContext } from '@pragmatic-lab/mural/framework'
import { TodlVisualResolverKey } from '../../../diagram/services/todl-visual-resolver.js'
import { ArchToolboxItem } from '../../../diagram/services/arch-toolbox-item.js'
import { ArchDiagramBindingService } from '../arch-diagram-binding-service.js'
import { ArchNodeVM } from '../arch-node-vm.js'
import { ArchScenarioDropFactory, ArchScenarioDropFactoryKey, scenarioIdOf } from '../arch-scenario-drop-factory.js'
import type { FlowEntity } from '../scenario-flow.js'

// Fake entities: a scenario 'sc' with one sequence a->b->c.
function ent(id: string, rels: Record<string, FlowEntity[]> = {}): FlowEntity {
  return { id, refs: (m) => rels[m] ?? [] }
}
function step(s: FlowEntity, d: FlowEntity): FlowEntity { return ent('step', { src: [s], dst: [d] }) }
const a = ent('a'), b = ent('b'), c = ent('c')
const scenario = ent('sc', { sequences: [ent('s', { steps: [step(a, b), step(b, c)] })] })

function makeContext(doc: DiagramDocument, scenarioId: string): ToolboxDropContext {
  const descriptor = new ToolboxVisualDescriptor(TodlVisualResolverKey, 'scenario')
  const item = new ArchToolboxItem('scenario:' + scenarioId, 'Scn', descriptor, ArchScenarioDropFactoryKey)
  return { Item: item, Descriptor: descriptor, Position: new Point(100, 50), Diagram: undefined as never, Mutator: doc }
}

function stubProvider() {
  const model = { notifyChanged: vi.fn(), entities: () => [scenario], create: vi.fn(), addRef: vi.fn(), save: vi.fn() }
  const bindingSvc = { modelForDocument: () => model }
  const provider = { get: (k: unknown) => (k === ArchDiagramBindingService.Key ? bindingSvc : undefined) } as unknown as IServiceProvider
  return { provider, model }
}

test('scenarioIdOf strips the scenario: prefix', () => {
  expect(scenarioIdOf('scenario:sc')).toBe('sc')
  expect(scenarioIdOf('instance:x')).toBeUndefined()
})

test('dropping a scenario adds a node per participant and a connector per step, no model writes', () => {
  const doc = new DiagramDocument()
  const { provider, model } = stubProvider()
  const factory = new ArchScenarioDropFactory(provider)

  factory.CreateDropped(makeContext(doc, 'sc'))

  const nodes = doc.Nodes.ToArray().filter((n): n is ArchNodeVM => n instanceof ArchNodeVM)
  expect(nodes.map((n) => n.Id).sort()).toEqual(['a', 'b', 'c'])
  expect(doc.Connectors.ToArray().length).toBe(2)   // a->b, b->c
  expect(nodes.find((n) => n.Id === 'a')!.Left).toBe(100)   // origin col 0
  expect(nodes.find((n) => n.Id === 'b')!.Left).toBe(300)   // col 1
  expect(model.notifyChanged).toHaveBeenCalledOnce()
  expect(model.addRef).not.toHaveBeenCalled()
  expect(model.create).not.toHaveBeenCalled()
  expect(model.save).not.toHaveBeenCalled()
})

test('re-uses an already-present node instead of duplicating it', () => {
  const doc = new DiagramDocument()
  const pre = new ArchNodeVM(); pre.Id = 'b'; pre.Left = 999; pre.Top = 999
  doc.AddNode(pre)
  const { provider } = stubProvider()
  new ArchScenarioDropFactory(provider).CreateDropped(makeContext(doc, 'sc'))

  const bNodes = doc.Nodes.ToArray().filter((n): n is ArchNodeVM => n instanceof ArchNodeVM && n.Id === 'b')
  expect(bNodes.length).toBe(1)          // not duplicated
  expect(bNodes[0].Left).toBe(999)       // existing position preserved
  expect(doc.Connectors.ToArray().length).toBe(2)
})

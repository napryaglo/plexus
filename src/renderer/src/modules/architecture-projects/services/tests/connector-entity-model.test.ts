import { test, expect } from 'vitest'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-lab/todl'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { ArchModel } from '../arch-model.js'
import { mintConnectorEntity, isConnectorEntity, connectorTypeOf } from '../connector-entity.js'

// Minimal meta-model with a `connector` concept (from/to) and a `connectors`
// taxonomy representing it — mirrors tech-architecture's shape.
const MM = `namespace archmm {
  concept location {}
  concept component { relationship in -> location?; }
  concept connector {
    relationship from -> component;
    relationship to -> component;
  }
  taxonomy connectors : represents connector {
    term calls {}
    term event {}
  }
  viewpoint V : frames component, location, connector
}`

function buildModel(): { model: ArchModel; storage: FakeStorage } {
    const draft = ModelDraft.fromSources(
        [new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))],
        [], { namespace: 'archmm' })
    const storage = new FakeStorage('fake://Arch')
    return { model: new ArchModel(draft, storage, 'archmm'), storage }
}

// All own instances serialized to one string (own delta partitions by home file;
// here everything lands in the default namespace file).
async function emit(model: ArchModel, storage: FakeStorage): Promise<string> {
    await model.save()
    const out: string[] = []
    for (const e of await storage.List('')) if (e.Name.endsWith('.todl')) out.push(await storage.ReadText(e.Name))
    return out.join('\n')
}

test('mintConnectorEntity creates a connector {from,to,type} that round-trips', async () => {
    const { model, storage } = buildModel()
    model.create('component', 'comp_a')
    model.create('component', 'comp_b')

    const id = mintConnectorEntity(model, 'comp_a', 'comp_b', 'calls')

    const e = model.entities().find((x) => x.id === id)!
    expect(e, 'connector entity exists').toBeTruthy()
    expect(isConnectorEntity(model.repository(), e), 'is a connector').toBe(true)
    expect(e.ref('from')?.id).toBe('comp_a')
    expect(e.ref('to')?.id).toBe('comp_b')
    expect(connectorTypeOf(e)).toBe('calls')

    // Round-trips as `connector <id> { type = "calls"; from = comp_a; to = comp_b; }`.
    const todl = await emit(model, storage)
    expect(todl).toMatch(/connector\s+\w+\s*\{[\s\S]*?type\s*=\s*"calls"[\s\S]*?from\s*=\s*comp_a[\s\S]*?to\s*=\s*comp_b/)
})

test('connectorTypeOf falls back to the default when type is unset', () => {
    const { model } = buildModel()
    model.create('component', 'comp_a')
    model.create('component', 'comp_b')
    const id = model.create('connector', 'conn_x').id
    model.addRef(id, 'from', 'comp_a')
    model.addRef(id, 'to', 'comp_b')
    const e = model.entities().find((x) => x.id === id)!
    expect(connectorTypeOf(e)).toBe('calls')   // default
})

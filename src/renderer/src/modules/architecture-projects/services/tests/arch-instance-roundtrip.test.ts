import { test, expect } from 'vitest'
import { check, checkAgainst, toJSON, type TodlDocument } from '@pragmatic-lab/todl'

import { ArchInstanceModel } from '../architecture-instance-model.js'

// The `.todl` emitter now lives in TODL core (emitModelTodl/deriveBindings);
// ArchInstanceModel.emit() delegates to it. These tests guard the delegation
// end-to-end at the Plexus seam: load an instance source, emit it back, reload,
// and assert the own document survives the round-trip unchanged.

// Bases: a meta-model (component references a technology) + a library taxonomy of
// technologies. Reused across the round-trip assertions.
const META = `namespace ea {
  concept Technology { label : string; }
  concept Component { label : string; realisedBy : Technology?; deployedTo : Technology[]; }
}`
const LIB = `namespace ms { import ea; taxonomy Stack : represents Technology {
  Technology AzureOpenai { label = "Azure OpenAI"; }
  Technology AzureFunc   { label = "Azure Functions"; }
} }`

function bases(): TodlDocument[] {
    const metaDoc = toJSON(check([{ uri: 'ea.todl', text: META }]).model)
    const libDoc = toJSON(checkAgainst([metaDoc], [{ uri: 'ms.todl', text: LIB }]).model)
    return [metaDoc, libDoc]
}

// Order-insensitive normal form for comparing two own documents.
function normal(doc: TodlDocument): string {
    const nodes = doc.nodes.map((n) => `${n.tier}|${n.id}|${n.typeOf}|${JSON.stringify(Object.entries(n.attrs).sort())}`).sort()
    const edges = doc.edges.map((e) => `${e.kind}|${e.from}|${e.to}|${e.via}`).sort()
    return JSON.stringify({ nodes, edges })
}

test('round-trips a concept instance with a scalar field and a single reference', () => {
    const bs = bases()
    const src = `namespace app { import ea; import ms; model appModel : ea uses Stack { Component gw { label = "Gateway"; realisedBy = Stack.AzureOpenai; } } }`
    const m1 = ArchInstanceModel.load(bs, src, 'app')

    const emitted = m1.emit()
    expect(emitted).toContain('model appModel : ea')
    expect(emitted).toContain('uses Stack')

    const m2 = ArchInstanceModel.load(bs, emitted, 'app')
    expect(normal(m2.document)).toEqual(normal(m1.document))
})

test('round-trips a many-valued reference (list) and an instanceof class', () => {
    const bs = bases()
    const src = `namespace app {
      import ea;
      import ms;
      class Component webTier { realisedBy = Stack.AzureFunc; }
      model appModel : ea uses Stack {
        Component api instanceof webTier { label = "API"; deployedTo = [Stack.AzureOpenai, Stack.AzureFunc]; }
      }
    }`
    const m1 = ArchInstanceModel.load(bs, src, 'app')

    const emitted = m1.emit()
    expect(emitted).toContain('model appModel : ea')
    expect(emitted).toMatch(/^\s*class Component webTier/m)   // local class stays top-level

    const m2 = ArchInstanceModel.load(bs, emitted, 'app')
    expect(normal(m2.document)).toEqual(normal(m1.document))
})

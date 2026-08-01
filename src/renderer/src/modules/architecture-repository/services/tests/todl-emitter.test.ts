import { test, expect } from 'vitest'
import { check, checkAgainst, toJSON, type TodlDocument } from '@pragmatic-lab/todl'

import { emitInstances, deriveBindings } from '../todl-emitter.js'

// Bases: a meta-model (component references a technology) + a library taxonomy of
// technologies. Reused across the round-trip assertions.
const META = `namespace ea {
  concept technology { label : string; }
  concept component { label : string; realised-by : technology?; deployed-to : technology[]; }
}`
const LIB = `namespace ms { taxonomy stack : represents technology {
  technology azure-openai { label = "Azure OpenAI"; }
  technology azure-func   { label = "Azure Functions"; }
} }`

function bases(): TodlDocument[] {
    const metaDoc = toJSON(check([{ uri: 'ea.todl', text: META }]).model)
    const libDoc = toJSON(checkAgainst([metaDoc], [{ uri: 'ms.todl', text: LIB }]).model)
    return [metaDoc, libDoc]
}

// The set of node ids contributed by the bases — everything else is "own".
function baseIds(bs: TodlDocument[]): Set<string> {
    const s = new Set<string>()
    for (const b of bs) for (const n of b.nodes) s.add(n.id)
    return s
}

// Extract the own instance sub-document from a full compiled model: drop the base
// nodes AND the synthesized model container node (typeOf 'model') + its edges, so
// the comparison sees only instances + local classes.
function ownOf(full: TodlDocument, ids: Set<string>): TodlDocument {
    const modelIds = new Set(full.nodes.filter((n) => n.typeOf === 'model').map((n) => n.id))
    return {
        nodes: full.nodes.filter((n) => !ids.has(n.id) && !modelIds.has(n.id)),
        edges: full.edges.filter((e) => !ids.has(String(e.from)) && !modelIds.has(String(e.from))),
    }
}

// Order-insensitive normal form for comparing two own documents.
function normal(doc: TodlDocument): string {
    const nodes = doc.nodes.map((n) => `${n.tier}|${n.id}|${n.typeOf}|${JSON.stringify(Object.entries(n.attrs).sort())}`).sort()
    const edges = doc.edges.map((e) => `${e.kind}|${e.from}|${e.to}|${e.via}`).sort()
    return JSON.stringify({ nodes, edges })
}

// Compile an instance source against the bases and return its own sub-document.
function ownFrom(bs: TodlDocument[], source: string): TodlDocument {
    const r = checkAgainst(bs, [{ uri: 'app.todl', text: source }])
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    return ownOf(toJSON(r.model), baseIds(bs))
}

test('deriveBindings: meta-model is the first sorted base namespace; uses adds the rest + self', () => {
    expect(deriveBindings(bases(), 'app')).toEqual({ metaModel: 'ea', uses: ['app', 'ms'] })
})

test('deriveBindings: no bases binds the project namespace alone', () => {
    expect(deriveBindings([], 'app')).toEqual({ metaModel: 'app', uses: [] })
})

test('round-trips a concept instance with a scalar field and a single reference', () => {
    const bs = bases()
    const src = `namespace app { model app-model : ea uses ms { component gw { label = "Gateway"; realised-by = &stack.azure-openai; } } }`
    const own = ownFrom(bs, src)

    const emitted = emitInstances(own, 'app', deriveBindings(bs, 'app'))
    expect(emitted).toContain('model app-model : ea')
    const own2 = ownFrom(bs, emitted)

    expect(normal(own2)).toEqual(normal(own))
})

test('round-trips a many-valued reference (list) and an instanceof class', () => {
    const bs = bases()
    const src = `namespace app {
      class component web-tier { realised-by = &stack.azure-func; }
      model app-model : ea uses ms, app {
        component api instanceof web-tier { label = "API"; deployed-to = [stack.azure-openai, stack.azure-func]; }
      }
    }`
    const own = ownFrom(bs, src)

    const emitted = emitInstances(own, 'app', deriveBindings(bs, 'app'))
    expect(emitted).toContain('model app-model : ea')
    expect(emitted).toMatch(/^\s*class component web-tier/m)   // local class stays top-level
    const own2 = ownFrom(bs, emitted)

    expect(normal(own2)).toEqual(normal(own))
})

import type { TodlDocument, JsonNode } from '@pragmatic-lab/todl'

// Emit an own instance document (concept instances + reference edges) back to
// `.todl` SOURCE TEXT — the component TODL itself lacks. A pure function of the
// own `{nodes, edges}` so it is directly round-trip testable:
//   own → emitInstances → checkAgainst(bases, [emitted]) → own' == own.
//
// Instance syntax (from the TODL grammar + fixtures):
//   <concept> <id> [instanceof <bareClass>] { field = value; ref = &t.term; many = [a.b, c.d]; }
// - `instanceof` targets a bare local `class` id only; taxonomy terms are dotted
//   ids that appear as REFERENCE targets, not instanceof targets.
// - A `Relationship` edge's `via` is the member name; `to` is the (dotted) target id.
// - `tier`/`kind` are the enum member-name strings ("Instance"/"Relationship"/"InstanceOf").

// attrs carried on an instance node that are markers, not authored fields.
const MARKER_ATTRS = new Set(['id', 'class'])

// The bare local name of an id (drops any dotting) — used for the instance's own
// id, its concept, and an instanceof class. Reference TARGETS keep their full
// dotted id (that is how a taxonomy term is addressed).
function localName(id: string): string
{
    const i = id.lastIndexOf('.')
    return i >= 0 ? id.slice(i + 1) : id
}

function literal(v: unknown): string
{
    return typeof v === 'string' ? JSON.stringify(v) : String(v)
}

export function emitInstances(own: TodlDocument, namespace: string): string
{
    // Every own Instance-tier node — both locally-declared classes (`class …`,
    // emitted first so `instanceof` targets exist) and leaf instances. Base
    // library taxonomy terms are not in `own`, so they aren't re-emitted.
    const instances = own.nodes.filter((n) => n.tier === 'Instance')
    const ordered = [
        ...instances.filter((n) => (n.attrs as Record<string, unknown>).class === true),
        ...instances.filter((n) => (n.attrs as Record<string, unknown>).class !== true),
    ]

    // Index the own edges by source node.
    const instanceOf = new Map<string, string>()                        // from → class id
    const rels = new Map<string, Array<{ via: string; to: string }>>()  // from → relationship edges
    for (const e of own.edges) {
        const from = String(e.from)
        if (e.kind === 'InstanceOf') instanceOf.set(from, String(e.to))
        else if (e.kind === 'Relationship') {
            const list = rels.get(from) ?? []
            list.push({ via: String(e.via), to: String(e.to) })
            rels.set(from, list)
        }
    }

    const lines: string[] = [`namespace ${namespace}`, '{']
    for (const n of ordered) {
        lines.push(...emitOne(n, instanceOf.get(n.id), rels.get(n.id) ?? []))
    }
    lines.push('}')
    return lines.join('\n') + '\n'
}

function emitOne(node: JsonNode, cls: string | undefined, relEdges: Array<{ via: string; to: string }>): string[]
{
    const concept = localName(node.typeOf)
    const isClass = (node.attrs as Record<string, unknown>).class === true
    const head = isClass
        ? `class ${concept} ${localName(node.id)}`
        : cls !== undefined
            ? `${concept} ${localName(node.id)} instanceof ${localName(cls)}`
            : `${concept} ${localName(node.id)}`

    const body: string[] = []
    for (const [name, value] of Object.entries(node.attrs)) {
        if (MARKER_ATTRS.has(name)) continue
        body.push(`${name} = ${literal(value)};`)
    }
    // Relationships grouped by member: a single target emits `&t`, several emit a
    // bare-name list `[a, b]` (the list form TODL uses for taxonomy-term refs).
    const byMember = new Map<string, string[]>()
    for (const r of relEdges) {
        const list = byMember.get(r.via) ?? []
        list.push(r.to)
        byMember.set(r.via, list)
    }
    for (const [member, targets] of byMember) {
        body.push(targets.length === 1 ? `${member} = &${targets[0]};` : `${member} = [${targets.join(', ')}];`)
    }

    if (body.length === 0) return [`  ${head} {}`]
    return [`  ${head} {`, ...body.map((b) => `    ${b}`), '  }']
}

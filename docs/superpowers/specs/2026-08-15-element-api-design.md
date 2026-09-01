# Element API — Design

**Status:** approved design, pending spec review → implementation plan.
**Scope:** cross-repo — the core format lives in TODL (`@pragmatic-tech-ai/todl`); the
selection bridge, presentation resolver, and view-model layer live in Plexus.

## Goal

A durable, read-only projection of architecture model elements — the **cornerstone
bridge between TODL and mural** and the foundation of a future custom-widget
extensibility API. A widget acting on the current diagram selection receives plain,
self-contained `Element` objects and binds them to mural templates through a thin,
typed view-model layer — with no ad-hoc converters or string-keyed template
selectors.

## Architecture

Three layers, strict dependency direction (TODL is upstream and stays pure):

```
TODL (@pragmatic-tech-ai/todl)          pure data + projection
  Element (type)
  toElement(repo, entity, opts) -> Element

Plexus (host)                       binds TODL data to mural
  resolveElementPresentation(repo, registry, e, defaultLabel) -> PresentationHint
  selectionToElements(doc, bindingSvc, registry) -> Element[]

Plexus (host, view-model)           bindable, typed-by-concept
  ElementViewModel (base) + registry + generated default + toViewModel(element)
  Component / Technology / Category (example typed VMs)
```

Data flow: **diagram selection → `Element[]` (neutral data) → `toViewModel` (typed,
bindable) → mural template resolved by VM constructor type.**

## Locked decisions

1. **Read-only now, write-ready later.** The `Element` payload is an immutable
   snapshot. Everything is addressed by stable `id`, so a later command API
   (`setField(id, …)`, `addRef(id, …)`) layers on without changing the payload.
2. **Deep nested + inline, cycle-guarded.** Referenced aggregates (categories,
   technologies) and linked elements are resolved inline so a consumer reads one
   self-contained object. A per-root visited-set stops cycles/repeats.
3. **Four facets** on every node: meta-model `schema`, `provenance`, `presentation`
   (injected), and — **root only** — `referredBy`.
4. **Core lives in TODL, pure.** `toElement` depends only on `Repository`/`Entity`.
   Presentation and `provenance.home` are injected via `opts`, because icon
   resolution (registry) and source-file mapping (`ModelDraft`) are host concerns.
5. **Bindable view-models are host-side and typed-by-concept.** A **hybrid** VM
   strategy: every concept gets a generated, concept-named class by default
   (distinct type → its own template → generic bindable access, zero code); a
   registry lets you hand-write a typed class for concepts you care about.
6. **First scope:** `Element` + `toElement` (TODL); `selectionToElements` +
   presentation resolver + the VM layer (Plexus). **Deferred:** the editing/command
   API and the widget-host registration/selection-event API.

## The `Element` type (TODL)

```ts
import type { Scalar } from './graph.js'
import type { Cardinality } from './graph.js'

/**
 * A read-only, JSON-serializable projection of a model node. Referenced
 * aggregates and linked elements are resolved inline (deep); a node already
 * expanded upstream in the same tree collapses to a `truncated` node (its own
 * facets, no subtree).
 */
export interface Element {
    id: string
    concept: string
    /** Primitive attributes, JSON-safe. */
    fields: Record<string, Scalar>
    /** Relationship member name -> nested targets. Populated members only. */
    refs: Record<string, Element[]>
    /** The concept's declared shape (what is possible), from schema(). */
    schema: ElementSchema
    provenance: Provenance
    presentation: PresentationHint
    /** Reverse edges — present ONLY on a root element (see § referredBy). */
    referredBy?: IncomingRef[]
    /** Set when this node was already expanded upstream in the tree (cycle/repeat);
     *  its own facets are present, its subtree (`refs`) is empty. */
    truncated?: true
}

export interface ElementSchema {
    concept: string
    extends: string | null
    fields: { name: string; type: string; cardinality: Cardinality }[]
    relationships: { name: string; targets: string[]; cardinality: Cardinality; inverse: string | null }[]
}

export interface Provenance {
    /** The source .todl uri the element lives in (injected via opts.homeOf). */
    home?: string
    /** The viewpoint the element conforms to, from node attrs. */
    conforms?: string
}

export interface IncomingRef {
    id: string
    concept: string
    /** The member on the referrer that points at this element. */
    via: string
}

export interface PresentationHint {
    label: string
    iconKey?: string | null
    // room to grow (additive): color, shape, badge, …
}

export interface ToElementOptions {
    /** Stop recursing refs past this depth (root = 0). Default: unbounded (cycle-guarded). */
    maxDepth?: number
    /** Host presentation resolver; result replaces the default { label }. */
    presentation?: (e: Entity, defaultLabel: string) => PresentationHint
    /** Host source-file resolver for provenance.home. */
    homeOf?: (id: string) => string | undefined
}
```

### Projection algorithm (`toElement`)

```ts
export function toElement(repo: Repository, entity: Entity, opts: ToElementOptions = {}): Element {
    return build(repo, entity, new Set<string>(), 0, true, opts)
}
```

`build(repo, e, seen, depth, isRoot, opts)`:

1. Compute the **flat facets** (always present, even on truncated / depth-limited nodes):
   - `id`, `concept`
   - `fields`: `Object.fromEntries(e.fields)`
   - `schema`: map `e.schema()` (ConceptSchema) → `ElementSchema`
   - `provenance`: `{ conforms: repo.resolve(e.id)?.attrs.get('conforms'), home: opts.homeOf?.(e.id) }`
     (absent keys omitted)
   - `presentation`: `opts.presentation?.(e, defaultLabel(e)) ?? { label: defaultLabel(e) }`
   - `referredBy`: **only when `isRoot`** — `incomingRefs(e)` (see below)
2. **Cycle guard:** if `seen.has(e.id)` → set `truncated: true`, return (no subtree).
3. **Depth guard:** if `opts.maxDepth != null && depth >= opts.maxDepth` → return (no subtree, not marked truncated — it is a depth cut, not a cycle).
4. Otherwise `seen.add(e.id)` and expand: for each `rel` in `e.schema().relationships`,
   `const targets = e.refs(rel.name)`; if non-empty, `refs[rel.name] = targets.map(t => build(repo, t, seen, depth + 1, false, opts))`.

Helpers:

```ts
function defaultLabel(e: Entity): string {
    const v = e.field('label') ?? e.field('name')
    return v !== undefined ? String(v) : e.id
}

// Incoming edges: who references e, and via which member. Root-only.
function incomingRefs(e: Entity): IncomingRef[] {
    const out: IncomingRef[] = []
    for (const r of e.referrers())
        for (const rel of r.schema().relationships)
            if (r.refs(rel.name).some((t) => t.id === e.id))
                out.push({ id: r.id, concept: r.concept, via: rel.name })
    return out
}
```

**`seen` is per-root:** `toElement` allocates a fresh visited-set, so co-selected
elements are each fully projected as their own root (never truncated under a sibling).

### `referredBy` is root-only — rationale

Reverse edges are attached only to the element(s) the caller projected, not to every
nested aggregate. A shared `category` is referenced by many components; attaching its
incoming edges to every inline occurrence would bloat every element with hundreds of
entries. Widgets that need reverse edges on a nested node re-project that node as a
root.

## Presentation resolver (Plexus)

Reuses the exact icon logic the canvas node resolver uses (`iconEntityKey` → registry,
with the `mm:` fallback):

```ts
import { iconEntityKey } from './arch-icon.js'
import type { TodlPresentationRegistry } from '../../diagram/services/todl-presentation-registry.js'

export function resolveElementPresentation(
    repo: Repository,
    registry: TodlPresentationRegistry,
    e: Entity,
    defaultLabel: string,
): PresentationHint {
    const key = iconEntityKey(repo, e)
    const iconKey = key !== undefined
        ? (registry.iconKeyFor(key) ?? registry.iconKeyFor(`mm:${key}`) ?? null)
        : null
    return { label: defaultLabel, iconKey }
}
```

## Selection bridge (Plexus)

Maps the active diagram's selected node view-models to `Element`s of the bound model:

```ts
export function selectionToElements(
    doc: DiagramDocument,
    bindingSvc: ArchDiagramBindingService,
    registry: TodlPresentationRegistry,
): Element[] {
    const model = bindingSvc.modelForDocument(doc)
    if (model === undefined) return []
    const repo = model.repository()
    const byId = new Map(model.entities().map((e) => [e.id, e]))
    const selected = doc.ActiveView?.SelectedItems ?? []
    const ids = selected.map((vm) => (vm as { Id?: string }).Id).filter((id): id is string => id !== undefined)
    const opts: ToElementOptions = {
        presentation: (e, def) => resolveElementPresentation(repo, registry, e, def),
        homeOf: (id) => model.homeOf(id),
    }
    return ids.map((id) => byId.get(id)).filter((e): e is Entity => e !== undefined)
              .map((e) => toElement(repo, e, opts))
}
```

Unbound document or empty selection → `[]`.

## View-model layer (Plexus, host)

Thin, typed, bindable projection whose **constructor type drives mural template
resolution**. Hybrid: generated default per concept + registrable typed classes.

```ts
// Base: bindable VM over an Element. The concrete subclass type is what mural
// resolves a DataTemplate against.
export class ElementViewModel {
    readonly id: string
    readonly concept: string
    readonly label: string
    readonly icon: string | null
    protected readonly element: Element

    constructor(element: Element) {
        this.element = element
        this.id = element.id
        this.concept = element.concept
        this.label = element.presentation.label
        this.icon = element.presentation.iconKey ?? null
    }

    protected field(name: string): Scalar | undefined { return this.element.fields[name] }
    protected ref(member: string): ElementViewModel | undefined {
        const t = this.element.refs[member]?.[0]
        return t !== undefined ? toViewModel(t) : undefined
    }
    protected refs(member: string): ElementViewModel[] {
        return (this.element.refs[member] ?? []).map(toViewModel)
    }
}

type ElementViewModelCtor = new (e: Element) => ElementViewModel

const registered = new Map<string, ElementViewModelCtor>()
const generated = new Map<string, ElementViewModelCtor>()

export function registerElementViewModel(concept: string, ctor: ElementViewModelCtor): void {
    registered.set(concept, ctor)
}

// A distinct class whose .name === concept, so mural's findDataTemplateForType
// sees "Component"/"Technology"/… even with no hand-written class.
function generatedClassFor(concept: string): ElementViewModelCtor {
    let ctor = generated.get(concept)
    if (ctor === undefined) {
        ctor = { [concept]: class extends ElementViewModel {} }[concept] as ElementViewModelCtor
        generated.set(concept, ctor)
    }
    return ctor
}

export function toViewModel(element: Element): ElementViewModel {
    const Ctor = registered.get(element.concept) ?? generatedClassFor(element.concept)
    return new Ctor(element)
}
```

Example hand-authored typed VMs (registered once at startup):

```ts
export class Technology extends ElementViewModel {
    get name(): string { return String(this.field('label') ?? this.label) }
}
export class Category extends ElementViewModel {
    get name(): string { return String(this.field('label') ?? this.label) }
}
export class Component extends ElementViewModel {
    get name(): string { return String(this.field('name') ?? this.label) }
    get implementedBy(): Technology[] { return this.refs('implementedBy') as Technology[] }
    get cat(): Category | undefined { return this.ref('categorisedAs') as Category | undefined }
    get in(): Technology | undefined { return this.ref('in') as Technology | undefined }
}

registerElementViewModel('component', Component)
registerElementViewModel('technology', Technology)
registerElementViewModel('category', Category)
```

Binding (template resolved by VM type, no converters, no selector):

```xml
<DataTemplate x:DataType="Component">
  <Icon  Source="{Binding icon}"/>
  <TextBlock Text="{Binding name}"/>
  <TextBlock Text="{Binding cat.name}"/>
  <ItemsControl Items="{Binding implementedBy}"/>
</DataTemplate>
```

Template authoring for these VMs is a **consumer concern, deferred** — this spec ships
the VM layer, not the widget templates or a widget host.

## Versioning & stability

- `Element` and its facet types live under TODL semver. Changes are **additive-only
  within a major** (new optional facets, new `PresentationHint` fields). No envelope
  or version field for now; a selection is a plain `Element[]`.
- By-id addressing throughout keeps the payload compatible with the future command
  API.

## Cleanup folded in

Remove the temporary icon diagnostics added during the icon-fallback investigation:
- `Plexus/.../diagram/services/todl-visual-resolver.ts` — the `[icon MISS concept]` log.
- `Plexus/.../diagram/services/todl-presentation-registry.ts` — `debugIndexKeys()`.
- `Plexus/.../architecture-projects/services/arch-icon.ts` — the `diagIcon` helper and
  its call. **Keep `iconEntityKey`** — the presentation resolver depends on it.

## Deferred (designed-for, out of scope here)

- **Editing/command API:** `setField`/`addRef`/`remove` by id, applied to the bound
  `ArchModel`, committed + saved.
- **Widget host:** widget registration and selection-change events delivering
  `Element[]` (or VMs) to a registered custom widget.
- **VM templates & a widget surface** to render them.
- The separate `ctx=undefined` Model-page toolbox-tile issue (noted, unrelated).

## File structure

**TODL:**
- `src/model/element.ts` — `Element` + facet types + `ToElementOptions` + `toElement` + helpers.
- `src/model/tests/element.test.ts`.
- Root export from the package barrel.

**Plexus:**
- `src/renderer/src/modules/architecture-projects/services/element-presentation.ts` + tests.
- `src/renderer/src/modules/architecture-projects/services/element-selection-bridge.ts` + tests.
- `src/renderer/src/modules/architecture-projects/view-model/element-view-model.ts`
  (base + registry + generated default + `toViewModel`) + tests.
- `src/renderer/src/modules/architecture-projects/view-model/arch-view-models.ts`
  (`Component`/`Technology`/`Category` + registrations) + tests.

## Testing strategy

**TODL `element.test.ts`** (real models via `ModelDraft.fromSources`):
- core: `id`/`concept`/`fields` populated; empty relationship members omitted from `refs`.
- deep nesting: a ref resolves inline to the aggregate, and the aggregate's own ref
  resolves one level deeper.
- cycle guard: A↔B linked → the back-reference is `truncated: true` with flat facets
  and empty `refs`.
- depth: `maxDepth` stops ref expansion at the bound (facets present, `refs` empty, not
  truncated).
- facets: `schema` mirrors the concept's declared members; `provenance.conforms` from
  attrs and `provenance.home` from injected `homeOf`; `referredBy` present on the root
  and **absent** on nested nodes; `presentation` from the injected resolver, else the
  default `{ label }`.

**Plexus `element-presentation.test.ts`:** `iconKey` resolves via the registry
(including the `mm:` fallback); `null` when nothing icon-bearing.

**Plexus `element-selection-bridge.test.ts`:** selected node VMs → `Element[]`;
unbound doc → `[]`; empty selection → `[]`; `presentation.iconKey` and
`provenance.home` wired through.

**Plexus `element-view-model.test.ts`:** `toViewModel` returns a registered class
instance when registered, else a generated class whose `constructor.name === concept`;
base `id`/`label`/`icon`; `Component.implementedBy` returns `Technology[]`;
`Component.cat` returns a `Category`.

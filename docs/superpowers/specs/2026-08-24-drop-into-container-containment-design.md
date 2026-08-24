# Drop-into-Container Containment — Design

**Date:** 2026-08-24
**Repos:** Mural (`@pragmatic-lab/mural`) + Plexus (consumer app)
**Status:** Design approved in chat; spec under review.

## Problem

A user places nodes inside a container box and expects dragging the container
to carry them. Today it does not, because **membership is never established**
for the gesture users actually perform.

Root cause (verified against `plexus_tests/.../diagram.diagram`): container
membership (`Figure.ParentId`) is written in exactly one place —
`Figure.OnPointerUp` when an *existing node* is dragged and released with its
centre inside a container (Mural `figure.ts:1235-1237` `OnPointerUp` →
`ContainerPlacement.containerAt` → `reparent`). In that file,
`m365_copilot_chat` sits geometrically inside `container:1` but has **no
`parentId`** — it was positioned there without the drag-into gesture, so
dragging the container leaves it behind.

Two maps established the surrounding state:

- **Move-together already works** once a node has a `parentId`: the container's
  children are real visual descendants of its `ChildHost`, so drag / clip /
  hit-test move together (regression `container-drag-follow.spec.ts` passes).
- **Arch containers already read children from the model.**
  `ArchDiagramBinding.rescan()` runs `projectContainment()` at load *and* on
  every `model.onChanged()`; `in` refs project to nesting and re-project on
  model update. Drag write-back is complete (legal nest writes the ref via
  `addRef`; illegal nest snaps back — today *silently*).

**The single missing capability:** a dropped toolbox item never sees the
container under it. `ToolboxDropContext` carries only `X/Y`, so both the Mural
figure factory and the Plexus arch factory create the node at root. Drag-*in*
of an existing node works; **drop-*in* does not exist**.

## Decisions (from the user)

1. **Membership forms only via explicit drop / drag-in.** No geometric adoption
   of already-enclosed nodes, neither at load nor on container move/resize.
   Consequence: the existing `diagram.diagram` will not auto-link — `m365`
   stays independent until dragged out and back into `container:1` once. This
   is accepted.
2. **Reject UX is a modal dialog.**
3. **Illegal drag-in routes through the same modal** (replacing today's silent
   snap-back). This lives in Plexus (`handleReparent` is Plexus code).
4. **Generic-container drop-in adoption lives purely in Mural.**

## The Three Cases

| Case | Container | Membership source | Validation | Owner |
|------|-----------|-------------------|------------|-------|
| 1 | Arch primitive (`ContentContainerFigure`, model-backed) | Model containment refs, projected at load + on model change; **any nesting depth** | Meta-model `containmentMemberFor` + viewpoint framing | Plexus (already works ≤1 level; +depth test) |
| 2 | Arch primitive, **drop onto it** | Written to model on accept, then projected | Modal reject on illegal relation/viewpoint | Plexus |
| 3 | Generic (`ContainerFigure`, no VM) | Visual `parentId` only; nests at any depth via placement | None — freeform | Mural |

## Nesting (multi-level containers)

Requirement: nest model-backed containers arbitrarily deep — e.g. azure ⊃ m365 ⊃
power_platform. This is a **depth-generalization of Cases 1–3, not a new
mechanism**:

- **Projection already handles depth.** `containmentParentOf` returns each
  node's *direct* parent, and `projectContainment` reparents every node into its
  direct parent after `placeAll()` registers all container figures. `reparent`
  preserves on-screen position and re-parents only the given node (not its
  descendants), so building the tree is order-independent — a node that is both
  a child *and* a container (m365) is handled. The drop seam builds nesting by
  repeatedly dropping onto the innermost container (`containerAt`), each drop
  validated by `containmentMemberFor` and written as one containment ref.
- **Generic nested boxes** already work through the placement layer alone
  (drop/drag a box into a box → innermost `containerAt` → `reparent`), so Case 3
  needs no extra work at depth beyond the drop seam.

Note: model-backed nesting is **projected from the model**, not gated by the
gesture. The "explicit drop/drag-in only" decision governs *generic/geometric*
adoption; arch containers always read their children (and grandchildren) from
the model, as the user confirmed.

### Meta-model change (in scope)

azure/m365/power_platform are **locations** (`libraries/microsoft/microsoft.todl`
declares them with the `parent` chain: `m365.parent = azure`,
`power_platform.parent = m365`). The nesting already exists in the model but is
not projected, because containment keys on a member named `in` or annotated
`@containment`, and `location.parent` is a **field**, not a relationship — so
`containmentParentOf` (which walks relationships) never sees it.

Change: in `meta-models/tech-architecture/concepts/location.todl`, convert

```
parent : location?;
```

into a containment relationship:

```
relationship parent -> location? { annotate containment {} }
```

Both `containment` and `containerNode` annotations exist in the TODL prelude.
Effects: `location` becomes a self-containment target (already a container
concept via components/subscriptions being `in` it); `containmentParentOf(m365)`
= azure; `containmentMemberFor(location, location)` = `parent` (dropping a
location onto a location is legal, writes `parent`). Instance authoring
(`parent = azure`) is unchanged — relationships are written with the same `=`
assignment (`in = …` in `landscape.todl`). Existing `parent`-cycle / resolution
invariants still hold (relationships resolve refs). The tech-architecture
meta-model is then **republished** so the arch project picks up the change.

**Realization-timing risk (must verify first).** When a container that is
*itself* freshly re-minted as a `ContentContainerFigure` must both nest into its
parent and accept a child in the same rescan, its `ChildHost` may not be
realized yet; `reparent` sets `ParentId` but defers the visual attach until the
`ContainerBound` event fires and `placeAll` flushes the pending queue. For ≤1
level this cascade is exercised and passes; at depth it is untested. The plan's
FIRST task is a 3-level probe test (azure ⊃ m365 ⊃ power_platform). If green,
nesting is confirmed and the remaining work is the meta-model change +
regression tests; if red, fix the deferred-attach cascade before proceeding.

## Mechanism — one seam, two policies

### Mural: expose the drop-target container (enabling seam)

The drop pipeline already computes the diagram-space drop point
(`canvas-drop-behavior` → `Diagram._fireItemDropped(Data, Position)`). Extend
it to resolve the container under that point and carry it on the drop context:

- `Diagram._fireItemDropped` resolves
  `ContainerPlacement.containerAt(Position)` and includes the result on the
  `ItemDropped` event args as `TargetContainer?: ContainerFigure`.
- `ToolboxDropContext` (the object passed to `factory.CreateDropped`) gains
  `TargetContainer?: ContainerFigure` (and its `Id`). Purely additive; existing
  factories that ignore it are unaffected.

No veto seam is added: validation happens **before** node creation, so a
rejected drop simply produces no node.

### Mural: generic container adopts on drop (Case 3, Mural-only)

After a factory returns a node, the standard-mutations router
(`attach-standard-mutations`) adopts it into the target **only when the target
is a generic `ContainerFigure`** (i.e. `not instanceof ContentContainerFigure`):

```
node = factory.CreateDropped(ctx)
if (ctx.TargetContainer !== undefined
    && !(ctx.TargetContainer instanceof ContentContainerFigure))
    placement.reparent(node, ctx.TargetContainer.Id)   // visual-only; writes parentId
```

This is the whole of Case 3. `reparent` converts the drop coords to
parent-relative and writes `parentId`, so it persists via `NodeVisualStore`
and survives reload (visual-store nesting, no model). A model-backed target is
deliberately skipped here — Plexus owns it (below).

### Plexus: arch container validates before creating (Case 2)

`ArchInstanceDropFactory.apply()` reads `ctx.TargetContainer`. If it is a
**model-backed** container (maps to a placed container entity):

1. Resolve the container's concept from its node id.
2. Check `containmentMemberFor(repo, droppedConcept, containerConcept)`
   (viewpoint framing of the dropped concept is already enforced upstream by
   `resolveDropActions`).
3. **Illegal** (`undefined` member) → show the **modal dialog**
   ("Cannot place *X* in *Y*: no containment relation") and return `null`. No
   entity is created.
4. **Legal** → create the entity as today, then `addRef(entityId, member,
   containerEntityId)` to write the `in` ref, `model.save()` +
   `notifyChanged()`. The existing `projectContainment` nests it on the
   resulting rescan, preserving the drop position.

If `TargetContainer` is absent or generic, the factory behaves exactly as
today (create at root); Mural's router handles any generic-container nesting.

### Plexus: illegal drag-in uses the same modal (Decision 3)

`handleReparent` already detects an illegal nest via `containmentMemberFor` and
snaps back with `placement.reparent(fig, undefined)`. Add the modal dialog at
that point, so the drag-in rejection explains itself identically to the
drop-in rejection. The snap-back is retained; only the silent-ness changes.

Factor the message + modal into one helper so drop-in and drag-in share it.

## Data Flow

**Drop onto arch container (legal):**
```
canvas-drop-behavior.Drop
  → Diagram._fireItemDropped(Data, Position, TargetContainer=containerAt(Position))
  → attach-standard-mutations: ctx.TargetContainer set
  → ArchInstanceDropFactory.apply(ctx)
      target is model-backed → containmentMemberFor(child, parent) = member
      → createInViewpoint + addRef(entityId, member, containerId) + save + notifyChanged
  → rescan → projectContainment → node nested under container (position preserved)
  → router: target is model-backed → skip generic adopt
```

**Drop onto generic container:**
```
… → factory returns node at root
  → router: target is ContainerFigure (not ContentContainerFigure)
      → placement.reparent(node, target.Id)   // parentId written, persisted
```

**Drop onto arch container (illegal):**
```
… → ArchInstanceDropFactory.apply: containmentMemberFor = undefined
  → modal("Cannot place X in Y: no containment relation")
  → return null  (no entity, no node)
```

**Illegal drag-in (existing node):**
```
Figure.OnPointerUp → reparent → NodeReparented → handleReparent
  → containmentMemberFor = undefined
  → modal(same message) + placement.reparent(fig, undefined)  // snap back
```

## Error Handling

- Rejected drops create nothing (factory returns `null`); no partial entity, no
  orphan node.
- Illegal drag-in retains the snap-back (node returns to root, no model write);
  the modal is purely informational.
- `TargetContainer` resolution is null-safe: no container under the point →
  `undefined` → today's root behavior.
- Cycle/self-nest guards already exist in `reparent` / `containerAt` and are
  unchanged.

## Testing

**Mural (unit, `tests/` subfolders):**
- Drop context carries `TargetContainer` = the container under the drop point;
  `undefined` when the point is over empty canvas.
- Dropping a figure whose point is inside a generic `ContainerFigure` adopts it
  (`parentId` set, coords parent-relative) and it round-trips through
  save/load.
- Dropping over a `ContentContainerFigure` does **not** auto-adopt in the Mural
  router (host owns it).

**Plexus (unit + e2e):**
- **Nesting probe (first task):** a 3-level chain (azure ⊃ m365 ⊃
  power_platform) projects to nested figures at load — the go/no-go gate for the
  realization-timing risk.
- Legal drop onto an arch container: entity created, containment ref written to
  the container entity, node nested after rescan.
- Legal drop onto an *inner* container of a nest: written + nested at depth.
- Illegal drop onto an arch container: modal shown, no entity created, node
  count unchanged.
- Illegal drag-in: modal shown, node snapped back to root, no model write.
- Case 1 regression: arch container's model children project at load and
  re-project after a model change (guards the "already works" path).
- Meta-model: `location.parent` is recognized as a containment relationship —
  `containmentParentOf(m365)` = azure, `containmentMemberFor(location, location)`
  = `parent`.

## Repo Split & Versioning

- **TODL meta-model:** convert `location.parent` to a `@containment`
  relationship in `tech-architecture` and **republish** the meta-model.
- **Mural:** drop-context `TargetContainer` plumbing + generic-container
  adopt-on-drop in the router; verify/fix deferred-attach cascade if the depth
  probe fails. Minor version bump, publish to Verdaccio (only when asked).
- **Plexus:** arch-factory validation + modal, containment-ref write on accept,
  shared drag-in/drop-in modal helper. Bump the mural dependency to the new
  minor.

## Out of Scope

- Geometric adoption of already-enclosed nodes (load-time or move-time) —
  explicitly declined. (Model-backed nesting is projected from the model and is
  NOT subject to this rule.)
- Viewpoint validation of containment *targets* (a known separate gap: nesting
  into an unframed concept is currently legal). Not addressed here.

## Note on existing diagrams

Once `location.parent` becomes containment, any diagram that already places two
locations in a parent/child relation (e.g. azure + m365) will begin projecting
them as nested on next open. This is the intended behavior (the user wants
location nesting), but is a visible change to existing arch diagrams — called
out so it is not mistaken for a regression.

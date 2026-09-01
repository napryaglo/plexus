# Arch Model-Backed Containment — Design

**Status:** design, awaiting review. **Sub-project 2 of 2** of the diagram-containers effort. Sub-project 1 (the generic Mural `ContainerFigure` primitive — nesting core + gestures + connector re-route) is complete and merged to Mural `main` (Stages 1–3, local, not yet published). This sub-project makes container nesting on an `.archdiagram` **mean something in the architecture model**, and adds a free-form generic container to the arch toolbox.

**Goal:** On an arch diagram, dragging one arch node into another (a container) records the containment in the `.todl` model as an `in` relationship ref, and loading a diagram reconstructs the nesting from the model. Separately, a **generic container** shape lets users group arbitrary shapes / text nodes visually, with no model behind it.

**Architecture (one paragraph):** The architecture model stays the source of truth. Containment is a directional relationship ref — `contained --in--> container` — that lives on the contained entity. `ArchDiagramBinding` already projects relationship refs as connectors (`edge-projection.ts`); this sub-project adds a **containment projection** that turns an `in` ref into visual *nesting* (mural `parentId`, from sub-project 1) instead of a connector line, and a **write-back observer** that turns a nest/un-nest gesture into `addRef`/`removeRef('in')` + `save()`. A concept renders as a mural `ContainerFigure` (gains a child host) when it is a **containment target** (default) or is explicitly annotated `@container`. Two annotations, both shipped in the prelude with defaults: `@container` on concepts, and a containment annotation on relationship members (the `in` kind, recognized by default). The generic container is the same `ContainerFigure` primitive exposed as a toolbox tile; its nesting is visual-only (persists in the `.archdiagram`, never the model).

**Tech stack:** TypeScript. Plexus (Electron renderer, `src/renderer/src/modules/architecture-projects`), consuming Mural from Verdaccio. TODL model layer (`@pragmatic-tech-ai/todl`). Mural framework (`@pragmatic-tech-ai/mural`) — requires the sub-project-1 container primitive **plus** a new VM-opt-in-container seam, published to Verdaccio and consumed by a Plexus bump.

## Grounding (explored 2026-08-23)

- **`ArchNodeVM`** (`architecture-projects/services/arch-node-vm.ts`) — content VM: `Label`, `Descriptor`, `Concept`, `Id` (= entity id), `IconSize`; **no** parent/containment notion. Carries no geometry — its container Figure owns geometry and hosts connector endpoints. Realized by mural's `Diagram` generator into a **content-tile Figure** (`PART_Content` shows the VM icon+label via its DataTemplate). It is NOT a `ContainerFigure` today.
- **`ArchDiagramBinding`** (`…/services/arch-diagram-binding.ts`) — `rescan()` maps `doc.Nodes` ↔ live entities by id, derives `node.Label = displayLabel(entity)`, and re-runs on every `model.onChanged`. Write-back precedents already in place: title edit → `model.setField(id,'label',v)` + `save()`; connector authoring → `model.addRef(fromId, member, toId)` + `save()`. Edge projection: `projectEdges()` uses `edge-projection.ts` `desiredEdges()`, which walks each entity's `effectiveSchema().relationships` and `entity.refs(member)` to create/delete `Connector`s.
- **`ArchModel`** (`…/services/arch-model.ts`) — wraps a TODL `ModelDraft`. `entities()`, `repository()`, `field`/`setField(id,name,value)`, `addRef(from,member,to)`, `save()` (writes `draft.toTodlByFile()` via `IStorage`), `onChanged`/`fire`. **`removeRef` is not present** — a required addition for un-nest (small TODL/ArchModel change).
- **TODL `Entity`** — `field(name)`, `ref(member): Entity | undefined`, `refs(member): Entity[]`, `referrers(member?): Entity[]`, `schema()`. Relationships are directional edges `relationship <member> -> <target>`. So `component.ref('in')` = its container; `location.referrers('in')` = its children.
- **Persistence is two stores:** the `.archdiagram` visual doc (mural JSON — node list + connectors + geometry; **carries `parentId` after sub-project 1**) and the `.todl` model files (entities + refs). Model-as-truth: viz round-trips to TODL.
- **Meta-model annotations** exist and are rich (typed `annotation`/`annotate`, inheritance, prelude/default-library injection). `@container` and the containment annotation ride this system.

## The two container kinds

| | Model-backed container | Generic container |
|---|---|---|
| Backing | an arch entity (concept is a container) | none — a pure visual shape |
| Created by | placing an arch node whose concept is a container | dropping the generic-container toolbox tile / wrapping a selection |
| Children | arch nodes whose concept can be `in` it (+ any shapes) | any shapes, text nodes, or arch nodes |
| Nesting persisted in | the **model** (`in` ref) — projected to `parentId` | the **`.archdiagram`** visual doc (`parentId`) only |
| Primitive | mural `ContainerFigure` (VM-backed, icon+label header) | mural `ContainerFigure` (generic, from sub-project 1) |

Both reuse one primitive; they differ only in whether a nesting writes to the model.

---

## Section 1 — Annotation model, container determination, direction

- **Direction.** The containment ref lives on the **contained** entity and points at its container: `component --in--> location`, `technology --in--> component`. "My container?" = a single `entity.ref('in')`; a container's children = `entity.referrers('in')`.
- **Containment relationship marker.** A relationship member is *containment* when annotated as such — a containment annotation shipped in the prelude **with defaults**, so a relationship of the `in` kind is recognized as containment without hand-annotation. Containment refs project as **nesting**; every other ref keeps projecting as a **connector**.
- **Container concept determination.** A concept renders as a `ContainerFigure` (gains a child host) when EITHER:
  - it is the **target of a containment relationship** (the default — e.g. `location` from `component in location`, `component` from `technology in component`), OR
  - it is explicitly annotated **`@container`** (override, for a concept that should be a container without being a containment target).
  For the triplet: `location` and `component` are containers (targets); `technology` is a leaf. This is fully meta-model-driven with an explicit escape hatch.
- **Model is the source of truth.** Nesting is a projection of the `in` ref, exactly as connectors are a projection of other refs. The `.archdiagram` `parentId` is the visual cache; the `.todl` `in` ref is the truth.

## Section 2 — Mural realization seam (VM-backed container)

Sub-project 2 requires a Mural addition (hence the publish + bump prerequisite). Today `ArchNodeVM` realizes into a plain content-tile Figure; a container-concept node must instead realize into a `ContainerFigure` that *also* shows the VM's icon+label.

1. **VM-opt-in realization.** Mural's `Diagram` container-generation consults a duck-typed flag/interface on the item VM (e.g. `IsContainer: boolean` / an `IContainerNode` marker) and mints a `ContainerFigure` instead of a plain Figure when set. `ArchNodeVM` reports `true` when its concept is a container concept (Section 1). No Plexus subclassing of `Diagram`; the seam is reusable by any VM-backed diagram.
2. **Container header hosts VM content.** A `ContainerFigure` template variant places `PART_Content` (the ArchNodeVM icon+label tile) as a **header band** at the top of the box, with `PART_ChildContainer` below. So a `location` renders as its normal tile as the header; contained `component`s sit in the body. (Sub-project 1's generic `ContainerFigure` keeps its `ShapeText` title variant.)

Rejected alternative: keep arch nodes as plain tiles and fake nesting by positioning children over the parent — regresses sub-project 1's real-visual-parent clip / move-together / hit-test. Not pursued.

## Section 3 — Write-back, load projection, model-backed vs visual-only

**Write-back observer (gesture → model).** The binding observes a child figure's `parentId` change (mural drag-in/out, wrap/unwrap, re-home — all from sub-project 1) and classifies the nesting:
- **Model-backed** — child is an `ArchNodeVM` (entity), the parent container is an `ArchNodeVM` container (entity), AND the meta-model permits `childConcept in parentConcept`. → `model.addRef(childId, 'in', parentId)` + `save()`. Un-nest / re-home / delete → `model.removeRef(childId, 'in', oldParentId)` + `save()`.
- **Visual-only** — a generic container, a plain shape/text child, or a nesting the meta-model doesn't allow. → no model write; the nesting persists in the `.archdiagram` visual doc.

**Load projection (model → nesting).** `rescan()` gains a containment pass: for each entity carrying an `in` ref to a *placed container node*, set the child's mural `parentId` to that container (reusing sub-project 1's `ContainerPlacement`). `in` refs project as nesting; all other refs stay connectors (unchanged `projectEdges`). Generic containers have no entity, so projection never touches them — their children come purely from the loaded visual doc.

**Invalid model nesting.** If the user drags a `component` into a `technology` (no `component in technology` relationship), the model can't represent it → **reject: snap the child back out** (model-as-truth; a nesting the model can't hold must not stick and then vanish on reload). Generic containers accept anything because they never touch the model.

**Consistency loop.** Write `in` ref → `save()` → `onChanged` → `rescan()` re-projects, confirming (or correcting) the visual nesting mural already applied — the same write-back→save→rescan loop the title-edit and connector-authoring paths use.

## Section 4 — Scope, sequencing, dependencies, testing

**MVP scope (this cycle):** one containment relationship (`in`) with the container-concept rule; corpus focus `component in location` (multi-level `technology in component` rides the same mechanism for free); the generic container toolbox shape (visual-only); full round-trip (load projects `in`→nesting; drag-in → `addRef`; drag-out/re-home/delete → `removeRef`; illegal model nesting snaps back; generic accepts anything visual-only).

**Sequencing (one spec; the Mural seam is a gated internal step):**
1. **Mural** — VM-opt-in `ContainerFigure` realization + icon+label header template variant; confirm the generic `ContainerFigure` is toolbox-droppable. Build + test in Mural, then **publish to Verdaccio (`http://localhost:4873`) — only when the user explicitly asks** — and bump Plexus's mural dependency.
2. **Plexus** — ship `@container` + the containment annotation in the prelude/default library (with defaults); add the containment-projection pass + `parentId` write-back observer to `ArchDiagramBinding`; add the generic-container toolbox tile; implement illegal-nesting rejection.

**Dependencies to confirm during planning:**
- **`removeRef(from, member, to)`** on `ArchModel` / TODL `ModelDraft` — absent today; a small addition required for un-nest.
- **Meta-model** — the corpus tech-architecture meta-model needs the `in` containment relationship + container concepts. `contains`/`app_components` are noted to already exist there; planning confirms and adds `in` if needed. The prelude ships the `@container` + containment annotations.
- **Mural publish + Plexus bump** — the whole Plexus half is blocked on the Mural seam being published; treated as an explicit gated task.

**Testing:**
- **Mural (headless):** VM-opt-in container realization (a VM reporting `IsContainer` realizes as a `ContainerFigure` with a `ChildHost`); the icon+label header template resolves `PART_Content` + `PART_ChildContainer`.
- **Plexus (headless binding):** `rescan` projects an `in` ref to `parentId` (child nested under its container node); a `parentId` change on a model-backed pair writes `addRef('in')` / a clear writes `removeRef('in')`; an illegal nesting is rejected (no ref, child un-nested); a generic container / shape child stays visual-only (no model write). Tests live in `tests/` subfolders.
- **Plexus (live e2e):** against a **corpus copy** (`PLEXUS_TEST_CORPUS`, never the real `C:/Users/Eugene/Projects/plexus_tests`): drop a location + a component, nest, reload, assert the `in` ref persisted in the `.todl` and the nesting was restored on load; drop a generic container + a shape, nest, reload, assert visual-only persistence.

## Error handling & edge cases

- **Illegal model nesting** (no permitting relationship) → snap back, no model write, `log`.
- **Cycle** — mural's `containerAt` already rejects self/descendant drops (sub-project 1); the model would also reject a cyclic `in` chain. Both guards apply.
- **Deleting a container** — sub-project 1 re-homes children to root (data-loss guard); the write-back observer clears each re-homed child's `in` ref accordingly.
- **Dangling projection** — an `in` ref whose container node isn't placed on this diagram: the child stays at root (no crash), same as sub-project 1's deferred/absent-parent fallback.
- **Generic container holding an arch node** — visual-only nesting of an entity child inside a non-entity container: no model write (the parent has no id to reference); persists in the visual doc.

## Out of scope (this sub-project)

- Containment relationships other than `in` beyond what the annotation-with-defaults already generalizes (e.g. bespoke `contains`/`app_components` projection tuning) — the mechanism supports them; corpus-specific wiring is follow-up.
- Auto-layout inside containers; collapse/expand; delete-with-contents.
- Cross-diagram containment; containment views/filters.
- Reconciling pre-existing visual-only nestings in old `.archdiagram` files into the model (migration).

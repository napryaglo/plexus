# Viewpoint-Scoped Multi-File Architecture Model — Design

**Status:** Design (brainstorming output). Decomposes into 4 sub-projects; each
gets its own spec → plan → implementation cycle. Sub-project 1 (TODL viewpoint
construct) is detailed here; 2–4 are specified at boundary/interface level and
will be brainstormed to full specs in turn.

**Date:** 2026-08-09

---

## 1. Goal

Give a Plexus architecture project **one logical model split across several
`.todl` files**, where each file is scoped by a **viewpoint** — a meta-model
construct that frames the element types visible through it. Diagrams attach to
this one project model and pick the viewpoints they read and write, so the same
model is authored and visualized through many focused, freeform diagrams. Edits
on a diagram round-trip to the right source file.

This replaces the current one-model-per-`.archdiagram` ownership, where each
diagram document builds and owns its own single-file `ModelDraft`.

## 2. Core concepts

- **Viewpoint** — a first-class meta-model construct: `viewpoint V frames A, B`
  lists the concepts (element *types*) visible through `V`. Structurally
  analogous to `taxonomy T represents A, B`.
- **Shared multi-file model** — one namespace, one logical `model`, split across
  as many `.todl` files as the author wants (Option B / partial-style). Same
  namespace across files composes into one model; bare cross-file references
  resolve; each file is a **home unit**.
- **`conforms`** — `model M : mm uses … conforms V { … }` binds a file's model
  block to a viewpoint. It constrains what the file **homes** (an entity whose
  concept isn't framed by `V` → diagnostic) but **not** what it may
  **reference** (a `Node` in a deployment file may reference a `Component`
  authored in a component file). The viewpoint is therefore the **home
  discriminator**: it answers "which file does this element live in."
  `conforms` is **optional for a single-file model** (one file → no ambiguity
  about where an element lives). It becomes **required once a model is split
  across multiple files**: if the same model is contributed by more than one
  file and any contributing block omits `conforms`, that is a compiler error
  (home-routing is undefined without it).
- **Project model service** — one app-scoped `ArchitectureModelService` holding
  a `Map<Project, model>`. Each open architecture project has exactly one live
  model; everything reaches a project's model through this service.
- **Diagram viewpoint scoping** — a diagram selects the viewpoint(s) it reads
  and writes. Read: it shows entities framed by any selected viewpoint. Write: a
  dropped element routes to the file conforming to the viewpoint (of the
  selected set) that frames its concept.

**File ↔ viewpoint is 1:1 within a model** (three viewpoints → up to three
files). *(Working rule — flagged for review; multiple files per viewpoint is a
possible later relaxation.)*

## 3. End-to-end example

Meta-model declares viewpoints alongside its concepts:

```todl
namespace archmm {
  concept Component { … }   concept Node { … }   concept Interface { … }
  viewpoint ComponentView  frames Component, Interface
  viewpoint DeploymentView frames Node, Component      // Component visible here too
}
```

The project model, split across two files, one viewpoint each:

```todl
// components.todl
namespace acme {
  model Architecture : archmm uses technology conforms ComponentView {
    Component web { implementedBy = react; }
  }
}
```
```todl
// deployments.todl
namespace acme {
  model Architecture : archmm conforms DeploymentView {
    Node host { hosts = web; }          // bare cross-file ref — same model
  }
}
```

At runtime the `ArchitectureModelService` composes both files (against the
project's meta-model + library bases) into one model of `{web, host}`.
`web` conforms to `ComponentView`; `host` conforms to `DeploymentView`. A
diagram scoped to `DeploymentView` shows `host` (and may reference `web`);
dropping a new `Node` writes it into `deployments.todl`.

## 4. Architecture & data flow

```
meta-model (.todl)  ──┐
technology libs (.todl)┼─ bases ─┐
                       │         ▼
project arch files ───►  ArchitectureModelService.modelFor(project)
  components.todl        = one composed, editable model (ModelDraft.fromSources)
  deployments.todl              │  viewpoints[] (each: framed concepts + member entities)
        ▲                       │  home-file per entity (source-file provenance)
        │  toTodlByFile()       ▼
        └────────────  diagram edits (create/setField/addRef/remove)
                                │  read: entities framed by selected viewpoints
                        diagram ┤  write: drop → file conforming to the framing viewpoint
```

- **Compose (read):** `checkAgainst(bases, sources[])` already composes many
  sources into one `Repository`; the multi-file draft wraps that for editing.
- **Provenance (write):** each own node carries its **source-file** tag, so
  `toTodlByFile()` partitions the delta and emits each file back.
- **Viewpoint membership** is computed: entity ∈ viewpoint iff its concept is
  framed by the viewpoint.

## 5. Sub-project decomposition & build order

Each is an independent spec → plan → implementation cycle. Order is by
dependency; 1–2 are TODL (foundation), 3–4 are Plexus (consumer).

0. **Plexus — remove the `ArchDiagramDocument` layer (DONE).** Deleted the
   parallel `.archdiagram` document, factory, file type, instance model/VM,
   drop-resolver, canvas-ops, and view resources; kept the document-agnostic
   toolbox/drop seam (`ArchInstanceDropFactory`, `register-arch-toolbox-adapters`,
   `TodlPresentationRegistry`/`TodlVisualResolver`) for sub-project 4 to reuse.
   The architecture *project* type is unchanged and now offers a generic
   `.diagram` (standalone today, model-bound after sub-project 4). Branch
   `cleanup/remove-arch-diagram-document`; 574 tests green.

1. **TODL — viewpoint language construct.** `viewpoint V frames <concepts>`:
   parse, model kind, resolve/validate framed concepts, Repository queries,
   emit for round-trip. *(Detailed in §6.)*
2. **TODL — `conforms` clause + multi-file shared-model draft.** `conforms V`
   on the model block; merge same-id model blocks across files; per-node
   source-file provenance; `ModelDraft.fromSources(...)` + `toTodlByFile()`;
   home hint on create. Validation: (a) entity concept ∈ its file viewpoint's
   frames; (b) a model contributed by >1 file with any block missing `conforms`
   → compiler error (`model.conforms-required-when-split`); single-file models
   may omit `conforms`. *(Interfaces in §7.1.)*
3. **Plexus — `ArchitectureModelService`.** App-scoped service,
   `Map<Project, model>`; build from bases + project files at open; expose
   viewpoints + member entities; CRUD; save via `toTodlByFile`; project
   open/close lifecycle. Replaces per-diagram model ownership. *(§7.2.)*
4. **Plexus — diagram viewpoint scoping + freeform integration.** New-diagram
   viewpoint selection; read-filter by frames; write-routing to conforming file
   (create file if missing; resolve multi-viewpoint ambiguity); host arch
   primitives + pure-visual shapes in the generic `DiagramDocument`; retire
   `ArchDiagramDocument` and the seeded demo canvas. *(§7.3.)*

## 6. Sub-project 1 (detailed) — TODL viewpoint language construct

**Goal:** the meta-model can declare viewpoints and the concepts they frame, and
the compiled `Repository` can be queried for them. No `conforms`, no models,
no Plexus yet — this is the vocabulary layer everything else consumes.

### 6.1 Surface syntax

```
viewpoint <Name> frames <Concept> [, <Concept>]*
```

- A top-level declaration inside a `namespace`, like `concept`/`taxonomy`.
- `frames` names one or more concepts (references, subject to namespace
  reachability, exactly like a taxonomy's `represents`).

### 6.2 Model representation

- New `MetaKind.Viewpoint` (kind string `"viewpoint"`, lowercase — consistent
  with `MetaKind.Annotation === "annotation"`).
- A viewpoint node per declaration; its framed concepts recorded as the
  authoritative "frames" set. Mirror how a taxonomy records `represents`
  (attr count + indexed attrs, or edges) — follow whichever the taxonomy uses
  so queries and emit reuse the same shape.

### 6.3 Loader

- New `DeclKind.Viewpoint` with `{ name, frames: string[], span, framesSpans }`.
- Pass 1 (`first.defineViewpoint(name, frames)`) — define the viewpoint node;
  the framed ids are references resolved by the existing reference machinery.
- Validation: each framed id must resolve to a **concept**
  (`reference.undefined`/`reference.unreachable` for missing/unimported;
  a new `viewpoint.frames-not-concept` when it resolves to a non-concept).
- Record spans for the viewpoint and each framed reference.

### 6.4 Repository queries (produced interface)

```ts
Repository.viewpoints(): string[]                 // all viewpoint ids
Repository.framedConcepts(viewpoint: string): string[]   // concepts a viewpoint frames
Repository.viewpointsFraming(concept: string): string[]  // inverse — for membership
```

`viewpointsFraming` respects concept subtyping consistent with the rest of the
model (if `DeploymentView frames Component` and `WebComponent : Component`, a
`WebComponent` is framed by `DeploymentView`) — matching how taxonomy/represents
and reference-member compatibility already use `supertypesOf`.

### 6.5 Emit (round-trip)

- `emitViewpoint(node)` → `viewpoint <Name> frames <A>, <B>` in the meta-model
  emitter, alongside concept/taxonomy emission, so a meta-model with viewpoints
  round-trips through save/publish.

### 6.6 Out of scope for sub-project 1

`conforms`, models, multi-file, per-viewpoint instance validation, and anything
Plexus-side. Those are sub-projects 2–4.

## 7. Interfaces for later sub-projects

### 7.1 Sub-project 2 (TODL) produces

```ts
// Compose many namespaced sources into one editable overlay; own nodes retain
// their home-file (uri) tag and (via conforms) their viewpoint.
ModelDraft.fromSources(
  bases: readonly Repository[],
  sources: readonly { uri: string; text: string }[],
  opts: { namespace: string },
): ModelDraft

ModelDraft.create(concept, id, home: { uri: string }): Entity   // home hint
ModelDraft.toTodlByFile(): Map<string /*uri*/, string /*todl*/>  // per-file emit

// ModelDecl gains: conforms: string | null (the viewpoint id), conformsSpan
```

### 7.2 Sub-project 3 (Plexus) produces

```ts
interface ArchitectureModelService {
  modelFor(project: Project): ArchModel | undefined
  openModel(project: Project, storage: IStorage): Promise<ArchModel>
  closeModel(project: Project): void
}
interface ArchModel {
  viewpoints(): Viewpoint[]            // each: id, framed concepts, member entities
  entities(): Entity[]
  create(concept: string, viewpoint: string): Entity   // routes to conforming file
  setField(id, name, value): void
  addRef(from, member, to): void
  remove(id): void
  save(storage: IStorage): Promise<void>   // toTodlByFile → per-file writes
  onChanged(cb): Disposable
}
interface Viewpoint { id: string; framedConcepts: string[]; members: Entity[] }
```

### 7.3 Sub-project 4 (Plexus) consumes 7.2

New-diagram flow captures `selectedViewpoints: string[]`; the diagram reads
`model.viewpoints()` filtered to that set, and write-routes drops through
`model.create(concept, viewpoint)`.

## 8. Resolved decisions (were open questions)

- **File ↔ viewpoint cardinality** — **1:1** for now. One file conforms to one
  viewpoint; a model has at most one file per viewpoint. (N-files-per-viewpoint
  is a possible later relaxation and would need a home rule.)
- **Viewpoint framing & subtyping** — **Yes:** framed-concept membership walks
  subtypes. If `DeploymentView frames Component` and `WebComponent : Component`,
  a `WebComponent` is framed by `DeploymentView` (§6.4, via `supertypesOf`).
- **Multi-viewpoint drop ambiguity** — **First suitable:** when a diagram
  selects several viewpoints and a dropped concept is framed by more than one,
  the home is the **first selected viewpoint that frames it**. (Sub-project 4.)
- **Empty/implicit viewpoint** — `conforms` is optional for a single-file model
  (the block homes any concept, unattributed) and **required once the model is
  split across multiple files** — any contributing block missing `conforms` is a
  compiler error. See §2 / §5 sub-project 2.

## 9. Non-goals

- Cross-project / federated models (still one model per project).
- Viewpoint-driven layout or presentation beyond read/write scoping.
- Changing how meta-models or libraries are published.

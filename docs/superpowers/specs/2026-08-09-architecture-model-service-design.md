# ArchitectureModelService — Design (Sub-project 3)

**Status:** Design. Plexus phase of the viewpoint-scoped multi-file architecture
model (parent: `docs/superpowers/specs/2026-08-09-viewpoint-multifile-architecture-model-design.md`).
Builds on the TODL foundation (SP1+SP2, `@pragmatic-lab/todl@0.23.0`). SP4
(diagram viewpoint-scoping) consumes this service.

**Date:** 2026-08-09

## 1. Goal

One app-scoped service holding a **`Map<projectRootPath, ArchModel>`** — one live
architecture model per open architecture project, composed from the project's
bases (meta-model + libraries) and all its `.todl` files via
`ModelDraft.fromSources`. Everything (diagrams, save) reaches a project's model
through this service. Replaces the per-diagram model ownership deleted in SP0.

## 2. Components

### 2.1 `ArchitectureModelService` (app-scoped singleton)
Registered in `app.mu`'s `.services:` block (after `WorkspaceBaseResolver`).

```ts
class ArchitectureModelService extends ServiceBase {
  static readonly Key = new ServiceKey<ArchitectureModelService>('ArchitectureModelService')
  private readonly models = new Map<string, ArchModel>()   // keyed by project.RootPath

  // Lazy build + cache. Idempotent: a second call returns the cached model.
  async modelFor(op: OpenProject): Promise<ArchModel>
  // Sync lookup (undefined if never built).
  peek(rootPath: string): ArchModel | undefined
  // Drop + dispose a project's model (called on project close).
  close(rootPath: string): void
}
```

**Build (`modelFor`):**
1. `const { bases } = await resolver.ResolveForStorage(op.Storage)` — `TodlDocument[]`.
2. `const sources = await collectTodlSources(op.Storage)` — `{ uri, text }[]` (reuses `modules/meta-model/services/todl-sources.ts`).
3. `const namespace = deriveNamespace(sources)` — the shared namespace of the
   project's model files (parse the first source; its `namespace` path). Fallback
   to a project-name slug when there are no sources.
4. `const draft = ModelDraft.fromSources(bases.map(d => new Repository(graphFromJSON(d))), sources, { namespace })`.
5. `const model = new ArchModel(draft, op.Storage, namespace)`; cache under
   `op.Project.RootPath`; return.

`resolver` = `this.Provider.get(WorkspaceBaseResolver.Key)`, resolved lazily
(app-scoped, available at call time).

**Lifecycle wiring:** the service subscribes to
`ProjectExplorerService.OpenProjects` (an `ObservableCollection<OpenProject>`) —
on removal of an OpenProject, `close(op.Project.RootPath)`. Building stays lazy
(first `modelFor`), so no eager-open coupling / service-order fragility.

### 2.2 `ArchModel` (per-project live model, wraps `ModelDraft`)

```ts
interface Viewpoint { id: string; framedConcepts: string[]; members: Entity[] }

class ArchModel {
  viewpoints(): Viewpoint[]          // draft.model.viewpoints(); frames + computed members
  entities(): Entity[]               // draft.ownInstances()
  create(concept: string, id: string, homeUri?: string): Entity  // draft.create hint
  setField(id, name, value): void    // draft.setField
  addRef(from, member, to): void     // draft.addRef
  remove(id): void                   // draft.remove
  async save(): Promise<void>        // toTodlByFile → WriteText each file
  onChanged(cb: () => void): () => void   // fires after any mutation
  readonly namespace: string
  repository(): Repository           // draft.model (schema queries for SP4)
}
```

- **`viewpoints()`** — for each `draft.model.viewpoints()` id, `framedConcepts =
  draft.model.frames(id)`; `members = entities().filter(e =>
  draft.model.viewpointsFraming(e.typeOf).includes(id))` (subtype-aware).
- **`save()`** — `for (const [uri, text] of draft.toTodlByFile()) await
  storage.WriteText(uri, text)`. (SP2b-2 guarantees each file re-emits with its
  `conforms`.)
- **`onChanged`** — a lightweight signal fired by `create`/`setField`/`addRef`/
  `remove`, so SP4 diagrams refresh. (`ModelDraft` has no events; `ArchModel`
  owns them.)
- **`create` home routing** — `homeUri` optional here; the *viewpoint→file*
  routing (first-suitable) is SP4's concern (it knows the diagram's selected
  viewpoints). SP3 just threads the hint to `draft.create`.

## 3. What SP3 does NOT do (SP4)

Diagram binding, viewpoint selection on new-diagram, read-filter by frames,
write-routing (viewpoint → home file), and retiring the seeded demo canvas.

## 4. Files

| File | Change |
|------|--------|
| Create: `modules/architecture-projects/services/architecture-model-service.ts` | the service |
| Create: `modules/architecture-projects/services/arch-model.ts` | the `ArchModel` + `Viewpoint` |
| Modify: `app.mu` | register `ArchitectureModelService` in `.services:` |
| Modify: `architecture-projects.module.mu` | import for the service (or keep app.mu-only) |
| Test: `modules/architecture-projects/services/tests/architecture-model-service.test.ts` | build/lookup/close over a FakeStorage |
| Test: `modules/architecture-projects/services/tests/arch-model.test.ts` | viewpoints/CRUD/save/onChanged |

## 5. Testing approach

Unit-test against `FakeStorage` (services/storage/tests/fake-storage.ts) seeded
with a manifest + `.todl` files, and a `WorkspaceBaseResolver` returning a
hand-built meta-model `TodlDocument` (or a fake resolver). Assert: `modelFor`
composes both files; `viewpoints()` returns the framed concepts + members;
`save()` writes each home file; `onChanged` fires; `close()` drops the cache.
Live project-open smoke (the ObservableCollection subscription) is manual.

## 6. Constraints

- `@pragmatic-lab/todl@^0.23.0`; import `ModelDraft`, `Repository`, `graphFromJSON`,
  `type TodlDocument`, `type Entity` from it.
- Real enums; every test in a `tests/` subfolder; render/logic through services,
  no relative `../src` mural imports.
- Key the map on `project.RootPath` (stable), never the mutable `Project` object.

## 7. Open question (for review)

**Namespace derivation** — I derive the project's model namespace from the first
`.todl` file's `namespace` declaration. Alternative: store an explicit
`namespace` in the project manifest. Deriving is zero-config and matches how the
files already declare it; confirm that's acceptable, or add a manifest field.

# Arch Diagram Drop-Routing — Design (Sub-project 4b)

**Status:** Design. Plexus phase of the viewpoint-scoped multi-file architecture
model (parent: `docs/superpowers/specs/2026-08-09-viewpoint-multifile-architecture-model-design.md`,
§5 sub-project 4). Builds on SP3 (`ArchitectureModelService`/`ArchModel`) and SP4a
(`ArchDiagramBinding`/`ArchDiagramBindingService`). Follows the Phase-3 drop
semantics (`docs/superpowers/specs/2026-07-25-architecture-canvas-phase3-design.md`).
SP4c (viewpoint picker + persistence + real read-filter) follows.

**Date:** 2026-08-10

## 1. Goal

Dropping a toolbox term onto an architecture diagram creates a model entity in
the project's `ArchModel`, routes it to the file conforming to the framing
viewpoint (creating that file implicitly), materializes a bound `Figure`, and
persists the `.todl`. Follows Phase-3: a library term is **referenced** (an
instance of a concept `X` whose reference member `m` targets the term's type),
never instantiated; a meta-model concept term is a **direct instance**. Candidate
`(X, m)` pairs come from the meta-model schema — one ⇒ auto, several ⇒ chooser
popup, none ⇒ reject.

## 2. Verified facts

- **Term → type `C_t`:** `C_t = repo.classOf(termId) ?? repo.represents(node.typeOf)[0] ?? node.typeOf`
  (`node = repo.resolve(termId)`; `node.typeOf` is the term's taxonomy). Chosen
  over an author-declared `instance` annotation (that refinement stays backlog).
- **Schema enumeration (headless):** `repo.allNodes()` → filter `n.typeOf === MetaKind.Concept`;
  `repo.effectiveSchema(X): { relationships: { name, target, cardinality }[] }`;
  `repo.supertypesOf(C_t)`, `repo.viewpointsFraming(X)`, `repo.frames(vp)`.
- **`conforms` is a marker attr** read from a node's `attrs.conforms`;
  `ModelDraft.create(concept, id, home?)` does NOT stamp it — SP4b must
  `setField(id, 'conforms', vp)` so `toTodlByFile` emits that file's
  `conforms vp` header. A new viewpoint file is created implicitly by giving the
  entity a fresh `home` uri.
- **`ModelDraft.homeOf(id): string | undefined`** exists; `ArchModel` must expose it.
- **Drop seam:** `ArchInstanceDropFactory.CreateDropped(ctx)` where `ctx = { Descriptor: { Key }, Position: { X, Y } (diagram-space), Diagram, Mutator }`; `Mutator` is the `DiagramDocument`. `Descriptor.Key` = term id (library) or `'mm:'+id` (meta-model).
- **Visual:** `Figure.Kind = ctx.Descriptor.Key` resolves the icon via `TodlVisualResolver`/`iconKeyFor` (library term → tech icon; `mm:` concept → concept icon).
- **Toolbox terms** come only from taxonomies; both library (bare key) and meta-model (`mm:` key) taxonomy terms appear.
- **Chooser pattern:** the Problems dock (`MenuButton` + `MenuPopupHost` + `ClickAwayScrim` + virtualized `ItemsControl` with per-row `Command`, sized off `ViewportService`).

## 3. Components

### 3.1 Candidate resolver (pure) — `arch-drop-resolver.ts`

```ts
enum DropActionKind { Instance = 'instance', Reference = 'reference' }
interface DropAction {
  kind: DropActionKind
  concept: string          // X — the concept to instantiate
  member?: string          // m — reference member (Reference only)
  term?: string            // t — the dropped term id (Reference only)
  label: string            // chooser row text, e.g. "component  (realised-by)" or "component"
}
function resolveDropActions(repo: Repository, descriptorKey: string, scope: ReadonlySet<string>): DropAction[]
```

- `termId = descriptorKey.startsWith('mm:') ? descriptorKey.slice(3) : descriptorKey`.
- `C_t` per §2. `accept = new Set([C_t, ...repo.supertypesOf(C_t)])`.
- **Instance action:** if `C_t` is framed by `scope` (`repo.viewpointsFraming(C_t)` ∩ `scope` ≠ ∅) → `{ Instance, concept: C_t, label: C_t }`.
- **Reference actions:** for each concept `X` (from `allNodes` where `typeOf === MetaKind.Concept`) framed by `scope`, for each `rel` in `effectiveSchema(X).relationships` with `accept.has(rel.target)` → `{ Reference, concept: X, member: rel.name, term: termId, label: \`${X}  (${rel.name})\` }`.
- Return all; caller decides 0/1/many. Deterministic order (concepts in `allNodes` order, relationships in schema order; Instance first).

### 3.2 `ArchModel` routing primitives (extend SP3/SP4a class)

```ts
homeOf(id: string): string | undefined              // draft.homeOf
homeForViewpoint(vp: string): string                // existing conforming file, else `${vp.toLowerCase()}.todl`
createInViewpoint(concept: string, vp: string): Entity   // auto-id + create(home) + setField('conforms', vp) + fire
```

- `homeForViewpoint`: scan `entities()`; the first whose `repository().resolve(e.id)?.attrs.get('conforms') === vp` → `homeOf(e.id)`; else `\`${vp.toLowerCase()}.todl\``.
- `createInViewpoint`: `id = uniqueId(concept)` (`concept.toLowerCase()`, then `+2`, `+3`… until `repository().resolve(id) === undefined`); `draft.create(concept, id, homeForViewpoint(vp))`; `draft.setField(id, 'conforms', vp)`; `fire()`; return the entity.
- `addRef`/`save` already exist (SP3/SP4a).

### 3.3 `ArchDiagramBinding` — track nodes added after attach (extend SP4a)

- `attach()` additionally subscribes to `doc.Nodes` (ObservableCollection `Subscribe`). On any collection change, bind any `Figure` whose `Id` is a live entity and is not yet in `bound` (label it, add to `bound`); drop from `bound` any tracked figure no longer in `doc.Nodes`.
- `dispose()` also unsubscribes the Nodes listener.
- Existing model-`onChanged` refresh (label re-sync + orphan removal) is unchanged. This makes drop-created figures live without the drop code touching the binding internals.

### 3.4 `DropCandidateChooserService` — `drop-candidate-chooser-service.ts` + `.resources.mu`

```ts
class DropCandidateChooserService extends ServiceBase {
  static readonly Key: ServiceKey<DropCandidateChooserService>
  // DPs: IsOpen: boolean, Rows: ObservableCollection<ChooserRow>, PopupWidth, ListMaxHeight
  Show(candidates: DropAction[], onPick: (a: DropAction) => void): void   // build Rows, IsOpen = true
}
class ChooserRow extends Model { Label: string; Command: ICommand }   // Command → onPick(action) + close + clear
```

- Adapts the Problems-dock pattern: a `MenuButton`/`MenuPopupHost` template in a `chooser.resources.mu`, virtualized `ItemsControl` over `Rows`, per-row `Command`, `ViewportService`-driven `PopupWidth`/`ListMaxHeight`, `ClickAwayScrim` dismiss (cancels — `onPick` not called).
- The template is mounted once via a host element bound to the service in the diagram panel/shell (like the problems popup host). Registered app-scoped in `app.mu`.

### 3.5 Wire `ArchInstanceDropFactory` (rework the stub)

- Constructed with the `ServiceProvider` (change `register-arch-toolbox-adapters.ts` from `new ArchInstanceDropFactory()` to `new ArchInstanceDropFactory(services)`).
- `CreateDropped(ctx)`:
  1. `doc = ctx.Mutator as DiagramDocument`; `model = bindingSvc.modelForDocument(doc)` (new accessor on `ArchDiagramBindingService`). If `undefined` (standalone diagram) → fall back to the old `ctx.Mutator.CreateNode(ctx.Descriptor.Key, ctx.Position.X, ctx.Position.Y)` (generic shape) and return it.
  2. `scope = new Set(model.viewpoints().map(v => v.id))` (all viewpoints; SP4c narrows this).
  3. `actions = resolveDropActions(model.repository(), ctx.Descriptor.Key, scope)`.
  4. `0` → return `null` (reject). `1` → `return applyDrop(model, ctx, actions[0])`. `>1` → `chooser.Show(actions, a => { void applyDrop(model, ctx, a) }); return null`.
- `applyDrop(model, ctx, action): Figure`:
  1. `vp = [...model.repository().viewpointsFraming(action.concept)].find(v => scope.has(v))` (first framing viewpoint in scope).
  2. `e = model.createInViewpoint(action.concept, vp)`.
  3. if `action.kind === Reference` → `model.addRef(e.id, action.member!, action.term!)`.
  4. `fig = ctx.Mutator.CreateNode(ctx.Descriptor.Key, ctx.Position.X, ctx.Position.Y) as Figure; fig.Id = e.id`.
  5. `void model.save()` (persist `.todl`; fire-and-forget — the Figure is returned synchronously).
  6. return `fig`. The binding (SP4a §3.3) labels it via its Nodes subscription.

### 3.6 `ArchDiagramBindingService.modelForDocument(doc)`

Add a public accessor returning the `ArchModel` for an attached document (looked up from the internal `bindings` map's binding, which now exposes its model), or `undefined`.

## 4. Data flow

```
drop term ──► ArchInstanceDropFactory.CreateDropped(ctx)
  model = bindingSvc.modelForDocument(ctx.Mutator)   (undefined → generic shape, done)
  actions = resolveDropActions(repo, Descriptor.Key, allViewpoints)
    0 → reject   1 → applyDrop   >1 → chooser.Show → applyDrop(chosen)
  applyDrop:
    vp = first viewpoint framing action.concept
    e  = model.createInViewpoint(concept, vp)      (auto-id, home=vp file, conforms=vp)
    [Reference] model.addRef(e.id, member, term)
    fig = CreateNode(Descriptor.Key, x, y); fig.Id = e.id
    model.save()                                    (toTodlByFile → WriteText)
  binding (SP4a) Nodes-subscription → labels fig
```

## 5. Files

| File | Change |
|------|--------|
| Create: `architecture-projects/services/arch-drop-resolver.ts` | `resolveDropActions` + `DropAction`/`DropActionKind` |
| Modify: `architecture-projects/services/arch-model.ts` | `homeOf`, `homeForViewpoint`, `createInViewpoint`, `uniqueId` |
| Modify: `architecture-projects/services/arch-diagram-binding.ts` | Nodes-change subscription (post-attach tracking) |
| Modify: `architecture-projects/services/arch-diagram-binding-service.ts` | `modelForDocument(doc)` accessor |
| Create: `architecture-projects/services/drop-candidate-chooser-service.ts` | chooser service + `ChooserRow` |
| Create: `architecture-projects/services/chooser.resources.mu` | popup template |
| Modify: `architecture-projects/services/arch-instance-drop-factory.ts` | full drop routing |
| Modify: `modules/diagram/services/register-arch-toolbox-adapters.ts` | pass provider to the factory |
| Modify: `app.mu` (+ a host mount) | register `DropCandidateChooserService`, mount its popup host |
| Tests | one `tests/` file per new/changed unit |

## 6. Testing

- **`arch-drop-resolver.test.ts`** (headless): a meta-model with `concept technology {}`, `concept component { realised-by -> technology }`, `concept node { hosts -> component }`, viewpoints framing `component`/`node`; a library taxonomy `Stack : represents technology` with a term `azure`. Assert: dropping `azure` (library key) → one Reference action `component.realised-by` (auto); adding `concept service { uses -> technology }` (also framed) → two candidates (chooser). Dropping `mm:component` → an Instance action for `component`. A term whose type is framed by nothing → `[]` (reject).
- **`arch-model.test.ts`** (extend): `createInViewpoint('component', 'ComponentView')` → entity homed in `componentview.todl` with `conforms`; `toTodlByFile()` emits that file with a `conforms ComponentView` header and the instance; `homeForViewpoint` reuses an existing conforming file; `uniqueId` disambiguates a taken id.
- **`arch-diagram-binding.test.ts`** (extend): a `Figure` with an entity `Id` added to `doc.Nodes` AFTER `attach()` is labelled and orphan-removed on delete.
- **`drop-candidate-chooser-service.test.ts`** (headless service logic): `Show([a,b], cb)` sets `IsOpen`, builds two `Rows`; invoking a row's `Command` calls `cb` with that action and sets `IsOpen=false`.
- **`arch-instance-drop-factory.test.ts`** (rework): with a fake binding-service returning a prebuilt `ArchModel`, a single-candidate drop creates the entity + a `Figure` with `Id` set + persists; a no-candidate drop returns `null` and mutates nothing; a non-architecture doc falls back to a plain `CreateNode`.
- **Live-GUI smoke (manual):** the chooser popup renders, dismisses on click-away, and a drop shows a correctly-iconned node. Rendering can't be unit-tested.

## 7. Constraints

- `@pragmatic-lab/todl@^0.23.0`; real enums (`DropActionKind`); every test in a `tests/` subfolder; no relative `../src` mural imports; `app.mu.js` is generated/gitignored (never commit).
- Standalone (non-architecture) diagrams keep working — the drop falls back to a plain shape when there is no `ArchModel`.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## 8. Out of scope (SP4c)

New-diagram viewpoint picker; persisting a diagram's selected viewpoints (the
`{scene, arch}` wrapper); narrowing `scope` to the diagram's selection (SP4b uses
all viewpoints); the author-declared `instance` annotation refinement for
classifier taxonomies; a chooser with keyboard nav / filtering.

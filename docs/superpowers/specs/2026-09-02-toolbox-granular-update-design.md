# Toolbox Granular Update — Design

Status: draft for review · Date: 2026-09-02

## Problem

The diagram toolbox rebuilds its entire contents on every `ActiveDocument`
change. `ToolboxService.reload()`
([diagram-panel-services.ts:161](../../../src/renderer/src/modules/diagram/services/diagram-panel-services.ts))
re-scans all published backends (`collectTaxonomies`), re-resolves the active
diagram's bases (`activeScope`), calls `TodlPresentationRegistry.discover()`
(which re-fires `onChanged` for **every** entity key), and `RemovePage`s +
re-`contributeTaxonomy`s every page — churning the `ObservableCollection`s
wholesale so the `ItemsControl` regenerates every tile. It is wired to fire on
each `ActiveDocument` notification
([diagram-panel-services.ts:121](../../../src/renderer/src/modules/diagram/services/diagram-panel-services.ts)).

Measured impact (Trace-10 + live `MutationObserver` probe): one full toolbox
rebuild per `ActiveDocument` tick regenerates ~700 tiles
(`ToolboxVisualPresenter:childList` + thousands of descendant `Border`/`Grid`/
`ContentPresenter` `childList` mutations), driving the collateral seen in the
CPU trace (`resource-dictionary.Resolve`, `refresh_inherited_batch`, heavy GC
marking). The toolbox conflates two independent concerns — *what items a page
holds* and *which pages are relevant to the active document* — and does both as
a blunt rebuild on the wrong trigger.

## Goals

- `ActiveDocument` change flips page **visibility only** — zero content work,
  no `discover()`, no page/item teardown.
- Page **content** updates only when that page's real inputs change (its source
  published, its model's files changed), and updates **granularly** (diff, not
  rebuild).
- Each page owns and declares its own update triggers; the `ToolboxService`
  becomes a host of self-updating pages, not a central rebuilder.

## Non-goals

- Changing *what* content the toolbox surfaces (same taxonomies/terms/scenarios).
- Changing drag/drop, drop factories, or item visuals.
- A general reactive-collection framework (YAGNI — explicit subscriptions +
  a shared reconcile helper suffice).

## Design overview

Split the toolbox into two axes that today are tangled into one `reload()`:

1. **Content axis** — each page owns its `Items`, subscribes to its own
   discrete triggers, and reconciles by stable key. Static pages have no
   triggers.
2. **Visibility axis** — a page declares a context token; on `ActiveDocument`
   change the hub flips each page's `IsVisible` by matching the page's token
   against the active document's live context-token set. Content is untouched.

Two lifecycle levels: the **hub** manages the coarse *page set* (which pages
exist, created/destroyed as sources appear/disappear); each **page** manages its
fine-grained *items* and its *visibility*.

## Context contract — `ToolboxContexts`

Mirror the command-context mechanism
([command-target.ts:24](../../../../Mural/src/framework/shell/commands/command-target.ts),
[toolbar-service.ts:236](../../../../Mural/src/framework/shell/commands/toolbar-service.ts)):
a document exposes a live set of context tokens; chrome declares the token it
belongs to; the shell shows it iff the set contains the token.

Divergence from commands: command contexts are **static `ServiceToken`
singletons** (`diagram.editing`); toolbox content contexts are **dynamic
strings** (`<id>@<version>` refs, model/project ids). So `ToolboxContexts` is a
**string-token set**, not `ServiceToken`s — the same `has(token)` match, aligned
with what `activeScope()` already returns.

- New optional interface a document may implement (Mural framework):
  ```ts
  interface IToolboxContextTarget {
      // Live content-context tokens the active document activates.
      readonly ToolboxContexts: ReadonlySet<string>;
  }
  ```
- An architecture `DiagramDocument`'s `ToolboxContexts` =
  `referencedPublishedRefs(model.Storage)` (the existing `activeScope`
  computation, [workspace-base-resolver.ts:77](../../../src/renderer/src/services/projects/workspace-base-resolver.ts))
  ∪ the doc's own model token(s) ∪ its active-scenario tokens. Computed **once on
  activation** as a filter — never to drive a rebuild.
- A document that implements nothing → empty set → only context-free (static)
  pages show. (Design choice: no active arch diagram = Shapes/Callouts only,
  rather than "show everything.")

## Page hierarchy

Promote today's `ToolboxPage` ([toolbox-page.ts](../../../../Mural/src/framework/diagram/toolbox/toolbox-page.ts))
to a base class with lifecycle + visibility. All additions are in Mural
framework; the concrete subclasses live in Plexus.

```
abstract ToolboxPage (MuralBase)
    Id, Title, Items: ObservableCollection<ToolboxItem>, IsExpanded   // existing
    Context?: string                 // NEW — content-context token; undefined = always visible
    IsVisible: boolean (DP, def true)// NEW — context filter result (view binds Visibility to it)
    attach(host): void               // NEW — subscribe this page's triggers
    detach(): void                   // NEW — dispose all subscriptions
    applyContext(ctx: ReadonlySet<string>): void  // NEW — IsVisible = Context===undefined || ctx.has(Context)
    protected reconcile(desired: ToolboxItem[], keyOf = it => it.Id): void  // NEW, shared
```

- `applyContext` sets **only** `IsVisible`; it never touches `Items` or
  `IsExpanded`, so the user's manual expand/collapse survives context flips.
- Out-of-context = `IsVisible=false` → the whole page (header + body) is
  `Visibility.Collapsed` (confirmed UX: hidden entirely).

| Subclass | Repo | Content trigger(s) | Context token | Items source |
|---|---|---|---|---|
| `StaticToolboxPage` — Shapes, Callouts | Mural | none | `undefined` (always visible) | built once at construction (from `ensureToolboxDefaults`) |
| `LibraryToolboxPage` — one per published library ref | Plexus | library-content-changed for its ref (new event) + `TodlPresentationRegistry.onChanged` for visuals | its `sourceRef` (`<id>@<version>`) | its taxonomy terms (`projectToolbox` for that base) |
| `ModelToolboxPage` — one per model declaration across open projects | Plexus | `ArchModel.onChanged` ([arch-model.ts:109](../../../src/renderer/src/modules/architecture-projects/services/arch-model.ts)) + project file add/remove | the model's token | `model.entities()` (in-scope, unplaced) |
| `ScenarioToolboxPage` — per model's scenarios | Plexus | `ArchModel.onChanged` | the model's token | `entities()` where `concept === 'scenario'` |

The `Library`/`Model`/`Scenario` pages refactor the existing
`contributeTaxonomy` ([diagram-panel-services.ts:74](../../../src/renderer/src/modules/diagram/services/diagram-panel-services.ts))
and `ArchModelToolboxContributor` ([arch-model-toolbox-contributor.ts](../../../src/renderer/src/modules/architecture-projects/services/arch-model-toolbox-contributor.ts))
logic into page-owned `attach()`/`reconcile()`; the projection code moves, it
isn't rewritten.

## Hub — `ToolboxService`

- **Init**: create the static pages (Shapes, Callouts via
  `ensureToolboxDefaults`).
- **Page-set management**: subscribe `ProjectExplorerService.OpenProjects`
  ([project-explorer-service.ts:148](../../../src/renderer/src/modules/project-explorer/services/project-explorer-service.ts))
  and the library set. On change, reconcile the *page set* by page `Id`
  (create pages for new sources → `attach()`; remove pages for gone sources →
  `detach()`). Pages persist across document switches.
- **Visibility**: subscribe `ActiveDocument`
  ([diagram-panel-services.ts:121](../../../src/renderer/src/modules/diagram/services/diagram-panel-services.ts)).
  On change: `ctx = (activeDoc as IToolboxContextTarget)?.ToolboxContexts ?? ∅`;
  `for (page of Pages) page.applyContext(ctx)`. **No content work.**
- `reload()`'s collect/discover/rebuild body is deleted.

## Invariants that produce the granularity

1. **Reconcile-by-key** — a shared `reconcile(collection, desired, keyOf)` helper
   (Mural, used for both `Pages` and each page's `Items`): index live and desired
   by key; `Remove` keys not in desired; `Add` keys not live; reorder to match
   desired order via minimal moves; update in-place mutable fields (e.g.
   `ArchToolboxItem.HasWiki`). Never `Clear()`. The `ItemsControl` then
   materializes/removes only changed containers (confirmed incremental:
   [diagram.resources.mu:568](../../../src/renderer/src/modules/diagram/diagram.resources.mu)).
2. **Per-key notification** — `TodlPresentationRegistry.discover()` computes which
   entity keys' icon actually changed (diff new vs prior index) and fires
   `onChanged` only for those, so unchanged tiles keep their `ToolboxVisualPresenter`
   and don't re-`Resolve` ([todl-presentation-registry.ts:92](../../../src/renderer/src/modules/diagram/services/todl-presentation-registry.ts)).

## View change

One binding addition to the page template
([diagram.resources.mu:568](../../../src/renderer/src/modules/diagram/diagram.resources.mu)):
wrap the page's `StackPanel` with `Visibility = $IsVisible << ToVisibility`.
`IsExpanded` two-way stays. No other view changes; `$Pages`/`$Items` already
react to collection deltas per-item.

## New plumbing — content-change events (the one gap)

There is no publish/install event today; library/meta-model refresh is imperative
(`LibrariesPanelService.Reload()`, `MetaModelsService.reload()` →
`discover()`). Add a narrow change event per content source, fired at those same
existing imperative points:

- `LibraryRegistry` (or libraries backend): `onLibrariesChanged(cb): () => void`,
  fired after install/uninstall/publish.
- Meta-models backend: `onMetaModelsChanged(cb): () => void`, fired after
  publish/delete.

The existing call sites replace "mutate, then push a global toolbox reload" with
"mutate, then emit the source-changed event." Interested pages self-reconcile.
`TodlPresentationRegistry.onChanged` remains the *visual* refresh channel
(per-key after the fix above).

## Behavior changes to call out

- **Cross-source term dedup drops.** Today `contributeTaxonomy` uses a global
  `seen` set so a term appearing in two sources shows once. With per-page
  ownership each source page shows its own terms; the same term id can appear in
  two different library pages. This is arguably more correct (each page reflects
  its source) and pages are context-filtered anyway — but it is a visible change.
- **No-active-arch-doc shows static pages only** (was: all taxonomies). Content
  pages require an active document whose `ToolboxContexts` reference them.

## Testing

- **Unit (Mural)**: `reconcile` — add / remove / reorder / in-place update; assert
  minimal collection events (no `Clear`). `ToolboxPage.applyContext` flips
  `IsVisible` without emitting any `Items` event.
- **Unit (Plexus)**: each page type — `attach` wires its trigger; firing the
  trigger yields only the expected `Items` delta; `ActiveDocument` change routes
  through the hub to `applyContext` only (spy asserts `discover` **not** called and
  `Items` untouched). Hub — `OpenProjects` change produces a page-set delta by id.
- **Regression/perf (e2e)**: reuse the `MutationObserver` probe — switching
  between same-context documents, and moving the mouse over the canvas, produce
  ~0 `ToolboxVisualPresenter`/`WrapPanel` `childList` mutations. Guards the storm
  from returning.

## Risks / open items

- Scenario page granularity: **one scenarios page per model** (items = its
  scenarios), matching today's single `arch:scenarios` page — vs one page per
  scenario. Proposing per-model; confirm.
- Model/scenario **context token** identity (model namespace vs project id) — to
  finalize against how a diagram doc knows "its" model.
- `discover()` per-key diff correctness (icon index comparison) — needs the prior
  index retained across discovers.
- Order stability under `reconcile` (avoid churn from re-sorting equivalent items).

## Rollout

Framework first (Mural: `ToolboxPage` base + `reconcile` + `IToolboxContextTarget`
+ view binding), then Plexus (page subclasses + hub rewrite + content-change
events + delete `reload` body), behind the existing tests plus the new
`MutationObserver` regression guard.

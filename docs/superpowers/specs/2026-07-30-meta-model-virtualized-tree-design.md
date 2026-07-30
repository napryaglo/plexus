# Meta-model View: Virtualized Tree Outline — Design

**Date:** 2026-07-30
**Status:** Approved, ready for planning
**Repos:** Mural (framework hook) + Plexus (consumer)

## Goal

Replace the Meta-models capability panel's hand-rolled nested-`ItemsControl`
outline with a single **virtualizing `TreeView`** that layers the catalog and
the model contents in one tree:

```
<model id>                     (Model)
  <version>                    (Version)   ← lazy: entities load on first expand
    Concepts                   (Group)
      <entity>                 (Entity)
      …
    Relationships              (Group)
      …
    Taxonomies   / Primitives  (Group)
```

Entities under a version are read from that version's published `model.json`
**lazily, on first expand**, so a large model costs nothing until drilled into,
and the virtualizing panel keeps render cost bounded regardless of entity count.

## Background

The current view ([meta-model.resources.mu](../../../src/renderer/src/modules/meta-model/meta-model.resources.mu))
renders `MetaModelsService.Models` as nested `ItemsControl`s (model id header +
indented versions). Every row materializes eagerly; there is no virtualization
and no way to see a model's contents.

Mural already ships a virtualizing `TreeView` (`IsVirtualizing` DP, recycling
`VirtualizingStackPanel`) driven by a `HierarchicalDataTemplate`
(`itemsselector = <children>`), exactly as the Project Explorer uses it. The one
gap: **`TreeView` never tells a view-model that a node was expanded**, and it
hides a node's chevron when the node has no children — so lazy population is
impossible today. This design adds a minimal, general expansion hook to mural to
close that gap, then rebuilds the panel on top of it.

## Global Constraints

- **Mural is a downstream dependency** consumed from Verdaccio
  (`http://localhost:4873/`). The framework change ships as a version bump
  (0.1.51 → 0.1.52) that Plexus's `^0.1.51` range picks up on reinstall.
- **Enums over string-literal unions** (both repos' CLAUDE.md). Node kinds are a
  real `enum`.
- **Tests live in a `tests/` subfolder** next to the code, in both repos.
- **Render through templates only** — every visible row flows through the
  `HierarchicalDataTemplate`; no hardcoded chrome.
- **Mural cross-class internals**: reach into a container's stamped data only
  through a named, typed interface (no bracket access).

## Component 1 — Mural: the `OnExpand` hook

**File:** `Mural/src/framework/list/tree-view.ts` (modify `TreeViewItem`)
**Test:** `Mural/src/framework/list/tests/tree-view.test.ts` (extend)

### Behavior

When a `TreeViewItem`'s `IsExpanded` DP transitions to `true`, resolve the data
item bound to that container and, if it exposes an `OnExpand()` method, invoke
it. Firing again on every true-transition is fine — **idempotency is the data
item's responsibility**, keeping the framework side stateless.

### Implementation

`TreeViewItem.OnPropertyChanged` already has an `IsExpanded` case
([tree-view.ts:886](../../../../Mural/src/framework/list/tree-view.ts#L886)).
Extend it: after the existing chevron/collapse/measure work, when
`newValue === true`, call the hook. Resolve the data item with the existing
module-level `dataOf(this)`
([tree-view.ts:1068](../../../../Mural/src/framework/list/tree-view.ts#L1068)),
and dispatch through a named interface rather than bracket access:

```ts
// module scope, near dataOf
interface ExpandableTreeData { OnExpand?(): void }

// in OnPropertyChanged, 'IsExpanded' case, after InvalidateMeasure():
if (newValue === true)
{
    const data = dataOf(this) as ExpandableTreeData | undefined;
    data?.OnExpand?.();
}
```

`dataOf` reads `_itemsControlData`, stamped on every generated container by
`ItemsControl.PrepareContainerForItemOverride`
([items-control.ts:663](../../../../Mural/src/framework/base/items-control.ts#L663)),
so it is populated for every templated row (not composed-markup `TreeViewItem`s,
which have no data item — `dataOf` returns `undefined`, hook safely skipped).

### Chevron for not-yet-loaded nodes

`refreshChevron` only paints the expand glyph when `SubItems.length > 0`
([tree-view.ts:992](../../../../Mural/src/framework/list/tree-view.ts#L992)).
**No mural change is needed here** — the Plexus VM seeds each lazy node with a
placeholder child so the chevron is present from the start; the hook fires on
expand and swaps the placeholder for real content.

### Test

Build a `TreeView` with `IsVirtualizing = true` over a data item whose
`OnExpand` increments a counter; realize its container, set `IsExpanded = true`,
assert the counter incremented. A second expand (after a collapse) fires again
(idempotency is not the framework's concern). A data item without `OnExpand`
must not throw.

### Publish

Bump `Mural/package.json` to `0.1.52`, `npm publish` (Verdaccio). Commit on the
existing `treeview-data-templates` branch (its lineage is the tree-view work).

## Component 2 — Plexus: `MetaModelTreeNode`

**File:** `Plexus/src/renderer/src/modules/meta-model/services/meta-model-tree-node.ts` (new)
**Test:** `.../services/tests/meta-model-tree-node.test.ts` (new)

A uniform node VM (mirrors `ProjectNode`) so one `HierarchicalDataTemplate`
governs the whole heterogeneous tree.

```ts
export enum MetaModelNodeKind { Model = 'model', Version = 'version', Group = 'group', Entity = 'entity' }
```

DP-backed properties:
- `Kind: MetaModelNodeKind` — drives the leading icon.
- `Label: string` — the row text.
- `Children: ObservableCollection<MetaModelTreeNode>` — bound live as the
  hierarchical `itemsselector`.

Lazy machinery (used only by Version nodes):
- A private loader thunk `() => Promise<void>` and a `_loaded` guard (plain
  fields — view-invisible state).
- `public OnExpand(): void` — the method the mural hook calls. On first call
  (guard flips), invokes the loader. Subsequent calls no-op. Never throws
  synchronously (loader errors are swallowed to a single "Failed to load" leaf).

Factory helpers keep construction intent-revealing:
- `MetaModelTreeNode.leaf(kind, label)` — Model header rows, Group rows, Entity
  leaves, sentinel/empty/error leaves.
- `MetaModelTreeNode.lazy(kind, label, loader)` — a node seeded with one
  `Loading…` sentinel child and wired to run `loader` on first expand, which
  clears the sentinel and appends the produced children.

Because `Children` is an `ObservableCollection` bound as a live `ItemsSource`
(mural 0.1.51 "live children" fix), async population after `OnExpand` updates the
tree in place with no extra plumbing.

## Component 3 — Plexus: catalog + entity builders

**File:** `Plexus/src/renderer/src/modules/meta-model/services/meta-model-tree-builder.ts` (new)
**Test:** `.../services/tests/meta-model-tree-builder.test.ts` (new)

Pure functions of `IStorage` (the meta-models backend), unit-testable with
`FakeStorage`, no DI, no render.

### `buildCatalog`

```ts
export async function buildCatalog(storage: IStorage): Promise<MetaModelTreeNode[]>
```

Reuses the existing catalog scan shape (`<id>/<version>/` directories,
numeric-aware sort so `0.9.0` precedes `0.10.0`). For each model id, emits a
`Model` leaf node whose `Children` are `Version` **lazy** nodes. Each version
node's loader is `() => loadVersionEntities(storage, id, version)`, and its
produced children are appended to that node.

### `loadVersionEntities`

```ts
export async function loadVersionEntities(
    storage: IStorage, id: string, version: string,
): Promise<MetaModelTreeNode[]>
```

Reads `<id>/<version>/model.json`, `JSON.parse` → `TodlDocument`, runs the
existing `ontologyEntities(model)` from
[presentation-generator.ts](../../../src/renderer/src/modules/meta-model/services/presentation-generator.ts),
and groups the entities by `OntologyKind` in a fixed order:

| OntologyKind    | Group label     |
| --------------- | --------------- |
| `Concept`       | Concepts        |
| `Relationship`  | Relationships   |
| `Taxonomy`      | Taxonomies      |
| `Primitive`     | Primitives      |

Each non-empty kind yields a `Group` node whose children are `Entity` leaves
labelled `attrs.label` (when a string) else `humanize(id)` (both already
exported from `presentation-generator.ts`), in model order. **Empty groups are
omitted.** When the model has zero ontology entities, returns a single
`Entity`-kind leaf labelled "No entities". A missing/malformed `model.json`
returns a single leaf labelled "Failed to load model.json".

## Component 4 — Plexus: the `Kind → geometry` converter

**File:** `Plexus/src/renderer/src/modules/meta-model/services/meta-model-node-icon.ts` (new)
**Test:** `.../services/tests/meta-model-node-icon.test.ts` (new)

A converter `MetaModelKindToGeometry` mapping `MetaModelNodeKind` to a geometry
resource, mirroring `KindToGeometry` in [project-node-icon.ts](../../../src/renderer/src/services/projects/project-node-icon.ts)
but distinctly named to avoid colliding with it. Picks from existing app icon
resources (e.g. a package/library glyph for Model, a tag/version glyph for
Version, a folder glyph for Group, a generic node glyph for Entity — exact keys
chosen against the registered resource set during implementation). Exported for
import into the `.mu` resources.

## Component 5 — Plexus: rewire `MetaModelsService`

**File:** `Plexus/src/renderer/src/modules/meta-model/services/meta-models-service.ts` (modify)
**Test:** `.../services/tests/meta-models-service.test.ts` (modify)

- Replace the `Models: ObservableCollection<MetaModelRow>` DP with
  `Nodes: ObservableCollection<MetaModelTreeNode>`.
- `reload()` keeps the reload-seq guard and `IsEmpty` computation, but rebuilds
  `Nodes` from `buildCatalog(backend)` instead of hand-constructing
  `MetaModelRow`s. `IsEmpty` is `Nodes.Count === 0`.
- Delete `MetaModelRow` and `MetaModelVersionRow` (and their tests). Keep
  `PublishedModel` / `scanPublishedModels` only if `buildCatalog` reuses them;
  otherwise fold the scan into the builder and remove them.

## Component 6 — Plexus: the view

**File:** `Plexus/src/renderer/src/modules/meta-model/meta-model.resources.mu` (rewrite body)

Replace the three `DataTemplate`s (service / `MetaModelRow` / `MetaModelVersionRow`)
with:

```
DataTemplate [ DataType = MetaModelsService ] {
    StackPanel [ Orientation = Vertical, Margin = (12,12,12,12) ] {
        TreeView [ Indent = 14, IsVirtualizing = true,
                   ItemsSource = $Nodes, ItemTemplate = @MetaModelNodeTemplate ]
        TextBlock [ Style = @BodyMedium, Text = "No published meta-models yet.",
                    Foreground = @OnSurfaceVariant, TextWrapping = Wrap,
                    Visibility = $IsEmpty << ToVisibility ]
    }
}

HierarchicalDataTemplate x:key="MetaModelNodeTemplate"
    [ DataType = MetaModelTreeNode, itemsselector = Children ] {
    StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {
        Shape [ Geometry = $Kind << MetaModelKindToGeometry, Fill = @OnSurfaceVariant,
                Width = 16, Height = 16, Margin = (0,0,6,0), VerticalAlignment = Center ]
        TextBlock [ Text = $Label, Style = @BodyMedium, VerticalAlignment = Center ]
    }
}
```

Imports at the top of the resources file: `MetaModelTreeNode` and the
`MetaModelKindToGeometry` converter from the new node-icon module. `ToVisibility`,
`@BodyMedium`, theme brushes resolve from merged app resources as today.

## Component 7 — Plexus: dependency + build

- Bump `@pragmatic-lab/mural` to `^0.1.52` in `Plexus/package.json`, reinstall
  from Verdaccio.
- Recompile `.mu` (the panel resources) via the existing `compile:mu` step.

## Data flow (runtime)

1. Panel activates → `MetaModelsService.reload()` → `buildCatalog(backend)` scans
   directories → `Nodes` = Model nodes, each with lazy Version children (sentinel
   only). One virtualized `TreeView` renders the visible rows.
2. User expands a Version → mural fires `TreeViewItem.IsExpanded = true` →
   `dataOf(container).OnExpand()` → the node's loader runs once →
   `loadVersionEntities` reads `model.json`, groups entities → children replace
   the sentinel → the live `ObservableCollection` updates the tree in place →
   `VirtualizingStackPanel` realizes only the on-screen entity rows.

## Testing strategy

- **Mural:** the expansion hook unit test (Component 1).
- **Plexus node VM:** `OnExpand` runs the loader exactly once; sentinel present
  before load and gone after; loader rejection yields a single error leaf.
- **Plexus builders:** `buildCatalog` shape + numeric-aware sort against a
  seeded `FakeStorage`; `loadVersionEntities` grouping (kinds in fixed order,
  empty groups omitted, entity labels, "No entities" and "Failed to load"
  fallbacks).
- **Plexus icon converter:** each kind maps to the expected geometry key.
- **Plexus service:** `reload` populates `Nodes`, sets `IsEmpty`, and the
  reload-seq guard still discards a stale scan.
- **Dev smoke:** `npm run dev`, open the Meta-models panel, expand a published
  model/version, confirm entities appear and scrolling is smooth.

## Out of scope

- Per-entity icons from `attrs.icon` (rows use the kind icon in v1).
- Selection / navigation from an entity row to a definition or diagram.
- Sub-projects 2 & 3 of the meta-model browser (package/compile presentation to
  JS; `MetaModelEntity` render browser) — unaffected by this view change.

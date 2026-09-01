# Libraries Panel TreeView — Design

**Status:** ✅ Finished

**Goal:** Replace the Libraries panel's flat nested list with a `TreeView`
(Library → Concept → Class), where class leaves are draggable onto the
architecture canvas and selecting a class expands an inline preview beneath its
row.

## Context

Today `LibrariesPanelService` (`src/renderer/src/modules/library/services/libraries-panel-service.ts`)
builds a flat structure: `Libraries: ObservableCollection<LibraryRow>`, each
`LibraryRow` holding `Classes: ObservableCollection<ClassRow>`, each `ClassRow`
carrying a `ClassData` (Display/Label/LocalId/Concept) + the LibraryRegistry-resolved
`Template`. `library.resources.mu` renders it as nested `StackPanel`/`ItemsControl`
(no expand/collapse). This redesign turns it into a real tree and makes class
leaves a drag source for the Phase 3 architecture canvas.

Reuses the Project Explorer's TreeView pattern verbatim:
`TreeView [ ItemsSource, ItemTemplate = @HierarchicalDataTemplate, SelectedDataItem, Indent ]`
+ `HierarchicalDataTemplate [ DataType = X, itemsselector = Children ]` recursing
on each node's `Children` collection; `SelectedDataItem` two-way to a service
property whose `OnPropertyChanged` drives activation.

## Node model

One unified `LibraryTreeNode extends Model` with a `Kind` discriminator (mirrors
`ProjectNode`'s single-type-plus-Kind approach), in
`src/renderer/src/modules/library/services/library-tree-node.ts`:

- `enum LibraryNodeKind { Library, Concept, Class }`
- DPs: `Name: string`, `Kind: LibraryNodeKind`, `Children: ObservableCollection<LibraryTreeNode>`,
  `IsExpanded: boolean` (default true), `IsPreviewOpen: boolean` (default false),
  `IsDraggable: boolean` (true only for `Class`).
- Class-leaf-only DPs: `TermId: string` (the full dotted id, e.g. `stack.azure-openai`),
  `Concept: string`, `Template: DataTemplate | undefined` (LibraryRegistry-resolved),
  `Data: LibraryTreeNode` (self, so the inline preview's `ContentPresenter` binds
  `Content = $Data`). To render the class visual identically to the old `ClassData`,
  the leaf also exposes the surface library templates bind against: `Display`,
  `Label`, `LocalId` (plus `Concept` above). `Display` = `label ?? localId ?? id`;
  the row's `$Name` equals `Display` for leaves.
- `BeginKindDragData: (() => { data: DataObject; effects: DragDropEffects }) | undefined`
  — for `Class` nodes, returns `new DataObject().Set(TOOLBOX_NODE_KIND_FORMAT, TermId)`
  with `DragDropEffects.Copy`; `undefined` otherwise. **Same payload the Phase 3
  canvas drop pipeline accepts**, so a class dragged from the tree onto an
  `.archdiagram` creates a node. `TOOLBOX_NODE_KIND_FORMAT` is imported from
  `@pragmatic-tech-ai/mural/framework`.

Two small static factories keep construction readable: `LibraryTreeNode.group(name, kind)`
(Library/Concept container node) and
`LibraryTreeNode.leaf({ display, label, localId, termId, concept }, template)`
(Class leaf; sets `Name = display`, the `Display`/`Label`/`LocalId`/`Concept` surface,
`Data = this`, `IsDraggable = true`, and the drag callback).

## Service

`LibrariesPanelService` reworks `Reload()`:

- Replace `Libraries`/`LibraryRow`/`ClassRow`/`ClassData` with `Roots: ObservableCollection<LibraryTreeNode>` (DP)
  and `SelectedNode: LibraryTreeNode | undefined` (DP, two-way to the TreeView).
  Keep `IsEmpty`.
- Build: `const libs = await registry.refresh()`. For each `LoadedLibrary`, a
  `Library` group node named `"<name>  ·  <version>"`; group its `classes` by
  `cls.concept` into `Concept` group nodes (sorted by concept name); each class →
  a `Class` leaf named `cls.label ?? cls.localId ?? cls.id`, carrying `cls.id` as
  `TermId`, `cls.concept`, and `registry.resolve(cls.id, cls.concept)` as `Template`
  (classes sorted by display name).
- `IsEmpty = Roots.Count === 0`.
- Override `OnPropertyChanged`: when `SelectedNode` changes, clear the previous
  node's `IsPreviewOpen` and, if the new node is a `Class`, set its `IsPreviewOpen = true`.
  (Selecting a non-class node just closes any open preview.)

## Markup (`library.resources.mu` rewrite)

- `DataTemplate [ DataType = LibrariesPanelService ]`: a `ScrollViewer` →
  `TreeView [ ItemsSource = $Roots, ItemTemplate = @LibraryNodeTemplate,
  SelectedDataItem = $SelectedNode, Indent = 14 ]`, plus the existing
  "No published libraries yet." `TextBlock` gated on `$IsEmpty << ToVisibility`.
- `HierarchicalDataTemplate x:key="LibraryNodeTemplate" [ DataType = LibraryTreeNode, itemsselector = Children ]`:
  a vertical `StackPanel` of
  - **row**: `Border [ IsDraggable = $IsDraggable, OnDragStart = $BeginKindDragData ]`
    → horizontal `StackPanel` with a leading glyph (`@Libraries` for Library nodes;
    none for Concept/Class — the row is an indented `TextBlock [ Text = $Name ]`).
  - **inline preview**: `Border [ Visibility = $IsPreviewOpen << ToVisibility, ... ]`
    → `StackPanel` with `ContentPresenter [ Content = $Data, ContentTemplate = $Template ]`
    (the class's real visual) + `TextBlock [ Text = $Concept ]`.

  Direct `IsDraggable`/`OnDragStart` bindings on the row `Border` follow the Phase 3
  `TermTile` precedent (no Behavior needed); non-class rows bind `IsDraggable = false`
  and a `undefined` drag callback, so they are inert.

## Interactions

- **Expand/collapse**: inherent to `TreeView` (chevrons per level).
- **Drag**: only `Class` leaves; drops onto the architecture canvas create a node
  via the shared `TOOLBOX_NODE_KIND_FORMAT` term payload. The tree doubles as a
  term palette; the Phase 3 `ArchTermsPaletteService` is unaffected (an additional,
  independent drag source using the same format).
- **Inline preview**: single-selecting a class opens its preview beneath the row;
  selecting another class (or a group node) closes it.

## Testing

Rewrite `libraries-panel-service.test.ts` (synchronous `FakeStorage` seed, as
today) to assert the tree:

- A published library with classes of two concepts (e.g. `technology`, `component`)
  yields one `Library` node whose `Children` are two `Concept` nodes (sorted),
  each with its `Class` leaves.
- A `Class` leaf carries the full `TermId` (`stack.azure-openai`), its `Concept`,
  a resolved `Template` (`typeof leaf.Template.Apply === 'function'`),
  `IsDraggable === true`, and a `BeginKindDragData` that sets
  `TOOLBOX_NODE_KIND_FORMAT` to the term id.
- Group nodes have `IsDraggable === false` / no drag payload.
- Selecting a class leaf sets its `IsPreviewOpen`; selecting a second class clears
  the first and opens the second.
- `IsEmpty` is true when nothing is published.

Add `library-tree-node.test.ts` for the node factories (group vs leaf shape, drag
payload contents).

## Scope / non-goals

- Replaces `LibraryRow` / `ClassRow` / `ClassData` (only the panel service, its
  `.mu`, and its test reference them — verified before deletion).
- No new icon assets (reuse `@Libraries`; groups/leaves are text rows).
- No multi-select, rename, context menus, or drag-reordering (browse + drag-out +
  preview only). No lazy loading — the tree is built eagerly on `Reload`, as today.
- The Phase 3 `ArchTermsPaletteService` and canvas are untouched.

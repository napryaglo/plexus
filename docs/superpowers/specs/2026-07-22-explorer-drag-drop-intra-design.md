# Project Explorer Drag-and-Drop (SP-1: within a project) — Design

**Status:** Approved
**Date:** 2026-07-22
**Part of:** a two-sub-project split. **SP-1 (this):** drag-and-drop move within a single project. **SP-2 (later):** cross-project moves — adds `ReadBytes` to the storage seam, a cross-storage copy+delete, cross-project drop resolution, and moved-tab handling.

## Goal

Let the user drag the selected file/folder node(s) in a project's tree and drop them into a target subfolder (or onto the project header, treated as the root folder) to move them there — reusing the existing rename/relocate plumbing.

## Decisions (locked)

- **Move, not copy.** A drop moves the nodes (`storage.Rename`).
- **Within one project (SP-1).** Drops resolve only inside the same project the drag started in (same `IStorage`). Dragging over another project's rows is rejected (no move) — cross-project is SP-2.
- **Drop target = a folder.** Dropping on a folder targets that folder; dropping on a file targets the file's containing folder (forgiving); dropping on the project header or the empty tree area targets the project root (`''`).
- **Dragged set.** If the pressed node is part of `OpenProject.SelectedNodes`, the whole selection is dragged; otherwise just the pressed node.
- **Command seam.** The behavior invokes `OpenProject.MoveNodesCommand`; the move logic stays in `ProjectExplorerService` (mirrors `NewFileCommand`, `DeleteCommand`, etc.).

## Architecture & Data Flow

```
PointerDown on a row → record press point + pressed ProjectNode (HitTest → row DataContext)
PointerMove past ~4px threshold → begin drag:
   draggedSet = SelectedNodes if pressed ∈ SelectedNodes else [pressed]
   CapturePointer; show AdornerLayer ghost ("N item(s)")
PointerMove (dragging) → HitTest under pointer → resolveDropTargetPath(node) → highlight target folder row
PointerUp → ReleasePointerCapture; remove adorner; if valid target:
   op.MoveNodesCommand.Execute({ nodes: draggedSet, destPath })
      → ProjectExplorerService.moveNodes(op, nodes, destPath)
           for each node (skipping ones whose ancestor is also in the set):
             guard already-there / into-self-or-descendant / name-collision
             relocatePath(op, node.Path, <destPath>/<name>)   // Rename + repoint open tabs
           rescan(op)  // Adopt(reopen) + wireNodes, once
```

## Units That Change

### 1. `OpenProject.MoveNodesCommand`
`src/renderer/src/services/projects/open-project.ts`
- New DP `MoveNodesCommandKey` + accessor, mirroring `NewFileCommand`. Its command argument is `{ nodes: readonly ProjectNode[]; destPath: string }`.

### 2. `ProjectExplorerService` — the move + shared helpers
`src/renderer/src/modules/project-explorer/services/project-explorer-service.ts`
- Extract from `commitRename` two helpers (and call them there too):
  - `relocatePath(op, fromPath, toPath)`: `await op.Storage.Rename(fromPath, toPath); this.repointOpenDocuments(op, fromPath, toPath)`.
  - `rescan(op)`: `op.Adopt(await op.Factory.openProject(op.Storage)); this.wireNodes(op.Root, op)`.
  - `commitRename` becomes: collision check → `relocatePath` → `rescan` → status (behavior preserved).
- New `moveNodes(op, nodes, destParentPath)`:
  - Drop any node that has an ancestor also in `nodes` (a folder move already carries its descendants). Ancestor test: `other.Path === node.Path` prefix (`node.Path.startsWith(other.Path + '/')`).
  - For each remaining node: `dest = joinRel(destParentPath, node.Name)`.
    - **already there:** `parentOf(node.Path) === destParentPath` → skip silently.
    - **into self/descendant** (folder): `destParentPath === node.Path || destParentPath.startsWith(node.Path + '/')` → skip, set a status.
    - **collision:** `await op.Storage.Exists(dest)` → skip, set a status naming the conflict.
    - else `await this.relocatePath(op, node.Path, dest)`; count it.
  - If any node moved: `this.rescan(op)`; status `Moved N item(s).` (or the guard status when nothing moved).
- Wire in `wireProjectCommands`: `op.MoveNodesCommand = new RelayCommand((arg) => void this.moveNodes(op, (arg as MoveArg).nodes, (arg as MoveArg).destPath))` where `interface MoveArg { nodes: readonly ProjectNode[]; destPath: string }`.
- New exported pure helper `resolveDropTargetPath(node: ProjectNode | undefined): string` — `node === undefined` (root/header/empty) → `''`; folder → `node.Path`; file → `parentOf(node.Path)`. (Exported for the behavior + unit tests.)

### 3. `TreeDragDropBehavior`
`src/renderer/src/services/projects/tree-drag-drop-behavior.ts` (new)
- Extends `Behavior`; `OnAttached(visual)` stores the visual (the `TreeView`) and adds `PointerDown`/`PointerMove`/`PointerUp` routed-event listeners; `OnDetached` removes them + tears down any adorner.
- Reads its `OpenProject` from the visual's `DataContext` (like `TreeSelectionBehavior`).
- Press → drag threshold → capture + adorner; move → hit-test + resolve target + highlight; up → move via `op.MoveNodesCommand`. A drop whose resolved target equals the dragged node's current parent, or over a foreign project, is a no-op.
- Hit-testing a `ProjectNode` from a point: `visual.HitTest(point)` then walk `.Parent` until a visual whose `DataContext instanceof ProjectNode` (the row) — or the tree/header (→ root). Uses the same `AdornerLayer` API the framework's `ListReorderBehavior`/marquee use.

### 4. Template
`src/renderer/src/modules/project-explorer/project-explorer.resources.mu`
- Add `TreeDragDropBehavior` to the tree's `.Behaviors:` block (beside `TreeSelectionBehavior`).
- The project header `Border` (already the root-drop context) participates as the root target; the behavior resolves a hit on it (or empty area) to `''`.
- A drop-target highlight: a keyed brush/border state the behavior toggles on the hovered target row (via an adorner, so no per-row DP is needed).

## Error Handling

- Invalid drops (into self/descendant, name collision, foreign project, same-folder) are no-ops with a `Status` line; the tree is unchanged.
- A `Rename` failure mid-batch surfaces via `Status` (`Move failed: …`); already-moved nodes stay moved (a partial batch is acceptable and visible after `rescan`).
- The behavior is inert when its `DataContext` isn't an `OpenProject` (mirrors `TreeSelectionBehavior`).

## Testing

- **`moveNodes`** (extend `project-explorer-service` tests, or a focused move test with `FakeStorage`): move a file into a subfolder (storage path changes; tree re-scanned); move a folder with contents (children follow); a name collision is skipped with a status and no storage change; moving a folder into its own descendant is rejected; dropping into the current parent is a silent no-op; when a folder and its child are both selected, only the folder moves (child skipped).
- **`resolveDropTargetPath`** (pure unit test): folder node → its path; file node → parent path; `undefined` → `''`.
- The pointer/hit-test/adorner behavior is thin glue over these tested helpers; it is exercised manually (no DOM harness in the unit suite).

## Global Constraints

- Every test file in a `tests/` subfolder next to its source.
- Real TS enums; no new string-literal union types. (`MoveArg` is an interface, not a literal union.)
- Commits authored `Eugene Napryaglo <evgen.napryaglo@gmail.com>`; message ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Do NOT stage `src/renderer/src/modules/ontologies/services/ontologies-service.ts`.
- `.mu.js` are gitignored — regenerate with `npm run compile:mu`; do not commit them. No new `.mu` files (no `package.json` compile list change).
- Verify from `Plexus/`: `npm test`, `npm run typecheck`, `npm run compile:mu`.

## Definition of Done

- Dragging selected node(s) onto a folder row moves them into it; onto a file row moves them into that file's folder; onto the project header/empty area moves them to the project root.
- Invalid drops are no-ops with an explanatory status; open tabs for moved files re-point to their new paths.
- `npm test`, `npm run typecheck`, `npm run compile:mu` pass; `ontologies-service.ts` never staged.
- (SP-2, separately: cross-project moves.)

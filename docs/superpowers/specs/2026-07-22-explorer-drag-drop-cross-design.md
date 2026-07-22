# Project Explorer Drag-and-Drop (SP-2: across projects) — Design

**Status:** Approved
**Date:** 2026-07-22
**Builds on:** SP-1 (within-project drag-and-drop: `TreeDragDropBehavior`, `node-move.ts`, `moveNodes`, `MoveNodesCommand`).

## Goal

Dropping dragged node(s) onto **another** open project's folder / file / header moves them into that project (a different `IStorage`): copy the subtree across, delete the source, and — for any moved file that's open in a tab — keep the tab open by re-pointing it to the destination project.

## Decisions (locked)

- **Move across, binary-safe.** A cross-project drop copies each file's bytes (`ReadBytes`→`WriteBytes`) so text and binary both survive, then deletes the source.
- **Keep tabs open.** A moved file's tab stays open, re-pointed to the destination project's storage + path (not closed).
- **One command, branching.** `OpenProject.MoveNodesCommand`'s argument gains `source: OpenProject`; the handler runs the existing intra-project `moveNodes` when `source === target`, else `moveNodesAcross`.
- **Same guards as SP-1** for collisions (skipped with a status); the self/descendant guard is intra-only (a cross drop is always into a different tree).

## Units That Change

### 1. Storage seam — `ReadBytes`
The binary-safe read counterpart of the existing `WriteBytes`.
- `src/shared/file-system-api.ts`: add `FileSystemChannel.ReadBytes` + `ReadBytes(path): Promise<Uint8Array>` on the API interface.
- `src/main/filesystem.ts`: `ipcMain.handle(ReadBytes, (_e, path) => readFile(path))` returning a `Uint8Array`.
- `src/preload/index.ts`: bridge `ReadBytes` through `ipcRenderer.invoke`.
- `src/renderer/src/services/file-system/file-system-service.ts`: `ReadBytes(path): Promise<Uint8Array>`.
- `src/renderer/src/services/storage/storage.ts`: `IStorage.ReadBytes(path): Promise<Uint8Array>`.
- `src/renderer/src/services/storage/local-file-storage.ts`: delegates to `fs.ReadBytes(this.abs(path))`.
- `FakeStorage` (`tests/fake-storage.ts`): return the stored bytes (it already stores `WriteBytes` as a latin1 string — decode back to `Uint8Array`; `WriteText` content encodes via `TextEncoder` for round-tripping).

### 2. Cross-storage copy — `copyTree`
`src/renderer/src/services/storage/copy-tree.ts` (new) + test.
- `async function copyTree(src: IStorage, srcPath: string, dst: IStorage, dstPath: string): Promise<void>` — if `srcPath` lists as a directory, `dst.CreateDirectory(dstPath)` then recurse each child; else `dst.WriteBytes(dstPath, await src.ReadBytes(srcPath))`. A file-vs-folder decision uses the source's parent `List` (the node kind is known by the caller, but `copyTree` stays self-contained by probing: `List(srcPath)` non-empty or `Exists` semantics — simplest: the caller passes `isDirectory`). Signature: `copyTree(src, srcPath, dst, dstPath, isDirectory)`.

### 3. Editor cross-storage relocate (keep-tab-open)
- `src/renderer/src/modules/code-editor/code-file.ts`: `StorageCodeFile.storage` becomes mutable; `Retarget(id: string, storage?: IStorage)` re-points path and, when given, storage.
- `src/renderer/src/modules/code-editor/code-document.ts`: add `RelocateTo(storage: IStorage, newPath: string)` — retargets the file's storage + path and refreshes Id/Title/Language (mirrors the existing `Relocate(newPath)`, which stays for same-storage rename).
- `src/renderer/src/services/documents/document-factory.ts`: `IRelocatableDocumentFactory` gains optional `relocateAcrossStorage(document, storage, newPath): void`; add an `isRelocatableAcrossStorage` guard.
- `src/renderer/src/modules/meta-model/services/todl-document-factory.ts`: implement `relocateAcrossStorage(doc, storage, newPath)` → `(doc as CodeDocument).RelocateTo(storage, newPath)` then re-attach to the validator under the new storage.
- `src/renderer/src/services/todl/todl-validation-service.ts`: add `ReattachDocument(doc: CodeDocument, storage: IStorage)` — if tracked, update the stored storage (keep the Content listener) and schedule a revalidate, so the moved `.todl` validates against its **new** project's bases.

### 4. Explorer cross-move
`src/renderer/src/modules/project-explorer/services/project-explorer-service.ts`
- `MoveArg` gains `source: OpenProject`. The `MoveNodesCommand` handler: `source === op ? moveNodes(op, nodes, destPath) : moveNodesAcross(source, nodes, op, destPath)`.
- `moveNodesAcross(source, nodes, target, destParentPath)`:
  - Plan with a cross-project variant of the pure planner (no self/descendant guard; `to = joinRel(destParentPath, node.Name)`; still skips a node whose ancestor is also selected).
  - Per planned move: `if (await target.Storage.Exists(to))` → collision, skip + status; else `await copyTree(source.Storage, from, target.Storage, to, node.Kind === 'folder')`, then `await source.Storage.Delete(from)`.
  - For each open doc under `from` (in `source`): compute its new path under `to`; if its factory `isRelocatableAcrossStorage`, `relocateAcrossStorage(doc, target.Storage, newPath)`; reassign `docOwners.set(doc, target)`, `docPaths.set(doc, newPath)`. (A non-relocatable doc's tab closes, as today.)
  - `await this.rescan(source)` and `await this.rescan(target)`.
  - Status: `Moved N item(s) to <target.Name>.` (plus collision notes).
- Extract the per-doc re-point loop so it's shared with `repointOpenDocuments` where sensible (a `movedDocPath(oldBase, newBase, path)` helper).

### 5. Behavior
`src/renderer/src/services/projects/tree-drag-drop-behavior.ts`
- At drag start, also `data.Set(SOURCE_FORMAT, op)` (the source `OpenProject` from `ownerProject(source)`).
- On drop, read the source op from the DataObject and call the target's `MoveNodesCommand.Execute({ nodes, destPath, source })`. Same-project drops naturally have `source === target`.

## Error Handling

- A partial cross-move (a copy fails mid-batch) surfaces via `Status`; already-copied files remain and appear after the dual rescan. `copyTree` failures propagate to the handler's try/catch.
- Target name collisions are skipped with a status (SP-1 behavior).
- A moved file open in a non-relocatable editor closes its tab (existing close path); relocatable editors (`.todl`) keep it open.

## Testing

- **`ReadBytes`** — `LocalFileStorage.ReadBytes` delegates to `fs.ReadBytes(abs)`; `FakeStorage` round-trips `WriteBytes`→`ReadBytes`.
- **`copyTree`** — a file copies bytes across two `FakeStorage`s; a nested folder recreates its subtree; binary bytes survive.
- **`moveNodesAcross`** (explorer harness, two projects each a `FakeStorage`) — a file lands in the target storage and is gone from the source; an open `.todl` tab is re-pointed (its `docOwners` now the target) rather than closed; a target collision is skipped with a status.
- **`StorageCodeFile.Retarget(id, storage)` / `CodeDocument.RelocateTo`** — retargets both; subsequent read/write hit the new storage.
- The `TreeDragDropBehavior` cross-project path stays manual (no DOM harness).

## Global Constraints

- Every test file in a `tests/` subfolder next to its source.
- Real TS enums; no new string-literal union types.
- Commits authored `Eugene Napryaglo <evgen.napryaglo@gmail.com>`; message ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Do NOT stage `src/renderer/src/modules/ontologies/services/ontologies-service.ts`.
- `.mu.js` are gitignored; no `.mu` changes expected (the behavior file is already wired).
- Verify from `Plexus/`: `npm test`, `npm run typecheck`, `npm run compile:mu`.

## Definition of Done

- Dragging node(s) from project A onto project B's folder/file/header moves them into B (bytes copied, source removed); B's tree shows them, A's no longer does.
- A moved file open in a tab stays open, now saving to B's storage, and (for `.todl`) validates against B's bases.
- Same-project drops behave exactly as SP-1.
- Target collisions skip with a status; `npm test`/`typecheck`/`compile:mu` pass; `ontologies-service.ts` never staged.

# Import File / Import Folder — Design

**Date:** 2026-07-28
**Status:** ✅ Finished
**Scope:** Plexus (`project-explorer` module + `projects`/`file-system` services)

## Goal

Let the user bring an existing OS file or folder into a project: pick it through
a native dialog, copy it into the project's storage (recursively, for a folder),
and have it appear in the tree. Both commands are available on the project
context menu (import into the project root) and on tree-node context menus
(import into the target folder).

## Context (current state)

- `ProjectExplorerService.addExistingFilesTo(op)` already imports files: it opens
  a native multi-select dialog (`FileSystemService.OpenFiles`), copies each
  picked file into `op.Storage` under a collision-safe name
  (`uniqueStorageName`, `foo` → `foo-2`), then rescans the tree
  (`op.Adopt(await Factory.openProject(storage))` + `wireNodes`). It always
  targets the project root, and is surfaced only on the project context menu as
  **"Add Existing Files…"** (`op.AddFileCommand`).
- `FileSystemService` already exposes everything a folder import needs:
  `OpenFolder()` (native directory picker → absolute path or null),
  `ListDirectory(absPath)` (→ `readonly FileEntry[]`, each `{ Name, IsDirectory }`),
  and `ReadBytes(absPath)` (binary-safe read).
- `IStorage` provides `WriteBytes`, `CreateDirectory`, and the collision helper
  `uniqueStorageName(storage, relPath)`.
- `wireNodes(node, op)` computes each node's creation container:
  `node.Kind === 'folder' ? node.Path : parentOf(node.Path)` — the same target
  the new import commands use at node level. `New File`/`New Folder` already wire
  per-node commands this way.
- Path helpers are project-relative POSIX: `joinRel(dir, name)`, `parentOf`,
  `basename`, `extname`.

## Decisions

1. **Placement:** both commands on the project context menu (target = root) AND
   on node context menus (target = the node's container folder). Same targeting
   model as `New File`/`New Folder`.
2. **Naming:** relabel the existing project-level **"Add Existing Files…"** to
   **"Import File…"** and add **"Import Folder…"** beside it, so one consistent
   pair appears in both menus. `op.AddFileCommand` is renamed
   `op.ImportFileCommand` (its handler generalized to take a target folder).
3. **Collision:** only the top-level imported name is made unique
   (`uniqueStorageName`); a folder's descendants keep their names under the
   renamed top (`myfolder` → `myfolder-2`, contents unchanged). Per-file import
   keeps today's per-file uniquing.
4. **Refresh:** after copy, full rescan (`op.Adopt` + `wireNodes`) — the
   established pattern for *additive* structural changes (New File / New Folder /
   Add Files). (The surgical in-place path is only for rename, which mutates an
   existing node rather than adding nodes.)
5. **Not auto-opened:** imported items are not opened in the editor (matches the
   current file-import behavior).

## Components

### 1. `FileSystemService` — no change

`OpenFolder`, `ListDirectory`, `ReadBytes` already exist and are sufficient.

### 2. `ProjectExplorerService` — import methods

- `importFilesInto(op: OpenProject, target = ''): Promise<void>` — the
  generalization of `addExistingFilesTo`. Opens the multi-select dialog, and for
  each picked file writes it to `joinRel(target, uniqueStorageName-of-basename)`.
  On success, rescans and reports `Added N file(s).`
- `importFolderInto(op: OpenProject, target = ''): Promise<void>` — opens the
  folder picker (`fs.OpenFolder({ Title: 'Import folder into ${op.Name}' })`).
  On a non-null pick:
  - `destTop = await uniqueStorageName(op.Storage, joinRel(target, basename(dir)))`
    — the top-level project-relative destination (collision-renamed).
  - `await this.copyOsFolderInto(dir, destTop, op)` — recursive copy (below).
  - Rescan (`op.Adopt` + `wireNodes`); report `Imported ${basename(destTop)}.`
- `copyOsFolderInto(srcAbsDir: string, destRel: string, op: OpenProject): Promise<void>`
  — the recursive walk:
  - `await op.Storage.CreateDirectory(destRel)` (so an empty folder still lands).
  - For each `entry` of `await this.fs.ListDirectory(srcAbsDir)`:
    - child source path `childSrc = joinOs(srcAbsDir, entry.Name)` (node fs
      accepts `/` on Windows, so a plain `${srcAbsDir}/${entry.Name}` join is
      used), child dest `childDest = joinRel(destRel, entry.Name)`.
    - `entry.IsDirectory` → `await this.copyOsFolderInto(childSrc, childDest, op)`.
    - else → `await op.Storage.WriteBytes(childDest, await this.fs.ReadBytes(childSrc))`.

All wrapped in `try/catch`; a cancel (null pick / empty) is a silent no-op; an
error sets `this.Status = 'Import failed: …'`. Not transactional — a mid-way
failure can leave a partial copy (surfaced via status), consistent with the
existing multi-file import.

### 3. Command wiring

- **Project level** (`addOpenProject`): rename `op.AddFileCommand` →
  `op.ImportFileCommand` (`() => void this.importFilesInto(op, '')`); add
  `op.ImportFolderCommand` (`() => void this.importFolderInto(op, '')`).
  Add the matching DPs on `OpenProject`.
- **Node level** (`wireNodes`): with `container` already computed, add
  `node.ImportFileCommand` (`() => void this.importFilesInto(op, container)`) and
  `node.ImportFolderCommand` (`() => void this.importFolderInto(op, container)`).
  Add the matching DPs on `ProjectNode`.

### 4. Markup (`project-explorer.resources.mu`)

- `ProjectContextMenu`: replace the **"Add Existing Files…"** item (now
  `$ImportFileCommand`) and add an **"Import Folder…"** item (`$ImportFolderCommand`).
- `NodeContextMenu`: add **"Import File…"** (`$ImportFileCommand`) and
  **"Import Folder…"** (`$ImportFolderCommand`), after `New Folder`.
- Reuse the existing `@UploadFile` icon for Import File; use `@Folder` (or
  `@NewFolder`) for Import Folder — no new icon needed.

## Data flow

```
Import File  (menu) ─► importFilesInto(op, target)
   fs.OpenFiles ─► [{Path,Bytes}] ─► per file: storage.WriteBytes(joinRel(target, unique(basename)))
                                          └─► rescan (Adopt + wireNodes) ─► node appears

Import Folder (menu) ─► importFolderInto(op, target)
   fs.OpenFolder ─► absDir ─► destTop = unique(joinRel(target, basename(absDir)))
      copyOsFolderInto(absDir, destTop):
         storage.CreateDirectory(destRel)
         for entry in fs.ListDirectory(srcAbs):
            dir  ─► recurse
            file ─► storage.WriteBytes(childDest, fs.ReadBytes(childSrc))
      └─► rescan (Adopt + wireNodes) ─► subtree appears
```

## Testing (vitest)

Extend the test `fakeFs` with an in-memory OS source tree backing `OpenFolder`
(returns a preset picked path or null), `ListDirectory` (derives entries from the
source map), and `ReadBytes`. Then:

- **Import file into a subfolder** — `importFilesInto(op, 'src')` writes the
  picked file under `src/…` (target prefix honored), not the root.
- **Import folder reproduces the tree** — a source `pics/` with `a.png` +
  `sub/b.png` lands as `pics/a.png`, `pics/sub/b.png` in storage.
- **Top-name collision renames** — importing `pics/` when `pics` already exists
  writes under `pics-2/…`; the source's inner names are unchanged.
- **Cancel is a no-op** — `OpenFolder`/`OpenFiles` returning null writes nothing
  and doesn't rescan-error.
- **Existing file-import tests** still pass after the `addExistingFilesTo` →
  `importFilesInto(op, '')` generalization (the Priv interface / call sites
  updated).

## Out of scope (YAGNI)

- Opening imported items after import.
- Symlink / permission / file-size special handling (best-effort byte copy).
- Merge-into-existing on folder-name collision (auto-rename only).
- Progress UI for large imports (status message only).

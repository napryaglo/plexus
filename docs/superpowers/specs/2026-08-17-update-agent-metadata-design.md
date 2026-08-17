# Update Agent Meta-data command — Design

**Date:** 2026-08-17
**Status:** Approved (brainstorm)

## Goal

Give every TODL project a project-menu command, **"Update Agent Meta-data"**,
that refreshes its agentic scaffold docs (`.claude/**`) to the version currently
bundled in Plexus — while preserving the author-facing root `CLAUDE.md`.

## Motivation

The scaffold (`CLAUDE.md` + `.claude/todl-manual.md`, `todl-rules.md`, guides,
`/new-concept`) is written into a project at create time and self-healed
(missing-only) on open by `TodlProjectFactory.ensureScaffold` — but it is
strictly **write-once**, so a project created before a scaffold improvement never
receives the newer content. When the TODL language surface changes and the
bundled docs are updated (as in the todl-project-factory and prior scaffold
work), existing projects fall out of date with no in-app way to catch up. This
command closes that gap.

## Decisions (locked during brainstorm)

1. **Refresh scope = reference docs + guides; preserve `CLAUDE.md`.** Every
   scaffold file **except the root `CLAUDE.md`** is overwritten to the current
   bundled content. `CLAUDE.md` is the one file an author is likely to annotate,
   so it is only self-healed when missing, never overwritten. Because everything
   else lives under `.claude/` and is tooling-authored, the rule is simply
   "overwrite every entry whose path is not `CLAUDE_MD_FILENAME`."
2. **No confirmation dialog.** Nothing author-owned is ever overwritten, so the
   command runs directly and reports a status count.
3. **Applies to every TODL project** (architecture, meta-model, library) — all
   extend `TodlProjectFactory`. Gated by an `instanceof` feature test, so any
   future non-TODL project type simply won't show it.
4. **No `ScaffoldFile` interface change.** The author-owned/tooling-owned split is
   expressed by the single well-known path `CLAUDE_MD_FILENAME`, which the base
   already defines — no per-entry flag.

## Architecture

One base-class method does the work; a guard feature-tests it; the explorer wires
a menu command to it. All existing scaffold plumbing (`TODL_BASE_SCAFFOLD`,
`scaffoldContributions()`, `ensureScaffold`) is untouched except for the new
sibling method.

## Components

### `TodlProjectFactory.updateScaffold` (services/projects/todl-project-factory.ts)

```ts
// Refresh the scaffold to the current bundled content: overwrite every entry
// except the author-owned root CLAUDE.md (which is only written when missing).
// Mirrors ensureScaffold's file set; returns the project-relative paths written
// (refreshed or newly self-healed) for a status report. ensureScaffold stays
// write-once and unchanged — this is the deliberate-refresh counterpart.
public async updateScaffold(storage: IStorage): Promise<readonly string[]>
{
    await storage.CreateDirectory(`${CLAUDE_DIR}/commands`)
    const written: string[] = []
    for (const file of [...TODL_BASE_SCAFFOLD, ...this.scaffoldContributions()]) {
        if (file.path === CLAUDE_MD_FILENAME && await storage.Exists(file.path)) continue
        await storage.WriteText(file.path, file.content)
        written.push(file.path)
    }
    return written
}
```

### `isTodlProject` guard (same file)

```ts
export function isTodlProject(factory: IProjectFactory): factory is TodlProjectFactory
{
    return factory instanceof TodlProjectFactory
}
```

`instanceof` is sound here: `TodlProjectFactory` is a Plexus-local class and all
three concrete factories extend it.

### `OpenProject` command property (services/projects/open-project.ts)

`UpdateAgentMetadataCommand: ICommand | undefined` — RegisterProperty + get/set,
mirroring `PublishCommand`.

### `ProjectExplorerService` wiring (modules/project-explorer/services/…)

In `wireProjectCommands(op)`:

```ts
op.UpdateAgentMetadataCommand = new RelayCommand(
    () => void this.updateAgentMetadata(op), () => isTodlProject(op.Factory))
```

Method:

```ts
private async updateAgentMetadata(op: OpenProject): Promise<void>
{
    if (!isTodlProject(op.Factory)) { this.Status = 'This project type has no agent docs.'; return }
    const written = await op.Factory.updateScaffold(op.Storage)
    await this.rescan(op)                       // surface any self-healed file in the tree
    this.Status = `Agent docs updated (${written.length} refreshed).`
}
```

### `.mu` menu (modules/project-explorer/project-explorer.resources.mu)

Add a `MenuItem [ Header = "Update Agent Meta-data", Command = $UpdateAgentMetadataCommand ]`
to the `ProjectContextMenu`, after "Refresh Bases".

## Data flow

Menu → `RelayCommand` (enabled iff `isTodlProject`) → `updateAgentMetadata` →
`updateScaffold` (overwrite `.claude/**`, preserve existing `CLAUDE.md`) →
`rescan` → status bar.

## Error handling

- Non-TODL factory: guarded in the method and disabled in the menu via
  `CanExecute` — belt and suspenders.
- `updateScaffold` writes through `IStorage`; a write failure rejects the promise,
  surfaced the same way the sibling `void`-invoked commands (Publish / Generate
  Presentation) already handle it. No new failure modes — the file set and write
  path are the same ones `ensureScaffold` already uses.

## Testing

- **`todl-project-factory.test.ts`** (drive the base through the existing
  `FakeFactory`):
  - after editing `.claude/todl-manual.md` in storage, `updateScaffold` restores
    it to the bundled content;
  - an author-edited `CLAUDE.md` is preserved verbatim;
  - a deleted `.claude/todl-rules.md` is self-healed;
  - the returned list contains the refreshed paths and excludes a preserved
    `CLAUDE.md`.
- **Explorer test** (`project-explorer-service.test.ts`):
  - `UpdateAgentMetadataCommand.CanExecute` is `true` for a real
    `TodlProjectFactory` subclass (`new MetaModelProjectFactory(provider)`) and
    `false` for the plain-object `fakeProjectFactory()`;
  - `updateAgentMetadata` refreshes an edited `.claude` file and sets the status.

## Out of scope

- No confirmation dialog.
- No `ScaffoldFile` interface change / per-entry ownership flag.
- No change to `ensureScaffold`'s write-once create/open behavior.
- No overwrite of `CLAUDE.md` under any path.
- No new project types or manifest changes.

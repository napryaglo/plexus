# Update Agent Meta-data Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Update Agent Meta-data" project-menu command that refreshes a TODL project's `.claude/**` scaffold docs to the current bundled version while preserving the author-owned root `CLAUDE.md`.

**Architecture:** A new `TodlProjectFactory.updateScaffold` overwrites every scaffold entry except `CLAUDE.md` (only self-healed when missing); an `isTodlProject` `instanceof` guard feature-tests it; `ProjectExplorerService` wires a menu command onto `OpenProject` gated by that guard.

**Tech Stack:** TypeScript, `@pragmatic-lab/mural/runtime` (`RelayCommand`, `ICommand`), Vitest, mural `.mu` (compiled via `npm run compile:mu`).

## Global Constraints

- Every test file lives in a `tests/` subfolder next to its source.
- Renderer code uses `IStorage` (project-relative POSIX paths) — never `node:fs`/`node:path`.
- Refresh rule: overwrite every scaffold entry whose path is not `CLAUDE_MD_FILENAME`; a missing `CLAUDE.md` is self-healed, an existing one is never overwritten.
- No confirmation dialog; no `ScaffoldFile` interface change; `ensureScaffold`'s write-once create/open behavior is unchanged.
- Command applies to every TODL project (architecture, meta-model, library); gated by `instanceof TodlProjectFactory`.
- `npm run typecheck:web` clean; `npm test` green (baseline: 846 passed, 1 skipped). After editing `.mu`, run `npm run compile:mu`.
- Commit only when the user asks (the executor pauses at the finish menu); steps still show the commit.

---

### Task 1: `updateScaffold` + `isTodlProject` guard

Add the refresh method and the feature-test to the base class, tested through the existing fake subclass.

**Files:**
- Modify: `Plexus/src/renderer/src/services/projects/todl-project-factory.ts`
- Test: `Plexus/src/renderer/src/services/projects/tests/todl-project-factory.test.ts`

**Interfaces:**
- Consumes (already in the file): `TODL_BASE_SCAFFOLD`, `CLAUDE_DIR`, `CLAUDE_MD_FILENAME`, `ScaffoldFile`, `IStorage`, `IProjectFactory`, `this.scaffoldContributions()`.
- Produces: `TodlProjectFactory.updateScaffold(storage: IStorage): Promise<readonly string[]>` and `isTodlProject(factory: IProjectFactory): factory is TodlProjectFactory`.

- [ ] **Step 1: Write the failing test**

Append to `services/projects/tests/todl-project-factory.test.ts` (the `FakeFactory`, `factory()`, `FakeStorage`, and imports already exist in this file; add `isTodlProject` to the existing `todl-project-factory.js` import and `ServiceProvider` is already imported):

```ts
import { TodlProjectFactory, isTodlProject, type ScaffoldFile } from '../todl-project-factory.js'
```
(extend the existing import line — it currently imports `TodlProjectFactory, type ScaffoldFile`.)

```ts
test('updateScaffold refreshes .claude docs, preserves CLAUDE.md, self-heals missing', async () => {
    const storage = new FakeStorage('fake://P')
    const f = factory()
    await f.createProject(storage, 'P')                       // full scaffold + CLAUDE.md = 'FAKE ROOT'
    await storage.WriteText('.claude/todl-manual.md', 'HACKED')   // stale edit to a managed doc
    await storage.WriteText('CLAUDE.md', 'MY NOTES')              // author edit to the root
    await storage.Delete('.claude/todl-rules.md')                // a missing managed doc

    const written = await f.updateScaffold(storage)

    expect(await storage.ReadText('.claude/todl-manual.md')).toMatch(/namespace/)   // refreshed, not 'HACKED'
    expect(await storage.ReadText('CLAUDE.md')).toBe('MY NOTES')                    // preserved
    expect(await storage.Exists('.claude/todl-rules.md')).toBe(true)               // self-healed
    expect(written).toContain('.claude/todl-manual.md')
    expect(written).toContain('.claude/todl-rules.md')
    expect(written).not.toContain('CLAUDE.md')
})

test('isTodlProject is true for a TodlProjectFactory subclass, false for a plain factory', () => {
    expect(isTodlProject(factory())).toBe(true)
    expect(isTodlProject({ formats: [] } as unknown as import('../project-factory.js').IProjectFactory)).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd Plexus && npx vitest run src/renderer/src/services/projects/tests/todl-project-factory.test.ts`
Expected: FAIL — `f.updateScaffold is not a function` / `isTodlProject` not exported.

- [ ] **Step 3: Add `updateScaffold` to the base class**

In `todl-project-factory.ts`, add the method right after `ensureScaffold`:

```ts
    // Refresh the scaffold to the current bundled content: overwrite every entry
    // except the author-owned root CLAUDE.md (which is only written when missing).
    // Mirrors ensureScaffold's file set; returns the project-relative paths written
    // (refreshed or self-healed) for a status report. ensureScaffold stays
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

- [ ] **Step 4: Add the `isTodlProject` guard**

Add after the class (module scope), alongside the other exports. It needs `IProjectFactory` — extend the existing `project-factory.js` import to include it:

```ts
import {
    PROJECT_MANIFEST_FILENAME,
    type IProjectFactory,
    type ProjectFileFormat,
    type ProjectManifestEnvelope,
} from './project-factory.js'
```
(the file already imports the other three; add `type IProjectFactory`.)

Then, after the `TodlProjectFactory` class closing brace and before the `basename` helper:

```ts
// Type guard: is this factory a TODL-authoring project (and thus carries the
// agent scaffold updateScaffold refreshes)? All three concrete factories extend
// TodlProjectFactory, so instanceof is exact.
export function isTodlProject(factory: IProjectFactory): factory is TodlProjectFactory
{
    return factory instanceof TodlProjectFactory
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd Plexus && npx vitest run src/renderer/src/services/projects/tests/todl-project-factory.test.ts`
Expected: PASS (all tests, incl. the two new ones).

- [ ] **Step 6: Typecheck**

Run: `cd Plexus && npm run typecheck:web`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/services/projects/todl-project-factory.ts src/renderer/src/services/projects/tests/todl-project-factory.test.ts
git commit -m "feat: add TodlProjectFactory.updateScaffold + isTodlProject guard"
```

---

### Task 2: OpenProject command + explorer wiring

Add the command property, wire it, and add the explorer method — tested headlessly.

**Files:**
- Modify: `Plexus/src/renderer/src/services/projects/open-project.ts`
- Modify: `Plexus/src/renderer/src/modules/project-explorer/services/project-explorer-service.ts`
- Test: `Plexus/src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts`

**Interfaces:**
- Consumes: `isTodlProject` (`services/projects/todl-project-factory.js`); `MetaModelProjectFactory` (a concrete `TodlProjectFactory`) in the test.
- Produces: `OpenProject.UpdateAgentMetadataCommand` (`ICommand | undefined`), wired by `wireProjectCommands`; private `updateAgentMetadata(op)`.

- [ ] **Step 1: Add the command property to `OpenProject`**

In `open-project.ts`, after the `SetVersionCommandKey`/getter/setter block (added in the bump-version work), add:

```ts
    // Refresh the project's agent scaffold docs (.claude/**) to the current
    // bundled version — enabled for any TODL project.
    static readonly UpdateAgentMetadataCommandKey = Model.RegisterProperty<ICommand | undefined>(
        OpenProject, 'UpdateAgentMetadataCommand', undefined, MetaData.None)
```
and the getter/setter:
```ts
    public get UpdateAgentMetadataCommand(): ICommand | undefined { return this.get_property_value(OpenProject.UpdateAgentMetadataCommandKey) }
    public set UpdateAgentMetadataCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.UpdateAgentMetadataCommandKey, v) }
```

- [ ] **Step 2: Write the failing explorer tests**

In `project-explorer-service.test.ts`:

(a) Add the import at the top (the tests drive gating through `CanExecute`, so only the concrete factory is needed):

```ts
import { MetaModelProjectFactory } from '../../../../modules/meta-model/services/meta-model-project-factory.js'
```

(b) Extend the `ExplorerPrivates` interface with the new method:

```ts
    updateAgentMetadata(op: OpenProject): Promise<void>
```

(c) The tests (append at end of file):

```ts
test('Update Agent Meta-data is enabled for a TODL project, disabled for a plain factory', async () => {
    const { priv } = makeExplorer()
    const tOp = await priv.addOpenProject(projectWith('A', 'C:/a'), new MetaModelProjectFactory(new ServiceProvider()), new FakeStorage('C:/a'))
    const plainOp = await priv.addOpenProject(projectWith('B', 'C:/b'), fakeProjectFactory(), new FakeStorage('C:/b'))
    expect(tOp.UpdateAgentMetadataCommand!.CanExecute(undefined)).toBe(true)
    expect(plainOp.UpdateAgentMetadataCommand!.CanExecute(undefined)).toBe(false)
})

test('updateAgentMetadata refreshes a stale scaffold doc', async () => {
    const { priv } = makeExplorer()
    const factory = new MetaModelProjectFactory(new ServiceProvider())
    const storage = new FakeStorage('C:/a')
    await factory.createProject(storage, 'A')                 // full scaffold
    await storage.WriteText('.claude/todl-manual.md', 'HACKED')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), factory, storage)
    await priv.updateAgentMetadata(op)
    expect(await storage.ReadText('.claude/todl-manual.md')).toMatch(/namespace/)   // refreshed
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts`
Expected: FAIL — `priv.updateAgentMetadata is not a function` / `UpdateAgentMetadataCommand` undefined.

- [ ] **Step 4: Wire the command**

In `project-explorer-service.ts`, add `isTodlProject` to the imports from the base module:

```ts
import { isTodlProject } from '../../../services/projects/todl-project-factory.js'
```

In `wireProjectCommands(op)`, after the `RefreshBasesCommand` assignment, add:

```ts
        op.UpdateAgentMetadataCommand = new RelayCommand(
            () => void this.updateAgentMetadata(op), () => isTodlProject(op.Factory))
```

- [ ] **Step 5: Add the method**

Add near `publishProject`:

```ts
    // Refresh the project's agent scaffold docs (.claude/**) to the current bundled
    // version (preserving the author-owned CLAUDE.md), then rescan so any self-healed
    // file appears in the tree. Menu item is disabled for non-TODL types, but guard.
    private async updateAgentMetadata(op: OpenProject): Promise<void>
    {
        if (!isTodlProject(op.Factory)) { this.Status = 'This project type has no agent docs.'; return }
        const written = await op.Factory.updateScaffold(op.Storage)
        await this.rescan(op)
        this.Status = `Agent docs updated (${written.length} refreshed).`
    }
```

- [ ] **Step 6: Run the explorer suite + typecheck + full suite**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts && npm run typecheck:web && npm test`
Expected: explorer tests PASS; typecheck clean; full suite green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: wire Update Agent Meta-data command into the project explorer"
```

---

### Task 3: `.mu` menu item

Surface the command on the project context menu.

**Files:**
- Modify: `Plexus/src/renderer/src/modules/project-explorer/project-explorer.resources.mu`

**Interfaces:**
- Consumes: `OpenProject.UpdateAgentMetadataCommand` (Task 2).

- [ ] **Step 1: Add the menu item**

In `project-explorer.resources.mu`, in the `ContextMenu x:key="ProjectContextMenu"` block, after the `Refresh Bases` MenuItem, add:

```
        MenuItem [ Header = "Update Agent Meta-data", Command = $UpdateAgentMetadataCommand ]
```

- [ ] **Step 2: Compile the `.mu` + typecheck**

Run: `cd Plexus && npm run compile:mu && npm run typecheck:web`
Expected: compile succeeds (`compiled N files`); typecheck clean.

- [ ] **Step 3: Run the full suite**

Run: `cd Plexus && npm test`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add Update Agent Meta-data item to the project context menu"
```

---

## Notes for the executor

- **Do not** publish any package or touch Verdaccio; renderer-only TS + `.mu`.
- A live GUI smoke (right-click any TODL project → Update Agent Meta-data; confirm `.claude/todl-manual.md` matches the bundled version and `CLAUDE.md` is untouched) is a good manual check after Task 3 but is not a plan step — the headless tests cover the logic.
- The `compile:mu` step is required because the `.mu` is precompiled into a gitignored `.mu.js`; editing the `.mu` without recompiling leaves the menu stale.

# Agent Tracks Open-Project Directories — Design

**Status:** ✅ Finished
**Date:** 2026-07-22

## Goal

The in-app agent runs against the set of open project directories. When a project is opened, created, or closed, the agent re-targets so the **next** turn spawns a fresh claude CLI session with the updated directories — the first open project as `cwd`, the rest as `--add-dir`.

## Decisions (locked)

- **Auto-retarget next turn.** No button. On a directory-set change the running session is torn down lazily; the next `send` re-spawns the CLI at the new directories. An in-flight turn is not killed.
- **All open projects.** `cwd` = the first open project (store insertion order); every other open project is passed as `--add-dir`. Deterministic; no "active project" concept.
- **Fallback.** With no project open, `cwd = EnvironmentService.CurrentDirectory` (today's behavior) and no `--add-dir` — the agent stays usable.
- **Notification seam = `OpenProjectsStore`.** It already mutates at exactly open/create/close (`Add` in `addOpenProject`, `Remove` in `closeProject`); it becomes the observable source of open-project folders. The agent depends on this shared `services/projects` store, not on the project-explorer module.
- **Status line.** On a change, `AgentService.Status` names the target directories so the retarget is visible.

## Architecture & Data Flow

```
open / create project → ProjectExplorerService.addOpenProject → OpenProjectsStore.Add(folder)
close project         → ProjectExplorerService.closeProject   → OpenProjectsStore.Remove(folder)
   OpenProjectsStore mutates its in-memory mirror, persists, and notify()s subscribers
      AgentService (subscriber) updates workingDirs + Status
send a turn:
   AgentService.send → cwd = workingDirs[0] (or fallback), addDirs = workingDirs.slice(1)
      → window.api.agent.sendTurn(cwd, addDirs, text)   [IPC]
         → AgentSession.send(cwd, addDirs, text)
              if (cwd, addDirs) != running target → dispose + start(cwd, addDirs)   ← auto-retarget
              → AiProviderSession.send(text)
   ClaudeCliProvider.start(cwd, addDirs, onEvent):
      spawn claude at cwd with CLI_ARGS + addDirs.flatMap(d => ['--add-dir', d])
```

## Units That Change

### 1. `OpenProjectsStore` — observable open-folder source
`src/renderer/src/services/projects/open-projects-store.ts`
- Keep an in-memory mirror `folders: string[] | null` (lazy-loaded on first `List()`).
- `List()` loads the file into the mirror once, then returns the mirror.
- `Add`/`Remove` mutate the mirror, persist, and call `notify()`.
- New `Subscribe(listener: (folders: readonly string[]) => void): () => void` — returns an unsubscribe thunk; a set of listeners; `notify()` calls each with `Current()`.
- New `Current(): readonly string[]` — the mirror (or `[]` if not yet loaded).
- Behavior preserved: a missing/corrupt file → `[]`; `Add` dedupes by exact path (a dedup no-op does not notify — the set didn't change). Restore (which re-`Add`s already-present folders) therefore emits no spurious notifications; it seeds the mirror via `List()`.

### 2. Agent IPC surface (carry the directory set)
- `src/shared/agent-api.ts`: `startSession(cwd: string, addDirs: readonly string[]): Promise<void>`; `sendTurn(cwd: string, addDirs: readonly string[], text: string): Promise<void>`.
- `src/main/agent.ts`: the two `ipcMain.handle` handlers forward `addDirs` to `session.start` / `session.send`.
- `src/preload/index.ts`: the bridge methods pass `addDirs` through `ipcRenderer.invoke`.

### 3. `AgentSession` — restart on target change
`src/main/agent/agent-session.ts`
- Track the running target `{ cwd, addDirs }`.
- `start(cwd, addDirs)` disposes the old session, starts the provider with both, records the target.
- `send(cwd, addDirs, text)`: start when there is no session **or** the target differs (`cwd` changed or `addDirs` differs by length/element); then send. This is the auto-retarget.

### 4. Provider interface + CLI provider
- `src/main/agent/ai-provider.ts`: `AiProvider.start(workingDirectory: string, addDirs: readonly string[], onEvent): AiProviderSession`.
- `src/main/agent/claude-cli-provider.ts`: `start(workingDirectory, addDirs, onEvent)` builds `args = [...CLI_ARGS, ...addDirs.flatMap(d => ['--add-dir', d])]` and spawns at `workingDirectory`.

### 5. `AgentService` — derive directories from open projects
`src/renderer/src/modules/agent-chat/services/agent-service.ts`
- Resolve `OpenProjectsStore`; on construction force-load (`void store.List()`), seed `workingDirs = store.Current()`, and `Subscribe` → update `workingDirs` + `Status` on every change.
- Keep `fallbackCwd = EnvironmentService.CurrentDirectory`.
- `send`: `const dirs = this.workingDirs; const cwd = dirs.length ? dirs[0] : this.fallbackCwd; const addDirs = dirs.length ? dirs.slice(1) : []`; `void this.agent.sendTurn(cwd, addDirs, text)`.
- On change, set `Status` to e.g. `Agent directory: <cwd>` plus `(+N more)` when `addDirs` is non-empty; empty → `Agent directory: <fallbackCwd>`.
- `Dispose` (if the base provides one) unsubscribes; otherwise store the unsubscribe thunk for symmetry.

## Error Handling

- Empty open set → fallback `cwd`, no `--add-dir`.
- Open-project folders exist on disk (they were opened/created), so `--add-dir` paths are valid.
- A torn-down session simply re-spawns on the next send; the new CLI process starts a fresh conversation — inherent to changing the CLI's `cwd`, and consistent with the chosen "torn down" behavior.
- `OpenProjectsStore` file errors already degrade to `[]`; a listener throwing must not break the store (wrap each `notify` call defensively is optional — keep listeners trivial).

## Testing

- **`OpenProjectsStore`** (`tests/open-projects-store.test.ts`, extend): `Add`/`Remove` notify subscribers with the updated list; a dedup `Add` does not notify; `Current()` reflects the mirror; unsubscribe stops delivery.
- **`AgentSession`** (`tests/agent-session.test.ts`, extend): `send` with an unchanged `(cwd, addDirs)` reuses the session; a changed `cwd` **or** changed `addDirs` disposes + restarts; the fake provider records `addDirs`.
- **`ClaudeCliProvider`** (`tests/claude-cli-provider.test.ts`, extend): `start` with `addDirs` produces `--add-dir <d>` per extra directory, in order, and spawns at the given `cwd`.
- **`AgentService`** (`tests/agent-service.test.ts`, create if absent): derives `(cwd, addDirs)` from a fake `OpenProjectsStore` (`[A, B, C]` → `cwd=A, addDirs=[B,C]`); empty → `(fallbackCwd, [])`; a store notification updates `workingDirs` + `Status`; `send` calls `sendTurn` with the derived tuple. Uses a fake `window.api.agent` + a fake store.

## Global Constraints

- Every test file in a `tests/` subfolder next to its source.
- Real TS enums; no new string-literal union types.
- Commits authored `Eugene Napryaglo <evgen.napryaglo@gmail.com>`; message ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Do NOT stage `src/renderer/src/modules/ontologies/services/ontologies-service.ts`.
- `.mu.js` are gitignored; no `.mu` changes expected in this work.
- Verify from `Plexus/`: `npm test`, `npm run typecheck`.

## Definition of Done

- Opening, creating, or closing a project updates the agent's target directories; the next turn runs a fresh claude CLI session at `cwd` = first open project with the rest as `--add-dir`.
- No open projects → the agent runs at `CurrentDirectory` as before.
- `AgentService.Status` reflects the current target directories.
- `npm test` + `npm run typecheck` pass; `ontologies-service.ts` never staged.

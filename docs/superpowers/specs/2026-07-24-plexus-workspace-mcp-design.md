# PlexusWorkspace MCP server — design

**Status:** ✅ Finished

Date: 2026-07-24
Status: approved (design), pending implementation plan

## Purpose

Give the in-app AI agent a workspace-management MCP server, `PlexusWorkspace`,
wired into every agent session alongside the existing `AskUserQuestion` server.
Its first (and, for now, only) tool is `refresh_project`: the agent calls it
whenever it finishes a task that created, modified, deleted, moved, or renamed
files or folders inside a project directory, so the Plexus UI re-scans the
project from disk and re-validates its models. The tool returns a summary of
validation problems so the agent learns whether its edits introduced errors and
can react within the same session.

The server is a container that may grow more workspace tools later; only
`refresh_project` is in scope now (YAGNI on the rest).

## Decisions (settled during brainstorming)

1. **Refresh scope** — rescan the project's file/folder tree from disk **and**
   revalidate its models (re-resolve bases, re-run TODL validation) so the
   Problems panel reflects the agent's changes.
2. **Target project** — `refresh_project` takes an **optional `path`**. If given,
   refresh the open project whose folder contains that path; if omitted, refresh
   **all** currently-open projects.
3. **Result** — the tool **round-trips**: it waits for rescan + revalidate to
   finish and returns a per-project **problem summary** (error/warning counts +
   a few sample messages).
4. **Renderer wiring** — **Approach A**: reuse the agent's existing event stream
   for the refresh request (like the `AskUserQuestion` Question event) and a new
   IPC channel for the result (like `AnswerQuestion`). Chosen over a dedicated
   `window.api.workspace` surface (Approach B) for consistency with the existing
   pattern and minimal new surface.

## Architecture

A second in-process HTTP MCP server (`McpServer` + `StreamableHTTPServerTransport`)
stood up next to `AskUserQuestionServer` in `registerAgentHandlers()` and handed
to the Claude CLI in the same `--mcp-config` file. It exposes `refresh_project`,
allow-listed so it runs without a permission prompt under `--permission-mode
acceptEdits`.

Round-trip (mirrors AskUserQuestion):

```
agent → refresh_project(path?)                       [Claude CLI, over HTTP MCP]
  → PlexusWorkspaceServer handler: assign id,        [main]
    emit RefreshProject event, await promise (with timeout)
    → emitToRenderer → webContents.send(AgentChannel.Event)
      → renderer onEvent → WorkspaceRefreshService    [renderer]
        → resolve target project(s)
        → per project: ProjectExplorerService.RefreshProject
             (rescan tree + ClearBaseCache + Revalidate)
        → read DiagnosticsService.All filtered by projectId → build summary
        → window.api.agent.refreshProjectResult({ id, projects })
          → ipcMain.handle(RefreshProjectResult)       [main]
            → workspaceServer.resolve(result)
              → tool promise resolves → returns JSON summary to the agent
```

## Components

### Main process — `src/main/agent/`

**`plexus-workspace-server.ts` (new) — `PlexusWorkspaceServer`.**
Mirrors `ask-user-question-server.ts`.
- Constants: server key `PlexusWorkspace`; tool name `refresh_project`; qualified
  tool `mcp__PlexusWorkspace__refresh_project`.
- Stands up an HTTP server on a random port; `listen()`, `Url`,
  `setSink(sink)` (the `emitToRenderer` sink), `resolve(result)`.
- Registers `refresh_project` with input schema `{ path?: string }` (zod
  `z.string().optional()`), a clear description of *when* to call it.
- Handler: `refresh(path?)` assigns an id, registers a resolver in a `pending`
  map, emits the `RefreshProject` event via the sink, and awaits. A **30s
  timeout** resolves with an `error` result so a dead/absent renderer can never
  hang the tool. Returns `{ content: [{ type: 'text', text: JSON.stringify(summary) }] }`.
- Structured so additional tools register alongside `refresh_project` later.

**`agent.ts` / `registerAgentHandlers()` (edit).**
- Construct `PlexusWorkspaceServer`, `await listen()`, `setSink(emitToRenderer)`.
- Add to the `ClaudeCliProvider` `McpOptions`:
  - `servers`: add `PlexusWorkspace: { type: 'http', url: workspaceServer.Url }`
    alongside the existing question server.
  - `allowedTools`: add `mcp__PlexusWorkspace__refresh_project`.
- Register `ipcMain.handle(AgentChannel.RefreshProjectResult, (_e, result) =>
  workspaceServer.resolve(result))`.

**`claude-cli-provider.ts` (edit).**
- Append a system-prompt instruction via a new `--append-system-prompt` arg so
  the agent reliably calls `refresh_project` at the end of any turn that changed
  files/folders in a project. This is the "passed every session / called each
  time" reliability lever — the tool description alone is not reliable enough.
- Instruction (approximate): *"This workspace exposes a PlexusWorkspace MCP
  server. Call `mcp__PlexusWorkspace__refresh_project` (optionally with a path you
  changed) **only when** the work you just finished created, modified, deleted,
  moved, or renamed a file or folder inside a project directory — so Plexus
  re-scans the project from disk and re-validates its models. Call it once at the
  end of such work, not after every individual edit. **Do not call it** for turns
  that changed nothing on disk — answering a question, reading or explaining code,
  running read-only commands, or pure discussion."*
- The condition is **"files or folders actually changed"** — a read-only or
  conversational turn must not trigger a refresh.
- `mcpArgs()` already writes **all** servers into one config file, so adding a
  second server needs no change there beyond the `McpOptions` above.

### Shared — `src/shared/agent-api.ts`

- `AgentEventKind.RefreshProject` — main→renderer event, rides `AgentChannel.Event`.
  Payload `Request: { id: string; path?: string }`.
- `AgentChannel.RefreshProjectResult` — new renderer→main channel.
- `IAgentApi.refreshProjectResult(result: RefreshProjectResult): Promise<void>`.
- Types:
  - `RefreshProjectRequest { id: string; path?: string }`
  - `RefreshedProjectSummary { name: string; folder: string; errorCount: number;
    warningCount: number; sampleMessages: string[] }`
  - `RefreshProjectResult { id: string; projects: RefreshedProjectSummary[];
    note?: string; error?: string }`
- Enum members, not string-literal unions (repo convention).

### Preload — `src/preload/index.ts`

- Add `refreshProjectResult: (result) => ipcRenderer.invoke(AgentChannel.RefreshProjectResult, result)`
  to the `agent` API object. The `RefreshProject` **event** already flows through
  the existing `onEvent` subscription (same `AgentChannel.Event`).

### Renderer

**`WorkspaceRefreshService` (new, single-purpose).**
- Registered in the renderer composition root.
- Subscribes to agent events (`window.api.agent.onEvent`), handling
  `RefreshProject`.
- On a request:
  1. **Resolve targets.** If `path` is set, find the open project whose folder is
     a path-prefix of `path` (normalize separators and case on Windows). If none
     match, produce an empty result with a `note`. If `path` is omitted, target
     all open projects.
  2. For each target: `ProjectExplorerService.RefreshProject(folder)`
     (rescan + `ClearBaseCache` + `Revalidate`).
  3. Build `RefreshedProjectSummary` from `DiagnosticsService.All` filtered by
     `projectId` (= project `RootPath` = `OpenProject.Folder`): error count,
     warning count, first 5 messages.
  4. `window.api.agent.refreshProjectResult({ id, projects, note?, error? })`.
- Depends on: `ProjectExplorerService`, `TodlValidationService` (via
  ProjectExplorerService), `DiagnosticsService`, and the open-project set.

**`ProjectExplorerService` (edit).**
- Add `public async RefreshProject(folder: string): Promise<void>` that looks up
  the `OpenProject` by folder and runs the existing private `rescan(op)` followed
  by the base-cache clear + revalidate (the existing `refreshBases` pattern:
  `TodlValidationService.ClearBaseCache(op.Storage)` then `Revalidate()`).
  Awaitable so the caller knows when validation has settled.

## Data model

- **Project identity** = absolute folder path (`Project.RootPath` =
  `OpenProject.Folder` = `Diagnostic.projectId`). The single key threaded through
  target resolution, refresh, and summary building.
- **Problem summary** is derived, not stored — read from `DiagnosticsService.All`
  after `Revalidate()` completes.

## Error handling

- **Path matches no open project** → result with empty `projects` and a `note`
  (e.g. `"no open project contains <path>"`); not an error.
- **No open projects** → empty `projects`, `note`.
- **Revalidate throws for a project** → that project's summary carries an
  `error`; other projects still returned.
- **No renderer window / renderer never responds** → server-side **timeout**
  resolves the tool with `error` so it never hangs.
- **Sink missing** (no window at request time) → resolve immediately with `error`.
- Path matching normalizes Windows separators (`\` vs `/`) and case before
  prefix comparison.

## Testing

Tests live in `tests/` subfolders next to their source (Plexus convention).

- **`PlexusWorkspaceServer`** — a tool call blocks until `resolve()` is called
  and then returns the summary as JSON tool content; timeout path resolves with
  an error. (Mirrors the existing ask-user-question-server test.)
- **`ClaudeCliProvider`** — `mcpArgs()` (or equivalent) emits both servers in the
  config, allow-lists `mcp__PlexusWorkspace__refresh_project`, and includes the
  appended system prompt.
- **`WorkspaceRefreshService`** — target resolution: `path` → owning project by
  prefix match (incl. Windows sep/case); omitted `path` → all open projects;
  no-match → note. Summary building against a fake `DiagnosticsService`.
  Result dispatched via a fake agent API.
- **`ProjectExplorerService.RefreshProject`** — rescans the tree and triggers
  `ClearBaseCache` + `Revalidate` (fakes for storage/validation).

## Out of scope

- File watching / automatic refresh (refresh stays agent-driven and pull-based).
- Additional PlexusWorkspace tools beyond `refresh_project`.
- Reloading open editor documents from disk / conflict resolution for unsaved
  edits (rescan + revalidate only; open buffers keep overlaying validation as
  they do today).
- A dedicated `window.api.workspace` preload surface (Approach B).

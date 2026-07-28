# TODL Language Server — Spec 3: Plexus Client Integration

**Goal:** Wire the completed out-of-process TODL language server
(`@pragmatic-lab/todl/language-server`) into Plexus so that its Monaco `.todl`
editors get the full LSP authoring loop — diagnostics, completion, hover,
go-to-definition, find-references, document symbols, rename, semantic tokens,
folding, code actions, formatting, signature help — driven by a real language
server forked from Electron main, with the in-renderer validation pass retired.

**Status:** Design approved 2026-07-28. This is **Component 3** of the umbrella
design `TODL/docs/superpowers/specs/2026-07-28-todl-language-server-design.md`.
Specs 1 (analysis core) and 2 (LSP server) are DONE on TODL `main`. This spec is
Plexus-side only and depends on Spec 2's `createServer` + stdio entry.

---

## Resolved decisions (Spec-3-specific forks)

The umbrella fixed the approach-level forks (out-of-process server, `utilityProcess`
+ IPC relay, hand-rolled Monaco adapters, client pushes sources, subpath exports).
These four Spec-3 forks were resolved during this brainstorm:

| Fork | Decision |
| --- | --- |
| TODL consumption | **Vendor the bundled server into Plexus** — a standalone electron-vite output (`out/server/todl-language-server.js`) that `main` forks, decoupling runtime from the registry version. Build-time source comes from cutting **TODL 0.3.0** to Verdaccio (a finishing prerequisite; dev may proceed on a local file-link). |
| Process + transport | **`utilityProcess` + main frames, forwards message objects.** `main` uses `vscode-jsonrpc/node` stream reader/writer over the child's stdio purely to frame/deframe; it forwards decoded JSON-RPC message *objects* to the renderer over IPC, never interpreting them. The renderer runs the full `MessageConnection`. |
| Document URIs | **Synthetic `todl://` scheme + client registry.** `uri = todl://<projectKey>/<relpath>`, `rootUri = todl://<projectKey>/`. Preserves the `IStorage` abstraction (works for future non-local storage); the client maps URIs back to `(project, storage, relpath)`. |
| Validation service | **New `TodlLanguageClient`; retire `TodlValidationService`.** Its `checkAgainst` + publish half is removed; source-collection / base-resolution / attach-detach lifecycle migrates into the client. |
| Plan shape | **One plan, all capabilities**, with tasks ordered so the `WorkspaceEdit` write-path is its own cluster. |

---

## Architecture & layering

Four Plexus-side pieces plus a build artifact. Dependency direction is one-way:

```
renderer  TodlLanguageClient + Monaco adapters
   │  (todlLsp opaque message pipe, JSON-RPC message objects)
preload   todlLsp bridge  (send / onMessage / onServerRestart)
   │  (IPC: todl-lsp:to-server / :from-server / :server-restart)
main      TodlServerHost  (utilityProcess fork + stdio framing + relay)
   │  (child stdio, Content-Length framed LSP)
child     out/server/todl-language-server.js  (vendored Spec-2 server)
```

Nothing points back: the server bundle is Spec 2 verbatim; `main` is
semantics-blind; the renderer never imports server internals.

### Build — the vendored server bundle

A new electron-vite build input bundles TODL's `language-server` stdio entry into
`out/server/todl-language-server.js`:

- Node built-ins (`fs`, `path`, `url`, …) stay external; `@pragmatic-lab/todl`
  (compiler + `language-service` + `language-server`) and `vscode-languageserver`
  are bundled in, so the child needs nothing from `node_modules` at runtime.
- Configured as an additional rollup input under electron-vite's `main` build (or a
  sibling config), emitting a standalone CJS/ESM file that `utilityProcess.fork`
  can execute directly in dev and in the packaged app.
- **Build-time source:** Plexus's installed `@pragmatic-lab/todl` must expose the
  `./language-server` subpath. The clean prerequisite is publishing **TODL 0.3.0**
  to Verdaccio and bumping Plexus's dependency; during development a local
  `file:`-link to the TODL checkout is acceptable. This is a finishing/prerequisite
  step, not a plan task — the vendored bundle is what actually ships.

### New Plexus dependencies

- `vscode-jsonrpc` — `main` uses `/node` (`StreamMessageReader`/`StreamMessageWriter`)
  for framing; the renderer uses the base `createMessageConnection` over a custom
  reader/writer.
- `vscode-languageserver-types` — pinned **`3.17.5`** to match the server runtime
  (the 3.18 duplicate-identity hazard from Spec 2 applies here too). Used by the
  renderer adapters for LSP request/response types and by the pure range mappers.

---

## Main process — `TodlServerHost` + preload channel

### `TodlServerHost` (`src/main/todl/`)

A dumb, semantics-blind relay owning the child's lifecycle.

- **Spawn:** lazy — `utilityProcess.fork(<bundle path>, [], { stdio: 'pipe' })` on the
  first `todl-lsp:to-server` message (or an explicit start channel). The bundle path
  resolves from `__dirname` in dev and the packaged `out/server/` location.
- **Framing:** `new StreamMessageReader(child.stdout)` / `new StreamMessageWriter(child.stdin)`
  from `vscode-jsonrpc/node`. `reader.listen(msg => window.webContents.send('todl-lsp:from-server', msg))`.
  Renderer→child: `ipcMain.on('todl-lsp:to-server', (_e, msg) => writer.write(msg))`.
  No `MessageConnection` here — the reader/writer are used purely to frame; message
  *objects* cross IPC (structured-clone friendly).
- **Lifecycle:** on unexpected child `exit`, restart the child and
  `webContents.send('todl-lsp:server-restart')` so the renderer resyncs. Kill the
  child on window close / app quit.
- **stderr:** piped to the main-process log for diagnosis; never forwarded as protocol.

### Preload (`src/preload/`)

A minimal opaque `todlLsp` bridge exposed via `contextBridge` (matching the existing
`api` shape):

```ts
interface TodlLspBridge {
  send(msg: unknown): void                       // → todl-lsp:to-server
  onMessage(cb: (msg: unknown) => void): () => void   // ← todl-lsp:from-server
  onServerRestart(cb: () => void): () => void         // ← todl-lsp:server-restart
}
```

No LSP types cross the preload boundary — it is an opaque JSON-RPC-message pipe.
New channel enum (`src/shared/todl-lsp-api.ts`): `TodlLspChannel.ToServer`,
`.FromServer`, `.ServerRestart`.

---

## Renderer — `TodlLanguageClient` service

Replaces `TodlValidationService` as the center of gravity
(`src/renderer/src/services/todl/todl-language-client.ts`, `ServiceBase`, DI key).

### Connection

Builds a `vscode-jsonrpc` `MessageConnection` over a custom
`AbstractMessageReader`/`AbstractMessageWriter` pair wrapping `window.api.todlLsp`
(`onMessage` feeds the reader; `write` calls `send`). Mirrors Spec 2's in-memory
harness. Sends `initialize` (advertising client capabilities /
`initializationOptions.mode = "pushed"`) then `initialized`. On `onServerRestart`,
re-initializes and re-syncs every registered project.

### URI registry

- `projectKey(rootPath)` — a stable, reversible encoding of `Project.RootPath`
  (e.g. `encodeURIComponent`), so `todl://<projectKey>/` is a valid opaque authority.
- Maps: `projectKey → { project, storage }` and `uri ↔ relpath`.
- `uriFor(projectKey, relpath) → todl://<projectKey>/<relpath>` and the inverse
  `resolve(uri) → { project, storage, relpath }`. Every provider, diagnostic, and
  edit keys on these URIs.

### Source & base feed (migrated from `TodlValidationService`)

- **Attach project** (was `AttachProject`): register in the URI registry →
  `resolveBases(provider, bindings)` → `todl/setBases` notification (rootUri +
  base `TodlDocument`s as JSON) → `collectTodlSources(storage)` → `didOpen` every
  `.todl` (whole project, not just the visible tab).
- **Attach document** (was `AttachDocument`): wire the open editor's live buffer —
  on `CodeDocument.Content` change, send a **full-text `didChange`** (the server's
  incremental sync accepts a range-less full replace; whole-project re-analysis makes
  incremental diffing pointless here).
- **Structural changes:** create → `didOpen`; delete → `didClose` + drop registry
  entry; rename / move → `didClose` old + `didOpen` new (cross-project move closes in
  the old rootUri and opens in the new).
- **Refresh-Bases** (republish; was `ClearBaseCache`): re-`resolveBases` →
  `todl/refreshBases`.
- **Detach project** (project close): `didClose` all its docs + `todl/setBases` empty
  / drop the project from the registry.
- Closing an editor *tab* does **not** `didClose` — project files stay open
  server-side for whole-project analysis.

### Diagnostics in

Server `publishDiagnostics(uri, Diagnostic[])` (LSP, 0-based) →

1. map each LSP `Diagnostic` → canonical Plexus `Diagnostic`
   (`owner="todl"`, `projectId=project.RootPath`, `projectName`, `uri=relpath`,
   `span` 1-based / exclusive-end, severity map), reusing the existing canonical
   mapping shape.
2. accumulate per project in a `projectId → Map<uri, Diagnostic[]>` cache (the
   server publishes every file each round, including empty arrays).
3. `DiagnosticsService.Publish("todl", projectId, flattenedForProject)` — atomic
   per-`(owner, projectId)` replace, exactly as today. Problems panel + Monaco
   markers are unchanged downstream.

---

## Model URIs + Monaco adapters

### Model-URI fix (`CodeEditor` / `CodeDocument`)

- `CodeDocument` gains an optional stable `Uri` property. `TodlDocumentFactory` sets
  it (`todl://<projectKey>/<relpath>`) via the client registry when opening a `.todl`
  document.
- `CodeEditor` honors it: when `Uri` is present, create the model explicitly —
  `monaco.editor.getModel(uri) ?? monaco.editor.createModel(text, language, uri)` —
  and pass `{ model }` to `monaco.editor.create`. When absent, keep today's anonymous
  model (back-compat for non-`.todl` editors). Load-bearing but small; `CodeEditor`
  stays generic (it does not know about projects or TODL).

### Adapters (`src/renderer/src/modules/meta-model/todl-lsp/`)

~12 thin `monaco.languages.register*Provider` shims for the `todl` language id, each
`model + position → LSP request over the connection → Monaco result`, built over
**pure, unit-tested `monaco ↔ lsp` range/position mappers** (Monaco 1-based ⇄ LSP
0-based):

completion (trigger characters `&`, `:`, `-`, space) · hover · definition ·
references · document symbols · folding · document semantic tokens (with the server's
legend) · signature help · rename + `resolveRenameLocation` (prepare) · code actions ·
document formatting.

**Honest flags:**
- **Workspace symbols** — the server supports it, but standalone Monaco has no
  workspace-symbol UI surface; client wiring is deferred to a later Plexus
  command/quick-open (out of this spec's UI scope).
- **Signature help** — stays thin (field/relationship type + cardinality only).
- **Go-to-definition into a base** — best-effort; a no-op when base source is absent
  (inherited from the core).

---

## WorkspaceEdit application (the fiddly write-path)

Rename and quick-fixes return a `WorkspaceEdit` (`{ changes: { uri: TextEdit[] } }`)
that may span open *and* closed files. Monaco would only apply edits to models it
knows (open buffers) and silently drop closed-file edits — so adapters do **not**
return the edit to Monaco. Instead they delegate to a single unified method:

`TodlLanguageClient.applyWorkspaceEdit(edit)` — for each uri, `resolve(uri)`, then:

- **Open buffer** (a Monaco model exists for the uri): apply via
  `model.applyEdits(...)` / `pushEditOperations`, preserving dirty tracking + undo
  and routing through the `CodeEditor.Text` ↔ `CodeDocument.Content` two-way binding.
- **Closed file:** `storage.ReadText(relpath)` → apply that file's `TextEdit`s
  **sorted offset-descending** (so earlier edits don't shift later offsets) →
  `storage.WriteText(relpath, result)`.

One tested path for both rename and code-action edits. **Trade-off (flagged):** v1
loses Monaco's native rename *preview*; the rename still triggers through the
provider and applies atomically through this path.

---

## Retiring `TodlValidationService`

- Remove its `checkAgainst` call + `DiagnosticsService.Publish` (the server owns
  diagnostics now). Its source-collection (`collectTodlSources`), base-resolution
  (`resolveBases` + cache), and attach/detach lifecycle migrate into
  `TodlLanguageClient`.
- Rewire call sites to the client:
  `TodlDocumentFactory.openFile` / `relocateOpenFile` / `relocateAcrossStorage`
  and `ProjectExplorerService` project attach/detach (≈ lines 295 / 803).
- `collectTodlSources` and `resolveBases` are reused as-is (imported by the client).

---

## Data flow (pushed mode)

1. **Project opens** → client registers projectKey → `resolveBases` →
   `todl/setBases` + `didOpen` every `.todl` → server `analyze()` →
   `publishDiagnostics` per file → client routes into `DiagnosticsService` →
   Problems + markers populate.
2. **User edits** → `CodeDocument.Content` change → full-text `didChange` → server
   debounced re-`analyze()` → `publishDiagnostics` → markers update.
3. **Hover / Ctrl-click / Ctrl-Space / signature** → Monaco adapter → `sendRequest`
   → core query → result → Monaco renders.
4. **Rename / quick-fix** → adapter → server returns `WorkspaceEdit` →
   `applyWorkspaceEdit` (open buffers via Monaco model, closed files via storage).
5. **Server crash** → `TodlServerHost` restarts child → `onServerRestart` →
   client re-`initialize` + resync bases + all open documents.

---

## Testing strategy

- **Client unit tests** against a **fake `MessageConnection`**
  (`sendNotification`/`sendRequest` recorded; canned responses):
  - source-sync sequencing — attach project → `todl/setBases` + N `didOpen`s;
    edit → `didChange` (full text); delete → `didClose`; rename → close+open;
    Refresh-Bases → `todl/refreshBases`.
  - diagnostics routing — fake `publishDiagnostics` (incl. empty arrays) →
    assert canonical `Diagnostic[]` published to a fake `DiagnosticsService`, with
    correct project accumulation and 0→1-based conversion.
  - `applyWorkspaceEdit` — open-buffer edit preserves dirty state (fake model);
    closed-file edit goes through fake storage with descending-offset application.
- **Pure range/position mappers** — exhaustive Monaco⇄LSP unit tests.
- **`TodlServerHost`** — relay forwards both directions and crash→restart→signal,
  driven by a fake child (in-memory streams). No real `utilityProcess`.
- **Manual smoke** (`npm run dev`) — the irreducibly visual gate: hover popups,
  Ctrl-click navigation, completion widget, rename box, red squiggles, quick-fix
  lightbulb, formatting. A user-run checklist.

Tests live in `tests/` subfolders next to their source (Plexus convention). The
thin Monaco adapters themselves need no headless-Monaco test — their logic is the
pure mappers, which are tested directly.

---

## Scope boundaries

- **In (v1, all capabilities):** server host + fork + relay, preload channel,
  renderer client, model-URI fix, source/base sync, diagnostics routing, and every
  Monaco adapter including rename, code actions, formatting, and the unified
  `WorkspaceEdit` write-path.
- **Deliberately thin / deferred:** workspace-symbol UI (server-supported, no Monaco
  surface — later Plexus command), signature help, go-to-def into bases (no-op
  without base source), native rename preview.
- **Out of scope (later):** standalone VS Code extension packaging; incremental /
  partial re-analysis (v1 re-analyzes the whole project per debounce, matching
  today's validation); FS-mode wiring in Plexus (Plexus is pushed-mode only — FS
  mode exists in the server as external-reuse insurance).

---

## Open risks

- **`utilityProcess` packaging path.** The vendored bundle must resolve and execute
  in dev *and* the packaged Electron app. Mitigation: an early end-to-end smoke —
  "host forks the bundle and the child answers `initialize`" — before building
  providers on top.
- **`WorkspaceEdit` vs. dirty buffers.** Multi-file edits touching open, unsaved
  documents are the subtlest correctness surface. Mitigation: the dedicated
  write-path task cluster + tests distinguishing open-buffer vs. closed-file edits.
- **TODL 0.3.0 availability.** The build needs the new subpaths. Mitigation: cut and
  publish 0.3.0 (or local-link) as a prerequisite before the build task.
- **Whole-project re-analysis cost.** Acceptable at current project sizes (matches
  today's validation); a known future optimization target.

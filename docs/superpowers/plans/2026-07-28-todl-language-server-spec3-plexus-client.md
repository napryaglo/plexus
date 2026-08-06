# TODL Language Server — Spec 3 (Plexus Client) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the completed out-of-process TODL language server into Plexus so its Monaco `.todl` editors get the full LSP authoring loop, with the in-renderer validation pass retired.

> **Status: ✅ Implemented & merged to `main` (verified 2026-08-06).** All deliverables are on `main` — `TodlServerHost` + `register.ts` (main), the preload channel, `TodlLanguageClient` + provider adapters (renderer), wired at startup (`main/index.ts` → `registerTodlServerHandlers`; `renderer/main.js` → `registerTodlProviders`). The vendored server bundle builds (`scripts/build-todl-server.mjs` → `out/main/todl-language-server.cjs`) from `@pragmatic-lab/todl@0.14.0`, which ships the `/language-server` subpath. Plexus todl tests 22/22 green. The unticked step boxes below were not checked off during execution — they are **not** outstanding work. The sole remaining gate is the human-run manual smoke checklist (`../todl-lsp-smoke-checklist.md`).

**Architecture:** Electron main forks a vendored, self-contained server bundle (`utilityProcess`) and relays framed JSON-RPC message *objects* over IPC through an opaque preload pipe. A renderer `TodlLanguageClient` service runs a `vscode-jsonrpc` `MessageConnection` over that pipe, pushes every project `.todl` (+ resolved bases) to the server, routes pushed diagnostics into the existing `DiagnosticsService`, and registers ~12 hand-rolled Monaco provider adapters. Documents are identified by a synthetic `todl://<projectKey>/<relpath>` URI backed by a client registry; multi-file `WorkspaceEdit`s apply through one unified path (open buffers via the Monaco model, closed files via `IStorage`).

**Tech Stack:** TypeScript (ESM, strict), Electron + electron-vite, Vitest, monaco-editor 0.55, `@pragmatic-lab/todl`, `vscode-jsonrpc`, `vscode-languageserver-types`, esbuild (server bundle), mural runtime (DI / `ServiceBase` / `Model` DPs).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-28-todl-language-server-spec3-plexus-client-design.md`. Umbrella Component 3: `../../../TODL/docs/superpowers/specs/2026-07-28-todl-language-server-design.md`.
- Pin `vscode-languageserver-types` to exactly **`3.17.5`** (match the server runtime; 3.18 causes duplicate-identity type mismatches).
- Every test file lives in a `tests/` subfolder next to its source (`src/foo/tests/foo.test.ts`), never beside the source. Vitest globs `src/**/*.test.ts`.
- Run a single test file: `npx vitest run <path>`. Full suite: `npm test`. Typecheck: `npm run typecheck`.
- Strict TS: guard indexed access; never assign `undefined` to an optional field — omit it or spread conditionally.
- Synthetic URI scheme only: `rootUri = todl://<projectKey>/`, `docUri = todl://<projectKey>/<relpath>`, `projectKey = encodeURIComponent(projectId)`, `projectId = Project.RootPath`. Never `file://` (preserves the `IStorage` abstraction).
- Diagnostic owner id is the string `"todl"` (already used by `DiagnosticsService`).
- LSP positions are 0-based; Monaco positions and canonical `Diagnostic`/`EditorDiagnostic` are 1-based with exclusive end. Convert at the boundary only.
- Work happens in the **Plexus** repo on branch `todl-language-server-spec3-plexus-client` (already created). All commits are Plexus commits.
- **Prerequisite (not a task):** the build needs `@pragmatic-lab/todl` to expose the `./language-server` + `./language-service` subpaths. Cut/publish **TODL 0.3.0** to Verdaccio and bump Plexus's dependency, or `npm link` the local TODL checkout, before Task 1's build step. The vendored bundle is what ships at runtime.

---

## File Structure

**New — shared:**
- `src/shared/todl-lsp-api.ts` — `TodlLspChannel` enum + `ITodlLspApi` bridge interface. The only main↔renderer contract; carries opaque JSON-RPC message objects.

**New — main:**
- `src/main/todl/server-entry.ts` — the server's process entry: builds a stdio `createConnection`, calls TODL's `createServer`, listens. Bundled standalone.
- `src/main/todl/todl-server-host.ts` — `TodlServerHost`: `utilityProcess.fork` the bundle, frame/deframe via `vscode-jsonrpc/node`, relay message objects, restart on crash. `registerTodlServerHandlers()`.
- `scripts/build-todl-server.mjs` — esbuild step bundling `server-entry.ts` → `out/main/todl-language-server.cjs` (node platform, only node built-ins external).

**New — preload:** (edit) `src/preload/index.ts` adds the `todlLsp` bridge.

**New — renderer:**
- `src/renderer/src/services/todl/todl-language-client.ts` — `TodlLanguageClient` service: connection, URI registry, source/base feed, diagnostics routing, `applyWorkspaceEdit`.
- `src/renderer/src/services/todl/todl-lsp-connection.ts` — `createTodlLspConnection(bridge)`: a `MessageConnection` over the preload pipe.
- `src/renderer/src/modules/meta-model/todl-lsp/position.ts` — pure Monaco⇄LSP position/range mappers.
- `src/renderer/src/modules/meta-model/todl-lsp/providers.ts` — the ~12 pure `provide*` adapter functions + `registerTodlProviders(client)`.

**Modified — renderer:**
- `src/renderer/src/modules/code-editor/code-document.ts` — add `Uri` DP.
- `src/renderer/src/modules/code-editor/code-editor.ts` — create the Monaco model with a stable URI when `Uri` is set.
- `src/renderer/src/modules/meta-model/services/todl-document-factory.ts` — target the client; set `doc.Uri`.
- `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts` — reroute attach/detach/refresh to the client + `ResyncProject`.
- `src/renderer/src/main.js` — build the connection, `client.Initialize(conn)`, `registerTodlProviders(client)`.
- `src/renderer/src/app.mu` — register `TodlLanguageClient`; drop `TodlValidationService`.
- `src/main/index.ts` — `await registerTodlServerHandlers()` before `createWindow()`.
- `package.json`, `electron.vite.config.ts`/scripts — deps + server-bundle build wiring.

**Deleted:** `src/renderer/src/services/todl/todl-validation-service.ts` (+ its test) once diagnostics flow through the client (Task 17).

---

## Task 1: Dependencies + vendored server bundle + spawn smoke

**Files:**
- Modify: `package.json` (deps + scripts)
- Create: `src/main/todl/server-entry.ts`
- Create: `scripts/build-todl-server.mjs`
- Test: `src/main/todl/tests/server-bundle.test.ts`

**Interfaces:**
- Produces: a built `out/main/todl-language-server.cjs` that speaks LSP over stdio; `server-entry.ts` (no exports, side-effecting).

- [ ] **Step 1: Add dependencies**

Add to `package.json` `dependencies`: `"vscode-jsonrpc": "^8.2.0"`, `"vscode-languageserver-types": "3.17.5"`. Add to `devDependencies`: `"esbuild": "^0.24.0"`. Run `npm install` (against Verdaccio; if it is down, install these three from `--registry=https://registry.npmjs.org --no-save` and note it in the commit, as Spec 2 did).

- [ ] **Step 2: Write the server entry**

```ts
// src/main/todl/server-entry.ts
// Standalone entry for the vendored TODL language server: a plain Node program
// that speaks LSP over stdio. Bundled by scripts/build-todl-server.mjs and
// forked by TodlServerHost. Kept tiny so the bundle is just the server + core.
import { createConnection } from 'vscode-languageserver/node'
import { createServer } from '@pragmatic-lab/todl/language-server'

const connection = createConnection(process.stdin, process.stdout)
createServer(connection)
connection.listen()
```

- [ ] **Step 3: Write the bundler script**

```js
// scripts/build-todl-server.mjs
// Bundle the server entry into a single self-contained CJS file so the forked
// child needs nothing from node_modules at runtime (vendored, registry-version
// decoupled). Only Node built-ins stay external.
import { build } from 'esbuild'
import { builtinModules } from 'node:module'

await build({
  entryPoints: ['src/main/todl/server-entry.ts'],
  outfile: 'out/main/todl-language-server.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
})
console.log('built out/main/todl-language-server.cjs')
```

Wire it into `package.json` scripts so dev/build produce it:
```
"build:todl-server": "node scripts/build-todl-server.mjs",
"dev": "npm run compile:mu && npm run build:todl-server && electron-vite dev",
"build": "npm run compile:mu && npm run build:todl-server && electron-vite build",
```

- [ ] **Step 4: Write the failing smoke test**

The bundle is transport-agnostic — exercise it with a plain Node child over stdio (no Electron needed), asserting an `initialize` round-trip. This is the packaging-risk gate.

```ts
// src/main/todl/tests/server-bundle.test.ts
import { test, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { spawn } from 'node:child_process'
import { StreamMessageReader, StreamMessageWriter, createMessageConnection } from 'vscode-jsonrpc/node'

beforeAll(() => { execFileSync('node', ['scripts/build-todl-server.mjs'], { stdio: 'inherit' }) }, 60_000)

test('the vendored bundle answers initialize over stdio', async () => {
  const child = spawn('node', ['out/main/todl-language-server.cjs'], { stdio: ['pipe', 'pipe', 'inherit'] })
  const conn = createMessageConnection(new StreamMessageReader(child.stdout!), new StreamMessageWriter(child.stdin!))
  conn.listen()
  const res = await conn.sendRequest('initialize', { processId: null, rootUri: null, capabilities: {}, initializationOptions: { mode: 'pushed' } }) as { capabilities: { hoverProvider?: boolean } }
  expect(res.capabilities.hoverProvider).toBe(true)
  conn.dispose(); child.kill()
})
```

- [ ] **Step 5: Run it, expect FAIL** (`npx vitest run src/main/todl/tests/server-bundle.test.ts`) — until the entry/script/deps exist and TODL 0.3.0 is resolvable.

- [ ] **Step 6: Make it pass** — ensure the TODL prerequisite is in place (published/linked), run `npm run build:todl-server`, rerun the test. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/main/todl/server-entry.ts scripts/build-todl-server.mjs src/main/todl/tests/server-bundle.test.ts
git commit -m "feat(todl-lsp): vendored server bundle + spawn smoke"
```

---

## Task 2: Shared IPC contract (`todl-lsp-api.ts`)

**Files:**
- Create: `src/shared/todl-lsp-api.ts`
- Test: `src/shared/tests/todl-lsp-api.test.ts`

**Interfaces:**
- Produces: `enum TodlLspChannel { ToServer='todl-lsp:to-server', FromServer='todl-lsp:from-server', ServerRestart='todl-lsp:server-restart' }`; `interface ITodlLspApi { send(msg: unknown): void; onMessage(cb: (msg: unknown) => void): () => void; onServerRestart(cb: () => void): () => void }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/tests/todl-lsp-api.test.ts
import { test, expect } from 'vitest'
import { TodlLspChannel } from '../todl-lsp-api.js'

test('channel names are stable and namespaced', () => {
  expect(TodlLspChannel.ToServer).toBe('todl-lsp:to-server')
  expect(TodlLspChannel.FromServer).toBe('todl-lsp:from-server')
  expect(TodlLspChannel.ServerRestart).toBe('todl-lsp:server-restart')
})
```

- [ ] **Step 2: Run it, expect FAIL** (module missing).

- [ ] **Step 3: Implement**

```ts
// src/shared/todl-lsp-api.ts
// The main↔renderer contract for the TODL language server. An opaque pipe: it
// carries already-framed JSON-RPC *message objects* (never LSP types), so no
// language knowledge crosses the boundary. Mirrors the agent-api.ts pattern.
export enum TodlLspChannel {
  ToServer = 'todl-lsp:to-server',       // renderer → main → child stdin
  FromServer = 'todl-lsp:from-server',   // child stdout → main → renderer
  ServerRestart = 'todl-lsp:server-restart', // main → renderer, resync signal
}

export interface ITodlLspApi {
  send(msg: unknown): void
  onMessage(cb: (msg: unknown) => void): () => void
  onServerRestart(cb: () => void): () => void
}
```

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit** — `git add src/shared/todl-lsp-api.ts src/shared/tests/todl-lsp-api.test.ts && git commit -m "feat(todl-lsp): shared IPC channel contract"`

---

## Task 3: `TodlServerHost` (fork + framing + relay + restart)

**Files:**
- Create: `src/main/todl/todl-server-host.ts`
- Modify: `src/main/index.ts` (register before `createWindow()`)
- Test: `src/main/todl/tests/todl-server-host.test.ts`

**Interfaces:**
- Consumes: `TodlLspChannel` (Task 2); `StreamMessageReader`/`StreamMessageWriter` from `vscode-jsonrpc/node`.
- Produces: `class TodlServerHost` with `constructor(spawnChild: () => ChildLike, emit: (channel: string, msg?: unknown) => void)`, `start(): void`, `send(msg: unknown): void`, `dispose(): void`; and `registerTodlServerHandlers(): void`. `ChildLike = { stdout: NodeJS.ReadableStream; stdin: NodeJS.WritableStream; on(ev: 'exit', cb: () => void): void; kill(): void }`.

The relay logic is decoupled from `utilityProcess` via the injected `spawnChild`/`emit` so it is unit-testable with an in-memory fake child; production wires real `utilityProcess` + `webContents.send`.

- [ ] **Step 1: Write the failing test** (fake child = two `PassThrough` streams; drive a JSON-RPC message through the reader by writing a framed message).

```ts
// src/main/todl/tests/todl-server-host.test.ts
import { test, expect } from 'vitest'
import { PassThrough } from 'node:stream'
import { StreamMessageWriter } from 'vscode-jsonrpc/node'
import { TodlServerHost, type ChildLike } from '../todl-server-host.js'
import { TodlLspChannel } from '../../../shared/todl-lsp-api.js'

function fakeChild(): { child: ChildLike; toRenderer: PassThrough; fromRenderer: PassThrough; exit: () => void } {
  const toRenderer = new PassThrough()   // acts as child stdout
  const fromRenderer = new PassThrough() // acts as child stdin
  let exitCb: (() => void) | undefined
  return {
    child: { stdout: toRenderer, stdin: fromRenderer, on: (_e, cb) => { exitCb = cb }, kill: () => {} },
    toRenderer, fromRenderer, exit: () => exitCb?.(),
  }
}

test('frames child stdout messages and emits them to the renderer', async () => {
  const f = fakeChild()
  const emitted: Array<{ ch: string; msg: unknown }> = []
  const host = new TodlServerHost(() => f.child, (ch, msg) => emitted.push({ ch, msg }))
  host.start()
  new StreamMessageWriter(f.toRenderer).write({ jsonrpc: '2.0', method: 'x', params: { a: 1 } })
  await new Promise((r) => setTimeout(r, 20))
  expect(emitted.some((e) => e.ch === TodlLspChannel.FromServer && (e.msg as { method: string }).method === 'x')).toBe(true)
})

test('restarts the child on exit and signals the renderer', async () => {
  let spawns = 0
  const f = fakeChild()
  const emitted: string[] = []
  const host = new TodlServerHost(() => { spawns++; return f.child }, (ch) => emitted.push(ch))
  host.start()
  f.exit()
  await new Promise((r) => setTimeout(r, 20))
  expect(spawns).toBe(2)
  expect(emitted).toContain(TodlLspChannel.ServerRestart)
})
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement**

```ts
// src/main/todl/todl-server-host.ts
import { utilityProcess, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node'
import { TodlLspChannel } from '../../shared/todl-lsp-api.js'

export interface ChildLike {
  stdout: NodeJS.ReadableStream
  stdin: NodeJS.WritableStream
  on(event: 'exit', cb: () => void): void
  kill(): void
}

// Dumb, semantics-blind relay owning the forked server's lifecycle. It frames
// the child's stdio with vscode-jsonrpc purely to move whole JSON-RPC message
// objects across IPC; it never interprets them. Restarts the child on crash.
export class TodlServerHost {
  private child: ChildLike | undefined
  private writer: StreamMessageWriter | undefined
  private disposed = false

  constructor(
    private readonly spawnChild: () => ChildLike,
    private readonly emit: (channel: string, msg?: unknown) => void,
  ) {}

  start(): void {
    const child = this.spawnChild()
    this.child = child
    new StreamMessageReader(child.stdout).listen((msg) => this.emit(TodlLspChannel.FromServer, msg))
    this.writer = new StreamMessageWriter(child.stdin)
    child.on('exit', () => {
      if (this.disposed) return
      this.emit(TodlLspChannel.ServerRestart)
      this.start()
    })
  }

  send(msg: unknown): void { this.writer?.write(msg as never) }
  dispose(): void { this.disposed = true; this.child?.kill() }
}

// Production wiring: fork the vendored bundle as a utilityProcess with piped
// stdio and push to whichever window is focused (single window today).
export function registerTodlServerHandlers(): void {
  const emit = (channel: string, msg?: unknown): void => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    win?.webContents.send(channel, msg)
  }
  const spawnChild = (): ChildLike => {
    const proc = utilityProcess.fork(join(__dirname, 'todl-language-server.cjs'), [], { stdio: 'pipe' })
    return proc as unknown as ChildLike
  }
  const host = new TodlServerHost(spawnChild, emit)
  host.start()
  ipcMain.on(TodlLspChannel.ToServer, (_e, msg: unknown) => host.send(msg))
}
```

Note for the implementer: `utilityProcess.fork(..., { stdio: 'pipe' })` exposes `.stdout`/`.stdin` and emits `'exit'`, matching `ChildLike`. The bundle path is `join(__dirname, 'todl-language-server.cjs')` because both `out/main/index.js` and the bundle live in `out/main/`.

- [ ] **Step 4: Register in `src/main/index.ts`** — import `registerTodlServerHandlers` and call it in `whenReady`, before `createWindow()`, next to `await registerAgentHandlers()`:
```ts
import { registerTodlServerHandlers } from './todl/todl-server-host.js'
// ...after registerAgentHandlers():
registerTodlServerHandlers()
```

- [ ] **Step 5: Run the test, expect PASS.** Then `npm run typecheck:node`.

- [ ] **Step 6: Commit** — `git commit -m "feat(todl-lsp): main-process server host + relay + crash restart"`

---

## Task 4: Preload bridge (`todlLsp`)

**Files:**
- Modify: `src/preload/index.ts`
- Test: none (preload wiring has no unit-testable unit; verified by `npm run typecheck:node`). Deliverable folded here because Task 6's connection needs it.

**Interfaces:**
- Produces: `window.api.todlLsp: ITodlLspApi`.

- [ ] **Step 1: Implement the bridge** in `src/preload/index.ts`:

```ts
import { TodlLspChannel, type ITodlLspApi } from '../shared/todl-lsp-api.js'
// ...
const todlLsp: ITodlLspApi = {
  send: (msg: unknown): void => ipcRenderer.send(TodlLspChannel.ToServer, msg),
  onMessage: (cb: (msg: unknown) => void): (() => void) => {
    const listener = (_e: unknown, msg: unknown): void => cb(msg)
    ipcRenderer.on(TodlLspChannel.FromServer, listener)
    return () => { ipcRenderer.removeListener(TodlLspChannel.FromServer, listener) }
  },
  onServerRestart: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(TodlLspChannel.ServerRestart, listener)
    return () => { ipcRenderer.removeListener(TodlLspChannel.ServerRestart, listener) }
  },
}
```
Add `todlLsp` to the `const api = { fs, environment, settings, agent }` object → `{ fs, environment, settings, agent, todlLsp }`.

- [ ] **Step 2: Extend the renderer's `window.api` type** wherever `IAgentApi` et al. are declared for `window.api` (search for `interface Window` / a `renderer.d.ts` / `env.d.ts` under `src/renderer`). Add `todlLsp: ITodlLspApi` to that shape. If none exists, add `src/renderer/src/todl-lsp.d.ts` augmenting `Window['api']`.

- [ ] **Step 3: Verify** — `npm run typecheck`. Expected: clean.

- [ ] **Step 4: Commit** — `git commit -m "feat(todl-lsp): preload todlLsp bridge"`

---

## Task 5: Pure Monaco⇄LSP position mappers

**Files:**
- Create: `src/renderer/src/modules/meta-model/todl-lsp/position.ts`
- Test: `src/renderer/src/modules/meta-model/todl-lsp/tests/position.test.ts`

**Interfaces:**
- Produces: `monacoToLspPosition(p: {lineNumber:number; column:number}): {line:number; character:number}`; `lspToMonacoPosition(p:{line:number;character:number}): {lineNumber:number;column:number}`; `lspToMonacoRange(r:{start;end}): {startLineNumber;startColumn;endLineNumber;endColumn}`; `monacoToLspRange(r:{startLineNumber;startColumn;endLineNumber;endColumn}): {start;end}`. LSP 0-based ⇄ Monaco 1-based.

- [ ] **Step 1: Write the failing test**

```ts
// tests/position.test.ts
import { test, expect } from 'vitest'
import { monacoToLspPosition, lspToMonacoPosition, lspToMonacoRange } from '../position.js'

test('monaco 1-based ⇄ lsp 0-based position', () => {
  expect(monacoToLspPosition({ lineNumber: 1, column: 1 })).toEqual({ line: 0, character: 0 })
  expect(lspToMonacoPosition({ line: 2, character: 3 })).toEqual({ lineNumber: 3, column: 4 })
})

test('lsp range → monaco range', () => {
  expect(lspToMonacoRange({ start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }))
    .toEqual({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 })
})
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement** the four converters (`line+1`/`character+1` each direction; ranges compose the position converters). Use plain object types (no monaco import) so the module is headless-testable.

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit** — `git commit -m "feat(todl-lsp): pure monaco/lsp position mappers"`

---

## Task 6: Renderer connection over the preload pipe

**Files:**
- Create: `src/renderer/src/services/todl/todl-lsp-connection.ts`
- Test: `src/renderer/src/services/todl/tests/todl-lsp-connection.test.ts`

**Interfaces:**
- Consumes: `ITodlLspApi` (Task 2).
- Produces: `createTodlLspConnection(bridge: ITodlLspApi): MessageConnection` (from `vscode-jsonrpc`), already `.listen()`-ing.

Build a `MessageConnection` over an `AbstractMessageReader`/`AbstractMessageWriter` pair: the reader emits messages the bridge delivers via `onMessage`; the writer calls `bridge.send`. No Content-Length framing on this hop — whole message objects cross it (main already deframed).

- [ ] **Step 1: Write the failing test** (loopback bridge: `send` feeds the paired connection's reader; assert a request/response round-trip between two connections).

```ts
// tests/todl-lsp-connection.test.ts
import { test, expect } from 'vitest'
import { createTodlLspConnection } from '../todl-lsp-connection.js'
import type { ITodlLspApi } from '../../../../shared/todl-lsp-api.js'

// Two bridges cross-wired: whatever A sends, B receives, and vice-versa.
function loopback(): [ITodlLspApi, ITodlLspApi] {
  const cbs: Array<(m: unknown) => void>[] = [[], []]
  const make = (self: 0 | 1): ITodlLspApi => ({
    send: (m) => { for (const cb of cbs[1 - self]!) cb(m) },
    onMessage: (cb) => { cbs[self]!.push(cb); return () => {} },
    onServerRestart: () => () => {},
  })
  return [make(0), make(1)]
}

test('a request over the pipe reaches the peer and returns a response', async () => {
  const [a, b] = loopback()
  const ca = createTodlLspConnection(a)
  const cb = createTodlLspConnection(b)
  cb.onRequest('ping', (p: { n: number }) => ({ n: p.n + 1 }))
  const res = await ca.sendRequest('ping', { n: 41 }) as { n: number }
  expect(res.n).toBe(42)
})
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement**

```ts
// src/renderer/src/services/todl/todl-lsp-connection.ts
import {
  AbstractMessageReader, AbstractMessageWriter, createMessageConnection,
  type MessageConnection, type DataCallback, type Message,
} from 'vscode-jsonrpc'
import type { ITodlLspApi } from '../../../shared/todl-lsp-api.js'

class BridgeReader extends AbstractMessageReader {
  constructor(private readonly bridge: ITodlLspApi) { super() }
  listen(cb: DataCallback): { dispose(): void } {
    const off = this.bridge.onMessage((msg) => cb(msg as Message))
    return { dispose: off }
  }
}
class BridgeWriter extends AbstractMessageWriter {
  constructor(private readonly bridge: ITodlLspApi) { super() }
  async write(msg: Message): Promise<void> { this.bridge.send(msg) }
  end(): void {}
}

// A JSON-RPC MessageConnection over the opaque preload pipe. Whole message
// objects cross IPC (main did the stdio framing), so no Content-Length here.
export function createTodlLspConnection(bridge: ITodlLspApi): MessageConnection {
  const conn = createMessageConnection(new BridgeReader(bridge), new BridgeWriter(bridge))
  conn.listen()
  return conn
}
```

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit** — `git commit -m "feat(todl-lsp): renderer MessageConnection over preload pipe"`

---

## Task 7: `TodlLanguageClient` skeleton + URI registry

**Files:**
- Create: `src/renderer/src/services/todl/todl-language-client.ts`
- Test: `src/renderer/src/services/todl/tests/todl-language-client-registry.test.ts`

**Interfaces:**
- Consumes: `MessageConnection`; mural `ServiceBase`/`ServiceKey`/`IServiceProvider`.
- Produces: `class TodlLanguageClient extends ServiceBase` with `static Key`; `Initialize(connection: MessageConnection): Promise<void>`; `projectKeyFor(projectId: string): string`; `uriFor(projectId: string, relpath: string): string`; `resolveUri(uri: string): { projectId: string; storage: IStorage; relpath: string } | null`. Internal registry `Map<projectKey, { projectId; projectName; storage }>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/todl-language-client-registry.test.ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { TodlLanguageClient } from '../todl-language-client.js'
import { FakeStorage } from '../../storage/tests/fake-storage.js'

test('uriFor/resolveUri round-trips through the registry', () => {
  const client = new TodlLanguageClient(new ServiceProvider())
  const storage = new FakeStorage('proj')
  client.registerProject('C:\\p1', 'P1', storage)   // internal helper used by AttachProject
  const uri = client.uriFor('C:\\p1', 'src/a.todl')
  expect(uri.startsWith('todl://')).toBe(true)
  const r = client.resolveUri(uri)
  expect(r).toEqual({ projectId: 'C:\\p1', storage, relpath: 'src/a.todl' })
})

test('resolveUri returns null for an unknown project', () => {
  const client = new TodlLanguageClient(new ServiceProvider())
  expect(client.resolveUri('todl://nope/x.todl')).toBeNull()
})
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement** the class: `projectKeyFor = (id) => encodeURIComponent(id)`; `uriFor = (id, rel) => \`todl://${this.projectKeyFor(id)}/${rel}\``; `registerProject(projectId, projectName, storage)` fills the registry keyed by `projectKeyFor(projectId)`; `resolveUri(uri)` strips `todl://`, splits the first segment as `projectKey`, `decodeURIComponent`s it to find the entry, and joins the remainder as `relpath` (return `null` if the key is unknown). `Initialize(connection)` stores the connection, sends `initialize` (`{ processId: null, rootUri: null, capabilities: {}, initializationOptions: { mode: 'pushed' } }`) then the `initialized` notification. Register the `textDocument/publishDiagnostics` handler in Task 10.

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit** — `git commit -m "feat(todl-lsp): language client skeleton + uri registry"`

---

## Task 8: Project source + base feed (`AttachProject`)

**Files:**
- Modify: `src/renderer/src/services/todl/todl-language-client.ts`
- Test: `src/renderer/src/services/todl/tests/todl-language-client-attach.test.ts`

**Interfaces:**
- Consumes: `collectTodlSources`, `resolveBases`, `PROJECT_MANIFEST_FILENAME`, `BaseBindings`.
- Produces: `AttachProject(projectId: string, projectName: string, storage: IStorage): Promise<void>`; `DetachProject(storage: IStorage): void`; `RefreshBases(storage: IStorage): Promise<void>`. Sends `todl/setBases` (`{ rootUri, bases }`) + one `textDocument/didOpen` per `.todl`; `todl/refreshBases` on refresh; `didClose` for all on detach.

To test notification traffic without a real connection, `Initialize` accepts any object shaped like `Pick<MessageConnection, 'sendNotification'|'sendRequest'|'onNotification'|'listen'>`; tests pass a fake recorder.

- [ ] **Step 1: Write the failing test**

```ts
// tests/todl-language-client-attach.test.ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { TodlLanguageClient } from '../todl-language-client.js'
import { FakeStorage } from '../../storage/tests/fake-storage.js'

function fakeConn() {
  const notes: Array<{ method: string; params: unknown }> = []
  return {
    conn: {
      sendNotification: (method: string, params: unknown) => { notes.push({ method, params }); return Promise.resolve() },
      sendRequest: () => Promise.resolve(null),
      onNotification: () => ({ dispose() {} }),
      listen: () => {},
    },
    notes,
  }
}

test('AttachProject sets bases then didOpens every project .todl', async () => {
  const storage = new FakeStorage('proj')
  await storage.WriteText('a.todl', 'namespace demo {\n}')
  await storage.WriteText('sub/b.todl', 'namespace two {\n}')
  const client = new TodlLanguageClient(new ServiceProvider())
  const { conn, notes } = fakeConn()
  await client.Initialize(conn as never)
  await client.AttachProject('C:\\proj', 'Proj', storage)

  const setBases = notes.find((n) => n.method === 'todl/setBases')
  expect((setBases!.params as { rootUri: string }).rootUri).toBe(client.uriFor('C:\\proj', ''))
  const opened = notes.filter((n) => n.method === 'textDocument/didOpen')
    .map((n) => (n.params as { textDocument: { uri: string } }).textDocument.uri)
  expect(opened).toContain(client.uriFor('C:\\proj', 'a.todl'))
  expect(opened).toContain(client.uriFor('C:\\proj', 'sub/b.todl'))
})
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement.** `AttachProject`: `registerProject(...)`; read bindings from `PROJECT_MANIFEST_FILENAME` (try/catch → `{}`) exactly as `TodlValidationService.basesFor` did; `const { bases } = await resolveBases(this.Provider, bindings)`; cache them per storage; `sendNotification('todl/setBases', { rootUri: this.uriFor(projectId, ''), bases })`; `for (const s of await collectTodlSources(storage)) sendNotification('textDocument/didOpen', { textDocument: { uri: this.uriFor(projectId, s.uri), languageId: 'todl', version: 1, text: s.text } })`. Track opened URIs per project (a `Set`) for later didChange/didClose. `DetachProject`: look up project by storage, `didClose` each tracked uri, drop registry + base cache, and (Task 10) clear its diagnostics. `RefreshBases`: re-resolve, re-cache, `sendNotification('todl/refreshBases', { rootUri, bases })`.

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit** — `git commit -m "feat(todl-lsp): project source + base feed"`

---

## Task 9: Document sync (`AttachDocument`, relocate, `ResyncProject`)

**Files:**
- Modify: `src/renderer/src/services/todl/todl-language-client.ts`
- Test: `src/renderer/src/services/todl/tests/todl-language-client-docsync.test.ts`

**Interfaces:**
- Consumes: `CodeDocument` (its `Uri` DP lands in Task 11 — until then set via `set_property_value` guardedly; this task references `doc.Id`/`doc.Content` and a `setUri(doc, uri)` helper defined here that Task 11 makes a real DP write).
- Produces: `AttachDocument(doc: CodeDocument, storage: IStorage): void`; `ReattachDocument(doc, storage): void`; `RelocateDocument(doc, storage, newPath): void`; `ResyncProject(projectId: string, storage: IStorage): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/todl-language-client-docsync.test.ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { TodlLanguageClient } from '../todl-language-client.js'
import { CodeDocument } from '../../../modules/code-editor/code-document.js'
import { StorageCodeFile } from '../../../modules/code-editor/code-file.js'
import { FakeStorage } from '../../storage/tests/fake-storage.js'

function fakeConn() {
  const notes: Array<{ method: string; params: unknown }> = []
  return { conn: { sendNotification: (m: string, p: unknown) => { notes.push({ method: m, params: p }); return Promise.resolve() }, sendRequest: () => Promise.resolve(null), onNotification: () => ({ dispose() {} }), listen: () => {} }, notes }
}

test('editing an attached doc sends a full-text didChange', async () => {
  const storage = new FakeStorage('proj')
  await storage.WriteText('a.todl', 'namespace demo {\n}')
  const client = new TodlLanguageClient(new ServiceProvider())
  const { conn, notes } = fakeConn()
  await client.Initialize(conn as never)
  await client.AttachProject('C:\\proj', 'Proj', storage)
  const doc = new CodeDocument(new StorageCodeFile(storage, 'a.todl'))
  await new Promise((r) => setTimeout(r, 0)) // let load() settle
  client.AttachDocument(doc, storage)
  notes.length = 0
  doc.Content = 'namespace demo {\n  concept x { }\n}'
  const change = notes.find((n) => n.method === 'textDocument/didChange')
  expect((change!.params as { contentChanges: Array<{ text: string }> }).contentChanges[0]!.text).toContain('concept x')
})
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement.** `AttachDocument`: resolve project by storage → set `doc`'s URI to `this.uriFor(projectId, doc.Id)` (via the `setUri` helper); add a `CodeDocument.ContentKey` property-changed listener that sends `textDocument/didChange` with `{ textDocument: { uri, version: ++v }, contentChanges: [{ text: doc.Content }] }` (full replace — the server's incremental sync accepts a range-less change). Store the unhook thunk keyed by doc. `RelocateDocument`: `didClose` old uri, recompute uri for `newPath`, `setUri`, `didOpen` new; re-hook. `ReattachDocument`: same but across a new storage/project. `ResyncProject`: recompute `collectTodlSources`, diff against the project's tracked-open set — `didOpen` new, `didChange` still-present, `didClose` removed — keeping the tracked set current (covers explorer create/delete/rename with no editor open).

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit** — `git commit -m "feat(todl-lsp): document sync + project resync"`

---

## Task 10: Diagnostics routing into `DiagnosticsService`

**Files:**
- Modify: `src/renderer/src/services/todl/todl-language-client.ts`
- Test: `src/renderer/src/services/todl/tests/todl-language-client-diagnostics.test.ts`

**Interfaces:**
- Consumes: `DiagnosticsService.Publish(owner, projectId, Diagnostic[])`; canonical `Diagnostic`/`DiagnosticSeverity`/`DiagnosticSpan`; LSP `Diagnostic`/`DiagnosticSeverity` from `vscode-languageserver-types`.
- Produces: on `textDocument/publishDiagnostics`, map LSP→canonical and publish per project. Internal `Map<projectId, Map<uri, Diagnostic[]>>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/todl-language-client-diagnostics.test.ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { TodlLanguageClient } from '../todl-language-client.js'
import { DiagnosticsService } from '../../diagnostics/diagnostics-service.js'
import { FakeStorage } from '../../storage/tests/fake-storage.js'

function fakeConn() {
  let handler: ((p: unknown) => void) | undefined
  return {
    conn: { sendNotification: () => Promise.resolve(), sendRequest: () => Promise.resolve(null),
      onNotification: (m: string, cb: (p: unknown) => void) => { if (m === 'textDocument/publishDiagnostics') handler = cb; return { dispose() {} } }, listen: () => {} },
    publish: (p: unknown) => handler?.(p),
  }
}

test('a published LSP diagnostic reaches DiagnosticsService as canonical (1-based, relpath)', async () => {
  const provider = new ServiceProvider()
  const diagnostics = new DiagnosticsService(provider)
  provider.registerInstance(DiagnosticsService.Key, diagnostics)
  const storage = new FakeStorage('proj')
  const client = new TodlLanguageClient(provider)
  const { conn, publish } = fakeConn()
  await client.Initialize(conn as never)
  await client.AttachProject('C:\\proj', 'Proj', storage)
  publish({
    uri: client.uriFor('C:\\proj', 'a.todl'),
    diagnostics: [{ range: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } }, message: 'boom', severity: 1 }],
  })
  const forFile = diagnostics.ForUri('a.todl')
  expect(forFile).toHaveLength(1)
  expect(forFile[0]!.projectId).toBe('C:\\proj')
  expect(forFile[0]!.span).toEqual({ startLine: 2, startColumn: 3, endLine: 2, endColumn: 6 })
})
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement.** In `Initialize`, register `onNotification('textDocument/publishDiagnostics', (p) => this.onPublishDiagnostics(p))`. `onPublishDiagnostics({ uri, diagnostics })`: `resolveUri(uri)` → `{ projectId, projectName?, relpath }` (store `projectName` in the registry so it is available); map each LSP `Diagnostic` → canonical `{ owner:'todl', projectId, projectName, uri: relpath, message, severity: LSP→canonical (1→Error, 2→Warning, 3→Info, 4→Hint), span: 0→1-based { startLine: range.start.line+1, startColumn: range.start.character+1, endLine: range.end.line+1, endColumn: range.end.character+1 } }`; update `diagsByProject.get(projectId).set(relpath, mapped)`; `DiagnosticsService.Publish('todl', projectId, [...all uris flattened])`. On `DetachProject`, clear the project map + `DiagnosticsService.ClearProject(projectId)`.

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit** — `git commit -m "feat(todl-lsp): route pushed diagnostics into DiagnosticsService"`

---

## Task 11: Model-URI fix (`CodeDocument.Uri` + `CodeEditor`)

**Files:**
- Modify: `src/renderer/src/modules/code-editor/code-document.ts`
- Modify: `src/renderer/src/modules/code-editor/code-editor.ts`
- Test: `src/renderer/src/modules/code-editor/tests/code-document-uri.test.ts`

**Interfaces:**
- Produces: `CodeDocument.UriKey` DP + `get/set Uri`; `CodeEditor` creates its Monaco model with `monaco.Uri.parse(this.ModelUri)` when set. `CodeEditor.ModelUriKey` bound to DataContext `Uri`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/code-document-uri.test.ts
import { test, expect } from 'vitest'
import { CodeDocument } from '../code-document.js'
import { StorageCodeFile } from '../code-file.js'
import { FakeStorage } from '../../../services/storage/tests/fake-storage.js'

test('CodeDocument.Uri is settable and defaults empty', () => {
  const doc = new CodeDocument(new StorageCodeFile(new FakeStorage(), 'a.todl'))
  expect(doc.Uri).toBe('')
  doc.Uri = 'todl://proj/a.todl'
  expect(doc.Uri).toBe('todl://proj/a.todl')
})
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement the DP** in `code-document.ts` (mirror `IdKey`): `public static readonly UriKey = Model.RegisterProperty<string>(CodeDocument, 'Uri', '', MetaData.None)` + `get Uri()/set Uri(v)`.

- [ ] **Step 4: Wire `CodeEditor`.** Add `ModelUriKey` DP bound to DataContext `Uri` (mirror the `Text`/`Language` bindings in the constructor). In `CreateHostElement`, replace the anonymous create with a URI-keyed model when present:
```ts
const modelUri = this.get_property_value(CodeEditor.ModelUriKey) as string
const model = modelUri
  ? (monaco.editor.getModel(monaco.Uri.parse(modelUri)) ?? monaco.editor.createModel(this.Text, this.Language, monaco.Uri.parse(modelUri)))
  : undefined
this.editor = monaco.editor.create(el, model
  ? { model, theme, automaticLayout: true, minimap: { enabled: false } }
  : { value: this.Text, language: this.Language, theme, automaticLayout: true, minimap: { enabled: false } })
```
In `dispose()`, also dispose a model we created: `if (modelUri) this.editor?.getModel()?.dispose()` (guard: only when we own it). Keep the existing anonymous path for non-`.todl` editors (back-compat).

- [ ] **Step 5: Run the test + `npm run typecheck:web`.** Expected: PASS/clean. (The Monaco model creation itself is covered by manual smoke — Task 18.)

- [ ] **Step 6: Commit** — `git commit -m "feat(todl-lsp): stable per-project model URIs"`

---

## Task 12: Read-only navigation adapters (hover, completion, definition, references)

**Files:**
- Create: `src/renderer/src/modules/meta-model/todl-lsp/providers.ts`
- Test: `src/renderer/src/modules/meta-model/todl-lsp/tests/providers-nav.test.ts`

**Interfaces:**
- Consumes: position mappers (Task 5); a minimal `LspRequester = { sendRequest<R>(method: string, params: unknown): Promise<R> }` (the client implements it — add `sendRequest` passthrough to `TodlLanguageClient` here); a minimal `ModelLike = { uri: { toString(): string } }`.
- Produces: `provideHover`, `provideCompletion`, `provideDefinition`, `provideReferences` — pure async functions `(req, model, position) => Promise<MonacoResult>`; and (registration) part of `registerTodlProviders`.

Each adapter is a pure function testable with a fake requester (returns canned LSP) + a fake model — no headless Monaco needed. The thin `monaco.languages.register*Provider` shims call these.

- [ ] **Step 1: Add `sendRequest` to the client** — `public sendRequest<R>(method: string, params: unknown): Promise<R> { return this.connection.sendRequest(method, params) as Promise<R> }`.

- [ ] **Step 2: Write the failing test**

```ts
// tests/providers-nav.test.ts
import { test, expect } from 'vitest'
import { provideHover, provideDefinition } from '../providers.js'

const model = { uri: { toString: () => 'todl://p/a.todl' } }

test('provideHover maps an LSP hover to a Monaco hover', async () => {
  const req = { sendRequest: async () => ({ contents: { kind: 'markdown', value: '**concept** animal' }, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } } }) }
  const hover = await provideHover(req, model, { lineNumber: 1, column: 1 })
  expect(hover!.contents[0]!.value).toContain('animal')
  expect(hover!.range).toEqual({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 7 })
})

test('provideDefinition maps an LSP Location to a Monaco location', async () => {
  const req = { sendRequest: async () => ({ uri: 'todl://p/b.todl', range: { start: { line: 2, character: 0 }, end: { line: 2, character: 3 } } }) }
  const defs = await provideDefinition(req, model, { lineNumber: 1, column: 1 })
  expect(defs).toHaveLength(1)
  expect(defs[0]!.range.startLineNumber).toBe(3)
})
```

- [ ] **Step 3: Run it, expect FAIL.**

- [ ] **Step 4: Implement** the four functions. Each builds LSP params `{ textDocument: { uri: model.uri.toString() }, position: monacoToLspPosition(position) }` (references adds `context: { includeDeclaration: true }`), `await req.sendRequest(...)`, and maps the result: hover → `{ contents: [{ value }], range: lspToMonacoRange(range) }`; definition/references → LSP `Location`|`Location[]` → `{ uri: monaco.Uri.parse(loc.uri), range: lspToMonacoRange(loc.range) }[]`; completion → `{ suggestions: items.map(...) }` mapping `kind`/`insertText`/`documentation`/`range`. Import `* as monaco` only for `monaco.Uri`/enum values used in mapping (types stay pure where possible).

- [ ] **Step 5: Run it, expect PASS.**

- [ ] **Step 6: Commit** — `git commit -m "feat(todl-lsp): hover/completion/definition/references adapters"`

---

## Task 13: Read-only structure adapters (document symbols, folding, semantic tokens, signature help) + registration

**Files:**
- Modify: `src/renderer/src/modules/meta-model/todl-lsp/providers.ts`
- Test: `src/renderer/src/modules/meta-model/todl-lsp/tests/providers-structure.test.ts`

**Interfaces:**
- Produces: `provideDocumentSymbols`, `provideFoldingRanges`, `provideDocumentSemanticTokens`, `provideSignatureHelp`; `registerTodlProviders(client: TodlLanguageClient): void` registering all adapters (Tasks 12–13) against `TODL_LANGUAGE_ID` via `monaco.languages.register*Provider`, and the semantic-tokens legend fetched from the server capabilities / a constant matching `SEMANTIC_LEGEND`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/providers-structure.test.ts
import { test, expect } from 'vitest'
import { provideFoldingRanges } from '../providers.js'
const model = { uri: { toString: () => 'todl://p/a.todl' } }
test('provideFoldingRanges maps LSP folding ranges (0-based) to Monaco (1-based)', async () => {
  const req = { sendRequest: async () => ([{ startLine: 0, endLine: 3 }]) }
  const ranges = await provideFoldingRanges(req, model)
  expect(ranges[0]).toEqual({ start: 1, end: 4, kind: undefined })
})
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement** the four functions + `registerTodlProviders`. Folding: `{ start: r.startLine+1, end: r.endLine+1 }`. Document symbols: LSP `DocumentSymbol[]` → Monaco `languages.DocumentSymbol[]` (map `kind` numerics, `range`/`selectionRange` via `lspToMonacoRange`). Semantic tokens: `provideDocumentSemanticTokens` returns `{ data: Uint32Array.from(lspTokens.data), resultId: undefined }` and `getLegend()` returns the legend (define a `TODL_SEMANTIC_LEGEND` constant equal to the server's `SEMANTIC_LEGEND` token types/modifiers, or fetch it once from the `initialize` result — prefer the constant to avoid an async legend). Signature help: LSP `SignatureHelp` → Monaco `{ value: {...}, dispose(){} }`. `registerTodlProviders` calls `monaco.languages.registerHoverProvider(TODL_LANGUAGE_ID, { provideHover: (m,p) => provideHover(client, m, p) })` and the analogous registrations for every capability incl. rename/codeaction/formatting (Tasks 15–16 fill those provider bodies; register them here with imports so the shims exist).

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit** — `git commit -m "feat(todl-lsp): symbols/folding/semantic-tokens/signature adapters + registration"`

---

## Task 14: Bootstrap wiring + DI registration

**Files:**
- Modify: `src/renderer/src/main.js`
- Modify: `src/renderer/src/app.mu`
- Test: none new (integration/manual + existing suite must stay green). Verified by `npm run build` + `npm test`.

**Interfaces:**
- Consumes: `createTodlLspConnection`, `TodlLanguageClient`, `registerTodlProviders`.

- [ ] **Step 1: Register the service** — in `src/renderer/src/app.mu` `.services:` block, add `TodlLanguageClient` next to `DiagnosticsService`. Leave `TodlValidationService` for now (removed in Task 17). Run `npm run compile:mu`.

- [ ] **Step 2: Bootstrap in `main.js`** — after `registerTodlLanguage()` (line ~30) and after `app.initialize(...)` so `app.Services` exists:
```js
import { createTodlLspConnection } from './services/todl/todl-lsp-connection.js'
import { TodlLanguageClient } from './services/todl/todl-language-client.js'
import { registerTodlProviders } from './modules/meta-model/todl-lsp/providers.js'
// ...after app.initialize(...):
const todlClient = app.Services.get(TodlLanguageClient.Key)
if (todlClient !== undefined) {
  const connection = createTodlLspConnection(window.api.todlLsp)
  await todlClient.Initialize(connection)
  window.api.todlLsp.onServerRestart(() => { void todlClient.ResyncAll() })
  registerTodlProviders(todlClient)
}
```
Add a `ResyncAll()` to the client that re-runs `setBases` + `didOpen` for every registered project (used after a server restart).

- [ ] **Step 3: Verify** — `npm run build` (produces the server bundle + renderer) then `npm test`. Expected: build clean, suite green.

- [ ] **Step 4: Commit** — `git commit -m "feat(todl-lsp): register + bootstrap the language client"`

---

## Task 15: Unified `WorkspaceEdit` write-path (own cluster — part 1)

**Files:**
- Modify: `src/renderer/src/services/todl/todl-language-client.ts`
- Test: `src/renderer/src/services/todl/tests/todl-language-client-edits.test.ts`

**Interfaces:**
- Consumes: LSP `WorkspaceEdit`/`TextEdit`; `IStorage`; a way to find an open Monaco model by uri (inject `findModel(uri): { applyEdits(edits): void } | null` so it is testable without Monaco).
- Produces: `applyWorkspaceEdit(edit: WorkspaceEdit): Promise<void>`; `setModelFinder(fn)` (production wires `(uri) => monaco.editor.getModel(monaco.Uri.parse(uri))`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/todl-language-client-edits.test.ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { TodlLanguageClient } from '../todl-language-client.js'
import { FakeStorage } from '../../storage/tests/fake-storage.js'

async function attached() {
  const storage = new FakeStorage('proj')
  await storage.WriteText('open.todl', 'aaa')
  await storage.WriteText('closed.todl', 'zzz')
  const client = new TodlLanguageClient(new ServiceProvider())
  await client.Initialize({ sendNotification: () => Promise.resolve(), sendRequest: () => Promise.resolve(null), onNotification: () => ({ dispose() {} }), listen: () => {} } as never)
  await client.AttachProject('C:\\proj', 'Proj', storage)
  return { client, storage }
}

test('closed-file edits apply through storage, offset-descending', async () => {
  const { client, storage } = await attached()
  await client.applyWorkspaceEdit({ changes: { [client.uriFor('C:\\proj', 'closed.todl')]: [
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: 'Z' },
    { range: { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } }, newText: 'Z' },
  ] } })
  expect(await storage.ReadText('closed.todl')).toBe('ZzZ')
})

test('open-buffer edits go through the model, not storage', async () => {
  const { client, storage } = await attached()
  const applied: unknown[] = []
  client.setModelFinder((uri) => uri.endsWith('open.todl') ? { applyEdits: (e: unknown[]) => applied.push(...e) } : null)
  await client.applyWorkspaceEdit({ changes: { [client.uriFor('C:\\proj', 'open.todl')]: [
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'X' },
  ] } })
  expect(applied).toHaveLength(1)
  expect(await storage.ReadText('open.todl')).toBe('aaa') // untouched on disk
})
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement** `applyWorkspaceEdit`: for each `[uri, edits]` in `edit.changes ?? {}`: if `this.findModel?.(uri)` returns a model → `model.applyEdits(edits.map(e => ({ range: lspToMonacoRange(e.range), text: e.newText })))`; else `resolveUri(uri)` → read `storage.ReadText(relpath)`, apply the edits sorted **descending** by `(start.line, start.character)` against an offset-computed string (convert line/char to absolute offset, splice), `storage.WriteText(relpath, result)`. Provide a pure `applyTextEdits(text, edits): string` helper and unit-test it implicitly via the storage test.

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit** — `git commit -m "feat(todl-lsp): unified WorkspaceEdit application (open + closed)"`

---

## Task 16: Rename, code actions, formatting adapters (write-path — part 2)

**Files:**
- Modify: `src/renderer/src/modules/meta-model/todl-lsp/providers.ts`
- Modify: `src/renderer/src/services/todl/todl-language-client.ts` (production `setModelFinder` wiring in `registerTodlProviders` or bootstrap)
- Test: `src/renderer/src/modules/meta-model/todl-lsp/tests/providers-edits.test.ts`

**Interfaces:**
- Produces: `providePrepareRename`, `provideRenameEdits` (delegates to `client.applyWorkspaceEdit`, returns an empty Monaco edit so Monaco applies nothing itself), `provideCodeActions` (each action's edit applied via `client.applyWorkspaceEdit` on invocation), `provideFormattingEdits`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/providers-edits.test.ts
import { test, expect } from 'vitest'
import { provideRenameEdits, provideFormattingEdits } from '../providers.js'
const model = { uri: { toString: () => 'todl://p/a.todl' } }

test('rename delegates the WorkspaceEdit to the client and returns an empty Monaco edit', async () => {
  let appliedWith: unknown
  const client = {
    sendRequest: async () => ({ changes: { 'todl://p/a.todl': [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: 'dog' }] } }),
    applyWorkspaceEdit: async (e: unknown) => { appliedWith = e },
  }
  const result = await provideRenameEdits(client, model, { lineNumber: 1, column: 1 }, 'dog')
  expect(appliedWith).toBeTruthy()
  expect(result.edits).toHaveLength(0) // Monaco applies nothing; we already did
})

test('formatting maps LSP TextEdits to Monaco text edits', async () => {
  const client = { sendRequest: async () => ([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, newText: '  ' }]) }
  const edits = await provideFormattingEdits(client, model)
  expect(edits[0]!.range.startLineNumber).toBe(1)
  expect(edits[0]!.text).toBe('  ')
})
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement.** `providePrepareRename`: `sendRequest('textDocument/prepareRename', params)` → `{ range: lspToMonacoRange(r), text }` or `null`. `provideRenameEdits`: `sendRequest('textDocument/rename', { ...params, newName })` → `WorkspaceEdit`; if it's an error/null return `{ edits: [] }`; else `await client.applyWorkspaceEdit(edit)` and return `{ edits: [] }` (unified path owns application; loses native preview, per spec). `provideCodeActions`: `sendRequest('textDocument/codeAction', { textDocument, range, context: { diagnostics } })` → map each `CodeAction` to a Monaco action whose `run` calls `client.applyWorkspaceEdit(action.edit)`. `provideFormattingEdits`: `sendRequest('textDocument/formatting', { textDocument, options })` → `TextEdit[]` → `{ range: lspToMonacoRange, text: newText }[]`. Wire these into `registerTodlProviders` (rename provider with `resolveRenameLocation`, code-action provider, formatting provider) and set the production `client.setModelFinder((uri) => monaco.editor.getModel(monaco.Uri.parse(uri)))` there.

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit** — `git commit -m "feat(todl-lsp): rename/code-action/formatting adapters"`

---

## Task 17: Reroute call sites + retire `TodlValidationService`

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/todl-document-factory.ts`
- Modify: `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts`
- Delete: `src/renderer/src/services/todl/todl-validation-service.ts` (+ `tests/todl-validation-service.test.ts`)
- Modify: `src/renderer/src/app.mu` (drop `TodlValidationService`)
- Test: `src/renderer/src/modules/meta-model/services/tests/todl-document-factory.test.ts` (adapt existing)

**Interfaces:**
- Consumes: `TodlLanguageClient` (Tasks 7–16).

- [ ] **Step 1: Reroute `TodlDocumentFactory`.** Replace `TodlValidationService` usage: in `openFile`, `this.Provider.get(TodlLanguageClient.Key)?.AttachDocument(doc, storage)` (this now also sets `doc.Uri`). In `relocateOpenFile`, add `this.Provider.get(TodlLanguageClient.Key)?.RelocateDocument(document as CodeDocument, /* same storage */, newPath)` — obtain the doc's storage from the client registry or thread it; simplest: `RelocateDocument(doc, storage, newPath)` where storage is looked up via the doc's current uri (`client.storageForDoc(doc)`), so add that helper. In `relocateAcrossStorage`, call `this.Provider.get(TodlLanguageClient.Key)?.ReattachDocument(document as CodeDocument, storage)`. Keep the `attachDiagnostics` subscription flow unchanged (it already mirrors `DiagnosticsService` per-uri into the doc).

- [ ] **Step 2: Reroute `ProjectExplorerService`.** `addOpenProject`: `this.Provider.get(TodlLanguageClient.Key)?.AttachProject(op.Project.RootPath, op.Project.Name, op.Storage)`. `closeProject`: `...?.DetachProject(op.Storage)`. `publishProject` + `refreshBases` + `RefreshProjects`: replace `validator?.ClearBaseCache(op.Storage); validator?.Revalidate()` with `void client?.RefreshBases(op.Storage)`. Add `void client?.ResyncProject(op.Project.RootPath, op.Storage)` at the point(s) where the tree is mutated structurally (file create/delete/rename/move handlers — the same methods that currently rebuild/rescan the tree). Import `TodlLanguageClient`, drop the `TodlValidationService` import.

- [ ] **Step 3: Delete `TodlValidationService`** and its test file. Remove `TodlValidationService` from `app.mu` `.services:`. Note: the pure helpers that lived there (`diagnosticToCanonical`, `overlaySources`, `validateSources`) are no longer used — delete with the file. If any other module imports them, move them; a grep (`git grep TodlValidationService`, `git grep validateSources`) must come back empty except the deletion.

- [ ] **Step 4: Adapt the factory test** — the existing `todl-document-factory.test.ts` constructs the factory with a bare `ServiceProvider` (no client registered), so `openFile` still returns a `CodeDocument`; assert it still does. Add a case registering a fake `TodlLanguageClient` (or a stub exposing `AttachDocument`) and assert `AttachDocument` is called. Run `npm run compile:mu` (app.mu changed).

- [ ] **Step 5: Run the suite** — `npm test`. Expected: green (no lingering references). `npm run typecheck`.

- [ ] **Step 6: Commit** — `git commit -m "refactor(todl-lsp): retire TodlValidationService; route through the language client"`

---

## Task 18: End-to-end smoke checklist + memory

**Files:**
- Create: `docs/superpowers/todl-lsp-smoke-checklist.md`
- Test: full suite + manual.

- [ ] **Step 1: Full gate** — `npm run build` (server bundle + renderer + main) then `npm test` and `npm run typecheck`. All green.

- [ ] **Step 2: Write the manual smoke checklist** covering, in `npm run dev`: open a TODL project → red squiggles appear from the server (kill/edit to confirm live update); hover a concept; Ctrl-click a reference (cross-file); Ctrl-Space completion incl. schema-aware `&ref`; rename a concept across files (open + closed); quick-fix "add missing field"; format document; folding; document symbols outline. Include a "server crash → restart → diagnostics reappear" step (kill the utility process from Task Manager).

- [ ] **Step 3: Run the manual smoke** and check every item. Fix regressions before proceeding (return to the relevant task under systematic-debugging if any fail).

- [ ] **Step 4: Commit** — `git commit -m "docs(todl-lsp): manual smoke checklist"`

---

## Self-Review

**1. Spec coverage.** Build/vendored bundle → Task 1. Shared contract → Task 2. Main host + fork + framing + restart → Task 3. Preload → Task 4. Position mappers → Task 5. Connection → Task 6. Client + URI registry → Task 7. Source/base feed (setBases + didOpen) → Task 8. Document sync (didChange/close/rename/resync) → Task 9. Diagnostics routing → Task 10. Model-URI fix → Task 11. Read-only adapters → Tasks 12–13. Bootstrap + DI → Task 14. WorkspaceEdit write-path → Tasks 15–16 (its own cluster, as required). Retire `TodlValidationService` + reroute call sites → Task 17. Manual smoke (the irreducibly visual gate) → Task 18. Honest-thin items (workspace symbols UI, signature help, go-to-def into bases) are covered by the server capabilities but intentionally not surfaced beyond registration — matches the spec's flags. TODL 0.3.0 is a documented prerequisite, not a task, per the spec.

**2. Placeholder scan.** No TBD/TODO; every code step has real code; tests carry concrete asserts. The one "wire at the structural-mutation handlers" instruction (Task 17 Step 2) references existing methods rather than quoting them — acceptable because the client-side `ResyncProject` logic it calls is fully specified and unit-tested in Task 9, and explorer wiring is validated by the Task 18 smoke rather than a unit test.

**3. Type consistency.** `TodlLanguageClient` method names used across tasks are consistent: `Initialize`, `AttachProject`, `DetachProject`, `AttachDocument`, `ReattachDocument`, `RelocateDocument`, `ResyncProject`, `ResyncAll`, `RefreshBases`, `applyWorkspaceEdit`, `setModelFinder`, `sendRequest`, `uriFor`, `resolveUri`, `registerProject`, `storageForDoc`. URI shape `todl://<encodeURIComponent(projectId)>/<relpath>` is identical in Tasks 7/8/10/15. Diagnostic mapping (0→1-based, `uri`→relpath, owner `"todl"`) matches the canonical `Diagnostic`/`DiagnosticSpan` from `diagnostic.ts`. Channel names match between Tasks 2/3/4.

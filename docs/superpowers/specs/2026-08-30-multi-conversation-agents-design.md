# Multi-Conversation Agents — Design (Spec A)

- **Date:** 2026-08-30
- **Status:** Approved shape, pending spec review → implementation plan
- **Scope:** Turn Plexus's single agent chat into **multiple concurrent conversations**, each a live agent session running in parallel, presented as right-dock tabs and managed by a new **Conversations** navigation panel, with persistence gated on whether the provider can actually resume the AI's context.
- **Foundation for:** [Spec B — project agent/skill background runner](2026-08-30-project-agent-skill-runner-design.md), which builds on the session engine + `ChatSession` defined here.

## 1. Goal & motivation

Today there is exactly one agent conversation: the main-process `AgentSession` is explicitly "v1 = a single session" (starting a new one disposes the old), and the renderer has a single `AgentService` singleton on one `window.api.agent` IPC stream. Users want several conversations at once — different lines of work with the agent, running in parallel. This spec makes conversations first-class, keyed, parallel, listable, and (where the provider allows) durable.

## 2. Non-goals

- **Tear-off into standalone OS windows** — designed *for* (each conversation is a self-contained, `sessionId`-addressed dock panel), but not built here. It's a later feature on the existing multi-window backlog.
- **No global concurrency cap** in v1 — sessions run uncapped (one subprocess each). A cap/queue can be added later (mirrors the Background Work concurrency idea) if resource use warrants.
- **No new agent capabilities** — same turn/approval/question flow as today, just multiplied.

## 3. Concepts & vocabulary

| Term | Meaning |
| --- | --- |
| **Conversation / `ChatSession`** | One agent dialogue: its transcript, draft, status, approvals — a per-conversation VM (≈ today's `AgentService`). A dock tab. |
| **`sessionId`** | Stable id tying a renderer `ChatSession` to its main-process session and to every IPC message/event for it. |
| **`AgentSessionManager`** | Main-process registry of live `AgentSession`s keyed by `sessionId`. |
| **`ChatSessionsService`** | Renderer manager: owns the open conversations + the stored list, routes events, persists. Backs the Conversations nav panel. |
| **Resume descriptor / token** | Whether the provider can restore AI context, and the handle (e.g. CLI session id) to do it. |
| **`ChatStore`** | Persists resumable conversations to `userData` and restores the list on launch. |

## 4. Architecture overview

```
 LEFT rail capability                RIGHT dock
 ┌───────────────────────────┐       ┌───────────────────────────┐
 │ Conversations panel       │       │ [Chat A][Chat B][+]        │
 │  • New conversation (＋)   │       │  each = a ChatSession tab  │
 │  • Stored (restorable) ▸   │       │                            │
 │  • Open now …              │       │                            │
 └───────────┬───────────────┘       └─────────────▲──────────────┘
             │  both views bind ─────────────────────
             ▼
   ChatSessionsService (renderer, root)
     ObservableCollection<ChatSession> (open) + stored records + ActiveChat
     NewConversation / OpenStored / Close ; routes events by sessionId ; ChatStore
             │  window.api.agent (session-tagged)
             ▼
   AgentSessionManager (main): Map<sessionId, AgentSession>  → N live subprocesses
```

## 5. Main process

### 5.1 `AgentSessionManager`

Replaces the single-session assumption in `agent-session.ts`. Owns a `Map<sessionId, AgentSession>`; each `AgentSession` is **the current one, essentially unchanged internally** (one provider subprocess, one conversation, its own `(cwd, addDirs)` target). Parallelism falls out: N entries = N subprocesses running turns independently.

```ts
class AgentSessionManager {
    create(sessionId: string, sink: (e: TaggedEvent) => void): AgentSession   // idempotent by id
    get(sessionId: string): AgentSession | undefined
    close(sessionId: string): void                                            // dispose subprocess
    // sendTurn / answerQuestion are dispatched by id from the IPC layer to get(id)
}
interface TaggedEvent { sessionId: string; event: AgentEvent }
```

`AgentSession` gains: it carries its `sessionId`, and exposes a **resume token** once known (see 5.3). Its "target change re-spawns provider" behaviour is unchanged.

### 5.2 IPC — session-tagged

Every renderer↔main agent message carries a `sessionId`; the event stream is `{ sessionId, event }`.

```ts
// preload bridge (window.api.agent), session-aware:
interface AgentBridge {
    startSession(sessionId: string, resumeToken?: string): void
    closeSession(sessionId: string): void
    sendTurn(sessionId: string, cwd: string, addDirs: string[], text: string): void
    answerQuestion(sessionId: string, answer: unknown): void
    onEvent(listener: (msg: { sessionId: string; event: AgentEvent }) => void): void
}
```

The renderer registers **one** `onEvent` listener (in `ChatSessionsService`) and fans events to the matching `ChatSession` by `sessionId`.

### 5.3 Provider resume capability

`IAiProvider` and its session declare resumability so persistence can be gated (§7):

```ts
interface IAiProvider {
    readonly Id: string
    readonly Resumable: boolean          // NEW: can this provider restore AI context?
    start(cwd: string, addDirs: readonly string[], onEvent: (e: AgentEvent) => void,
          resumeToken?: string): AiProviderSession   // NEW optional resumeToken
}
interface AiProviderSession {
    // NEW: the handle to resume this exact conversation later (e.g. the claude-CLI
    // session id parsed from the stream-json init event). undefined until known /
    // if the provider can't resume.
    readonly ResumeToken: string | undefined
    // …existing send / answer / dispose
}
```

The claude-CLI provider sets `Resumable = true` and populates `ResumeToken` from the CLI's session id (already visible in the stream-json init line the `stream-json-parser` reads), and passes `--resume <token>` on `start` when one is supplied. **Open detail:** confirm the exact CLI resume flag/semantics — if it turns out the CLI can't faithfully resume, `Resumable` is set `false` and those conversations simply aren't persisted (which is the desired behaviour, not a bug).

## 6. Renderer

### 6.1 `ChatSession` (VM, `IDockPanel`)

Extract today's `AgentService` almost verbatim into a per-conversation VM: `Id (= sessionId)`, `Title`, `Transcript`, `Draft`, `Status`, `CanInput`, `SendCommand`, `SubmitCommand`, `Approvals`, its `TranscriptReducer`. The differences: it takes a `sessionId` + a send/answer delegate (so it doesn't own the global bridge), and its reducer is fed only *its* events (routed by the manager). The `agent-chat.resources.mu` transcript template rebinds `DataTemplate[AgentService]` → `DataTemplate[ChatSession]` — otherwise unchanged.

### 6.2 `ChatSessionsService` (root)

The manager, standalone `ChatSessionsServiceKey` (like `ProblemsServiceKey`), backing both the nav panel and the dock tabs.

```ts
class ChatSessionsService extends ServiceBase {
    Open: ObservableCollection<ChatSession>     // live conversations (dock tabs)
    Stored: ObservableCollection<StoredConversation>  // restorable, from ChatStore
    ActiveChat: ChatSession | undefined
    NewConversationCommand: ICommand            // + empty chat
    OpenStored(id: string): ChatSession         // rehydrate a stored record into a tab
    Close(chat: ChatSession): void              // remove tab; keep in Stored if persisted
    // internal: onEvent(msg) -> route to Open.find(sessionId).reducer
}
```

`NewConversation` mints a `sessionId`, creates a `ChatSession`, `startSession`s it, and `dock.Add`s it (new tab). Sends go through `sendTurn(sessionId, …)` with the **shared workspace context** `(cwd, addDirs)` from `OpenProjectsStore` (same source today's chat uses — all chats share it).

### 6.3 Conversations nav capability

A new `conversations` module contributing `Capability [ Name="Conversations", Icon=@Conversations, ServiceKey=ChatSessionsServiceKey ]` (same pattern as Project Explorer). A `DataTemplate[ChatSessionsService]` renders the left panel: a **New conversation** button, a **Stored** section (restorable records — open/delete/rename), and an **Open now** section (live conversations — activate/close). Needs a new `@Conversations` icon SVG (add to `renderer/src/icons` + `plexus-icons.mu`).

### 6.4 `ChatStore` (persistence)

Mirrors `OpenProjectsStore`: reads/writes a JSON file under `userData` via `FileSystemService`. A `StoredConversation` = `{ id, title, transcript: SerializedMessage[], resumeToken }`. **Gating:** `ChatStore` persists a conversation **only if** its session reported `Resumable && ResumeToken` — non-resumable conversations are never written (per your requirement: don't store what the AI can't resume). On launch, `RestoreSession()` loads the records into `Stored` (shown in the nav panel, **not** auto-spawned as live subprocesses); `OpenStored(id)` rehydrates the transcript for display and `startSession(sessionId, resumeToken)` so the agent resumes its context on the first new turn.

## 7. Data flow

1. **New:** `+` → mint `sessionId` → `ChatSession` → `startSession` → `dock.Add` (tab).
2. **Send:** user types → `ChatSession.send` → `sendTurn(sessionId, cwd, addDirs, text)` → `AgentSessionManager.get(id)` → that subprocess.
3. **Events:** provider emits → main tags `{ sessionId, event }` → preload → `ChatSessionsService.onEvent` → routed to the matching `ChatSession`'s reducer → its transcript updates.
4. **Parallel:** A and B run at once because each is its own subprocess.
5. **Persist:** when a session becomes resumable (token known), `ChatStore` upserts it; on close the tab goes away but the record remains in `Stored`.
6. **Restore:** launch → `Stored` populated → user opens one → transcript shown + provider resumed.

## 8. Refactor of today's code

- `AgentService` → `ChatSession` (rename/extract per-conversation state; drop the singleton `Key`).
- `agent-session.ts` single-session → `AgentSessionManager` + per-id `AgentSession`.
- IPC/preload → session-tagged (add `sessionId` to every channel + event).
- `main.js`: `dock.Add(agent)` → `ChatSessionsService.RestoreSession()` + (optionally) open one empty conversation on first run.
- `agent-chat.resources.mu`: `DataTemplate[AgentService]` → `DataTemplate[ChatSession]`; add the Conversations panel template (new `conversations` module/resources).
- `TemplateGalleryService` (dev card gallery) — unchanged.

## 9. Testing

- **`ChatSessionsService`** — event routing by `sessionId` (event for A never touches B), `NewConversation`/`OpenStored`/`Close`, persistence gating, with a fake bridge + fake `ChatStore`. Style of `ProblemsService`/`BackgroundWorkService` tests.
- **`AgentSessionManager`** — create/get/close, two sessions receive independent event streams, with a fake provider (fake `SpawnFn` already exists in the engine tests).
- **`ChatStore`** — persists only resumable records; restore round-trips.
- **e2e smoke** — open two conversations, each shows its own transcript; New/Close work.

## 10. Open questions

- Exact claude-CLI **resume** mechanism (`--resume <session-id>`?) and how faithfully it restores context — determines `Resumable`.
- Uncapped parallel subprocess count — acceptable for v1; revisit with a cap if needed.
- Tear-off (deferred): a popped conversation renders the same `ChatSession` VM in a `BrowserWindow` talking to the same main session by id — no engine change required then.

## 11. First-cut scope (YAGNI)

- [ ] `AgentSessionManager` + session-tagged IPC/preload (parallel sessions).
- [ ] Provider resume descriptor + token (claude-CLI impl) — or `Resumable=false` fallback.
- [ ] `ChatSession` (extracted from `AgentService`).
- [ ] `ChatSessionsService` (open collection, new/open/close, event routing).
- [ ] Conversations nav panel + `@Conversations` icon.
- [ ] `ChatStore` (provider-gated persist + restore).
- [ ] Dock tabs for open conversations; refactor `main.js` seeding.
- [ ] Deferred: tear-off windows; global concurrency cap.

# Wiki rendered view — read-only Markdown instead of Monaco

**Goal:** The "Open Wiki" action opens a concept's `.md` page as a **read-only
rendered document tab** (Markdown laid out by a mural `RichTextBlock`) instead
of an editable Monaco code tab. Users read AI-authored wiki pages; they do not
edit them.

## Background

The wiki feature (see `2026-08-17-wiki-annotation-design.md`) currently resolves
a concept's `.md` and hands the absolute path to `CodeEditorService.OpenFile`,
which opens it in an editable Monaco tab. The intent is a *viewer*: wiki pages
are authored by an AI, and a code editor invites accidental edits and shows raw
Markdown source rather than formatted text.

The codebase already renders Markdown: the agent chat converts assistant
messages to a mural `FlowDocument` via `buildFlowDocument(markdown)`
(`modules/agent-chat/services/markdown-document.ts`) and lays it out with
`RichTextBlock [ Document = $Document ]` — headings, bold/italic, inline and
fenced code, lists, tables, blockquotes, links. A `RichTextBlock` is a
display-only control (unlike the editable `RichTextBox`), so it is inherently
read-only. This rework reuses that renderer.

## Scope

- ONLY the "Open Wiki" action changes (`WikiService.openWiki`). Opening a `.md`
  from the Project Explorer still uses Monaco — that is a general editor
  concern, not the wiki viewer.
- `WikiLocator`, `WikiService.hasWiki`, the shared `@OpenWikiMenu`, and all four
  concept surfaces (canvas node, toolbox tile, Meta-models entity, library tile)
  are unchanged. `CodeEditorService` is untouched.

## Architecture

### A. Relocate the Markdown renderer (shared unit)

`buildFlowDocument` is needed by both the chat and the wiki viewer, so it moves
from the agent-chat module to a neutral location:

- Move `modules/agent-chat/services/markdown-document.ts` →
  `services/markdown/markdown-document.ts` (and its test
  `.../tests/markdown-document.test.ts`).
- Update the one production import (`modules/agent-chat/services/transcript.ts`)
  to the new path. No behavior change — a pure file move + import update.

The function signature is unchanged: `buildFlowDocument(markdown: string):
FlowDocument`, a pure, node-safe string → `FlowDocument` transform.

### B. `WikiDocument` — the read-only viewer VM

A new `IDocument` at `services/wiki/wiki-document.ts`, mirroring `CodeDocument`
but display-only:

- `Id: string` — the absolute `.md` path (the content host dedupes tabs by Id,
  so re-opening the same page re-activates its tab).
- `Title: string` — the file name (e.g. `component.md`).
- `IsDirty: boolean` — always `false` (read-only; nothing edits it).
- `Document: FlowDocument` (DP) — built from the file text via
  `buildFlowDocument`; the view binds `$Document`.
- `constructor(path: string, text: string)` — sets Id/Title and
  `Document = buildFlowDocument(text)`.
- `Refresh(text: string): void` — rebuilds `Document` from new text, so
  re-opening a regenerated page shows the new content instead of a stale render.

No `Save`, no `Content` two-way, no `Language`, no diagnostics — a viewer, not
an editor.

### C. `WikiService.openWiki` — open a rendered tab

`openWiki(concept)` keeps its resolve/exists/status flow; only the final "open"
step changes:

1. `hit = WikiLocator.resolveWiki(concept)`. `undefined` → Status "Open the
   project that declares …", return. (unchanged)
2. `abs = join(hit.root, hit.relPath)`. (unchanged)
3. `FileSystemService.Exists(abs)` false → Status "Wiki file not found: …",
   return. (unchanged)
4. `text = await FileSystemService.ReadText(abs)`.
5. Dedupe by `abs` via a private `Map<string, WikiDocument>`:
   - cached → `doc.Refresh(text)` (pick up regenerated content), reuse it;
   - else → `doc = new WikiDocument(abs, text)`, cache it.
6. Open/activate the tab through the content host
   (`ContentHostService.Key` cast to `DocumentsContentHostService`, `.Open(doc)`
   — the same host `CodeEditorService` uses). `Status = ''`.

`WikiService` gains a `ContentHostService` dependency (resolved lazily via the
provider, like its other collaborators) and drops its dependency on
`CodeEditorService` for the wiki path.

### D. View — `DataTemplate[WikiDocument]`

In `services/wiki/wiki.resources.mu`, add a document template rendering the
FlowDocument read-only inside a scroll region:

```
DataTemplate [DataType = WikiDocument] {
    ScrollViewer [ Padding = (16) ] {
        RichTextBlock [ Document = $Document, Foreground = @OnSurface ]
    }
}
```

The template is merged app-global via the existing `merge WikiResources` in
`app.mu`; `wiki.resources.mu` is already on the `compile:mu` list.

## Error handling

- Concept doesn't resolve / declaring project not open → Status message, no tab
  (unchanged).
- File missing → Status message, no tab (unchanged).
- `ReadText` failure → treated like missing: a Status message, no tab (the read
  is guarded).
- `buildFlowDocument` is designed never to throw on partial/odd Markdown; a
  malformed page degrades to readable text.

## Testing

- **`buildFlowDocument`** — its existing test moves with it to
  `services/markdown/tests/markdown-document.test.ts`; still green (no logic
  change).
- **`WikiDocument`** — `Id`/`Title` from the path; `IsDirty === false`;
  `Document` is a `FlowDocument` built from the text; `Refresh(newText)` swaps
  `Document` (identity changes).
- **`WikiService.openWiki`** (fake `WikiLocator` + fake `FileSystemService` +
  fake `DocumentsContentHostService`):
  - happy path → a `WikiDocument` with `Id === join(root, relPath)` is opened;
  - repeat open of the same concept → the SAME document instance is re-activated
    (deduped) and `Refresh` is called with the re-read text;
  - concept doesn't resolve → no open, Status set;
  - file missing → no open, Status set.
- **Live Playwright smoke** — right-click a concept surface → Open Wiki →
  assert a tab opens whose body shows rendered content (a heading / paragraph
  text) and that NO `.monaco-editor` host is present for it (i.e. it is the
  rendered viewer, not the code editor).

## Out of scope

- Editing wiki pages from the UI (authored by AI / by hand, like today).
- A Markdown feature superset beyond what `buildFlowDocument` already supports.
- Changing how general `.md` files open from the Project Explorer (still Monaco).
- A dedicated wiki side panel or modal (chose a read-only document tab).

# Wiki Rendered View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "Open Wiki" action open a concept's `.md` as a read-only rendered document tab (Markdown laid out by a mural `RichTextBlock`) instead of an editable Monaco code tab.

**Architecture:** Reuse the existing `buildFlowDocument(markdown): FlowDocument` renderer (relocated from the agent-chat module to a shared `services/markdown/`). Add a read-only `WikiDocument` (`IDocument`) whose view is a `RichTextBlock`, and switch `WikiService.openWiki` to open that deduped tab through the content host instead of calling `CodeEditorService.OpenFile`. `WikiLocator`, `WikiService.hasWiki`, the shared `@OpenWikiMenu`, the four concept surfaces, and `CodeEditorService` are untouched.

**Tech Stack:** TypeScript (Plexus renderer), mural runtime (`Model`/`RegisterProperty`) + mural `basic` (`FlowDocument`, `RichTextBlock`) + mural `framework` (`IDocument`, `ContentHostService`/`DocumentsContentHostService`), mural `.mu` CLI, vitest.

## Global Constraints

- Every test file lives in a `tests/` subfolder next to the code it exercises.
- Enums over string-literal unions; no `type X = 'a'|'b'`.
- Renderer: no `node:fs`/`node:path` — read via `FileSystemService`, build paths with the local `join` helper already in `wiki-service.ts`.
- Only the "Open Wiki" action changes. `WikiLocator`, `WikiService.hasWiki`, `@OpenWikiMenu`, the four surfaces, and `CodeEditorService` stay as-is. General `.md` files opened from the Project Explorer still use Monaco.
- `WikiDocument` is read-only: `IsDirty` is always `false`; `Save()` is a no-op.
- `RichTextBlock` (not `RichTextBox`) — the display-only control.
- Commit after each task with the given message. Do NOT push (the user pushes explicitly). Work happens on the `feat/wiki-rendered-view` branch (already created off `main`).

---

### Task 1: Relocate `buildFlowDocument` to a shared unit

Move the Markdown → `FlowDocument` renderer out of the agent-chat module so the wiki viewer can share it without depending on the chat. Pure file move + one import update; no logic change.

**Files:**
- Move: `src/renderer/src/modules/agent-chat/services/markdown-document.ts` → `src/renderer/src/services/markdown/markdown-document.ts`
- Move: `src/renderer/src/modules/agent-chat/services/tests/markdown-document.test.ts` → `src/renderer/src/services/markdown/tests/markdown-document.test.ts`
- Modify: `src/renderer/src/modules/agent-chat/services/transcript.ts:8`

**Interfaces:**
- Produces: `buildFlowDocument(markdown: string): FlowDocument` importable from `../../services/markdown/markdown-document.js` (path relative to a module under `modules/`) or `./markdown-document.js` (within `services/markdown/`). Signature and behavior unchanged.

- [ ] **Step 1: Move the two files with git (history-preserving)**

```bash
cd Plexus
mkdir -p src/renderer/src/services/markdown/tests
git mv src/renderer/src/modules/agent-chat/services/markdown-document.ts src/renderer/src/services/markdown/markdown-document.ts
git mv src/renderer/src/modules/agent-chat/services/tests/markdown-document.test.ts src/renderer/src/services/markdown/tests/markdown-document.test.ts
```

The test imports `../markdown-document.js` (relative), which stays valid after moving both files together — do NOT edit it.

- [ ] **Step 2: Update the one production import**

In `src/renderer/src/modules/agent-chat/services/transcript.ts`, change line 8 from:

```ts
import { buildFlowDocument } from './markdown-document.js'
```

to:

```ts
import { buildFlowDocument } from '../../../services/markdown/markdown-document.js'
```

- [ ] **Step 3: Verify no other importer references the old path**

Run: `cd Plexus && grep -rn "agent-chat/services/markdown-document" src/ ; grep -rn "from './markdown-document" src/renderer/src/modules/agent-chat/`
Expected: no matches (only `transcript.ts` imported it, now updated).

- [ ] **Step 4: Run the moved test + the agent-chat suite + typecheck**

Run: `cd Plexus && npx vitest run src/renderer/src/services/markdown src/renderer/src/modules/agent-chat && npm run typecheck:web`
Expected: all green (the move is behavior-neutral; the markdown-document test passes at its new path and the chat transcript still builds its FlowDocument).

- [ ] **Step 5: Commit**

```bash
cd Plexus && git add -A src/renderer/src/services/markdown src/renderer/src/modules/agent-chat/services/markdown-document.ts src/renderer/src/modules/agent-chat/services/tests/markdown-document.test.ts src/renderer/src/modules/agent-chat/services/transcript.ts \
  && git commit -m "refactor: relocate buildFlowDocument to shared services/markdown"
```

---

### Task 2: `WikiDocument` — the read-only viewer VM

A minimal `IDocument` that holds the parsed `FlowDocument` for a wiki page. The content host shows it as a tab; the view (Task 3) binds `$Document`.

**Files:**
- Create: `src/renderer/src/services/wiki/wiki-document.ts`
- Test: `src/renderer/src/services/wiki/tests/wiki-document.test.ts`

**Interfaces:**
- Consumes: `buildFlowDocument(markdown): FlowDocument` from `../markdown/markdown-document.js` (Task 1); `FlowDocument` type from `@pragmatic-lab/mural/basic`; `IDocument` from `@pragmatic-lab/mural/framework`.
- Produces:
  - `class WikiDocument implements IDocument` with `constructor(path: string, text: string)`
  - `Id: string` (the path), `Title: string` (file name), `IsDirty: boolean` (always `false`), `Document: FlowDocument` (DP), `Save(): void` (no-op), `Refresh(text: string): void`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/services/wiki/tests/wiki-document.test.ts`:

```ts
import { test, expect } from 'vitest'
import { FlowDocument } from '@pragmatic-lab/mural/basic'
import { WikiDocument } from '../wiki-document.js'

test('WikiDocument exposes Id (path), Title (file name), read-only IsDirty', () => {
    const doc = new WikiDocument('/mm/wiki/component.md', '# Component\n\nBody.')
    expect(doc.Id).toBe('/mm/wiki/component.md')
    expect(doc.Title).toBe('component.md')
    expect(doc.IsDirty).toBe(false)
    expect(doc.Document).toBeInstanceOf(FlowDocument)
})

test('Refresh rebuilds Document from new text (identity changes)', () => {
    const doc = new WikiDocument('/mm/wiki/component.md', '# One')
    const first = doc.Document
    doc.Refresh('# Two')
    expect(doc.Document).toBeInstanceOf(FlowDocument)
    expect(doc.Document).not.toBe(first)
    expect(doc.IsDirty).toBe(false)
})

test('Save is a no-op that does not throw', () => {
    const doc = new WikiDocument('/mm/wiki/component.md', '# Component')
    expect(() => doc.Save()).not.toThrow()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/services/wiki/tests/wiki-document.test.ts`
Expected: FAIL — `../wiki-document.js` does not exist.

- [ ] **Step 3: Implement `WikiDocument`**

Create `src/renderer/src/services/wiki/wiki-document.ts`:

```ts
import { MetaData, Model } from '@pragmatic-lab/mural/runtime'
import { FlowDocument } from '@pragmatic-lab/mural/basic'
import type { IDocument } from '@pragmatic-lab/mural/framework'

import { buildFlowDocument } from '../markdown/markdown-document.js'

// The file name (last path segment) of an absolute path.
function fileName(path: string): string
{
    const parts = path.split(/[\\/]/)
    return parts[parts.length - 1] || path
}

// A wiki page opened as a READ-ONLY document tab. Unlike CodeDocument it owns no
// editable text and never saves: it holds the parsed FlowDocument the
// DataTemplate[WikiDocument] lays out with a RichTextBlock. Id is the file's
// absolute path, so re-opening the same page dedupes to one tab.
export class WikiDocument extends Model implements IDocument
{
    public static readonly IdKey = Model.RegisterProperty<string>(
        WikiDocument, 'Id', '', MetaData.None)
    public static readonly TitleKey = Model.RegisterProperty<string>(
        WikiDocument, 'Title', '', MetaData.None)
    public static readonly DocumentKey = Model.RegisterProperty<FlowDocument>(
        WikiDocument, 'Document', undefined as unknown as FlowDocument, MetaData.None)

    public constructor(path: string, text: string)
    {
        super()
        this.set_property_value(WikiDocument.IdKey, path)
        this.set_property_value(WikiDocument.TitleKey, fileName(path))
        this.set_property_value(WikiDocument.DocumentKey, buildFlowDocument(text))
    }

    public get Id(): string { return this.get_property_value(WikiDocument.IdKey) }
    public get Title(): string { return this.get_property_value(WikiDocument.TitleKey) }
    public get Document(): FlowDocument { return this.get_property_value(WikiDocument.DocumentKey) }

    // Read-only: never dirty, save is a no-op (IDocument requires both).
    public get IsDirty(): boolean { return false }
    public Save(): void {}

    // Re-render from new text (a regenerated page) so a reused tab isn't stale.
    public Refresh(text: string): void
    {
        this.set_property_value(WikiDocument.DocumentKey, buildFlowDocument(text))
    }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/services/wiki/tests/wiki-document.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd Plexus && git add src/renderer/src/services/wiki/wiki-document.ts src/renderer/src/services/wiki/tests/wiki-document.test.ts \
  && git commit -m "feat(wiki): read-only WikiDocument rendering a FlowDocument"
```

---

### Task 3: `WikiService.openWiki` opens a rendered tab + the view template

Replace the Monaco open with a `WikiDocument` opened in the content host (deduped by path, refreshed on repeat), and add the read-only `RichTextBlock` DataTemplate.

**Files:**
- Modify: `src/renderer/src/services/wiki/wiki-service.ts`
- Modify: `src/renderer/src/services/wiki/wiki.resources.mu`
- Test: `src/renderer/src/services/wiki/tests/wiki-service.test.ts` (rewrite the open assertions)

**Interfaces:**
- Consumes: `WikiDocument` (Task 2); `ContentHostService` + `DocumentsContentHostService` from `@pragmatic-lab/mural/framework`; `FileSystemService.ReadText(path): Promise<string>` + `Exists(path): Promise<boolean>`; `WikiLocator.resolveWiki` (unchanged).
- Produces: `WikiService.openWiki(concept: string): Promise<void>` now opens a `WikiDocument` (Id = `join(root, relPath)`) in the content host; `hasWiki` + `OpenWikiCommand` + `Status` unchanged.

- [ ] **Step 1: Rewrite the openWiki tests for the rendered path**

Replace the whole body of `src/renderer/src/services/wiki/tests/wiki-service.test.ts` with:

```ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { ContentHostService } from '@pragmatic-lab/mural/framework'
import { FileSystemService } from '../../file-system/file-system-service.js'
import { WikiLocator } from '../wiki-locator.js'
import { WikiService } from '../wiki-service.js'
import { WikiDocument } from '../wiki-document.js'

function svc(opts: {
    resolve?: { root: string; relPath: string }
    exists?: boolean
    text?: string
}): { wiki: WikiService; opened: unknown[] } {
    const opened: unknown[] = []
    const provider = new ServiceProvider()
    provider.registerInstance(FileSystemService.Key, {
        Exists: () => Promise.resolve(opts.exists ?? true),
        ReadText: () => Promise.resolve(opts.text ?? '# Wiki\n\nBody.'),
    } as unknown as FileSystemService)
    provider.registerInstance(ContentHostService.Key, {
        Open: (d: unknown) => { opened.push(d) },
    } as unknown as ContentHostService)
    provider.registerInstance(WikiLocator.Key, {
        resolveWiki: () => Promise.resolve(opts.resolve),
    } as unknown as WikiLocator)
    return { wiki: new WikiService(provider), opened }
}

test('openWiki opens a WikiDocument whose Id is join(root, relPath)', async () => {
    const { wiki, opened } = svc({ resolve: { root: '/mm', relPath: 'wiki/component.md' } })
    await wiki.openWiki('component')
    expect(opened.length).toBe(1)
    expect(opened[0]).toBeInstanceOf(WikiDocument)
    expect((opened[0] as WikiDocument).Id).toBe('/mm/wiki/component.md')
})

test('re-opening the same page reuses the SAME document (deduped)', async () => {
    const { wiki, opened } = svc({ resolve: { root: '/mm', relPath: 'wiki/component.md' } })
    await wiki.openWiki('component')
    await wiki.openWiki('component')
    expect(opened.length).toBe(2)
    expect(opened[0]).toBe(opened[1])   // same instance re-activated, not a new tab
})

test('openWiki is a no-op with a status when the concept does not resolve', async () => {
    const { wiki, opened } = svc({ resolve: undefined })
    await wiki.openWiki('component')
    expect(opened).toEqual([])
    expect(wiki.Status.length).toBeGreaterThan(0)
})

test('openWiki is a no-op with a status when the file is missing', async () => {
    const { wiki, opened } = svc({ resolve: { root: '/mm', relPath: 'wiki/component.md' }, exists: false })
    await wiki.openWiki('component')
    expect(opened).toEqual([])
    expect(wiki.Status.length).toBeGreaterThan(0)
})

test('hasWiki reflects whether the concept resolves', async () => {
    expect(await svc({ resolve: { root: '/mm', relPath: 'w.md' } }).wiki.hasWiki('component')).toBe(true)
    expect(await svc({ resolve: undefined }).wiki.hasWiki('component')).toBe(false)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/services/wiki/tests/wiki-service.test.ts`
Expected: FAIL — `WikiService` still opens through `CodeEditorService` (no `ContentHostService.Open` call; opened stays empty).

- [ ] **Step 3: Rework `openWiki` in `wiki-service.ts`**

In `src/renderer/src/services/wiki/wiki-service.ts`:

Replace the import of `CodeEditorService`:

```ts
import { CodeEditorService } from '../../modules/code-editor/code-editor-service.js'
```

with the content host + document imports:

```ts
import { ContentHostService, type DocumentsContentHostService } from '@pragmatic-lab/mural/framework'
import { WikiDocument } from './wiki-document.js'
```

Add a per-path document cache field to the class (next to the existing members, after the DP declarations):

```ts
    // Open wiki tabs keyed by absolute path, so re-opening a page re-activates
    // its tab (and refreshes its content) instead of stacking duplicates.
    private readonly open = new Map<string, WikiDocument>()
```

Replace the `openWiki` method body's final open step. The method currently ends with:

```ts
        this.Provider.getRequired(CodeEditorService.Key).OpenFile(abs)
        this.Status = ''
```

Change those two lines to read the text, build/refresh a `WikiDocument`, and open it in the content host:

```ts
        const text = await this.readText(abs)
        let doc = this.open.get(abs)
        if (doc === undefined) { doc = new WikiDocument(abs, text); this.open.set(abs, doc) }
        else doc.Refresh(text)
        const host = this.Provider.getRequired(ContentHostService.Key) as DocumentsContentHostService
        host.Open(doc)
        this.Status = ''
```

Add a small guarded read helper as a private method (next to `openWiki`):

```ts
    // Read a file's text, degrading a read error to '' (buildFlowDocument renders
    // it as an empty page rather than throwing). Existence is checked before this.
    private async readText(path: string): Promise<string>
    {
        const fs = this.Provider.getRequired(FileSystemService.Key)
        try { return await fs.ReadText(path) } catch { return '' }
    }
```

(The existing `FileSystemService.Exists` guard, the resolve/Status flow, and the `join` helper stay exactly as they are.)

- [ ] **Step 4: Run the service test to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/services/wiki/tests/wiki-service.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the read-only view template**

In `src/renderer/src/services/wiki/wiki.resources.mu`, add the import for the document class and the DataTemplate inside the `resources WikiResources { ... }` block (after the existing `ContextMenu` block):

At the top of the file, next to the existing `import WikiService from "./wiki-service.js"`, add:

```
import WikiDocument from "./wiki-document.js"
```

Inside `resources WikiResources { ... }`, after the `ContextMenu x:key="OpenWikiMenu" { ... }` block, add:

```
    // Read-only rendered view for an opened wiki page. The content host shows a
    // WikiDocument as a tab and applies this template; the RichTextBlock lays out
    // its FlowDocument (headings, bold/italic, code, lists, tables, links).
    DataTemplate [DataType = WikiDocument] {
        ScrollViewer [ Padding = (16) ] {
            RichTextBlock [ Document = $Document, Foreground = @OnSurface ]
        }
    }
```

- [ ] **Step 6: Compile + typecheck**

Run: `cd Plexus && npm run compile:mu && npm run typecheck:web`
Expected: `compile:mu` emits `wiki.resources.mu.js` with no unresolved bindings; typecheck clean. (`wiki.resources.mu` is already on the `compile:mu` list and `app.mu` already merges `WikiResources` — no registration change needed.)

- [ ] **Step 7: Run the wiki + code-editor + agent-chat suites**

Run: `cd Plexus && npx vitest run src/renderer/src/services/wiki src/renderer/src/modules/code-editor src/renderer/src/modules/agent-chat`
Expected: all green (CodeEditorService is untouched; the wiki path no longer references it).

- [ ] **Step 8: Commit**

```bash
cd Plexus && git add src/renderer/src/services/wiki/wiki-service.ts src/renderer/src/services/wiki/wiki.resources.mu src/renderer/src/services/wiki/tests/wiki-service.test.ts \
  && git commit -m "feat(wiki): Open Wiki opens a read-only rendered tab (RichTextBlock)"
```

---

### Task 4: Full verification + Playwright smoke

Confirm the whole app builds and the live "Open Wiki" now shows a rendered tab, not Monaco.

**Files:**
- Create (scratch, not committed): a Playwright driver under the session scratchpad.

**Interfaces:** none (verification only).

- [ ] **Step 1: Full suite + typecheck + build**

Run: `cd Plexus && npm test && npm run typecheck && npm run build`
Expected: all green; `out/` rebuilt.

- [ ] **Step 2: Playwright smoke — rendered tab, no Monaco**

Adapt the prior meta-model-panel harness (`smoke-wiki-mm.mjs` in the session scratchpad, which already: seeds the tech-architecture meta-model project open, copies the published meta-model into the Electron userData, activates the Meta-models panel, drills tech-architecture → 0.1.0 → Concepts → Component, right-clicks → clicks "Open Wiki"). Change ONLY the post-open assertion to verify the RENDERED viewer instead of a Monaco tab:

```js
// After clicking "Open Wiki":
const check = await win.evaluate(() => {
    const texts = [...document.querySelectorAll('text, span, div')].map((e) => (e.textContent || '').trim())
    return {
        tabTitle: texts.find((t) => t.endsWith('component.md')),
        // The rendered page shows its heading/body as laid-out text, NOT in a Monaco editor.
        showsHeading: document.body.innerText.includes('first-class entity in the architecture'),
        monacoForWiki: document.querySelectorAll('.monaco-editor').length,  // expect the wiki NOT to add one
    }
})
console.log('[driver] rendered wiki:', JSON.stringify(check))
// PASS when the tab opened and its rendered body text is present.
opened = check.tabTitle !== undefined && check.showsHeading
```

Run: `node <scratchpad>/smoke-wiki-mm.mjs`
Expected: `[driver] rendered wiki: {"tabTitle":"component.md","showsHeading":true,...}`, `menuShown: true`, `renderer errors: NONE`. Capture a screenshot (`mm-04-opened.png`) and confirm the page renders as formatted text (a bold `# Component` heading, body paragraph, bulleted "Key points") rather than raw Markdown in a code editor.

- [ ] **Step 3: No commit needed**

Verification only; the scratch driver is not committed. Report the smoke result.

---

## Self-Review

**Spec coverage:**
- Relocate `buildFlowDocument` to shared `services/markdown/` + update chat import → Task 1.
- Read-only `WikiDocument` (`IDocument`; Id/Title, `IsDirty=false`, `Document` from `buildFlowDocument`, `Refresh`, no-op `Save`) → Task 2.
- `WikiService.openWiki` opens the deduped/refreshed `WikiDocument` in the content host; resolve/exists/status paths unchanged; `CodeEditorService` dropped from the wiki path → Task 3.
- `DataTemplate[WikiDocument]` = `ScrollViewer` + `RichTextBlock [ Document = $Document ]` → Task 3.
- `WikiLocator`, `hasWiki`, `@OpenWikiMenu`, four surfaces, `CodeEditorService`, general `.md`-in-Monaco all untouched → not modified in any task (Tasks 1–3 touch only the listed files).
- Testing (buildFlowDocument moved test; WikiDocument; openWiki happy/dedupe/no-resolve/missing-file; live smoke) → Tasks 1–4.
- Out-of-scope (editing UI, Markdown superset, explorer `.md` behavior, side panel/modal) → not implemented.

**Placeholder scan:** none — every code step carries real code + an exact run command. Task 1 is a `git mv` + a one-line import edit (a move, not new logic, so the 427-line file content is intentionally not repeated). Task 4's smoke reuses the existing `smoke-wiki-mm.mjs` with a named, quoted assertion change.

**Type consistency:** `buildFlowDocument(markdown: string): FlowDocument` (Task 1) consumed identically by `WikiDocument` (Task 2). `WikiDocument(path, text)` + `.Id`/`.Document`/`.Refresh(text)` (Task 2) consumed identically by `WikiService` (Task 3) and the tests. `ContentHostService.Open(doc)` cast to `DocumentsContentHostService` matches the `CodeEditorService` precedent. `IDocument` members (`Id`, `Title`, `IsDirty`, `Save`) all implemented on `WikiDocument`.

**Risk callouts:**
1. Moving `markdown-document.ts` — its test uses a RELATIVE import (`../markdown-document.js`) that stays valid post-move; only `transcript.ts`'s import needs editing (verified in Task 1 Step 3). If any other importer surfaces, update it the same way.
2. `RichTextBlock`/`ScrollViewer`/`Document` binding — `RichTextBlock [ Document = $Document ]` is the exact idiom the agent chat already ships (`agent-chat.resources.mu`), so the control is registered and the binding is proven. `compile:mu` (Task 3 Step 6) is the gate for any `.mu` regression, ahead of the IDE's known language-server false positives.

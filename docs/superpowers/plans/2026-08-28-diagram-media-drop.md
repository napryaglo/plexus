# Diagram Media Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user drag a file, image, or hyperlink from the OS (or paste an image) onto the diagram and have it placed as a shape — images render as pictures, files/links render as a thumbnail+label chip that opens the target on double-click.

**Architecture:** Mural already bridges native OS drops into its `DataObject` (`Data.Get('Files')` → `FileList`, `Data.Get('text/uri-list')` → string) at the DOM boundary in `html-target.ts`; the only reason OS drops are ignored today is that `attachCanvasDropBehavior` guards on the toolbox format and returns early. We relax that guard and add a new `ExternalDropped` event on `Diagram`. On the Plexus side a `MediaDropHandler` subscribes to that event, classifies each payload, applies a storage policy (inline < 1 MB / copy into a project `media/` folder / link), builds a `MediaNodeVM` (a content `NodeViewModel` rendered through a `.mu` DataTemplate reusing the existing `markdown-image` resolution), and positions it via `doc.SetNodeVisual`. A `media` node serializer persists `{ mediaKind, source, hyperlinkUri, label }`; geometry stays in `NodeVisualStore`.

**Tech Stack:** TypeScript, `@pragmatic-tech-ai/mural` (framework + visual-engine), Electron (main/preload IPC), mural `.mu` templates, vitest (Plexus) / `tsx --test` (Mural), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-08-28-diagram-media-drop-design.md`

## Global Constraints

- **Mural version bump:** `@pragmatic-tech-ai/mural` `0.35.0` → `0.36.0`; Plexus dependency `^0.35.0` → `^0.36.0`. Mural is consumed from the local Verdaccio registry — republish + reinstall (or `npm link`) after Mural source changes.
- **Enums, never string-literal unions** (`enum MediaKind`, `enum MediaLinkRenderMode`, `enum LargeFileChoice`, `enum StoragePlacement`).
- **Every test file lives in a `tests/` subfolder next to the source it covers.**
- **Render only through templates/bindings** — no imperative chrome; the visual is a `.mu` `DataTemplate` keyed by `DataType = MediaNodeVM`.
- **No hardcoded width/height in templates** — image node size comes from decoded natural size written to `NodeVisualStore`, clamped; the template composes.
- **Inline threshold:** `MEDIA_INLINE_LIMIT_BYTES = 1024 * 1024` (1 MB).
- **Images always embed** (inline < 1 MB, else copied to `media/`); only large *arbitrary* files get the Embed/Link prompt.
- **Mural test cmd:** `npm test` (all) / `npx tsx --conditions=development --test <file>` (one). **Typecheck:** `npm run typecheck`.
- **Plexus test cmd:** `npm test` (= `vitest run`) / `npx vitest run <file>` (one). **Typecheck:** `npm run typecheck`. **Compile templates:** `npm run compile:mu`. **e2e:** `npm run test:e2e`.

---

### Task 1: Mural — `ExternalDropped` event + external-drop parsing

Adds a first-class external-drop signal to `Diagram` and teaches `attachCanvasDropBehavior` to fire it for OS file/URI drops, leaving the toolbox path untouched.

**Files:**
- Create: `Mural/src/framework/diagram/external-drop.ts`
- Modify: `Mural/src/framework/diagram/diagram.ts` (event plumbing — mirror `_itemDroppedListeners` at lines ~963-965 / `_fireItemDropped` at ~1016-1055)
- Modify: `Mural/src/framework/diagram/behaviors/canvas-drop-behavior.ts` (relax guards, parse & fire)
- Modify: `Mural/package.json` (version `0.35.0` → `0.36.0`)
- Test: `Mural/src/framework/diagram/behaviors/tests/canvas-drop-behavior.external.test.ts`

**Interfaces:**
- Produces:
  - `enum MuralDataFormat { Files = 'Files', UriList = 'text/uri-list' }` (in `external-drop.ts`)
  - `interface ExternalDroppedArgs { readonly Files: readonly File[]; readonly Uris: readonly string[]; readonly Position: Point; readonly TargetContainer?: ContainerFigure }`
  - `type ExternalDroppedListener = (args: ExternalDroppedArgs) => void`
  - `Diagram.AddExternalDroppedListener(l: ExternalDroppedListener): void`
  - `Diagram.RemoveExternalDroppedListener(l: ExternalDroppedListener): void`
  - `Diagram._fireExternalDropped(args: ExternalDroppedArgs): void`
  - `parseUriList(text: string): string[]` (exported from `external-drop.ts`)
- Consumes (existing): `diagram.HostToContent`, `diagram.ContainerPlacement.containerAt`, `DataObject.Has/Get`, `_bracketed`.

- [ ] **Step 1: Write the failing test**

`Mural/src/framework/diagram/behaviors/tests/canvas-drop-behavior.external.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseUriList } from '../../external-drop.ts'

test('parseUriList returns http/file uris and drops comments + blanks', () => {
    const text = '# comment\r\nhttps://example.com/a.png\r\n\r\nfile:///C:/x/y.pdf\r\n'
    assert.deepEqual(parseUriList(text), ['https://example.com/a.png', 'file:///C:/x/y.pdf'])
})

test('parseUriList tolerates a bare single uri with no CRLF', () => {
    assert.deepEqual(parseUriList('https://example.com'), ['https://example.com'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Mural && npx tsx --conditions=development --test src/framework/diagram/behaviors/tests/canvas-drop-behavior.external.test.ts`
Expected: FAIL — cannot find module `../../external-drop.ts`.

- [ ] **Step 3: Create `external-drop.ts`**

`Mural/src/framework/diagram/external-drop.ts`:

```typescript
import type { Point } from '../../visual-engine/index.ts'
import type { ContainerFigure } from './container-figure.ts'

// Well-known drag formats mural's html-target places on the DataObject for OS
// drops. `Files` carries a FileList; `text/uri-list` carries newline-separated
// URIs (RFC 2483 — lines beginning with '#' are comments).
export enum MuralDataFormat
{
    Files   = 'Files',
    UriList = 'text/uri-list',
}

export interface ExternalDroppedArgs
{
    readonly Files:            readonly File[]
    readonly Uris:             readonly string[]
    readonly Position:         Point
    readonly TargetContainer?: ContainerFigure
}

export type ExternalDroppedListener = (args: ExternalDroppedArgs) => void

// Parse an RFC 2483 text/uri-list payload: split on newlines, drop comment
// lines ('#') and blanks, trim CR.
export function parseUriList(text: string): string[]
{
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'))
}
```

Adjust the two `import type` paths to match how sibling files in `framework/diagram/` import `Point` and `ContainerFigure` (check `canvas-drop-behavior.ts` header for the exact specifiers).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Mural && npx tsx --conditions=development --test src/framework/diagram/behaviors/tests/canvas-drop-behavior.external.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Add the event plumbing to `Diagram`**

In `Mural/src/framework/diagram/diagram.ts`, mirror the existing `_itemDroppedListeners` idiom. Add near the other listener sets:

```typescript
private readonly _externalDroppedListeners: Set<ExternalDroppedListener> = new Set();
public AddExternalDroppedListener   (listener: ExternalDroppedListener): void { this._externalDroppedListeners.add(listener); }
public RemoveExternalDroppedListener(listener: ExternalDroppedListener): void { this._externalDroppedListeners.delete(listener); }

public _fireExternalDropped(args: ExternalDroppedArgs): void
{
    this._bracketed('Drop', () => { for (const l of [...this._externalDroppedListeners]) l(args); });
}
```

Add the import at the top: `import type { ExternalDroppedArgs, ExternalDroppedListener } from './external-drop.ts'` (match the extension/style of the existing `ItemDroppedArgs` import).

- [ ] **Step 6: Relax the guards and fire in `canvas-drop-behavior.ts`**

In `Mural/src/framework/diagram/behaviors/canvas-drop-behavior.ts`, import the new helpers:

```typescript
import { MuralDataFormat, parseUriList } from '../external-drop.ts'
```

Extend `onDragOver` so external payloads also show the copy affordance:

```typescript
const onDragOver = (args: DragEventArgs): void => {
    if (args.Data.Has(TOOLBOX_ITEM_FORMAT)
        || args.Data.Has(MuralDataFormat.Files)
        || args.Data.Has(MuralDataFormat.UriList))
        args.Effect = DragDropEffects.Copy;
};
```

Extend `onDrop` so a non-toolbox OS payload fires `_fireExternalDropped`:

```typescript
const onDrop = (args: DragEventArgs): void => {
    const position = localPosition(args);
    const container = diagram.ContainerPlacement.containerAt(position);

    if (args.Data.Has(TOOLBOX_ITEM_FORMAT)) {
        diagram.Focus();
        diagram._fireItemDropped({ Data: args.Data, Position: position, TargetContainer: container });
        return;
    }

    const fileList = args.Data.Get<FileList>(MuralDataFormat.Files);
    const uriText  = args.Data.Get<string>(MuralDataFormat.UriList);
    const files    = fileList !== undefined ? Array.from(fileList) : [];
    const uris     = uriText !== undefined && uriText.length > 0 ? parseUriList(uriText) : [];
    if (files.length === 0 && uris.length === 0) return;

    diagram.Focus();
    diagram._fireExternalDropped({ Files: files, Uris: uris, Position: position, TargetContainer: container });
};
```

(The existing early-`return` on missing toolbox format is removed; `localPosition`/`containerAt` now run once up front.)

- [ ] **Step 7: Write the fire-path test**

Append to the test file. Build a `DataObject` with a fake `FileList`, invoke the behavior's drop path, and assert `_fireExternalDropped` receives the file with mapped position. Since `attachCanvasDropBehavior` wires routed listeners, drive it through a minimal fake `receiver`/`diagram` the same way existing `canvas-drop-behavior` tests do — check the sibling test (e.g. `tests/canvas-drop-behavior.test.ts` if present) and copy its harness. Concretely:

```typescript
import { DataObject } from '../../../visual-engine/drag-drop.ts'
import { MuralDataFormat } from '../../external-drop.ts'

test('external file drop fires ExternalDropped with content position', () => {
    const fired: unknown[] = []
    const fakeFile = new File([new Uint8Array([1, 2, 3])], 'pic.png', { type: 'image/png' })
    const data = new DataObject().Set(MuralDataFormat.Files, [fakeFile] as unknown as FileList)
    // ...construct the same fake receiver+diagram the sibling test uses, capturing
    // diagram._fireExternalDropped into `fired`, dispatch a 'Drop' DragEventArgs
    // at host (30,40) with Zoom=1 and no panel offset, then:
    assert.equal(fired.length, 1)
})
```

If no sibling harness exists, assert on `parseUriList` + a direct unit call to a small extracted `buildExternalArgs(data, position, container)` helper instead — extract that helper from `onDrop` so it is unit-testable without the routed-event machinery, and test it directly.

- [ ] **Step 8: Run Mural tests + typecheck**

Run: `cd Mural && npx tsx --conditions=development --test src/framework/diagram/behaviors/tests/canvas-drop-behavior.external.test.ts && npm run typecheck`
Expected: PASS; no type errors.

- [ ] **Step 9: Bump version, build, republish, commit**

Edit `Mural/package.json` version to `0.36.0`. Then:

```bash
cd Mural
npm run build && npm test && npm run typecheck
git add -A && git commit -m "feat(diagram): ExternalDropped event for OS file/URI drops (0.36.0)"
```

Publish to the local Verdaccio registry per the repo's usual mural release step (the same one used for prior 0.3x bumps).

---

### Task 2: Plexus — media classification

Pure, dependency-free classification of a dropped `File` or URI into a `MediaKind`. Fully unit-testable, no I/O.

**Files:**
- Create: `Plexus/src/renderer/src/modules/diagram/media/media-kind.ts`
- Create: `Plexus/src/renderer/src/modules/diagram/media/classify-media.ts`
- Test: `Plexus/src/renderer/src/modules/diagram/media/tests/classify-media.test.ts`

**Interfaces:**
- Produces:
  - `enum MediaKind { Image = 'image', FileLink = 'file', Hyperlink = 'hyperlink' }`
  - `classifyFile(file: { name: string; type: string }): MediaKind`
  - `classifyUri(uri: string): MediaKind`
  - `isImageExtension(nameOrPath: string): boolean`

- [ ] **Step 1: Write the failing test**

`.../media/tests/classify-media.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { MediaKind } from '../media-kind'
import { classifyFile, classifyUri, isImageExtension } from '../classify-media'

describe('classifyFile', () => {
    it('treats image/* MIME as Image', () => {
        expect(classifyFile({ name: 'a.png', type: 'image/png' })).toBe(MediaKind.Image)
    })
    it('falls back to extension when MIME is empty', () => {
        expect(classifyFile({ name: 'a.WEBP', type: '' })).toBe(MediaKind.Image)
    })
    it('treats non-image files as FileLink', () => {
        expect(classifyFile({ name: 'report.pdf', type: 'application/pdf' })).toBe(MediaKind.FileLink)
    })
})

describe('classifyUri', () => {
    it('treats http(s) as Hyperlink', () => {
        expect(classifyUri('https://example.com/page')).toBe(MediaKind.Hyperlink)
    })
    it('treats a direct image URL as Image', () => {
        expect(classifyUri('https://cdn.example.com/pic.jpg')).toBe(MediaKind.Image)
    })
    it('treats a file:// URI as FileLink', () => {
        expect(classifyUri('file:///C:/docs/x.docx')).toBe(MediaKind.FileLink)
    })
})

describe('isImageExtension', () => {
    it('accepts common raster + svg', () => {
        expect(isImageExtension('x.svg')).toBe(true)
        expect(isImageExtension('x.txt')).toBe(false)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/diagram/media/tests/classify-media.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `media-kind.ts` and `classify-media.ts`**

`media-kind.ts`:

```typescript
// What a dropped payload becomes on the diagram.
export enum MediaKind
{
    Image     = 'image',     // rendered as a picture
    FileLink  = 'file',      // icon/thumbnail + label chip, opens the file
    Hyperlink = 'hyperlink', // favicon/icon + label chip, opens the URL
}
```

`classify-media.ts`:

```typescript
import { MediaKind } from './media-kind'

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'])

export function isImageExtension(nameOrPath: string): boolean
{
    const dot = nameOrPath.lastIndexOf('.')
    if (dot < 0) return false
    return IMAGE_EXTENSIONS.has(nameOrPath.slice(dot + 1).toLowerCase())
}

export function classifyFile(file: { name: string; type: string }): MediaKind
{
    if (file.type.startsWith('image/')) return MediaKind.Image
    if (isImageExtension(file.name))    return MediaKind.Image
    return MediaKind.FileLink
}

export function classifyUri(uri: string): MediaKind
{
    if (isImageExtension(uri)) return MediaKind.Image
    if (/^https?:/i.test(uri)) return MediaKind.Hyperlink
    return MediaKind.FileLink // file:// and anything else opens as a file link
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/diagram/media/tests/classify-media.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd Plexus
git add src/renderer/src/modules/diagram/media/
git commit -m "feat(diagram): media classification (image/file/hyperlink)"
```

---

### Task 3: Plexus — storage policy + `media/` writer

Decides how a dropped file's bytes are stored (inline data-URI / copied into `media/` / linked by original path) and copies bytes when needed. The Embed-vs-Link prompt is an injected async seam so this is fully unit-testable.

**Files:**
- Create: `Plexus/src/renderer/src/modules/diagram/media/media-storage.ts`
- Test: `Plexus/src/renderer/src/modules/diagram/media/tests/media-storage.test.ts`

**Interfaces:**
- Consumes: `MediaKind` (Task 2); `IStorage` (`ReadBytes`/`WriteBytes`/`Exists`/`CreateDirectory` from `services/storage/storage.ts`); `bytesToDataUri`, `mimeForPath` (from `services/markdown/markdown-image.ts`).
- Produces:
  - `const MEDIA_INLINE_LIMIT_BYTES = 1024 * 1024`
  - `enum LargeFileChoice { Embed = 'embed', Link = 'link' }`
  - `interface DroppedPayload { name: string; kind: MediaKind; bytes: Uint8Array; osPath?: string }`
  - `interface ResolvedMediaSource { source: string; label: string }` — `source` is a data-URI, a project-relative `media/...` path, or an original OS/URL path.
  - `interface MediaStorageDeps { storage: IStorage; promptLargeFile: (name: string) => Promise<LargeFileChoice>; mediaDir?: string }`
  - `resolveDroppedFile(payload: DroppedPayload, deps: MediaStorageDeps): Promise<ResolvedMediaSource>`
  - `writeMedia(storage: IStorage, name: string, bytes: Uint8Array, mediaDir?: string): Promise<string>`

- [ ] **Step 1: Write the failing test**

`.../media/tests/media-storage.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { MediaKind } from '../media-kind'
import { LargeFileChoice, MEDIA_INLINE_LIMIT_BYTES, resolveDroppedFile, writeMedia } from '../media-storage'

function fakeStorage() {
    const files = new Map<string, Uint8Array>()
    return {
        files,
        Root: '',
        ReadText: vi.fn(), WriteText: vi.fn(), Delete: vi.fn(), Rename: vi.fn(), List: vi.fn(),
        ReadBytes: vi.fn(async (p: string) => files.get(p)!),
        WriteBytes: vi.fn(async (p: string, b: Uint8Array) => { files.set(p, b) }),
        Exists:     vi.fn(async (p: string) => files.has(p)),
        CreateDirectory: vi.fn(async () => {}),
    }
}

describe('resolveDroppedFile', () => {
    it('inlines a sub-1MB image as a data URI', async () => {
        const storage = fakeStorage()
        const r = await resolveDroppedFile(
            { name: 'a.png', kind: MediaKind.Image, bytes: new Uint8Array([1, 2, 3]) },
            { storage, promptLargeFile: async () => LargeFileChoice.Embed },
        )
        expect(r.source.startsWith('data:image/png;base64,')).toBe(true)
        expect(r.label).toBe('a.png')
        expect(storage.WriteBytes).not.toHaveBeenCalled()
    })

    it('copies a large image into media/ without prompting', async () => {
        const storage = fakeStorage()
        const big = new Uint8Array(MEDIA_INLINE_LIMIT_BYTES + 1)
        const prompt = vi.fn(async () => LargeFileChoice.Link)
        const r = await resolveDroppedFile(
            { name: 'big.png', kind: MediaKind.Image, bytes: big }, { storage, promptLargeFile: prompt },
        )
        expect(r.source).toBe('media/big.png')
        expect(prompt).not.toHaveBeenCalled()   // images never prompt
        expect(storage.WriteBytes).toHaveBeenCalledOnce()
    })

    it('prompts on a large arbitrary file and links when chosen', async () => {
        const storage = fakeStorage()
        const big = new Uint8Array(MEDIA_INLINE_LIMIT_BYTES + 1)
        const r = await resolveDroppedFile(
            { name: 'big.pdf', kind: MediaKind.FileLink, bytes: big, osPath: 'C:/x/big.pdf' },
            { storage, promptLargeFile: async () => LargeFileChoice.Link },
        )
        expect(r.source).toBe('C:/x/big.pdf')
        expect(storage.WriteBytes).not.toHaveBeenCalled()
    })

    it('prompts on a large arbitrary file and embeds when chosen', async () => {
        const storage = fakeStorage()
        const big = new Uint8Array(MEDIA_INLINE_LIMIT_BYTES + 1)
        const r = await resolveDroppedFile(
            { name: 'big.pdf', kind: MediaKind.FileLink, bytes: big, osPath: 'C:/x/big.pdf' },
            { storage, promptLargeFile: async () => LargeFileChoice.Embed },
        )
        expect(r.source).toBe('media/big.pdf')
        expect(storage.WriteBytes).toHaveBeenCalledOnce()
    })
})

describe('writeMedia', () => {
    it('de-duplicates a colliding name', async () => {
        const storage = fakeStorage()
        await writeMedia(storage, 'a.png', new Uint8Array([1]))
        const second = await writeMedia(storage, 'a.png', new Uint8Array([2]))
        expect(second).toBe('media/a-1.png')
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/diagram/media/tests/media-storage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `media-storage.ts`**

```typescript
import type { IStorage } from '../../../services/storage/storage'
import { bytesToDataUri, mimeForPath } from '../../../services/markdown/markdown-image'
import { MediaKind } from './media-kind'

export const MEDIA_INLINE_LIMIT_BYTES = 1024 * 1024

export enum LargeFileChoice { Embed = 'embed', Link = 'link' }

export interface DroppedPayload { name: string; kind: MediaKind; bytes: Uint8Array; osPath?: string }
export interface ResolvedMediaSource { source: string; label: string }
export interface MediaStorageDeps
{
    storage: IStorage
    promptLargeFile: (name: string) => Promise<LargeFileChoice>
    mediaDir?: string
}

const DEFAULT_MEDIA_DIR = 'media'

function splitExt(name: string): { stem: string; ext: string }
{
    const dot = name.lastIndexOf('.')
    return dot < 0 ? { stem: name, ext: '' } : { stem: name.slice(0, dot), ext: name.slice(dot) }
}

// Copy bytes into the project media folder under a collision-free name; returns
// the project-relative path (forward slashes, IStorage's convention).
export async function writeMedia(
    storage: IStorage, name: string, bytes: Uint8Array, mediaDir: string = DEFAULT_MEDIA_DIR,
): Promise<string>
{
    await storage.CreateDirectory(mediaDir)
    const { stem, ext } = splitExt(name)
    let candidate = `${mediaDir}/${stem}${ext}`
    let n = 0
    while (await storage.Exists(candidate)) { n += 1; candidate = `${mediaDir}/${stem}-${n}${ext}` }
    await storage.WriteBytes(candidate, bytes)
    return candidate
}

export async function resolveDroppedFile(
    payload: DroppedPayload, deps: MediaStorageDeps,
): Promise<ResolvedMediaSource>
{
    const { name, kind, bytes, osPath } = payload
    const label = name

    if (bytes.byteLength < MEDIA_INLINE_LIMIT_BYTES)
        return { source: bytesToDataUri(bytes, mimeForPath(name)), label }

    // >= 1 MB. Images always embed; arbitrary files prompt.
    if (kind === MediaKind.Image)
        return { source: await writeMedia(deps.storage, name, bytes, deps.mediaDir), label }

    const choice = await deps.promptLargeFile(name)
    if (choice === LargeFileChoice.Link && osPath !== undefined) return { source: osPath, label }
    return { source: await writeMedia(deps.storage, name, bytes, deps.mediaDir), label }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/diagram/media/tests/media-storage.test.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Commit**

```bash
cd Plexus
git add src/renderer/src/modules/diagram/media/
git commit -m "feat(diagram): media storage policy (inline<1MB / media-folder / link)"
```

---

### Task 4: Plexus — `MediaNodeVM`

The content view-model for a media shape, mirroring `ArchNodeVM`'s DP pattern, with an async loader that resolves `Source` (data-URI / project-relative path / URL) into a `BitmapImage` reusing the markdown-image resolution.

**Files:**
- Create: `Plexus/src/renderer/src/modules/diagram/media/media-node-vm.ts`
- Test: `Plexus/src/renderer/src/modules/diagram/media/tests/media-node-vm.test.ts`

**Interfaces:**
- Consumes: `NodeViewModel`, `MuralBase.RegisterProperty`, `MetaData` (from mural); `MediaKind`; `resolveImageUri` + `decodeSizeInBrowser`-style measure (from `markdown-image`); `BitmapImage`, `Size`.
- Produces `class MediaNodeVM extends NodeViewModel` with DP getters/setters:
  - `MediaKind: MediaKind`, `Source: string | undefined`, `Label: string`, `HyperlinkUri: string | undefined`, `Bitmap: BitmapImage | undefined`
  - `LoadAsync(deps: { storage: IStorage; baseDir?: string; measure?: (uri: string) => Promise<Size | undefined> }): Promise<Size | undefined>` — resolves `Source`, sets `Bitmap`, returns natural size (undefined for non-image kinds or failures).

- [ ] **Step 1: Write the failing test**

`.../media/tests/media-node-vm.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { Size } from '@pragmatic-tech-ai/mural/runtime'
import { MediaKind } from '../media-kind'
import { MediaNodeVM } from '../media-node-vm'

describe('MediaNodeVM', () => {
    it('round-trips DPs', () => {
        const vm = new MediaNodeVM()
        vm.MediaKind = MediaKind.Hyperlink
        vm.Source = 'https://example.com'
        vm.Label = 'Example'
        vm.HyperlinkUri = 'https://example.com'
        expect(vm.MediaKind).toBe(MediaKind.Hyperlink)
        expect(vm.Label).toBe('Example')
    })

    it('LoadAsync sets a BitmapImage for an image source', async () => {
        const vm = new MediaNodeVM()
        vm.MediaKind = MediaKind.Image
        vm.Source = 'data:image/png;base64,AAAA'
        const measure = vi.fn(async () => new Size(64, 48))
        const natural = await vm.LoadAsync({ storage: {} as never, measure })
        expect(natural?.Width).toBe(64)
        expect(vm.Bitmap).toBeDefined()
    })

    it('LoadAsync is a no-op for non-image kinds', async () => {
        const vm = new MediaNodeVM()
        vm.MediaKind = MediaKind.FileLink
        vm.Source = 'C:/x/y.pdf'
        const natural = await vm.LoadAsync({ storage: {} as never })
        expect(natural).toBeUndefined()
        expect(vm.Bitmap).toBeUndefined()
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/diagram/media/tests/media-node-vm.test.ts`
Expected: FAIL — `MediaNodeVM` not found.

- [ ] **Step 3: Implement `media-node-vm.ts`**

Follow `arch-node-vm.ts` (lines 18-95) exactly for the DP idiom. `resolveImageUri` already handles remote/data URIs directly and reads local project-relative paths via `storage.ReadBytes` — reuse it.

```typescript
import { MuralBase, MetaData, Size } from '@pragmatic-tech-ai/mural/runtime'
import { NodeViewModel } from '@pragmatic-tech-ai/mural/framework'
import { BitmapImage } from '@pragmatic-tech-ai/mural/visual-engine'
import type { IStorage } from '../../../services/storage/storage'
import { resolveImageUri } from '../../../services/markdown/markdown-image'
import { MediaKind } from './media-kind'

export interface MediaLoadDeps
{
    storage: IStorage
    baseDir?: string
    measure?: (uri: string) => Promise<Size | undefined>
}

export class MediaNodeVM extends NodeViewModel
{
    static readonly MediaKindKey    = MuralBase.RegisterProperty<MediaKind>(MediaNodeVM, 'MediaKind', MediaKind.Image, MetaData.None)
    static readonly SourceKey       = MuralBase.RegisterProperty<string | undefined>(MediaNodeVM, 'Source', undefined, MetaData.None)
    static readonly LabelKey        = MuralBase.RegisterProperty<string>(MediaNodeVM, 'Label', '', MetaData.None)
    static readonly HyperlinkUriKey = MuralBase.RegisterProperty<string | undefined>(MediaNodeVM, 'HyperlinkUri', undefined, MetaData.None)
    static readonly BitmapKey       = MuralBase.RegisterProperty<BitmapImage | undefined>(MediaNodeVM, 'Bitmap', undefined, MetaData.None)

    get MediaKind(): MediaKind { return this.get_property_value(MediaNodeVM.MediaKindKey) }
    set MediaKind(v: MediaKind) { this.set_property_value(MediaNodeVM.MediaKindKey, v) }
    get Source(): string | undefined { return this.get_property_value(MediaNodeVM.SourceKey) }
    set Source(v: string | undefined) { this.set_property_value(MediaNodeVM.SourceKey, v) }
    get Label(): string { return this.get_property_value(MediaNodeVM.LabelKey) }
    set Label(v: string) { this.set_property_value(MediaNodeVM.LabelKey, v) }
    get HyperlinkUri(): string | undefined { return this.get_property_value(MediaNodeVM.HyperlinkUriKey) }
    set HyperlinkUri(v: string | undefined) { this.set_property_value(MediaNodeVM.HyperlinkUriKey, v) }
    get Bitmap(): BitmapImage | undefined { return this.get_property_value(MediaNodeVM.BitmapKey) }
    set Bitmap(v: BitmapImage | undefined) { this.set_property_value(MediaNodeVM.BitmapKey, v) }

    // Resolve Source → BitmapImage for image nodes; returns decoded natural size.
    async LoadAsync(deps: MediaLoadDeps): Promise<Size | undefined>
    {
        if (this.MediaKind !== MediaKind.Image || this.Source === undefined) return undefined
        const uri = await resolveImageUri(this.Source, { storage: deps.storage, baseDir: deps.baseDir ?? '' })
        if (uri === undefined) return undefined
        const measure = deps.measure ?? decodeSizeInBrowser
        const natural = await measure(uri)
        this.Bitmap = new BitmapImage(uri, natural)
        return natural
    }
}

function decodeSizeInBrowser(uri: string): Promise<Size | undefined>
{
    const Ctor = (globalThis as { Image?: new () => HTMLImageElement }).Image
    if (Ctor === undefined) return Promise.resolve(undefined)
    return new Promise((resolve) => {
        const el = new Ctor()
        el.onload = (): void => resolve(new Size(el.naturalWidth, el.naturalHeight))
        el.onerror = (): void => resolve(undefined)
        el.src = uri
    })
}
```

Confirm the exact import specifiers against `arch-node-vm.ts` (it imports `MuralBase`/`MetaData` and `NodeViewModel` — copy its module paths). If `resolveImageUri`'s context type requires more fields, pass them or widen the call to match its signature in `markdown-image.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/diagram/media/tests/media-node-vm.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd Plexus
git add src/renderer/src/modules/diagram/media/media-node-vm.ts src/renderer/src/modules/diagram/media/tests/media-node-vm.test.ts
git commit -m "feat(diagram): MediaNodeVM with async bitmap resolution"
```

---

### Task 5: Plexus — `media` node serializer

Persists media nodes into the `.diagram` and restores them, mirroring `arch-node-serializer.ts`. Geometry stays in `NodeVisualStore`; this stores only `{ mediaKind, source, hyperlinkUri, label }`.

**Files:**
- Create: `Plexus/src/renderer/src/modules/diagram/media/media-node-serializer.ts`
- Test: `Plexus/src/renderer/src/modules/diagram/media/tests/media-node-serializer.test.ts`

**Interfaces:**
- Consumes: `registerNodeSerializer`, `serializerByType` (same import as `arch-node-serializer.ts`); `MediaNodeVM`; `MediaKind`.
- Produces: `registerMediaNodeSerializer(): void` (idempotent; called at import time), registering `type: 'media'`.

- [ ] **Step 1: Write the failing test**

`.../media/tests/media-node-serializer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { MediaKind } from '../media-kind'
import { MediaNodeVM } from '../media-node-vm'
import { registerMediaNodeSerializer } from '../media-node-serializer'
import { serializerByType } from '../../../architecture-projects/services/arch-node-serializer'

describe('media node serializer', () => {
    it('round-trips a hyperlink media node', () => {
        registerMediaNodeSerializer()
        const ser = serializerByType('media')!
        const vm = new MediaNodeVM()
        vm.MediaKind = MediaKind.Hyperlink
        vm.Source = 'https://example.com'
        vm.HyperlinkUri = 'https://example.com'
        vm.Label = 'Example'

        expect(ser.matches(vm)).toBe(true)
        const data = ser.serialize(vm)
        expect(data).toMatchObject({ mediaKind: 'hyperlink', source: 'https://example.com', label: 'Example' })

        const restored = ser.deserialize(data) as MediaNodeVM
        expect(restored.MediaKind).toBe(MediaKind.Hyperlink)
        expect(restored.Source).toBe('https://example.com')
        expect(restored.Label).toBe('Example')
    })
})
```

Confirm the export name/location of `serializerByType` in `arch-node-serializer.ts`; if it isn't exported, import the registry accessor the arch test uses instead.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/diagram/media/tests/media-node-serializer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `media-node-serializer.ts`**

```typescript
import { registerNodeSerializer, serializerByType } from '../../../architecture-projects/services/arch-node-serializer'
import { MediaKind } from './media-kind'
import { MediaNodeVM } from './media-node-vm'

export function registerMediaNodeSerializer(): void
{
    if (serializerByType('media') !== undefined) return
    registerNodeSerializer({
        type: 'media',
        matches: (n: unknown) => n instanceof MediaNodeVM,
        serialize: (node: unknown): Record<string, unknown> => {
            const vm = node as MediaNodeVM
            return {
                mediaKind:    vm.MediaKind,
                source:       vm.Source ?? '',
                hyperlinkUri: vm.HyperlinkUri ?? '',
                label:        vm.Label,
            }
        },
        deserialize: (data: Record<string, unknown>): MediaNodeVM => {
            const vm = new MediaNodeVM()
            vm.MediaKind    = (data.mediaKind as MediaKind) ?? MediaKind.Image
            vm.Source       = typeof data.source === 'string' && data.source.length > 0 ? data.source : undefined
            vm.HyperlinkUri = typeof data.hyperlinkUri === 'string' && data.hyperlinkUri.length > 0 ? data.hyperlinkUri : undefined
            vm.Label        = typeof data.label === 'string' ? data.label : ''
            return vm
        },
    })
}

registerMediaNodeSerializer()
```

If `registerNodeSerializer`/`serializerByType` live in a different module than `arch-node-serializer.ts` (e.g. a mural framework export), import them from there — match `arch-node-serializer.ts`'s own import line.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/diagram/media/tests/media-node-serializer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd Plexus
git add src/renderer/src/modules/diagram/media/media-node-serializer.ts src/renderer/src/modules/diagram/media/tests/media-node-serializer.test.ts
git commit -m "feat(diagram): media node serializer (type=media)"
```

---

### Task 6: Plexus — DataTemplate + `MediaLinkRenderMode` setting

The visual for a `MediaNodeVM` (image vs chip) as a `.mu` `DataTemplate`, plus a diagram setting controlling how link/file chips render.

**Files:**
- Modify: `Plexus/src/renderer/src/modules/diagram/diagram.resources.mu` (append a `DataTemplate [DataType = MediaNodeVM]`)
- Modify: `Plexus/src/renderer/src/modules/diagram/diagram.module.mu` (add `SettingDefinition` in `.settings:`, lines ~32-88)
- Create: `Plexus/src/renderer/src/modules/diagram/media/media-link-render-mode.ts`
- Test: `Plexus/src/renderer/src/modules/diagram/media/tests/media-link-render-mode.test.ts`

**Interfaces:**
- Produces:
  - `enum MediaLinkRenderMode { IconLabel = 'icon-label', ThumbnailLabel = 'thumbnail-label', PlainLink = 'plain-link' }`
  - `const MEDIA_LINK_RENDER_MODE_SETTING = 'diagram.media.linkRenderMode'`
  - `readMediaLinkRenderMode(get: (key: string) => unknown): MediaLinkRenderMode` (default `ThumbnailLabel`)
- Template contract: binds `Image.Source = $Bitmap`, `TextBlock.Text = $Label`; `when ($MediaKind = 'image')` shows the image, otherwise shows the chip.

- [ ] **Step 1: Write the failing test**

`.../media/tests/media-link-render-mode.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { MediaLinkRenderMode, MEDIA_LINK_RENDER_MODE_SETTING, readMediaLinkRenderMode } from '../media-link-render-mode'

describe('readMediaLinkRenderMode', () => {
    it('defaults to ThumbnailLabel when unset', () => {
        expect(readMediaLinkRenderMode(() => undefined)).toBe(MediaLinkRenderMode.ThumbnailLabel)
    })
    it('reads a stored value', () => {
        const get = (k: string) => (k === MEDIA_LINK_RENDER_MODE_SETTING ? 'plain-link' : undefined)
        expect(readMediaLinkRenderMode(get)).toBe(MediaLinkRenderMode.PlainLink)
    })
    it('falls back to default on an unknown value', () => {
        expect(readMediaLinkRenderMode(() => 'bogus')).toBe(MediaLinkRenderMode.ThumbnailLabel)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/diagram/media/tests/media-link-render-mode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `media-link-render-mode.ts`**

```typescript
export enum MediaLinkRenderMode
{
    IconLabel      = 'icon-label',
    ThumbnailLabel = 'thumbnail-label',
    PlainLink      = 'plain-link',
}

export const MEDIA_LINK_RENDER_MODE_SETTING = 'diagram.media.linkRenderMode'

const VALUES = new Set<string>(Object.values(MediaLinkRenderMode))

export function readMediaLinkRenderMode(get: (key: string) => unknown): MediaLinkRenderMode
{
    const raw = get(MEDIA_LINK_RENDER_MODE_SETTING)
    return typeof raw === 'string' && VALUES.has(raw)
        ? (raw as MediaLinkRenderMode)
        : MediaLinkRenderMode.ThumbnailLabel
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/diagram/media/tests/media-link-render-mode.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the setting definition**

In `diagram.module.mu`, inside `.settings:` (after the `toolbox.item.height` block ~line 88), add:

```
SettingDefinition
    [ Key = "diagram.media.linkRenderMode",
      Label = "Media link display",
      Description = "How dropped files and hyperlinks are shown on the diagram.",
      Kind = Enum,
      Default = "thumbnail-label",
      Options = ["icon-label", "thumbnail-label", "plain-link"],
      Category = "Diagram" ]
```

If `Kind = Enum` with `Options` isn't supported by the settings compiler, use `Kind = String` with the same `Default` (the reader in Step 3 validates the value). Confirm against the existing `SettingDefinition` grammar in `diagram.module.mu`.

- [ ] **Step 6: Add the DataTemplate**

Append to `diagram.resources.mu` (after the `ArchNodeVM` template, ~line 485). Follow that template's structure; do NOT hardcode width/height (size flows from `NodeVisualStore`).

```
DataTemplate [DataType = MediaNodeVM] {
    Grid x:name="PART_MediaRoot" {
        Image x:name="PART_Image"
            [ Source = $Bitmap,
              Stretch = Stretch.Uniform,
              Visibility = Collapsed ]
        StackPanel x:name="PART_Chip"
            [ Orientation = Horizontal,
              VerticalAlignment = Center,
              Visibility = Collapsed ] {
            ToolboxVisualPresenter x:name="PART_ChipIcon"
                [ Context = VisualContext.Figure, Width = 24, Height = 24 ]
            TextBlock x:name="PART_ChipLabel"
                [ Text = $Label,
                  Style = @BodySmall,
                  Foreground = @OnSurface,
                  TextWrapping = Wrap,
                  MaxWidth = 160,
                  Margin = (6,0,0,0),
                  MeasurementFidelity = Exact ]
        }
    }
    when ( $MediaKind = 'image' ) { PART_Image.Visibility = Visible; }
    when ( $MediaKind = 'file' )  { PART_Chip.Visibility = Visible; }
    when ( $MediaKind = 'hyperlink' ) { PART_Chip.Visibility = Visible; }
}
```

The `ToolboxVisualPresenter`/`@BodySmall`/`@OnSurface`/`VisualContext.Figure` references mirror the `ArchNodeVM` template — copy the exact tokens it uses. The 24px chip icon and 6px gap are chip chrome, not node sizing, so they're allowed. If a distinct file-type glyph per extension is wanted, that's a follow-up; v1 shows a single generic media glyph.

**Error-handling fallback (spec requirement).** When an image node fails to resolve (`Bitmap` stays unset — unreadable file, dead URL, decode failure), the image slot would be blank. Add a fallback so the node is never invisible: show the chip (icon + `$Label`) whenever an image has no bitmap. Add a trigger:

```
when ( $MediaKind = 'image' && $Bitmap is not set ) { PART_Image.Visibility = Collapsed; PART_Chip.Visibility = Visible; }
```

Confirm mural's trigger grammar supports the compound `&&` / `is not set` (the arch template uses single-condition `when ( $X is set )`). If compound conditions aren't supported, express it as a small derived DP on `MediaNodeVM` — e.g. `ShowChip: boolean` set true for non-image kinds and for image kinds whose `LoadAsync` returned undefined — and trigger on `when ( $ShowChip = true )`. A hover tooltip stating the failure reason (`ToolTip = $Label` at minimum) is the graceful-degradation baseline; a specific reason string is a follow-up.

- [ ] **Step 7: Compile templates + typecheck + commit**

Run: `cd Plexus && npm run compile:mu && npm run typecheck && npx vitest run src/renderer/src/modules/diagram/media/tests/media-link-render-mode.test.ts`
Expected: `.mu` compiles with no errors; types pass; test passes.

```bash
git add src/renderer/src/modules/diagram/diagram.resources.mu src/renderer/src/modules/diagram/diagram.module.mu src/renderer/src/modules/diagram/media/media-link-render-mode.ts src/renderer/src/modules/diagram/media/tests/media-link-render-mode.test.ts
git commit -m "feat(diagram): MediaNodeVM template + media link render-mode setting"
```

---

### Task 7: Plexus — `MediaDropHandler` wiring (ExternalDropped → node) + open-on-double-click

Ties Tasks 2-6 to the live diagram: subscribe to Mural's `ExternalDropped`, build a payload from each `File`/URI, resolve source + kind, create a `MediaNodeVM`, position it via `doc.SetNodeVisual`, and load its bitmap. Also wires double-click to open the target, and a document-open pass that reloads bitmaps for restored nodes.

**Files:**
- Create: `Plexus/src/renderer/src/modules/diagram/media/media-drop-handler.ts`
- Modify: the diagram binding/attach site that already calls `attachCanvasDropBehavior` / owns `(diagram, doc, storage)` — locate via `attachCanvasDropBehavior(` and the arch binding service (`arch-diagram-binding-service.ts`, constructor ~line 37). Add an `attachMediaDrop(...)` call there and a bitmap-reload pass after document load.
- Test: `Plexus/src/renderer/src/modules/diagram/media/tests/media-drop-handler.test.ts`

**Interfaces:**
- Consumes: `Diagram.AddExternalDroppedListener`/`ExternalDroppedArgs` (Task 1); `classifyFile`/`classifyUri` (Task 2); `resolveDroppedFile`/`LargeFileChoice` (Task 3); `MediaNodeVM` (Task 4); `IStorage`; `doc.SetNodeVisual`, `doc.AddNode` / `mutator.AddNode`.
- Produces:
  - `interface MediaDropDeps { storage: IStorage; promptLargeFile: (name: string) => Promise<LargeFileChoice>; openExternal: (target: string) => Promise<void>; newId: () => string }`
  - `buildMediaNode(item: DroppedItem, deps): Promise<{ vm: MediaNodeVM; natural?: Size }>` where `DroppedItem` is `{ file?: File; uri?: string }`
  - `attachMediaDrop(diagram: Diagram, doc: DiagramDocument, deps: MediaDropDeps): () => void`
  - `reloadMediaBitmaps(doc: DiagramDocument, storage: IStorage): Promise<void>`

- [ ] **Step 1: Write the failing test** (pure `buildMediaNode`, no live diagram)

`.../media/tests/media-drop-handler.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { MediaKind } from '../media-kind'
import { LargeFileChoice } from '../media-storage'
import { buildMediaNode } from '../media-drop-handler'

function deps() {
    const files = new Map<string, Uint8Array>()
    const storage = {
        Root: '', ReadText: vi.fn(), WriteText: vi.fn(), Delete: vi.fn(), Rename: vi.fn(), List: vi.fn(),
        ReadBytes: vi.fn(async (p: string) => files.get(p)!),
        WriteBytes: vi.fn(async (p: string, b: Uint8Array) => { files.set(p, b) }),
        Exists: vi.fn(async (p: string) => files.has(p)),
        CreateDirectory: vi.fn(async () => {}),
    }
    return {
        storage: storage as never,
        promptLargeFile: async () => LargeFileChoice.Embed,
        openExternal: vi.fn(async () => {}),
        newId: () => 'id-1',
    }
}

describe('buildMediaNode', () => {
    it('builds an Image node from a small image File', async () => {
        const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })
        // Provide a measure via a stubbed global Image or inject through deps if buildMediaNode supports it.
        const { vm } = await buildMediaNode({ file }, deps())
        expect(vm.MediaKind).toBe(MediaKind.Image)
        expect(vm.Source?.startsWith('data:image/png')).toBe(true)
        expect(vm.Id).toBe('id-1')
    })

    it('builds a Hyperlink node from a URI', async () => {
        const { vm } = await buildMediaNode({ uri: 'https://example.com' }, deps())
        expect(vm.MediaKind).toBe(MediaKind.Hyperlink)
        expect(vm.HyperlinkUri).toBe('https://example.com')
        expect(vm.Source).toBe('https://example.com')
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/diagram/media/tests/media-drop-handler.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `media-drop-handler.ts`**

```typescript
import type { Diagram, DiagramDocument, ExternalDroppedArgs } from '@pragmatic-tech-ai/mural/framework'
import { Size } from '@pragmatic-tech-ai/mural/runtime'
import type { IStorage } from '../../../services/storage/storage'
import { classifyFile, classifyUri } from './classify-media'
import { MediaKind } from './media-kind'
import { LargeFileChoice, resolveDroppedFile } from './media-storage'
import { MediaNodeVM } from './media-node-vm'

export interface MediaDropDeps
{
    storage: IStorage
    promptLargeFile: (name: string) => Promise<LargeFileChoice>
    openExternal: (target: string) => Promise<void>
    newId: () => string
    measure?: (uri: string) => Promise<Size | undefined>
}

export interface DroppedItem { file?: File; uri?: string }

const IMAGE_DEFAULT = new Size(160, 120)

export async function buildMediaNode(
    item: DroppedItem, deps: MediaDropDeps,
): Promise<{ vm: MediaNodeVM; natural?: Size }>
{
    const vm = new MediaNodeVM()
    vm.Id = deps.newId()

    if (item.file !== undefined) {
        const file = item.file
        const kind = classifyFile(file)
        const bytes = new Uint8Array(await file.arrayBuffer())
        // Electron's File carries a non-standard absolute .path; used for Link mode.
        const osPath = (file as unknown as { path?: string }).path
        const resolved = await resolveDroppedFile({ name: file.name, kind, bytes, osPath }, deps)
        vm.MediaKind = kind
        vm.Source = resolved.source
        vm.Label = resolved.label
        if (kind !== MediaKind.Image && osPath !== undefined) vm.HyperlinkUri = osPath
    } else {
        const uri = item.uri as string
        const kind = classifyUri(uri)
        vm.MediaKind = kind
        vm.Source = uri
        vm.Label = uri
        vm.HyperlinkUri = uri
    }

    const natural = await vm.LoadAsync({ storage: deps.storage, baseDir: '', measure: deps.measure })
    return { vm, natural }
}

export function attachMediaDrop(diagram: Diagram, doc: DiagramDocument, deps: MediaDropDeps): () => void
{
    const onExternal = (args: ExternalDroppedArgs): void => {
        void (async () => {
            const items: DroppedItem[] = [
                ...args.Files.map((file) => ({ file })),
                ...args.Uris.map((uri) => ({ uri })),
            ]
            let offset = 0
            for (const item of items) {
                const { vm, natural } = await buildMediaNode(item, deps)
                const size = natural ?? IMAGE_DEFAULT
                doc.SetNodeVisual(vm.Id as string, {
                    left: args.Position.X + offset,
                    top:  args.Position.Y + offset,
                    w:    size.Width,
                    h:    vm.MediaKind === MediaKind.Image ? size.Height : 40,
                })
                doc.AddNode(vm)
                offset += 16
            }
        })()
    }
    diagram.AddExternalDroppedListener(onExternal)
    return (): void => diagram.RemoveExternalDroppedListener(onExternal)
}

// Restore BitmapImages for media nodes after a document is loaded from disk.
export async function reloadMediaBitmaps(doc: DiagramDocument, storage: IStorage): Promise<void>
{
    for (const node of doc.Nodes) {
        if (node instanceof MediaNodeVM) await node.LoadAsync({ storage, baseDir: '' })
    }
}
```

Match the mural import specifiers (`Diagram`, `DiagramDocument`, `ExternalDroppedArgs`, `Size`) to how sibling Plexus files import them. Confirm `doc.AddNode` exists (survey shows `DiagramDocument.AddNode` at diagram-document.ts ~769); if the binding site uses a `DiagramMutator`, thread the mutator in and call `mutator.AddNode` instead. Confirm `SetNodeVisual`'s field names (`left/top/w/h`) against `NodeVisual` in `node-visual-store.d.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/diagram/media/tests/media-drop-handler.test.ts`
Expected: PASS. (If `LoadAsync` needs a browser `Image`, pass a `measure` stub through `deps` in the test — extend `buildMediaNode` to forward `deps.measure`, already wired above.)

- [ ] **Step 5: Wire into the diagram attach site**

At the site that constructs the diagram binding and calls `attachCanvasDropBehavior` (found via grep), add:

```typescript
import { attachMediaDrop, reloadMediaBitmaps } from './media/media-drop-handler'
import { registerMediaNodeSerializer } from './media/media-node-serializer'
import { LargeFileChoice } from './media/media-storage'
```

- Ensure `registerMediaNodeSerializer()` runs (import side-effect already calls it; add an explicit call in the module setup next to `registerArchNodeSerializer()` for clarity).
- After the document is loaded, call `void reloadMediaBitmaps(doc, storage)`.
- Attach the handler:

```typescript
const detachMedia = attachMediaDrop(diagram, doc, {
    storage,
    promptLargeFile: async (name) => LargeFileChoice.Embed, // Task 9 replaces with the real modal
    openExternal: async (target) => {
        if (/^https?:/i.test(target)) { window.open(target, '_blank') }   // → setWindowOpenHandler → shell.openExternal
        else { await window.api.fs.openExternal(target) }                 // shell.openPath for local files/paths
    },
    newId: () => `media-${crypto.randomUUID()}`,
})
```

Add `detachMedia()` to the same teardown that removes `attachCanvasDropBehavior`. Confirm the preload bridge accessor name for `openExternal` (survey: `IFileSystemApi.openExternal` → `FileSystemChannel.OpenExternal`) and how `storage` is obtained at this site (same source the arch binding uses).

- [ ] **Step 6: Wire double-click to open**

Media nodes open their target on double-click. Follow the ArchNodeVM interaction pattern (its title-edit uses a behavior + double-click; check `ArchTitleEditBehavior` wiring in `diagram.resources.mu`). Add a `MediaOpenBehavior` attached in the `MediaNodeVM` template's `.Behaviors:` that, on double-click, invokes the handler's `openExternal` with `HyperlinkUri ?? Source`. If a behavior needs a service handle, resolve `openExternal` through the same DI the other behaviors use. Keep this minimal — a thin behavior calling one function.

- [ ] **Step 7: Compile, typecheck, test, commit**

Run: `cd Plexus && npm run compile:mu && npm run typecheck && npx vitest run src/renderer/src/modules/diagram/media/`
Expected: all green.

```bash
git add src/renderer/src/modules/diagram/
git commit -m "feat(diagram): media drop handler + open-on-double-click + reload on open"
```

---

### Task 8: Plexus — clipboard paste (Ctrl+V image)

Route a pasted image through the same `buildMediaNode` path so screenshots land on the diagram.

**Files:**
- Modify: `media-drop-handler.ts` (add `attachMediaPaste`)
- Modify: the diagram attach site (call `attachMediaPaste`, add to teardown)
- Test: `Plexus/src/renderer/src/modules/diagram/media/tests/media-paste.test.ts`

**Interfaces:**
- Produces: `pasteItemsFromClipboard(data: DataTransfer): DroppedItem[]` (extract image `File`s from `clipboardData.items`); `attachMediaPaste(host: HTMLElement, diagram: Diagram, doc: DiagramDocument, deps: MediaDropDeps): () => void`.

- [ ] **Step 1: Write the failing test**

`.../media/tests/media-paste.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { pasteItemsFromClipboard } from '../media-drop-handler'

function clipboardWith(file: File): DataTransfer {
    return {
        items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
    } as unknown as DataTransfer
}

describe('pasteItemsFromClipboard', () => {
    it('extracts an image file from clipboard items', () => {
        const file = new File([new Uint8Array([1])], 'pasted.png', { type: 'image/png' })
        const items = pasteItemsFromClipboard(clipboardWith(file))
        expect(items).toHaveLength(1)
        expect(items[0].file?.name).toBe('pasted.png')
    })
    it('ignores non-file clipboard entries', () => {
        const dt = { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] } as unknown as DataTransfer
        expect(pasteItemsFromClipboard(dt)).toHaveLength(0)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/diagram/media/tests/media-paste.test.ts`
Expected: FAIL — `pasteItemsFromClipboard` not exported.

- [ ] **Step 3: Implement paste extraction + attach**

Add to `media-drop-handler.ts`:

```typescript
export function pasteItemsFromClipboard(data: DataTransfer): DroppedItem[]
{
    const out: DroppedItem[] = []
    const items = data.items
    for (let i = 0; i < items.length; i++) {
        const it = items[i]
        if (it.kind === 'file') {
            const file = it.getAsFile()
            if (file !== null) out.push({ file })
        }
    }
    return out
}

export function attachMediaPaste(
    host: HTMLElement, diagram: Diagram, doc: DiagramDocument, deps: MediaDropDeps,
): () => void
{
    const onPaste = (e: ClipboardEvent): void => {
        if (e.clipboardData === null) return
        const items = pasteItemsFromClipboard(e.clipboardData)
        if (items.length === 0) return
        e.preventDefault()
        // Place at the diagram's current view centre; reuse the same node-build path.
        void (async () => {
            const center = diagram.HostToContent(host.clientWidth / 2, host.clientHeight / 2)
            let offset = 0
            for (const item of items) {
                const { vm, natural } = await buildMediaNode(item, deps)
                const size = natural ?? IMAGE_DEFAULT
                doc.SetNodeVisual(vm.Id as string, { left: center.X + offset, top: center.Y + offset, w: size.Width, h: size.Height })
                doc.AddNode(vm)
                offset += 16
            }
        })()
    }
    host.addEventListener('paste', onPaste)
    return (): void => host.removeEventListener('paste', onPaste)
}
```

Only wire paste when the diagram/host has focus so it doesn't hijack paste elsewhere — attach to the diagram host element (the same `receiver`/host `attachCanvasDropBehavior` uses), not `document`. Confirm `diagram.HostToContent` is accessible from this site.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/diagram/media/tests/media-paste.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire + commit**

Call `attachMediaPaste(host, diagram, doc, deps)` at the attach site; add its disposer to teardown.

```bash
cd Plexus && npm run typecheck && npx vitest run src/renderer/src/modules/diagram/media/
git add src/renderer/src/modules/diagram/
git commit -m "feat(diagram): paste image from clipboard onto diagram"
```

---

### Task 9: Plexus — large-file Embed/Link modal

Replace the temporary `promptLargeFile: async () => Embed` stub with a real modal, reusing the existing drop-into-container modal component.

**Files:**
- Create: `Plexus/src/renderer/src/modules/diagram/media/prompt-large-file.ts`
- Modify: the attach site (use the real prompt)
- Reference: the existing container-drop modal (locate via grep for the drop-into-container modal from prior work) for the show-modal API.

**Interfaces:**
- Produces: `makeLargeFilePrompt(showModal: <T>(spec: ModalSpec<T>) => Promise<T>): (name: string) => Promise<LargeFileChoice>` — a factory taking the app's modal service so it stays unit-testable.

- [ ] **Step 1: Locate the modal API**

Read the container-drop modal implementation (the one that asks which container to drop into) to learn the exact `showModal`/dialog service signature and how a choice is returned. Note the service key and the spec shape.

- [ ] **Step 2: Write the failing test**

`.../media/tests/prompt-large-file.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { LargeFileChoice } from '../media-storage'
import { makeLargeFilePrompt } from '../prompt-large-file'

describe('makeLargeFilePrompt', () => {
    it('maps the modal Embed choice to LargeFileChoice.Embed', async () => {
        const showModal = vi.fn(async () => LargeFileChoice.Embed)
        const prompt = makeLargeFilePrompt(showModal as never)
        expect(await prompt('big.pdf')).toBe(LargeFileChoice.Embed)
        expect(showModal).toHaveBeenCalledOnce()
    })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/diagram/media/tests/prompt-large-file.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `prompt-large-file.ts`**

Model the `ModalSpec` on whatever the container-drop modal uses (title, message, two actions). Two buttons: "Embed in project" → `LargeFileChoice.Embed`; "Link to file" → `LargeFileChoice.Link`. Keep the concrete `ModalSpec` shape identical to the existing modal so no new modal infra is added.

```typescript
import { LargeFileChoice } from './media-storage'

// The modal service seam — matched to the existing container-drop modal's API
// in Step 1 (adjust field names to the real ModalSpec discovered there).
export interface ModalAction<T> { label: string; value: T }
export interface ModalSpec<T> { title: string; message: string; actions: ModalAction<T>[] }
export type ShowModal = <T>(spec: ModalSpec<T>) => Promise<T>

export function makeLargeFilePrompt(showModal: ShowModal): (name: string) => Promise<LargeFileChoice>
{
    return (name: string) => showModal<LargeFileChoice>({
        title: 'Large file',
        message: `"${name}" is over 1 MB. Embed a copy in the project, or link to the original file?`,
        actions: [
            { label: 'Embed in project', value: LargeFileChoice.Embed },
            { label: 'Link to file',     value: LargeFileChoice.Link },
        ],
    })
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/diagram/media/tests/prompt-large-file.test.ts`
Expected: PASS.

- [ ] **Step 6: Use the real prompt at the attach site**

Resolve the app's modal service (same key the container-drop modal uses) and pass `promptLargeFile: makeLargeFilePrompt(showModal)` into `attachMediaDrop`/`attachMediaPaste`, replacing the `async () => Embed` stub.

- [ ] **Step 7: Compile, typecheck, test, commit**

Run: `cd Plexus && npm run compile:mu && npm run typecheck && npx vitest run src/renderer/src/modules/diagram/media/`
Expected: all green.

```bash
git add src/renderer/src/modules/diagram/
git commit -m "feat(diagram): large-file Embed/Link modal for media drop"
```

---

### Task 10: Live e2e — drop, persist, reopen

End-to-end proof against the real Electron app using the existing Playwright/`_electron` harness (per prior diagram e2e work: strip `ELECTRON_RUN_AS_NODE`, drive against a corpus COPY).

**Files:**
- Create: `Plexus/e2e/media-drop.spec.ts` (match the existing e2e directory + harness — locate a current `*.spec.ts` under the e2e/playwright setup and copy its bootstrap).

**Interfaces:**
- Consumes: the app's diagram surface; a temp project corpus copy; a small sample PNG fixture generated in-test.

- [ ] **Step 1: Write the e2e spec**

Mirror the existing diagram e2e bootstrap (electron launch, open a project, open a diagram). Then:

```typescript
// Pseudocode shape — adapt selectors/bootstrap to the existing harness.
import { test, expect } from '@playwright/test'
// ...launch electron, open a diagram document...

test('drop an image file creates a persisted media node', async () => {
    // 1. Synthesize a DataTransfer with a small PNG File and dispatch drop on the diagram host:
    //    await page.evaluate(...) building a File from a base64 PNG and dispatching
    //    dragenter/dragover/drop DragEvents with dataTransfer.files set.
    // 2. Assert a MediaNodeVM visual appears (query the diagram's visual back-ref:
    //    Symbol.for('mural:visual-backref'), per the live-debug memory).
    // 3. Save the document, reopen it, assert the media node still renders (Bitmap resolved).
})
```

- [ ] **Step 2: Run the e2e**

Run: `cd Plexus && npm run test:e2e -- media-drop`
Expected: PASS — node appears on drop and survives save/reopen.

- [ ] **Step 3: Commit**

```bash
cd Plexus
git add e2e/media-drop.spec.ts
git commit -m "test(e2e): media drop creates and persists a diagram node"
```

---

## Integration checklist (after Task 10)

- [ ] Mural `0.36.0` published to local registry; Plexus `package.json` dep updated to `^0.36.0` and reinstalled.
- [ ] `npm run compile:mu` clean; `npm run typecheck` clean; `npm test` green in both repos.
- [ ] Manual smoke: drop a PNG (renders), a large PDF (prompt → Embed writes `media/`, Link keeps path), a URL from a browser (chip, opens on double-click), paste a screenshot (renders). Save + reopen each.

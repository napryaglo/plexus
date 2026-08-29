# Diagram Media Drop — Design

**Date:** 2026-08-28
**Status:** Approved (design); ready for implementation planning
**Scope:** Mural (`@pragmatic-lab/mural`) + Plexus renderer

## Goal

Visio/PowerPoint-style drag-and-drop: the user drags a file, image, or
hyperlink from the OS (or pastes an image from the clipboard) onto the
diagram, and it is placed as a shape. Images render as pictures;
files/hyperlinks render as a thumbnail+label chip that opens the target
on double-click.

## Requirements (confirmed with user)

- **Content types (v1):** image files, arbitrary files (PDF/docx/…),
  hyperlinks/URLs, and pasted (clipboard) images.
- **Image storage:** embedded (self-contained within the project).
- **Storage policy (hybrid, 1 MB threshold):**
  - Icons and files **< 1 MB** → base64-inlined into the node
    serializer record.
  - Images **≥ 1 MB** → always embedded, copied into a project `media/`
    folder and referenced by project-relative path (no Link option).
  - **Arbitrary** files **≥ 1 MB** → the user is prompted **Embed**
    (copy into `media/`) vs **Link** (reference the original OS
    location, no copy).
- **Link/file render mode:** a `DiagramSettings` entry, default
  **thumbnail + label**.
- **Layering:** extend Mural to surface OS drops (Option A), rather than
  a Plexus-only DOM listener.

## Non-goals (v1)

- Generating real preview thumbnails for PDFs or web pages. The
  chip shows a generic file-type icon / favicon; `ThumbnailLabel`
  degrades to that until thumbnail generation is added. Tracked as a
  follow-up.
- Editing/cropping embedded images.
- Re-linking / relocating a source file whose original path moved (a
  Link-mode node with a dead path shows a placeholder + reason).

## Architecture

### Layer split

Mural owns the drop lifecycle, coordinate mapping (host→content /
zoom), and container hit-testing — it already does this for toolbox
drops. It gains the ability to recognize OS drops and surface them as a
generic event. Plexus owns classification, storage policy, the media
node type, and rendering. This matches every existing drop path in the
codebase and keeps re-implementation of coordinate/container logic out
of Plexus.

### Components

**Mural — `canvas-drop-behavior`**
- On `dragover`: if the `DataTransfer` advertises `Files` or a
  `text/uri-list` type, treat as an external drag and permit the drop
  (set the drop effect) alongside the existing toolbox-item handling.
- On `drop`: package the payload — for files, `{ name, mimeType,
  getBytes() }`; for URIs, the parsed `text/uri-list` entries — compute
  the content-space `Position` and `TargetContainer` using the existing
  logic, and raise a new **`ExternalDropped`** event on `Diagram` with
  `{ Files, Uris, Position, TargetContainer }`.
- The existing `mural/toolbox-item` path is unchanged; external
  detection is additive.

**Plexus — `MediaDropHandler`**
- Subscribes to `Diagram.ExternalDropped`.
- Classifies each payload item into a `MediaKind` (see Detection).
- Applies the storage policy (inline / media-copy / link, with the
  large-file dialog for ≥ 1 MB).
- Creates a `MediaNodeVM`, adds it to the document, and sets geometry
  via `doc.SetNodeVisual(id, { left, top, w, h })` using the drop
  `Position` (and natural image size where known).

**Plexus — `MediaNodeVM` (`NodeViewModel`)**
- DPs: `MediaKind` (Image | FileLink | Hyperlink), `Source`
  (data-URI | project-relative path | URL), `Label`, `HyperlinkUri`,
  `NaturalSize`.
- Rendered through a `DataTemplate` (no new rendering primitive):
  - Image kind → a mural `Image` control bound to a `BitmapImage`
    resolved from `Source`.
  - FileLink / Hyperlink → a chip: thumbnail/type-icon + label, laid
    out per the `MediaLinkRenderMode` setting.
- Double-click → open: `shell.openExternal(url)` for `http(s)` URLs;
  open-file IPC for project/OS paths.

**Plexus — `media-node-serializer`**
- `registerNodeSerializer('media', …)`.
- `serialize(vm)` → `{ mediaKind, source, hyperlinkUri, label }`.
- `deserialize(data)` → `MediaNodeVM`, resolving `Source` to a
  `BitmapImage` and decoding natural size on load.
- Geometry is **not** stored here — it lives in `NodeVisualStore` like
  every other node.

**Plexus — media asset service**
- `writeMedia(bytes, name) → projectRelativePath` (copies into the
  project `media/` folder, de-duplicating names).
- Load-time resolution of a project-relative path or URL to a data-URI /
  `BitmapImage`, reusing the existing `markdown-image.ts` resolution
  (`IStorage.ReadBytes`, MIME sniffing, natural-size decode).

### Storage policy detail

```
on each dropped file:
  bytes = read file
  if size < 1 MB:
      Source = base64 data-URI (inline in record)   # icons + small files always embed
  else:  # size >= 1 MB
      if kind == Image:
          Source = writeMedia(bytes, name)           # images always embed; large → media/
      else:  # large arbitrary file
          dialog: Embed | Link
            Embed → Source = writeMedia(bytes, name)  # copy into media/
            Link  → Source = original OS path (MediaKind = FileLink), no copy
```

Images always embed (inline < 1 MB, else copied into `media/`) — no
Link option, per the confirmed requirement. Only large **arbitrary**
files get the Embed/Link prompt. Icons and all sub-1 MB payloads inline.
This keeps the `.diagram` JSON small in the common case and the project
portable as a folder for large embedded assets.

### Detection rules

- Image bytes / MIME `image/*` (from files **or** clipboard) → **Image**.
- `text/uri-list` or a dragged link with `http(s)` → **Hyperlink**
  (favicon + title chip). If the URL is a direct image resource, treat
  as **Image**.
- Any other file → **FileLink** (file-type icon + filename chip).
- Clipboard paste (`Ctrl+V`) routes through the same handler via a paste
  listener on the diagram host, producing an Image (or FileLink for
  non-image clipboard content where available).

## Data flow

```
OS drop / paste
  → Mural canvas-drop-behavior raises ExternalDropped
      { Files, Uris, Position, TargetContainer }
  → Plexus MediaDropHandler
      → classify → MediaKind
      → storage policy (inline <1MB | Embed→media/ | Link)
      → new MediaNodeVM + doc.SetNodeVisual(position/size)
  → rendered via DataTemplate (BitmapImage or chip)

Save:  media-node-serializer writes { mediaKind, source, hyperlinkUri, label }
       + NodeVisualStore writes geometry
Open:  deserialize → resolve Source → BitmapImage, decode natural size
```

## Settings

- `DiagramSettings.MediaLinkRenderMode`: `IconLabel | ThumbnailLabel |
  PlainLink`, default **ThumbnailLabel**. Controls how FileLink /
  Hyperlink nodes render (Image nodes ignore it).

## Error handling

- Unreadable file, dead URL, or oversize/failed decode → the node is
  still created with a placeholder visual and a tooltip stating the
  reason. Never silently drop a payload.
- Link-mode node whose original path no longer resolves → placeholder +
  "source not found" tooltip; the node remains so the user can re-link
  later (re-link UI is a follow-up).

## Testing

- **Unit (Plexus):** classification rules; storage-policy threshold
  boundary (just under / at / over 1 MB); `media-node-serializer`
  round-trip (all three `MediaKind`s, inline + media-path + link
  sources); path/URL → data-URI resolution.
- **Unit (Mural):** `ExternalDropped` fires with correct `Position` and
  `TargetContainer` from a synthetic `DataTransfer` carrying files and a
  `text/uri-list`; toolbox-item drops still behave unchanged.
- **Live e2e (Playwright/Electron harness):** drop an image file → node
  appears at the cursor; save + reopen → node persists and re-renders;
  drop a large file → dialog appears and Embed writes into `media/`.

## Extension points touched (from codebase survey)

| Concern | File | Change |
|---|---|---|
| OS drop surfacing | Mural `framework/diagram/behaviors/canvas-drop-behavior` | detect Files/uri-list; raise `ExternalDropped` |
| Drop event | Mural `framework/diagram/diagram` | new `ExternalDropped` event |
| Drop consumer | Plexus `modules/diagram/services/media-drop-handler` (new) | classify + place |
| Node type | Plexus `modules/diagram/services/media-node-vm` (new) | `NodeViewModel` subtype + DPs |
| Node template | Plexus diagram templates | Image + chip `DataTemplate` |
| Serializer | Plexus `modules/diagram/services/media-node-serializer` (new) | `registerNodeSerializer('media')` |
| Asset copy/resolve | Plexus media asset service (new) + reuse `services/markdown/markdown-image` | write to `media/`, resolve to data-URI |
| Settings | Plexus `DiagramSettings` | `MediaLinkRenderMode` |
| File I/O | Plexus `main/filesystem` + `IStorage` | read dropped bytes, `shell.openExternal` |

## Open items for the plan

- Exact `ExternalDropped` payload type and where the file-bytes read
  happens (renderer `File.arrayBuffer()` vs main-process IPC) —
  clipboard and OS-drag both expose bytes in the renderer, so prefer
  renderer-side reads; main-process IPC only if a path-only drop needs
  it.
- Mural version bump + Plexus dependency update.

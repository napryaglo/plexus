# Toolbox: figure-only visuals + host-owned captions

**Date:** 2026-08-08
**Status:** approved (design), pending spec review

## Problem

The unified toolbox subsystem routes every droppable element's visual through
one `ToolboxVisualPresenter`. Today that visual carries its own label:

- Shape tiles render figure-only (no caption) — they read as anonymous glyphs.
- Library / meta-model tiles render an `icon + label` template squeezed into a
  fixed 48×48 presenter, so the label clips.
- The canvas node and library preview inherit whatever the visual draws.

There is no consistent, readable caption, and long names have nowhere to wrap.

## Decision

Adopt one contract across the subsystem:

> **A toolbox visual renders figure/icon only. The host draws the caption.**

Each host (toolbox tile, canvas node, library preview) owns a wrapping caption
bound to its own label field. Because the visual no longer labels itself, nothing
double-labels — once a class's template is on the new model.

## Changes

### 1. Programmatic visual tiers — `library/services/visual-library.ts`

- `buildIconTemplate`: drop the `$Display` `TextBlock`. The result is the icon
  centered in the existing chrome `Border` — figure only.
- `buildDefaultTemplate`: drop the `$Display` `TextBlock`. A class with no icon
  and no authored template renders a neutral `@SurfaceContainerHigh` rounded box
  (no glyph, no text); its identity comes from the host caption.
- `ConceptVisualResolver` (`diagram/services/concept-visual-resolver.ts`) uses
  both builders, so it inherits figure-only automatically. Its `template.Apply(
  { Display: descriptor.Key })` argument is now vestigial (nothing binds
  `$Display`); apply with `{}`.

### 2. Presentation scaffold — `meta-model/services/presentation-scaffold.ts`

- `templateBlock` emits **icon-only** stubs: a `Border` wrapping just the icon
  element (or, when a node has no icon, an empty neutral `Border`). The label
  `TextBlock` is gone.
- `labelExpr` is removed from `PresentationRole` and from both role literals
  (`META_MODEL_ROLE`, `LIBRARY_ROLE`) — it has no remaining consumer.
- Write-once behavior is unchanged: an entity whose key already exists in any
  `presentation/*.mu` is skipped. We do **not** rewrite already-authored
  templates, so pre-existing `icon + label` stubs keep self-labeling until their
  author edits them.

### 3. Host captions (`.mu` view resources)

Every caption `TextBlock` uses `TextWrapping = Wrap` (already a registered markup
enum — no mural change) and `Style = @BodySmall`, `Foreground = @OnSurfaceVariant`.

- **Toolbox tile** — `diagram/diagram.resources.mu`, `DataTemplate [DataType =
  ToolboxItem]`. Inside the existing centered `StackPanel`, add a caption under
  the 48×48 presenter: `TextBlock [ Text = $Label, TextWrapping = Wrap,
  TextAlignment = Center, HorizontalAlignment = Center ]`.
- **Canvas node** — `architecture-projects/architecture-projects.resources.mu`,
  `DataTemplate [DataType = InstanceNodeVM]`. Wrap the presenter and a caption in
  a vertical `StackPanel`: `ToolboxVisualPresenter [...]` then
  `TextBlock [ Text = $Display, TextWrapping = Wrap, TextAlignment = Center ]`.
- **Library preview** — `library/library.resources.mu`, `DataTemplate [DataType =
  LibraryTreeNode]`. Add a wrapping `$Display` caption above the existing
  `$Concept` label; make both wrap.

## Label sources (all already present)

- Toolbox tile: `ToolboxItem.Label` (both `ShapeToolboxItem` and
  `ArchToolboxItem` carry it) → `$Label`.
- Canvas node: `InstanceNodeVM.Display` → `$Display`.
- Library preview: `LibraryTreeNode.Display` / `Concept` → `$Display`, `$Concept`.

## Transitional behavior (accepted)

- Classes/concepts that fall to the programmatic default-box or legacy-icon tiers
  are fixed immediately — the common no-authored-template case (e.g. a class with
  only an icon annotation, or none). Their visual becomes figure-only the moment
  this ships.
- Libraries / meta-models already published with `icon + label` **author**
  templates will show the label twice (in-visual + host caption) on tile/canvas
  until their author edits those templates to icon-only. This is deliberate: the
  templates are author-owned and we never rewrite user files.

## Defaults chosen

- No-icon default figure: a neutral `@SurfaceContainerHigh` rounded box, no glyph.
- Caption chrome: `@BodySmall`, `@OnSurfaceVariant`, centered.

## Testing

- `visual-library` tests: default and icon templates render figure-only (no
  `TextBlock` / no `$Display` text in the tree).
- `concept-visual-resolver` test: resolved visual contains no label text.
- `presentation-scaffold` / `presentation-generator` tests: scaffolded stubs
  contain the icon element but no label `TextBlock`; `labelExpr` removal compiles.
- Host render tests (tile, canvas node, library preview): each hosts the presenter
  **and** a wrapping caption bound to the correct field.

## Out of scope

- Rewriting or migrating already-published author templates (author-owned).
- Any mural framework change (`TextWrapping` and `TextAlignment` are already
  registered markup enums).
- Republishing the microsoft / existing libraries — a follow-up, human-run step.

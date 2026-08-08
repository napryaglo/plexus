# Toolbox figure-only visuals + host-owned captions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every toolbox visual render figure/icon-only and give each host (toolbox tile, canvas node, library preview) its own wrapping caption, so nothing double-labels and long names wrap.

**Architecture:** The `ToolboxVisualPresenter` resolves a figure-only visual; the hosting `.mu` template draws a `TextBlock` caption bound to the host's label field. The programmatic visual tiers (`buildDefaultTemplate`/`buildIconTemplate`) and the presentation scaffold stop emitting labels.

**Tech Stack:** TypeScript, mural (`@pragmatic-lab/mural` ^0.3.2) markup (`.mu`) + runtime, Vitest.

## Global Constraints

- Every test file lives in a `tests/` subfolder next to its source.
- Real enums, never string-literal unions.
- Render through templates/bindings only; no hardcoded chrome bypassing `.mu`.
- Commit/push only when the user asks; branch first (not on `main`).
- `TextWrapping` / `TextAlignment` are already registered markup enums — no mural change.
- Caption chrome: `Style = @BodySmall`, `Foreground = @OnSurfaceVariant`, centered.

---

### Task 1: Programmatic visual tiers become figure-only

**Files:**
- Modify: `src/renderer/src/modules/library/services/visual-library.ts`
- Modify: `src/renderer/src/modules/diagram/services/concept-visual-resolver.ts`
- Test: `src/renderer/src/modules/library/services/tests/visual-library.test.ts`
- Test: `src/renderer/src/modules/diagram/services/tests/concept-visual-resolver.test.ts`

**Interfaces:**
- Produces: `buildDefaultTemplate(ctx)` → a `Border`-only figure (no `TextBlock`); `buildIconTemplate(iconDef, ctx)` → a `Border` hosting only an `Icon`. Signatures unchanged.

- [ ] **Step 1: Update visual-library tests to assert figure-only.**
  In `visual-library.test.ts` add a `findText` helper (walk for a `TextBlock`) and:
  - `buildDefaultTemplate(...).Apply({})` → tree contains **no** `TextBlock`.
  - `buildIconTemplate(iconDef, ctx).Apply({})` → contains the `Icon` (existing assertion) and **no** `TextBlock`.
  Keep the `compileTemplate` fragment test as-is.

- [ ] **Step 2: Run the tests, expect FAIL** (`npx vitest run src/renderer/src/modules/library/services/tests/visual-library.test.ts`) — the default/icon sources still emit a `TextBlock`.

- [ ] **Step 3: Edit `visual-library.ts`.**
  - `DEFAULT_SOURCE` → `'Border [ Background = @SurfaceContainerHigh, CornerRadius = 6, Padding = (10,6,10,6) ]'` (a neutral box, no child `TextBlock`).
  - `ICON_SOURCE` → `'Border [ Background = @SurfaceContainerHigh, CornerRadius = 6, Padding = (10,6,10,6) ] { Icon [ Foreground = @OnSurface, Width = 16, Height = 16 ] }'` (drop the `StackPanel` + `TextBlock`; the single `Icon` is still found by `findIcon`).

- [ ] **Step 4: Run the tests, expect PASS.**

- [ ] **Step 5: Simplify `ConceptVisualResolver.Resolve`.**
  Change `template.Apply({ Display: descriptor.Key })` to `template.Apply({})` (nothing binds `$Display` now). Add a test in `concept-visual-resolver.test.ts`: the resolved visual (icon and no-icon cases) contains no `TextBlock` (reuse a walk helper).

- [ ] **Step 6: Run `concept-visual-resolver.test.ts`, expect PASS.**

---

### Task 2: Presentation scaffold emits icon-only stubs

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/presentation-scaffold.ts`
- Test: `src/renderer/src/modules/meta-model/services/tests/presentation-scaffold.test.ts`

**Interfaces:**
- Consumes: `PresentationRole` (drop its `labelExpr` field).
- Produces: `templateBlock` output = a `Border` wrapping only the icon element, or an empty `Border` when the node has no icon.

- [ ] **Step 1: Update `presentation-scaffold.test.ts`.**
  - "meta-model role" test: drop `expect(text).toContain('Text = "Actor"')`; keep `@mm_icon_actor` + the two `DataTemplate x:key` assertions; add `expect(text).not.toContain('TextBlock')`.
  - "library role" test: drop `expect(text).toContain('Text = $Display')`; keep the `Shape [ Geometry = @mm_icon_b` assertion.
  - Rename "label-only template when the entity resolves no icon" → "empty figure box when the entity resolves no icon": assert `not.toContain('Shape [')`, `not.toContain('TextBlock')`, and that a `Border` is present.
  - "regeneration APPENDS" test: the `actor` entity has no icon, so give it one (`attrs: { icon: 'resources/a.svg', label: 'Actor' }`) and have the author edit a stable token — replace `@mm_icon_a` with `@mm_icon_a_EDITED` — then assert the edit survives and `mm:gateway` is appended. Keep the `DataTemplate` count = 2 and `resources` count = 1 assertions.

- [ ] **Step 2: Run the tests, expect FAIL** (`npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-scaffold.test.ts`).

- [ ] **Step 3: Edit `presentation-scaffold.ts`.**
  - Remove `labelExpr` from the `PresentationRole` interface and from `META_MODEL_ROLE` / `LIBRARY_ROLE` (and the now-unused `projectAnnotations`/`resolveFacets` label plumbing inside those literals; `resolveFacets` is still needed in `templateBlock` for the icon).
  - In `templateBlock`, drop the `label` line. `inner` becomes: `icon === undefined ? [] : [ '            ' + iconElement(doc, icon) ]`. When there is no icon the `Border` body is empty.
  - Remove the now-unused `escapeMu` helper if nothing references it after the edit.

- [ ] **Step 4: Run the tests, expect PASS.**

- [ ] **Step 5: Typecheck** (`npm run typecheck`) to catch any dangling `labelExpr`/import references; fix.

---

### Task 3: Host captions in the three `.mu` view resources

**Files:**
- Modify: `src/renderer/src/modules/diagram/diagram.resources.mu` (`DataTemplate [DataType = ToolboxItem]`)
- Modify: `src/renderer/src/modules/architecture-projects/architecture-projects.resources.mu` (`DataTemplate [DataType = InstanceNodeVM]`)
- Modify: `src/renderer/src/modules/library/library.resources.mu` (`DataTemplate [DataType = LibraryTreeNode]` preview)
- Test: `src/renderer/src/modules/library/services/tests/library-preview-render.test.ts`
- Test (find/confirm): a tile render test under `diagram` and a canvas-node render test under `architecture-projects`; if none host the presenter template, add a focused one mirroring `library-preview-render.test.ts`.

**Interfaces:**
- Consumes: `ToolboxItem.Label` (`$Label`), `InstanceNodeVM.Display` (`$Display`), `LibraryTreeNode.Display`/`Concept`.

- [ ] **Step 1: Toolbox tile caption.**
  In `diagram.resources.mu`, inside the tile's centered `StackPanel`, add under the presenter:
  `TextBlock [ Text = $Label, Style = @BodySmall, Foreground = @OnSurfaceVariant, TextWrapping = Wrap, TextAlignment = Center, HorizontalAlignment = Center, Margin = (0,4,0,0) ]`.

- [ ] **Step 2: Canvas node caption.**
  In `architecture-projects.resources.mu`, replace the bare presenter with a vertical stack:
  ```
  StackPanel [ Orientation = Vertical, HorizontalAlignment = Center ] {
      ToolboxVisualPresenter [ Descriptor = $Descriptor, Context = VisualContext.Figure ]
      TextBlock [ Text = $Display, Style = @BodySmall, Foreground = @OnSurface, TextWrapping = Wrap, TextAlignment = Center, HorizontalAlignment = Center, Margin = (0,4,0,0) ]
  }
  ```

- [ ] **Step 3: Library preview caption.**
  In `library.resources.mu` preview template, add above the `$Concept` line:
  `TextBlock [ Text = $Display, Style = @BodyMedium, Foreground = @OnSurface, TextWrapping = Wrap ]`
  and add `TextWrapping = Wrap` to the existing `$Concept` `TextBlock`.

- [ ] **Step 4: Compile the markup** (`npm run compile:mu`), expect exit 0 (validates the three `.mu` edits against the symbol table/meta-model).

- [ ] **Step 5: Update `library-preview-render.test.ts`.**
  The first test already finds the presenter and asserts `$Concept` renders; add: `findText(root!, 'Azure')` (the node's `Display`) is `true` — the new caption renders alongside the concept label.

- [ ] **Step 6: Tile + canvas render tests.**
  Locate any existing render test that applies `DataTemplate[ToolboxItem]` / `DataTemplate[InstanceNodeVM]`. If present, extend it to assert the caption `TextBlock` (`$Label` / `$Display`) is in the tree with `TextWrapping = Wrap`. If absent, add one focused test per host (mirror `library-preview-render.test.ts`: merge the module resources, resolve the template by type, apply an item/vm, walk for the caption text + wrapping).

- [ ] **Step 7: Run the three host render test files, expect PASS.**

---

### Finish

- [ ] Run the full suite (`npm test`) — expect green (585 baseline + new/changed tests).
- [ ] Run `npm run typecheck` and `npm run build` — expect exit 0.
- [ ] Grep for stragglers: no `$Display` `TextBlock` left in `buildDefaultTemplate`/`buildIconTemplate`, no `labelExpr` references.
- [ ] REQUIRED SUB-SKILL: Use superpowers:finishing-a-development-branch (verify tests → present integration menu → execute choice).

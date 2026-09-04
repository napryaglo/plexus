# Diagram Export SP2 — Title-Bar File Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **File** menu to the custom title bar that opens a click-driven dropdown containing **Export ▸ Vector Graphics (SVG) / PowerPoint (PPTX)**, bound to the same two commands the diagram context menu already uses.

**Architecture:** Pure renderer-side markup. A mural `MenuButton` ("File") lives in the title-bar `DockPanel`; it self-manages open/close (trigger click toggles `IsOpen`, click-away scrim and item activation close it). Its popup hosts an `Export` `MenuItem` whose SVG/PPTX children bind to `$service(DiagramExportService).ExportSvgCommand` / `ExportPptxCommand`. No new service, no new state, no main-process code — SP1 already owns the export engine, command surface, and active-document resolution (`canExportActive()` gates enable/disable, so a File-menu invocation with no active diagram simply shows the items disabled).

**Tech Stack:** mural (`MenuButton`, `MenuItem`, `MenuPopupHost`, `ClickAwayScrim`, `StackPanel`), `.mu` markup, `$service()` binding, Playwright `_electron` e2e.

**Spec:** docs/superpowers/specs/2026-09-04-diagram-export.md (§3.4 Surface 2 — title-bar File menu; §4 SP2; §5 open item 3 — resolved: `MenuButton`).

## Global Constraints

- Every test file lives in a `tests/` subfolder next to source (repo convention; e2e lives under the existing `e2e/` root, matching SP1's `e2e/export-svg.spec.ts`).
- Render every visible element through templates/bindings — no hardcoded chrome. The File trigger and popup use `Template`/`TriggerTemplate` control templates, mirroring the Background Work dock.
- No explicit width/height for layout composition where avoidable; the popup may set `MinWidth` for a sane menu column, matching the Background Work popup precedent.
- `.mu` command bindings use `$service(DiagramExportService).ExportSvgCommand` / `ExportPptxCommand` verbatim — these are the exact property names on the SP1 service.
- Commit message trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- **Modify:** `src/renderer/src/window/title-bar.resources.mu` — add the `DiagramExportService` import, the `File` `MenuButton` in the `DockPanel` (after the divider, before the title `TextBlock`), and three template resources (`@FileMenuTrigger`, `@FileMenuTriggerChrome`, `@FileMenuPopup`) inside the existing `resources PlexusTitleBar { … }` block. This file is already in the `compile:mu` list — no `package.json` change.
- **Create:** `e2e/title-bar-file-menu.spec.ts` — a Playwright `_electron` test asserting the File button opens the menu and surfaces the Export items.

No other files change. SP1's `DiagramExportService` (`src/renderer/src/modules/diagram-export/services/diagram-export-service.ts`) is consumed unchanged.

---

## Verified facts (from mural source; do not re-derive)

- `MenuButton` (`node_modules/@pragmatic-tech-ai/mural/dist/framework/menu/menu-strip.js`): trigger `AddClickHandler(() => { this.IsOpen = !this.IsOpen })` (self-toggle); scrim `onClick → IsOpen = false`; item activation `_onActivated → IsOpen = false`. **No external `IsOpen` binding required.**
- Required trigger-template PARTs (MenuButton wires these by name): `PART_Trigger` (a `Button`), `PART_TriggerStack` (a `StackPanel`), `PART_HeaderText` (a `TextBlock`).
- Required popup-template PARTs: `PART_PopupHost` (`MenuPopupHost`), `PART_Scrim` (`ClickAwayScrim`), `PART_PopupContainer` (`Border`).
- `MenuPopupHost.anchorSide` defaults to `Below` — the File popup opens beneath the button.
- A `MenuItem` opens its submenu to the **Right** (cascade) unless its direct parent is a `MenuStrip` (then **Below**). The `ContextMenu` hosts items as a plain `ItemsControl` (not a `MenuStrip`), which is why its Export submenu cascades right. **Therefore host the Export `MenuItem` in a plain vertical `StackPanel`, not a `MenuStrip`.**
- Declarative `MenuItem [ Header = "Export" ] { MenuItem[…] MenuItem[…] }` nesting is exactly the context-menu pattern (diagram.resources.mu:339-342).
- Import path from `window/` to the service: `../modules/diagram-export/services/diagram-export-service.js`.
- `MenuButton`, `MenuItem`, `MenuStrip`, `MenuPopupHost`, `ClickAwayScrim`, `StackPanel`, `ContentPresenter` are framework controls — available in `.mu` without import. Only `DiagramExportService` needs an `import`.

---

### Task 1: File menu in the title bar

**Files:**
- Modify: `src/renderer/src/window/title-bar.resources.mu`
- Test: `e2e/title-bar-file-menu.spec.ts`

**Interfaces:**
- Consumes (from SP1): `DiagramExportService` with `ExportSvgCommand: ICommand` and `ExportPptxCommand: ICommand` (both gated by `canExportActive()`), resolvable via `$service(DiagramExportService)`.
- Produces: no code API; a new UI surface (`@PlexusTitleBar` gains a `File` menu). SP2 has no downstream task.

- [ ] **Step 1: Add the service import**

At the top of `src/renderer/src/window/title-bar.resources.mu`, below the existing `import TitleService …` line (currently line 23), add:

```
import DiagramExportService from "../modules/diagram-export/services/diagram-export-service.js"
```

- [ ] **Step 2: Add the File MenuButton to the DockPanel**

In `resources PlexusTitleBar { … }`, insert the `MenuButton` immediately **after** the divider `Line` (currently line 62) and **before** the title `TextBlock` (currently line 65):

```
// File menu — click-to-open dropdown; Export ▸ SVG / PPTX bound to the same
// commands the diagram context menu uses. MenuButton self-manages open/close.
MenuButton
    [ DockPanel.Dock    = Left,
      Header            = "File",
      Template          = @FileMenuPopup,
      TriggerTemplate   = @FileMenuTrigger,
      VerticalAlignment = Center ]
```

- [ ] **Step 3: Add the trigger templates**

Inside the same `resources PlexusTitleBar { … }` block (after the `Border x:key="PlexusTitleBar"` element, still within the `resources` block), add the trigger face templates. `PART_Trigger`/`PART_TriggerStack`/`PART_HeaderText` are the names MenuButton binds; the chrome gives a flat menu-bar hover/press state (no pill — this is a menu-bar button, not a status pill):

```
// The File trigger: PART_Trigger (Button) + PART_TriggerStack + PART_HeaderText
// are the parts MenuButton keeps in sync with Header ("File").
Template x:key="FileMenuTrigger" [ TargetType = MenuButton ] {
    Button x:name="PART_Trigger" [ Template = @FileMenuTriggerChrome ] {
        StackPanel x:name="PART_TriggerStack" [ Orientation = Horizontal, VerticalAlignment = Center ] {
            TextBlock x:name="PART_HeaderText"
                [ FontSize = 12, Foreground = @OnSurfaceVariant, VerticalAlignment = Center ]
        }
    }
}

// Flat rectangular menu-bar button face with @OnSurfaceVariant hover/press layers.
Template x:key="FileMenuTriggerChrome" [ TargetType = Button ] {
    Border x:name="PART_Primary" [ Fill = #00000000, CornerRadius = @ShapeExtraSmall ] {
        Border x:name="PART_PrimaryState" [ Fill = #00000000, CornerRadius = @ShapeExtraSmall, Padding = (10,4,10,4) ] {
            ContentPresenter [ HorizontalAlignment = Center, VerticalAlignment = Center ]
        }
    }
    when ( IsMouseOver ) { PART_PrimaryState.Fill = @OnSurfaceVariantHoverLayer; }
    when ( IsPressed )   { PART_PrimaryState.Fill = @OnSurfaceVariantPressLayer; }
}
```

- [ ] **Step 4: Add the popup template with the Export submenu**

Still inside `resources PlexusTitleBar { … }`, add the popup. The popup preserves the MenuButton popup contract (`PART_PopupHost`/`PART_Scrim`/`PART_PopupContainer`). Host the `Export` `MenuItem` in a plain vertical `StackPanel` (NOT a `MenuStrip`) so its SVG/PPTX submenu cascades to the right:

```
// The File dropdown: MenuPopupHost = PART_PopupHost, a PART_Scrim ClickAwayScrim,
// a PART_PopupContainer Border. The Export MenuItem sits in a plain vertical
// StackPanel so its submenu cascades RIGHT (a MenuStrip parent would anchor it
// below). SVG/PPTX bind to the SP1 export commands via $service.
Template x:key="FileMenuPopup" [ TargetType = MenuButton ] {
    MenuPopupHost x:name="PART_PopupHost" {
        ClickAwayScrim x:name="PART_Scrim"
        Border x:name="PART_PopupContainer"
            [ Fill = @SurfaceContainerHigh, Stroke = Pen [ Brush = @OutlineVariant ],
              CornerRadius = @ShapeExtraSmall, Effect = @Elevation2, Padding = (4) ] {
            StackPanel [ Orientation = Vertical, MinWidth = 200 ] {
                MenuItem [ Header = "Export" ] {
                    MenuItem [ Header = "Vector Graphics (SVG)", Command = $service(DiagramExportService).ExportSvgCommand ]
                    MenuItem [ Header = "PowerPoint (PPTX)",     Command = $service(DiagramExportService).ExportPptxCommand ]
                }
            }
        }
    }
}
```

- [ ] **Step 5: Compile the .mu resources**

Run: `npm run compile:mu`
Expected: all files compile clean, including `title-bar.resources.mu` (now with the File menu + three new template keys). No unresolved-symbol errors for `DiagramExportService`, `MenuButton`, `MenuPopupHost`, `ClickAwayScrim`.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: `✓ built` with no TypeScript or bundler errors.

- [ ] **Step 7: Spike — visually verify the menu (manual, decisive)**

Run: `npm run dev`. In the app: click **File** in the title bar → the dropdown opens beneath it. Hover **Export** → the SVG/PPTX submenu cascades to the **right**. With a diagram open (≥1 node), the items are enabled and clicking **Vector Graphics (SVG)** opens the save dialog; with no diagram, the items are disabled. Click away → the menu closes.

**Decision rule (record as a Ruling if exercised):** if the `Export` `MenuItem` does not render its row or its submenu fails to cascade when hosted directly in the `StackPanel`, wrap the two SVG/PPTX items as **direct** children of the popup `StackPanel` (flatten to `MenuItem [ Header = "Export as SVG", Command = … ]` and `MenuItem [ Header = "Export as PPTX", Command = … ]`, no nesting) — the flat form needs no cascade and satisfies the spec's intent. Do not introduce a `MenuStrip` (it would anchor the submenu below, overlapping the popup).

- [ ] **Step 8: Write the e2e test**

Create `e2e/title-bar-file-menu.spec.ts`, mirroring the launch/setup convention of `e2e/export-svg.spec.ts` (strip `ELECTRON_RUN_AS_NODE`, launch via `_electron`, wait for `#app svg`). Assert: (a) the title bar renders a "File" label; (b) clicking it reveals an "Export" label that was not present before the click. mural renders `TextBlock`s as SVG `<text>` nodes, so locate by text content within `#app`.

```ts
import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({
    args: [join(__dirname, '..', 'out', 'main', 'index.js')],
    env,
  })
  page = await app.firstWindow()
  await page.waitForSelector('#app svg', { timeout: 30_000 })
})

test.afterAll(async () => {
  await app?.close()
})

test('File title-bar menu opens and reveals the Export item', async () => {
  const file = page.locator('#app').getByText('File', { exact: true }).first()
  await expect(file).toBeVisible()

  // Export is not shown until the menu opens.
  await expect(page.locator('#app').getByText('Export', { exact: true })).toHaveCount(0)

  await file.click()

  const exportItem = page.locator('#app').getByText('Export', { exact: true }).first()
  await expect(exportItem).toBeVisible({ timeout: 5_000 })
})
```

- [ ] **Step 9: Run the e2e test**

Run: `npx playwright test e2e/title-bar-file-menu.spec.ts`
Expected: PASS. If the launcher path or setup differs, copy it verbatim from `e2e/export-svg.spec.ts` (it is the working reference in this repo). If text-locator flakiness appears (mural text hit-testing), align the selector strategy with whatever `export-svg.spec.ts` uses to reach in-canvas elements; do not weaken the assertion to a no-op.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/window/title-bar.resources.mu src/renderer/src/window/title-bar.resources.mu.js e2e/title-bar-file-menu.spec.ts
git commit -m "feat(diagram-export): title-bar File menu (Export ▸ SVG/PPTX)

Add a File menu to the custom title bar via a mural MenuButton that opens
a dropdown with Export ▸ Vector Graphics (SVG) / PowerPoint (PPTX), bound
to the same DiagramExportService commands as the diagram context menu.
Self-managed open/close; no new service or main-process code. Completes
SP2 of the diagram-export feature.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

(The `.mu.js` compiled artifact is committed alongside source — the repo's established pattern; `compile:mu` is a pre-build step and the `.mu.js` files are tracked.)

---

## Self-Review

- **Spec coverage:** §3.4 (title-bar File menu opening Export ▸ SVG/PPTX bound to the same command ids) → Steps 2-4. §5 open item 3 (menu-bar control) → resolved to `MenuButton` in Verified Facts. §4 SP2 scope (pure UI + wiring on SP1 commands) → the whole task. §7 out-of-scope (Edit/View menus) → not built; the `StackPanel` popup is trivially extendable later.
- **Placeholder scan:** every markup and test block is complete and literal; the one branch (flat-vs-nested Export) is a decisive rule with exact fallback markup, not a TODO.
- **Type/name consistency:** `ExportSvgCommand`/`ExportPptxCommand` match the SP1 service property names; PART names (`PART_Trigger`, `PART_TriggerStack`, `PART_HeaderText`, `PART_PopupHost`, `PART_Scrim`, `PART_PopupContainer`) match the MenuButton contract verified in mural source and the Background Work precedent.

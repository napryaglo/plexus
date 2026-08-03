# Problems Popup — Header/Toolbar + Capped Virtualized List (Design)

**Date:** 2026-08-03
**Status:** Approved (pending spec review)

## Goal

Rework the status-bar **Problems popup** in place so it has a header/toolbar,
a list capped at 30% of the live window height, and virtualized rows. Keep the
status-bar summary pill and the `MenuButton` overlay mechanism unchanged.

## Background — what exists today

`src/renderer/src/modules/problems/`:

- **`problems-service.ts`** — `ProblemsService` (a `ServiceBase` keyed by the
  standalone `ProblemsServiceKey`) subscribes to `DiagnosticsService`'s coalesced
  change signal and rebuilds a flat `ObservableCollection<ProblemsRow>`: an
  optional `ProjectHeader` row per project (only when >1 project has problems),
  then one `Diagnostic` row per problem. Exposes `ErrorCount`, `WarningCount`,
  `SummaryText` ("3 errors, 2 warnings" / "No problems"), and `IsOpen` (a failed
  publish calls `Expand()` to force the popup open). `ActivateRow` opens the
  file + span via `ProjectExplorerService.OpenFileInProject`.
- **`problems.resources.mu`** — `@ProblemsDock` is a `DataTemplate`
  (`DataType = ProblemsService`) whose root is a `MenuButton`
  `[ Header = $SummaryText, IsOpen = $IsOpen, ItemsSource = $Rows,
  TriggerTemplate = @ProblemsDockTrigger ]`. The popup renders the generated
  `ProblemsRow` containers directly — **no header, no toolbar, unbounded height,
  not virtualized.**
- **`problems.module.mu`** — registers `ProblemsService` and contributes a
  `StatusBar`-region `ShellControlDefinition` bound to `@ProblemsDock` with
  `DataContext = ProblemsServiceKey`.

### Framework facts verified

- `MenuButton extends HeaderedItemsControl`. Its popup **control `Template`**
  (default `@DefaultMenuButtonPopup`) is: root `MenuPopupHost` (`PART_PopupHost`)
  › `ClickAwayScrim` (`PART_Scrim`, required by `adoptPopupTemplate`) + `Border`
  (`PART_PopupContainer`) wrapping an `ItemsPresenter`. Overriding this template
  lets us add chrome around the `ItemsPresenter`. The three named parts and the
  root `MenuPopupHost` type MUST be preserved or `adoptPopupTemplate` throws.
- `VirtualizingStackPanel` (implements `IScrollInfo`) exists and already backs
  the library `TreeView`; `ScrollViewer` (a `ContentControl`) coordinates with
  an `IScrollInfo` descendant. So an `ItemsPresenter` using a
  `VirtualizingStackPanel` `ItemsPanel`, wrapped in a `ScrollViewer`, virtualizes.
- `MaxHeight` is a `Visual` DP (`Number.POSITIVE_INFINITY` default), so it clamps
  the `ScrollViewer`'s desired height regardless of the popup's available height.
- No clipboard or window-size service exists in Plexus or the mural framework;
  both must be added.

## Design

### New services

**`ViewportService`** (`src/renderer/src/services/viewport/viewport-service.ts`)
- A `ServiceBase` exposing a `Height` DP (number). On construction reads the
  current viewport height and subscribes to the `resize` event, writing
  `Height` on each change.
- Window access is injected, not hard-referenced: the constructor takes an
  optional `heightSource: { current(): number; onResize(cb): () => void }`
  defaulting to a `window`-backed implementation. Tests pass a fake that lets
  them push heights. Keeps DOM coupling behind a seam (testable, single
  responsibility).
- Registered in `app.mu` `.services:` and eagerly resolved in `main.js`
  alongside the other eager services.

**`ClipboardService`** (`src/renderer/src/services/clipboard/clipboard-service.ts`)
- A `ServiceBase` with `writeText(text: string): Promise<void>` delegating to an
  injected writer defaulting to `navigator.clipboard.writeText`. Fake writer in
  tests captures the text.
- Registered in `app.mu` `.services:`.

### `ProblemsService` extensions

New DPs:
- `ShowErrors: boolean = true`, `ShowWarnings: boolean = true` — severity
  toggles. Setter change triggers `rebuild()`.
- `FilterText: string = ''` — substring filter. Change triggers `rebuild()`.
- `ListMaxHeight: number` — `0.3 × ViewportService.Height`. Recomputed whenever
  the injected `ViewportService.Height` changes (subscribe in the constructor)
  and once at construction.

`ErrorCount` / `WarningCount` remain **unfiltered totals** (they label the
toggles). `SummaryText` unchanged.

`rebuild()` gains a filter step before grouping:
- Keep a diagnostic if its severity is enabled (`Error`→`ShowErrors`,
  `Warning`→`ShowWarnings`; other severities always kept) **and** (`FilterText`
  empty **or** case-insensitive match against the message or the file name).
- Grouping/rows are then built from the filtered set exactly as today. Totals
  (`ErrorCount`/`WarningCount`/`SummaryText`) are computed from the **full**
  set, before filtering.

New commands (all `RelayCommand`):
- `CopyAllCommand` — serialize the **currently displayed (filtered)** diagnostic
  rows to text (one `problemLine` per `Diagnostic` row, project headers skipped)
  and `ClipboardService.writeText` it.
- `ClearFiltersCommand` — set `FilterText = ''`, `ShowErrors = true`,
  `ShowWarnings = true` (one `rebuild`).

Row-level:
- `ProblemsRow` gains a `CopyCommand` DP. `rebuild()` assigns each `Diagnostic`
  row a `CopyCommand` that copies just that row's `problemLine`.

Shared formatter `problemLine(d: Diagnostic): string` →
`"<SEVERITY> <file> <line>:<col>  <message>"` (severity upper-cased; file/loc
omitted when absent, mirroring `locationLabel`). Used by both copy paths.

### `problems.resources.mu` rework

- `@ProblemsDock` `DataTemplate` (`DataType = ProblemsService`) root `MenuButton`
  gains `Template = @ProblemsPopup, ItemsPanel = @ProblemsListPanel`; keeps
  `Header/IsOpen/ItemsSource/TriggerTemplate`. Trigger chrome
  (`@ProblemsDockTrigger`, `@ProblemsTriggerChrome`) is unchanged.
- **`ItemsPanelTemplate x:key="ProblemsListPanel"`** — a `VirtualizingStackPanel`
  with a uniform `ItemHeight` (rows are single-line).
- **`Template x:key="ProblemsPopup" [ TargetType = MenuButton ]`** — reproduces
  the default popup contract and adds chrome:
  ```
  MenuPopupHost x:name="PART_PopupHost" {
      ClickAwayScrim x:name="PART_Scrim" [ BorderThickness = (0) ]
      Border x:name="PART_PopupContainer" [ @SurfaceContainerHigh surface,
             @OutlineVariant 1px border, @ShapeExtraSmall, @Elevation2 ] {
          DockPanel [ LastChildFill = true, MinWidth = 320 ] {
              // Header/toolbar, docked Top
              StackPanel [ DockPanel.Dock = Top, Orientation = Horizontal ] {
                  TextBlock  "Problems" (title)
                  ToggleButton  Errors  ($ShowErrors two-way, label incl. $ErrorCount)
                  ToggleButton  Warnings ($ShowWarnings two-way, label incl. $WarningCount)
                  TextBox     ($FilterText two-way, placeholder "Filter")
                  <spacer>
                  Button "Copy"  ($CopyAllCommand)
                  Button "Clear" ($ClearFiltersCommand)
              }
              // Capped, virtualized list, fills remainder
              ScrollViewer [ MaxHeight = $ListMaxHeight, HorizontalScrollEnabled = false ] {
                  ItemsPresenter
              }
          }
      }
  }
  ```
  Toolbar controls are styled with existing app/framework resources
  (`@LabelMedium`, state-layer chrome) to match the surrounding UI. The exact
  `ToggleButton`/`TextBox` styling resources are chosen during implementation to
  fit what's already merged app-globally.
- **Row `DataTemplate` (`DataType = ProblemsRow`)** — replaced with a `DockPanel`
  whose copy button and activate button are **siblings** (not nested), so
  clicking copy never triggers navigation:
  ```
  DockPanel [ LastChildFill = true ] {
      Button [ DockPanel.Dock = Right, Command = $CopyCommand, ... copy glyph ]   // inert on ProjectHeader (no command)
      Button [ Template = @TabMenuRowButton, Command = $ActivateCommand,
               HorizontalAlignment = Stretch ] {
          DockPanel { <location right>  <message left> }   // as today
      }
  }
  ```

### `problems.module.mu`

Unchanged (still registers `ProblemsService` + the StatusBar shell control).
`ViewportService`/`ClipboardService` register in `app.mu`, not here.

## Data flow

```
DiagnosticsService.Subscribe ─▶ ProblemsService.rebuild ─▶ filtered/grouped Rows
                                                          └▶ virtualized ItemsPresenter
ViewportService.resize ─▶ Height ─▶ ListMaxHeight ─▶ ScrollViewer.MaxHeight
toolbar toggles / text  ─▶ DP change ─▶ rebuild
CopyAll / row Copy      ─▶ ClipboardService.writeText
```

## Testing

All headless (vitest), test files in `tests/` subfolders beside their source:

- **`ViewportService`** — construct with a fake height source; `Height` reflects
  the initial value; firing the fake resize updates `Height`.
- **`ClipboardService`** — `writeText` forwards to the injected writer.
- **`ProblemsService`** (extend `problems-service.test.ts`):
  - Severity toggles filter rows; text filter matches message and file,
    case-insensitively; combined filters intersect.
  - `ErrorCount`/`WarningCount` stay full totals while filters hide rows.
  - `ListMaxHeight` equals `0.3 × height` at construction and after a fake
    `ViewportService.Height` change.
  - `CopyAllCommand` writes the filtered rows' `problemLine`s (headers skipped);
    a row `CopyCommand` writes only its own line.
  - `ClearFiltersCommand` resets text + both toggles and restores all rows.
- **`problems-datacontext.test.ts`** — updated for the new template/DP surface as
  needed.
- `npm run compile:mu` succeeds; `tsconfig.web.json` + `tsconfig.node.json`
  typecheck clean; full `vitest run` green.

## Decisions (confirmed with user)

- **Target:** the existing status-bar Problems popup (not a new docked panel).
- **Toolbar:** severity filters (with counts), text filter, Copy-all, Clear;
  plus a per-row copy button.
- **Height cap:** responsive — `MaxHeight` tracks live window height (30%).
- **Clear button:** resets filters (text + both severity toggles). A derived
  diagnostics store can't be truly emptied; collapsible groups are deferred.
- **Copy-all scope:** the currently displayed (filtered) rows — WYSIWYG.

## Out of scope / deferred

- Collapsible project groups (collapse/expand-all).
- Persisting filter state across sessions.
- Converting the popup into a dockable panel.
```

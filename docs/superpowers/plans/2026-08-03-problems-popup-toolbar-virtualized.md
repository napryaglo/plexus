# Problems Popup — Header/Toolbar + Capped Virtualized List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the status-bar Problems popup a header/toolbar (severity filters, text filter, copy-all, clear, per-row copy), a list capped at 30% of the live window height, and virtualized rows.

**Architecture:** Two small new app-level services — `ViewportService` (tracks `window.innerHeight`) and `ClipboardService` (`writeText`). `ProblemsService` gains filter state, a live `ListMaxHeight`, and copy/clear commands; its `rebuild()` filters before grouping while keeping counts as unfiltered totals. `problems.resources.mu` overrides the `MenuButton`'s popup control `Template` to host a header/toolbar plus a height-capped `ScrollViewer` wrapping an `ItemsControl` (bound to `$Rows`) whose `ItemsPanel` is a `VirtualizingStackPanel`.

**Tech Stack:** TypeScript, `@pragmatic-tech-ai/mural` (runtime/basic/framework), mural `.mu` templates (compiled via `npm run compile:mu`), vitest.

## Global Constraints

- Every test file lives in a `tests/` subfolder next to the code it exercises (e.g. `src/renderer/src/services/clipboard/tests/clipboard-service.test.ts`).
- Use real TypeScript `enum`s, never string-literal / template-literal union types.
- Commit messages end with a trailer line: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Author commits with a heredoc (`git commit -m "$(cat <<'EOF' … EOF)"`) — do NOT put the message in backticks.
- All work on the `main` branch's feature branch for this plan; the repo root is `Plexus/` (a git repo).
- Every task ends green: `npx vitest run` passes, and where a task touches `.mu` or `app.mu`, `npm run compile:mu` exits 0 and `npm run typecheck` is clean.
- Run all shell commands from the Plexus repo root: `c:\Users\Eugene\Projects\architecture-agent\Plexus`. The Bash tool's cwd can reset — prefix with `cd /c/Users/Eugene/Projects/architecture-agent/Plexus &&` when in doubt.
- `MaxHeight`/`MinWidth` on popup chrome is allowed (it's UI chrome, not a layout-composing library visual). The "no explicit width/height" rule applies only to library/meta-model visuals, not to this popup.

---

## File Structure

- **Create** `src/renderer/src/services/clipboard/clipboard-service.ts` — `ClipboardService`: `writeText(text)` over an injected writer (default `navigator.clipboard.writeText`).
- **Create** `src/renderer/src/services/clipboard/tests/clipboard-service.test.ts`.
- **Create** `src/renderer/src/services/viewport/viewport-service.ts` — `ViewportService`: a `Height` DP + `Subscribe`, fed by an injected `IViewportSource` (default `window`).
- **Create** `src/renderer/src/services/viewport/tests/viewport-service.test.ts`.
- **Modify** `src/renderer/src/modules/problems/problems-service.ts` — filter DPs, `ListMaxHeight`, copy/clear commands, `problemLine`, `ProblemsRow.CopyCommand`, filtered `rebuild`, `OnPropertyChanged`, `ActivateRow` closes the popup.
- **Modify** `src/renderer/src/modules/problems/tests/problems-service.test.ts` — extend `env()` with fake viewport + clipboard; add filter/height/copy/clear tests.
- **Modify** `src/renderer/src/app.mu` — register `ViewportService` + `ClipboardService` in `.services:`.
- **Modify** `src/renderer/src/plexus-icons.mu` + **Create** `src/renderer/src/icons/copy.svg` — a copy glyph resource `@Copy`.
- **Modify** `src/renderer/src/modules/problems/problems.resources.mu` — custom popup template (`@ProblemsPopup`), `@ProblemsListPanel`, capped virtualized `ItemsControl`, new row template.

---

## Task 1: ClipboardService

**Files:**
- Create: `src/renderer/src/services/clipboard/clipboard-service.ts`
- Test: `src/renderer/src/services/clipboard/tests/clipboard-service.test.ts`

**Interfaces:**
- Produces: `class ClipboardService extends ServiceBase` with `static readonly Key: ServiceKey<ClipboardService>`, `constructor(provider: IServiceProvider, writer?: ClipboardWriter)`, `writeText(text: string): Promise<void>`. `export type ClipboardWriter = (text: string) => Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/services/clipboard/tests/clipboard-service.test.ts`:

```ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ClipboardService } from '../clipboard-service.js'

test('writeText forwards to the injected writer', async () => {
    const provider = new ServiceProvider()
    const written: string[] = []
    const svc = new ClipboardService(provider, async (t) => { written.push(t) })
    await svc.writeText('hello')
    expect(written).toEqual(['hello'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/Plexus && npx vitest run src/renderer/src/services/clipboard`
Expected: FAIL — cannot find module `../clipboard-service.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/src/services/clipboard/clipboard-service.ts`:

```ts
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

// A writer that persists text to the system clipboard. Injected so tests capture
// the text without touching the real clipboard.
export type ClipboardWriter = (text: string) => Promise<void>

// Thin, injectable clipboard seam. The default writer targets the renderer's
// navigator.clipboard; tests pass a fake. Consumers (the Problems popup's
// copy-all + per-row copy) resolve this via ClipboardService.Key.
export class ClipboardService extends ServiceBase
{
    public static readonly Key = new ServiceKey<ClipboardService>('ClipboardService')

    private readonly write: ClipboardWriter

    constructor(provider: IServiceProvider, writer: ClipboardWriter = (t) => navigator.clipboard.writeText(t))
    {
        super(provider)
        this.write = writer
    }

    public writeText(text: string): Promise<void> { return this.write(text) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/Plexus && npx vitest run src/renderer/src/services/clipboard`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/Plexus
git add src/renderer/src/services/clipboard
git commit -m "$(cat <<'EOF'
feat(problems): add injectable ClipboardService seam

Thin ServiceBase wrapping navigator.clipboard.writeText behind an injected
writer, so the Problems popup's copy actions are testable headlessly.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: ViewportService

**Files:**
- Create: `src/renderer/src/services/viewport/viewport-service.ts`
- Test: `src/renderer/src/services/viewport/tests/viewport-service.test.ts`

**Interfaces:**
- Produces:
  - `interface IViewportSource { height(): number; subscribe(onChange: () => void): () => void }`
  - `class ViewportService extends ServiceBase` with `static readonly Key: ServiceKey<ViewportService>`, `static readonly HeightKey`, `constructor(provider: IServiceProvider, source?: IViewportSource)`, `get Height(): number`, `Subscribe(listener: () => void): () => void`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/services/viewport/tests/viewport-service.test.ts`:

```ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ViewportService, type IViewportSource } from '../viewport-service.js'

// A fake window: lets the test push a new height and fire the resize callback.
function fakeSource(initial: number): IViewportSource & { push(h: number): void }
{
    let h = initial
    const cbs = new Set<() => void>()
    return {
        height: () => h,
        subscribe: (cb) => { cbs.add(cb); return () => cbs.delete(cb) },
        push: (next: number) => { h = next; for (const cb of cbs) cb() },
    }
}

test('Height reflects the source at construction', () => {
    const provider = new ServiceProvider()
    const svc = new ViewportService(provider, fakeSource(900))
    expect(svc.Height).toBe(900)
})

test('Height updates and Subscribe fires when the source resizes', () => {
    const provider = new ServiceProvider()
    const source = fakeSource(900)
    const svc = new ViewportService(provider, source)
    let notified = 0
    svc.Subscribe(() => { notified += 1 })
    source.push(600)
    expect(svc.Height).toBe(600)
    expect(notified).toBe(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/Plexus && npx vitest run src/renderer/src/services/viewport`
Expected: FAIL — cannot find module `../viewport-service.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/src/services/viewport/viewport-service.ts`:

```ts
import { Model, MetaData, ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

// The window-height feed behind a seam so ViewportService is testable without a
// real DOM. The default implementation (windowViewportSource) reads the renderer
// window; tests inject a fake that can push heights.
export interface IViewportSource
{
    height(): number
    subscribe(onChange: () => void): () => void
}

function windowViewportSource(): IViewportSource
{
    return {
        height: () => window.innerHeight,
        subscribe: (onChange) => {
            window.addEventListener('resize', onChange)
            return () => window.removeEventListener('resize', onChange)
        },
    }
}

// Tracks the live viewport (window) height as a bindable Height DP and notifies
// Subscribe listeners on every resize. Consumers that need a value derived from
// the window size (the Problems popup caps its list at 30% of Height) subscribe
// here rather than touching the DOM.
export class ViewportService extends ServiceBase
{
    public static readonly Key = new ServiceKey<ViewportService>('ViewportService')
    public static readonly HeightKey = Model.RegisterProperty<number>(ViewportService, 'Height', 0, MetaData.None)

    private readonly listeners = new Set<() => void>()

    constructor(provider: IServiceProvider, source: IViewportSource = windowViewportSource())
    {
        super(provider)
        this.set_property_value(ViewportService.HeightKey, source.height())
        source.subscribe(() => {
            this.set_property_value(ViewportService.HeightKey, source.height())
            for (const l of this.listeners) l()
        })
    }

    public get Height(): number { return this.get_property_value(ViewportService.HeightKey) }

    // Fired on every resize (after Height is updated). Returns an unsubscribe thunk.
    public Subscribe(listener: () => void): () => void
    {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/Plexus && npx vitest run src/renderer/src/services/viewport`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/Plexus
git add src/renderer/src/services/viewport
git commit -m "$(cat <<'EOF'
feat(problems): add ViewportService tracking live window height

A bindable Height DP fed by an injected source (default: window resize), so a
UI value can track 30% of the window height and react to resizes. Injected
source keeps it headless-testable.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: ProblemsService — severity + text filtering

**Files:**
- Modify: `src/renderer/src/modules/problems/problems-service.ts`
- Test: `src/renderer/src/modules/problems/tests/problems-service.test.ts`

**Interfaces:**
- Consumes: `ClipboardService` (Task 1), `ViewportService` (Task 2) — registered as fakes in the test `env()`; the service resolves them optionally via `provider.get`.
- Produces on `ProblemsService`: DPs `ShowErrors: boolean` (default true), `ShowWarnings: boolean` (default true), `FilterText: string` (default ''), with getters/setters; private `matchesFilter(d: Diagnostic): boolean`; filtered `rebuild()`; `OnPropertyChanged` override re-running `rebuild` on filter changes. `ErrorCount`/`WarningCount` stay full totals.

- [ ] **Step 1: Update the test env() helper and add failing filter tests**

In `src/renderer/src/modules/problems/tests/problems-service.test.ts`, replace the `env()` helper (lines 16–23) so it registers a fake clipboard + a fake viewport and returns handles. Add the imports at the top and the new helper:

```ts
import { ClipboardService } from '../../../services/clipboard/clipboard-service.js'
import { ViewportService, type IViewportSource } from '../../../services/viewport/viewport-service.js'

function fakeViewport(initial: number): IViewportSource & { push(h: number): void }
{
    let h = initial
    const cbs = new Set<() => void>()
    return {
        height: () => h,
        subscribe: (cb) => { cbs.add(cb); return () => cbs.delete(cb) },
        push: (next: number) => { h = next; for (const cb of cbs) cb() },
    }
}

function env(height = 1000): {
    store: DiagnosticsService; problems: ProblemsService
    clipped: string[]; viewport: IViewportSource & { push(h: number): void }
}
{
    const provider = new ServiceProvider()
    const store = new DiagnosticsService(provider)
    provider.registerInstance(DiagnosticsService.Key, store)
    const clipped: string[] = []
    provider.registerInstance(ClipboardService.Key, new ClipboardService(provider, async (t) => { clipped.push(t) }))
    const viewport = fakeViewport(height)
    provider.registerInstance(ViewportService.Key, new ViewportService(provider, viewport))
    const problems = new ProblemsService(provider)
    return { store, problems, clipped, viewport }
}
```

Then append these filtering tests to the same file:

```ts
test('ShowErrors=false hides error rows but keeps warnings; counts stay full totals', () => {
    const { store, problems } = env()
    store.Publish('todl', '/p', [
        diag({ uri: 'a.todl', message: 'e1', severity: DiagnosticSeverity.Error }),
        diag({ uri: 'a.todl', message: 'w1', severity: DiagnosticSeverity.Warning }),
    ])
    problems.ShowErrors = false
    const labels = [...problems.Rows].filter((r) => r.Kind === ProblemRowKind.Diagnostic).map((r) => r.Label)
    expect(labels).toEqual(['w1'])
    // Counts are unfiltered totals (they label the toggles).
    expect(problems.ErrorCount).toBe(1)
    expect(problems.WarningCount).toBe(1)
})

test('FilterText matches message and file name, case-insensitively', () => {
    const { store, problems } = env()
    store.Publish('todl', '/p', [
        diag({ uri: 'alpha.todl', message: 'boom' }),
        diag({ uri: 'beta.todl', message: 'quiet' }),
    ])
    problems.FilterText = 'BOOM'   // matches message
    expect([...problems.Rows].map((r) => r.Label)).toEqual(['boom'])
    problems.FilterText = 'beta'   // matches file name
    expect([...problems.Rows].map((r) => r.Label)).toEqual(['quiet'])
})

test('severity and text filters intersect', () => {
    const { store, problems } = env()
    store.Publish('todl', '/p', [
        diag({ uri: 'a.todl', message: 'boom', severity: DiagnosticSeverity.Error }),
        diag({ uri: 'a.todl', message: 'boom', severity: DiagnosticSeverity.Warning }),
    ])
    problems.FilterText = 'boom'
    problems.ShowWarnings = false
    const rows = [...problems.Rows].filter((r) => r.Kind === ProblemRowKind.Diagnostic)
    expect(rows.length).toBe(1)   // only the error 'boom' survives both filters
})
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/Plexus && npx vitest run src/renderer/src/modules/problems/tests/problems-service.test.ts`
Expected: FAIL — `problems.ShowErrors`/`FilterText` are not properties yet (undefined; assignments are no-ops), so the filtered assertions fail. (The `import` of `ClipboardService`/`ViewportService` resolves because Tasks 1–2 exist.)

- [ ] **Step 3: Add the filter DPs, matchesFilter, filtered rebuild, and OnPropertyChanged**

In `src/renderer/src/modules/problems/problems-service.ts`:

3a. Ensure the import line includes `PropertyDescriptor` (it already imports from `@pragmatic-tech-ai/mural/runtime`); add `type PropertyDescriptor` to that import if not present.

3b. Add these DPs to `ProblemsService` (after the `IsOpenKey` declaration):

```ts
    // Toolbar filter state. Any change re-runs rebuild() (see OnPropertyChanged),
    // which filters the diagnostics before grouping. Counts stay full totals.
    public static readonly ShowErrorsKey = Model.RegisterProperty<boolean>(ProblemsService, 'ShowErrors', true, MetaData.None)
    public static readonly ShowWarningsKey = Model.RegisterProperty<boolean>(ProblemsService, 'ShowWarnings', true, MetaData.None)
    public static readonly FilterTextKey = Model.RegisterProperty<string>(ProblemsService, 'FilterText', '', MetaData.None)
```

3c. Add getters/setters (after the `IsOpen` getter/setter):

```ts
    public get ShowErrors(): boolean { return this.get_property_value(ProblemsService.ShowErrorsKey) }
    public set ShowErrors(v: boolean) { this.set_property_value(ProblemsService.ShowErrorsKey, v) }
    public get ShowWarnings(): boolean { return this.get_property_value(ProblemsService.ShowWarningsKey) }
    public set ShowWarnings(v: boolean) { this.set_property_value(ProblemsService.ShowWarningsKey, v) }
    public get FilterText(): string { return this.get_property_value(ProblemsService.FilterTextKey) }
    public set FilterText(v: string) { this.set_property_value(ProblemsService.FilterTextKey, v) }
```

3d. Add a private `suppressRebuild` field (near `reloadSeq` — but this class has none; add it as a class field) and the `matchesFilter` + `OnPropertyChanged` methods. Add the field just below the DP declarations' class body start (e.g. right before the constructor):

```ts
    // Set true while ClearFilters mutates several filter DPs, so their individual
    // property-change notifications don't each trigger a rebuild (ClearFilters
    // rebuilds once at the end).
    private suppressRebuild = false
```

Add these methods to the class (e.g. after `rebuild`):

```ts
    // Filter predicate applied before grouping: severity toggles gate errors and
    // warnings (other severities always shown); a non-empty FilterText must appear
    // (case-insensitively) in the message or the file name.
    private matchesFilter(d: Diagnostic): boolean
    {
        if (d.severity === DiagnosticSeverity.Error && !this.ShowErrors) return false
        if (d.severity === DiagnosticSeverity.Warning && !this.ShowWarnings) return false
        const q = this.FilterText.trim().toLowerCase()
        if (q === '') return true
        const file = d.uri === null ? '' : fileNameOf(d.uri)
        return d.message.toLowerCase().includes(q) || file.toLowerCase().includes(q)
    }

    protected override OnPropertyChanged(descriptor: PropertyDescriptor, oldValue: unknown, newValue: unknown): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue)
        if (this.suppressRebuild) return
        const n = descriptor.Name
        if (n === 'ShowErrors' || n === 'ShowWarnings' || n === 'FilterText') this.rebuild()
    }
```

3e. In `rebuild()`, keep the totals loop over the full `all` (unchanged), but group the **filtered** set. Change the grouping section: after computing `errors`/`warnings`/`SummaryText` from `all`, insert the filter before building `byProject`:

```ts
        const visible = all.filter((d) => this.matchesFilter(d))

        const byProject = new Map<string, { name: string; diags: Diagnostic[] }>()
        for (const d of visible) {
            let proj = byProject.get(d.projectId)
            if (proj === undefined) { proj = { name: d.projectName, diags: [] }; byProject.set(d.projectId, proj) }
            proj.diags.push(d)
        }
```

(The rest of `rebuild` — the `rows.Clear()` … loop — stays the same, still iterating `byProject`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/Plexus && npx vitest run src/renderer/src/modules/problems/tests/problems-service.test.ts`
Expected: PASS — all existing tests plus the three new filter tests.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/Plexus
git add src/renderer/src/modules/problems/problems-service.ts src/renderer/src/modules/problems/tests/problems-service.test.ts
git commit -m "$(cat <<'EOF'
feat(problems): filter rows by severity toggles and text

rebuild() now filters diagnostics (severity gates + case-insensitive message/
file substring) before grouping; ErrorCount/WarningCount stay full totals for
the toggle labels. Filter DP changes re-run rebuild via OnPropertyChanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: ProblemsService — responsive ListMaxHeight

**Files:**
- Modify: `src/renderer/src/modules/problems/problems-service.ts`
- Test: `src/renderer/src/modules/problems/tests/problems-service.test.ts`

**Interfaces:**
- Consumes: `ViewportService` (Task 2), resolved optionally via `provider.get`.
- Produces on `ProblemsService`: DP `ListMaxHeight: number` with a getter; private `updateListMaxHeight(height: number)`; constructor wiring that seeds it from `ViewportService.Height` and re-derives on `ViewportService.Subscribe`. Module constant `LIST_HEIGHT_FRACTION = 0.3` and `FALLBACK_LIST_MAX_HEIGHT = 240`.

- [ ] **Step 1: Write the failing test**

Append to `src/renderer/src/modules/problems/tests/problems-service.test.ts`:

```ts
test('ListMaxHeight is 30% of the viewport height and tracks resizes', () => {
    const { problems, viewport } = env(1000)
    expect(problems.ListMaxHeight).toBe(300)   // 0.3 * 1000
    viewport.push(800)
    expect(problems.ListMaxHeight).toBe(240)   // 0.3 * 800
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/Plexus && npx vitest run src/renderer/src/modules/problems/tests/problems-service.test.ts -t ListMaxHeight`
Expected: FAIL — `ListMaxHeight` is undefined.

- [ ] **Step 3: Add the ListMaxHeight DP and viewport wiring**

In `src/renderer/src/modules/problems/problems-service.ts`:

3a. Add the import near the other service imports:

```ts
import { ViewportService } from '../../services/viewport/viewport-service.js'
```

3b. Add module constants near the top of the file (after imports, before the `ProblemRowKind` enum):

```ts
// The Problems popup caps its scrollable list at this fraction of the live
// window height. When no ViewportService is available (headless edge cases), fall
// back to a fixed height so the list still scrolls rather than growing unbounded.
const LIST_HEIGHT_FRACTION = 0.3
const FALLBACK_LIST_MAX_HEIGHT = 240
```

3c. Add the DP (after `FilterTextKey`):

```ts
    // MaxHeight for the popup's scrollable list = 30% of the live window height.
    // Bound by the .mu ScrollViewer; recomputed whenever ViewportService.Height
    // changes.
    public static readonly ListMaxHeightKey = Model.RegisterProperty<number>(
        ProblemsService, 'ListMaxHeight', FALLBACK_LIST_MAX_HEIGHT, MetaData.None)
```

3d. Add the getter (after the `FilterText` getter/setter):

```ts
    public get ListMaxHeight(): number { return this.get_property_value(ProblemsService.ListMaxHeightKey) }
```

3e. In the constructor, after the existing `store?.Subscribe(...)` line and before `this.rebuild()`, wire the viewport:

```ts
        const viewport = provider.get(ViewportService.Key)
        if (viewport !== undefined) {
            this.updateListMaxHeight(viewport.Height)
            viewport.Subscribe(() => this.updateListMaxHeight(viewport.Height))
        }
```

3f. Add the private updater method (e.g. after `matchesFilter`):

```ts
    private updateListMaxHeight(height: number): void
    {
        const h = height > 0 ? Math.round(height * LIST_HEIGHT_FRACTION) : FALLBACK_LIST_MAX_HEIGHT
        this.set_property_value(ProblemsService.ListMaxHeightKey, h)
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/Plexus && npx vitest run src/renderer/src/modules/problems/tests/problems-service.test.ts`
Expected: PASS — all Problems tests including `ListMaxHeight`.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/Plexus
git add src/renderer/src/modules/problems/problems-service.ts src/renderer/src/modules/problems/tests/problems-service.test.ts
git commit -m "$(cat <<'EOF'
feat(problems): expose ListMaxHeight = 30% of live window height

ProblemsService derives a bindable ListMaxHeight from ViewportService.Height
(recomputed on resize), with a fixed fallback when no viewport is present. The
popup's ScrollViewer binds this to cap the list.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: ProblemsService — copy commands, clear filters, per-row copy, close-on-activate

**Files:**
- Modify: `src/renderer/src/modules/problems/problems-service.ts`
- Test: `src/renderer/src/modules/problems/tests/problems-service.test.ts`

**Interfaces:**
- Consumes: `ClipboardService` (Task 1), resolved optionally via `provider.get`.
- Produces:
  - On `ProblemsRow`: DP `CopyCommand: ICommand | undefined` with getter/setter.
  - On `ProblemsService`: DPs `CopyAllCommand`/`ClearFiltersCommand` (getters), private `copyAll()`, `copyOne(d)`, `clearFilters()`; module fn `problemLine(d: Diagnostic): string`; `rebuild` assigns each diagnostic row a `CopyCommand`; `ActivateRow` sets `IsOpen = false` after navigating.

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/src/modules/problems/tests/problems-service.test.ts`:

```ts
test('CopyAllCommand copies the filtered rows as text; a row CopyCommand copies just its line', async () => {
    const { store, problems, clipped } = env()
    store.Publish('todl', '/p', [
        diag({ uri: 'a.todl', message: 'boom', severity: DiagnosticSeverity.Error, span: { startLine: 2, startColumn: 3, endLine: 2, endColumn: 4 } }),
        diag({ uri: 'b.todl', message: 'quiet', severity: DiagnosticSeverity.Warning, span: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 2 } }),
    ])
    problems.ShowWarnings = false   // hide the warning; copy-all is WYSIWYG

    problems.CopyAllCommand!.Execute()
    await Promise.resolve()
    expect(clipped.at(-1)).toBe('ERROR  a.todl 2:3  boom')

    const errorRow = [...problems.Rows].find((r) => r.Kind === ProblemRowKind.Diagnostic)!
    errorRow.CopyCommand!.Execute()
    await Promise.resolve()
    expect(clipped.at(-1)).toBe('ERROR  a.todl 2:3  boom')
})

test('ClearFiltersCommand resets text and both severity toggles, restoring all rows', () => {
    const { store, problems } = env()
    store.Publish('todl', '/p', [
        diag({ uri: 'a.todl', message: 'boom', severity: DiagnosticSeverity.Error }),
        diag({ uri: 'a.todl', message: 'quiet', severity: DiagnosticSeverity.Warning }),
    ])
    problems.ShowWarnings = false
    problems.FilterText = 'boom'
    expect([...problems.Rows].filter((r) => r.Kind === ProblemRowKind.Diagnostic).length).toBe(1)

    problems.ClearFiltersCommand!.Execute()
    expect(problems.FilterText).toBe('')
    expect(problems.ShowErrors).toBe(true)
    expect(problems.ShowWarnings).toBe(true)
    expect([...problems.Rows].filter((r) => r.Kind === ProblemRowKind.Diagnostic).length).toBe(2)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/Plexus && npx vitest run src/renderer/src/modules/problems/tests/problems-service.test.ts -t Copy`
Expected: FAIL — `CopyAllCommand`/`CopyCommand`/`ClearFiltersCommand` are undefined.

- [ ] **Step 3: Implement the commands, formatter, per-row copy, and close-on-activate**

In `src/renderer/src/modules/problems/problems-service.ts`:

3a. Add the import near the other service imports:

```ts
import { ClipboardService } from '../../services/clipboard/clipboard-service.js'
```

3b. On `ProblemsRow`, add the `CopyCommand` DP (after `ActivateCommandKey`) and its getter/setter (after the `ActivateCommand` getter/setter):

```ts
    public static readonly CopyCommandKey = Model.RegisterProperty<ICommand | undefined>(
        ProblemsRow, 'CopyCommand', undefined, MetaData.None)
```
```ts
    public get CopyCommand(): ICommand | undefined { return this.get_property_value(ProblemsRow.CopyCommandKey) }
    public set CopyCommand(v: ICommand | undefined) { this.set_property_value(ProblemsRow.CopyCommandKey, v) }
```

3c. On `ProblemsService`, add the command DPs (after `ListMaxHeightKey`) and getters (after the `ListMaxHeight` getter):

```ts
    public static readonly CopyAllCommandKey = Model.RegisterProperty<ICommand | undefined>(
        ProblemsService, 'CopyAllCommand', undefined, MetaData.None)
    public static readonly ClearFiltersCommandKey = Model.RegisterProperty<ICommand | undefined>(
        ProblemsService, 'ClearFiltersCommand', undefined, MetaData.None)
```
```ts
    public get CopyAllCommand(): ICommand | undefined { return this.get_property_value(ProblemsService.CopyAllCommandKey) }
    public get ClearFiltersCommand(): ICommand | undefined { return this.get_property_value(ProblemsService.ClearFiltersCommandKey) }
```

3d. In the constructor, before `this.rebuild()`, create the commands:

```ts
        this.set_property_value(ProblemsService.CopyAllCommandKey, new RelayCommand(() => void this.copyAll()))
        this.set_property_value(ProblemsService.ClearFiltersCommandKey, new RelayCommand(() => this.clearFilters()))
```

3e. In `ActivateRow`, close the popup after navigating (replaces the early-return-only body):

```ts
    public ActivateRow(row: ProblemsRow): void
    {
        if (row.Uri === null) return
        void this.Provider.get(ProjectExplorerService.Key)?.OpenFileInProject(row.ProjectId, row.Uri, row.Line, row.Column)
        this.IsOpen = false
    }
```

3f. In `rebuild()`, assign each diagnostic row a `CopyCommand` when it's built. In the `for (const d of proj.diags)` loop, after `row.ActivateCommand = new RelayCommand(() => this.ActivateRow(row))`, add:

```ts
                row.CopyCommand = new RelayCommand(() => void this.copyOne(d))
```

3g. Add the copy/clear methods (after `updateListMaxHeight`):

```ts
    // Copy every currently displayed (filtered) diagnostic as text — WYSIWYG with
    // the visible list. Re-derives the filtered set from the store so it reflects
    // the current toggles/text.
    private async copyAll(): Promise<void>
    {
        const store = this.Provider.get(DiagnosticsService.Key)
        const all: Diagnostic[] = store ? [...store.All] : []
        const text = all.filter((d) => this.matchesFilter(d)).map(problemLine).join('\n')
        await this.Provider.get(ClipboardService.Key)?.writeText(text)
    }

    private async copyOne(d: Diagnostic): Promise<void>
    {
        await this.Provider.get(ClipboardService.Key)?.writeText(problemLine(d))
    }

    // Reset all filters and rebuild once (suppressRebuild coalesces the three DP
    // changes into a single rebuild at the end).
    private clearFilters(): void
    {
        this.suppressRebuild = true
        this.set_property_value(ProblemsService.FilterTextKey, '')
        this.set_property_value(ProblemsService.ShowErrorsKey, true)
        this.set_property_value(ProblemsService.ShowWarningsKey, true)
        this.suppressRebuild = false
        this.rebuild()
    }
```

3h. Add the module-level formatter + severity labels near the other free functions (after `summarize`):

```ts
const SEVERITY_LABEL: Record<DiagnosticSeverity, string> = {
    [DiagnosticSeverity.Error]:   'ERROR',
    [DiagnosticSeverity.Warning]: 'WARNING',
    [DiagnosticSeverity.Info]:    'INFO',
    [DiagnosticSeverity.Hint]:    'HINT',
}

// One clipboard line for a diagnostic: "<SEVERITY>  <file line:col>  <message>".
// The location segment collapses out for a project-level (null-uri) diagnostic.
function problemLine(d: Diagnostic): string
{
    return [SEVERITY_LABEL[d.severity], locationLabel(d), d.message].filter(Boolean).join('  ')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/Plexus && npx vitest run src/renderer/src/modules/problems/tests/problems-service.test.ts`
Expected: PASS — all Problems service tests.

- [ ] **Step 5: Typecheck and commit**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/Plexus
npm run typecheck
git add src/renderer/src/modules/problems/problems-service.ts src/renderer/src/modules/problems/tests/problems-service.test.ts
git commit -m "$(cat <<'EOF'
feat(problems): copy-all, per-row copy, clear-filters; close on activate

CopyAllCommand copies the filtered (WYSIWYG) rows; each row gets a CopyCommand
for its own line; ClearFiltersCommand resets text + both toggles in one rebuild.
Row lines format as "SEVERITY  file line:col  message". ActivateRow now closes
the popup after navigating.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Register services + add the copy icon

**Files:**
- Modify: `src/renderer/src/app.mu`
- Modify: `src/renderer/src/plexus-icons.mu`
- Create: `src/renderer/src/icons/copy.svg`

**Interfaces:**
- Consumes: `ClipboardService` (Task 1), `ViewportService` (Task 2).
- Produces: both services resolvable via their `Key` at runtime; a `@Copy` geometry resource for the popup's copy buttons.

- [ ] **Step 1: Add the copy icon SVG**

Create `src/renderer/src/icons/copy.svg` (Material "content_copy", 24×24):

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
</svg>
```

- [ ] **Step 2: Register the icon in plexus-icons.mu**

In `src/renderer/src/plexus-icons.mu`, add this line inside the `resources PlexusIcons { … }` block (e.g. after the `include "icons/file.svg" as File` line):

```
    // Copy glyph — the Problems popup's copy-all + per-row copy buttons.
    include "icons/copy.svg"                     as Copy
```

- [ ] **Step 3: Register the two services in app.mu**

In `src/renderer/src/app.mu`, add import lines near the other service imports (e.g. after the `EnvironmentService` import around line 59):

```
// Live window-height feed (ViewportService.Height) — the Problems popup caps its
// list at 30% of it. No view resources.
import ViewportService from "./services/viewport/viewport-service.js"

// System-clipboard seam — the Problems popup's copy actions write through it.
import ClipboardService from "./services/clipboard/clipboard-service.js"
```

Then add both to the `.services:` block (e.g. right after `EnvironmentService` at line 156):

```
        // Live viewport (window) height, bindable + resize-reactive. The Problems
        // popup derives its 30% list cap from this.
        ViewportService
        // System clipboard seam for the Problems popup's copy-all + per-row copy.
        ClipboardService
```

- [ ] **Step 4: Compile the .mu and typecheck**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/Plexus && npm run compile:mu && npm run typecheck`
Expected: `compile:mu` exits 0 (icon splices, app.mu compiles); typecheck clean.

- [ ] **Step 5: Run the full suite and commit**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/Plexus && npx vitest run`
Expected: PASS (full suite green).

```bash
cd /c/Users/Eugene/Projects/architecture-agent/Plexus
git add src/renderer/src/icons/copy.svg src/renderer/src/plexus-icons.mu src/renderer/src/app.mu
git add src/renderer/src/plexus-icons.mu.js src/renderer/src/app.mu.js 2>/dev/null || true
git commit -m "$(cat <<'EOF'
feat(problems): register ViewportService + ClipboardService; add @Copy icon

Wire the two new services into the app root and add a content_copy geometry for
the Problems popup's copy buttons.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

Note: `npm run compile:mu` regenerates `*.mu.js` next to the `.mu` sources; include any regenerated `app.mu.js` / `plexus-icons.mu.js` in the commit (the `git add … 2>/dev/null || true` above is a no-op if the repo ignores them — check `git status` and add whatever compile produced).

---

## Task 7: Rework the popup — header/toolbar + capped virtualized list

**Files:**
- Modify: `src/renderer/src/modules/problems/problems.resources.mu`
- Test: `src/renderer/src/modules/problems/tests/problems-datacontext.test.ts` (verify still green; extend only if needed)

**Interfaces:**
- Consumes: `ProblemsService` DPs `Rows`, `ListMaxHeight`, `ShowErrors`, `ShowWarnings`, `FilterText`, `ErrorCount`, `WarningCount`, `SummaryText`, `IsOpen`, `CopyAllCommand`, `ClearFiltersCommand`; `ProblemsRow` DPs `Label`, `Detail`, `ActivateCommand`, `CopyCommand`; resource `@Copy` (Task 6); existing keys `@ProblemsDockTrigger`, `@ProblemsTriggerChrome`, `@TabMenuRowButton`, `@CompactHeaderIconButton`, theme brushes.
- Produces: keyed templates `@ProblemsPopup` (MenuButton control Template) and `@ProblemsListPanel` (ItemsPanelTemplate); an updated `@ProblemsDock` and `ProblemsRow` DataTemplate.

- [ ] **Step 1: Rewrite problems.resources.mu**

Replace the body of `src/renderer/src/modules/problems/problems.resources.mu` (keep the leading comment block and the two `import` lines) so the `resources ProblemsResources { … }` block reads:

```
resources ProblemsResources {
    DataTemplate x:key="ProblemsDock" [ DataType = ProblemsService ] {
        MenuButton
            [ Header              = $SummaryText,
              IsOpen              = $IsOpen,
              Template            = @ProblemsPopup,
              TriggerTemplate     = @ProblemsDockTrigger,
              HorizontalAlignment = Left ]
    }

    // Trigger face (unchanged): the summary pill.
    Template x:key="ProblemsDockTrigger" [ TargetType = MenuButton ] {
        Button x:name="PART_Trigger" [ Template = @ProblemsTriggerChrome ] {
            StackPanel x:name="PART_TriggerStack" [ Orientation = Horizontal, VerticalAlignment = Center ] {
                TextBlock x:name="PART_HeaderText"
                    [ Style = @LabelMedium, Foreground = @OnSurfaceVariant, VerticalAlignment = Center ]
            }
        }
    }

    Template x:key="ProblemsTriggerChrome" [ TargetType = Button ] {
        Border x:name="PART_Primary" [ Background = @SurfaceContainerHigh, CornerRadius = @ShapeFull, BorderThickness = (0) ] {
            Border x:name="PART_PrimaryState" [ Background = #00000000, CornerRadius = @ShapeFull, Padding = (10,3,10,3) ] {
                ContentPresenter [ HorizontalAlignment = Center, VerticalAlignment = Center ]
            }
        }
        when ( IsMouseOver ) { PART_PrimaryState.Background = @OnSurfaceVariantHoverLayer; }
        when ( IsPressed ) { PART_PrimaryState.Background = @OnSurfaceVariantPressLayer; }
        when ( IsEnabled = false ) { PART_Primary.Opacity = @DisabledContentOpacity; }
    }

    // The list's virtualizing panel — a fixed row height keeps virtualization
    // cheap (rows are single-line).
    ItemsPanelTemplate x:key="ProblemsListPanel" {
        VirtualizingStackPanel [ Orientation = Vertical, ItemHeight = 28 ]
    }

    // The popup control template. Preserves the MenuButton popup contract (root
    // MenuPopupHost = PART_PopupHost, a PART_Scrim ClickAwayScrim, a
    // PART_PopupContainer Border) and adds a header/toolbar above a height-capped,
    // virtualized ItemsControl bound to $Rows. Data bindings ($Rows, $ListMaxHeight,
    // $ShowErrors, …) resolve against the templated MenuButton's DataContext, which
    // is the ProblemsService (from the @ProblemsDock DataTemplate).
    Template x:key="ProblemsPopup" [ TargetType = MenuButton ] {
        MenuPopupHost x:name="PART_PopupHost" {
            ClickAwayScrim x:name="PART_Scrim" [ BorderThickness = (0) ]
            Border x:name="PART_PopupContainer"
                [ Background = @SurfaceContainerHigh, BorderBrush = @OutlineVariant, BorderThickness = (1),
                  CornerRadius = @ShapeExtraSmall, Effect = @Elevation2, Padding = (0) ] {
                DockPanel [ LastChildFill = true, MinWidth = 340 ] {
                    // Header + toolbar (docked Top).
                    DockPanel [ DockPanel.Dock = Top, LastChildFill = true, Margin = (8,6,8,6) ] {
                        // Right cluster: copy-all + clear.
                        StackPanel [ DockPanel.Dock = Right, Orientation = Horizontal, VerticalAlignment = Center ] {
                            IconButton [ Template = @CompactHeaderIconButton, Command = $CopyAllCommand, Margin = (4,0,0,0) ] {
                                Shape [ Geometry = @Copy, Fill = @OnSurfaceVariant, Width = 12, Height = 12 ]
                            }
                            Button [ Command = $ClearFiltersCommand, Margin = (8,0,0,0) ] {
                                TextBlock [ Text = "Clear", Style = @LabelMedium, Foreground = @OnSurfaceVariant ]
                            }
                        }
                        // Left cluster: title + severity toggles + filter box.
                        StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {
                            TextBlock [ Text = "Problems", Style = @LabelLarge, Foreground = @OnSurface, VerticalAlignment = Center, Margin = (0,0,12,0) ]
                            ToggleButton [ IsChecked = $ShowErrors, VerticalAlignment = Center, Margin = (0,0,6,0) ] {
                                TextBlock [ Text = $ErrorCount, Style = @LabelMedium ]
                            }
                            ToggleButton [ IsChecked = $ShowWarnings, VerticalAlignment = Center, Margin = (0,0,12,0) ] {
                                TextBlock [ Text = $WarningCount, Style = @LabelMedium ]
                            }
                            TextBox [ Text = $FilterText, Variant = Plain, MinWidth = 120, VerticalAlignment = Center ]
                        }
                    }
                    // Capped, virtualized list (fills the remainder).
                    ScrollViewer [ MaxHeight = $ListMaxHeight, HorizontalScrollEnabled = false ] {
                        ItemsControl [ ItemsSource = $Rows, ItemsPanel = @ProblemsListPanel ]
                    }
                }
            }
        }
    }

    // One row: copy button (docked right) + activate button (fills). Siblings, not
    // nested — clicking copy never triggers navigation. Project-header rows carry no
    // command, so both buttons are inert for them.
    DataTemplate [ DataType = ProblemsRow ] {
        DockPanel [ LastChildFill = true ] {
            IconButton [ DockPanel.Dock = Right, Template = @CompactHeaderIconButton, Command = $CopyCommand, VerticalAlignment = Center, Margin = (8,0,4,0) ] {
                Shape [ Geometry = @Copy, Fill = @OnSurfaceVariant, Width = 11, Height = 11 ]
            }
            Button [ Template = @TabMenuRowButton, Command = $ActivateCommand, HorizontalAlignment = Stretch, MinWidth = 240 ] {
                DockPanel [ LastChildFill = true ] {
                    TextBlock [ DockPanel.Dock = Right, Text = $Detail, Foreground = @OnSurfaceVariant, VerticalAlignment = Center, Margin = (12,0,0,0) ]
                    TextBlock [ Text = $Label, Foreground = @OnSurface, VerticalAlignment = Center ]
                }
            }
        }
    }
}
```

- [ ] **Step 2: Compile the .mu**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/Plexus && npm run compile:mu`
Expected: exits 0, all files compiled. If it errors on an unknown resource key (`@LabelLarge`, `@CompactHeaderIconButton`, `@Elevation2`, `@ShapeExtraSmall`, `@OutlineVariant`, `Variant = Plain`), that key/prop name differs in this codebase — grep for the correct name and fix:
- Run `grep -rn "LabelLarge\|LabelMedium" src/renderer/src --include=*.mu | head` to confirm the label style key; use the confirmed one.
- Run `grep -rn "CompactHeaderIconButton" src/renderer/src/services/document-tabs/document-tabs.resources.mu` to confirm the compact icon-button template key.
- If `Variant = Plain` is rejected on `TextBox`, drop it (the default TextBox variant is fine); the project-explorer inline-rename TextBox uses `Variant = Plain`, so it should resolve.

- [ ] **Step 3: Verify the DataContext regression test still passes**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/Plexus && npx vitest run src/renderer/src/modules/problems/tests/problems-datacontext.test.ts`
Expected: PASS unchanged — the test constructs `ProblemsService` with only `DiagnosticsService` registered; the service resolves `ViewportService`/`ClipboardService` optionally (`provider.get`), so their absence is tolerated (`ListMaxHeight` uses the fallback; copy commands become no-ops). If this test fails because the constructor now throws on a missing service, change that resolution to `provider.get(...)` (never `getRequired`) — the constructor must not require either new service.

- [ ] **Step 4: Full typecheck + suite**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/Plexus && npm run typecheck && npx vitest run`
Expected: typecheck clean; full suite green.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/Plexus
git add src/renderer/src/modules/problems/problems.resources.mu
git status --short   # add any regenerated problems.resources.mu.js the compile produced
git add src/renderer/src/modules/problems/problems.resources.mu.js 2>/dev/null || true
git commit -m "$(cat <<'EOF'
feat(problems): popup header/toolbar + capped virtualized list

Override the MenuButton popup template: a header/toolbar (severity toggles with
counts, filter box, copy-all, clear) above a ScrollViewer(MaxHeight=$ListMaxHeight)
wrapping a VirtualizingStackPanel-backed ItemsControl over $Rows. Rows gain a copy
button as a sibling of the activate button.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Manual smoke (report, don't block)**

`npm run dev` recompiles the `.mu`. Open the app, trigger a validation with several problems, click the status-bar summary pill, and confirm: the popup shows the header/toolbar; the list scrolls and never exceeds ~30% of the window height; toggling Errors/Warnings and typing in the filter narrows the list; Copy and per-row copy write to the clipboard; Clear resets the filters; resizing the window changes the list cap. Report findings — this step does not block plan completion (headless tests are the gate).

---

## Self-Review

**1. Spec coverage:**
- Status-bar popup target (not a new panel) → Task 7 overrides the existing `MenuButton` popup. ✓
- Header/toolbar with severity filters + counts → Task 3 (filter state) + Task 7 (toolbar). ✓
- Text filter → Task 3 + Task 7. ✓
- Copy-all (filtered/WYSIWYG) → Task 5 (`copyAll` re-derives filtered) + Task 7 button. ✓
- Per-row copy → Task 5 (`ProblemsRow.CopyCommand`) + Task 7 row button. ✓
- Clear = reset filters → Task 5 (`clearFilters`) + Task 7 button. ✓
- 30% responsive height cap → Task 2 (`ViewportService`) + Task 4 (`ListMaxHeight`) + Task 7 `ScrollViewer MaxHeight`. ✓
- Virtualized → Task 7 `@ProblemsListPanel` (`VirtualizingStackPanel`). ✓
- New `ViewportService` + `ClipboardService` → Tasks 1, 2, 6. ✓
- Counts stay totals → Task 3 (totals over full `all`). ✓
- Tests in `tests/` subfolders → all test paths comply. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step is concrete. Task 7 Step 2 lists explicit grep-and-fix fallbacks for resource-key name drift (a real risk with cross-module `.mu` keys), which is guidance, not a placeholder. ✓

**3. Type consistency:** `ListMaxHeight`, `ShowErrors`, `ShowWarnings`, `FilterText`, `CopyAllCommand`, `ClearFiltersCommand`, `CopyCommand`, `problemLine`, `matchesFilter`, `updateListMaxHeight`, `copyAll`, `copyOne`, `clearFilters`, `suppressRebuild`, `LIST_HEIGHT_FRACTION`, `FALLBACK_LIST_MAX_HEIGHT`, `IViewportSource`, `ClipboardWriter` are named identically across the tasks that define and consume them. `ViewportService.Key`/`ClipboardService.Key`/`HeightKey` match their registrations and `.mu`/test uses. ✓
```

# Project Explorer Drag-and-Drop (SP-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Drag selected file/folder node(s) in a project tree and drop them into a target subfolder (or the project header = root) to move them, within one project.

**Architecture:** A pure `node-move.ts` plans the moves; `ProjectExplorerService.moveNodes` executes them (reusing the rename plumbing via extracted `relocatePath`/`rescan`); a `TreeDragDropBehavior` drives the pointer-capture drag and invokes `OpenProject.MoveNodesCommand`.

**Tech Stack:** TypeScript (renderer), mural (`Behavior`, `Adorner`/`AdornerLayer`, routed pointer events), `.mu`, Vitest.

## Global Constraints

- Every test file in a `tests/` subfolder next to its source.
- Real TS enums; no new string-literal union types (`MoveArg` is an interface).
- Commits authored `Eugene Napryaglo <evgen.napryaglo@gmail.com>`; message ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Do NOT stage `src/renderer/src/modules/ontologies/services/ontologies-service.ts`.
- `.mu.js` are gitignored — regenerate with `npm run compile:mu`; do not commit them. No new `.mu` files → no `package.json` compile-list change.
- Verify from `Plexus/`: `npm test`, `npm run typecheck`, `npm run compile:mu`.

---

## Task 0: Branch

- [ ] **Step 1** — `git checkout -b explorer-drag-drop` (spec committed to `main`).

---

## Task 1: Pure move planning (`node-move.ts`)

**Files:**
- Create: `src/renderer/src/services/projects/node-move.ts`
- Test: `src/renderer/src/services/projects/tests/node-move.test.ts`

**Interfaces:**
- Produces: `resolveDropTargetPath(node: ProjectNode | undefined): string`; `interface PlannedMove { from: string; to: string; name: string }`; `interface MovePlan { moves: PlannedMove[]; rejects: { name: string; reason: string }[] }`; `planNodeMoves(nodes: readonly ProjectNode[], destParentPath: string): MovePlan`.

- [ ] **Step 1: Write the test** — `tests/node-move.test.ts`:

```ts
import { test, expect } from 'vitest'
import { ProjectNode } from '../project.js'
import { resolveDropTargetPath, planNodeMoves } from '../node-move.js'

const folder = (path: string) => new ProjectNode(path.split('/').pop() ?? path, path, 'folder')
const file = (path: string) => new ProjectNode(path.split('/').pop() ?? path, path, 'todl')

test('resolveDropTargetPath: folder → own path, file → parent, undefined → root', () => {
    expect(resolveDropTargetPath(folder('src/lib'))).toBe('src/lib')
    expect(resolveDropTargetPath(file('src/a.todl'))).toBe('src')
    expect(resolveDropTargetPath(file('a.todl'))).toBe('')
    expect(resolveDropTargetPath(undefined)).toBe('')
})

test('plans a straightforward move into a subfolder', () => {
    const plan = planNodeMoves([file('a.todl')], 'src')
    expect(plan.moves).toEqual([{ from: 'a.todl', to: 'src/a.todl', name: 'a.todl' }])
    expect(plan.rejects).toEqual([])
})

test('skips a node already in the destination folder', () => {
    const plan = planNodeMoves([file('src/a.todl')], 'src')
    expect(plan.moves).toEqual([])
    expect(plan.rejects).toEqual([])
})

test('rejects moving a folder into itself or a descendant', () => {
    expect(planNodeMoves([folder('src')], 'src').rejects.length).toBe(1)
    expect(planNodeMoves([folder('src')], 'src/lib').rejects.length).toBe(1)
    expect(planNodeMoves([folder('src')], 'src/lib').moves).toEqual([])
})

test('when a folder and its child are both selected, only the folder moves', () => {
    const plan = planNodeMoves([folder('src'), file('src/a.todl')], 'dst')
    expect(plan.moves).toEqual([{ from: 'src', to: 'dst/src', name: 'src' }])
})
```

- [ ] **Step 2: Run — fail** (`npx vitest run src/renderer/src/services/projects/tests/node-move.test.ts`).

- [ ] **Step 3: Implement `node-move.ts`:**

```ts
import { ProjectNode } from './project.js'

// Pure move-planning + drop-target resolution for the project tree. No storage —
// the service applies the plan (collision check + Rename + rescan). Kept separate
// so the interesting logic is unit-tested without a live IStorage or DOM.

// Project-relative path helpers (POSIX '/'; the storage backend translates).
function joinRel(dir: string, name: string): string { return dir === '' ? name : dir + '/' + name }
function parentOf(path: string): string { const i = path.lastIndexOf('/'); return i === -1 ? '' : path.slice(0, i) }

// The folder a drop over `node` targets: undefined (project header / empty area)
// → root ''; a folder → its own path; a file → its containing folder.
export function resolveDropTargetPath(node: ProjectNode | undefined): string
{
    if (node === undefined) return ''
    return node.Kind === 'folder' ? node.Path : parentOf(node.Path)
}

export interface PlannedMove { from: string; to: string; name: string }
export interface MovePlan { moves: PlannedMove[]; rejects: { name: string; reason: string }[] }

// Plan moving `nodes` into `destParentPath`. Drops a node whose ancestor is also
// selected (a folder move carries its descendants); skips a node already in the
// destination; rejects moving a folder into itself or a descendant. Name
// collisions are checked later, against storage.
export function planNodeMoves(nodes: readonly ProjectNode[], destParentPath: string): MovePlan
{
    const moves: PlannedMove[] = []
    const rejects: { name: string; reason: string }[] = []
    const paths = nodes.map((n) => n.Path)
    for (const node of nodes) {
        if (paths.some((p) => p !== node.Path && node.Path.startsWith(p + '/'))) continue   // ancestor selected
        if (parentOf(node.Path) === destParentPath) continue                                 // already there
        if (destParentPath === node.Path || destParentPath.startsWith(node.Path + '/')) {    // into self/descendant
            rejects.push({ name: node.Name, reason: 'into itself' }); continue
        }
        moves.push({ from: node.Path, to: joinRel(destParentPath, node.Name), name: node.Name })
    }
    return { moves, rejects }
}
```

- [ ] **Step 4: Run — pass.** Typecheck.

- [ ] **Step 5: Commit** `feat(projects): pure node-move planning + drop-target resolution`.

---

## Task 2: `MoveNodesCommand` + `moveNodes` in the explorer

**Files:**
- Modify: `src/renderer/src/services/projects/open-project.ts` (MoveNodesCommand DP)
- Modify: `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts`
- Test: `src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts` (extend)

**Interfaces:**
- Consumes: `planNodeMoves` (Task 1).
- Produces: `OpenProject.MoveNodesCommand`; `ProjectExplorerService.moveNodes(op, nodes, destParentPath)`, `relocatePath(op, from, to)`, `rescan(op)`; `interface MoveArg { nodes: readonly ProjectNode[]; destPath: string }` (exported for the behavior).

- [ ] **Step 1: Add `MoveNodesCommand` to `open-project.ts`** — DP + accessor beside `NewFileCommand`:

```ts
    static readonly MoveNodesCommandKey = Model.RegisterProperty<ICommand | undefined>(
        OpenProject, 'MoveNodesCommand', undefined, MetaData.None)
```

```ts
    public get MoveNodesCommand(): ICommand | undefined { return this.get_property_value(OpenProject.MoveNodesCommandKey) }
    public set MoveNodesCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.MoveNodesCommandKey, v) }
```

- [ ] **Step 2: Extend the explorer test** — add `moveNodes` to the `ExplorerPrivates` interface, then cases (append near the rename/delete tests). The harness's factory `openProject` returns a fixed tree, so assert on the FakeStorage state (the move actually renames), not the rescanned tree:

```ts
// (add to interface ExplorerPrivates)
    moveNodes(op: OpenProject, nodes: readonly ProjectNode[], destParentPath: string): Promise<void>
```

```ts
test('moveNodes renames a file into a subfolder on storage', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/p')
    await storage.WriteText('a.todl', 'x')
    await storage.CreateDirectory('src')
    const op = await priv.addOpenProject(projectWith('P', 'C:/p'), fakeProjectFactory(), storage)
    await priv.moveNodes(op, [new ProjectNode('a.todl', 'a.todl', 'todl')], 'src')
    expect(await storage.Exists('src/a.todl')).toBe(true)
    expect(await storage.Exists('a.todl')).toBe(false)
})

test('moveNodes skips a name collision, leaving both paths intact', async () => {
    const { priv, service } = makeExplorer()
    const storage = new FakeStorage('C:/p')
    await storage.WriteText('a.todl', 'x')
    await storage.WriteText('src/a.todl', 'y')
    const op = await priv.addOpenProject(projectWith('P', 'C:/p'), fakeProjectFactory(), storage)
    await priv.moveNodes(op, [new ProjectNode('a.todl', 'a.todl', 'todl')], 'src')
    expect(await storage.ReadText('a.todl')).toBe('x')        // not moved
    expect(await storage.ReadText('src/a.todl')).toBe('y')    // untouched
    expect(service.Status).toMatch(/exist/i)
})

test('moveNodes into the current parent is a silent no-op', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/p')
    await storage.WriteText('src/a.todl', 'x')
    const op = await priv.addOpenProject(projectWith('P', 'C:/p'), fakeProjectFactory(), storage)
    await priv.moveNodes(op, [new ProjectNode('a.todl', 'src/a.todl', 'todl')], 'src')
    expect(await storage.Exists('src/a.todl')).toBe(true)
})
```

- [ ] **Step 3: Run — fail** (`moveNodes` missing).

- [ ] **Step 4: Implement in `project-explorer-service.ts`.** Add the import:

```ts
import { planNodeMoves } from '../../../services/projects/node-move.js'
```

Export the arg shape (near the top-level exports, e.g. by `importFilters`):

```ts
// The command argument for OpenProject.MoveNodesCommand — the dragged nodes and
// the destination folder path (project-relative; '' = root). Exported so the
// drag behavior can construct it.
export interface MoveArg { nodes: readonly ProjectNode[]; destPath: string }
```

Extract the shared move steps from `commitRename` and refactor it to use them:

```ts
    // Rename a path on storage and re-point any open tabs under it. Shared by
    // rename (name change in place) and move (into another folder).
    private async relocatePath(op: OpenProject, fromPath: string, toPath: string): Promise<void>
    {
        await op.Storage.Rename(fromPath, toPath)
        this.repointOpenDocuments(op, fromPath, toPath)
    }

    // Re-scan the project so a structural change (rename/move/new) reappears with
    // correct paths, and re-wire the fresh nodes' commands.
    private async rescan(op: OpenProject): Promise<void>
    {
        op.Adopt(await op.Factory.openProject(op.Storage))
        this.wireNodes(op.Root, op)
    }
```

`commitRename`'s body (from the `Rename` line) becomes:

```ts
            if (await op.Storage.Exists(dest)) { this.Status = `"${proposed}" already exists.`; this.cancelRename(op, node); return }
            await this.relocatePath(op, node.Path, dest)
            op.EditingNode = undefined
            await this.rescan(op)
            this.Status = `Renamed to ${proposed}.`
```

Add `moveNodes`:

```ts
    // Move the given nodes into destParentPath (project-relative; '' = root),
    // within this project. Planning (ancestor-filter, already-there, self/
    // descendant) is pure; here we add the storage collision check + execute.
    private async moveNodes(op: OpenProject, nodes: readonly ProjectNode[], destParentPath: string): Promise<void>
    {
        const { moves, rejects } = planNodeMoves(nodes, destParentPath)
        const collisions: string[] = []
        let moved = 0
        for (const m of moves) {
            if (await op.Storage.Exists(m.to)) { collisions.push(m.name); continue }
            await this.relocatePath(op, m.from, m.to)
            moved++
        }
        if (moved > 0) await this.rescan(op)

        if (collisions.length === 0 && rejects.length === 0) {
            if (moved > 0) this.Status = `Moved ${moved} item(s).`
            return
        }
        const parts: string[] = []
        if (moved > 0) parts.push(`moved ${moved}`)
        if (collisions.length > 0) parts.push(`${collisions.length} already exist`)
        if (rejects.length > 0) parts.push(`${rejects.length} can't move there`)
        this.Status = `Move: ${parts.join(', ')}.`
    }
```

Wire the command in `wireProjectCommands` (beside the others):

```ts
        op.MoveNodesCommand = new RelayCommand((arg) => {
            const a = arg as MoveArg
            void this.moveNodes(op, a.nodes, a.destPath)
        })
```

- [ ] **Step 5: Run — pass** (`npx vitest run src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts`). Typecheck.

- [ ] **Step 6: Commit** `feat(project-explorer): moveNodes + MoveNodesCommand (drag-drop move backend)`.

---

## Task 3: `TreeDragDropBehavior` + template wiring

**Files:**
- Create: `src/renderer/src/services/projects/tree-drag-drop-behavior.ts`
- Modify: `src/renderer/src/modules/project-explorer/project-explorer.resources.mu`
- Modify: `src/renderer/src/app.mu` (register the behavior symbol if module `.services:` resolution requires it — see Step 3)

**Interfaces:**
- Consumes: `resolveDropTargetPath` (Task 1); `MoveArg` (Task 2); `OpenProject.MoveNodesCommand`.

- [ ] **Step 1: Implement `tree-drag-drop-behavior.ts`** — pointer-capture drag mirroring mural's `MarqueeSelectionBehavior` (same `AddRoutedEventListener('PointerDown'|'PointerMove'|'PointerUp')`, `args.CapturePointer`/`ReleasePointerCapture`, `args.HostX/HostY/Source`, `GetVisualParent()`, `ArrangedRect`, `AdornerLayer.GetAdornerLayer`):

```ts
import { Adorner, AdornerLayer, Behavior, Color, Rect, Size, type Visual } from '@pragmatic-tech-ai/mural/runtime'
import { Pen, SolidColorBrush } from '@pragmatic-tech-ai/mural/visual-engine'

import { OpenProject } from './open-project.js'
import { ProjectNode } from './project.js'
import { resolveDropTargetPath } from './node-move.js'
import type { MoveArg } from '../../modules/project-explorer/services/project-explorer-service.js'

const DRAG_THRESHOLD_PX = 4
const HIGHLIGHT = new SolidColorBrush(Color.FromHex('#3699cc33'))
const HIGHLIGHT_PEN = (() => { const p = new Pen(); p.Brush = new SolidColorBrush(Color.FromHex('#3699cc')); p.Thickness = 1; return p })()

// Highlights the drop-target row: a translucent rounded rectangle over the row's
// rect (in adorner-layer coordinates). Non-hit-test so it never eats the pointer.
class DropTargetAdorner extends Adorner
{
    private rect = new Rect(0, 0, 0, 0)
    constructor(adorned: Visual) { super(adorned); this.IsHitTestVisible = false }
    public SetRect(r: Rect): void { this.rect = r; this.InvalidateArrange(); this.GetVisualParent()?.InvalidateArrange() }
    public Placement(): Rect { return this.rect }
    public MeasureOverride(): Size { return Size.Zero }
    public RenderOverride(dc: { DrawRectangle(fill: unknown, pen: unknown, rect: Rect): void }): void
    {
        const s = this.RenderSize
        if (s.Width <= 0 || s.Height <= 0) return
        dc.DrawRectangle(HIGHLIGHT, HIGHLIGHT_PEN, new Rect(0, 0, s.Width, s.Height))
    }
}

// Origin of `v` within `stop` (accumulated ArrangedRect offsets) — for placing
// the adorner rect in the layer's coordinate space.
function originIn(v: Visual, stop: Visual | undefined): { x: number; y: number }
{
    let x = 0, y = 0
    let cur: Visual | undefined = v
    while (cur !== undefined && cur !== stop) { x += cur.ArrangedRect.X; y += cur.ArrangedRect.Y; cur = cur.GetVisualParent() }
    return { x, y }
}

export class TreeDragDropBehavior extends Behavior
{
    private tree: Visual | undefined
    private readonly onDown = (a: PointerArgs): void => this.down(a)
    private readonly onMove = (a: PointerArgs): void => this.move(a)
    private readonly onUp = (a: PointerArgs): void => this.up(a)

    private armed = false
    private active = false
    private startX = 0
    private startY = 0
    private dragged: readonly ProjectNode[] = []
    private destPath: string | undefined
    private layer: AdornerLayer | undefined
    private adorner: DropTargetAdorner | undefined

    public override OnAttached(visual: Visual): void
    {
        this.tree = visual
        visual.AddRoutedEventListener('PointerDown', this.onDown)
        visual.AddRoutedEventListener('PointerMove', this.onMove)
        visual.AddRoutedEventListener('PointerUp', this.onUp)
    }

    public override OnDetached(visual: Visual): void
    {
        visual.RemoveRoutedEventListener('PointerDown', this.onDown)
        visual.RemoveRoutedEventListener('PointerMove', this.onMove)
        visual.RemoveRoutedEventListener('PointerUp', this.onUp)
        this.reset()
    }

    private get op(): OpenProject | undefined
    {
        const dc = this.tree?.DataContext
        return dc instanceof OpenProject ? dc : undefined
    }

    // Walk up from a hit visual to the nearest row's ProjectNode, requiring the
    // chain to pass through THIS tree (so a hit in another project resolves to no
    // target — SP-1 is intra-project). Returns { node, row } or undefined.
    private rowAt(source: Visual | undefined): { node: ProjectNode; row: Visual } | undefined
    {
        let cur: Visual | undefined = source
        let sawTree = false
        let found: { node: ProjectNode; row: Visual } | undefined
        while (cur !== undefined) {
            if (found === undefined && cur.DataContext instanceof ProjectNode) found = { node: cur.DataContext, row: cur }
            if (cur === this.tree) { sawTree = true; break }
            cur = cur.GetVisualParent()
        }
        return sawTree ? found : undefined
    }

    private down(a: PointerArgs): void
    {
        const hit = this.rowAt(a.Source)
        if (hit === undefined || this.op === undefined) return
        const selected = this.op.SelectedNodes
        this.dragged = selected.includes(hit.node) ? selected : [hit.node]
        this.startX = a.HostX; this.startY = a.HostY
        this.armed = true; this.active = false
    }

    private move(a: PointerArgs): void
    {
        if (!this.armed) return
        if (!this.active) {
            if (Math.abs(a.HostX - this.startX) < DRAG_THRESHOLD_PX && Math.abs(a.HostY - this.startY) < DRAG_THRESHOLD_PX) return
            this.active = true
            a.CapturePointer(this.tree!)
            this.layer = AdornerLayer.GetAdornerLayer(this.tree!)
        }
        const hit = this.rowAt(a.Source)
        this.destPath = hit !== undefined ? resolveDropTargetPath(hit.node) : (a.Source !== undefined && this.rowAt(a.Source) === undefined && this.withinTree(a.Source) ? '' : undefined)
        // Highlight the hovered row (or clear when off-target).
        if (hit !== undefined && this.layer !== undefined) {
            if (this.adorner === undefined) { this.adorner = new DropTargetAdorner(this.tree!); this.layer.Add(this.adorner) }
            const o = originIn(this.layer, undefined)
            const r = originIn(hit.row, undefined)
            this.adorner.SetRect(new Rect(r.x - o.x, r.y - o.y, hit.row.ArrangedRect.Width, hit.row.ArrangedRect.Height))
        } else { this.clearAdorner() }
        a.Handled = true
    }

    private up(a: PointerArgs): void
    {
        if (!this.armed) return
        const wasActive = this.active
        const op = this.op
        const dest = this.destPath
        const nodes = this.dragged
        if (wasActive) a.ReleasePointerCapture()
        this.reset()
        if (wasActive && op !== undefined && dest !== undefined && nodes.length > 0) {
            op.MoveNodesCommand?.Execute({ nodes, destPath: dest } satisfies MoveArg)
            a.Handled = true
        }
    }

    // Is `v` inside this tree (used to accept a drop on empty tree area → root)?
    private withinTree(v: Visual | undefined): boolean
    {
        let cur: Visual | undefined = v
        while (cur !== undefined) { if (cur === this.tree) return true; cur = cur.GetVisualParent() }
        return false
    }

    private clearAdorner(): void
    {
        if (this.adorner !== undefined && this.layer !== undefined) this.layer.Remove(this.adorner)
        this.adorner = undefined
    }

    private reset(): void
    {
        this.clearAdorner()
        this.layer = undefined
        this.armed = false; this.active = false
        this.dragged = []; this.destPath = undefined
    }
}

// The pointer routed-event args this behavior reads (subset of mural's).
interface PointerArgs
{
    HostX: number; HostY: number; Source?: Visual; Handled: boolean
    CapturePointer(v: Visual): void; ReleasePointerCapture(): void
}
```

- [ ] **Step 2: Attach in the template** — in `project-explorer.resources.mu`, import the behavior and add it to the tree's `.Behaviors:` block (beside `TreeSelectionBehavior`):

Import (beside `TreeSelectionBehavior`'s import at the top):
```
import TreeDragDropBehavior from "../../services/projects/tree-drag-drop-behavior.js"
```
Behaviors block (in `DataTemplate[OpenProject]` → `TreeView`):
```
                    .Behaviors: { TreeSelectionBehavior; TreeDragDropBehavior }
```

- [ ] **Step 3: compile:mu** — `npm run compile:mu`. If the compiler reports `TreeDragDropBehavior` as an unknown symbol (the `.mu` resolves behavior classes the same way it resolves `TreeSelectionBehavior` — confirm how `TreeSelectionBehavior` is made resolvable; it is imported in the resources `.mu` and needs no `.services:` entry), mirror exactly what `TreeSelectionBehavior` does. No `app.mu` change if `TreeSelectionBehavior` needed none.

- [ ] **Step 4: typecheck + full suite** — `npm run typecheck && npm test`. All green. Typecheck validates the behavior's mural API usage (routed events, adorner, visual) against the shipped `.d.ts`.

- [ ] **Step 5: Commit** `feat(project-explorer): TreeDragDropBehavior — drag selected nodes into a folder`.

---

## Task 4: Finish the branch

- [ ] **Step 1: Gate** — `npm run compile:mu && npm run typecheck && npm test` green; `git status` shows only `ontologies-service.ts` unstaged.
- [ ] **Step 2: Manual smoke note** — the pointer/adorner interaction is not unit-tested; call it out when finishing (drag a file onto a folder → it moves; onto the header → moves to root; invalid drops no-op with a status).
- [ ] **Step 3:** Invoke `superpowers:finishing-a-development-branch` — verify, present the 4 options, execute the choice (established pattern: merge to `main` + push).

---

## Self-Review Notes

- **Spec coverage:** unit 1 (MoveNodesCommand) → Task 2; unit 2 (moveNodes + helpers) → Task 2 + the pure `node-move.ts` in Task 1; unit 3 (behavior) → Task 3; unit 4 (template) → Task 3. Drop-target resolution + planning tested in Task 1; move execution tested in Task 2.
- **Type consistency:** `MoveArg { nodes, destPath }` is constructed in the behavior and destructured in the command; `resolveDropTargetPath`/`planNodeMoves` names match between `node-move.ts`, its test, the service, and the behavior. `relocatePath`/`rescan` reused by both `commitRename` and `moveNodes`.
- **Known risk:** Task 3's behavior depends on runtime visual APIs that typecheck (against mural `.d.ts`) but are only exercised at runtime — Task 4 flags the manual smoke. The `PointerArgs` interface is a local structural subset; if a member name differs from mural's routed-event args, typecheck against the actual event type surfaces it — if mural exports a concrete pointer-args type, use it instead of the local interface.
- **No placeholders:** every code step is complete; the one conditional (Task 3 Step 3 `.mu` symbol resolution) is resolved by mirroring `TreeSelectionBehavior`.
```

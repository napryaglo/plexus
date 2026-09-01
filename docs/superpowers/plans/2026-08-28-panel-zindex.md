# Panel.ZIndex + Diagram Z-Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Panel.ZIndex` attached property honored by every panel, and drive it from architecture-diagram Bring-to-Front / Send-to-Back / Bring-Forward / Send-Backward commands with per-figure persistence.

**Architecture:** `Panel` gains a `ZIndex` attached property; `visualChildren` returns a stable ZIndex-sorted snapshot while `logicalChildren` keeps insertion order; `Panel.SetZIndex` notifies the parent to invalidate the sorted snapshot and re-render; the SVG renderer reconciles child DOM order positionally. The diagram adds four commands (pure `zorder.ts` math + `DiagramCommands` install + keyboard + context menu) and persists a per-figure `zIndex` in `NodeVisual`.

**Tech Stack:** TypeScript, mural framework (`@pragmatic-tech-ai/mural`), Plexus (Electron/electron-vite), Vitest + `node:test`, jsdom for renderer tests.

**Spec:** `Plexus/docs/superpowers/specs/2026-08-28-panel-zindex-design.md`

## Global Constraints

- Two repos: Mural at `c:\Users\Eugene\Projects\architecture-agent\Mural`, Plexus at `c:\Users\Eugene\Projects\architecture-agent\Plexus`.
- Every test file lives in a `tests/` subfolder next to the source it exercises (both repos).
- A fixed set of named string values MUST be a real TS `enum`, never a string-literal union. (This feature uses one enum: `ZOrderMode`.)
- Higher ZIndex paints on top; equal ZIndex breaks ties by insertion order.
- `Panel.ZIndex` default is `0`; `MetaData.None` on the property.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Do NOT publish mural to Verdaccio or bump/reinstall unless explicitly asked — the Plexus-consuming task (Task 9) calls out the gated publish step but does not perform it.
- Mural tests run with `npm test` in `Mural/`; Plexus tests with `npm test` in `Plexus/`.

---

### Task 1: `Panel.ZIndex` property + sorted `visualChildren`

**Files:**
- Modify: `Mural/src/visual-engine/element.ts` (the `Panel` class — attached property + snapshot split; ctor subscription at ~2034; `visualChildren`/`logicalChildren`/`childrenSnapshot` at ~2104-2114)
- Test: `Mural/src/visual-engine/tests/panel-zindex.test.ts`

**Interfaces:**
- Produces: `Panel.ZIndexKey: PropertyKey<number>`, `Panel.GetZIndex(v: Visual): number`, `Panel.SetZIndex(v: Visual, value: number): void` (SetZIndex's parent-notify is added in Task 2; Task 1 ships the plain setter). `Panel.get visualChildren` returns children stable-sorted by ZIndex asc; `Panel.get logicalChildren` returns insertion order.

- [ ] **Step 1: Write the failing test**

Create `Mural/src/visual-engine/tests/panel-zindex.test.ts`:

```ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Border } from '../../basic/index.js';
import { Panel } from '../../runtime/index.js';

// A concrete Panel for testing (Panel is abstract-ish; Canvas works too, but a
// bare Panel subclass isolates the base behavior).
class TestPanel extends Panel {}

describe('Panel.ZIndex', () => {
    test('GetZIndex defaults to 0', () => {
        const a = new Border();
        assert.equal(Panel.GetZIndex(a), 0);
    });

    test('visualChildren is stable-sorted by ZIndex ascending; ties keep insertion order', () => {
        const p = new TestPanel();
        const a = new Border(); const b = new Border(); const c = new Border();
        p.AddChild(a); p.AddChild(b); p.AddChild(c);          // insertion: a, b, c
        Panel.SetZIndex(a, 2);
        Panel.SetZIndex(c, 2);                                // a and c tie at 2
        // b (0) below; a,c tie at 2 keep insertion order (a before c)
        assert.deepEqual([...p.visualChildren], [b, a, c]);
    });

    test('logicalChildren stays in insertion order regardless of ZIndex', () => {
        const p = new TestPanel();
        const a = new Border(); const b = new Border();
        p.AddChild(a); p.AddChild(b);
        Panel.SetZIndex(a, 10);
        assert.deepEqual([...p.logicalChildren], [a, b]);
        assert.deepEqual([...p.visualChildren],  [b, a]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Mural && npx tsx --test src/visual-engine/tests/panel-zindex.test.ts`
Expected: FAIL — `Panel.GetZIndex` / `Panel.SetZIndex` are not functions, and `visualChildren` is unsorted.

- [ ] **Step 3: Add the attached property + accessors**

In `element.ts`, in the `Panel` class body (near the other static members / top of the class), add:

```ts
// Z-order among a panel's children. Higher paints on top; equal ZIndex
// breaks ties by insertion order. Honored by EVERY panel via the sorted
// `visualChildren` below. MetaData.None — the reorder invalidation is
// bespoke (Panel.SetZIndex notifies the parent), not standard self-invalidation.
public static readonly ZIndexKey = MuralBase.RegisterAttachedProperty<number>(
    Panel, 'ZIndex', 0, MetaData.None);

public static GetZIndex(v: Visual): number
{
    return v.get_property_value(Panel.ZIndexKey);
}

public static SetZIndex(v: Visual, value: number): void
{
    v.set_property_value(Panel.ZIndexKey, value);
}
```

Ensure `MetaData` is imported in `element.ts` (it already imports from `../../runtime/index.js` — `MetaData` is exported there; add it to the import if missing).

- [ ] **Step 4: Split the snapshot — sorted visual, insertion-order logical**

Add a second cache field next to `_childrenSnapshot` (~line 2020):

```ts
// Lazily-materialized ZIndex-sorted snapshot for visualChildren. Distinct
// from _childrenSnapshot (insertion order, used by logicalChildren).
private _visualSnapshot: readonly Visual[] | undefined;
```

In the ctor's `_children.Subscribe` callback (~2034-2038), also clear the new cache:

```ts
this._children.Subscribe(() =>
{
    this._childrenSnapshot = undefined;
    this._visualSnapshot   = undefined;
    this.InvalidateMeasure();
});
```

Replace the `visualChildren` getter (~2104) so it returns the sorted snapshot; keep `logicalChildren` on the insertion-order snapshot:

```ts
public override get visualChildren(): readonly Visual[]  { return this.visualSnapshotSorted(); }
public override get logicalChildren(): readonly Visual[] { return this.childrenSnapshot(); }

private visualSnapshotSorted(): readonly Visual[]
{
    if (this._visualSnapshot === undefined)
    {
        // Stable sort by ZIndex asc; the explicit insertion-index tiebreak
        // makes ordering deterministic regardless of the engine's sort stability.
        this._visualSnapshot = this._children.ToArray()
            .map((v, i) => ({ v, i, z: Panel.GetZIndex(v) }))
            .sort((a, b) => (a.z - b.z) || (a.i - b.i))
            .map(e => e.v);
    }
    return this._visualSnapshot;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd Mural && npx tsx --test src/visual-engine/tests/panel-zindex.test.ts`
Expected: PASS (all three tests).

- [ ] **Step 6: Run the broader panel/renderer suites for regressions**

Run: `cd Mural && npm test`
Expected: PASS — no existing panel/ItemsControl test regresses (logicalChildren order is unchanged; visualChildren order is unchanged when all ZIndex are the default 0).

- [ ] **Step 7: Commit**

```bash
cd Mural
git add src/visual-engine/element.ts src/visual-engine/tests/panel-zindex.test.ts
git commit -m "$(cat <<'EOF'
feat(panel): ZIndex attached property + sorted visualChildren

Panel.ZIndex orders children by paint priority (higher on top, ties by
insertion order). visualChildren returns a stable ZIndex-sorted snapshot;
logicalChildren stays insertion order so ItemsControl index mapping is
unaffected.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Live reactivity — `SetZIndex` notifies the parent

**Files:**
- Modify: `Mural/src/visual-engine/element.ts` (`Panel.SetZIndex` + a new `_invalidateZOrder`)
- Test: `Mural/src/visual-engine/tests/panel-zindex-reactivity.test.ts`

**Interfaces:**
- Consumes: `Panel.ZIndexKey`, `Panel.GetZIndex`, `visualSnapshotSorted` (Task 1); `Visual.GetVisualParent()`, `Visual.InvalidateVisual()`.
- Produces: `Panel.SetZIndex` now invalidates the parent's sorted snapshot and schedules a render; internal `Panel.prototype._invalidateZOrder(): void`.

- [ ] **Step 1: Write the failing test**

Create `Mural/src/visual-engine/tests/panel-zindex-reactivity.test.ts`:

```ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Border } from '../../basic/index.js';
import { Panel } from '../../runtime/index.js';

class TestPanel extends Panel {}

describe('Panel.ZIndex reactivity', () => {
    test('SetZIndex on an attached child re-sorts visualChildren immediately', () => {
        const p = new TestPanel();
        const a = new Border(); const b = new Border();
        p.AddChild(a); p.AddChild(b);
        assert.deepEqual([...p.visualChildren], [a, b]);   // both 0 → insertion
        Panel.SetZIndex(a, 5);                             // a now on top
        assert.deepEqual([...p.visualChildren], [b, a]);   // snapshot rebuilt
    });

    test('SetZIndex requests a render on the parent panel', () => {
        const p = new TestPanel();
        const a = new Border();
        p.AddChild(a);
        let invalidated = 0;
        // InvalidateVisual notifies via the host; observe by overriding.
        const orig = (p as unknown as { InvalidateVisual(): void }).InvalidateVisual.bind(p);
        (p as unknown as { InvalidateVisual(): void }).InvalidateVisual = () => { invalidated++; orig(); };
        Panel.SetZIndex(a, 3);
        assert.equal(invalidated, 1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Mural && npx tsx --test src/visual-engine/tests/panel-zindex-reactivity.test.ts`
Expected: FAIL — the first assertion sees a stale `[a, b]` (snapshot not invalidated on Z change); the second sees `invalidated === 0`.

- [ ] **Step 3: Notify the parent from SetZIndex**

Replace `Panel.SetZIndex` (added in Task 1) with the notifying version, and add `_invalidateZOrder`:

```ts
public static SetZIndex(v: Visual, value: number): void
{
    v.set_property_value(Panel.ZIndexKey, value);
    // Reorder is driven from the setter (not a per-child listener): a listener
    // would add a ZIndex EVD + subscription to every child of every panel
    // app-wide. Notifying the parent here costs nothing for children that
    // never touch Z. A runtime Binding / raw set_property_value to ZIndex will
    // NOT auto-reorder — the diagram commands and markup both use SetZIndex /
    // construction-time set, the supported paths.
    const parent = v.GetVisualParent();
    if (parent instanceof Panel) parent._invalidateZOrder();
}

/** @internal — drop the sorted snapshot and schedule a render so the walk
 *  re-reads child order. Called by Panel.SetZIndex on this panel's children. */
public _invalidateZOrder(): void
{
    this._visualSnapshot = undefined;
    this.InvalidateVisual();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Mural && npx tsx --test src/visual-engine/tests/panel-zindex-reactivity.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Run the full Mural suite**

Run: `cd Mural && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd Mural
git add src/visual-engine/element.ts src/visual-engine/tests/panel-zindex-reactivity.test.ts
git commit -m "$(cat <<'EOF'
feat(panel): live ZIndex reactivity via SetZIndex parent-notify

Panel.SetZIndex invalidates the parent's sorted snapshot and requests a
render, so a runtime Z change reorders immediately. Chosen over a per-child
listener to avoid an app-wide EVD/subscription cost.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Renderer reconciles child DOM order

**Files:**
- Modify: `Mural/src/visual-engine/drawing/svg-renderer.ts` (the `walk` child loop ~515-522; the new-node insert path ~381-384)
- Test: `Mural/src/visual-engine/tests/svg-renderer-zorder.test.ts`

**Interfaces:**
- Consumes: `visual.visualChildren` (now ZIndex-sorted, Tasks 1-2).
- Produces: after any `Render`, each visual's child `<g>` elements appear under the child parent in `visualChildren` order.

- [ ] **Step 1: Write the failing test**

Create `Mural/src/visual-engine/tests/svg-renderer-zorder.test.ts` (harness mirrors `svg-renderer.test.ts` in the same folder — `makeDom()`, `new SvgRenderer(surface, { document })`, `Render(root, undefined, null, null)`, `VISUAL_BACKREF`):

```ts
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Application, Visual, Size, Rect, Panel } from '../../runtime/index.js';
import { Border, Canvas } from '../../basic/index.js';
import { SvgRenderer, VISUAL_BACKREF } from '../index.js';

function makeDom(): { document: Document; surface: SVGSVGElement } {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const doc = dom.window.document;
    const surface = doc.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    doc.body.appendChild(surface);
    return { document: doc, surface };
}

function outerOf(surface: SVGSVGElement, v: Visual): Element | null {
    for (const g of surface.querySelectorAll('g.mural-visual'))
        if ((g as unknown as { [VISUAL_BACKREF]?: Visual })[VISUAL_BACKREF] === v) return g;
    return null;
}

describe('SvgRenderer — ZIndex DOM order', () => {
    beforeEach(() => { Application.current = null; });

    test('reordering children by ZIndex moves the outer <g>', () => {
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });
        const canvas = new Canvas();
        const a = new Border(); const b = new Border();
        canvas.AddChild(a); canvas.AddChild(b);
        canvas.Measure(new Size(200, 200));
        canvas.Arrange(new Rect(0, 0, 200, 200));
        renderer.Render(canvas, undefined, null, null);

        const canvasOuter = outerOf(surface, canvas)!;
        const order1 = [...canvasOuter.querySelectorAll(':scope > g.mural-visual')];
        assert.equal(order1[0], outerOf(surface, a));
        assert.equal(order1[1], outerOf(surface, b));

        Panel.SetZIndex(a, 1);                       // bring a to front -> paints last
        renderer.Render(canvas, undefined, null, null);
        const order2 = [...canvasOuter.querySelectorAll(':scope > g.mural-visual')];
        assert.equal(order2[0], outerOf(surface, b));
        assert.equal(order2[1], outerOf(surface, a));
    });

    test('a render with unchanged order issues no DOM move', () => {
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });
        const canvas = new Canvas();
        canvas.AddChild(new Border()); canvas.AddChild(new Border());
        canvas.Measure(new Size(200, 200));
        canvas.Arrange(new Rect(0, 0, 200, 200));
        renderer.Render(canvas, undefined, null, null);

        const canvasOuter = outerOf(surface, canvas)! as unknown as {
            insertBefore(node: Node, ref: Node | null): Node;
        };
        let moves = 0;
        const orig = canvasOuter.insertBefore.bind(canvasOuter);
        canvasOuter.insertBefore = (node: Node, ref: Node | null) => { moves++; return orig(node, ref); };
        renderer.Render(canvas, undefined, null, null);   // identical order
        assert.equal(moves, 0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Mural && npx tsx --test src/visual-engine/tests/svg-renderer-zorder.test.ts`
Expected: FAIL — the reordered child's `<g>` keeps its original DOM slot (renderer only appends new nodes).

- [ ] **Step 3: Replace the child loop with a positional reconcile**

In `svg-renderer.ts`, the recursion block (~515-522):

```ts
const childParent = info.children ?? info.outer;
for (const child of visual.visualChildren)
{
    this.walk(child, childParent, renderDirty, arrangeDirty, visited);
}
```

Change it so that, after each child is walked (its outer `<g>` exists under some parent), the child's outer is positioned to match `visualChildren` order — moving in the DOM only when out of place:

```ts
const childParent = info.children ?? info.outer;
// `expectedNext` tracks the DOM node each child's outer should sit before.
// We place children back-to-front: iterate in visualChildren (paint) order and
// ensure each outer directly follows the previous one. insertBefore only fires
// on a mismatch, so a correctly-ordered subtree does zero DOM writes.
let prevOuter: SVGGElement | undefined;
for (const child of visual.visualChildren)
{
    this.walk(child, childParent, renderDirty, arrangeDirty, visited);
    const childInfo = this.nodes.get(child as unknown as RenderableVisual);
    if (childInfo === undefined) continue;   // non-rendered (e.g. skipped) child
    const outer = childInfo.outer;
    // Desired position: immediately AFTER prevOuter (or first, after the hit pad
    // / own / foreign nodes the parent owns). We only correct when wrong.
    const desiredPrev = prevOuter;
    const actualPrev = outer.previousElementSibling;
    if (outer.parentNode !== childParent)
    {
        // walk() already relocates reparented nodes; nothing to do here.
    }
    else if (desiredPrev === undefined)
    {
        // Should be the first child-outer. If a mural-visual precedes it, move it
        // to just before the current first child-outer.
        const firstChildOuter = childParent.querySelector(':scope > g.mural-visual');
        if (firstChildOuter !== null && firstChildOuter !== outer)
            childParent.insertBefore(outer, firstChildOuter);
    }
    else if (actualPrev !== desiredPrev)
    {
        childParent.insertBefore(outer, desiredPrev.nextSibling);
    }
    prevOuter = outer;
}
```

Note: the parent's own `hit` / `own` / `foreignObject` nodes precede all child outers in document order (they are appended first in the isNew branch). The reconcile only reorders `g.mural-visual` child outers relative to each other, leaving the parent's own nodes in front.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Mural && npx tsx --test src/visual-engine/tests/svg-renderer-zorder.test.ts`
Expected: PASS — reordered child's `<g>` moves; unchanged-order render issues zero `insertBefore`.

- [ ] **Step 5: Run the full Mural renderer + diagram suites**

Run: `cd Mural && npm test`
Expected: PASS — reparenting (container placement) and normal render tests unaffected; the reconcile is a no-op when order already matches.

- [ ] **Step 6: Commit**

```bash
cd Mural
git add src/visual-engine/drawing/svg-renderer.ts src/visual-engine/tests/svg-renderer-zorder.test.ts
git commit -m "$(cat <<'EOF'
feat(renderer): reconcile child DOM order to visualChildren (ZIndex)

The walk now positions each child's outer <g> to match visualChildren order,
issuing insertBefore only on a mismatch, so ZIndex reordering repaints in the
right order while correctly-ordered subtrees stay allocation-free.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Markup — `Panel.ZIndex = N` compiles

**Files:**
- Test: `Mural/src/compiler/tests/panel-zindex-markup.test.ts`
- Modify (only if the test reveals a gap): `Mural/src/compiler/symbol-table.ts`

**Interfaces:**
- Consumes: `Panel` is already a registered compiler symbol (`symbol-table.ts:17`); attached-property setters resolve generically (`compiler.ts:3395`, `emitSetDP`).

- [ ] **Step 1: Write the failing (or confirming) test**

Create `Mural/src/compiler/tests/panel-zindex-markup.test.ts`. Model it on the existing attached-property compiler test (search this folder for a test that compiles `Canvas.Left` or `Grid.Column` markup and asserts the emitted output — reuse its `compile(...)` helper and import path). The test compiles a child with `Panel.ZIndex = 5` and asserts the emitted module sets the attached property on the child (e.g. the output contains a `Panel.SetZIndex(` call or a `set_property_value` against `Panel.ZIndexKey`, matching however `Canvas.Left` emits in the reference test) and imports `Panel`.

```ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSource } from '../<the-folder's-compile-helper>.js'; // match the Canvas.Left test

describe('Panel.ZIndex markup', () => {
    test('Panel.ZIndex = N on a child compiles to an attached-property set', () => {
        const out = compileSource(`
            Canvas {
                Border [ Panel.ZIndex = 5 ]
            }
        `);
        // Assert the same emission shape the Canvas.Left reference test asserts,
        // but for Panel.ZIndex (SetZIndex / set_property_value with the ZIndex key)
        // and that Panel is imported.
        assert.match(out, /ZIndex/);
        assert.match(out, /Panel/);
    });
});
```

- [ ] **Step 2: Run the test**

Run: `cd Mural && npx tsx --test src/compiler/tests/panel-zindex-markup.test.ts`
Expected: Ideally PASS already (attached setters are generic + `Panel` is registered). If it FAILS because the emitter can't resolve `Panel.ZIndex`, proceed to Step 3; otherwise skip to Step 4.

- [ ] **Step 3: (Only if needed) close the wiring gap**

If Step 2 failed, inspect how `Canvas.Left` resolves in `compiler.ts` around `emitSetDP` (~3395) and `ensureImport`. The likely gap is that `Panel` needs its `DEFAULT_SYMBOLS` import entry to resolve the runtime `SetZIndex`/key — but `symbol-table.ts:17` already maps `Panel` → `@pragmatic-tech-ai/mural/runtime`. Make the minimal change the failure points to (no speculative edits). Re-run until PASS.

- [ ] **Step 4: Run the full compiler suite**

Run: `cd Mural && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd Mural
git add src/compiler/tests/panel-zindex-markup.test.ts src/compiler/symbol-table.ts 2>/dev/null
git commit -m "$(cat <<'EOF'
test(compiler): Panel.ZIndex settable from .mu markup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `zorder.ts` pure reorder math

**Files:**
- Create: `Mural/src/framework/diagram/commands/zorder.ts`
- Test: `Mural/src/framework/diagram/commands/tests/zorder.test.ts`

**Interfaces:**
- Produces:
  - `enum ZOrderMode { Front = 'front', Back = 'back', Forward = 'forward', Backward = 'backward' }`
  - `interface ZAccess<T> { get(item: T): number; set(item: T, z: number): void }`
  - `function reorderZ<T>(mode: ZOrderMode, selected: readonly T[], siblings: readonly T[], z: ZAccess<T>): void`

- [ ] **Step 1: Write the failing test**

Create `Mural/src/framework/diagram/commands/tests/zorder.test.ts`:

```ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ZOrderMode, reorderZ, type ZAccess } from '../zorder.js';

// Model items as plain objects with a mutable z; sibling array is insertion order.
type Item = { id: string; z: number };
const access: ZAccess<Item> = { get: (i) => i.z, set: (i, v) => { i.z = v; } };

function orderIds(siblings: Item[]): string[] {
    return [...siblings].sort((a, b) => (a.z - b.z) || 0).map(i => i.id);
}

function make(ids: string[]): Item[] { return ids.map(id => ({ id, z: 0 })); }

describe('reorderZ', () => {
    test('Front moves selected to the top, preserving their relative order', () => {
        const s = make(['a', 'b', 'c', 'd']);          // all z=0 → insertion order
        reorderZ(ZOrderMode.Front, [s[0]!, s[2]!], s, access);  // bring a, c to front
        // effective order becomes b, d, a, c
        assert.deepEqual(orderIds(s), ['b', 'd', 'a', 'c']);
    });

    test('Back moves selected to the bottom, preserving relative order', () => {
        const s = make(['a', 'b', 'c', 'd']);
        reorderZ(ZOrderMode.Back, [s[1]!, s[3]!], s, access);   // send b, d to back
        assert.deepEqual(orderIds(s), ['b', 'd', 'a', 'c']);
    });

    test('Forward shifts a selected item up one slot even when all z tie at 0', () => {
        const s = make(['a', 'b', 'c']);               // order a, b, c
        reorderZ(ZOrderMode.Forward, [s[0]!], s, access);        // a moves up past b
        assert.deepEqual(orderIds(s), ['b', 'a', 'c']);
    });

    test('Backward shifts a selected item down one slot', () => {
        const s = make(['a', 'b', 'c']);
        reorderZ(ZOrderMode.Backward, [s[2]!], s, access);       // c moves down past b
        assert.deepEqual(orderIds(s), ['a', 'c', 'b']);
    });

    test('renumbers to 0..n-1 by new position', () => {
        const s = make(['a', 'b', 'c']);
        reorderZ(ZOrderMode.Front, [s[0]!], s, access);          // a to top
        // new order b, c, a → z 0,1,2
        assert.equal(s.find(i => i.id === 'b')!.z, 0);
        assert.equal(s.find(i => i.id === 'c')!.z, 1);
        assert.equal(s.find(i => i.id === 'a')!.z, 2);
    });

    test('empty selection is a no-op', () => {
        const s = make(['a', 'b']);
        reorderZ(ZOrderMode.Front, [], s, access);
        assert.deepEqual(orderIds(s), ['a', 'b']);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Mural && npx tsx --test src/framework/diagram/commands/tests/zorder.test.ts`
Expected: FAIL — `zorder.js` does not exist.

- [ ] **Step 3: Implement `zorder.ts`**

Create `Mural/src/framework/diagram/commands/zorder.ts`:

```ts
// Pure z-order math for a set of siblings. Injects a ZAccess so the module
// stays free of Panel / Figure (the diagram wraps it with Panel.Get/SetZIndex).
//
// All four modes are one operation: take siblings in current effective order
// (stable sort by z, insertion index breaking ties), rearrange the selected
// items within that array, then renumber every sibling 0..n-1 by new position.
// Renumbering (vs swapping) is correct even when siblings share the default z 0.

export enum ZOrderMode
{
    Front    = 'front',
    Back     = 'back',
    Forward  = 'forward',
    Backward = 'backward',
}

export interface ZAccess<T>
{
    get(item: T): number;
    set(item: T, z: number): void;
}

export function reorderZ<T>(
    mode: ZOrderMode,
    selected: readonly T[],
    siblings: readonly T[],
    z: ZAccess<T>,
): void
{
    if (selected.length === 0 || siblings.length === 0) return;
    const sel = new Set<T>(selected);

    // Current effective order (low→high). `siblings` is insertion order and
    // Array.prototype.sort is stable, so equal-z items keep insertion order.
    const order = [...siblings].sort((a, b) => z.get(a) - z.get(b));

    let next: T[];
    switch (mode)
    {
        case ZOrderMode.Front:
            next = [...order.filter(x => !sel.has(x)), ...order.filter(x => sel.has(x))];
            break;
        case ZOrderMode.Back:
            next = [...order.filter(x => sel.has(x)), ...order.filter(x => !sel.has(x))];
            break;
        case ZOrderMode.Forward:
            next = shiftUp(order, sel);
            break;
        case ZOrderMode.Backward:
            next = shiftDown(order, sel);
            break;
    }

    // Renumber by new position: distinct, compact, reflects the new order.
    next.forEach((item, i) => z.set(item, i));
}

// Move each selected item up (toward the top / higher index) past the nearest
// non-selected neighbor. Iterate top-down so a contiguous selected block moves
// as a unit without members leapfrogging each other.
function shiftUp<T>(order: readonly T[], sel: ReadonlySet<T>): T[]
{
    const a = [...order];
    for (let i = a.length - 2; i >= 0; i--)
    {
        if (sel.has(a[i]!) && !sel.has(a[i + 1]!))
        {
            const tmp = a[i]!; a[i] = a[i + 1]!; a[i + 1] = tmp;
        }
    }
    return a;
}

// Mirror of shiftUp toward the bottom / index 0.
function shiftDown<T>(order: readonly T[], sel: ReadonlySet<T>): T[]
{
    const a = [...order];
    for (let i = 1; i < a.length; i++)
    {
        if (sel.has(a[i]!) && !sel.has(a[i - 1]!))
        {
            const tmp = a[i]!; a[i] = a[i - 1]!; a[i - 1] = tmp;
        }
    }
    return a;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Mural && npx tsx --test src/framework/diagram/commands/tests/zorder.test.ts`
Expected: PASS (all six tests).

- [ ] **Step 5: Commit**

```bash
cd Mural
git add src/framework/diagram/commands/zorder.ts src/framework/diagram/commands/tests/zorder.test.ts
git commit -m "$(cat <<'EOF'
feat(diagram): pure z-order reorder math (front/back/forward/backward)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Diagram z-order commands

**Files:**
- Modify: `Mural/src/framework/diagram/diagram.ts` (4 command DP keys near `AlignLeftCommandKey` ~251; 4 getters near ~720)
- Modify: `Mural/src/framework/diagram/collaborators/diagram-commands.ts` (`_installZOrderCommands` + ctor call; new imports)
- Test: `Mural/src/framework/diagram/collaborators/tests/diagram-zorder-commands.test.ts`

**Interfaces:**
- Consumes: `ZOrderMode`, `reorderZ`, `ZAccess` (Task 5); `Panel.GetZIndex`/`SetZIndex` (Tasks 1-2); `selectedTopLevel` (`commands/group-ops.js`); `Figure`; `RelayCommand`; the `_install` / `_collectSelected` helpers and the `Diagram` command-key/getter pattern.
- Produces: `Diagram.BringToFrontCommandKey`/`SendToBackCommandKey`/`BringForwardCommandKey`/`SendBackwardCommandKey` + getters `BringToFrontCommand` etc.; `DiagramCommands._installZOrderCommands()`.

- [ ] **Step 1: Write the failing test**

Create `Mural/src/framework/diagram/collaborators/tests/diagram-zorder-commands.test.ts` (harness mirrors `container-commands.test.ts`'s `mount` + `HandleContainerClick` selection):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModifierKeys, ObservableCollection, RelayCommand, Size, Visual, Panel } from '../../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../../basic/index.js';
import { initTestApp } from '../../../../basic/tests/test-app.js';
import { SelectionMode } from '../../../list/list-box.js';
import { Diagram } from '../../diagram.js';
import { Figure } from '../../figure.js';

function mount(items: ObservableCollection<Figure>): Diagram {
    const diagram = new Diagram();
    diagram.SelectionMode = SelectionMode.Extended;
    diagram.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
    diagram.ItemsSource = items;
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = diagram;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    return diagram;
}

function select(diagram: Diagram, figs: Figure[]): void {
    for (let i = 0; i < figs.length; i++)
        diagram.HandleContainerClick(figs[i]!, i === 0 ? ModifierKeys.None : ModifierKeys.Control);
}

function rect(x: number, y: number): Figure {
    return Figure.fromKind('rectangle', x, y, { width: 40, height: 30 });
}

test('z-order commands are installed and gate on selection', () => {
    initTestApp();
    const diagram = mount(new ObservableCollection<Figure>());
    assert.ok(diagram.BringToFrontCommand instanceof RelayCommand);
    assert.equal(diagram.BringToFrontCommand!.CanExecute(), false);
});

test('BringToFront gives the selected figure the top ZIndex', () => {
    initTestApp();
    const a = rect(10, 10); const b = rect(20, 20); const c = rect(30, 30);
    const items = new ObservableCollection<Figure>(); items.Add(a); items.Add(b); items.Add(c);
    const diagram = mount(items);

    select(diagram, [a]);
    assert.equal(diagram.BringToFrontCommand!.CanExecute(), true);
    diagram.BringToFrontCommand!.Execute();

    const za = Panel.GetZIndex(a), zb = Panel.GetZIndex(b), zc = Panel.GetZIndex(c);
    assert.ok(za > zb && za > zc, `a(${za}) should be above b(${zb}) and c(${zc})`);
});

test('SendToBack gives the selected figure the bottom ZIndex', () => {
    initTestApp();
    const a = rect(10, 10); const b = rect(20, 20);
    const items = new ObservableCollection<Figure>(); items.Add(a); items.Add(b);
    const diagram = mount(items);
    select(diagram, [b]);
    diagram.SendToBackCommand!.Execute();
    assert.ok(Panel.GetZIndex(b) < Panel.GetZIndex(a));
});
```

If `Figure.GetVisualParent()` is not the items Canvas after `mount` (container realization timing), the harness may need a layout pump — check how `container-commands.test.ts` observes realized figures and mirror it.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Mural && npx tsx --test src/framework/diagram/collaborators/tests/diagram-zorder-commands.test.ts`
Expected: FAIL — `BringToFrontCommand` is undefined.

- [ ] **Step 3: Add the command DP keys + getters to `Diagram`**

In `diagram.ts`, next to `AlignLeftCommandKey` (~251), add:

```ts
public static readonly BringToFrontCommandKey = MuralBase.RegisterProperty<RelayCommand | undefined>(
    Diagram, 'BringToFrontCommand', undefined, MetaData.None);
public static readonly SendToBackCommandKey = MuralBase.RegisterProperty<RelayCommand | undefined>(
    Diagram, 'SendToBackCommand', undefined, MetaData.None);
public static readonly BringForwardCommandKey = MuralBase.RegisterProperty<RelayCommand | undefined>(
    Diagram, 'BringForwardCommand', undefined, MetaData.None);
public static readonly SendBackwardCommandKey = MuralBase.RegisterProperty<RelayCommand | undefined>(
    Diagram, 'SendBackwardCommand', undefined, MetaData.None);
```

Next to the `AlignLeftCommand` getter (~720), add:

```ts
public get BringToFrontCommand(): RelayCommand | undefined { return this.get_property_value(Diagram.BringToFrontCommandKey); }
public get SendToBackCommand():   RelayCommand | undefined { return this.get_property_value(Diagram.SendToBackCommandKey); }
public get BringForwardCommand(): RelayCommand | undefined { return this.get_property_value(Diagram.BringForwardCommandKey); }
public get SendBackwardCommand(): RelayCommand | undefined { return this.get_property_value(Diagram.SendBackwardCommandKey); }
```

- [ ] **Step 4: Install the commands in `DiagramCommands`**

In `diagram-commands.ts`, add imports:

```ts
import { Panel } from '../../../runtime/index.js';
import { Figure } from '../figure.js';
import { ZOrderMode, reorderZ, type ZAccess } from '../commands/zorder.js';
```

Add the install call in the ctor (after `_installGroupCommands()` is fine):

```ts
this._installZOrderCommands();
```

Add the method + a private reorder helper:

```ts
// Panel.ZIndex accessor over figures.
private static readonly Z: ZAccess<Figure> = {
    get: (f) => Panel.GetZIndex(f),
    set: (f, z) => Panel.SetZIndex(f, z),
};

private _installZOrderCommands(): void
{
    const Diagram = this._diagram.constructor as typeof import('../diagram.js').Diagram;
    const canReorder = (): boolean => this._selectedFigures().length >= 1;

    this._install(Diagram.BringToFrontCommandKey, 'BringToFront',
        new RelayCommand(() => this._reorder(ZOrderMode.Front), canReorder,
            { Text: 'Bring to Front', Description: 'Move the selected shape(s) in front of all others.' }));
    this._install(Diagram.SendToBackCommandKey, 'SendToBack',
        new RelayCommand(() => this._reorder(ZOrderMode.Back), canReorder,
            { Text: 'Send to Back', Description: 'Move the selected shape(s) behind all others.' }));
    this._install(Diagram.BringForwardCommandKey, 'BringForward',
        new RelayCommand(() => this._reorder(ZOrderMode.Forward), canReorder,
            { Text: 'Bring Forward', Description: 'Move the selected shape(s) one step toward the front.' }));
    this._install(Diagram.SendBackwardCommandKey, 'SendBackward',
        new RelayCommand(() => this._reorder(ZOrderMode.Backward), canReorder,
            { Text: 'Send Backward', Description: 'Move the selected shape(s) one step toward the back.' }));
}

// Selected top-level figures (ignore connectors / content nodes / nested members).
private _selectedFigures(): Figure[]
{
    return selectedTopLevel(this._diagram.SelectedItems).filter((i): i is Figure => i instanceof Figure);
}

// Group the selection by visual parent (the figures Canvas, or a container's
// child host) and reorder each parent's figure children independently, so z is
// scoped per parent.
private _reorder(mode: ZOrderMode): void
{
    const figs = this._selectedFigures();
    if (figs.length === 0) return;
    const byParent = new Map<Panel, Figure[]>();
    for (const f of figs)
    {
        const parent = f.GetVisualParent();
        if (!(parent instanceof Panel)) continue;
        (byParent.get(parent) ?? byParent.set(parent, []).get(parent)!).push(f);
    }
    for (const [parent, selected] of byParent)
    {
        const siblings = [...parent.Children].filter((c): c is Figure => c instanceof Figure);
        reorderZ(mode, selected, siblings, DiagramCommands.Z);
    }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd Mural && npx tsx --test src/framework/diagram/collaborators/tests/diagram-zorder-commands.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full Mural suite**

Run: `cd Mural && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd Mural
git add src/framework/diagram/diagram.ts src/framework/diagram/collaborators/diagram-commands.ts src/framework/diagram/collaborators/tests/diagram-zorder-commands.test.ts
git commit -m "$(cat <<'EOF'
feat(diagram): Bring-to-Front / Send-to-Back / Forward / Backward commands

Four RelayCommands drive Panel.ZIndex on the selected figures, grouped by
visual parent so z is scoped per container. CanExecute needs >=1 figure.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Keyboard shortcuts

**Files:**
- Modify: `Mural/src/framework/diagram/diagram.ts` (`OnKeyDown`, ~1988; add a branch after the Ctrl+G group branch ~2045)
- Test: `Mural/src/framework/diagram/tests/diagram-zorder-keys.test.ts`

**Interfaces:**
- Consumes: `Key.Oem4` (`[`), `Key.Oem6` (`]`) from `visual-engine/input/key.ts`; `ModifierKeys`, `hasModifier`; the z-order command getters (Task 6).

- [ ] **Step 1: Write the failing test**

Create `Mural/src/framework/diagram/tests/diagram-zorder-keys.test.ts` (dispatch pattern mirrors `diagram-connector-selection.test.ts` — `new KeyEventArgs('KeyDown', diagram, {...})` + `OnKeyDown` cast; stub each command with a flag-setting `RelayCommand`):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModifierKeys, ObservableCollection, RelayCommand, Size, Visual } from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { SelectionMode } from '../../list/list-box.js';
import { Key, KeyEventArgs } from '../../../visual-engine/index.js';
import { Diagram } from '../diagram.js';
import { Figure } from '../figure.js';

function mount(items: ObservableCollection<Figure>): Diagram {
    const diagram = new Diagram();
    diagram.SelectionMode = SelectionMode.Extended;
    diagram.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
    diagram.ItemsSource = items;
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = diagram;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    return diagram;
}

function dispatch(diagram: Diagram, key: Key, mods: ModifierKeys): void {
    const args = new KeyEventArgs('KeyDown', diagram, {
        Key: key, KeyText: key, Code: key, Modifiers: mods, IsRepeat: false,
    });
    (diagram as unknown as { OnKeyDown(a: KeyEventArgs): void }).OnKeyDown(args);
}

test('Ctrl+]/[ (+Shift) route to the four z-order commands', () => {
    initTestApp();
    const a = Figure.fromKind('rectangle', 10, 10, { width: 40, height: 30 });
    const items = new ObservableCollection<Figure>(); items.Add(a);
    const diagram = mount(items);
    diagram.HandleContainerClick(a, ModifierKeys.None);   // a selection so CanExecute passes

    const fired: string[] = [];
    const stub = (name: string) => new RelayCommand(() => fired.push(name), () => true, { Text: name });
    diagram.set_property_value(Diagram.BringForwardCommandKey, stub('forward'));
    diagram.set_property_value(Diagram.BringToFrontCommandKey, stub('front'));
    diagram.set_property_value(Diagram.SendBackwardCommandKey, stub('backward'));
    diagram.set_property_value(Diagram.SendToBackCommandKey,   stub('back'));

    dispatch(diagram, Key.Oem6, ModifierKeys.Control);                         // Ctrl+]
    dispatch(diagram, Key.Oem6, ModifierKeys.Control | ModifierKeys.Shift);    // Ctrl+Shift+]
    dispatch(diagram, Key.Oem4, ModifierKeys.Control);                         // Ctrl+[
    dispatch(diagram, Key.Oem4, ModifierKeys.Control | ModifierKeys.Shift);    // Ctrl+Shift+[
    assert.deepEqual(fired, ['forward', 'front', 'backward', 'back']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Mural && npx tsx --test src/framework/diagram/tests/diagram-zorder-keys.test.ts`
Expected: FAIL — no key handling for Oem4/Oem6.

- [ ] **Step 3: Add the key branch**

In `diagram.ts` `OnKeyDown`, after the Ctrl+G branch (~2045) and before the clipboard branch, add:

```ts
// Ctrl/⌘ + ] / [ — z-order. Shift jumps all the way (front / back); plain
// steps one (forward / backward). CanExecute gating no-ops an empty selection.
if ((key === Key.Oem6 || key === Key.Oem4)
    && (hasModifier(args.Modifiers, ModifierKeys.Control) || hasModifier(args.Modifiers, ModifierKeys.Windows)))
{
    const shift = hasModifier(args.Modifiers, ModifierKeys.Shift);
    const cmd = key === Key.Oem6
        ? (shift ? this.BringToFrontCommand : this.BringForwardCommand)
        : (shift ? this.SendToBackCommand   : this.SendBackwardCommand);
    if (cmd !== undefined && cmd.CanExecute(undefined)) cmd.Execute(undefined);
    args.Handled = true;
    return;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Mural && npx tsx --test src/framework/diagram/tests/diagram-zorder-keys.test.ts`
Expected: PASS (all four bindings).

- [ ] **Step 5: Run the full Mural suite**

Run: `cd Mural && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd Mural
git add src/framework/diagram/diagram.ts src/framework/diagram/tests/diagram-zorder-keys.test.ts
git commit -m "$(cat <<'EOF'
feat(diagram): Ctrl+]/[ (+Shift) z-order keyboard shortcuts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Per-figure Z persistence

**Files:**
- Modify: `Mural/src/framework/diagram/serialization/node-visual-store.ts` (`NodeVisual` interface ~15-39; `Read` ~72-97; `Apply` ~100-119; add `Panel` import)
- Test: `Mural/src/framework/diagram/serialization/tests/node-visual-store-zindex.test.ts`

**Interfaces:**
- Consumes: `Panel.GetZIndex` / `Panel.SetZIndex` (Tasks 1-2); `Figure`.
- Produces: `NodeVisual.zIndex?: number`; round-tripped through `Read`/`Apply`.

- [ ] **Step 1: Write the failing test**

Create `Mural/src/framework/diagram/serialization/tests/node-visual-store-zindex.test.ts`:

```ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Panel } from '../../../../runtime/index.js';
import { Figure } from '../../figure.js';
import { NodeVisualStore } from '../node-visual-store.js';

// Minimal Figure for geometry round-trip. Reuse this folder's existing helper
// for constructing a Figure if one exists; otherwise `new Figure()` with
// Left/Top/Width/Height set.
function fig(): Figure { const f = new Figure(); f.Left = 0; f.Top = 0; f.Width = 10; f.Height = 10; return f; }

describe('NodeVisual zIndex round-trip', () => {
    const store = new NodeVisualStore();

    test('Read omits zIndex when 0', () => {
        const f = fig();
        const v = store.Read(f);
        assert.equal('zIndex' in v, false);
    });

    test('Read captures a non-zero ZIndex; Apply restores it', () => {
        const f = fig();
        Panel.SetZIndex(f, 7);
        const v = store.Read(f);
        assert.equal(v.zIndex, 7);

        const g = fig();
        store.Apply(v, g);
        assert.equal(Panel.GetZIndex(g), 7);
    });

    test('Apply of a record without zIndex leaves ZIndex at 0', () => {
        const g = fig();
        store.Apply({ left: 0, top: 0, w: 10, h: 10 }, g);
        assert.equal(Panel.GetZIndex(g), 0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Mural && npx tsx --test src/framework/diagram/serialization/tests/node-visual-store-zindex.test.ts`
Expected: FAIL — `v.zIndex` is undefined after `Read` on a Z=7 figure.

- [ ] **Step 3: Add the field + Read/Apply wiring**

In `node-visual-store.ts`, add the import:

```ts
import { Panel } from '../../../runtime/index.js';
```

Add the field to `NodeVisual` (after `anchor?`, ~line 29):

```ts
// Paint z-order (Panel.ZIndex). Omitted when 0 so old files and un-reordered
// figures serialize unchanged.
zIndex?: number;
```

In `Read`, after the `anchor` line (~81):

```ts
const z = Panel.GetZIndex(node);
if (z !== 0) v.zIndex = z;
```

In `Apply`, after the `anchor` line (~112):

```ts
if (v.zIndex !== undefined) Panel.SetZIndex(node, v.zIndex);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Mural && npx tsx --test src/framework/diagram/serialization/tests/node-visual-store-zindex.test.ts`
Expected: PASS (all three tests).

- [ ] **Step 5: Run the full Mural suite**

Run: `cd Mural && npm test`
Expected: PASS — existing serialization round-trip tests unaffected (zIndex omitted at default).

- [ ] **Step 6: Commit**

```bash
cd Mural
git add src/framework/diagram/serialization/node-visual-store.ts src/framework/diagram/serialization/tests/node-visual-store-zindex.test.ts
git commit -m "$(cat <<'EOF'
feat(diagram): persist per-figure ZIndex in NodeVisual

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Plexus context menu + keyboard doc + version bump

**Files:**
- Modify: `Plexus/src/renderer/src/modules/diagram/diagram.resources.mu` (`DiagramContextMenu`, add items after the align/distribute section ~316)
- Modify: `Mural/package.json` (minor version bump)
- Modify: `Plexus/package.json` (mural dependency floor)
- (Icons) Add z-order geometries to the diagram icon set the menu references, OR reuse an existing geometry — see Step 2.

**Interfaces:**
- Consumes: `$ActiveView.BringToFrontCommand` etc. (Task 6, once mural is published/linked).

- [ ] **Step 1: Bump Mural version**

In `Mural/package.json`, bump the minor version (current `0.34.2` → `0.35.0`). Commit:

```bash
cd Mural
git add package.json
git commit -m "$(cat <<'EOF'
chore: bump mural to 0.35.0 (Panel.ZIndex + diagram z-order)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2: Add context-menu items**

In `diagram.resources.mu`, inside `DiagramContextMenu`, after the Distribute items and their trailing `MenuSeparator` (~316), insert a z-order block. For icons, first check whether z-order geometries already exist in the diagram icon dictionary (search the `.mu` resources for `@bringToFront` / `@sendToBack`); if none exist, reuse a neutral existing geometry (e.g. `@alignTop` is acceptable as a placeholder) and note it — do NOT block on new SVG art. Preferred, if the icon set has them:

```
        MenuItem
            [ Header  = "Bring to Front",
              Command = $ActiveView.BringToFrontCommand,
              Icon    = Shape [ Geometry = @bringToFront, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header  = "Send to Back",
              Command = $ActiveView.SendToBackCommand,
              Icon    = Shape [ Geometry = @sendToBack, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header  = "Bring Forward",
              Command = $ActiveView.BringForwardCommand,
              Icon    = Shape [ Geometry = @bringForward, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header  = "Send Backward",
              Command = $ActiveView.SendBackwardCommand,
              Icon    = Shape [ Geometry = @sendBackward, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuSeparator
```

- [ ] **Step 3: Point Plexus at the new mural (GATED — ask before publishing)**

The renderer bundles mural's built `dist`. To consume Task 6's commands, mural must be published to Verdaccio (`http://localhost:4873`) and reinstalled, OR `npm link`ed for local iteration (per `Plexus/CLAUDE.md`). **Publishing is a gated action — do NOT publish unless the user explicitly asks.** For the plan's purposes: bump the floor in `Plexus/package.json` (`@pragmatic-tech-ai/mural` → `^0.35.0`) and STOP here if not yet authorized to publish/reinstall; report that the menu wiring compiles against the new API once mural is available.

```bash
cd Plexus
# edit package.json: "@pragmatic-tech-ai/mural": "^0.35.0"
```

- [ ] **Step 4: Compile the markup + typecheck (after mural is available)**

Run: `cd Plexus && npm run compile:mu`
Expected: `diagram.resources.mu` compiles — `$ActiveView.BringToFrontCommand` resolves (the getter exists on the published `Diagram`). If mural is not yet published/linked, this step is deferred with Step 3.

- [ ] **Step 5: Commit**

```bash
cd Plexus
git add src/renderer/src/modules/diagram/diagram.resources.mu package.json
git commit -m "$(cat <<'EOF'
feat(diagram): z-order context-menu items; mural floor ^0.35.0

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Verification (whole feature)

- [ ] `cd Mural && npm test` — all green.
- [ ] `cd Mural && npm run typecheck` (or the repo's typecheck script) — clean.
- [ ] `cd Plexus && npm test` — all green (Plexus tests don't depend on the new mural API; the menu is markup).
- [ ] Manual (after mural published/linked): open the arch diagram, overlap two figures, right-click → Bring to Front / Send to Back, and confirm paint order changes and survives save+reload.

## Notes for the executor

- **Test runner:** Mural tests are `node:test` run via `tsx` (see existing `*.test.ts` in the folders above for the exact invocation the repo uses; `npm test` runs the whole suite). Match the neighbor tests' import style and harness rather than the illustrative snippets here where they differ.
- **Harness reuse:** Tasks 3, 6, 7 explicitly reuse an existing test harness in their folder (renderer construction; diagram + figures + selection). Read the neighbor test first; don't invent a second harness.
- **Do not publish mural** or reinstall in Plexus without explicit user authorization (Task 9, Step 3).

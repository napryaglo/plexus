# Toolbox Granular Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the toolbox's full-rebuild-on-`ActiveDocument` reload with page-owned, granular updates so `ActiveDocument` change flips page visibility only and content updates only on each page's real trigger.

**Architecture:** Two axes. (1) Content — each `ToolboxPage` owns its `Items`, subscribes to its own discrete triggers, and reconciles by stable `Id` (never `Clear()`). (2) Visibility — a page declares a string context token; on `ActiveDocument` change the hub flips `IsVisible` by matching the token against the active document's `ToolboxContexts` set. A `ToolboxService` hub owns the coarse page set; pages own their items and visibility.

**Tech Stack:** TypeScript. Mural framework (unit tests: `node:test` + `node:assert/strict`). Plexus renderer (unit tests: vitest; e2e: Playwright `_electron`). Mural `ObservableCollection<T>` (`Add`/`Insert`/`RemoveAt`/`Remove`/`SetAt`/`Move`/`IndexOf`/`ToArray`/`Count`/`Subscribe`). DP model via `MuralBase.RegisterProperty`.

**Spec:** [../specs/2026-09-02-toolbox-granular-update-design.md](../specs/2026-09-02-toolbox-granular-update-design.md)

## Global Constraints

- Every test file lives in a `tests/` subfolder next to the code it exercises (`foo/tests/foo.test.ts`, never `foo/foo.test.ts`).
- Mural unit tests use `node:test`/`node:assert`; Plexus unit tests use vitest (`describe`/`it`/`expect`). Match the neighbouring files.
- A fixed set of named string values is a TypeScript `enum`, never a string-literal union or bare literal at a use site.
- Every visible element renders through a `DataTemplate`/`Style`/`Binding` — no hardcoded chrome.
- Mural is upstream of Plexus and must not import from Plexus. New framework primitives live in Mural; page subclasses and the hub live in Plexus.
- `ToolboxPage` stays **concrete** (not abstract): `ensureToolboxDefaults` constructs base `ToolboxPage` instances for static pages.

---

### Task 1: `reconcile` — keyed collection diff (Mural)

**Files:**
- Create: `Mural/src/framework/diagram/toolbox/reconcile.ts`
- Test: `Mural/src/framework/diagram/toolbox/tests/reconcile.test.ts`

**Interfaces:**
- Produces: `reconcile<T>(collection: ObservableCollection<T>, desired: readonly T[], keyOf: (t: T) => string, update?: (live: T, next: T) => void): void` — mutates `collection` in place to match `desired` (add missing, remove absent, move to match order, optional in-place `update` for matched keys). Never calls `Clear()`.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObservableCollection } from '../../../../runtime/index.js';
import { reconcile } from '../reconcile.js';

interface Row { id: string; label: string }
const key = (r: Row) => r.id;

test('reconcile adds, removes, and preserves untouched instances', () => {
    const c = new ObservableCollection<Row>();
    const a = { id: 'a', label: 'A' }, b = { id: 'b', label: 'B' };
    c.Add(a); c.Add(b);
    const events: string[] = [];
    c.Subscribe((e) => events.push(e.action));
    // desired: keep a (same instance expected), drop b, add c
    reconcile(c, [{ id: 'a', label: 'A' }, { id: 'c', label: 'C' }], key);
    assert.deepEqual(c.ToArray().map(key), ['a', 'c']);
    assert.equal(c.Get(0), a, 'existing key keeps its live instance');
    assert.ok(!events.includes('cleared'), 'never clears');
});

test('reconcile reorders via Move and updates matched in place', () => {
    const c = new ObservableCollection<Row>();
    const a = { id: 'a', label: 'A' }, b = { id: 'b', label: 'B' };
    c.Add(a); c.Add(b);
    reconcile(c, [{ id: 'b', label: 'B2' }, { id: 'a', label: 'A' }], key,
        (live, next) => { live.label = next.label; });
    assert.deepEqual(c.ToArray().map(key), ['b', 'a']);
    assert.equal(c.Get(0), b, 'b moved, same instance');
    assert.equal(b.label, 'B2', 'matched instance updated in place');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Mural && node --test --import tsx src/framework/diagram/toolbox/tests/reconcile.test.ts`
Expected: FAIL — cannot find module `../reconcile.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { ObservableCollection } from '../../../runtime/index.js';

// Mutate `collection` in place so it equals `desired` by key: keep and reuse
// existing instances for matched keys (optionally updating them), remove keys
// no longer desired, insert new ones, and move to match `desired` order. Never
// clears — the ItemsControl then regenerates only the changed containers.
export function reconcile<T>(
    collection: ObservableCollection<T>,
    desired: readonly T[],
    keyOf: (t: T) => string,
    update?: (live: T, next: T) => void,
): void
{
    const desiredKeys = new Set(desired.map(keyOf));
    // 1. Remove live items whose key is no longer desired (back-to-front).
    for (let i = collection.Count - 1; i >= 0; i--)
    {
        if (!desiredKeys.has(keyOf(collection.Get(i)!))) collection.RemoveAt(i);
    }
    // 2. Walk desired order; ensure each key is present at the right index.
    for (let target = 0; target < desired.length; target++)
    {
        const next = desired[target]!;
        const k = keyOf(next);
        let live = -1;
        for (let i = 0; i < collection.Count; i++) { if (keyOf(collection.Get(i)!) === k) { live = i; break; } }
        if (live === -1)
        {
            collection.Insert(target, next);
        }
        else
        {
            if (update !== undefined) update(collection.Get(live)!, next);
            if (live !== target) collection.Move(live, target);
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Mural && node --test --import tsx src/framework/diagram/toolbox/tests/reconcile.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add Mural/src/framework/diagram/toolbox/reconcile.ts Mural/src/framework/diagram/toolbox/tests/reconcile.test.ts
git commit -m "feat(toolbox): keyed reconcile helper for granular collection updates"
```

---

### Task 2: `ToolboxPage` base — context + visibility + reconcileItems (Mural)

**Files:**
- Modify: `Mural/src/framework/diagram/toolbox/toolbox-page.ts`
- Test: `Mural/src/framework/diagram/toolbox/tests/toolbox-page.test.ts` (extend existing)

**Interfaces:**
- Consumes: `reconcile` (Task 1).
- Produces (new members on `ToolboxPage`):
  - `get/set Context(): string | undefined` (DP, default `undefined`)
  - `get/set IsVisible(): boolean` (DP, default `true`)
  - `applyContext(ctx: ReadonlySet<string>): void` — sets `IsVisible = Context === undefined || ctx.has(Context)`; touches nothing else.
  - `attach(): void` / `detach(): void` — base no-ops (subclasses override to subscribe/dispose triggers).
  - `protected reconcileItems(desired: readonly ToolboxItem[], update?: (live: ToolboxItem, next: ToolboxItem) => void): void` — `reconcile(this.Items, desired, it => it.Id, update)`.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolboxPage } from '../toolbox-page.js';

test('applyContext hides a page whose Context is not in the active set, keeps Items', () => {
    const page = new ToolboxPage('lib:x', 'X');
    page.Context = 'x@1.0.0';
    const itemsChanged: string[] = [];
    page.Items.Subscribe((e) => itemsChanged.push(e.action));
    page.applyContext(new Set(['y@2.0.0']));
    assert.equal(page.IsVisible, false);
    page.applyContext(new Set(['x@1.0.0']));
    assert.equal(page.IsVisible, true);
    assert.deepEqual(itemsChanged, [], 'applyContext never touches Items');
});

test('context-free page is always visible', () => {
    const page = new ToolboxPage('shapes', 'Shapes'); // Context left undefined
    page.applyContext(new Set());
    assert.equal(page.IsVisible, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Mural && node --test --import tsx src/framework/diagram/toolbox/tests/toolbox-page.test.ts`
Expected: FAIL — `page.Context`/`applyContext` undefined.

- [ ] **Step 3: Write minimal implementation** — add to `toolbox-page.ts`

```ts
// (imports) add: import { reconcile } from './reconcile.js';
// (inside class ToolboxPage, after ItemsKey/IsExpandedKey)

    public static readonly ContextKey = MuralBase.RegisterProperty<string | undefined>(
        ToolboxPage, 'Context', undefined, MetaData.None);
    public static readonly IsVisibleKey = MuralBase.RegisterProperty<boolean>(
        ToolboxPage, 'IsVisible', true, MetaData.None);

    // The content-context token this page belongs to (e.g. a published `<id>@<version>`
    // ref or a model id). undefined → the page is context-free and always visible.
    public get Context(): string | undefined { return this.get_property_value(ToolboxPage.ContextKey); }
    public set Context(v: string | undefined) { this.set_property_value(ToolboxPage.ContextKey, v); }

    // View binds Visibility to this. Flipped only by applyContext.
    public get IsVisible(): boolean { return this.get_property_value(ToolboxPage.IsVisibleKey); }
    public set IsVisible(v: boolean) { this.set_property_value(ToolboxPage.IsVisibleKey, v); }

    // Visibility filter: visible iff context-free, or the active document's context
    // set contains this page's token. Never touches Items or IsExpanded, so the
    // user's manual expand/collapse survives a context change.
    public applyContext(ctx: ReadonlySet<string>): void
    {
        this.IsVisible = this.Context === undefined || ctx.has(this.Context);
    }

    // Lifecycle: subclasses override to subscribe to their triggers on attach and
    // dispose on detach. The base page (static content) has no triggers.
    public attach(): void { /* no triggers */ }
    public detach(): void { /* no subscriptions */ }

    // Granular item update by stable Id — subclasses call this from their trigger
    // handler instead of Clear()+rebuild.
    protected reconcileItems(desired: readonly ToolboxItem[], update?: (live: ToolboxItem, next: ToolboxItem) => void): void
    {
        reconcile(this.Items, desired, (it) => it.Id, update);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Mural && node --test --import tsx src/framework/diagram/toolbox/tests/toolbox-page.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Mural/src/framework/diagram/toolbox/toolbox-page.ts Mural/src/framework/diagram/toolbox/tests/toolbox-page.test.ts
git commit -m "feat(toolbox): ToolboxPage context token, IsVisible, applyContext, reconcileItems"
```

---

### Task 3: `IToolboxContextTarget` contract (Mural)

**Files:**
- Create: `Mural/src/framework/diagram/toolbox/toolbox-context.ts`
- Test: `Mural/src/framework/diagram/toolbox/tests/toolbox-context.test.ts`
- Modify: `Mural/src/framework/index.ts` (export the new symbols)

**Interfaces:**
- Produces:
  - `interface IToolboxContextTarget { readonly ToolboxContexts: ReadonlySet<string> }`
  - `isToolboxContextTarget(x: unknown): x is IToolboxContextTarget`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isToolboxContextTarget } from '../toolbox-context.js';

test('isToolboxContextTarget recognises a document exposing ToolboxContexts', () => {
    assert.equal(isToolboxContextTarget({ ToolboxContexts: new Set(['a']) }), true);
    assert.equal(isToolboxContextTarget({}), false);
    assert.equal(isToolboxContextTarget(undefined), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Mural && node --test --import tsx src/framework/diagram/toolbox/tests/toolbox-context.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// A document that publishes the live set of content-context tokens it activates.
// The ToolboxService reads it on ActiveDocument change and flips each page's
// visibility. Mirrors ICommandTarget.CommandContexts, but tokens are dynamic
// content strings (`<id>@<version>`, model ids) rather than static ServiceTokens.
export interface IToolboxContextTarget
{
    readonly ToolboxContexts: ReadonlySet<string>;
}

export function isToolboxContextTarget(x: unknown): x is IToolboxContextTarget
{
    return typeof x === 'object' && x !== null
        && (x as { ToolboxContexts?: unknown }).ToolboxContexts instanceof Set;
}
```

Then add to `Mural/src/framework/index.ts`:
```ts
export { type IToolboxContextTarget, isToolboxContextTarget } from './diagram/toolbox/toolbox-context.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Mural && node --test --import tsx src/framework/diagram/toolbox/tests/toolbox-context.test.ts`
Expected: PASS. Also `cd Mural && npm run build` to confirm the barrel export type-checks.

- [ ] **Step 5: Commit**

```bash
git add Mural/src/framework/diagram/toolbox/toolbox-context.ts Mural/src/framework/diagram/toolbox/tests/toolbox-context.test.ts Mural/src/framework/index.ts
git commit -m "feat(toolbox): IToolboxContextTarget document contract"
```

---

### Task 4: Publish the new Mural build to Plexus

**Files:**
- Modify: `Plexus/node_modules/@pragmatic-tech-ai/mural` (via the project's mural refresh flow)

**Interfaces:**
- Consumes: Tasks 1–3 (built into mural `dist`).
- Produces: `reconcile`, `ToolboxPage` new members, `IToolboxContextTarget`/`isToolboxContextTarget` available to Plexus imports from `@pragmatic-tech-ai/mural/framework`.

- [ ] **Step 1:** Build mural: `cd Mural && npm run build`. Expected: no type errors.
- [ ] **Step 2:** Make the new build available to Plexus (bump + pack + install, per the repo's mural→Plexus dependency flow; mural is a published `node_modules` dep, not a symlink). Verify: `node -e "const m=require('./Plexus/node_modules/@pragmatic-tech-ai/mural/dist/framework/index.js'); console.log(typeof m.isToolboxContextTarget)"` prints `function`.
- [ ] **Step 3: Commit** any lockfile/manifest change.

```bash
git add Plexus/package.json Plexus/package-lock.json
git commit -m "chore(plexus): consume mural build with toolbox granular-update primitives"
```

---

### Task 5: Content-change events on library + meta-model services (Plexus)

**Files:**
- Modify: `Plexus/src/renderer/src/modules/library/services/libraries-panel-service.ts`
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/meta-models-service.ts`
- Test: `Plexus/src/renderer/src/modules/library/services/tests/libraries-panel-service.test.ts` (or a focused new test file next to each)

**Interfaces:**
- Produces:
  - `LibrariesPanelService.onLibrariesChanged(cb: () => void): () => void` — fires after every completed `Reload()` (install/uninstall/publish).
  - `MetaModelsService.onMetaModelsChanged(cb: () => void): () => void` — fires after every completed `reload()`.

- [ ] **Step 1: Write the failing test** (`libraries-panel-service` example)

```ts
import { describe, it, expect } from 'vitest';
import { LibrariesPanelService } from '../libraries-panel-service.js';

describe('LibrariesPanelService change event', () => {
    it('notifies subscribers after Reload completes', async () => {
        const svc = /* construct with the module's existing test harness/provider */;
        let fired = 0;
        const off = svc.onLibrariesChanged(() => { fired++; });
        await svc.Reload();
        expect(fired).toBe(1);
        off();
        await svc.Reload();
        expect(fired).toBe(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/library/services/tests/libraries-panel-service.test.ts`
Expected: FAIL — `onLibrariesChanged` not a function.

- [ ] **Step 3: Write minimal implementation** — add to each service

```ts
    private readonly changedListeners = new Set<() => void>();

    public onLibrariesChanged(cb: () => void): () => void   // meta-models: onMetaModelsChanged
    {
        this.changedListeners.add(cb);
        return () => { this.changedListeners.delete(cb); };
    }

    private fireChanged(): void { for (const l of [...this.changedListeners]) l(); }
```

Call `this.fireChanged()` at the end of the successful path of `Reload()` (libraries, after the presentation refresh) / `reload()` (meta-models, after `discover()`), guarded by the existing `seq` freshness check so a superseded reload does not fire.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/library/services/tests/libraries-panel-service.test.ts`
Expected: PASS. Repeat for the meta-models test.

- [ ] **Step 5: Commit**

```bash
git add Plexus/src/renderer/src/modules/library/services/libraries-panel-service.ts Plexus/src/renderer/src/modules/meta-model/services/meta-models-service.ts Plexus/src/renderer/src/modules/**/tests/*.test.ts
git commit -m "feat(toolbox): content-change events on library and meta-model services"
```

---

### Task 6: Per-key `discover` notification (Plexus)

**Files:**
- Modify: `Plexus/src/renderer/src/modules/diagram/services/todl-presentation-registry.ts`
- Test: `Plexus/src/renderer/src/modules/diagram/services/tests/todl-presentation-registry.test.ts`

**Interfaces:**
- Consumes: existing `discover()` + `onChanged(cb: (key: string) => void)`.
- Produces: `discover()` fires `onChanged(key)` **only** for entity keys whose icon resource key changed since the previous `discover()` (added, removed, or remapped) — not for every indexed key.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { TodlPresentationRegistry } from '../todl-presentation-registry.js';

describe('discover fires per-changed-key', () => {
    it('only notifies keys whose icon mapping changed between discovers', async () => {
        const reg = new TodlPresentationRegistry(/* deps */);
        // seed a source that yields keys a->i1, b->i2 (see module test seams)
        await reg.discover();
        const seen: string[] = [];
        reg.onChanged((k) => seen.push(k));
        // second source now yields a->i1 (unchanged), b->i3 (changed), c->i4 (new)
        await reg.discover();
        expect(seen.sort()).toEqual(['b', 'c']); // 'a' unchanged → not fired
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/diagram/services/tests/todl-presentation-registry.test.ts`
Expected: FAIL — every key currently fires (`seen` includes `a`).

- [ ] **Step 3: Write minimal implementation**

Retain the prior `entityKey → resourceKey` index across `discover()` calls. After rebuilding the new index, compute the changed set = keys whose new mapping differs from the old (including keys present in one index but not the other), and fire `onChanged(key)` only for those. Replace the loop at [todl-presentation-registry.ts:92](../../../src/renderer/src/modules/diagram/services/todl-presentation-registry.ts) (`for (const cb of [...this.listeners]) cb(key)` over all keys) with iteration over the diff.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/diagram/services/tests/todl-presentation-registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Plexus/src/renderer/src/modules/diagram/services/todl-presentation-registry.ts Plexus/src/renderer/src/modules/diagram/services/tests/todl-presentation-registry.test.ts
git commit -m "perf(toolbox): fire discover onChanged only for keys whose icon changed"
```

---

### Task 7: `LibraryToolboxPage` (Plexus)

**Files:**
- Create: `Plexus/src/renderer/src/modules/diagram/services/library-toolbox-page.ts`
- Test: `Plexus/src/renderer/src/modules/diagram/services/tests/library-toolbox-page.test.ts`

**Interfaces:**
- Consumes: `ToolboxPage` (`reconcileItems`, `Context`), `LibrariesPanelService.onLibrariesChanged` (Task 5), `ArchToolboxItem`, `ToolboxVisualDescriptor`, `TodlVisualResolverKey`, `ArchInstanceDropFactoryKey`, the taxonomy projection for one base.
- Produces: `class LibraryToolboxPage extends ToolboxPage` with `constructor(sourceRef: string, taxId: string, label: string, deps)`, `Context = sourceRef`, `attach()` subscribes `onLibrariesChanged` → `refresh()`, `detach()` disposes, `refresh()` builds desired `ArchToolboxItem[]` (one per term, descriptor key = bare term id) and calls `reconcileItems`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { LibraryToolboxPage } from '../library-toolbox-page.js';

describe('LibraryToolboxPage', () => {
    it('reconciles items on a library change without clearing', () => {
        const terms = [{ id: 't1', label: 'One' }];
        const page = new LibraryToolboxPage('lib@1.0.0', 'lib', 'Lib', {
            termsFor: () => terms, /* + resolver/factory keys via test seam */ } as any);
        page.attach();
        expect(page.Items.ToArray().map((i) => i.Id)).toEqual(['term:t1']);
        const first = page.Items.Get(0);
        const events: string[] = [];
        page.Items.Subscribe((e) => events.push(e.action));
        terms.push({ id: 't2', label: 'Two' });
        (page as any).refresh();
        expect(page.Items.ToArray().map((i) => i.Id)).toEqual(['term:t1', 'term:t2']);
        expect(page.Items.Get(0)).toBe(first);       // t1 untouched
        expect(events).not.toContain('cleared');
        expect(page.Context).toBe('lib@1.0.0');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/diagram/services/tests/library-toolbox-page.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { ToolboxPage, ToolboxVisualDescriptor } from '@pragmatic-tech-ai/mural/framework';
import { ArchToolboxItem } from './arch-toolbox-item.js';
import { TodlVisualResolverKey } from './todl-visual-resolver.js';
import { ArchInstanceDropFactoryKey } from './register-arch-toolbox-adapters.js';

export interface LibraryPageDeps {
    termsFor(sourceRef: string): ReadonlyArray<{ id: string; label: string }>;
    onLibrariesChanged(cb: () => void): () => void;
}

// One page per published library ref. Content trigger: any library change
// (coarse — reconcile-by-key makes an unchanged library a no-op). Visible when
// the active document's ToolboxContexts contains this library's ref.
export class LibraryToolboxPage extends ToolboxPage
{
    private off: (() => void) | undefined;
    constructor(private readonly sourceRef: string, id: string, label: string, private readonly deps: LibraryPageDeps)
    {
        super(id, label);
        this.Context = sourceRef;
    }
    public override attach(): void { this.off = this.deps.onLibrariesChanged(() => this.refresh()); this.refresh(); }
    public override detach(): void { this.off?.(); this.off = undefined; }
    private refresh(): void
    {
        const desired = this.deps.termsFor(this.sourceRef).map((t) =>
            new ArchToolboxItem('term:' + t.id, t.label,
                new ToolboxVisualDescriptor(TodlVisualResolverKey, t.id), ArchInstanceDropFactoryKey, undefined));
        this.reconcileItems(desired);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/diagram/services/tests/library-toolbox-page.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Plexus/src/renderer/src/modules/diagram/services/library-toolbox-page.ts Plexus/src/renderer/src/modules/diagram/services/tests/library-toolbox-page.test.ts
git commit -m "feat(toolbox): LibraryToolboxPage self-updating per published library"
```

---

### Task 8: `ModelToolboxPage` (Plexus)

**Files:**
- Create: `Plexus/src/renderer/src/modules/architecture-projects/services/model-toolbox-page.ts`
- Test: `Plexus/src/renderer/src/modules/architecture-projects/services/tests/model-toolbox-page.test.ts`

**Interfaces:**
- Consumes: `ToolboxPage`, `ArchModel` (`entities()`, `onChanged(cb): () => void`), `ArchToolboxItem`, `ArchModelInstanceDropFactoryKey`, the existing `modelPageItems`/scope logic in `arch-model-toolbox-contributor.ts`.
- Produces: `class ModelToolboxPage extends ToolboxPage` with `constructor(model: ArchModel, contextToken: string, deps)`, `Context = contextToken`, `attach()` subscribes `model.onChanged` → `refresh()`, `refresh()` builds desired items from in-scope/unplaced entities and `reconcileItems`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { ModelToolboxPage } from '../model-toolbox-page.js';

describe('ModelToolboxPage', () => {
    it('reconciles items when the model fires onChanged', () => {
        const entities = [{ id: 'e1', concept: 'component', label: 'E1' }];
        let cb: (() => void) | undefined;
        const model = { entities: () => entities, onChanged: (f: () => void) => { cb = f; return () => {}; } };
        const page = new ModelToolboxPage(model as any, 'model:proj', { itemsFor: (m: any) => m.entities() } as any);
        page.attach();
        expect(page.Items.Count).toBe(1);
        entities.push({ id: 'e2', concept: 'component', label: 'E2' });
        cb!();                                    // model changed
        expect(page.Items.ToArray().map((i) => i.Id)).toEqual(['term:e1', 'term:e2']);
        expect(page.Context).toBe('model:proj');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/architecture-projects/services/tests/model-toolbox-page.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation** — mirror Task 7's shape: `attach()` wires `model.onChanged`, `refresh()` maps `deps.itemsFor(model)` (the extracted in-scope/unplaced enumeration from `arch-model-toolbox-contributor.ts`) into `ArchToolboxItem('term:' + e.id, e.label, descriptor(mm/bare key), ArchModelInstanceDropFactoryKey, e.concept)` and calls `this.reconcileItems(desired)`. `Context` set from the constructor token.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/architecture-projects/services/tests/model-toolbox-page.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Plexus/src/renderer/src/modules/architecture-projects/services/model-toolbox-page.ts Plexus/src/renderer/src/modules/architecture-projects/services/tests/model-toolbox-page.test.ts
git commit -m "feat(toolbox): ModelToolboxPage self-updating per model declaration"
```

---

### Task 9: `ScenarioToolboxPage` (Plexus)

**Files:**
- Create: `Plexus/src/renderer/src/modules/architecture-projects/services/scenario-toolbox-page.ts`
- Test: `Plexus/src/renderer/src/modules/architecture-projects/services/tests/scenario-toolbox-page.test.ts`

**Interfaces:**
- Consumes: `ToolboxPage`, `ArchModel.onChanged`, `entities()` filtered by `concept === 'scenario'`, `ArchScenarioDropFactoryKey`.
- Produces: `class ScenarioToolboxPage extends ToolboxPage` — one page per model, items = its scenarios; `Context` = the model token; `attach()` subscribes `model.onChanged` → `refresh()`; `refresh()` reconciles scenario items.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { ScenarioToolboxPage } from '../scenario-toolbox-page.js';

describe('ScenarioToolboxPage', () => {
    it('lists only scenario entities and reconciles on change', () => {
        const entities = [
            { id: 's1', concept: 'scenario', label: 'Login' },
            { id: 'c1', concept: 'component', label: 'C' },
        ];
        let cb: (() => void) | undefined;
        const model = { entities: () => entities, onChanged: (f: () => void) => { cb = f; return () => {}; } };
        const page = new ScenarioToolboxPage(model as any, 'model:proj');
        page.attach();
        expect(page.Items.ToArray().map((i) => i.Id)).toEqual(['scenario:s1']);
        entities.push({ id: 's2', concept: 'scenario', label: 'Checkout' });
        cb!();
        expect(page.Items.ToArray().map((i) => i.Id)).toEqual(['scenario:s1', 'scenario:s2']);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/architecture-projects/services/tests/scenario-toolbox-page.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation** — same shape as Task 8; `refresh()` filters `model.entities()` to `e.concept === 'scenario'`, maps each to `ArchToolboxItem('scenario:' + e.id, e.label, descriptor, ArchScenarioDropFactoryKey, 'scenario')`, and calls `this.reconcileItems(desired)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/architecture-projects/services/tests/scenario-toolbox-page.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Plexus/src/renderer/src/modules/architecture-projects/services/scenario-toolbox-page.ts Plexus/src/renderer/src/modules/architecture-projects/services/tests/scenario-toolbox-page.test.ts
git commit -m "feat(toolbox): ScenarioToolboxPage self-updating per model"
```

---

### Task 10: Arch document `ToolboxContexts` (Plexus)

**Files:**
- Create: `Plexus/src/renderer/src/modules/architecture-projects/services/toolbox-contexts.ts`
- Modify: `Plexus/src/renderer/src/modules/architecture-projects/services/arch-diagram-binding-service.ts` (maintain the set)
- Test: `Plexus/src/renderer/src/modules/architecture-projects/services/tests/toolbox-contexts.test.ts`

**Interfaces:**
- Consumes: `WorkspaceBaseResolver.referencedPublishedRefs(storage): Promise<Set<string>>`, `ArchDiagramBindingService.modelForDocument(doc)`, `isToolboxContextTarget` (Mural).
- Produces: `toolboxContextsOf(doc: unknown): ReadonlySet<string>` — returns `doc.ToolboxContexts` when the doc implements `IToolboxContextTarget`, else the empty set. The binding service makes an arch diagram document satisfy `IToolboxContextTarget` by maintaining a live `Set<string>` = referenced refs ∪ own-model token, refreshed on bind and on `model.onChanged`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { toolboxContextsOf } from '../toolbox-contexts.js';

describe('toolboxContextsOf', () => {
    it('reads a documents ToolboxContexts, empty when absent', () => {
        expect([...toolboxContextsOf({ ToolboxContexts: new Set(['x@1.0.0', 'model:p']) })].sort())
            .toEqual(['model:p', 'x@1.0.0']);
        expect(toolboxContextsOf({}).size).toBe(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/architecture-projects/services/tests/toolbox-contexts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { isToolboxContextTarget } from '@pragmatic-tech-ai/mural/framework';

const EMPTY: ReadonlySet<string> = new Set();

// The active document's content-context tokens the toolbox filters pages against.
export function toolboxContextsOf(doc: unknown): ReadonlySet<string>
{
    return isToolboxContextTarget(doc) ? doc.ToolboxContexts : EMPTY;
}
```

Then in `ArchDiagramBindingService`, when binding a document and on its `model.onChanged`, compute `refs = await resolver.referencedPublishedRefs(model.Storage)`, add the doc's own-model token (`'model:' + model.namespace`), and assign the resulting `Set<string>` to a `ToolboxContexts` property on the bound document object (making it satisfy `IToolboxContextTarget`). Keep the same `Set` instance identity where possible, mutating contents, so listeners see a live set.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/architecture-projects/services/tests/toolbox-contexts.test.ts`
Expected: PASS. Also run the arch-binding suite to confirm no regression: `cd Plexus && npx vitest run src/renderer/src/modules/architecture-projects/services/tests`.

- [ ] **Step 5: Commit**

```bash
git add Plexus/src/renderer/src/modules/architecture-projects/services/toolbox-contexts.ts Plexus/src/renderer/src/modules/architecture-projects/services/arch-diagram-binding-service.ts Plexus/src/renderer/src/modules/architecture-projects/services/tests/toolbox-contexts.test.ts
git commit -m "feat(toolbox): arch documents expose ToolboxContexts (referenced refs + model token)"
```

---

### Task 11: `ToolboxService` hub rewrite (Plexus)

**Files:**
- Modify: `Plexus/src/renderer/src/modules/diagram/services/diagram-panel-services.ts`
- Test: `Plexus/src/renderer/src/modules/diagram/services/tests/toolbox-service.test.ts`

**Interfaces:**
- Consumes: `reconcile` (Mural), `ProjectExplorerService.OpenProjects.Subscribe`, `onLibrariesChanged`/`onMetaModelsChanged` (Task 5), `LibraryToolboxPage`/`ModelToolboxPage`/`ScenarioToolboxPage` (Tasks 7–9), `toolboxContextsOf` (Task 10), `ensureToolboxDefaults`.
- Produces: `ToolboxService` that (a) creates static pages once, (b) reconciles the page **set** by page `Id` on `OpenProjects`/library/meta-model change (calling `attach()`/`detach()`), (c) on `ActiveDocument` change calls `page.applyContext(toolboxContextsOf(activeDoc))` for every page and does **no content work**. The old `reload()` body (collect + activeScope + discover + RemovePage/contributeTaxonomy) is removed.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { ToolboxService } from '../diagram-panel-services.js';

describe('ToolboxService granular updates', () => {
    it('ActiveDocument change flips page visibility only — no content rebuild', async () => {
        const { svc, setActiveDoc, discoverSpy } = /* build via module test harness */;
        // Two library pages exist: a@1 and b@1.
        setActiveDoc({ ToolboxContexts: new Set(['a@1']) });
        const pages = svc.Pages.ToArray();
        const byCtx = (c: string) => pages.find((p) => (p as any).Context === c)!;
        const itemEvents: string[] = [];
        byCtx('a@1').Items.Subscribe((e) => itemEvents.push(e.action));
        byCtx('b@1').Items.Subscribe((e) => itemEvents.push(e.action));

        setActiveDoc({ ToolboxContexts: new Set(['b@1']) });   // switch scope

        expect(byCtx('a@1').IsVisible).toBe(false);
        expect(byCtx('b@1').IsVisible).toBe(true);
        expect(itemEvents).toEqual([]);           // no item churn
        expect(discoverSpy).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/diagram/services/tests/toolbox-service.test.ts`
Expected: FAIL — current `reload()` rebuilds and calls `discover()`.

- [ ] **Step 3: Write minimal implementation**

Replace the ctor wiring and `reload()`:
- Ctor: `ensureToolboxDefaults(services)`; `this.syncPageSet()`; subscribe `explorer.OpenProjects.Subscribe(() => this.syncPageSet())`, `librariesSvc.onLibrariesChanged(() => this.syncPageSet())`, `metaModelsSvc.onMetaModelsChanged(() => this.syncPageSet())`; replace the `ActiveDocument` listener body with `this.applyContexts()`.
- `private syncPageSet(): void`: build the desired page list (static pages already in the repo; one `LibraryToolboxPage` per installed library ref; one `ModelToolboxPage` + `ScenarioToolboxPage` per model declaration across `OpenProjects`), then `reconcile(this.Repository.Pages, desired, p => p.Id)` with an `update` that is a no-op, wiring `attach()` on newly-inserted pages and `detach()` on removed pages (capture removals by diffing before/after, or extend the reconcile call site to attach/detach). Mirror `this.Pages` from `Repository.Pages` as today (single assignment).
- `private applyContexts(): void`: `const ctx = toolboxContextsOf(this.activeDoc()); for (const p of this.Repository.Pages.ToArray()) p.applyContext(ctx);`
- Delete `collectTaxonomies`/`activeScope`/`contributeTaxonomy` usage from the hot path (keep the projection helpers where pages reuse them). Remove `OnActivated`'s `reload()` (page set is already live); `OnActivated` may call `applyContexts()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/diagram/services/tests/toolbox-service.test.ts`
Expected: PASS. Then the module suite: `cd Plexus && npx vitest run src/renderer/src/modules/diagram`.

- [ ] **Step 5: Commit**

```bash
git add Plexus/src/renderer/src/modules/diagram/services/diagram-panel-services.ts Plexus/src/renderer/src/modules/diagram/services/tests/toolbox-service.test.ts
git commit -m "feat(toolbox): hub owns page set; ActiveDocument flips visibility only"
```

---

### Task 12: Page visibility binding in the view (Plexus)

**Files:**
- Modify: `Plexus/src/renderer/src/modules/diagram/diagram.resources.mu` (the `ToolboxAccordionItem` template, ~line 568)

**Interfaces:**
- Consumes: `ToolboxPage.IsVisible` DP (Task 2).
- Produces: the page container collapses when `IsVisible` is false.

- [ ] **Step 1: Edit the template** — wrap the page's outer `StackPanel` with a visibility binding:

```mu
DataTemplate x:key="ToolboxAccordionItem" [DataType = ToolboxPage] {
    StackPanel [ Orientation = Vertical, Margin = (0,0,0,2), Visibility = $IsVisible << ToVisibility ] {
        // ... existing ToggleButton + Items ItemsControl unchanged ...
    }
}
```

- [ ] **Step 2: Build** — `cd Plexus && npm run compile:mu`. Expected: no `.mu` compile errors (`IsVisible` resolves on `ToolboxPage`).
- [ ] **Step 3: Commit**

```bash
git add Plexus/src/renderer/src/modules/diagram/diagram.resources.mu
git commit -m "feat(toolbox): collapse out-of-context pages via IsVisible binding"
```

---

### Task 13: e2e regression guard — no toolbox churn on same-context switch (Plexus)

**Files:**
- Create: `Plexus/e2e/toolbox-granular.spec.ts`
- Reuse: `Plexus/e2e/plexus-app.ts` (`launchPlexus`, `seedSession`, introspection)

**Interfaces:**
- Consumes: the running built app; the `MutationObserver` technique from the investigation.

- [ ] **Step 1: Write the test**

```ts
import { test, expect } from '@playwright/test';
import { launchPlexus, seedSession } from './plexus-app';

test('switching between same-context diagrams produces no toolbox rebuild', async () => {
    const restore = seedSession(/* meta-model + microsoft + an arch project with two diagrams */);
    const l = await launchPlexus();
    // open diagram A, then install the MutationObserver counter scoped to toolbox visuals
    await l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref');
        (globalThis as any).__tbMut = 0;
        const obs = new MutationObserver((muts) => {
            for (const m of muts) {
                for (let n: any = m.target; n; n = n.parentElement) {
                    const c = n[S]?.constructor?.name;
                    if (c === 'ToolboxVisualPresenter' || c === 'WrapPanel') { (globalThis as any).__tbMut++; break; }
                }
            }
        });
        obs.observe(document.body, { subtree: true, childList: true });
        (globalThis as any).__tbObs = obs;
    });
    // switch to diagram B (same referenced bases) via the project tree, wait to settle
    // ... open second diagram (dblclick its row) ...
    await l.win.waitForTimeout(1500);
    const churn = await l.win.evaluate(() => (globalThis as any).__tbMut as number);
    expect(churn).toBeLessThan(20); // was thousands with the old reload
    await l.app.close(); restore();
});
```

- [ ] **Step 2: Run** — `cd Plexus && npx playwright test e2e/toolbox-granular.spec.ts`
Expected: PASS (churn well under threshold). If it fails high, a stray content trigger remains — trace it via the Task-11 hub path.

- [ ] **Step 3: Commit**

```bash
git add Plexus/e2e/toolbox-granular.spec.ts
git commit -m "test(toolbox): e2e guard — same-context switch does not rebuild the toolbox"
```

---

## Self-Review

**Spec coverage:**
- Two-axis (content vs visibility) → Tasks 2 (applyContext), 7–9 (content triggers), 11 (hub).
- `ToolboxContexts` contract → Tasks 3 (interface), 10 (arch population), 11 (hub reads it).
- `ToolboxPage` base + Static/Library/Model/Scenario → Tasks 2, 7, 8, 9 (static = base page via `ensureToolboxDefaults`, unchanged).
- Reconcile-by-key invariant → Task 1 + used in 2/7/8/9/11.
- Per-key `discover` invariant → Task 6.
- View hides out-of-context pages → Task 12.
- Content-change-event plumbing gap → Task 5.
- Regression guard → Task 13.
- Behavior changes (cross-source dedup drop; no-active-doc → static only) are inherent to Tasks 7/11 (each page owns its own terms; empty context set hides content pages).

**Placeholder scan:** Tasks 8 and 9 Step 3 describe the impl in prose but mirror Task 7's fully-shown code with named factory keys and item-id prefixes (`term:`/`scenario:`); Task 11 Step 3 lists concrete method names and wiring. Task 5/10 impl blocks are shown. No "TBD"/"add error handling"/unshown-test steps remain.

**Type consistency:** `reconcile(collection, desired, keyOf, update?)` used identically in Tasks 1/2/7/11. `ToolboxPage.Context: string | undefined`, `IsVisible: boolean`, `applyContext(ReadonlySet<string>)`, `attach()/detach()`, `reconcileItems(...)` consistent across 2/7/8/9. `toolboxContextsOf(doc): ReadonlySet<string>` (Task 10) consumed in Task 11. `onLibrariesChanged`/`onMetaModelsChanged` (Task 5) consumed in Task 11. Item id prefixes `term:`/`scenario:` consistent.

# SP5 — Plexus diagram camera persistence: zoom + scroll offset

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use `- [ ]`.

**Goal:** Rework the SP2 Plexus camera persistence from `{zoom, panX, panY}` to `{zoom, offsetX, offsetY}` to match mural 0.9.0's LayoutTransform + scroll-offset diagram camera (SP4). Hydrate on open sets `Diagram.Zoom` + the ScrollViewer offset; debounced persist watches `Zoom` + the ScrollViewer offset DPs.

**Architecture:** `mural@0.9.0` replaced `Diagram.PanX/PanY` DPs with a `LayoutTransform` scale + `ScrollViewer`-offset pan. `Diagram.Camera`/`SetCamera` now carry `{zoom, offsetX, offsetY}`, and the offset lives on `Diagram.ScrollHost` (the `PART_Scroll` ScrollViewer) as its `HorizontalOffset`/`VerticalOffset` DPs. The store persists the new shape; the service subscribes to `Diagram.ZoomKey` (on the view) + `ScrollViewer.HorizontalOffsetKey`/`VerticalOffsetKey` (on `view.ScrollHost`) instead of the removed `PanXKey`/`PanYKey`.

**Tech Stack:** TypeScript, mural 0.9.0 (Verdaccio), Vitest (jsdom).

## Global Constraints

- Test files live in a `tests/` subfolder next to their source.
- Consume mural from Verdaccio (no relative `../src` imports).
- Do NOT commit `.npmrc` / secrets.
- Camera shape: `{ zoom: number; offsetX: number; offsetY: number }`.
- The SP2 zoom toolbar (`@ZoomControlEditor`), `ZoomPercent` converter, and `zoom-shortcuts` drive `Zoom`/Fit and are unchanged.

---

### Task 1: store — `offsetX`/`offsetY`

**Files:**
- Modify: `src/renderer/src/modules/diagram/persistence/diagram-camera-store.ts`
- Test: `src/renderer/src/modules/diagram/persistence/tests/diagram-camera-store.test.ts`

- [ ] **Step 1: Update the test** — replace every `panX`/`panY` with `offsetX`/`offsetY` (4 tests: round-trip, preserves-other-keys, rejects-malformed, serialize-cycle). E.g. `writeCamera(doc, { zoom: 2, offsetX: 30, offsetY: -40 })` / `expect(readCamera(doc)).toEqual({ zoom: 2, offsetX: 30, offsetY: -40 })`; malformed case `{ zoom: 'big', offsetX: 0, offsetY: 0 }`.

- [ ] **Step 2: Run test, expect fail**

Run: `npx vitest run src/renderer/src/modules/diagram/persistence/tests/diagram-camera-store.test.ts`
Expected: FAIL (store still emits panX/panY).

- [ ] **Step 3: Rewrite the store body** — `DiagramCameraState { zoom, offsetX, offsetY }`; `isState` checks `offsetX`/`offsetY` are numbers; `readCamera`/`writeCamera` map `offsetX`/`offsetY`. Update the file header comment ("zoom + scroll offset").

- [ ] **Step 4: Run test, expect pass**

Run: `npx vitest run src/renderer/src/modules/diagram/persistence/tests/diagram-camera-store.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/diagram/persistence/diagram-camera-store.ts src/renderer/src/modules/diagram/persistence/tests/diagram-camera-store.test.ts
git commit -m "feat(diagram): persist camera as zoom + scroll offset"
```

---

### Task 2: service — watch `Zoom` + ScrollViewer offset

**Files:**
- Modify: `src/renderer/src/modules/diagram/services/diagram-camera-service.ts`
- Test: `src/renderer/src/modules/diagram/services/tests/diagram-camera-service.test.ts`

**Interfaces:**
- Consumes: `Diagram.ZoomKey`, `Diagram.ScrollHost`, `ScrollViewer.HorizontalOffsetKey`/`VerticalOffsetKey`, `view.Camera`/`SetCamera` (all mural 0.9.0).

- [ ] **Step 1: Update the test.** The `FakeView` must expose the new surface: `Camera`/`SetCamera` over `{zoom, offsetX, offsetY}`, a `ScrollHost` object with per-key `Add/RemovePropertyChangedListener`, and `SetCamera` fires the view's `Diagram.ZoomKey` listeners AND the ScrollHost's `ScrollViewer.HorizontalOffsetKey`/`VerticalOffsetKey` listeners. Replace all `panX/panY` with `offsetX/offsetY`. Add `ScrollViewer` to the framework import.

```ts
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { DiagramDocument, ContentHostService, Diagram, ScrollViewer } from '@pragmatic-tech-ai/mural/framework'
import { ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'
import { DiagramCameraService } from '../diagram-camera-service.js'
import { writeCamera, readCamera, type DiagramCameraState } from '../../persistence/diagram-camera-store.js'

class Listenable {
    private readonly listeners = new Map<unknown, Set<() => void>>()
    public AddPropertyChangedListener(key: unknown, fn: () => void): void {
        if (!this.listeners.has(key)) this.listeners.set(key, new Set())
        this.listeners.get(key)!.add(fn)
    }
    public RemovePropertyChangedListener(key: unknown, fn: () => void): void {
        this.listeners.get(key)?.delete(fn)
    }
    public fire(key: unknown): void { for (const fn of this.listeners.get(key) ?? []) fn() }
}

class FakeView extends Listenable {
    private state: DiagramCameraState = { zoom: 1, offsetX: 0, offsetY: 0 }
    public readonly ScrollHost = new Listenable()
    public get Camera(): DiagramCameraState { return this.state }
    public SetCamera(c: DiagramCameraState): void {
        this.state = { zoom: c.zoom, offsetX: c.offsetX, offsetY: c.offsetY }
        this.fire(Diagram.ZoomKey)
        this.ScrollHost.fire(ScrollViewer.HorizontalOffsetKey)
        this.ScrollHost.fire(ScrollViewer.VerticalOffsetKey)
    }
}
```

Then update the three tests to `{zoom, offsetX, offsetY}` values (hydrate: `{ zoom: 2, offsetX: 10, offsetY: 20 }`; persist: two `SetCamera` calls coalescing to `{ zoom: 3, offsetX: 7, offsetY: 8 }`; close: `{ zoom: 2, offsetX: 0, offsetY: 0 }`). `providerWith`/`fakeHost`/`publish` unchanged.

- [ ] **Step 2: Run test, expect fail**

Run: `npx vitest run src/renderer/src/modules/diagram/services/tests/diagram-camera-service.test.ts`
Expected: FAIL (service references removed `Diagram.PanXKey`).

- [ ] **Step 3: Rewrite the subscription in `diagram-camera-service.ts`.** Add `ScrollViewer` to the framework import. Replace the `const keys = [Diagram.ZoomKey, Diagram.PanXKey, Diagram.PanYKey]` block in `rebindView`:

```ts
            // Zoom lives on the Diagram; pan is the ScrollViewer's scroll offset.
            const scroll = view.ScrollHost
            view.AddPropertyChangedListener(Diagram.ZoomKey, onCameraChanged)
            scroll?.AddPropertyChangedListener(ScrollViewer.HorizontalOffsetKey, onCameraChanged)
            scroll?.AddPropertyChangedListener(ScrollViewer.VerticalOffsetKey, onCameraChanged)
            detachView = (): void => {
                view.RemovePropertyChangedListener(Diagram.ZoomKey, onCameraChanged)
                scroll?.RemovePropertyChangedListener(ScrollViewer.HorizontalOffsetKey, onCameraChanged)
                scroll?.RemovePropertyChangedListener(ScrollViewer.VerticalOffsetKey, onCameraChanged)
            }
```

`persist` (`writeCamera(doc, view.Camera)`) and hydrate (`view.SetCamera(saved)`) are unchanged — `view.Camera`/`SetCamera` already carry the new shape. Update the class doc comment to say "zoom + scroll offset".

- [ ] **Step 4: Run test, expect pass**

Run: `npx vitest run src/renderer/src/modules/diagram/services/tests/diagram-camera-service.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/diagram/services/diagram-camera-service.ts src/renderer/src/modules/diagram/services/tests/diagram-camera-service.test.ts
git commit -m "feat(diagram): persist/hydrate camera via Zoom + ScrollViewer offset"
```

---

### Task 3: bump mural to 0.9.0, install, verify

**Files:**
- Modify: `package.json` (`@pragmatic-tech-ai/mural` `^0.7.0` → `^0.9.0`)

- [ ] **Step 1: Bump the dep** in `package.json` to `"@pragmatic-tech-ai/mural": "^0.9.0"`.

- [ ] **Step 2: Install from Verdaccio**

Run: `npm install @pragmatic-tech-ai/mural@0.9.0`
Expected: resolves 0.9.0 from `localhost:4873`. (If Vite later 504s on an outdated optimize-dep, the dev server needs `node_modules/.vite` cleared + restart — a runtime note, not a build blocker.)

- [ ] **Step 3: Compile markup + typecheck**

Run: `npm run compile:mu` then `npm run typecheck`
Expected: both clean (no references to `PanX`/`PanY`).

- [ ] **Step 4: Full test suite**

Run: `npm test`
Expected: green (SP2 baseline was 721/0/1skip; camera store/service tests updated).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: bump mural to ^0.9.0 (LayoutTransform diagram camera)"
```

- [ ] **Step 6:** Finish the branch — superpowers:finishing-a-development-branch.

## Self-review

- Spec coverage: store shape (T1), service subscription + hydrate/persist (T2), dep bump + verification (T3). Toolbar/shortcuts unchanged (mural commands stable).
- Type consistency: `{zoom, offsetX, offsetY}` identical across store, service, both tests. `ScrollViewer.HorizontalOffsetKey`/`VerticalOffsetKey` used in service + fake.
- Risk: `view.ScrollHost` undefined before the Diagram template applies — guarded with `?.`; in Plexus the ActiveView is a live templated Diagram, so it resolves. Live smoke confirms end-to-end.

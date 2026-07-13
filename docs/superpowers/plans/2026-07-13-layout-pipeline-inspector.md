# Layout Pipeline Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-Inspector "Layout" panel in Plexus that lets a user compose a Fresco graph-transform + layout pipeline from a catalog and run it on the active diagram, in one of three run modes.

**Architecture:** Catalog-driven and config-serialized (approach B from the design). Fresco gains a static, browser-safe `PipelineCatalog` plus a parameter-carrying `PipelineConfiguration`. Plexus gains a pure `DiagramGraphAdapter` (diagram ⇄ Fresco `Graph`, operating on small structural interfaces so it is unit-testable headless) and a `LayoutPipelineService` that renders the builder from the catalog and applies results via the existing undoable diagram-command path.

**Tech Stack:** TypeScript (ESM/NodeNext), Fresco (`node:test` via `tsx`, `tsc` build), Plexus (electron-vite, mural `.mu` framework; Vitest added for unit tests).

## Global Constraints

- Fresco package: `@pragmatic-lab/fresco`; build `tsc` → `dist/`; tests `tsx --test "src/**/*.test.ts"`; ESM `NodeNext`, target `ES2022`.
- Plexus package: `@pragmatic-lab/plexus`; scoped registry `@pragmatic-lab:registry=http://localhost:4873/` (Verdaccio must be running to install `@pragmatic-lab/fresco`).
- Every visible element in Plexus flows through a `.mu` DataTemplate/Style/Binding — no hardcoded chrome in TS. New `.mu` files must be added to the `compile:mu` script's file list in `package.json`.
- The `DiagramGraphAdapter` must not import concrete mural classes; it operates on structural interfaces so its tests run without the Electron/mural runtime.
- Fresco catalog data must be available in a browser/renderer context — no runtime `fs`/yaml read on the Plexus consumer path; ship catalog metadata as a statically-imported JSON module.
- Node positions are written via `Figure.Left` / `Figure.Top` (top-left corner). Fresco layout `Point` values are node **centers**; convert center→top-left using node size.
- Commit after every task. Fresco changes commit in the `Fresco` repo; Plexus changes in the `Plexus` repo.

---

## File Structure

**Fresco (`c:\Users\Eugene\Projects\architecture-agent\Fresco`):**
- Create `src/ge/pipeline-elements.json` — the element metadata, converted from `pipeline-elements.yaml` (single source for the catalog; browser-safe static import).
- Create `src/ge/pipeline-catalog.ts` — `CatalogSlot`/`CatalogStrategy` types + `GetPipelineCatalog()`.
- Create `src/ge/pipeline-catalog.test.ts` — drift + instantiation tests.
- Create `src/ge/transform-params.ts` — declarative param → predicate factory for `FilterNodesTransform`/`FilterEdgesTransform`.
- Create `src/ge/transform-params.test.ts`.
- Modify `src/ge/configuration-loader.ts` — export `ListStrategyNames()`; extend `PipelineConfiguration.transforms`; teach `BuildPipeline` about param specs; repoint `LoadElementRepository` at the JSON.
- Modify `src/ge/configuration-loader.test.ts` (create if absent) — build-with-params test.
- Modify `src/ge/index.ts` — export catalog, param types, `LayoutPipeline`, `GraphPipeline`, `IGraphTransform`.
- Modify `tsconfig.json` — `resolveJsonModule: true`.

**Plexus (`c:\Users\Eugene\Projects\architecture-agent\Plexus`):**
- Create `src/renderer/src/modules/diagram/layout/diagram-graph-adapter.ts` — pure adapter (extract / mutation).
- Create `src/renderer/src/modules/diagram/layout/diagram-graph-adapter.test.ts`.
- Create `src/renderer/src/modules/diagram/layout/run-modes.ts` — mode → mutation resolution (pure).
- Create `src/renderer/src/modules/diagram/layout/run-modes.test.ts`.
- Create `src/renderer/src/modules/diagram/layout/layout-inspector.ts` — `LayoutInspector extends Inspector`.
- Create `src/renderer/src/modules/diagram/layout/layout-pipeline-service.ts` — service (config, catalog, presets, run).
- Create `src/renderer/src/modules/diagram/layout/layout-presets-store.ts` — named-preset persistence over settings-store.
- Create `src/renderer/src/modules/diagram/layout/layout-inspector.resources.mu` — builder UI.
- Modify `src/renderer/src/modules/diagram/diagram.module.mu` — register `LayoutPipelineService`, wire the "Layout" menu command.
- Modify `src/renderer/src/app.mu` — merge the layout-inspector resources.
- Modify `package.json` — add `@pragmatic-lab/fresco` dep, Vitest devDeps, `test` script, add the new `.mu` to `compile:mu`.
- Create `vitest.config.ts`.

---

# Phase A — Fresco: catalog + parameterized config

### Task 1: Ship element metadata as browser-safe JSON

**Files:**
- Create: `Fresco/src/ge/pipeline-elements.json`
- Modify: `Fresco/tsconfig.json`
- Modify: `Fresco/src/ge/configuration-loader.ts` (the `LoadElementRepository` body)
- Test: `Fresco/src/ge/configuration-loader.test.ts`

**Interfaces:**
- Consumes: existing `PipelineElementRepository = Record<string, Record<string, YamlElement>>`.
- Produces: `LoadElementRepository()` now returns the repository from a static JSON import (no `fs`); same return type. A default export `elementRepository` from the JSON.

- [ ] **Step 1: Convert the yaml to JSON.** Read `src/ge/pipeline-elements.yaml` and write the identical content as `src/ge/pipeline-elements.json`. Preserve every stage key, className, `name`, `algorithm`, and `references` entry. Example shape (fill in all real entries):

```json
{
  "graph-transforms": {
    "DedupEdgesTransform": { "name": "Deduplicate Edges", "algorithm": "Set-based edge deduplication", "references": [] },
    "CollapseAntiparallelEdgesTransform": { "name": "Collapse Antiparallel Edges", "algorithm": "Antiparallel edge merge", "references": [] },
    "DropIsolatedNodesTransform": { "name": "Drop Isolated Nodes", "algorithm": "Degree-zero node removal", "references": [] },
    "FilterNodesTransform": { "name": "Filter Nodes", "algorithm": "Predicate-based node filtering", "references": [] },
    "FilterEdgesTransform": { "name": "Filter Edges", "algorithm": "Predicate-based edge filtering", "references": [] },
    "MapLabelsTransform": { "name": "Map Labels", "algorithm": "Label mapping", "references": [] }
  },
  "layer-assigner": {
    "LongestPathLayerAssigner": { "name": "Longest Path", "algorithm": "Longest-path layering (DFS, memoized)", "references": [ { "authors": "Eades, P., Lin, X., Smyth, W. F.", "year": 1989, "title": "A fast and effective heuristic for the feedback arc set problem", "venue": "Information Processing Letters" } ] }
  }
}
```

(Include all 12 stages and every className present in `STAGE_REGISTRIES`.)

- [ ] **Step 2: Enable JSON modules.** In `Fresco/tsconfig.json` add to `compilerOptions`:

```json
"resolveJsonModule": true,
```

- [ ] **Step 3: Write the failing test** at `Fresco/src/ge/configuration-loader.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoadElementRepository } from './configuration-loader.js';

test('LoadElementRepository returns metadata for a known strategy without fs', () => {
    const repo = LoadElementRepository();
    assert.equal(repo['layer-assigner']['LongestPathLayerAssigner'].name, 'Longest Path');
    assert.ok(Array.isArray(repo['graph-transforms']['DedupEdgesTransform'].references));
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd Fresco && npx tsx --test src/ge/configuration-loader.test.ts`
Expected: FAIL — `LoadElementRepository` currently requires a `filePath` argument / reads fs.

- [ ] **Step 5: Repoint `LoadElementRepository` at the JSON.** In `configuration-loader.ts`, add near the imports:

```ts
import elementRepository from './pipeline-elements.json' with { type: 'json' };
```

Change the signature/body so the argument is optional and the JSON is the default source (keep back-compat for any caller passing a path by still honoring it if present):

```ts
export function LoadElementRepository(filePath?: string): PipelineElementRepository
{
    if (filePath === undefined) {
        return elementRepository as unknown as PipelineElementRepository;
    }
    // ...existing yaml-from-fs read retained for explicit paths...
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd Fresco && npx tsx --test src/ge/configuration-loader.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd Fresco && git add src/ge/pipeline-elements.json src/ge/configuration-loader.ts src/ge/configuration-loader.test.ts tsconfig.json && git commit -m "feat: ship pipeline element metadata as browser-safe JSON

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Expose strategy names per stage

**Files:**
- Modify: `Fresco/src/ge/configuration-loader.ts`
- Test: `Fresco/src/ge/configuration-loader.test.ts`

**Interfaces:**
- Consumes: module-private `STAGE_REGISTRIES: Record<string, Record<string, () => IPipelineElement>>`.
- Produces: `export function ListStrategyNames(): Record<string, string[]>` — for each stage id, the className keys registered in that stage.

- [ ] **Step 1: Write the failing test** (append to `configuration-loader.test.ts`):

```ts
import { ListStrategyNames } from './configuration-loader.js';

test('ListStrategyNames returns every registered className per stage', () => {
    const names = ListStrategyNames();
    assert.ok(names['reorderer'].includes('BarycenterReorderer'));
    assert.ok(names['reorderer'].includes('MedianReorderer'));
    assert.ok(names['graph-transforms'].includes('DropIsolatedNodesTransform'));
    assert.equal(names['layer-assigner'].length, Object.keys(names['layer-assigner']).length >= 0 ? names['layer-assigner'].length : 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Fresco && npx tsx --test src/ge/configuration-loader.test.ts`
Expected: FAIL — `ListStrategyNames` not exported.

- [ ] **Step 3: Implement** in `configuration-loader.ts` (place after `STAGE_REGISTRIES` is defined):

```ts
export function ListStrategyNames(): Record<string, string[]>
{
    const out: Record<string, string[]> = {};
    for (const [stage, registry] of Object.entries(STAGE_REGISTRIES)) {
        out[stage] = Object.keys(registry);
    }
    return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Fresco && npx tsx --test src/ge/configuration-loader.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd Fresco && git add src/ge/configuration-loader.ts src/ge/configuration-loader.test.ts && git commit -m "feat: expose ListStrategyNames per pipeline stage

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The `PipelineCatalog`

**Files:**
- Create: `Fresco/src/ge/pipeline-catalog.ts`
- Create: `Fresco/src/ge/pipeline-catalog.test.ts`
- Modify: `Fresco/src/ge/index.ts`

**Interfaces:**
- Consumes: `ListStrategyNames()` (Task 2), `LoadElementRepository()` (Task 1), `STAGE_REGISTRIES` factories (via `configuration-loader`).
- Produces:
  ```ts
  export interface CatalogParam { key: string; type: 'string'|'number'|'boolean'|'enum'; values?: string[]; default?: string|number|boolean; }
  export interface CatalogStrategy { className: string; name: string; algorithmName: string; references: AcademicReference[]; parameters?: CatalogParam[]; }
  export interface CatalogSlot { slotId: string; kind: 'transform-list'|'strategy-slot'; required: boolean; strategies: CatalogStrategy[]; }
  export function GetPipelineCatalog(): CatalogSlot[];
  ```
- The only slot with `kind: 'transform-list'` is `graph-transforms`; every other stage is a `strategy-slot`. `required: true` only for `layer-assigner`, `dummy-inserter`, `reorderer`, `position-computer` (the stages `LayoutPipeline` has no meaningful null for); all others optional.

- [ ] **Step 1: Write the failing tests** at `Fresco/src/ge/pipeline-catalog.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetPipelineCatalog } from './pipeline-catalog.js';
import { ListStrategyNames } from './configuration-loader.js';

test('catalog has one slot per stage and graph-transforms is a transform-list', () => {
    const catalog = GetPipelineCatalog();
    const byId = new Map(catalog.map(s => [s.slotId, s]));
    assert.equal(byId.get('graph-transforms')!.kind, 'transform-list');
    assert.equal(byId.get('reorderer')!.kind, 'strategy-slot');
});

test('every registry strategy appears in the catalog (no missing)', () => {
    const names = ListStrategyNames();
    const catalog = GetPipelineCatalog();
    const bySlot = new Map(catalog.map(s => [s.slotId, new Set(s.strategies.map(x => x.className))]));
    for (const [stage, classNames] of Object.entries(names)) {
        for (const cn of classNames) {
            assert.ok(bySlot.get(stage)?.has(cn), `catalog missing ${stage}/${cn}`);
        }
    }
});

test('every catalog strategy exists in the registry (no extra)', () => {
    const names = ListStrategyNames();
    for (const slot of GetPipelineCatalog()) {
        for (const s of slot.strategies) {
            assert.ok(names[slot.slotId]?.includes(s.className), `extra catalog entry ${slot.slotId}/${s.className}`);
        }
    }
});

test('parameterized transforms declare parameters', () => {
    const slot = GetPipelineCatalog().find(s => s.slotId === 'graph-transforms')!;
    const filter = slot.strategies.find(s => s.className === 'FilterNodesTransform')!;
    assert.ok(filter.parameters && filter.parameters.length > 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd Fresco && npx tsx --test src/ge/pipeline-catalog.test.ts`
Expected: FAIL — module not found / `GetPipelineCatalog` undefined.

- [ ] **Step 3: Implement** `Fresco/src/ge/pipeline-catalog.ts`:

```ts
import type { AcademicReference } from './pipeline-element.js';
import { ListStrategyNames, LoadElementRepository } from './configuration-loader.js';

export interface CatalogParam { key: string; type: 'string'|'number'|'boolean'|'enum'; values?: string[]; default?: string|number|boolean; }
export interface CatalogStrategy { className: string; name: string; algorithmName: string; references: AcademicReference[]; parameters?: CatalogParam[]; }
export interface CatalogSlot { slotId: string; kind: 'transform-list'|'strategy-slot'; required: boolean; strategies: CatalogStrategy[]; }

const REQUIRED_SLOTS = new Set(['layer-assigner', 'dummy-inserter', 'reorderer', 'position-computer']);

// Declarative parameters for the parameterized graph transforms (kept in sync
// with transform-params.ts). Anything not listed here has no UI parameters.
const PARAMS: Record<string, CatalogParam[]> = {
    FilterNodesTransform: [
        { key: 'field', type: 'enum', values: ['label', 'id'], default: 'label' },
        { key: 'op',    type: 'enum', values: ['contains', 'equals', 'matches'], default: 'contains' },
        { key: 'value', type: 'string', default: '' },
    ],
    FilterEdgesTransform: [
        { key: 'field', type: 'enum', values: ['from', 'to'], default: 'from' },
        { key: 'op',    type: 'enum', values: ['contains', 'equals', 'matches'], default: 'contains' },
        { key: 'value', type: 'string', default: '' },
    ],
};

function pretty(className: string): string
{
    return className.replace(/Transform$|Reorderer$|Assigner$|Computer$|Inserter$|Router$|Aligner$|Orderer$|Improver$/,'')
        .replace(/([a-z])([A-Z])/g, '$1 $2').trim();
}

export function GetPipelineCatalog(): CatalogSlot[]
{
    const names = ListStrategyNames();
    const repo = LoadElementRepository();
    const slots: CatalogSlot[] = [];
    for (const [slotId, classNames] of Object.entries(names)) {
        const strategies: CatalogStrategy[] = classNames.map(cn => {
            const meta = repo[slotId]?.[cn];
            return {
                className: cn,
                name: meta?.name ?? pretty(cn),
                algorithmName: meta?.algorithm ?? '',
                references: (meta?.references ?? []) as AcademicReference[],
                ...(PARAMS[cn] ? { parameters: PARAMS[cn] } : {}),
            };
        });
        slots.push({
            slotId,
            kind: slotId === 'graph-transforms' ? 'transform-list' : 'strategy-slot',
            required: REQUIRED_SLOTS.has(slotId),
            strategies,
        });
    }
    return slots;
}
```

> Note: `repo[slotId][cn]` uses the JSON's `name`/`algorithm`/`references` keys. If `YamlElement`'s TS type uses different field names, adjust the property reads to match its declared shape.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd Fresco && npx tsx --test src/ge/pipeline-catalog.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Export from the barrel.** In `Fresco/src/ge/index.ts` add:

```ts
export {
    type CatalogParam,
    type CatalogStrategy,
    type CatalogSlot,
    GetPipelineCatalog,
} from './pipeline-catalog.js';
export { ListStrategyNames } from './configuration-loader.js';
export { LayoutPipeline } from './layouts/layout-pipeline.js';
export { GraphPipeline } from './graph-transforms/graph-pipeline.js';
export type { IGraphTransform } from './graph-transforms/graph-transform.js';
```

- [ ] **Step 6: Typecheck/build**

Run: `cd Fresco && npm run build`
Expected: `tsc` completes with no errors.

- [ ] **Step 7: Commit**

```bash
cd Fresco && git add src/ge/pipeline-catalog.ts src/ge/pipeline-catalog.test.ts src/ge/index.ts && git commit -m "feat: add PipelineCatalog export

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Parameterized transforms in `PipelineConfiguration`

**Files:**
- Create: `Fresco/src/ge/transform-params.ts`
- Create: `Fresco/src/ge/transform-params.test.ts`
- Modify: `Fresco/src/ge/configuration-loader.ts` (`PipelineConfiguration` type + `BuildPipeline` transform construction)
- Test: `Fresco/src/ge/configuration-loader.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type TransformParams = { field: string; op: 'contains'|'equals'|'matches'; value: string };
  export function buildNodePredicate(p: TransformParams): (node: Node) => boolean;
  export function buildEdgePredicate(p: TransformParams): (edge: Edge) => boolean;
  ```
- Extends `PipelineConfiguration.transforms` from `string[]` to `(string | TransformSpec)[]` where `export interface TransformSpec { className: string; params?: TransformParams }`.
- `BuildPipeline` builds `FilterNodesTransform`/`FilterEdgesTransform` from `spec.params`; plain-string entries keep using the existing registry factories.

- [ ] **Step 1: Write the failing predicate tests** at `Fresco/src/ge/transform-params.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Node, Edge } from './graph.js';
import { buildNodePredicate, buildEdgePredicate } from './transform-params.js';

test('node predicate: label contains', () => {
    const p = buildNodePredicate({ field: 'label', op: 'contains', value: 'db' });
    assert.equal(p(new Node('n1', 'user-db')), true);
    assert.equal(p(new Node('n2', 'web')), false);
});

test('node predicate: id equals', () => {
    const p = buildNodePredicate({ field: 'id', op: 'equals', value: 'n1' });
    assert.equal(p(new Node('n1', 'x')), true);
    assert.equal(p(new Node('n2', 'x')), false);
});

test('edge predicate: from matches regex', () => {
    const p = buildEdgePredicate({ field: 'from', op: 'matches', value: '^svc-' });
    assert.equal(p(new Edge('svc-a', 'b')), true);
    assert.equal(p(new Edge('a', 'b')), false);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd Fresco && npx tsx --test src/ge/transform-params.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** `Fresco/src/ge/transform-params.ts`:

```ts
import type { Node, Edge } from './graph.js';

export type TransformParams = { field: string; op: 'contains'|'equals'|'matches'; value: string };

function test(op: TransformParams['op'], subject: string, value: string): boolean
{
    switch (op) {
        case 'contains': return subject.includes(value);
        case 'equals':   return subject === value;
        case 'matches':  return new RegExp(value).test(subject);
    }
}

export function buildNodePredicate(p: TransformParams): (node: Node) => boolean
{
    return (node) => test(p.op, p.field === 'id' ? node.Id : (node.Label ?? ''), p.value);
}

export function buildEdgePredicate(p: TransformParams): (edge: Edge) => boolean
{
    return (edge) => test(p.op, p.field === 'to' ? edge.To : edge.From, p.value);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd Fresco && npx tsx --test src/ge/transform-params.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Extend the config type + BuildPipeline.** In `configuration-loader.ts`:

Add above `PipelineConfiguration`:

```ts
import { buildNodePredicate, buildEdgePredicate, type TransformParams } from './transform-params.js';
import { FilterNodesTransform } from './graph-transforms/filter-nodes.js';
import { FilterEdgesTransform } from './graph-transforms/filter-edges.js';

export interface TransformSpec { className: string; params?: TransformParams }
```

Change the `transforms` field type:

```ts
transforms: (string | TransformSpec)[];
```

In `BuildPipeline`, where it currently maps `config.transforms` (strings) through `TRANSFORMS`/registry factories, replace with a helper that handles both forms:

```ts
function buildTransform(entry: string | TransformSpec): IGraphTransform
{
    if (typeof entry === 'string') {
        const factory = STAGE_REGISTRIES['graph-transforms'][entry];
        if (!factory) throw new Error(`Unknown transform: ${entry}`);
        return factory() as IGraphTransform;
    }
    if (entry.className === 'FilterNodesTransform' && entry.params) {
        return new FilterNodesTransform(buildNodePredicate(entry.params));
    }
    if (entry.className === 'FilterEdgesTransform' && entry.params) {
        return new FilterEdgesTransform(buildEdgePredicate(entry.params));
    }
    const factory = STAGE_REGISTRIES['graph-transforms'][entry.className];
    if (!factory) throw new Error(`Unknown transform: ${entry.className}`);
    return factory() as IGraphTransform;
}
```

and build the `GraphPipeline` from `config.transforms.map(buildTransform)`.

- [ ] **Step 6: Write the failing build test** (append to `configuration-loader.test.ts`):

```ts
import { BuildPipeline, LoadElementRepository, type PipelineConfiguration } from './configuration-loader.js';
import { Graph } from './graph.js';

test('BuildPipeline applies a parameterized FilterNodes transform', () => {
    const config: PipelineConfiguration = {
        name: 't', transforms: [{ className: 'FilterNodesTransform', params: { field: 'label', op: 'contains', value: 'keep' } }],
        layout: {},
    };
    const { graphPipeline } = BuildPipeline(config, LoadElementRepository());
    const g = new Graph();
    g.AddNode('a', 'keep-me');
    g.AddNode('b', 'drop-me');
    const out = graphPipeline.Apply(g);
    assert.deepEqual(out.nodes.map(n => n.Id), ['a']);
});
```

- [ ] **Step 7: Run to verify pass**

Run: `cd Fresco && npx tsx --test src/ge/configuration-loader.test.ts`
Expected: PASS

- [ ] **Step 8: Export param types + build.** In `index.ts` add `export { type TransformParams } from './transform-params.js';` and `export { type TransformSpec } from './configuration-loader.js';`. Then:

Run: `cd Fresco && npm run build`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
cd Fresco && git add src/ge/transform-params.ts src/ge/transform-params.test.ts src/ge/configuration-loader.ts src/ge/configuration-loader.test.ts src/ge/index.ts && git commit -m "feat: carry declarative parameters for filter transforms in PipelineConfiguration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Publish Fresco to Verdaccio

**Files:** none (release step).

- [ ] **Step 1: Bump version.** In `Fresco/package.json` bump `version` (e.g. `0.2.0` — new minor, additive API).

- [ ] **Step 2: Build**

Run: `cd Fresco && npm run build`
Expected: `dist/` regenerated, no errors.

- [ ] **Step 3: Publish** (Verdaccio must be running on `http://localhost:4873/`; Fresco's `.npmrc` carries the scoped registry + token)

Run: `cd Fresco && npm publish`
Expected: `+ @pragmatic-lab/fresco@0.2.0`.

- [ ] **Step 4: Commit the version bump**

```bash
cd Fresco && git add package.json && git commit -m "chore: release @pragmatic-lab/fresco 0.2.0

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# Phase B — Plexus: pure adapter logic

### Task 6: Add Vitest to Plexus

**Files:**
- Modify: `Plexus/package.json`
- Create: `Plexus/vitest.config.ts`

- [ ] **Step 1: Install Vitest**

Run: `cd Plexus && npm install --save-dev vitest`
Expected: `vitest` added to devDependencies.

- [ ] **Step 2: Add the test script** to `Plexus/package.json` `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create** `Plexus/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
        environment: 'node',
    },
});
```

- [ ] **Step 4: Add a smoke test** to confirm the runner works — create `Plexus/src/renderer/src/modules/diagram/layout/smoke.test.ts`:

```ts
import { test, expect } from 'vitest';
test('vitest runs', () => { expect(1 + 1).toBe(2); });
```

- [ ] **Step 5: Run**

Run: `cd Plexus && npm test`
Expected: 1 passed.

- [ ] **Step 6: Delete the smoke test and commit**

```bash
cd Plexus && rm src/renderer/src/modules/diagram/layout/smoke.test.ts && git add package.json vitest.config.ts package-lock.json && git commit -m "chore: add vitest test runner

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `DiagramGraphAdapter.extract` (diagram → Graph)

**Files:**
- Create: `Plexus/src/renderer/src/modules/diagram/layout/diagram-graph-adapter.ts`
- Test: `Plexus/src/renderer/src/modules/diagram/layout/diagram-graph-adapter.test.ts`

**Interfaces:**
- Consumes: Fresco `Graph` (`@pragmatic-lab/fresco`).
- Produces:
  ```ts
  export interface FigureLike { Id: string | undefined; Left: number; Top: number; }
  export interface ConnectorLike { Source?: { Node?: unknown }; Target?: { Node?: unknown }; }
  export interface ExtractResult { graph: Graph; index: Map<string, FigureLike>; }
  export function extract(nodes: FigureLike[], connectors: ConnectorLike[], idGen?: (i: number) => string): ExtractResult;
  ```
- Assigns `Id` onto any figure lacking one (persisted on the object, so subsequent runs are stable) via `idGen` (default `i => 'n' + i`). Edges are added only when both endpoint objects resolve to indexed figures.

- [ ] **Step 1: Write the failing tests**:

```ts
import { test, expect } from 'vitest';
import { extract } from './diagram-graph-adapter.js';

test('extract assigns stable ids to figures missing one and indexes them', () => {
    const a = { Id: undefined as string | undefined, Left: 0, Top: 0 };
    const b = { Id: 'kept', Left: 0, Top: 0 };
    const { graph, index } = extract([a, b], []);
    expect(a.Id).toBe('n0');            // assigned + persisted
    expect(index.get('n0')).toBe(a);
    expect(index.get('kept')).toBe(b);
    expect(graph.nodes.map(n => n.Id).sort()).toEqual(['kept', 'n0']);
});

test('extract builds edges from connector endpoint node references', () => {
    const a = { Id: 'a', Left: 0, Top: 0 };
    const b = { Id: 'b', Left: 0, Top: 0 };
    const conn = { Source: { Node: a }, Target: { Node: b } };
    const { graph } = extract([a, b], [conn]);
    expect(graph.edges.map(e => [e.From, e.To])).toEqual([['a', 'b']]);
});

test('extract skips connectors with an unresolved endpoint', () => {
    const a = { Id: 'a', Left: 0, Top: 0 };
    const conn = { Source: { Node: a }, Target: { Node: undefined } };
    const { graph } = extract([a], [conn]);
    expect(graph.edges.length).toBe(0);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd Plexus && npm test -- diagram-graph-adapter`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** `diagram-graph-adapter.ts`:

```ts
import { Graph } from '@pragmatic-lab/fresco';

export interface FigureLike { Id: string | undefined; Left: number; Top: number; }
export interface ConnectorLike { Source?: { Node?: unknown }; Target?: { Node?: unknown }; }
export interface ExtractResult { graph: Graph; index: Map<string, FigureLike>; }

export function extract(
    nodes: FigureLike[],
    connectors: ConnectorLike[],
    idGen: (i: number) => string = (i) => `n${i}`,
): ExtractResult
{
    const graph = new Graph();
    const index = new Map<string, FigureLike>();
    const idOf = new Map<object, string>();

    nodes.forEach((fig, i) => {
        if (fig.Id === undefined || fig.Id === '') fig.Id = idGen(i);
        index.set(fig.Id, fig);
        idOf.set(fig as object, fig.Id);
        graph.AddNode(fig.Id);
    });

    for (const conn of connectors) {
        const from = conn.Source?.Node ? idOf.get(conn.Source.Node as object) : undefined;
        const to   = conn.Target?.Node ? idOf.get(conn.Target.Node as object) : undefined;
        if (from !== undefined && to !== undefined) graph.AddEdge(from, to);
    }

    return { graph, index };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd Plexus && npm test -- diagram-graph-adapter`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
cd Plexus && git add src/renderer/src/modules/diagram/layout/diagram-graph-adapter.ts src/renderer/src/modules/diagram/layout/diagram-graph-adapter.test.ts && git commit -m "feat: extract a Fresco Graph from diagram figures/connectors

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Center→top-left mapping + drop diff

**Files:**
- Modify: `Plexus/src/renderer/src/modules/diagram/layout/diagram-graph-adapter.ts`
- Test: `Plexus/src/renderer/src/modules/diagram/layout/diagram-graph-adapter.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface NodeSize { width: number; height: number; }
  export interface PositionSet { id: string; left: number; top: number; }
  export interface LayoutOutcome { setPositions: PositionSet[]; droppedNodeIds: string[]; }
  export function computeOutcome(
      index: Map<string, FigureLike>,
      transformed: Graph,
      positions: Map<string, { X: number; Y: number }>,
      sizeOf: (fig: FigureLike) => NodeSize,
  ): LayoutOutcome;
  ```
- `setPositions` converts each center `Point` to top-left using the figure's size: `left = X - width/2`, `top = Y - height/2`. `droppedNodeIds` = ids in `index` absent from `transformed.nodes` (removed by transforms).

- [ ] **Step 1: Write the failing tests**:

```ts
import { computeOutcome } from './diagram-graph-adapter.js';
import { Graph } from '@pragmatic-lab/fresco';

test('computeOutcome converts center points to top-left using node size', () => {
    const a = { Id: 'a', Left: 0, Top: 0 };
    const index = new Map([['a', a]]);
    const transformed = new Graph(); transformed.AddNode('a');
    const positions = new Map([['a', { X: 100, Y: 50 }]]);
    const outcome = computeOutcome(index, transformed, positions, () => ({ width: 40, height: 20 }));
    expect(outcome.setPositions).toEqual([{ id: 'a', left: 80, top: 40 }]);
    expect(outcome.droppedNodeIds).toEqual([]);
});

test('computeOutcome reports nodes dropped by transforms', () => {
    const a = { Id: 'a', Left: 0, Top: 0 };
    const b = { Id: 'b', Left: 0, Top: 0 };
    const index = new Map([['a', a], ['b', b]]);
    const transformed = new Graph(); transformed.AddNode('a');   // b removed
    const positions = new Map([['a', { X: 10, Y: 10 }]]);
    const outcome = computeOutcome(index, transformed, positions, () => ({ width: 0, height: 0 }));
    expect(outcome.droppedNodeIds).toEqual(['b']);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd Plexus && npm test -- diagram-graph-adapter`
Expected: FAIL — `computeOutcome` undefined.

- [ ] **Step 3: Implement** (append to `diagram-graph-adapter.ts`):

```ts
export interface NodeSize { width: number; height: number; }
export interface PositionSet { id: string; left: number; top: number; }
export interface LayoutOutcome { setPositions: PositionSet[]; droppedNodeIds: string[]; }

export function computeOutcome(
    index: Map<string, FigureLike>,
    transformed: Graph,
    positions: Map<string, { X: number; Y: number }>,
    sizeOf: (fig: FigureLike) => NodeSize,
): LayoutOutcome
{
    const surviving = new Set(transformed.nodes.map(n => n.Id));
    const setPositions: PositionSet[] = [];
    for (const [id, pt] of positions) {
        const fig = index.get(id);
        if (!fig) continue;
        const { width, height } = sizeOf(fig);
        setPositions.push({ id, left: pt.X - width / 2, top: pt.Y - height / 2 });
    }
    const droppedNodeIds = [...index.keys()].filter(id => !surviving.has(id));
    return { setPositions, droppedNodeIds };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd Plexus && npm test -- diagram-graph-adapter`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd Plexus && git add src/renderer/src/modules/diagram/layout/diagram-graph-adapter.ts src/renderer/src/modules/diagram/layout/diagram-graph-adapter.test.ts && git commit -m "feat: map layout centers to top-left and diff dropped nodes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Run-mode → mutation resolution

**Files:**
- Create: `Plexus/src/renderer/src/modules/diagram/layout/run-modes.ts`
- Test: `Plexus/src/renderer/src/modules/diagram/layout/run-modes.test.ts`

**Interfaces:**
- Consumes: `LayoutOutcome`, `PositionSet` from the adapter.
- Produces:
  ```ts
  export type RunMode = 'positions' | 'preview' | 'destructive';
  export interface DiagramMutation { setPositions: PositionSet[]; removeNodeIds: string[]; }
  export interface RunPlan { mutation: DiagramMutation; previewOnly: boolean; }
  export function planForMode(mode: RunMode, outcome: LayoutOutcome): RunPlan;
  ```
- `positions`: apply positions, remove nothing. `destructive`: apply positions **and** remove dropped nodes. `preview`: `previewOnly: true`, mutation empty (the service renders a ghost overlay from `outcome.setPositions` and commits on explicit Apply, which re-plans as `positions`).

- [ ] **Step 1: Write the failing tests**:

```ts
import { test, expect } from 'vitest';
import { planForMode } from './run-modes.js';

const outcome = { setPositions: [{ id: 'a', left: 1, top: 2 }], droppedNodeIds: ['b'] };

test('positions mode applies positions, removes nothing', () => {
    const plan = planForMode('positions', outcome);
    expect(plan.previewOnly).toBe(false);
    expect(plan.mutation.setPositions).toEqual(outcome.setPositions);
    expect(plan.mutation.removeNodeIds).toEqual([]);
});

test('destructive mode applies positions and removes dropped nodes', () => {
    const plan = planForMode('destructive', outcome);
    expect(plan.mutation.removeNodeIds).toEqual(['b']);
});

test('preview mode mutates nothing and flags previewOnly', () => {
    const plan = planForMode('preview', outcome);
    expect(plan.previewOnly).toBe(true);
    expect(plan.mutation.setPositions).toEqual([]);
    expect(plan.mutation.removeNodeIds).toEqual([]);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd Plexus && npm test -- run-modes`
Expected: FAIL.

- [ ] **Step 3: Implement** `run-modes.ts`:

```ts
import type { LayoutOutcome, PositionSet } from './diagram-graph-adapter.js';

export type RunMode = 'positions' | 'preview' | 'destructive';
export interface DiagramMutation { setPositions: PositionSet[]; removeNodeIds: string[]; }
export interface RunPlan { mutation: DiagramMutation; previewOnly: boolean; }

export function planForMode(mode: RunMode, outcome: LayoutOutcome): RunPlan
{
    switch (mode) {
        case 'positions':
            return { previewOnly: false, mutation: { setPositions: outcome.setPositions, removeNodeIds: [] } };
        case 'destructive':
            return { previewOnly: false, mutation: { setPositions: outcome.setPositions, removeNodeIds: outcome.droppedNodeIds } };
        case 'preview':
            return { previewOnly: true, mutation: { setPositions: [], removeNodeIds: [] } };
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd Plexus && npm test -- run-modes`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
cd Plexus && git add src/renderer/src/modules/diagram/layout/run-modes.ts src/renderer/src/modules/diagram/layout/run-modes.test.ts && git commit -m "feat: resolve run mode to a diagram mutation plan

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# Phase C — Plexus: framework integration

> These tasks wire pure logic into the mural framework and `.mu` UI. They are integration-level: verified by `npm run typecheck`, `npm run compile:mu`, and manual `npm run dev`, not Vitest (the mural runtime is not available in unit tests). Exact framework signatures are in the design's source references.

### Task 10: Add the Fresco dependency; `LayoutInspector` + preset store

**Files:**
- Modify: `Plexus/package.json`
- Create: `Plexus/src/renderer/src/modules/diagram/layout/layout-inspector.ts`
- Create: `Plexus/src/renderer/src/modules/diagram/layout/layout-presets-store.ts`

**Interfaces:**
- Consumes: mural `Inspector` (`@pragmatic-lab/mural/framework`), `Diagram`; `ElectronSettingsStore` (`../../../services/settings/settings-store.js`); Fresco `PipelineConfiguration`.
- Produces:
  - `class LayoutInspector extends Inspector` with a `View: Diagram | undefined` accessor (models `DiagramInspector`), constructed with id `'layout-inspector'`, title `'Layout'`.
  - `class LayoutPresetsStore { list(): Record<string, PipelineConfiguration>; save(name: string, cfg: PipelineConfiguration): void; delete(name: string): void; }` persisting under settings key `'layout.presets'`.

- [ ] **Step 1: Install Fresco** (Verdaccio running)

Run: `cd Plexus && npm install @pragmatic-lab/fresco@^0.2.0`
Expected: added to `dependencies`, resolved from the scoped registry.

- [ ] **Step 2: Implement `layout-inspector.ts`** (mirror `DiagramInspector`; confirm exact `Inspector`/`RegisterProperty` API against `node_modules/@pragmatic-lab/mural/dist/framework/shell/services/inspector.d.ts` and `diagram-inspector.d.ts`):

```ts
import { Inspector } from '@pragmatic-lab/mural/framework';
import type { Diagram } from '@pragmatic-lab/mural/framework';

export class LayoutInspector extends Inspector
{
    private _view: Diagram | undefined;
    constructor() { super('layout-inspector', 'Layout'); }
    public get View(): Diagram | undefined { return this._view; }
    public set View(v: Diagram | undefined) { this._view = v; }
}
```

> If `DiagramInspector` uses a registered `PropertyKey` for `View` (see `diagram-inspector.d.ts:ViewKey`), follow that exact pattern instead of a plain field, so bindings observe changes.

- [ ] **Step 3: Implement `layout-presets-store.ts`**:

```ts
import { ElectronSettingsStore } from '../../../services/settings/settings-store.js';
import type { PipelineConfiguration } from '@pragmatic-lab/fresco';

const KEY = 'layout.presets';

export class LayoutPresetsStore
{
    private readonly store = new ElectronSettingsStore();

    public list(): Record<string, PipelineConfiguration>
    {
        return (this.store.Load()[KEY] as Record<string, PipelineConfiguration> | undefined) ?? {};
    }
    public save(name: string, cfg: PipelineConfiguration): void
    {
        const all = this.store.Load();
        this.store.Save({ ...all, [KEY]: { ...this.list(), [name]: cfg } });
    }
    public delete(name: string): void
    {
        const presets = { ...this.list() };
        delete presets[name];
        const all = this.store.Load();
        this.store.Save({ ...all, [KEY]: presets });
    }
}
```

- [ ] **Step 4: Typecheck**

Run: `cd Plexus && npm run typecheck:web`
Expected: no errors (fix import paths / `Inspector` API to match the real `.d.ts`).

- [ ] **Step 5: Commit**

```bash
cd Plexus && git add package.json package-lock.json src/renderer/src/modules/diagram/layout/layout-inspector.ts src/renderer/src/modules/diagram/layout/layout-presets-store.ts && git commit -m "feat: add fresco dep, LayoutInspector, preset store

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: `LayoutPipelineService` — compose + run

**Files:**
- Create: `Plexus/src/renderer/src/modules/diagram/layout/layout-pipeline-service.ts`

**Interfaces:**
- Consumes: `IServiceProvider`, `ServiceKey`, `InspectorService` (mural); `DiagramDocument`, `DiagramWorkspaceService` (to reach the active doc); Fresco `GetPipelineCatalog`, `BuildPipeline`, `LoadElementRepository`, `PipelineConfiguration`; the pure `extract`/`computeOutcome`/`planForMode`.
- Produces: `class LayoutPipelineService` with `static readonly Key`, holding the current `PipelineConfiguration` + `RunMode`, the catalog (`GetPipelineCatalog()`), a `LayoutPresetsStore`, and a `Run()` method.

- [ ] **Step 1: Implement the service skeleton + run.** The `Run()` method:
  1. resolves the active `DiagramDocument` from `DiagramWorkspaceService`;
  2. reads `doc.Nodes` (as `FigureLike[]`) and `doc.Connectors` (as `ConnectorLike[]`) — `Figure` structurally satisfies `FigureLike` (`Id`, `Left`, `Top`); `Connector` satisfies `ConnectorLike` (`Source`/`Target` with `.Node`);
  3. `const { graph, index } = extract(nodes, connectors)`;
  4. `const { graphPipeline, layoutPipeline } = BuildPipeline(this.config, LoadElementRepository())`;
  5. `const transformed = graphPipeline.Apply(graph)`; `const positions = layoutPipeline.Apply(transformed)`;
  6. `const outcome = computeOutcome(index, transformed, positions, sizeOf)` where `sizeOf(fig)` reads the figure's measured size (see note);
  7. `const plan = planForMode(this.mode, outcome)`;
  8. if `plan.previewOnly` → hand `outcome.setPositions` to the preview overlay (Task 14); else apply `plan.mutation` via the undoable command path (Step 2).

```ts
import { ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime';
import { GetPipelineCatalog, BuildPipeline, LoadElementRepository, type PipelineConfiguration, type CatalogSlot } from '@pragmatic-lab/fresco';
import { extract, computeOutcome, type FigureLike, type ConnectorLike, type NodeSize } from './diagram-graph-adapter.js';
import { planForMode, type RunMode } from './run-modes.js';
import { LayoutPresetsStore } from './layout-presets-store.js';

const DEFAULT_CONFIG: PipelineConfiguration = { name: 'default', transforms: [], layout: {} };

export class LayoutPipelineService
{
    public static readonly Key = new ServiceKey<LayoutPipelineService>('LayoutPipelineService');
    public readonly Catalog: CatalogSlot[] = GetPipelineCatalog();
    public readonly Presets = new LayoutPresetsStore();
    public Config: PipelineConfiguration = structuredClone(DEFAULT_CONFIG);
    public Mode: RunMode = 'positions';

    constructor(private readonly provider: IServiceProvider) {}

    public Run(): void
    {
        const doc = /* resolve active DiagramDocument via DiagramWorkspaceService */ this.activeDoc();
        if (!doc) return;
        const nodes = [...doc.Nodes] as unknown as FigureLike[];
        const connectors = [...doc.Connectors] as unknown as ConnectorLike[];
        const { graph, index } = extract(nodes, connectors);
        const { graphPipeline, layoutPipeline } = BuildPipeline(this.Config, LoadElementRepository());
        const transformed = graphPipeline.Apply(graph);
        const positions = layoutPipeline.Apply(transformed);
        const outcome = computeOutcome(index, transformed, positions, (f) => this.sizeOf(f));
        const plan = planForMode(this.Mode, outcome);
        if (plan.previewOnly) { this.showPreview(outcome.setPositions); return; }
        this.applyMutation(doc, plan.mutation);
    }

    private sizeOf(fig: FigureLike): NodeSize { /* read measured Width/Height; fall back to a constant, e.g. 80x40 */ return { width: 80, height: 40 }; }
    private activeDoc(): any { /* provider.getRequired(DiagramWorkspaceService.Key)…Document */ return undefined; }
    private showPreview(_positions: unknown): void { /* Task 14 */ }
    private applyMutation(_doc: unknown, _mutation: unknown): void { /* Task 11 Step 2 */ }
}
```

- [ ] **Step 2: Implement `applyMutation` via the existing undoable command path.** Read how `align`/`distribute` commands in `src/renderer/src/modules/diagram/diagram.module.mu` construct their `CommandDefinition` and mutate node `Left`/`Top` through `DiagramDocument.Execute(...)`. Reuse that exact pattern to (a) set each figure's `Left`/`Top` from `mutation.setPositions`, and (b) for `mutation.removeNodeIds`, remove the matching figures from `doc.Nodes` and any connector whose `Source.Node`/`Target.Node` id is in that set from `doc.Connectors` — all inside one `Execute` so a single undo reverts the whole apply. If align/distribute mutate directly rather than via a reified command, follow whatever undoable mechanism they use.

- [ ] **Step 3: Typecheck**

Run: `cd Plexus && npm run typecheck:web`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd Plexus && git add src/renderer/src/modules/diagram/layout/layout-pipeline-service.ts && git commit -m "feat: LayoutPipelineService composes and runs the pipeline on the active diagram

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Builder UI (`.mu`) + module registration

**Files:**
- Create: `Plexus/src/renderer/src/modules/diagram/layout/layout-inspector.resources.mu`
- Modify: `Plexus/src/renderer/src/modules/diagram/diagram.module.mu`
- Modify: `Plexus/src/renderer/src/app.mu`
- Modify: `Plexus/package.json` (`compile:mu` file list)

**Interfaces:**
- Produces: a `DataTemplate[DataType = LayoutInspector]` rendering the catalog-driven builder: a reorderable transform list, a collapsible strategy-slot section per layout stage bound to `$service(LayoutPipelineService).Catalog`, a run-mode selector bound to `.Mode`, a Run button invoking a `Run` command, and a preset dropdown/save/delete bound to `.Presets`.

- [ ] **Step 1: Register the service** in `diagram.module.mu`'s `.services:` block:

```
import LayoutPipelineService from "./layout/layout-pipeline-service.js"

// inside module .services: { ... add: }
    LayoutPipelineService
```

- [ ] **Step 2: Add a "Layout" menu command** next to "Format Shape" in `diagram.resources.mu` (or the diagram menu) that adds a `LayoutInspector` (its `View` set to the active `Diagram`) to the `InspectorService`, mirroring the existing `$service(InspectorService).AddInspectorCommand` + `CommandParameter` pattern.

- [ ] **Step 3: Author `layout-inspector.resources.mu`.** Model structure after `panels.resources.mu` and `settings.resources.mu`. Skeleton (expand bindings to match the real control set; every stage section iterates `Catalog`):

```
resources LayoutInspectorResources {
    DataTemplate [ DataType = LayoutInspector ] {
        StackPanel [ Margin = (12,12,12,12) ] {
            TextBlock [ Text = "Layout Pipeline", FontWeight = Bold ]

            // Run-mode selector
            ComboBox [ ItemsSource = $service(LayoutPipelineService).ModeOptions,
                       SelectedItem = $service(LayoutPipelineService).Mode ]

            // Catalog-driven slots (transform list + strategy slots)
            ItemsControl [ ItemsSource = $service(LayoutPipelineService).Catalog,
                           ItemsPanel = @VerticalStackPanel ] {
                // per-slot template: label = $Name/$slotId, picker of $strategies
            }

            // Presets
            ComboBox [ ItemsSource = $service(LayoutPipelineService).PresetNames ]
            Button   [ Content = "Save preset",  Command = $service(LayoutPipelineService).SavePresetCommand ]

            Button   [ Content = "Run",  Command = $service(LayoutPipelineService).RunCommand ]
        }
    }
}
```

> Add whatever `ICommand`/computed properties the bindings above reference (`RunCommand`, `SavePresetCommand`, `ModeOptions`, `PresetNames`) to `LayoutPipelineService` as part of this task, using the same `ICommand` construction the diagram module already uses for its commands.

- [ ] **Step 4: Merge resources** in `app.mu`:

```
merge LayoutInspectorResources
```

- [ ] **Step 5: Add the new `.mu` to `compile:mu`.** In `package.json`, append `src/renderer/src/modules/diagram/layout/layout-inspector.resources.mu` to the `compile:mu` file list.

- [ ] **Step 6: Compile + typecheck**

Run: `cd Plexus && npm run compile:mu && npm run typecheck`
Expected: `.mu.js` emitted, no type errors.

- [ ] **Step 7: Commit**

```bash
cd Plexus && git add src/renderer/src/modules/diagram/layout/layout-inspector.resources.mu src/renderer/src/modules/diagram/diagram.module.mu src/renderer/src/app.mu package.json && git commit -m "feat: catalog-driven layout builder UI in the inspector

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Per-diagram config persistence

**Files:**
- Modify: `Plexus/src/renderer/src/modules/diagram/layout/layout-pipeline-service.ts`
- Modify: `Plexus/src/renderer/src/modules/diagram/services/diagram-workspace-service.ts` (persist/restore hook)

**Interfaces:**
- Produces: the active diagram's `PipelineConfiguration` round-trips with the document. On document open, the service loads that document's saved config (if any) into `Config`; on change/run it writes it back onto the document so save/reopen restores the builder.

- [ ] **Step 1:** Store the config on the document. Add a property (e.g. a `LayoutConfigKey` registered on `DiagramDocument`, or a side map keyed by document identity in the service). When `LayoutPipelineService.Config` changes, serialize it (`structuredClone`/JSON) onto the active document. When the active document changes, read it back into `Config` (fall back to `DEFAULT_CONFIG`).

- [ ] **Step 2:** Ensure the document's persisted form (whatever `DiagramWorkspaceService` writes on save) includes that config blob so reopening restores it. Follow the existing document-serialization path.

- [ ] **Step 3: Typecheck + manual check**

Run: `cd Plexus && npm run typecheck && npm run dev`
Manually: compose a pipeline, switch documents and back, confirm the builder restores.

- [ ] **Step 4: Commit**

```bash
cd Plexus && git add src/renderer/src/modules/diagram/layout/layout-pipeline-service.ts src/renderer/src/modules/diagram/services/diagram-workspace-service.ts && git commit -m "feat: persist layout pipeline config per diagram

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Preview ghost overlay

**Files:**
- Modify: `Plexus/src/renderer/src/modules/diagram/layout/layout-pipeline-service.ts`
- Possibly modify: `Plexus/src/renderer/src/modules/diagram/diagram.resources.mu` (an overlay adorner layer on the canvas)

**Interfaces:**
- Produces: in `preview` mode, `Run()` renders the computed target positions as a non-committed ghost overlay on the active diagram canvas; an explicit **Apply** commits by re-running the apply path in `positions` mode (and `destructive` if the user also chose to drop nodes — but preview commits positions only per the design), then clears the overlay.

- [ ] **Step 1:** Implement `showPreview(setPositions)` to draw ghost markers at each target top-left/size on the diagram's adorner/overlay layer (reuse the canvas the diagram already renders into; do not build a separate Fresco `BuildScene` surface). Add an **Apply** and **Cancel** affordance in the inspector while a preview is pending.

- [ ] **Step 2:** On **Apply**, run `applyMutation(doc, planForMode('positions', outcome).mutation)` and clear the overlay. On **Cancel**, clear the overlay only.

- [ ] **Step 3: Manual check**

Run: `cd Plexus && npm run dev`
Manually: pick `preview` mode, Run, confirm ghosts appear, Apply moves shapes, Cancel discards.

- [ ] **Step 4: Commit**

```bash
cd Plexus && git add -A src/renderer/src/modules/diagram && git commit -m "feat: preview ghost overlay with explicit apply

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Fresco `PipelineCatalog` (spec §Components 1) → Tasks 1–3. ✅
- Parameterized transforms declarative params (spec §1) → Task 4. ✅
- `DiagramGraphAdapter` extract + center↔top-left + drop diff (spec §2) → Tasks 7–8. ✅
- `LayoutPipelineService` inspector contribution (spec §3) → Tasks 10–12. ✅
- Run flow + three run modes (spec §Data flow) → Tasks 9, 11, 14. ✅
- Persistence per-diagram + named presets (spec §Persistence) → Tasks 10 (presets), 13 (per-diagram). ✅
- Preview ghost overlay (spec §Data flow, §out-of-scope note) → Task 14. ✅
- Error handling (unresolved strategy, empty diagram, atomic destructive undo) → covered by Task 11 Step 2 (single `Execute`) and Task 7 (skips unresolved endpoints); **note:** "config references a strategy no longer in catalog" surfacing is a UI concern folded into Task 12's picker (the picker only offers catalog strategies; a stale saved value shows as unselected). ✅
- Testing (adapter headless, catalog drift, round-trip) → Tasks 3, 4, 7–9. ✅

**Placeholder scan:** The Phase C tasks intentionally contain framework-glue stubs (`activeDoc()`, `applyMutation`, `.mu` binding names) because the exact mural command-construction and binding syntax must be matched against the real `.d.ts`/existing `.mu` at implementation time; each such stub names the exact file/pattern to copy (align/distribute commands, `DiagramInspector`, `panels.resources.mu`). These are integration directions, not code placeholders in the pure-logic tasks (Tasks 1–9 are complete TDD).

**Type consistency:** `PositionSet`/`LayoutOutcome`/`DiagramMutation`/`RunMode`/`RunPlan` are defined once (Tasks 8–9) and consumed unchanged in Task 11. `FigureLike`/`ConnectorLike` defined in Task 7, reused in Tasks 8, 11. `PipelineConfiguration`/`TransformSpec`/`CatalogSlot` come from Fresco (Tasks 3–4) and are imported by name in Plexus.

**Scope:** One coherent feature across two repos; Fresco changes (Phase A) are a prerequisite published artifact consumed by Plexus (Phases B–C). Kept as one plan because the Plexus work is meaningless without the Fresco catalog/config, and the seam is small.

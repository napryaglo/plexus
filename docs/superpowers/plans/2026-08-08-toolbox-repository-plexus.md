# Toolbox Repository (Plexus adapters) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Plexus's toolbox, canvas nodes, and library preview onto the mural `ToolboxRepository` subsystem (Spec A), fixing the missing-icon bug by routing every surface through the one `ToolboxVisualPresenter`.

**Architecture:** Two Plexus `IToolboxVisualResolver`s (`LibraryClassVisualResolver` wrapping `LibraryRegistry`; `ConceptVisualResolver` icon-based) + one `IToolboxDropFactory` (`ArchInstanceDropFactory` delegating to `ArchDiagramDocument.CreateNode`), registered under typed `ServiceKey`s. `ToolboxService` becomes a populator of the mural repository and exposes `.Repository`. Tiles, canvas nodes, and the preview all mount `ToolboxVisualPresenter`, whose slotted visual inherits its DataContext (the class template binds `$Display` on the item / VM / preview node). Hard cutover: `TermTile`, `toolbox-term-template`, the Plexus `ToolboxPage`, `InstanceNodeVM.Template`, and every `ToolboxShape` / `TOOLBOX_NODE_KIND_FORMAT` reference are deleted.

**Tech Stack:** TypeScript, `@pragmatic-tech-ai/mural` (framework/runtime/basic), Vitest (`src/**/*.test.ts`), electron-vite, mural `.mu` markup (compiled by the mural compiler; DataTypes register via TS `import` in the `.mu`, and mural built-ins like `ToolboxVisualPresenter`/`ToolboxPage` are known without import).

**Spec:** `docs/superpowers/specs/2026-08-08-toolbox-repository-plexus-design.md`

## Global Constraints

- **Prerequisite:** mural bumped `0.2.9 → 0.3.0` and published to Verdaccio (`http://localhost:4873/`); Plexus dep `^0.3.0`. Hard cutover — Plexus does not compile against the new mural until the migration completes.
- **Enums, never string-literal unions.** Reuse mural's `VisualContext`. Any new fixed-set type is a real `enum`.
- **No string-keyed resolution.** Resolvers/factory resolve through typed `ServiceKey`s from `Application.current.Services`, never a `kind`-string switch.
- **Descriptor is `{ ResolverKey, Key }` only.** The library resolver keys on the class id (`registry.resolve`'s 2nd arg is ignored); drop re-derives concept from the term id via `resolveTermDrop`.
- **Every mounted Control has a default Style** — `ToolboxVisualPresenter` already satisfies it; Plexus only consumes it.
- **Every test file lives in a `tests/` subfolder** next to the code it exercises.
- **Item id format:** `"term:" + termId`. Drag payload: `TOOLBOX_ITEM_FORMAT` = the item `Id`.
- **Key mechanism:** the resolver never sets `DataContext`; the class template inherits it from the presenter. Each host data object exposes `Display` (canvas VM + preview node already do; toolbox items via `ArchToolboxItem`).
- **Commit style:** end commit messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit only; do not push. Work on a feature branch off Plexus `main` (create it at execution start; also create/verify the mural branch for the bump).

---

## File Structure

**Mural (prerequisite only):**
- Modify: `Mural/package.json` (version `0.3.0`).

**Plexus — new files:**
- `src/renderer/src/modules/diagram/services/arch-toolbox-item.ts` — `ArchToolboxItem` (adds `Display`).
- `src/renderer/src/modules/diagram/services/library-class-visual-resolver.ts` — resolver + `LibraryClassVisualResolverKey`.
- `src/renderer/src/modules/diagram/services/concept-visual-resolver.ts` — resolver + `ConceptVisualResolverKey`.
- `src/renderer/src/modules/architecture-projects/services/arch-instance-drop-factory.ts` — factory + `ArchInstanceDropFactoryKey`.
- `src/renderer/src/modules/diagram/services/register-arch-toolbox-adapters.ts` — idempotent Services registration.
- Test files under each dir's `tests/`.

**Plexus — modified:**
- `src/renderer/src/modules/diagram/services/diagram-panel-services.ts` — `ToolboxService` populator + `.Repository`.
- `src/renderer/src/modules/diagram/services/toolbox-page.ts` — delete `TermTile` / `ToolboxPage` / `ToolboxPageKind` (file likely removed).
- `src/renderer/src/modules/diagram/services/toolbox-term-template.ts` — deleted.
- `src/renderer/src/modules/diagram/diagram.resources.mu` — tile + page templates.
- `src/renderer/src/modules/architecture-projects/services/instance-node-vm.ts` — `Descriptor` DP; drop `Template`/`Data`.
- `src/renderer/src/modules/architecture-projects/services/arch-diagram-document.ts` — drop `ResolveTemplate`/`upgradeTemplatesFor`/`registry.onChanged`.
- `src/renderer/src/modules/architecture-projects/architecture-projects.resources.mu` — node template.
- `src/renderer/src/modules/library/services/library-tree-node.ts` — `Descriptor` + `BeginDragData`.
- `src/renderer/src/modules/library/services/libraries-panel-service.ts` — set node `Descriptor`; delete manual `onChanged`.
- `src/renderer/src/modules/library/library.resources.mu` — preview template.

---

## Task 1: Publish mural 0.3.0 + bump Plexus dependency

**Files:**
- Modify: `Mural/package.json` (`version`)
- Modify: `Plexus/package.json` (`dependencies["@pragmatic-tech-ai/mural"]`)

**Interfaces:**
- Produces: an installed `@pragmatic-tech-ai/mural@0.3.0` in Plexus exposing (from `@pragmatic-tech-ai/mural/framework`) `ToolboxRepository`, `ToolboxItem`, `ToolboxPage`, `ToolboxVisualDescriptor`, `IToolboxVisualResolver`, `VisualContext`, `IToolboxDropFactory`, `ToolboxDropContext`, `ToolboxVisualPresenter`, `TOOLBOX_ITEM_FORMAT`; and the absence of `ToolboxShape` / `TOOLBOX_NODE_KIND_FORMAT`.

- [ ] **Step 1: Verify mural main is green and set the version**

Run in `Mural/`: `npm test` (expect the Spec-A-merged suite green), then set `version` to `0.3.0` in `Mural/package.json`.

- [ ] **Step 2: Build and publish mural to Verdaccio**

Run in `Mural/`: `npm run build` then `npm publish --registry http://localhost:4873/`. Expect a successful publish of `@pragmatic-tech-ai/mural@0.3.0`.

- [ ] **Step 3: Bump Plexus dependency and install**

Set `Plexus/package.json` `dependencies["@pragmatic-tech-ai/mural"]` to `^0.3.0`. Run in `Plexus/`: `npm install --registry http://localhost:4873/` (or the repo's configured registry). Expect `node_modules/@pragmatic-tech-ai/mural/package.json` version `0.3.0`.

- [ ] **Step 4: Smoke-test the new exports are importable**

Write a throwaway `Plexus/src/renderer/src/modules/diagram/services/tests/mural-030-smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as fw from '@pragmatic-tech-ai/mural/framework'

describe('mural 0.3.0 toolbox exports', () => {
  it('exposes the toolbox subsystem and drops the old symbols', () => {
    expect(fw.ToolboxRepository).toBeTypeOf('function')
    expect(fw.ToolboxItem).toBeTypeOf('function')
    expect(fw.ToolboxPage).toBeTypeOf('function')
    expect(fw.ToolboxVisualDescriptor).toBeTypeOf('function')
    expect(fw.ToolboxVisualPresenter).toBeTypeOf('function')
    expect(fw.VisualContext).toBeDefined()
    expect(fw.TOOLBOX_ITEM_FORMAT).toBeTypeOf('string')
    expect((fw as Record<string, unknown>).ToolboxShape).toBeUndefined()
    expect((fw as Record<string, unknown>).TOOLBOX_NODE_KIND_FORMAT).toBeUndefined()
  })
})
```

Run: `npx vitest run src/renderer/src/modules/diagram/services/tests/mural-030-smoke.test.ts`
Expected: PASS. (If `VisualContext`/etc. are not re-exported from `/framework`, adjust the import to the exact subpath the smoke reveals and record it — later tasks import from the same place.)

- [ ] **Step 5: Commit**

```bash
git -C Mural add package.json && git -C Mural commit -m "chore: bump mural to 0.3.0 (toolbox repository subsystem)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git -C Plexus add package.json src/renderer/src/modules/diagram/services/tests/mural-030-smoke.test.ts
git -C Plexus commit -m "chore: consume @pragmatic-tech-ai/mural@0.3.0

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Keep the smoke test until Task 11 (it is deleted in the final cleanup).

---

## Task 2: `ArchToolboxItem`

**Files:**
- Create: `src/renderer/src/modules/diagram/services/arch-toolbox-item.ts`
- Test: `src/renderer/src/modules/diagram/services/tests/arch-toolbox-item.test.ts`

**Interfaces:**
- Consumes: mural `ToolboxItem`, `ToolboxVisualDescriptor`, `IToolboxDropFactory`, `TOOLBOX_ITEM_FORMAT`, `ServiceKey`.
- Produces: `class ArchToolboxItem extends ToolboxItem` with ctor `(id, label, descriptor, factoryKey)` and a `Display: string` getter (= `label`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import { ToolboxVisualDescriptor, TOOLBOX_ITEM_FORMAT, type IToolboxVisualResolver, type IToolboxDropFactory } from '@pragmatic-tech-ai/mural/framework'
import { ArchToolboxItem } from '../arch-toolbox-item.js'

describe('ArchToolboxItem', () => {
  const rk = new ServiceKey<IToolboxVisualResolver>('R')
  const fk = new ServiceKey<IToolboxDropFactory>('F')

  it('exposes Display = label and the base item surface', () => {
    const desc = new ToolboxVisualDescriptor(rk, 'Stack.AzureOpenAI')
    const item = new ArchToolboxItem('term:Stack.AzureOpenAI', 'Azure OpenAI', desc, fk)
    expect(item.Id).toBe('term:Stack.AzureOpenAI')
    expect(item.Label).toBe('Azure OpenAI')
    expect(item.Display).toBe('Azure OpenAI')
    expect(item.Descriptor).toBe(desc)
    expect(item.FactoryKey).toBe(fk)
  })

  it('BeginDragData carries the Id under TOOLBOX_ITEM_FORMAT', () => {
    const item = new ArchToolboxItem('term:x', 'X', new ToolboxVisualDescriptor(rk, 'x'), fk)
    const payload = item.BeginDragData!()
    expect(payload.data.Get(TOOLBOX_ITEM_FORMAT)).toBe('term:x')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/diagram/services/tests/arch-toolbox-item.test.ts`
Expected: FAIL — `Cannot find module '../arch-toolbox-item.js'`.

- [ ] **Step 3: Write the implementation**

```ts
import { MetaData, Model, type ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import { ToolboxItem, type ToolboxVisualDescriptor, type IToolboxDropFactory } from '@pragmatic-tech-ai/mural/framework'

// A Plexus toolbox item that also exposes Display (= the term label) so a class
// presentation template's $Display binds through the tile presenter's inherited
// DataContext. The mural base carries Id/Label/Descriptor/FactoryKey/BeginDragData.
export class ArchToolboxItem extends ToolboxItem
{
    public static readonly DisplayKey = Model.RegisterProperty<string>(
        ArchToolboxItem, 'Display', '', MetaData.None)

    constructor(
        id: string,
        label: string,
        descriptor: ToolboxVisualDescriptor,
        factoryKey: ServiceKey<IToolboxDropFactory>,
    )
    {
        super(id, label, descriptor, factoryKey)
        this.set_property_value(ArchToolboxItem.DisplayKey, label)
    }

    public get Display(): string { return this.get_property_value(ArchToolboxItem.DisplayKey) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/diagram/services/tests/arch-toolbox-item.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/diagram/services/arch-toolbox-item.ts src/renderer/src/modules/diagram/services/tests/arch-toolbox-item.test.ts
git commit -m "feat(toolbox): ArchToolboxItem exposes Display for tile binding

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `LibraryClassVisualResolver`

**Files:**
- Create: `src/renderer/src/modules/diagram/services/library-class-visual-resolver.ts`
- Test: `src/renderer/src/modules/diagram/services/tests/library-class-visual-resolver.test.ts`

**Interfaces:**
- Consumes: `LibraryRegistry` (`resolve(id, concept): DataTemplate`, `onChanged(cb): () => void`), mural `VisualContext`, `IToolboxVisualResolver`, `ToolboxVisualDescriptor`, `Element`, `Visual`, `ServiceKey`.
- Produces: `LibraryClassVisualResolverKey: ServiceKey<IToolboxVisualResolver>` and `class LibraryClassVisualResolver implements IToolboxVisualResolver`.

- [ ] **Step 1: Write the failing test** (fake registry; no real mural DOM needed)

```ts
import { describe, it, expect } from 'vitest'
import { DataTemplate } from '@pragmatic-tech-ai/mural/basic'
import { Border } from '@pragmatic-tech-ai/mural/basic'
import { VisualContext, ToolboxVisualDescriptor } from '@pragmatic-tech-ai/mural/framework'
import { LibraryClassVisualResolver } from '../library-class-visual-resolver.js'

function fakeRegistry() {
  const listeners = new Set<(id: string) => void>()
  return {
    resolved: [] as string[],
    resolve(id: string, _c: string) { this.resolved.push(id); return new DataTemplate(() => new Border()) },
    onChanged(cb: (id: string) => void) { listeners.add(cb); return () => listeners.delete(cb) },
    fire(id: string) { for (const l of listeners) l(id) },
    listenerCount() { return listeners.size },
  }
}

describe('LibraryClassVisualResolver', () => {
  it('resolves the class template and makes a Tile non-hit-test, a Figure interactive', () => {
    const reg = fakeRegistry()
    const r = new LibraryClassVisualResolver(reg as never)
    const desc = new ToolboxVisualDescriptor({} as never, 'Stack.AzureOpenAI')
    const tile = r.Resolve(desc, VisualContext.Tile) as Border
    const fig = r.Resolve(desc, VisualContext.Figure) as Border
    expect(reg.resolved).toEqual(['Stack.AzureOpenAI', 'Stack.AzureOpenAI'])
    expect(tile.IsHitTestVisible).toBe(false)
    expect(fig.IsHitTestVisible).toBe(true)
  })

  it('bridges registry.onChanged to the changed signal and unsubscribes', () => {
    const reg = fakeRegistry()
    const r = new LibraryClassVisualResolver(reg as never)
    const seen: string[] = []
    const cb = (k: string) => seen.push(k)
    r.AddChangedListener(cb)
    reg.fire('Stack.AzureOpenAI')
    expect(seen).toEqual(['Stack.AzureOpenAI'])
    r.RemoveChangedListener(cb)
    expect(reg.listenerCount()).toBe(0)
    reg.fire('Stack.AzureOpenAI')
    expect(seen).toEqual(['Stack.AzureOpenAI'])
  })
})
```

(`Border` default `IsHitTestVisible` is `true`; confirm in Step 2 — if a bare `Border` reports `undefined`, assert `!== false` for the Figure case instead.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/diagram/services/tests/library-class-visual-resolver.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import { Element, ServiceKey, type Visual } from '@pragmatic-tech-ai/mural/runtime'
import { VisualContext, type IToolboxVisualResolver, type ToolboxVisualDescriptor } from '@pragmatic-tech-ai/mural/framework'
import type { LibraryRegistry } from '../../library/services/library-registry.js'

export const LibraryClassVisualResolverKey = new ServiceKey<IToolboxVisualResolver>('LibraryClassVisualResolver')

// Resolves a library class descriptor to its visual through the LibraryRegistry
// (compiled template / baked presentation / default box). Never sets DataContext —
// the class template inherits the presenter's (the item / node / preview row), so
// $Display binds to that host. Bridges registry.onChanged so a lazily-compiled
// class upgrades the presenter's content in place.
export class LibraryClassVisualResolver implements IToolboxVisualResolver
{
    private readonly unsubs = new Map<(key: string) => void, () => void>()

    constructor(private readonly registry: LibraryRegistry) {}

    public Resolve(descriptor: ToolboxVisualDescriptor, context: VisualContext): Visual
    {
        const template = this.registry.resolve(descriptor.Key, '')
        const visual = template.Apply({})
        // Tiles are drag chrome: the enclosing Border owns the gesture, so the
        // rendered class visual must not swallow hit-testing.
        if (context === VisualContext.Tile && visual instanceof Element) visual.IsHitTestVisible = false
        return visual
    }

    public AddChangedListener(cb: (key: string) => void): void
    {
        if (this.unsubs.has(cb)) return
        this.unsubs.set(cb, this.registry.onChanged((classId) => cb(classId)))
    }

    public RemoveChangedListener(cb: (key: string) => void): void
    {
        const u = this.unsubs.get(cb)
        if (u !== undefined) { u(); this.unsubs.delete(cb) }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/diagram/services/tests/library-class-visual-resolver.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/diagram/services/library-class-visual-resolver.ts src/renderer/src/modules/diagram/services/tests/library-class-visual-resolver.test.ts
git commit -m "feat(toolbox): LibraryClassVisualResolver over LibraryRegistry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `ConceptVisualResolver`

**Files:**
- Create: `src/renderer/src/modules/diagram/services/concept-visual-resolver.ts`
- Test: `src/renderer/src/modules/diagram/services/tests/concept-visual-resolver.test.ts`

**Interfaces:**
- Consumes: `buildCtx`, `buildIconTemplate`, `buildDefaultTemplate` from `../../library/services/visual-library.js`; `parseSvgIcon`, `Icon` from `@pragmatic-tech-ai/mural/basic`; mural `VisualContext`, `IToolboxVisualResolver`, `ToolboxVisualDescriptor`, `Element`, `Visual`, `ServiceKey`.
- Produces: `ConceptVisualResolverKey: ServiceKey<IToolboxVisualResolver>` and `class ConceptVisualResolver implements IToolboxVisualResolver` with `Register(key: string, icon: string | undefined): void`.

- [ ] **Step 1: Confirm the icon-template helper signature**

Read `src/renderer/src/modules/library/services/visual-library.ts` and the test `.../tests/visual-library.test.ts` (already present). Confirm: `buildCtx(): Ctx`, `buildIconTemplate(iconDef, ctx): DataTemplate`, `buildDefaultTemplate(ctx): DataTemplate`, and that `parseSvgIcon(svg)` returns the `iconDef` `buildIconTemplate` wants. These are the exact helpers `library-registry.ts:152` uses. If a signature differs, adapt the Step-3 code to match (do not invent).

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { VisualContext, ToolboxVisualDescriptor } from '@pragmatic-tech-ai/mural/framework'
import { ConceptVisualResolver } from '../concept-visual-resolver.js'

const SVG = '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>'

describe('ConceptVisualResolver', () => {
  it('builds a visual from a registered icon and a default box otherwise', () => {
    const r = new ConceptVisualResolver()
    r.Register('actors.internal', SVG)
    const withIcon = r.Resolve(new ToolboxVisualDescriptor({} as never, 'actors.internal'), VisualContext.Tile)
    const withoutIcon = r.Resolve(new ToolboxVisualDescriptor({} as never, 'actors.unknown'), VisualContext.Tile)
    expect(withIcon).toBeDefined()
    expect(withoutIcon).toBeDefined()
    // both produce a Visual; the icon path differs from the default path
    expect(withIcon).not.toBe(withoutIcon)
  })

  it('is ready-now: listeners are no-ops', () => {
    const r = new ConceptVisualResolver()
    let fired = 0
    const cb = () => { fired++ }
    r.AddChangedListener(cb)      // no throw, no registration
    r.RemoveChangedListener(cb)
    expect(fired).toBe(0)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/diagram/services/tests/concept-visual-resolver.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation** (mirrors `library-registry.ts:152` icon building)

```ts
import { Element, ServiceKey, type Visual } from '@pragmatic-tech-ai/mural/runtime'
import { parseSvgIcon } from '@pragmatic-tech-ai/mural/basic'
import { VisualContext, type IToolboxVisualResolver, type ToolboxVisualDescriptor } from '@pragmatic-tech-ai/mural/framework'
import { buildCtx, buildIconTemplate, buildDefaultTemplate } from '../../library/services/visual-library.js'

export const ConceptVisualResolverKey = new ServiceKey<IToolboxVisualResolver>('ConceptVisualResolver')

// Renders a meta-model concept term's visual from its annotation-driven icon (an
// SVG the populator supplies via Register). Ready-now: never fires changed. A key
// with no registered icon (e.g. a bare concept id on a reference-less canvas node)
// falls back to the same default box the LibraryRegistry uses — parity with today.
export class ConceptVisualResolver implements IToolboxVisualResolver
{
    private readonly icons = new Map<string, string>()
    private readonly ctx = buildCtx()

    public Register(key: string, icon: string | undefined): void
    {
        if (icon !== undefined && icon !== '') this.icons.set(key, icon)
    }

    public Resolve(descriptor: ToolboxVisualDescriptor, context: VisualContext): Visual
    {
        const svg = this.icons.get(descriptor.Key)
        const template = svg !== undefined
            ? buildIconTemplate(parseSvgIcon(svg), this.ctx)
            : buildDefaultTemplate(this.ctx)
        const visual = template.Apply({ Display: descriptor.Key })
        if (context === VisualContext.Tile && visual instanceof Element) visual.IsHitTestVisible = false
        return visual
    }

    public AddChangedListener(_cb: (key: string) => void): void {}
    public RemoveChangedListener(_cb: (key: string) => void): void {}
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/diagram/services/tests/concept-visual-resolver.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/modules/diagram/services/concept-visual-resolver.ts src/renderer/src/modules/diagram/services/tests/concept-visual-resolver.test.ts
git commit -m "feat(toolbox): ConceptVisualResolver (icon-based, ready-now)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `ArchInstanceDropFactory`

**Files:**
- Create: `src/renderer/src/modules/architecture-projects/services/arch-instance-drop-factory.ts`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-instance-drop-factory.test.ts`

**Interfaces:**
- Consumes: mural `IToolboxDropFactory`, `ToolboxDropContext`, `ServiceKey`. `ToolboxDropContext = { Item, Descriptor, Position: Point, Diagram, Mutator: DiagramMutator }`; `DiagramMutator.CreateNode(kind, x, y): unknown | null | undefined`.
- Produces: `ArchInstanceDropFactoryKey: ServiceKey<IToolboxDropFactory>` and `class ArchInstanceDropFactory implements IToolboxDropFactory`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { Point } from '@pragmatic-tech-ai/mural/runtime'
import { ToolboxVisualDescriptor } from '@pragmatic-tech-ai/mural/framework'
import { ArchInstanceDropFactory } from '../arch-instance-drop-factory.js'

describe('ArchInstanceDropFactory', () => {
  it('delegates to Mutator.CreateNode(descriptor.Key, x, y) and returns the node', () => {
    const calls: Array<[string, number, number]> = []
    const node = { id: 'n1' }
    const mutator = { CreateNode(kind: string, x: number, y: number) { calls.push([kind, x, y]); return node } }
    const factory = new ArchInstanceDropFactory()
    const desc = new ToolboxVisualDescriptor({} as never, 'Stack.AzureOpenAI')
    const result = factory.CreateDropped({
      Item: {} as never, Descriptor: desc, Position: new Point(120, 80),
      Diagram: {} as never, Mutator: mutator as never,
    })
    expect(calls).toEqual([['Stack.AzureOpenAI', 120, 80]])
    expect(result).toBe(node)
  })

  it('returns null when CreateNode resolves nothing', () => {
    const mutator = { CreateNode() { return null } }
    const factory = new ArchInstanceDropFactory()
    const result = factory.CreateDropped({
      Item: {} as never, Descriptor: new ToolboxVisualDescriptor({} as never, 'x'),
      Position: new Point(0, 0), Diagram: {} as never, Mutator: mutator as never,
    })
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-instance-drop-factory.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { IToolboxDropFactory, ToolboxDropContext } from '@pragmatic-tech-ai/mural/framework'

export const ArchInstanceDropFactoryKey = new ServiceKey<IToolboxDropFactory>('ArchInstanceDropFactory')

// Drops a toolbox term onto the arch canvas by reusing the document's own
// CreateNode (ArchDiagramDocument IS the DiagramMutator): create the concept
// instance referencing the term, at the drop position. The descriptor Key is the
// term id; the mutator re-derives the concept via resolveTermDrop. Returns the
// created node (so the Diagram selects it) or null when nothing resolves.
export class ArchInstanceDropFactory implements IToolboxDropFactory
{
    public CreateDropped(context: ToolboxDropContext): unknown | null
    {
        return context.Mutator.CreateNode(context.Descriptor.Key, context.Position.X, context.Position.Y) ?? null
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-instance-drop-factory.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/services/arch-instance-drop-factory.ts src/renderer/src/modules/architecture-projects/services/tests/arch-instance-drop-factory.test.ts
git commit -m "feat(toolbox): ArchInstanceDropFactory delegating to CreateNode

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Adapter registration helper

**Files:**
- Create: `src/renderer/src/modules/diagram/services/register-arch-toolbox-adapters.ts`
- Test: `src/renderer/src/modules/diagram/services/tests/register-arch-toolbox-adapters.test.ts`

**Interfaces:**
- Consumes: `IServiceProvider` (mural `ServiceProvider` — has `has(key)`, `get(key)`, `registerInstance(key, inst)`), `LibraryRegistry.Key`, the two resolver classes/keys, `ArchInstanceDropFactory`/`ArchInstanceDropFactoryKey`, `ConceptVisualResolver`.
- Produces: `registerArchToolboxAdapters(services): ConceptVisualResolver` — idempotent; returns the (existing or new) `ConceptVisualResolver` instance so the populator can call `Register(...)` on it.

Verify the `ServiceProvider` API shape first (Step 1): the summary of mural DI is `has`/`get`/`getRequired`/`registerInstance`. Read one existing Plexus registration site (e.g. how `LibraryRegistry` lands in the provider via the `.services:` block) to confirm the exact method names; adapt if they differ.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { LibraryRegistry } from '../../library/services/library-registry.js'
import { registerArchToolboxAdapters } from '../register-arch-toolbox-adapters.js'
import { LibraryClassVisualResolverKey } from '../library-class-visual-resolver.js'
import { ConceptVisualResolverKey } from '../concept-visual-resolver.js'
import { ArchInstanceDropFactoryKey } from '../../architecture-projects/services/arch-instance-drop-factory.js'

function providerWithRegistry(): ServiceProvider {
  const p = new ServiceProvider()
  p.registerInstance(LibraryRegistry.Key, { resolve: () => undefined, onChanged: () => () => {} } as never)
  return p
}

describe('registerArchToolboxAdapters', () => {
  it('registers both resolvers + the factory, idempotently', () => {
    const p = providerWithRegistry()
    const concept1 = registerArchToolboxAdapters(p)
    expect(p.get(LibraryClassVisualResolverKey)).toBeDefined()
    expect(p.get(ConceptVisualResolverKey)).toBe(concept1)
    expect(p.get(ArchInstanceDropFactoryKey)).toBeDefined()
    const libFirst = p.get(LibraryClassVisualResolverKey)
    const concept2 = registerArchToolboxAdapters(p)
    expect(concept2).toBe(concept1)                              // same instance, no re-register
    expect(p.get(LibraryClassVisualResolverKey)).toBe(libFirst)
  })
})
```

(If `ServiceProvider` can't be constructed bare, build the minimal provider the other Plexus service tests use — copy that harness. Do not stub methods that exist.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/diagram/services/tests/register-arch-toolbox-adapters.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import type { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { LibraryRegistry } from '../../library/services/library-registry.js'
import { LibraryClassVisualResolver, LibraryClassVisualResolverKey } from './library-class-visual-resolver.js'
import { ConceptVisualResolver, ConceptVisualResolverKey } from './concept-visual-resolver.js'
import { ArchInstanceDropFactory, ArchInstanceDropFactoryKey } from '../../architecture-projects/services/arch-instance-drop-factory.js'

// Idempotently register the Plexus toolbox resolvers + drop factory into the
// service provider. Returns the ConceptVisualResolver so the populator can feed it
// term icons. Safe to call on every reload — existing registrations are left as-is.
export function registerArchToolboxAdapters(services: ServiceProvider): ConceptVisualResolver
{
    if (!services.has(LibraryClassVisualResolverKey))
    {
        const registry = services.get(LibraryRegistry.Key)
        if (registry !== undefined) services.registerInstance(LibraryClassVisualResolverKey, new LibraryClassVisualResolver(registry))
    }
    if (!services.has(ArchInstanceDropFactoryKey))
    {
        services.registerInstance(ArchInstanceDropFactoryKey, new ArchInstanceDropFactory())
    }
    if (!services.has(ConceptVisualResolverKey))
    {
        services.registerInstance(ConceptVisualResolverKey, new ConceptVisualResolver())
    }
    return services.get(ConceptVisualResolverKey)!
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/diagram/services/tests/register-arch-toolbox-adapters.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/diagram/services/register-arch-toolbox-adapters.ts src/renderer/src/modules/diagram/services/tests/register-arch-toolbox-adapters.test.ts
git commit -m "feat(toolbox): idempotent adapter registration helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: `ToolboxService` populator

**Files:**
- Modify: `src/renderer/src/modules/diagram/services/diagram-panel-services.ts`
- Test: `src/renderer/src/modules/diagram/services/tests/toolbox-service-populate.test.ts`

**Interfaces:**
- Consumes: `ToolboxRepository` (`.Key`, `EnsurePage`, `RemovePage`, `Pages`), `Application.current.Services`, `registerArchToolboxAdapters`, `ArchToolboxItem`, `ToolboxVisualDescriptor`, `LibraryClassVisualResolverKey`, `ConceptVisualResolverKey`, `ArchInstanceDropFactoryKey`, `projectToolbox` (`ToolboxTaxonomy { id, label, terms }`, `ToolboxTermRef { id, label, icon?, concept }`), the existing `scanPublishedModels` / `readModel` / `sourceBackends`.
- Produces: `ToolboxService.reload()` populating the mural repo; `get Repository(): ToolboxRepository`; `get Pages()` → `repo.Pages`.

- [ ] **Step 1: Establish `sourceBackends()` returns an `isLibrary` flag**

Read the current `sourceBackends()` (it yields `ensureMetaModelsBackend` + `ensureLibrariesBackend`). Change its element type to `{ backend, isLibrary: boolean }` (meta-models → `false`, libraries → `true`). Update its only caller (`reload`).

- [ ] **Step 2: Write the failing test** (drives the new `reload` shape + `.Repository`)

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { Application } from '@pragmatic-tech-ai/mural/runtime'
import { ToolboxRepository, ToolboxVisualDescriptor } from '@pragmatic-tech-ai/mural/framework'
import { ToolboxService } from '../diagram-panel-services.js'
import { LibraryClassVisualResolverKey } from '../library-class-visual-resolver.js'
import { ConceptVisualResolverKey } from '../concept-visual-resolver.js'
// Use the harness the other diagram-service tests use to build a provider + backends.
// Register a real ToolboxRepository + LibraryRegistry stub, and stub scanPublishedModels/readModel
// so projectToolbox yields: a LIBRARY taxonomy 'Stack' with term 'Stack.AzureOpenAI',
// and a META-MODEL taxonomy 'actors' with term 'actors.internal' (icon '<svg/>').

describe('ToolboxService populate', () => {
  // beforeEach: ensure Application.current exists with a Services provider carrying a
  // ToolboxRepository (ensureToolboxDefaults or manual registerInstance) + a LibraryRegistry stub.

  it('fills the repository: one page per taxonomy, items stamped with the right resolver key', async () => {
    const svc = /* construct ToolboxService with the stubbed provider */ null as unknown as ToolboxService
    await svc.reload()
    const repo = svc.Repository
    const stack = repo.Pages.ToArray().find(p => p.Id === 'Stack')!
    const actors = repo.Pages.ToArray().find(p => p.Id === 'actors')!
    const libItem = stack.Items.ToArray()[0]
    const conceptItem = actors.Items.ToArray()[0]
    expect(libItem.Id).toBe('term:Stack.AzureOpenAI')
    expect((libItem.Descriptor as ToolboxVisualDescriptor).ResolverKey).toBe(LibraryClassVisualResolverKey)
    expect((conceptItem.Descriptor as ToolboxVisualDescriptor).ResolverKey).toBe(ConceptVisualResolverKey)
  })

  it('a second reload replaces the taxonomy pages without duplicating', async () => {
    const svc = /* ... */ null as unknown as ToolboxService
    await svc.reload()
    await svc.reload()
    const repo = svc.Repository
    expect(repo.Pages.ToArray().filter(p => p.Id === 'Stack').length).toBe(1)
  })
})
```

(Model the provider/backends stubs on the nearest existing `diagram-panel-services` or `library` service test. If none exists, keep the stubs minimal but real — a fake backend whose `scanPublishedModels` returns one id/version and whose model reader returns a `TodlDocument` that `projectToolbox` turns into the two taxonomies above.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/diagram/services/tests/toolbox-service-populate.test.ts`
Expected: FAIL (old `reload` builds Plexus-local pages / `TermTile`).

- [ ] **Step 4: Rewrite `reload()` and add `Repository` / `Pages`**

Replace the body (current lines ~58–96). Track contributed page ids for replacement; do not touch the Shapes page (mural owns it).

```ts
public get Repository(): ToolboxRepository
{
    return Application.current!.Services.getRequired(ToolboxRepository.Key)
}

public get Pages(): ObservableCollection<ToolboxPage>   // now the repo's pages
{
    return this.Repository.Pages
}

private contributedPageIds: string[] = []

public async reload(): Promise<void>
{
    const seq = ++this.reloadSeq
    const services = Application.current!.Services
    const repo = services.getRequired(ToolboxRepository.Key)
    const conceptResolver = registerArchToolboxAdapters(services)

    interface Built { id: string; label: string; items: ArchToolboxItem[] }
    const byTaxonomy = new Map<string, { built: Built; seen: Set<string> }>()

    for (const { backend, isLibrary } of this.sourceBackends()) {
        const models = await scanPublishedModels(backend)
        for (const { id, versions } of models) {
            for (const version of versions) {
                const doc = await this.readModel(backend, `${id}/${version}`)
                if (doc === undefined) continue
                for (const tax of projectToolbox(doc)) {
                    let entry = byTaxonomy.get(tax.id)
                    if (entry === undefined) { entry = { built: { id: tax.id, label: tax.label, items: [] }, seen: new Set() }; byTaxonomy.set(tax.id, entry) }
                    for (const term of tax.terms) {
                        if (entry.seen.has(term.id)) continue
                        entry.seen.add(term.id)
                        const resolverKey = isLibrary ? LibraryClassVisualResolverKey : ConceptVisualResolverKey
                        if (!isLibrary) conceptResolver.Register(term.id, term.icon)
                        const descriptor = new ToolboxVisualDescriptor(resolverKey, term.id)
                        entry.built.items.push(new ArchToolboxItem('term:' + term.id, term.label, descriptor, ArchInstanceDropFactoryKey))
                    }
                }
            }
        }
    }

    if (seq !== this.reloadSeq) return

    // Replace only our taxonomy pages; leave mural's Shapes page.
    for (const pid of this.contributedPageIds) repo.RemovePage(pid)
    this.contributedPageIds = []
    for (const { built } of byTaxonomy.values()) {
        const page = repo.EnsurePage(built.id, built.label)
        for (const item of built.items) page.Items.Add(item)
        this.contributedPageIds.push(built.id)
    }
}
```

Remove `buildShapesPage`, `wireAccordion`, the Plexus-local `Pages` DP, and the `import` of `ToolboxPage` / `TermTile` / `resolveTermTemplate` / `ToolboxShape`. Add imports for the mural repo/descriptor, `ArchToolboxItem`, the resolver/factory keys, and `registerArchToolboxAdapters`. (`RemovePage` + `EnsurePage` + fresh `Items.Add` gives clean replacement without disturbing Shapes.)

- [ ] **Step 5: Run test + neighbours**

Run: `npx vitest run src/renderer/src/modules/diagram/services/tests/`
Expected: the populate test PASSES; no other diagram-service test regresses. (The `.mu`-dependent app build is not exercised here.)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/modules/diagram/services/diagram-panel-services.ts src/renderer/src/modules/diagram/services/tests/toolbox-service-populate.test.ts
git commit -m "feat(toolbox): ToolboxService populates the mural repository

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Toolbox tile + page templates (`.mu`)

**Files:**
- Modify: `src/renderer/src/modules/diagram/diagram.resources.mu`

**Interfaces:**
- Consumes: `ArchToolboxItem` (imported), mural built-ins `ToolboxPage` / `ToolboxVisualPresenter` / `VisualContext` (no import), `ToolboxService.Pages`.

This task's deliverable is markup; verification is the module template compile (`npm run build` template phase) plus the Task 11 smoke, not a unit test.

- [ ] **Step 1: Swap imports**

Remove `import ToolboxPage from "./services/toolbox-page.js"` and `import TermTile from "./services/toolbox-page.js"`. Add `import ArchToolboxItem from "./services/arch-toolbox-item.js"`.

- [ ] **Step 2: Replace the `TermTile` tile template with an `ArchToolboxItem` tile**

Replace the `DataTemplate [DataType = TermTile] { … }` block (current lines ~329–348) with:

```mu
DataTemplate [DataType = ArchToolboxItem] {
    Border x:root
        [ IsDraggable     = true,
          OnDragStart     = $BeginDragData,
          Background      = @Surface,
          BorderBrush     = @OutlineVariant,
          BorderThickness = (1),
          CornerRadius    = 4,
          Padding         = (4,8,4,8),
          Margin          = (2,0,2,4),
          MaxWidth        = 104 ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Center ] {
            ToolboxVisualPresenter
                [ Descriptor          = $Descriptor,
                  Context             = Tile,
                  Width               = 48,
                  Height              = 48,
                  HorizontalAlignment = Center ]
        }
    }
}
```

(The class visual carries its own label; no separate `$Label` TextBlock — see the spec's presenter-only note. `Context = Tile` is the mural `VisualContext` enum member, a built-in markup symbol.)

- [ ] **Step 3: Rebind the accordion/page template to mural `ToolboxPage`**

The `ToolboxAccordionItem` template (lines ~312–324) is `[DataType = ToolboxPage]` and binds `$IsExpanded` / `$Title` / `$Items`. Mural's `ToolboxPage` has `Title` + `Items` but no `IsExpanded`. Per the spec's accordion decision (default: drop single-expand for v1), replace the ToggleButton/collapsible body with an always-shown section:

```mu
DataTemplate x:key="ToolboxAccordionItem" [DataType = ToolboxPage] {
    StackPanel [ Orientation = Vertical, Margin = (0,0,0,6) ] {
        TextBlock [ Text = $Title, Style = @LabelMedium, Foreground = @OnSurfaceVariant, Margin = (0,0,0,4) ]
        ItemsControl [ ItemsSource = $Items, ItemsPanel = @DiagramToolboxPanel ]
    }
}
```

The `[DataType = ToolboxService]` template's `ItemsControl [ ItemsSource = $Pages, ItemTemplate = @ToolboxAccordionItem ]` is unchanged (`$Pages` now returns the repo's pages). If preserving single-expand is chosen instead, carry an expand flag on a per-page wrapper VM outside mural's `ToolboxPage`; default plan drops it.

- [ ] **Step 4: Verify the template compiles**

Run the template/build phase the repo uses (e.g. `npm run build` up to the renderer template compile, or the module's template test if one exists). Expected: the diagram module's `.mu` compiles with no unknown-symbol errors for `ArchToolboxItem` / `ToolboxVisualPresenter` / `ToolboxPage` / `Context`. (IDE "unknown symbol" squiggles from a stale language server are not authoritative — the compile is.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/diagram/diagram.resources.mu
git commit -m "feat(toolbox): tile template hosts ToolboxVisualPresenter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Canvas migration

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/instance-node-vm.ts`
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-diagram-document.ts`
- Modify: `src/renderer/src/modules/architecture-projects/architecture-projects.resources.mu`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/instance-node-vm-descriptor.test.ts`

**Interfaces:**
- Consumes: `ToolboxVisualDescriptor`, `LibraryClassVisualResolverKey`, `ConceptVisualResolverKey`.
- Produces: `InstanceNodeVM.Descriptor: ToolboxVisualDescriptor | undefined` (rebuilt in `refresh()`); node template hosting `ToolboxVisualPresenter[Context=Figure]`; `ArchDiagramDocument` with no template-resolution logic.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { LibraryClassVisualResolverKey } from '../../../diagram/services/library-class-visual-resolver.js'
import { ConceptVisualResolverKey } from '../../../diagram/services/concept-visual-resolver.js'
import { InstanceNodeVM } from '../instance-node-vm.js'
// Build an ArchInstanceModel (reuse the harness in existing arch tests) with:
//  - node A: typeOf 'concept-x', a Relationship edge A -> 'Stack.AzureOpenAI'
//  - node B: typeOf 'concept-y', no Relationship edge

describe('InstanceNodeVM.Descriptor', () => {
  it('uses the library resolver keyed on the referenced term when present', () => {
    const vm = new InstanceNodeVM(model, 'A')
    expect(vm.Descriptor!.ResolverKey).toBe(LibraryClassVisualResolverKey)
    expect(vm.Descriptor!.Key).toBe('Stack.AzureOpenAI')
  })
  it('falls back to the concept resolver keyed on the concept', () => {
    const vm = new InstanceNodeVM(model, 'B')
    expect(vm.Descriptor!.ResolverKey).toBe(ConceptVisualResolverKey)
    expect(vm.Descriptor!.Key).toBe('concept-y')
  })
})
```

(Reuse the model-building harness from the existing arch tests — e.g. whatever `arch-canvas-ops` / `instance-node-vm` tests use. Do not fabricate a model shape; mirror an existing one.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/instance-node-vm-descriptor.test.ts`
Expected: FAIL — `Descriptor` doesn't exist.

- [ ] **Step 3: Edit `InstanceNodeVM`** — replace `Template`/`Data` with `Descriptor`

Remove `TemplateKey` (lines ~22–23), `DataKey` (lines ~28–29), their getters/setters (lines ~53–55), and the `this.set_property_value(InstanceNodeVM.DataKey, this)` in the ctor. Add:

```ts
import { ToolboxVisualDescriptor } from '@pragmatic-tech-ai/mural/framework'
import { LibraryClassVisualResolverKey } from '../../diagram/services/library-class-visual-resolver.js'
import { ConceptVisualResolverKey } from '../../diagram/services/concept-visual-resolver.js'

// The visual descriptor the canvas node presenter renders. Rebuilt on refresh from
// the node's referenced term (library class) or, absent one, its concept.
public static readonly DescriptorKey = Model.RegisterProperty<ToolboxVisualDescriptor | undefined>(
    InstanceNodeVM, 'Descriptor', undefined, MetaData.None)
public get Descriptor(): ToolboxVisualDescriptor | undefined { return this.get_property_value(InstanceNodeVM.DescriptorKey) }
```

At the end of `refresh()`, after `ReferencedTermKey`/`ConceptKey` are set, compute the descriptor (same keying as the deleted `ResolveTemplate`):

```ts
const term = this.get_property_value(InstanceNodeVM.ReferencedTermKey)
const concept = this.get_property_value(InstanceNodeVM.ConceptKey)
const descriptor = term !== ''
    ? new ToolboxVisualDescriptor(LibraryClassVisualResolverKey, term)
    : new ToolboxVisualDescriptor(ConceptVisualResolverKey, concept)
this.set_property_value(InstanceNodeVM.DescriptorKey, descriptor)
```

- [ ] **Step 4: Edit `ArchDiagramDocument`** — delete template-resolution logic

Remove `ResolveTemplate` (lines ~88–92), `upgradeTemplatesFor` (lines ~72–78), and the ctor's `registry?.onChanged((classId) => this.upgradeTemplatesFor(classId))` (line ~67). In `AddNode` (lines ~100–108) drop `vm.Template = this.ResolveTemplate(vm)`. The `registry` ctor param + import are now unused **by the document** — remove them from `ArchDiagramDocument` (the resolvers hold the registry via the provider). Also remove the now-unused `DataTemplate` import.

- [ ] **Step 5: Edit the node template** — host the presenter

In `architecture-projects.resources.mu`, replace the `[DataType = InstanceNodeVM]` template (lines ~47–49):

```mu
DataTemplate [ DataType = InstanceNodeVM ] {
    ToolboxVisualPresenter [ Descriptor = $Descriptor, Context = Figure ]
}
```

(`ToolboxVisualPresenter` + `Context`/`Figure` are mural built-ins — no import. The presenter's DataContext is the `InstanceNodeVM` — the class template's `$Display` etc. bind to the node.)

- [ ] **Step 6: Run the test + arch neighbours + node-template compile**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/`
Expected: the descriptor test PASSES; existing arch tests that referenced `vm.Template` / `ResolveTemplate` are updated or removed in this task (grep them in Step 4 and fix). Run the renderer template compile; expect the arch module `.mu` compiles.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/
git commit -m "feat(toolbox): canvas nodes render through ToolboxVisualPresenter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Library preview + tree drag

**Files:**
- Modify: `src/renderer/src/modules/library/services/library-tree-node.ts`
- Modify: `src/renderer/src/modules/library/services/libraries-panel-service.ts`
- Modify: `src/renderer/src/modules/library/library.resources.mu`
- Test: `src/renderer/src/modules/library/services/tests/library-tree-node-drag.test.ts`

**Interfaces:**
- Consumes: `ToolboxVisualDescriptor`, `LibraryClassVisualResolverKey`, `TOOLBOX_ITEM_FORMAT`, `ToolboxRepository`, `Application`.
- Produces: `LibraryTreeNode.Descriptor`; `LibraryTreeNode.BeginDragData` emitting `TOOLBOX_ITEM_FORMAT = "term:"+TermId`; draggability gated on repo membership; preview template hosting the presenter.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { Application } from '@pragmatic-tech-ai/mural/runtime'
import { ToolboxRepository, ToolboxVisualDescriptor, TOOLBOX_ITEM_FORMAT } from '@pragmatic-tech-ai/mural/framework'
import { LibraryTreeNode, LibraryNodeKind } from '../library-tree-node.js'
import { LibraryClassVisualResolverKey } from '../../../diagram/services/library-class-visual-resolver.js'
// beforeEach: ensure Application.current.Services carries a ToolboxRepository with a
// page containing an item Id 'term:Stack.AzureOpenAI'.

describe('LibraryTreeNode drag + descriptor', () => {
  it('a class node with a matching repo item drags the item id and has a descriptor', () => {
    const node = /* build a Class LibraryTreeNode with TermId 'Stack.AzureOpenAI', Concept 'concept-x' */ null as unknown as LibraryTreeNode
    expect(node.Descriptor).toEqual(new ToolboxVisualDescriptor(LibraryClassVisualResolverKey, 'Stack.AzureOpenAI'))
    expect(node.IsDraggable).toBe(true)
    expect(node.BeginDragData!().data.Get(TOOLBOX_ITEM_FORMAT)).toBe('term:Stack.AzureOpenAI')
  })
  it('a class node with no repo item is not draggable', () => {
    const node = /* Class LibraryTreeNode with TermId 'Stack.NotInToolbox' */ null as unknown as LibraryTreeNode
    expect(node.IsDraggable).toBe(false)
  })
})
```

(Mirror the existing `LibraryTreeNode` construction from `libraries-panel-service` / its tests. Add an `IsDraggable` accessor if the class lacks one.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-tree-node-drag.test.ts`
Expected: FAIL — `Descriptor` / new drag shape absent.

- [ ] **Step 3: Edit `LibraryTreeNode`**

Remove the `TOOLBOX_NODE_KIND_FORMAT` import + `BeginKindDragData` DP. Add:

```ts
import { Application } from '@pragmatic-tech-ai/mural/runtime'
import { ToolboxRepository, ToolboxVisualDescriptor, TOOLBOX_ITEM_FORMAT } from '@pragmatic-tech-ai/mural/framework'
import { LibraryClassVisualResolverKey } from '../../diagram/services/library-class-visual-resolver.js'

public static readonly DescriptorKey = Model.RegisterProperty<ToolboxVisualDescriptor | undefined>(
    LibraryTreeNode, 'Descriptor', undefined, MetaData.None)
public static readonly BeginDragDataKey = Model.RegisterProperty<(() => { data: DataObject; effects: DragDropEffects }) | undefined>(
    LibraryTreeNode, 'BeginDragData', undefined, MetaData.None)
public static readonly IsDraggableKey = Model.RegisterProperty<boolean>(LibraryTreeNode, 'IsDraggable', false, MetaData.None)
```

Where a Class node is finalized (the same place `TermId`/`Concept` are set today), compute:

```ts
const itemId = 'term:' + this.TermId
const repo = Application.current?.Services.get(ToolboxRepository.Key)
const draggable = repo?.ItemById(itemId) !== undefined
this.set_property_value(LibraryTreeNode.IsDraggableKey, draggable)
this.set_property_value(LibraryTreeNode.DescriptorKey, new ToolboxVisualDescriptor(LibraryClassVisualResolverKey, this.TermId))
this.set_property_value(LibraryTreeNode.BeginDragDataKey, () => ({
    data: new DataObject().Set(TOOLBOX_ITEM_FORMAT, itemId),
    effects: DragDropEffects.Copy,
}))
```

Add `Descriptor` / `BeginDragData` / `IsDraggable` getters. (If tree nodes are built before the repo is populated, recompute draggability lazily in the `IsDraggable` getter instead of caching — read the repo on access.)

- [ ] **Step 4: Edit the preview template + tree-row drag in `library.resources.mu`**

Preview `[DataType = LibraryTreeNode]` (lines ~46–60):

```mu
DataTemplate [ DataType = LibraryTreeNode ] {
    StackPanel [ Orientation = Vertical ] {
        ToolboxVisualPresenter [ Descriptor = $Descriptor, Context = Tile ]
        TextBlock [ Text = $Concept, Style = @BodySmall, Foreground = @OnSurfaceVariant, Margin = (0,4,0,0) ]
    }
}
```

In the tree-row template `@LibraryNodeTemplate`, change the draggable class leaf's `OnDragStart = $BeginKindDragData` to `OnDragStart = $BeginDragData` and gate `IsDraggable = $IsDraggable` (replacing any hard-coded `IsDraggable = true` on class leaves).

- [ ] **Step 5: Edit `LibrariesPanelService`**

Delete the `registry.onChanged` subscription (lines ~47–52) and the `node.Template = …resolve(…)` assignments (line ~50 and ~135). The preview upgrade is now the presenter's job. If `SelectedNode`/`PreviewData` bookkeeping set `Template`, drop those lines; keep the selection wiring.

- [ ] **Step 6: Run the test + library neighbours + compile**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/`
Expected: the drag test PASSES; existing library tests that referenced `Template`/`BeginKindDragData` are updated in this task. Run the renderer template compile; expect the library module `.mu` compiles.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/modules/library/
git commit -m "feat(toolbox): library preview + tree drag through the repository

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Final cutover — delete residuals, full build + suite green

**Files:**
- Delete: `src/renderer/src/modules/diagram/services/toolbox-term-template.ts`
- Delete/trim: `src/renderer/src/modules/diagram/services/toolbox-page.ts` (remove `TermTile` / `ToolboxPage` / `ToolboxPageKind`; delete the file if nothing remains, and drop its `.services:`/import references)
- Delete: `src/renderer/src/modules/diagram/services/tests/mural-030-smoke.test.ts`
- Modify: any remaining referrer surfaced by grep

- [ ] **Step 1: Grep for every residual symbol**

Run:
```bash
grep -rn "ToolboxShape\|TOOLBOX_NODE_KIND_FORMAT\|TermTile\|resolveTermTemplate\|ToolboxPageKind\|BeginKindDragData\|\.ToolboxShapes\|ResolveTemplate\|upgradeTemplatesFor\|buildShapesPage" src/renderer/src
```
Expected after fixes: no hits in non-test source. Resolve each remaining hit (delete the file, drop the import, or migrate the caller). `toolbox-page.ts`: if only `TermTile`/`ToolboxPage`/`ToolboxPageKind` lived there, delete the file and remove its imports from `diagram.resources.mu` (done in Task 8) and anywhere else.

- [ ] **Step 2: Delete the leftover files + smoke test**

Delete `toolbox-term-template.ts`, the smoke test, and `toolbox-page.ts` (if empty). Remove any `.module.mu` or barrel reference to deleted symbols.

- [ ] **Step 3: Full typecheck + build**

Run: `npm run build`
Expected: exit 0. Fix any type errors this surfaces (the hard cutover means the whole renderer typechecks only now).

- [ ] **Step 4: Full test suite**

Run: `npm test`
Expected: all green, no new failures vs the pre-change baseline. Investigate any failure to root cause (do not skip).

- [ ] **Step 5: Re-run the residual grep to confirm clean**

Run the Step-1 grep again. Expected: clean (test files may reference deleted symbols only if those tests were themselves deleted/migrated — there should be none).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(toolbox): delete TermTile/ToolboxShape residuals; full cutover green

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 7: Finish the branch**

Announce and use **superpowers:finishing-a-development-branch**: verify `npm test` on the integration branch, present the merge/PR/keep menu, execute the choice. Note the mural `0.3.0` bump is a separate commit in the Mural repo — its integration (merge/publish already done in Task 1) is independent of the Plexus branch decision.

---

## Global verification (manual smoke, post-merge)

Headless tests can't prove the visual wiring. After merge, run the app (`npm run dev`) and confirm: (1) library toolbox tiles show their **icons** (the original bug); (2) meta-model taxonomy tiles show their annotation icons; (3) dragging a tile creates the right node with the right visual; (4) a class whose template compiles lazily upgrades in place on tile, canvas node, and preview; (5) the Libraries-panel preview renders and a taxonomy-visible class leaf drags onto the canvas while a non-toolbox class leaf does not.

---

## Self-Review

- **Spec coverage:** §1 LibraryClassVisualResolver → Task 3; §2 ConceptVisualResolver → Task 4; §3 ArchInstanceDropFactory → Task 5; §4 populator + ArchToolboxItem → Tasks 2, 7 (+ registration Task 6); §5 tile → Task 8; §6 canvas → Task 9; §7 preview → Task 10; §8 tree drag → Task 10; §9 deletions → Task 11; prerequisite → Task 1; testing → each task's test + Task 11 suite. Covered.
- **Type consistency:** `ArchToolboxItem(id, label, descriptor, factoryKey)` used identically in Tasks 2 & 7; `LibraryClassVisualResolverKey` / `ConceptVisualResolverKey` / `ArchInstanceDropFactoryKey` defined in Tasks 3/4/5 and consumed in 6/7/9/10; descriptor keying `term !== '' ? Library : Concept` identical in VM (Task 9) and today's deleted `ResolveTemplate`; item id `"term:"+termId` identical in Tasks 7 & 10.
- **Known soft spots the implementer must ground (not placeholders — verification steps):** the exact `ServiceProvider` method names (Task 6 Step-0 read), the `visual-library` helper signatures (Task 4 Step 1), the arch-model test harness (Tasks 7 & 9), and `Border.IsHitTestVisible` default (Task 3 Step 2). Each task names the file to read and says "adapt, don't invent."

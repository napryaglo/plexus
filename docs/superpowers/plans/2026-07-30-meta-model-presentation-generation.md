# Meta-Model Presentation Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate an author-editable mural resource dictionary
(`presentation.generated.mu`) into a meta-model project — icons + one template
per ontology entity, composing the author's own `presentation/*.mu` — and invoke
it from a project command and from publish.

**Architecture:** A pure, headless generator turns the compiled `model.json`
(`TodlDocument`) into `.mu` source text. A capability method on
`MetaModelProjectFactory` does the I/O (compile model, scan `presentation/`,
write the file) and is triggered by a new "Generate Presentation" project command
and as publish's first step. No compilation of the generated `.mu` happens here
(that is sub-project 2); this sub-project emits and writes text only.

**Tech Stack:** TypeScript (renderer), `@pragmatic-tech-ai/todl` (`check`, `toJSON`,
`TodlDocument`/`JsonNode`), mural runtime (`RelayCommand`, `Model` DP), `IStorage`
seam, Vitest.

## Global Constraints

- **Tests live in a `tests/` subfolder** next to their source
  (`.../meta-model/services/tests/…`, `.../project-explorer/services/tests/…`).
- **Enums over string-literal unions** — fixed value sets are real TS `enum`s
  with explicit string values.
- The generator is **pure** (no I/O, no mural-runtime import) and
  **deterministic** (same input → byte-identical output).
- The generated `.mu` references entities' binding surface `$Label` and icon
  geometry keys only; its `DataType = MetaModelEntity` names a view-model realised
  in sub-project 3. The generated file is **not compiled** in this sub-project.
- Published/JSON types come from `@pragmatic-tech-ai/todl`:
  `interface JsonNode { id: string; tier: string; typeOf: string; attrs: Record<string, Scalar> }`,
  `interface TodlDocument { nodes: JsonNode[]; edges: JsonEdge[] }`.
- Generated filename is `presentation.generated.mu`; author files live under
  `presentation/`. Only the generated file is ever written by this feature.

## File Structure

- **Create:** `src/renderer/src/modules/meta-model/services/presentation-generator.ts`
  — pure generator + helpers.
- **Create:** `src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`
- **Modify:** `src/renderer/src/services/projects/project-factory.ts`
  — add `IPresentationProjectFactory` + `canGeneratePresentation` guard.
- **Modify:** `src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts`
  — `writePresentation` (private, doc→file), `regeneratePresentation` (capability),
  publish hook.
- **Create/Modify:** `src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts`
  — FakeStorage I/O test.
- **Modify:** `src/renderer/src/services/projects/open-project.ts`
  — `GeneratePresentationCommand` DP.
- **Modify:** `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts`
  — wire the command + handler.
- **Modify:** `src/renderer/src/modules/project-explorer/project-explorer.resources.mu`
  — add the menu item; then `npm run compile:mu`.

---

### Task 1: Pure formatting helpers

**Files:**
- Create: `src/renderer/src/modules/meta-model/services/presentation-generator.ts`
- Test: `src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`

**Interfaces:**
- Produces: `iconKey(path: string): string`, `humanize(id: string): string`.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'vitest'
import { iconKey, humanize } from '../presentation-generator.js'

test('iconKey slugs an icon path to a stable identifier', () => {
    expect(iconKey('resources/actor-internal.svg')).toBe('mm_icon_actor_internal')
    expect(iconKey('resources/sub/role.service.svg')).toBe('mm_icon_role_service')
    expect(iconKey('a.svg')).toBe('mm_icon_a')
})

test('humanize title-cases an id split on - and .', () => {
    expect(humanize('app-component')).toBe('App Component')
    expect(humanize('actor')).toBe('Actor')
    expect(humanize('connector-type-style')).toBe('Connector Type Style')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`
Expected: FAIL — module has no such exports.

- [ ] **Step 3: Implement the helpers**

```ts
// presentation-generator.ts — pure emitter for a meta-model's presentation
// resource dictionary. No I/O, no mural import; deterministic text only.

// "resources/actor-internal.svg" → "mm_icon_actor_internal". Strips the
// directory + extension, lowercases, and replaces every non-identifier run with
// a single '_', so distinct paths yield distinct keys usable as a mural resource
// key (`@mm_icon_…`).
export function iconKey(path: string): string {
    const stem = path.replace(/^.*\//, '').replace(/\.[^.]+$/, '')
    const slug = stem.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    return `mm_icon_${slug}`
}

// "app-component" → "App Component". Splits on '-'/'.'/'_' and title-cases.
export function humanize(id: string): string {
    return id.split(/[-._]/).filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/presentation-generator.ts src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts
git commit -m "feat(meta-model): presentation-generator formatting helpers"
```

---

### Task 2: Model selectors

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/presentation-generator.ts`
- Test: `src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`

**Interfaces:**
- Consumes: `TodlDocument`, `JsonNode` from `@pragmatic-tech-ai/todl`.
- Produces: `enum OntologyKind`, `ontologyEntities(model): JsonNode[]`,
  `distinctIcons(model): string[]`.

- [ ] **Step 1: Write the failing test**

```ts
import { ontologyEntities, distinctIcons } from '../presentation-generator.js'
import type { TodlDocument } from '@pragmatic-tech-ai/todl'

function doc(nodes: TodlDocument['nodes']): TodlDocument { return { nodes, edges: [] } }

test('ontologyEntities keeps concept/relationship/taxonomy/primitive, drops field + instances', () => {
    const m = doc([
        { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} },
        { id: 'depends-on', tier: 'Ontology', typeOf: 'relationship', attrs: {} },
        { id: 'actor-kind', tier: 'Ontology', typeOf: 'taxonomy', attrs: {} },
        { id: 'text', tier: 'Ontology', typeOf: 'primitive', attrs: {} },
        { id: 'actor.label', tier: 'Ontology', typeOf: 'field', attrs: {} },
        { id: 'actors.internal', tier: 'Instance', typeOf: 'actor', attrs: {} },
    ])
    expect(ontologyEntities(m).map((n) => n.id)).toEqual(['actor', 'depends-on', 'actor-kind', 'text'])
})

test('distinctIcons collects distinct attrs.icon across ALL nodes, sorted', () => {
    const m = doc([
        { id: 'a', tier: 'Instance', typeOf: 'x', attrs: { icon: 'resources/b.svg' } },
        { id: 'b', tier: 'Instance', typeOf: 'x', attrs: { icon: 'resources/a.svg' } },
        { id: 'c', tier: 'Instance', typeOf: 'x', attrs: { icon: 'resources/b.svg' } },   // dup
        { id: 'd', tier: 'Ontology', typeOf: 'concept', attrs: {} },
    ])
    expect(distinctIcons(m)).toEqual(['resources/a.svg', 'resources/b.svg'])
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`
Expected: FAIL — no such exports.

- [ ] **Step 3: Implement**

```ts
import type { TodlDocument, JsonNode } from '@pragmatic-tech-ai/todl'

// The ontology-tier typeOf values presented as first-class entities. `field`
// (concept attributes) is intentionally excluded.
export enum OntologyKind {
    Concept = 'concept',
    Relationship = 'relationship',
    Taxonomy = 'taxonomy',
    Primitive = 'primitive',
}

const ONTOLOGY_KINDS = new Set<string>(Object.values(OntologyKind))

// Ontology-tier nodes that are presentable entities (concept/relationship/
// taxonomy/primitive), in model order.
export function ontologyEntities(model: TodlDocument): JsonNode[] {
    return model.nodes.filter((n) => n.tier === 'Ontology' && ONTOLOGY_KINDS.has(n.typeOf))
}

// Distinct `attrs.icon` values across every node (Ontology + Instance), sorted —
// the SVGs the generated dictionary `include`s so they are available as geometry
// resources (to generated templates and author templates alike).
export function distinctIcons(model: TodlDocument): string[] {
    const set = new Set<string>()
    for (const n of model.nodes) {
        const icon = n.attrs['icon']
        if (typeof icon === 'string' && icon.length > 0) set.add(icon)
    }
    return [...set].sort()
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/presentation-generator.ts src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts
git commit -m "feat(meta-model): ontology-entity + icon selectors"
```

---

### Task 3: The generator (`generatePresentationMu`)

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/presentation-generator.ts`
- Test: `src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`

**Interfaces:**
- Consumes: helpers from Tasks 1–2.
- Produces: `generatePresentationMu(model: TodlDocument, authorOverrideDicts: readonly string[]): string`.

- [ ] **Step 1: Write the failing test**

```ts
import { generatePresentationMu } from '../presentation-generator.js'

test('emits includes, one keyed template per ontology entity, and author merges', () => {
    const m = doc([
        { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} },                    // label-only
        { id: 'gateway', tier: 'Ontology', typeOf: 'concept', attrs: { icon: 'resources/gw.svg', label: 'API Gateway' } }, // icon+label
        { id: 'app.name', tier: 'Ontology', typeOf: 'field', attrs: {} },                    // excluded
        { id: 'actors.internal', tier: 'Instance', typeOf: 'actor', attrs: { icon: 'resources/int.svg' } }, // icon source only
    ])
    const out = generatePresentationMu(m, ['MetaModelPresentationCustom'])

    // includes: one per distinct icon (gw + int), sorted
    expect(out).toContain('include "resources/gw.svg"  as mm_icon_gw')
    expect(out).toContain('include "resources/int.svg" as mm_icon_int')

    // exactly two entity templates (actor, gateway); the field + instance excluded
    expect(out.match(/DataTemplate x:key="mm:/g)?.length).toBe(2)
    expect(out).toContain('DataTemplate x:key="mm:actor"')
    expect(out).toContain('DataTemplate x:key="mm:gateway"')

    // label text: attrs.label wins, else humanized id
    expect(out).toContain('Text = "API Gateway"')
    expect(out).toContain('Text = "Actor"')

    // gateway (has icon) renders an icon Shape; actor (no icon) does not
    expect(out).toContain('Geometry = @mm_icon_gw')
    // author merge trailing
    expect(out.trimEnd().endsWith('merge MetaModelPresentationCustom\n}'.trimEnd()) ||
           out.includes('merge MetaModelPresentationCustom')).toBe(true)
})

test('no author dicts → no merge line; deterministic output', () => {
    const m = doc([{ id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: {} }])
    const a = generatePresentationMu(m, [])
    const b = generatePresentationMu(m, [])
    expect(a).toBe(b)                       // deterministic
    expect(a).not.toContain('merge ')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`
Expected: FAIL — `generatePresentationMu` undefined.

- [ ] **Step 3: Implement**

```ts
// Emit the presentation resource dictionary source. Deterministic: icons sorted,
// entities in model order, one include per distinct icon. `authorOverrideDicts`
// are compiled-dictionary identifiers to `merge` last (author keys win); [] emits
// no merge.
export function generatePresentationMu(model: TodlDocument, authorOverrideDicts: readonly string[]): string {
    const icons = distinctIcons(model)
    const keyWidth = Math.max(0, ...icons.map((p) => p.length))   // align `as` columns
    const includeLines = icons.map((p) => `    include "${p}"${' '.repeat(keyWidth - p.length)}  as ${iconKey(p)}`)

    const templates = ontologyEntities(model).map((n) => entityTemplate(n))
    const merges = authorOverrideDicts.map((d) => `    merge ${d}`)

    return [
        '// presentation.generated.mu — AUTOGENERATED. Do not edit.',
        '// Regenerated from model.json. Author customisation goes in presentation/*.mu.',
        '',
        'resources MetaModelPresentation {',
        '',
        '    // --- Icons: one geometry per distinct icon referenced by the model. ---',
        ...includeLines,
        '',
        '    // --- Entity templates: one per ontology entity, keyed "mm:<id>". ---',
        ...templates,
        ...(merges.length > 0
            ? ['', '    // --- Author overrides (merged last; author keys win). ---', ...merges]
            : []),
        '}',
        '',
    ].join('\n')
}

// One entity's DataTemplate: icon + label when the node carries an attrs.icon,
// else a label-only box. Label = attrs.label ?? humanize(id).
function entityTemplate(n: JsonNode): string {
    const icon = n.attrs['icon']
    const label = typeof n.attrs['label'] === 'string' ? String(n.attrs['label']) : humanize(n.id)
    const inner = (typeof icon === 'string' && icon.length > 0)
        ? [
            `        StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {`,
            `            Shape [ Geometry = @${iconKey(icon)}, Fill = @OnSurfaceVariant, Width = 16, Height = 16, Margin = (0,0,6,0) ]`,
            `            TextBlock [ Text = "${escapeMu(label)}", Style = @BodyMedium, Foreground = @OnSurface ]`,
            `        }`,
          ]
        : [
            `        TextBlock [ Text = "${escapeMu(label)}", Style = @BodyMedium, Foreground = @OnSurface ]`,
          ]
    return [
        `    DataTemplate x:key="mm:${n.id}" [ DataType = MetaModelEntity ] {`,
        `        Border [ Background = @SurfaceContainerHigh, CornerRadius = 6, Padding = (8,6,8,6) ] {`,
        ...inner.map((l) => l.replace(/^        /, '            ').replace(/^            StackPanel/, '            StackPanel')),
        `        }`,
        `    }`,
    ].join('\n')
}

function escapeMu(s: string): string { return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') }
```

> Note for the implementer: the `inner.map(...)` re-indent above is fiddly; if it
> reads awkwardly, inline the Border+child construction directly per branch
> instead of sharing `inner`. The test only asserts on the emitted substrings
> (keys, `Text = "…"`, `Geometry = @mm_icon_…`), so exact indentation is free to
> choose — keep it readable.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/presentation-generator.test.ts`
Expected: PASS. Adjust the include-alignment assertion in the test if you choose
not to column-align (keep test + impl consistent).

- [ ] **Step 5: Commit**

```bash
git add -A src/renderer/src/modules/meta-model/services
git commit -m "feat(meta-model): generatePresentationMu emitter"
```

---

### Task 4: Presentation capability interface

**Files:**
- Modify: `src/renderer/src/services/projects/project-factory.ts`
- Test: (covered indirectly by Task 5; optional micro-test of the guard)

**Interfaces:**
- Produces: `interface IPresentationProjectFactory { regeneratePresentation(storage: IStorage): Promise<void> }`
  and `canGeneratePresentation(factory: IProjectFactory): factory is IProjectFactory & IPresentationProjectFactory`.

- [ ] **Step 1: Add the interface + guard (mirror `IPublishableProjectFactory`)**

```ts
// A factory that can (re)generate a presentation resource dictionary into the
// project from its compiled model. The explorer feature-tests with
// canGeneratePresentation before offering the command.
export interface IPresentationProjectFactory
{
    regeneratePresentation(storage: IStorage): Promise<void>
}

export function canGeneratePresentation(
    factory: IProjectFactory,
): factory is IProjectFactory & IPresentationProjectFactory
{
    return typeof (factory as Partial<IPresentationProjectFactory>).regeneratePresentation === 'function'
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck:web`
Expected: PASS (no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/services/projects/project-factory.ts
git commit -m "feat(projects): IPresentationProjectFactory capability + guard"
```

---

### Task 5: MetaModelProjectFactory — write + regenerate + publish hook

**Files:**
- Modify: `src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts`
- Test: `src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts`

**Interfaces:**
- Consumes: `generatePresentationMu` (Task 3), `IPresentationProjectFactory` (Task 4),
  `check`, `toJSON`, `Severity`, `TodlDocument` from `@pragmatic-tech-ai/todl`.
- Produces: `MetaModelProjectFactory.regeneratePresentation(storage): Promise<void>`;
  presentation written by `publish` too.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { MetaModelProjectFactory } from '../meta-model-project-factory.js'
import { PROJECT_MANIFEST_FILENAME } from '../../../../services/projects/project-factory.js'

function projectStorage(): FakeStorage {
    const s = new FakeStorage('fake://proj')
    void s.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'meta-model', name: 'M', version: 1, id: 'm', modelVersion: '0.1.0' }))
    // a minimal, valid meta-model: one concept
    void s.WriteText('concepts/actor.todl', 'namespace demo { concept actor { } }')
    // an author override file present under presentation/
    void s.WriteText('presentation/custom.mu', 'resources MetaModelPresentationCustom { }')
    return s
}

test('regeneratePresentation writes presentation.generated.mu with a template for the concept and an author merge', async () => {
    const provider = new ServiceProvider()
    const factory = new MetaModelProjectFactory(provider)
    const storage = projectStorage()

    await factory.regeneratePresentation(storage)

    const out = await storage.ReadText('presentation.generated.mu')
    expect(out).toContain('resources MetaModelPresentation {')
    expect(out).toContain('DataTemplate x:key="mm:actor"')
    expect(out).toContain('merge')   // an author dict under presentation/ was merged
})
```

> If `concept actor { }` is not by itself a publishable/clean TODL document,
> adjust the source to the smallest `check()`-clean meta-model (consult
> `todl-sources.ts` / an existing meta-model `src/` sample). The test's intent is
> only that a clean model yields a generated file with the concept's template.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts`
Expected: FAIL — no `regeneratePresentation`.

- [ ] **Step 3: Implement — add imports, capability, private writer, publish hook**

Add to the class declaration:

```ts
export class MetaModelProjectFactory extends ServiceBase
    implements IProjectFactory, IPublishableProjectFactory, IPresentationProjectFactory
```

Add imports:

```ts
import { generatePresentationMu } from './presentation-generator.js'
import type { TodlDocument } from '@pragmatic-tech-ai/todl'
// extend the existing project-factory import with IPresentationProjectFactory
```

Add the capability method + private writer, and the constants:

```ts
private static readonly PRESENTATION_FILE = 'presentation.generated.mu'
private static readonly PRESENTATION_DIR = 'presentation'

// Capability entry point (the "Generate Presentation" command): compile the
// project's .todl to a model, then write the presentation dictionary. Silently
// no-ops with no sources; surfaces TODL errors by leaving the file untouched.
public async regeneratePresentation(storage: IStorage): Promise<void>
{
    const sources = await collectTodlSources(storage)
    if (sources.length === 0) return
    const { model, diagnostics } = check(sources)
    if (diagnostics.some((d) => d.severity === Severity.Error)) return
    await this.writePresentation(storage, toJSON(model))
}

// Write presentation.generated.mu from an already-compiled document. Scans the
// presentation/ folder for author dictionaries to merge (by their resources
// block name). Shared by regeneratePresentation and publish (which passes its
// own compiled doc, avoiding a second compile).
private async writePresentation(storage: IStorage, doc: TodlDocument): Promise<void>
{
    const authorDicts = await this.scanAuthorDicts(storage)
    const source = generatePresentationMu(doc, authorDicts)
    await storage.WriteText(MetaModelProjectFactory.PRESENTATION_FILE, source)
}

// The `resources <Name> {` identifiers declared in presentation/*.mu, so the
// generated dictionary can `merge` each. Missing folder → []. Reads the first
// `resources <Name>` line of each .mu (one dictionary per file, by convention).
private async scanAuthorDicts(storage: IStorage): Promise<string[]>
{
    let entries: readonly { Name: string; IsDirectory: boolean }[]
    try { entries = await storage.List(MetaModelProjectFactory.PRESENTATION_DIR) }
    catch { return [] }
    const names: string[] = []
    for (const e of entries) {
        if (e.IsDirectory || !e.Name.endsWith('.mu')) continue
        const text = await storage.ReadText(`${MetaModelProjectFactory.PRESENTATION_DIR}/${e.Name}`)
        const m = /\bresources\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(text)
        if (m) names.push(m[1])
    }
    return names.sort()
}
```

Add the publish hook — inside `publish()`, right after `model.json` is written,
reusing the doc:

```ts
const doc = toJSON(model)
await dest.WriteText(`${base}/model.json`, JSON.stringify(doc, null, 2))
for (const s of sources) await dest.WriteText(`${base}/src/${s.uri}`, s.text)
await this.writePresentation(storage, doc)   // <-- add: regenerate into the project
```

(Replace the existing inline `toJSON(model)` on the `model.json` write with the
hoisted `doc` so both uses share one compile.)

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts`
Then: `npm run typecheck:web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/services
git commit -m "feat(meta-model): regeneratePresentation + publish writes presentation.generated.mu"
```

---

### Task 6: Project command — "Generate Presentation"

**Files:**
- Modify: `src/renderer/src/services/projects/open-project.ts`
- Modify: `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts`
- Modify: `src/renderer/src/modules/project-explorer/project-explorer.resources.mu` (+ `npm run compile:mu`)
- Test: `src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts`
  (add a wiring assertion)

**Interfaces:**
- Consumes: `canGeneratePresentation` (Task 4), `MetaModelProjectFactory.regeneratePresentation` (Task 5).
- Produces: `OpenProject.GeneratePresentationCommand` DP; a `$GeneratePresentationCommand` menu item.

- [ ] **Step 1: Add the DP on `OpenProject`** (mirror `PublishCommand`, `open-project.ts`)

```ts
static readonly GeneratePresentationCommandKey = Model.RegisterProperty<ICommand | undefined>(
    OpenProject, 'GeneratePresentationCommand', undefined, MetaData.None)
// ...
public get GeneratePresentationCommand(): ICommand | undefined { return this.get_property_value(OpenProject.GeneratePresentationCommandKey) }
public set GeneratePresentationCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.GeneratePresentationCommandKey, v) }
```

- [ ] **Step 2: Write the failing wiring test** (in the explorer service test)

```ts
// After opening a meta-model project through the service, its OpenProject should
// carry an enabled GeneratePresentationCommand. (Follow the existing test's setup
// for registering MetaModelProjectFactory + opening a project; assert:)
test('a meta-model project exposes an enabled Generate Presentation command', async () => {
    const { op } = await openMetaModelProject()   // per the file's existing helpers
    expect(op.GeneratePresentationCommand).toBeDefined()
    expect(op.GeneratePresentationCommand!.CanExecute()).toBe(true)
})
```

> Use the test file's existing harness for constructing the service + a
> meta-model `OpenProject`. If none exists, mirror the setup in
> `meta-model-project-factory.test.ts` (FakeStorage + factory) and the explorer
> test's provider wiring. Keep the assertion minimal (command present + enabled).

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts`
Expected: FAIL — command undefined.

- [ ] **Step 4: Wire the command + handler** in `project-explorer-service.ts`

In `wireProjectCommands(op)` (beside `PublishCommand`):

```ts
op.GeneratePresentationCommand = new RelayCommand(
    () => void this.generatePresentation(op),
    () => canGeneratePresentation(op.Factory))
```

Add the handler (mirror `publishProject`):

```ts
private async generatePresentation(op: OpenProject): Promise<void>
{
    if (!canGeneratePresentation(op.Factory)) { this.Status = "This project type has no presentation."; return }
    try {
        await op.Factory.regeneratePresentation(op.Storage)
        await this.rescan(op)   // show the (re)generated file in the tree
        this.Status = 'Presentation regenerated.'
    } catch (e) {
        this.Status = `Generate presentation failed: ${(e as Error).message}`
    }
}
```

Add `canGeneratePresentation` to the existing `project-factory.js` import.

- [ ] **Step 5: Add the menu item** in `project-explorer.resources.mu` (in `ProjectContextMenu`, after "Publish"):

```
        MenuItem [ Header = "Generate Presentation", Command = $GeneratePresentationCommand ]
```

Then recompile the markup:

Run: `npm run compile:mu`
Expected: compiles all `.mu` (including the edited one) with no error.

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run src/renderer/src/modules/project-explorer` and `npm run typecheck`
Expected: PASS. The new command test passes; nothing else regresses.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/services/projects/open-project.ts src/renderer/src/modules/project-explorer/services/project-explorer-service.ts src/renderer/src/modules/project-explorer/project-explorer.resources.mu
git commit -m "feat(meta-model): 'Generate Presentation' project command"
```

---

## Final verification

- [ ] `npm run typecheck` — clean.
- [ ] `npx vitest run` — full suite green (new tests included).
- [ ] `npm run compile:mu` — clean.
- [ ] Manual smoke (optional, needs a meta-model project open): right-click the
  project → **Generate Presentation** → `presentation.generated.mu` appears with
  a template per ontology entity; **Publish** also (re)writes it.

## Notes for the implementer

- The generated `.mu` references `DataType = MetaModelEntity` and is **not
  compiled** in this sub-project — that class and the compile step arrive in
  sub-projects 3 and 2. So running "Generate Presentation" now produces a scaffold
  file that Plexus does not yet load; that is expected.
- Keep the generator **pure and deterministic**; all model/FS access stays in the
  factory. This is what lets Task 3 be tested without a renderer or storage.
- Merge precedence (author-first vs author-last) is asserted only as "a `merge`
  line exists" here; the actual override-winning order is settled when sub-project
  2 compiles and loads the dictionary. If mural's merge turns out to be
  earlier-wins, flip the emit order of the merge block — the generator is the one
  place to change it.

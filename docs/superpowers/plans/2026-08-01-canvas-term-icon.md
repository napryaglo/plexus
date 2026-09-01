# Canvas Glyph from a Term's Icon Annotation — Implementation Plan (SP3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An architecture-canvas node whose referenced term/class carries an `icon` annotation renders that icon as its glyph, with no hand-written `visuals/<id>.mural`.

**Architecture:** The library bundle carries the term's annotation icon path (`deriveClasses` projects it; publish copies `resources/`); the loader surfaces it on `LoadedClass`; and `LibraryRegistry.refresh`, when a class has no authored template but has an icon, reads the bundled SVG, `parseSvgIcon`s it at runtime, and mounts an icon+label template built by `buildIconTemplate`. Authored templates win; a missing/unparseable SVG warns and falls back to the default box.

**Tech Stack:** TypeScript, Vitest, `@pragmatic-tech-ai/mural` (`basic`: `parseSvgIcon`, `Icon`, `IconDefinition`; `compiler`: `instantiate`), `FakeStorage`.

## Global Constraints

- A class/term node is Instance-tier with `attrs.class === true`; the annotation application node is `<id>@icon`, typeOf `icon`, with a scalar `path` attr, reached by an `Annotated` edge from the class node.
- Icon assets live under `resources/`; the annotation `path` is bundle-relative. Publish copies `resources/` into `<id>/<libVersion>/resources/…`.
- Precedence: an authored `visuals/<id>.mural` always wins; the icon only applies when there is no authored template.
- Consume TODL wire strings via local constants, not TODL enum imports.
- Tests live in `tests/` subfolders. Run one file: `npx vitest run <path>`. Typecheck: `npm run typecheck`.
- Never fatal: a missing/unparseable icon SVG produces a Problems-dock `warning` and the class stays on the default box.

---

### Task 1: Bundle carries the term icon

**Files:**
- Modify: `src/renderer/src/modules/library/services/library-bundle.ts` — `PublishedClass.icon`; `deriveClasses` projects it.
- Modify: `src/renderer/src/modules/library/services/library-project-factory.ts:128` — copy `resources/`.
- Test: `src/renderer/src/modules/library/services/tests/library-bundle.test.ts` (extend); `src/renderer/src/modules/library/services/tests/library-project-factory.test.ts` (extend).

**Interfaces:**
- Consumes: `projectAnnotations(doc, id): Record<string, Record<string, unknown>>` from `../../meta-model/services/annotation-projection.js`.
- Produces: `PublishedClass.icon?: string` — the annotation icon path, set when the class node has an `icon` annotation. Task 2 reads it off the serialized bundle class.

- [ ] **Step 1: Write the failing bundle test**

Add to `library-bundle.test.ts`:

```ts
test('derives the icon path from a class node icon annotation', () => {
    const model: TodlDocument = {
        nodes: [
            { id: 'location', tier: 'Ontology', typeOf: 'concept', attrs: {} },
            { id: 'microsoft', tier: 'Ontology', typeOf: 'taxonomy', attrs: {} },
            { id: 'microsoft.azure', tier: 'Instance', typeOf: 'location', attrs: { class: true, id: 'azure', label: 'Azure' } },
            { id: 'microsoft.azure@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/azure.svg' } },
        ],
        edges: [{ kind: 'Annotated', via: null, from: 'microsoft.azure', to: 'microsoft.azure@icon' }],
    }
    expect(deriveClasses(model)[0]).toEqual({
        id: 'microsoft.azure', localId: 'azure', label: 'Azure', concept: 'location', icon: 'resources/azure.svg',
    })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-bundle.test.ts`
Expected: FAIL — the derived class has no `icon` field.

- [ ] **Step 3: Add `icon` to `PublishedClass` + project it**

In `library-bundle.ts`, add to the `PublishedClass` interface (after `label?`):

```ts
    icon?:      string     // annotation icon path, e.g. "resources/azure.svg" (bundle-relative)
```

Add the import at the top:

```ts
import { projectAnnotations } from '../../meta-model/services/annotation-projection.js'
```

In `deriveClasses`, after the `label` line, project the icon:

```ts
        if (typeof n.attrs.label === 'string') cls.label = n.attrs.label
        const iconPath = projectAnnotations(model, n.id).icon?.path
        if (typeof iconPath === 'string') cls.icon = iconPath
        out.push(cls)
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-bundle.test.ts`
Expected: PASS (the existing exact-match tests still pass — a class with no icon annotation gets no `icon` key).

- [ ] **Step 5: Write the failing publish-copy test**

Add to `library-project-factory.test.ts`:

```ts
test('publish copies the resources/ folder into the bundle', async () => {
  const storage = new FakeStorage('fake://Acme')
  const f = factory()
  await f.createProject(storage, 'microsoft', { metaModel: { id: 'ea', version: '5' } })
  await storage.WriteText('microsoft.todl', LIB)
  await storage.WriteText('resources/azure.svg', '<svg viewBox="0 0 10 10"><path d="M0 0 L10 0 L10 10 Z"/></svg>')
  const { provider, meta, libs } = publishEnv()
  await seedMeta(meta)

  const result = await f.publish(await f.openProject(storage), storage, provider)
  expect(result.ok).toBe(true)
  expect(await libs.Exists('microsoft/0.1.0/resources/azure.svg')).toBe(true)
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-project-factory.test.ts`
Expected: FAIL — `resources/azure.svg` is not copied into the bundle.

- [ ] **Step 7: Copy `resources/` on publish**

In `library-project-factory.ts`, the folder list (line ~128):

```ts
        for (const folder of ['visuals', 'assets', 'docs', 'samples', 'thumbnails'])
```

becomes:

```ts
        for (const folder of ['visuals', 'assets', 'docs', 'samples', 'thumbnails', 'resources'])
```

- [ ] **Step 8: Run it to verify it passes + typecheck**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-project-factory.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/modules/library/services/library-bundle.ts src/renderer/src/modules/library/services/library-project-factory.ts src/renderer/src/modules/library/services/tests/library-bundle.test.ts src/renderer/src/modules/library/services/tests/library-project-factory.test.ts
git commit -m "feat(library): carry a term's icon annotation into the bundle + copy resources/"
```

---

### Task 2: Loader surfaces the icon + reads the SVG

**Files:**
- Modify: `src/renderer/src/modules/library/services/library-loader.ts` — `LoadedClass.icon`; copy it in `loadLibrary`; add `readIconSource`.
- Test: `src/renderer/src/modules/library/services/tests/library-loader.test.ts` (extend).

**Interfaces:**
- Consumes: `PublishedClass.icon` (Task 1), serialized into `library.json`.
- Produces: `LoadedClass.icon?: string`; `readIconSource(backend, lib, cls): Promise<string | undefined>` — reads `${lib.id}/${lib.version}/${cls.icon}`, undefined on absence/unreadable.

- [ ] **Step 1: Write the failing test**

Add to `library-loader.test.ts` (it already imports `loadLibrary`/`FakeStorage`; add `readIconSource` to the import from `../library-loader.js`):

```ts
test('a class icon path surfaces on the LoadedClass', async () => {
    const s = new FakeStorage('fake://libraries')
    await s.WriteText('microsoft/0.1.0/library.json', JSON.stringify({
        id: 'microsoft', version: '0.1.0', name: 'microsoft', metaModel: { id: 'ea', version: '5' },
        classes: [{ id: 'microsoft.azure', concept: 'location', icon: 'resources/azure.svg' }],
    }))
    const lib = await loadLibrary(s, 'microsoft', '0.1.0')
    expect(lib.classes[0]!.icon).toBe('resources/azure.svg')
})

test('readIconSource reads a class icon SVG, undefined when absent', async () => {
    const s = new FakeStorage('fake://libraries')
    await s.WriteText('microsoft/0.1.0/resources/azure.svg', '<svg/>')
    const lib = { id: 'microsoft', version: '0.1.0', name: 'm', metaModel: { id: 'ea', version: '5' }, classes: [], problems: [] }
    expect(await readIconSource(s, lib, { id: 'microsoft.azure', concept: 'location', icon: 'resources/azure.svg' })).toBe('<svg/>')
    expect(await readIconSource(s, lib, { id: 'x', concept: 'location' })).toBeUndefined()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-loader.test.ts`
Expected: FAIL — `icon` is undefined on the LoadedClass; `readIconSource` is not exported.

- [ ] **Step 3: Add `icon` to `LoadedClass` + the manifest type**

In `library-loader.ts`, add to `LoadedClass` (after `label?`):

```ts
    icon?:         string
```

Widen the `manifest.classes` element type in `loadLibrary` (add `icon?: string`):

```ts
        classes: Array<{ id: string; localId?: string; label?: string; concept: string; template?: string; thumbnail?: string; doc?: string; icon?: string }>
```

- [ ] **Step 4: Copy `icon` in the class loop**

In `loadLibrary`, inside the `for (const c of manifest.classes ?? [])` loop, after the `label` copy:

```ts
        if (c.label !== undefined) cls.label = c.label
        if (c.icon !== undefined) cls.icon = c.icon
```

(No on-disk existence check — the registry reads it lazily and degrades to a warning.)

- [ ] **Step 5: Add `readIconSource`**

At the end of `library-loader.ts`, mirroring `readTemplateSource`:

```ts
// Read a class's icon SVG source on demand; undefined if absent/unreadable.
export async function readIconSource(backend: IStorage, lib: LoadedLibrary, cls: LoadedClass): Promise<string | undefined>
{
    if (cls.icon === undefined) return undefined
    try { return await backend.ReadText(`${lib.id}/${lib.version}/${cls.icon}`) }
    catch { return undefined }
}
```

- [ ] **Step 6: Run it to verify it passes + typecheck**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-loader.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/modules/library/services/library-loader.ts src/renderer/src/modules/library/services/tests/library-loader.test.ts
git commit -m "feat(library): surface a class icon path on LoadedClass + readIconSource"
```

---

### Task 3: Registry mounts an icon template

**Files:**
- Modify: `src/renderer/src/modules/library/services/visual-library.ts` — `buildIconTemplate` + `findIcon`.
- Modify: `src/renderer/src/modules/library/services/library-registry.ts` — icon fallback in `refresh`.
- Test: `src/renderer/src/modules/library/services/tests/visual-library.test.ts` (create/extend); `src/renderer/src/modules/library/services/tests/library-registry.test.ts` (extend).

**Interfaces:**
- Consumes: `readIconSource` (Task 2); `parseSvgIcon`, `Icon`, `IconDefinition` from `@pragmatic-tech-ai/mural/basic`; existing `buildCtx`, `compileTemplate`, `readTemplateSource`.
- Produces: `buildIconTemplate(iconDef: IconDefinition, ctx: Record<string, unknown>): DataTemplate`.

- [ ] **Step 1: Write the failing visual-library test**

Create `src/renderer/src/modules/library/services/tests/visual-library.test.ts`:

```ts
import { test, expect } from 'vitest'
import { parseSvgIcon, Icon } from '@pragmatic-tech-ai/mural/basic'
import type { Visual } from '@pragmatic-tech-ai/mural/runtime'

import { buildCtx, buildIconTemplate } from '../visual-library.js'

const SVG = '<svg viewBox="0 0 10 10"><path d="M0 0 L10 0 L10 10 Z"/></svg>'

function findIcon(v: Visual): Icon | undefined {
    if (v instanceof Icon) return v
    for (const c of [...v.logicalChildren, ...v.visualChildren]) {
        const f = findIcon(c)
        if (f !== undefined) return f
    }
    return undefined
}

test('buildIconTemplate applies a tree containing an Icon with the given Source', () => {
    const ctx = buildCtx()
    const iconDef = parseSvgIcon(SVG)
    const v = buildIconTemplate(iconDef, ctx).Apply({ Display: 'Azure' }) as Visual
    const icon = findIcon(v)
    expect(icon).toBeDefined()
    expect(icon!.Source).toBe(iconDef)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/visual-library.test.ts`
Expected: FAIL — `buildIconTemplate` is not exported.

- [ ] **Step 3: Add `buildIconTemplate`**

In `visual-library.ts`, `Visual`, `DataTemplate`, `DataTemplateFactory`, and `instantiate` are already imported. Add only `Icon` / `IconDefinition` by extending the existing basic import line:

```ts
import { DataTemplate, type DataTemplateFactory, Icon, type IconDefinition } from '@pragmatic-tech-ai/mural/basic'
```

Append:

```ts
// An icon+label template for a class with an `icon` annotation but no authored
// `.mural`. The chrome + `$Display` label compile through the same fragment path
// as the default; the parsed IconDefinition (fixed per class) is set onto the one
// Icon element after the tree is built (found by a visual-tree walk), so no
// per-instance binding is needed for it.
const ICON_SOURCE =
      'Border [ Background = @SurfaceContainerHigh, CornerRadius = 6, Padding = (10,6,10,6) ] {'
    + ' StackPanel [ Orientation = Horizontal ] {'
    + '  Icon [ Foreground = @OnSurface, Width = 16, Height = 16, Margin = (0,0,6,0) ]'
    + '  TextBlock [ Text = $Display, Foreground = @OnSurface ] } }'

export function buildIconTemplate(iconDef: IconDefinition, ctx: Record<string, unknown>): DataTemplate
{
    const factory = instantiate(ICON_SOURCE, ctx) as () => Visual
    const wrapped: DataTemplateFactory = (data) => {
        const v = factory() as Visual & { DataContext: unknown }
        v.DataContext = data
        const icon = findIcon(v)
        if (icon !== undefined) icon.Source = iconDef
        return v
    }
    return new DataTemplate(wrapped)
}

// First Icon in the visual tree (depth-first over logical + visual children).
function findIcon(v: Visual): Icon | undefined
{
    if (v instanceof Icon) return v
    for (const c of [...v.logicalChildren, ...v.visualChildren]) {
        const f = findIcon(c)
        if (f !== undefined) return f
    }
    return undefined
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/visual-library.test.ts`
Expected: PASS. (If `instantiate` rejects `Width`/`Height` on `Icon`, drop them from `ICON_SOURCE` — the Icon sizes to its view-box — and re-run.)

- [ ] **Step 5: Write the failing registry test**

Add to `library-registry.test.ts` (reuses the file's `env` helper):

```ts
const SVG = '<svg viewBox="0 0 10 10"><path d="M0 0 L10 0 L10 10 Z"/></svg>'

function iconManifest(icon: string, template?: string): string {
    const cls: Record<string, unknown> = { id: 'microsoft.azure', localId: 'azure', label: 'Azure', concept: 'location', icon }
    if (template !== undefined) cls.template = template
    return JSON.stringify({ id: 'microsoft', version: '0.1.0', name: 'microsoft', metaModel: { id: 'ea', version: '5' }, classes: [cls], assets: [], docs: [], samples: [] })
}

test('a class with an icon annotation and no template mounts an icon template (non-default)', async () => {
    const { provider } = env((b) => {
        void b.WriteText('microsoft/0.1.0/library.json', iconManifest('resources/azure.svg'))
        void b.WriteText('microsoft/0.1.0/resources/azure.svg', SVG)
    })
    const reg = new LibraryRegistry(provider)
    await reg.refresh()
    expect(reg.resolve('microsoft.azure', 'location')).not.toBe(reg.resolve('missing', 'x'))
})

test('an authored template wins over an icon annotation', async () => {
    const { provider, diagnostics } = env((b) => {
        void b.WriteText('microsoft/0.1.0/library.json', iconManifest('resources/broken.svg', 'visuals/microsoft.azure.mural'))
        void b.WriteText('microsoft/0.1.0/visuals/microsoft.azure.mural', 'TextBlock [ Text = $Display ]')
        void b.WriteText('microsoft/0.1.0/resources/broken.svg', 'not an svg')
    })
    const reg = new LibraryRegistry(provider)
    await reg.refresh()
    // authored path taken → non-default, and the broken icon was never parsed (no warning about it)
    expect(reg.resolve('microsoft.azure', 'location')).not.toBe(reg.resolve('missing', 'x'))
    expect([...diagnostics.All].some((d) => d.uri === 'resources/broken.svg')).toBe(false)
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-registry.test.ts`
Expected: FAIL — the icon class falls back to the default (no icon template mounted yet).

- [ ] **Step 7: Wire the icon fallback into `refresh`**

In `library-registry.ts`, extend the imports:

```ts
import { discoverLibraries, readTemplateSource, readIconSource, type LoadedLibrary, type LoadProblem } from './library-loader.js'
import { buildCtx, compileTemplate, buildDefaultTemplate, buildIconTemplate } from './visual-library.js'
import { parseSvgIcon } from '@pragmatic-tech-ai/mural/basic'
```

Replace the class loop body in `refresh` (the `const source = …` block through its `try/catch`):

```ts
            for (const cls of lib.classes) {
                const source = await readTemplateSource(backend, lib, cls)
                if (source !== undefined) {
                    try {
                        this.libraryVisuals.Set(cls.id, compileTemplate(source, this.ctx))
                    } catch (e) {
                        problems.push({ severity: 'error', uri: cls.templatePath ?? null,
                                        message: `Template for ${cls.id} failed to compile: ${(e as Error).message}` })
                    }
                    continue
                }
                if (cls.icon !== undefined) {
                    const svg = await readIconSource(backend, lib, cls)
                    if (svg === undefined) {
                        problems.push({ severity: 'warning', uri: cls.icon, message: `Icon asset is missing: ${cls.icon}` })
                        continue
                    }
                    try {
                        this.libraryVisuals.Set(cls.id, buildIconTemplate(parseSvgIcon(svg), this.ctx))
                    } catch (e) {
                        problems.push({ severity: 'warning', uri: cls.icon,
                                        message: `Icon ${cls.icon} failed to parse: ${(e as Error).message}` })
                    }
                }
            }
```

- [ ] **Step 8: Run it to verify it passes + full library suite + typecheck**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/library-registry.test.ts`
Expected: PASS.
Run: `npx vitest run src/renderer/src/modules/library`
Expected: PASS.
Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/modules/library/services/visual-library.ts src/renderer/src/modules/library/services/library-registry.ts src/renderer/src/modules/library/services/tests/visual-library.test.ts src/renderer/src/modules/library/services/tests/library-registry.test.ts
git commit -m "feat(library): mount an icon template for a class with an icon annotation"
```

---

## Notes for the implementer

- The runtime SVG→glyph path is `parseSvgIcon(svgText): IconDefinition` + the `Icon` element, both from `@pragmatic-tech-ai/mural/basic`. No compile-time SVG step.
- `buildIconTemplate` reuses the fragment compile path (so `$Display` and theme resources behave exactly like the default template) and only sets the constant `Icon.Source` by walking the built tree via `Visual.logicalChildren` / `visualChildren`. `instanceof Icon` matches because the fragment's `ctx` (`buildCtx()`) and the import are the same `Icon` class.
- Precedence lives entirely in `refresh`: authored template first (`continue`), icon second, default otherwise. Do not touch `resolve` or the default template.
- A library published before this change carries no `icon`; it must be republished. Expected, not a bug.

# Wiki Annotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `wiki` TODL annotation that attaches a Markdown `.md` page to a concept, plus an "Open Wiki" action on four Plexus surfaces (architecture canvas node, toolbox tile, Meta-models panel entity, library tile) that opens that `.md` in a Monaco tab.

**Architecture:** `annotation wiki { path : string?; }` in TODL's prelude (auto-resolvable as `<concept>@wiki`, no machinery changes). One `WikiLocator` probes **open** projects' own sources to resolve a concept → `{ root, relPath }` (the declaring meta-model/library, not a consuming architecture). One `WikiService` exposes `hasWiki(concept): Promise<boolean>` (visibility, via the locator so the item shows exactly when openable) and `OpenWikiCommand` (opens `join(root, relPath)` via `CodeEditorService`). Each surface VM gains `Concept` + `HasWiki` DPs and a shared `when ($HasWiki = true) { ContextMenuService.ContextMenu = @OpenWikiMenu }` trigger.

**Tech Stack:** TypeScript (TODL package + Plexus renderer), `@pragmatic-tech-ai/todl` (`ModelDraft`, `Repository`, `parse`, `SourceFile`), mural runtime/framework (`Model`/`RegisterProperty`, `RelayCommand`, `ServiceBase`, `ContextMenuService`), mural `.mu` CLI, vitest, node:test (TODL).

## Global Constraints

- Every test file lives in a `tests/` subfolder next to the code it exercises (both repos).
- Enums over string-literal unions; no `type X = 'a'|'b'`.
- Renderer: no `node:fs`/`node:path` — build paths with the local `join` helper (separator inferred from the directory), read/write via `FileSystemService`.
- TODL tests run with `--test-force-exit`.
- Publishing `@pragmatic-tech-ai/todl` and `@pragmatic-tech-ai/mural` goes ONLY to the local Verdaccio (`http://localhost:4873`), never public npm. Never commit `.npmrc`/secrets.
- Approach A (source-only): wiki resolves only when the concept's declaring project is open in the workspace. A closed declaring project / missing file is a normal, handled outcome (no menu item / a status line), never a crash.
- The wiki annotation is plain (`{ path : string?; }`), NOT `: MuralResource` — it is never baked into published presentation.
- Commit after each task with the given message. Do NOT push (the user pushes explicitly). Branch off `main`/current branch first if on a default branch.

---

### Task 1: TODL `wiki` annotation + publish

Declare the annotation in the prelude and publish TODL to Verdaccio; bump Plexus's dependency.

**Files:**
- Modify: `TODL/src/stdlib/prelude.todl`
- Test: `TODL/src/stdlib/tests/prelude-wiki.test.ts`
- Modify (version): `TODL/package.json`
- Modify (dep): `Plexus/package.json`

**Interfaces:**
- Produces: a resolvable annotation node `\`${concept}@wiki\`` whose `path` attribute is the string authored in `annotate wiki { path = "..."; }`. Read via `repo.resolve(\`${concept}@wiki\`)?.attrs.get('path')`.

- [ ] **Step 1: Write the failing test**

Create `TODL/src/stdlib/tests/prelude-wiki.test.ts` (mirror `prelude-iconsource.test.ts`'s harness — check that file for the exact `load`/`Repository` imports and adapt):

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { load, toJSON, Repository, graphFromJSON } from '@pragmatic-tech-ai/todl'

// A concept carrying a wiki annotation resolves `<concept>@wiki`.path.
const SRC = `namespace demo {
  concept service { annotate wiki { path = "wiki/service.md"; } }
}`

test('wiki annotation is declared in the prelude and resolves path', () => {
    const repo = new Repository(graphFromJSON(toJSON(load([{ uri: 'm.todl', text: SRC }]).model)))
    assert.equal(repo.resolve('service@wiki')?.attrs.get('path'), 'wiki/service.md')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd TODL && npx tsx --conditions=development --test --test-force-exit src/stdlib/tests/prelude-wiki.test.ts`
Expected: FAIL — `wiki` is not a declared annotation, so loading reports an unknown-annotation diagnostic and/or `service@wiki` does not resolve.

(If the harness in `prelude-iconsource.test.ts` differs — e.g. a `check()` helper — copy that exact shape instead; the assertion on `resolve('service@wiki')?.attrs.get('path')` stays.)

- [ ] **Step 3: Declare the annotation**

In `TODL/src/stdlib/prelude.todl`, add the `wiki` line directly after the `iconSource` declaration (inside `namespace todl { ... }`):

```todl
    annotation wiki { path : string?; }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd TODL && npx tsx --conditions=development --test --test-force-exit src/stdlib/tests/prelude-wiki.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full TODL suite**

Run: `cd TODL && npm test`
Expected: all green (the new annotation is additive; no existing corpus uses `wiki`).

- [ ] **Step 6: Publish TODL to Verdaccio + bump Plexus**

```bash
cd TODL
npm version minor --no-git-tag-version   # e.g. 0.29.0 -> 0.30.0
npm publish                              # prepublishOnly builds; publishConfig → localhost:4873
```
Note the new version (call it `<TODL_VERSION>`). Then in `Plexus/package.json` set `"@pragmatic-tech-ai/todl": "^<TODL_VERSION>"` and:
```bash
cd Plexus && npm install @pragmatic-tech-ai/todl@<TODL_VERSION>
```
Verify: `grep '"version"' Plexus/node_modules/@pragmatic-tech-ai/todl/package.json` shows `<TODL_VERSION>`.

- [ ] **Step 7: Commit (two repos)**

```bash
cd TODL && git add src/stdlib/prelude.todl src/stdlib/tests/prelude-wiki.test.ts package.json \
  && git commit -m "feat(prelude): add wiki annotation (path to a markdown page)"
cd Plexus && git add package.json package-lock.json \
  && git commit -m "chore: bump todl to <TODL_VERSION> for the wiki annotation"
```

---

### Task 2: `WikiLocator` — concept → declaring open project

Resolve a concept to `{ root, relPath }` by probing each open project's own source (the meta-model/library that declares it). An architecture project's own source (instances) does not declare a concept, so it is skipped; the meta-model whose source declares `concept X { annotate wiki { path } }` matches.

**Files:**
- Create: `Plexus/src/renderer/src/services/wiki/wiki-locator.ts`
- Test: `Plexus/src/renderer/src/services/wiki/tests/wiki-locator.test.ts`

**Interfaces:**
- Consumes: `ProjectExplorerService.Key` → `.OpenProjects: ObservableCollection<OpenProject>`; `OpenProject.Project.RootPath: string`, `OpenProject.Project.Name: string`, `OpenProject.Storage: IStorage`; `collectTodlSources(storage): Promise<SourceFile[]>` from `../../modules/meta-model/services/todl-sources.js`; `ModelDraft.fromSources(baseRepos, sources, { namespace })`, `parse`, `type SourceFile` from `@pragmatic-tech-ai/todl`.
- Produces:
  - `class WikiLocator` with `constructor(provider: IServiceProvider)`
  - `resolveWiki(concept: string): Promise<{ root: string; relPath: string } | undefined>`

- [ ] **Step 1: Write the failing test**

Create `Plexus/src/renderer/src/services/wiki/tests/wiki-locator.test.ts`:

```ts
import { test, expect } from 'vitest'
import { ServiceProvider, ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'
import { ProjectExplorerService } from '../../../modules/project-explorer/services/project-explorer-service.js'
import { WikiLocator } from '../wiki-locator.js'

// A fake OpenProject: its Storage yields one .todl source (its own model text).
function fakeProject(root: string, name: string, todl: string): unknown {
    const storage = {
        // collectTodlSources reads the storage; the minimal surface it needs is a
        // directory walk returning .todl files. Model the two calls it makes.
        ListDirectory: () => Promise.resolve([{ Name: 'model.todl', IsDirectory: false }]),
        ReadText: () => Promise.resolve(todl),
    }
    return { Project: { RootPath: root, Name: name }, Storage: storage }
}

function locatorWith(...projects: unknown[]): WikiLocator {
    const explorer = { OpenProjects: new ObservableCollection(projects) } as unknown as ProjectExplorerService
    const provider = new ServiceProvider()
    provider.registerInstance(ProjectExplorerService.Key, explorer)
    return new WikiLocator(provider)
}

const MM = `namespace mm { concept service { annotate wiki { path = "wiki/service.md"; } } }`
const ARCH = `namespace app { import mm; model M conforms mm.Model { service s1 {} } }`

test('resolves a concept declared in an open meta-model project', async () => {
    const loc = locatorWith(fakeProject('/mm', 'mm', MM), fakeProject('/app', 'app', ARCH))
    expect(await loc.resolveWiki('service')).toEqual({ root: '/mm', relPath: 'wiki/service.md' })
})

test('returns undefined when no open project declares the concept', async () => {
    const loc = locatorWith(fakeProject('/app', 'app', ARCH))
    expect(await loc.resolveWiki('service')).toBeUndefined()
})

test('returns undefined for a concept without a wiki annotation', async () => {
    const bare = `namespace mm { concept widget {} }`
    const loc = locatorWith(fakeProject('/mm', 'mm', bare))
    expect(await loc.resolveWiki('widget')).toBeUndefined()
})
```

Before implementing, open `Plexus/src/renderer/src/modules/meta-model/services/todl-sources.ts` and confirm the exact `IStorage` methods `collectTodlSources` calls; make the fake `storage` above implement exactly those (adjust `ListDirectory`/`ReadText` names/shape to match). If `collectTodlSources` needs more surface, extend the fake — do not change production code to fit the test.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/services/wiki/tests/wiki-locator.test.ts`
Expected: FAIL — `../wiki-locator.js` does not exist.

- [ ] **Step 3: Implement `WikiLocator`**

Create `Plexus/src/renderer/src/services/wiki/wiki-locator.ts`:

```ts
import { type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ModelDraft, parse, type SourceFile } from '@pragmatic-tech-ai/todl'

import { ProjectExplorerService } from '../../modules/project-explorer/services/project-explorer-service.js'
import { collectTodlSources } from '../../modules/meta-model/services/todl-sources.js'

// Resolves a concept to the wiki page declared with it, by probing OPEN
// projects' own source. Only the project that DECLARES the concept
// (`concept X { annotate wiki { path } }`) resolves `X@wiki`; a consuming
// architecture project's own source (instances) does not, so it is skipped.
// Approach A: unresolved (declaring project not open) is a normal `undefined`.
export class WikiLocator
{
    public constructor(private readonly provider: IServiceProvider) {}

    // { root, relPath } for the open project declaring `concept`, else undefined.
    public async resolveWiki(concept: string): Promise<{ root: string; relPath: string } | undefined>
    {
        const explorer = this.provider.get(ProjectExplorerService.Key)
        if (explorer === undefined) return undefined
        for (const op of explorer.OpenProjects.ToArray()) {
            let relPath: string | undefined
            try {
                const sources = await collectTodlSources(op.Storage)
                const repo = ModelDraft.fromSources([], sources, { namespace: namespaceOf(sources, op.Project.Name) }).model
                const v = repo.resolve(`${concept}@wiki`)?.attrs.get('path')
                relPath = typeof v === 'string' && v.length > 0 ? v : undefined
            } catch {
                relPath = undefined   // a source that won't parse in isolation → not this project
            }
            if (relPath !== undefined) return { root: op.Project.RootPath, relPath }
        }
        return undefined
    }
}

// The namespace the first source declares (fromSources partitions "own"
// instances by it); irrelevant to concept resolution but kept faithful.
function namespaceOf(sources: readonly SourceFile[], fallback: string): string
{
    const first = sources[0]
    if (first === undefined) return fallback
    try { return parse(first.text, first.uri).namespace.path || fallback } catch { return fallback }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/services/wiki/tests/wiki-locator.test.ts`
Expected: PASS (3 tests). If `ModelDraft.fromSources([], sources, …)` throws on the isolated meta-model source (e.g. an unresolved prelude type), the `catch` yields `undefined` and the first test fails — in that case pass the prelude as a base: import the prelude repo the same way `check`/`checkAgainst` do (inspect `TODL` exports for a `preludeRepository()`/`PRELUDE` helper) and pass `[prelude]` instead of `[]`. Adjust and re-run.

- [ ] **Step 5: Commit**

```bash
cd Plexus && git add src/renderer/src/services/wiki/wiki-locator.ts src/renderer/src/services/wiki/tests/wiki-locator.test.ts \
  && git commit -m "feat(wiki): WikiLocator resolves a concept to its open project's wiki page"
```

---

### Task 3: `WikiService` + `@OpenWikiMenu` + registration

The service surfaces `hasWiki` (visibility) and `OpenWikiCommand` (open), the shared context menu, and app-wiring.

**Files:**
- Create: `Plexus/src/renderer/src/services/wiki/wiki-service.ts`
- Create: `Plexus/src/renderer/src/services/wiki/wiki.resources.mu`
- Test: `Plexus/src/renderer/src/services/wiki/tests/wiki-service.test.ts`
- Modify: `Plexus/src/renderer/src/app.mu`
- Modify (compile list): `Plexus/package.json` (`compile:mu` script)

**Interfaces:**
- Consumes: `WikiLocator` (Task 2); `FileSystemService.Key` → `Exists(path): Promise<boolean>`; `CodeEditorService.Key` → `OpenFile(path): void`; `RelayCommand`, `ICommand`, `Model`/`RegisterProperty`.
- Produces:
  - `class WikiService extends ServiceBase` with `static Key`
  - `hasWiki(concept: string): Promise<boolean>`
  - `OpenWikiCommand: ICommand` (DP; `CommandParameter` = concept string)
  - `Status: string` (DP; last user-facing status/reason)
  - `openWiki(concept: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `Plexus/src/renderer/src/services/wiki/tests/wiki-service.test.ts`:

```ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { FileSystemService } from '../../file-system/file-system-service.js'
import { CodeEditorService } from '../../../modules/code-editor/code-editor-service.js'
import { WikiLocator } from '../wiki-locator.js'
import { WikiService } from '../wiki-service.js'

function svc(opts: {
    resolve?: { root: string; relPath: string }
    exists?: boolean
}): { wiki: WikiService; opened: string[] } {
    const opened: string[] = []
    const provider = new ServiceProvider()
    provider.registerInstance(FileSystemService.Key, {
        Exists: () => Promise.resolve(opts.exists ?? true),
    } as unknown as FileSystemService)
    provider.registerInstance(CodeEditorService.Key, {
        OpenFile: (p: string) => { opened.push(p) },
    } as unknown as CodeEditorService)
    provider.registerInstance(WikiLocator.Key, {
        resolveWiki: () => Promise.resolve(opts.resolve),
    } as unknown as WikiLocator)
    return { wiki: new WikiService(provider), opened }
}

test('openWiki opens join(root, relPath) when it resolves and exists', async () => {
    const { wiki, opened } = svc({ resolve: { root: '/mm', relPath: 'wiki/service.md' }, exists: true })
    await wiki.openWiki('service')
    expect(opened).toEqual(['/mm/wiki/service.md'])
})

test('openWiki is a no-op with a status when the concept does not resolve', async () => {
    const { wiki, opened } = svc({ resolve: undefined })
    await wiki.openWiki('service')
    expect(opened).toEqual([])
    expect(wiki.Status.length).toBeGreaterThan(0)
})

test('openWiki is a no-op with a status when the file is missing', async () => {
    const { wiki, opened } = svc({ resolve: { root: '/mm', relPath: 'wiki/service.md' }, exists: false })
    await wiki.openWiki('service')
    expect(opened).toEqual([])
    expect(wiki.Status.length).toBeGreaterThan(0)
})

test('hasWiki reflects whether the concept resolves', async () => {
    expect(await svc({ resolve: { root: '/mm', relPath: 'w.md' } }).wiki.hasWiki('service')).toBe(true)
    expect(await svc({ resolve: undefined }).wiki.hasWiki('service')).toBe(false)
})
```

This test requires `WikiLocator` to be resolvable by key — add `static readonly Key` to `WikiLocator` in Task 2's file if not present (do it now: `public static readonly Key = new ServiceKey<WikiLocator>('WikiLocator')`, importing `ServiceKey`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/services/wiki/tests/wiki-service.test.ts`
Expected: FAIL — `../wiki-service.js` does not exist (and `WikiLocator.Key` if not yet added).

- [ ] **Step 3: Add `WikiLocator.Key` and implement `WikiService`**

In `wiki-locator.ts` add the import + key:
```ts
import { ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
// ...
export class WikiLocator
{
    public static readonly Key = new ServiceKey<WikiLocator>('WikiLocator')
    public constructor(private readonly provider: IServiceProvider) {}
    // ... unchanged
}
```

Create `Plexus/src/renderer/src/services/wiki/wiki-service.ts`:

```ts
import {
    MetaData, Model, RelayCommand, ServiceBase, ServiceKey,
    type ICommand, type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'

import { FileSystemService } from '../file-system/file-system-service.js'
import { CodeEditorService } from '../../modules/code-editor/code-editor-service.js'
import { WikiLocator } from './wiki-locator.js'

// Opens a concept's wiki page. Visibility (hasWiki) and open both go through
// WikiLocator, so "Open Wiki" shows exactly when the page is openable (its
// declaring project is open). Approach A: a closed declaring project or a
// missing file sets Status and no tab is opened.
export class WikiService extends ServiceBase
{
    public static readonly Key = new ServiceKey<WikiService>('WikiService')

    public static readonly StatusKey = Model.RegisterProperty<string>(
        WikiService, 'Status', '', MetaData.None)
    public static readonly OpenWikiCommandKey = Model.RegisterProperty<ICommand>(
        WikiService, 'OpenWikiCommand', undefined as unknown as ICommand, MetaData.None)

    public constructor(provider: IServiceProvider)
    {
        super(provider)
        this.set_property_value(WikiService.OpenWikiCommandKey,
            new RelayCommand((p) => { void this.openWiki(String(p ?? '')) }))
    }

    public get Status(): string { return this.get_property_value(WikiService.StatusKey) }
    private set Status(v: string) { this.set_property_value(WikiService.StatusKey, v) }
    public get OpenWikiCommand(): ICommand { return this.get_property_value(WikiService.OpenWikiCommandKey) }

    private get locator(): WikiLocator { return this.Provider.getRequired(WikiLocator.Key) }

    // True when the concept has an openable wiki page (its declaring project is
    // open). Drives each surface's "Open Wiki" menu-item visibility.
    public async hasWiki(concept: string): Promise<boolean>
    {
        if (concept.length === 0) return false
        return (await this.locator.resolveWiki(concept)) !== undefined
    }

    // Resolve + open the concept's wiki .md as a Monaco tab, or set Status.
    public async openWiki(concept: string): Promise<void>
    {
        const hit = concept.length > 0 ? await this.locator.resolveWiki(concept) : undefined
        if (hit === undefined) {
            this.Status = `Open the project that declares "${concept}" to view its wiki.`
            return
        }
        const abs = join(hit.root, hit.relPath)
        const fs = this.Provider.getRequired(FileSystemService.Key)
        if (!(await fs.Exists(abs))) {
            this.Status = `Wiki file not found: ${hit.relPath}`
            return
        }
        this.Provider.getRequired(CodeEditorService.Key).OpenFile(abs)
        this.Status = ''
    }
}

// Join a directory and a relative child using the directory's own separator
// (no node:path in the renderer). Mirrors open-projects-store.join.
function join(dir: string, rel: string): string
{
    const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
    const d = dir.endsWith(sep) ? dir.slice(0, -1) : dir
    return d + sep + rel.replace(/[\\/]+/g, sep)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/services/wiki/tests/wiki-service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Create the shared context menu resource**

Create `Plexus/src/renderer/src/services/wiki/wiki.resources.mu`:

```
// wiki.resources.mu — the shared "Open Wiki" context menu, attached by four
// surfaces (canvas node, toolbox tile, meta-model entity, library class) via a
// `when ($HasWiki = true)` trigger. The MenuItem's DataContext is the row VM, so
// $Concept resolves against it; $service(WikiService) resolves the app service.

import WikiService from "./wiki-service.js"

resources WikiResources {
    ContextMenu x:key="OpenWikiMenu" {
        MenuItem [ Header = "Open Wiki",
                   Command = $service(WikiService).OpenWikiCommand,
                   CommandParameter = $Concept ]
    }
}
```

- [ ] **Step 6: Register the service + locator and merge the resources in `app.mu`**

In `Plexus/src/renderer/src/app.mu`:
- Add imports near the other service imports:
  ```
  import WikiLocator from "./services/wiki/wiki-locator.js"
  import WikiService from "./services/wiki/wiki-service.js"
  import WikiResources from "./services/wiki/wiki.resources.mu.js"
  ```
- In the `.services:` block (after `CodeEditorService`), add:
  ```
  WikiLocator
  WikiService
  ```
- In the `resources: {` block (near the other `merge` lines), add:
  ```
  merge WikiResources
  ```

- [ ] **Step 7: Add `wiki.resources.mu` to the compile list**

In `Plexus/package.json`, in the `compile:mu` script's file list, add `src/renderer/src/services/wiki/wiki.resources.mu` (place it before `src/renderer/src/app.mu`, matching how other `*.resources.mu` are listed).

- [ ] **Step 8: Compile + typecheck**

Run: `cd Plexus && npm run compile:mu && npm run typecheck:web`
Expected: `compile:mu` emits `wiki.resources.mu.js` and reports no unresolved bindings; typecheck clean.

- [ ] **Step 9: Commit**

```bash
cd Plexus && git add src/renderer/src/services/wiki/ src/renderer/src/app.mu package.json \
  && git commit -m "feat(wiki): WikiService + OpenWikiCommand + shared Open Wiki menu"
```

---

### Task 4: Surface — architecture canvas node

Expose `Concept`/`HasWiki` on `ArchNodeVM`, populate them in the binding, and attach `@OpenWikiMenu` to the node template.

**Files:**
- Modify: `Plexus/src/renderer/src/modules/architecture-projects/services/arch-node-vm.ts`
- Modify: `Plexus/src/renderer/src/modules/architecture-projects/services/arch-diagram-binding.ts`
- Modify: `Plexus/src/renderer/src/modules/architecture-projects/services/arch-diagram-binding-service.ts`
- Modify: `Plexus/src/renderer/src/modules/diagram/diagram.resources.mu` (ArchNodeVM template)
- Test: `Plexus/src/renderer/src/modules/architecture-projects/services/tests/arch-node-wiki.test.ts`

**Interfaces:**
- Consumes: `WikiService.hasWiki(concept)` (Task 3).
- Produces: `ArchNodeVM.Concept: string`, `ArchNodeVM.HasWiki: boolean` (settable DPs).

- [ ] **Step 1: Write the failing test**

Create `Plexus/src/renderer/src/modules/architecture-projects/services/tests/arch-node-wiki.test.ts`:

```ts
import { test, expect } from 'vitest'
import { ArchNodeVM } from '../arch-node-vm.js'

test('ArchNodeVM exposes settable Concept and HasWiki', () => {
    const n = new ArchNodeVM()
    expect(n.Concept).toBe('')
    expect(n.HasWiki).toBe(false)
    n.Concept = 'service'
    n.HasWiki = true
    expect(n.Concept).toBe('service')
    expect(n.HasWiki).toBe(true)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-node-wiki.test.ts`
Expected: FAIL — `Concept`/`HasWiki` are not properties of `ArchNodeVM`.

- [ ] **Step 3: Add the DPs to `ArchNodeVM`**

In `arch-node-vm.ts`, add after the `IconSizeKey` block:

```ts
    // The concept this node instantiates + whether it has an openable wiki page.
    // Drive the "Open Wiki" context menu (Visibility via HasWiki, CommandParameter
    // via Concept). Populated by ArchDiagramBinding.rescan.
    static readonly ConceptKey = Model.RegisterProperty<string>(ArchNodeVM, 'Concept', '', MetaData.None)
    static readonly HasWikiKey = Model.RegisterProperty<boolean>(ArchNodeVM, 'HasWiki', false, MetaData.None)
```

And add the accessors after the `IconSize` accessors:

```ts
    get Concept(): string { return this.get_property_value(ArchNodeVM.ConceptKey) }
    set Concept(v: string) { this.set_property_value(ArchNodeVM.ConceptKey, v) }
    get HasWiki(): boolean { return this.get_property_value(ArchNodeVM.HasWikiKey) }
    set HasWiki(v: boolean) { this.set_property_value(ArchNodeVM.HasWikiKey, v) }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-node-wiki.test.ts`
Expected: PASS.

- [ ] **Step 5: Populate Concept/HasWiki in the binding**

In `arch-diagram-binding.ts`:
- Add an optional `wiki` collaborator to the constructor:
  ```ts
  import type { WikiService } from '../../../services/wiki/wiki-service.js'
  // ...
  public constructor(
      private readonly doc: DiagramDocument,
      public readonly model: ArchModel,
      private readonly chooser?: DropCandidateChooserService,
      private readonly wiki?: WikiService,
  ) {}
  ```
- In `rescan()`, inside the `if (node instanceof ArchNodeVM)` block, right after `node.Descriptor = ...`:
  ```ts
  node.Concept = entity.concept
  if (this.wiki !== undefined) {
      const concept = entity.concept
      void this.wiki.hasWiki(concept).then((h) => {
          // Guard against a stale rebind: only apply if the node still shows this concept.
          if (node.Concept === concept) node.HasWiki = h
      })
  }
  ```

- [ ] **Step 6: Pass `WikiService` into the binding from its service**

In `arch-diagram-binding-service.ts`, find where it constructs `new ArchDiagramBinding(doc, model, chooser)` and pass the resolved service:
```ts
const wiki = this.Provider.get(WikiService.Key)
// ... new ArchDiagramBinding(doc, model, chooser, wiki)
```
Add `import { WikiService } from '../../../services/wiki/wiki-service.js'` at the top. (Open the file first to match the exact constructor call site and provider accessor name — it is `this.Provider` per the ServiceBase pattern.)

- [ ] **Step 7: Attach the menu in the node template**

In `diagram.resources.mu`, in the `DataTemplate [DataType = ArchNodeVM]` block (the `StackPanel` root), add a trigger at the end of the template body (after the closing `}` of the `StackPanel`, still inside the `DataTemplate { }`), mirroring the meta-model/library pattern:

```
        // "Open Wiki" when this node's concept has an openable wiki page.
        when ( $HasWiki = true ) { ContextMenuService.ContextMenu = @OpenWikiMenu; }
```

- [ ] **Step 8: Compile + typecheck + run the neighborhood suites**

Run: `cd Plexus && npm run compile:mu && npm run typecheck:web && npx vitest run src/renderer/src/modules/architecture-projects`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
cd Plexus && git add src/renderer/src/modules/architecture-projects/services/arch-node-vm.ts \
  src/renderer/src/modules/architecture-projects/services/arch-diagram-binding.ts \
  src/renderer/src/modules/architecture-projects/services/arch-diagram-binding-service.ts \
  src/renderer/src/modules/diagram/diagram.resources.mu \
  src/renderer/src/modules/architecture-projects/services/tests/arch-node-wiki.test.ts \
  && git commit -m "feat(wiki): Open Wiki on architecture canvas nodes"
```

---

### Task 5: Surface — toolbox tile

Expose `Concept`/`HasWiki` on `ArchToolboxItem`, populate them in the contributor, and attach the menu to the shared tile template (safe: shapes never satisfy `$HasWiki = true`).

**Files:**
- Modify: `Plexus/src/renderer/src/modules/diagram/services/arch-toolbox-item.ts`
- Modify: `Plexus/src/renderer/src/modules/architecture-projects/services/arch-model-toolbox-contributor.ts`
- Modify: `Plexus/src/renderer/src/modules/diagram/diagram.resources.mu` (shared ToolboxItem template)
- Test: `Plexus/src/renderer/src/modules/diagram/services/tests/arch-toolbox-item-wiki.test.ts`

**Interfaces:**
- Consumes: `WikiService.hasWiki` (Task 3).
- Produces: `ArchToolboxItem.Concept: string`, `ArchToolboxItem.HasWiki: boolean` (settable DPs); a 5th constructor arg `concept`.

- [ ] **Step 1: Write the failing test**

Create `Plexus/src/renderer/src/modules/diagram/services/tests/arch-toolbox-item-wiki.test.ts`:

```ts
import { test, expect } from 'vitest'
import { ToolboxVisualDescriptor } from '@pragmatic-tech-ai/mural/framework'
import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import { ArchToolboxItem } from '../arch-toolbox-item.js'

test('ArchToolboxItem carries Concept and a settable HasWiki', () => {
    const desc = new ToolboxVisualDescriptor(new ServiceKey('x'), 'k')
    const item = new ArchToolboxItem('instance:a', 'A', desc, new ServiceKey('f'), 'service')
    expect(item.Concept).toBe('service')
    expect(item.HasWiki).toBe(false)
    item.HasWiki = true
    expect(item.HasWiki).toBe(true)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/diagram/services/tests/arch-toolbox-item-wiki.test.ts`
Expected: FAIL — the constructor takes no `concept` and there is no `Concept`/`HasWiki`.

- [ ] **Step 3: Add DPs + constructor arg to `ArchToolboxItem`**

Replace the class body of `arch-toolbox-item.ts` with:

```ts
export class ArchToolboxItem extends ToolboxItem
{
    public static readonly DisplayKey = Model.RegisterProperty<string>(
        ArchToolboxItem, 'Display', '', MetaData.None)
    public static readonly ConceptKey = Model.RegisterProperty<string>(
        ArchToolboxItem, 'Concept', '', MetaData.None)
    public static readonly HasWikiKey = Model.RegisterProperty<boolean>(
        ArchToolboxItem, 'HasWiki', false, MetaData.None)

    constructor(
        id: string,
        label: string,
        descriptor: ToolboxVisualDescriptor,
        factoryKey: ServiceKey<IToolboxDropFactory>,
        concept = '',
    )
    {
        super(id, label, descriptor, factoryKey)
        this.set_property_value(ArchToolboxItem.DisplayKey, label)
        this.set_property_value(ArchToolboxItem.ConceptKey, concept)
    }

    public get Display(): string { return this.get_property_value(ArchToolboxItem.DisplayKey) }
    public get Concept(): string { return this.get_property_value(ArchToolboxItem.ConceptKey) }
    public get HasWiki(): boolean { return this.get_property_value(ArchToolboxItem.HasWikiKey) }
    public set HasWiki(v: boolean) { this.set_property_value(ArchToolboxItem.HasWikiKey, v) }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/diagram/services/tests/arch-toolbox-item-wiki.test.ts`
Expected: PASS.

- [ ] **Step 5: Set Concept in the contributor + kick off HasWiki**

In `arch-model-toolbox-contributor.ts`:
- Pass the concept when building items. In `modelPageItems`, change the push to:
  ```ts
  items.push(new ArchToolboxItem('instance:' + e.id, entityLabel(e), descriptor, ArchModelInstanceDropFactoryKey, e.concept))
  ```
  and in `scenarioPageItems`:
  ```ts
  items.push(new ArchToolboxItem('scenario:' + e.id, entityLabel(e), descriptor, ArchScenarioDropFactoryKey, e.concept))
  ```
- In the `ArchModelToolboxContributor.refresh()` method, after the pages' Items are populated, resolve HasWiki for the arch items via the service. Add a private accessor and a loop:
  ```ts
  // near the other imports
  import { WikiService } from '../../../services/wiki/wiki-service.js'
  // ...
  private markWiki(items: readonly ArchToolboxItem[]): void
  {
      const wiki = this.Provider.get(WikiService.Key)
      if (wiki === undefined) return
      for (const it of items) {
          const concept = it.Concept
          void wiki.hasWiki(concept).then((h) => { if (it.Concept === concept) it.HasWiki = h })
      }
  }
  ```
  Call `this.markWiki(...)` with the just-built items for each page. (The pure `modelPageItems`/`scenarioPageItems` return the arrays; capture them into locals in `refresh()` before adding to the page, and pass those locals to `markWiki`.)

- [ ] **Step 6: Attach the menu on the shared ToolboxItem template**

In `diagram.resources.mu`, in `DataTemplate [DataType = ToolboxItem]` (the `Border x:root`), add at the end of the template body (inside the `DataTemplate { }`, after the `Border`'s closing `}`):

```
        // "Open Wiki" for arch tiles whose concept has an openable wiki page.
        // Shape tiles have no HasWiki property → the trigger never fires for them.
        when ( $HasWiki = true ) { ContextMenuService.ContextMenu = @OpenWikiMenu; }
```

- [ ] **Step 7: Compile + typecheck + suites**

Run: `cd Plexus && npm run compile:mu && npm run typecheck:web && npx vitest run src/renderer/src/modules/architecture-projects src/renderer/src/modules/diagram`
Expected: all green (the existing `toolbox-visible-filter.test.ts` and toolbox tests still pass — the new 5th ctor arg is optional).

- [ ] **Step 8: Commit**

```bash
cd Plexus && git add src/renderer/src/modules/diagram/services/arch-toolbox-item.ts \
  src/renderer/src/modules/architecture-projects/services/arch-model-toolbox-contributor.ts \
  src/renderer/src/modules/diagram/diagram.resources.mu \
  src/renderer/src/modules/diagram/services/tests/arch-toolbox-item-wiki.test.ts \
  && git commit -m "feat(wiki): Open Wiki on architecture toolbox tiles"
```

---

### Task 6: Surface — Meta-models panel entity

Add `Concept`/`HasWiki` to `MetaModelTreeNode` entity rows, populate them where entity nodes are built, and attach the menu via a `HasWiki` trigger.

**Files:**
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/meta-model-tree-node.ts`
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/meta-models-service.ts` (where `MetaModelTreeNode.entity(...)` rows are built)
- Modify: `Plexus/src/renderer/src/modules/meta-model/meta-model.resources.mu`
- Test: `Plexus/src/renderer/src/modules/meta-model/services/tests/meta-model-tree-node-wiki.test.ts`

**Interfaces:**
- Consumes: `WikiService.hasWiki`.
- Produces: `MetaModelTreeNode.Concept: string`, `MetaModelTreeNode.HasWiki: boolean`; the `entity(...)` factory gains a `concept` arg.

- [ ] **Step 1: Write the failing test**

Create `Plexus/src/renderer/src/modules/meta-model/services/tests/meta-model-tree-node-wiki.test.ts`:

```ts
import { test, expect } from 'vitest'
import { MetaModelTreeNode } from '../meta-model-tree-node.js'

test('an entity node carries its Concept and a settable HasWiki', () => {
    const n = MetaModelTreeNode.entity('Service', { modelId: 'm', version: '1', id: 'service' }, () => {}, 'service')
    expect(n.Concept).toBe('service')
    expect(n.HasWiki).toBe(false)
    n.HasWiki = true
    expect(n.HasWiki).toBe(true)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-tree-node-wiki.test.ts`
Expected: FAIL — `entity` takes no `concept`; no `Concept`/`HasWiki`.

- [ ] **Step 3: Add DPs + a `concept` arg to `entity(...)`**

In `meta-model-tree-node.ts`:
- Add the DPs after `IsDeletableKey`:
  ```ts
  public static readonly ConceptKey = Model.RegisterProperty<string>(
      MetaModelTreeNode, 'Concept', '', MetaData.None)
  public static readonly HasWikiKey = Model.RegisterProperty<boolean>(
      MetaModelTreeNode, 'HasWiki', false, MetaData.None)
  ```
- Add accessors after `IsDeletable`:
  ```ts
  public get Concept(): string { return this.get_property_value(MetaModelTreeNode.ConceptKey) }
  public get HasWiki(): boolean { return this.get_property_value(MetaModelTreeNode.HasWikiKey) }
  public set HasWiki(v: boolean) { this.set_property_value(MetaModelTreeNode.HasWikiKey, v) }
  ```
- Extend the `entity` factory:
  ```ts
  public static entity(
      label: string, ref: EntityRef, activate: (ref: EntityRef) => void, concept = '',
  ): MetaModelTreeNode
  {
      const node = new MetaModelTreeNode(MetaModelNodeKind.Entity, label)
      node.ref = ref
      node.activate = activate
      node.set_property_value(MetaModelTreeNode.ConceptKey, concept)
      return node
  }
  ```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-tree-node-wiki.test.ts`
Expected: PASS.

- [ ] **Step 5: Populate concept + HasWiki where entity rows are built**

Open `meta-models-service.ts` and find the call(s) to `MetaModelTreeNode.entity(label, ref, activate)`. The concept id is `ref.id` (the ontology entity's local id). Change each call to pass `ref.id` as the 4th arg:
```ts
MetaModelTreeNode.entity(label, ref, activate, ref.id)
```
Then, after building the entity nodes for a version's subtree (in the loader that produces them), kick off HasWiki for each via the service. Add:
```ts
import { WikiService } from '../../../services/wiki/wiki-service.js'
// ...
private markWiki(nodes: readonly MetaModelTreeNode[]): void {
    const wiki = this.Provider.get(WikiService.Key)
    if (wiki === undefined) return
    for (const n of nodes) {
        if (n.Kind !== MetaModelNodeKind.Entity) continue
        const concept = n.Concept
        if (concept.length === 0) continue
        void wiki.hasWiki(concept).then((h) => { if (n.Concept === concept) n.HasWiki = h })
    }
}
```
and call `this.markWiki(entityNodes)` where the entity subtree array is assembled (the same array returned by the lazy loader). Match the exact variable name in that method.

- [ ] **Step 6: Attach the menu to entity rows in `meta-model.resources.mu`**

After the existing `when ( $IsDeletable = true )` trigger in `MetaModelNodeTemplate`, add:
```
        // Entity rows with an openable wiki page get the "Open Wiki" menu.
        when ( $HasWiki = true ) { ContextMenuService.ContextMenu = @OpenWikiMenu; }
```

- [ ] **Step 7: Compile + typecheck + suite**

Run: `cd Plexus && npm run compile:mu && npm run typecheck:web && npx vitest run src/renderer/src/modules/meta-model`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
cd Plexus && git add src/renderer/src/modules/meta-model/services/meta-model-tree-node.ts \
  src/renderer/src/modules/meta-model/services/meta-models-service.ts \
  src/renderer/src/modules/meta-model/meta-model.resources.mu \
  src/renderer/src/modules/meta-model/services/tests/meta-model-tree-node-wiki.test.ts \
  && git commit -m "feat(wiki): Open Wiki on Meta-models panel entities"
```

---

### Task 7: Surface — library class tile

Add `HasWiki` to `LibraryTreeNode` (it already has `Concept`), populate it where class leaves are built, and attach the menu via a `HasWiki` trigger on the class rows.

**Files:**
- Modify: `Plexus/src/renderer/src/modules/library/services/library-tree-node.ts`
- Modify: `Plexus/src/renderer/src/modules/library/services/libraries-panel-service.ts` (where `LibraryTreeNode.leaf(...)` is built) — confirm exact file/name when implementing.
- Modify: `Plexus/src/renderer/src/modules/library/library.resources.mu`
- Test: `Plexus/src/renderer/src/modules/library/services/tests/library-tree-node-wiki.test.ts`

**Interfaces:**
- Consumes: `WikiService.hasWiki`.
- Produces: `LibraryTreeNode.HasWiki: boolean` (settable DP).

- [ ] **Step 1: Write the failing test**

Create `Plexus/src/renderer/src/modules/library/services/tests/library-tree-node-wiki.test.ts`:

```ts
import { test, expect } from 'vitest'
import { LibraryTreeNode } from '../library-tree-node.js'

test('a class leaf carries Concept and a settable HasWiki', () => {
    const n = LibraryTreeNode.leaf({ display: 'S3', label: 'S3', localId: 's3', termId: 't', concept: 'service' })
    expect(n.Concept).toBe('service')
    expect(n.HasWiki).toBe(false)
    n.HasWiki = true
    expect(n.HasWiki).toBe(true)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/library/services/tests/library-tree-node-wiki.test.ts`
Expected: FAIL — no `HasWiki`.

- [ ] **Step 3: Add the `HasWiki` DP**

In `library-tree-node.ts`:
- Add after `IsDraggableKey`:
  ```ts
  public static readonly HasWikiKey = Model.RegisterProperty<boolean>(LibraryTreeNode, 'HasWiki', false, MetaData.None)
  ```
- Add accessors after `IsDraggable`:
  ```ts
  public get HasWiki(): boolean { return this.get_property_value(LibraryTreeNode.HasWikiKey) }
  public set HasWiki(v: boolean) { this.set_property_value(LibraryTreeNode.HasWikiKey, v) }
  ```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/library/services/tests/library-tree-node-wiki.test.ts`
Expected: PASS.

- [ ] **Step 5: Populate HasWiki where class leaves are built**

Open `libraries-panel-service.ts` (or whichever service assembles the tree — grep for `LibraryTreeNode.leaf(`). After the class-leaf nodes are built, kick off HasWiki via the service:
```ts
import { WikiService } from '../../../services/wiki/wiki-service.js'
// ...
private markWiki(nodes: readonly LibraryTreeNode[]): void {
    const wiki = this.Provider.get(WikiService.Key)
    if (wiki === undefined) return
    for (const n of nodes) {
        if (n.Kind !== LibraryNodeKind.Class) continue
        const concept = n.Concept
        if (concept.length === 0) continue
        void wiki.hasWiki(concept).then((h) => { if (n.Concept === concept) n.HasWiki = h })
    }
}
```
Import `LibraryNodeKind` from `./library-tree-node.js`. Call `this.markWiki(...)` over the leaves after the roots are assembled (walk the tree or capture the leaves as they are created — match the existing build method's structure).

- [ ] **Step 6: Attach the menu to class rows in `library.resources.mu`**

In `LibraryNodeTemplate`, after the existing `when ( $IsLibrary = true )` trigger, add:
```
        // Class leaves with an openable wiki page get the "Open Wiki" menu.
        when ( $HasWiki = true ) { ContextMenuService.ContextMenu = @OpenWikiMenu; }
```
(A row is never both a Library node and a wiki-bearing class, so the two triggers never conflict.)

- [ ] **Step 7: Compile + typecheck + suite**

Run: `cd Plexus && npm run compile:mu && npm run typecheck:web && npx vitest run src/renderer/src/modules/library`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
cd Plexus && git add src/renderer/src/modules/library/services/library-tree-node.ts \
  src/renderer/src/modules/library/services/libraries-panel-service.ts \
  src/renderer/src/modules/library/library.resources.mu \
  src/renderer/src/modules/library/services/tests/library-tree-node-wiki.test.ts \
  && git commit -m "feat(wiki): Open Wiki on library class tiles"
```

---

### Task 8: Live wiring + Playwright smoke

Annotate one real `tech-architecture` concept with a wiki page, then verify the end-to-end flow in the running app.

**Files:**
- Modify: a concept file under `plexus_tests/meta-models/tech-architecture/**` (add `annotate wiki { path = "wiki/<concept>.md"; }`)
- Create: `plexus_tests/meta-models/tech-architecture/wiki/<concept>.md`
- Create (scratch, not committed): a Playwright driver under the session scratchpad.

**Interfaces:** none (verification only).

- [ ] **Step 1: Annotate a concept + create its page**

Pick a concept that appears as a node in the test architecture (e.g. `subscription` or `location`, per `test_architecture/landscape.todl`). In its concept declaration add:
```todl
annotate wiki { path = "wiki/subscription.md"; }
```
Create `plexus_tests/meta-models/tech-architecture/wiki/subscription.md`:
```markdown
# Subscription

A subscription is a billing + management boundary...
```

- [ ] **Step 2: Full suite + typecheck + build**

Run: `cd Plexus && npm test && npm run typecheck && npm run build`
Expected: all green; `out/` rebuilt.

- [ ] **Step 3: Playwright smoke**

Adapt the prior harness (`smoke-panels.mjs` / `smoke-preset-strip.mjs` in the session scratchpad) to a `smoke-wiki.mjs` that:
1. Launches the built app (`electron .` via `_electron.launch`, `delete process.env.ELECTRON_RUN_AS_NODE`), seeding `open-projects.json` with BOTH the `test_architecture` project AND the `tech-architecture` meta-model project (so the declaring project is open — Approach A).
2. Opens the architecture diagram, right-clicks the `subscription` node (use `{ force: true }` — mural's `rect.mural-hit` overlays SVG text), clicks "Open Wiki".
3. Asserts a Monaco tab titled `subscription.md` (or the path) is now open, and captures a screenshot.
4. Logs zero renderer errors.

Run: `node <scratchpad>/smoke-wiki.mjs`
Expected: `[driver] wiki tab opened: true`, `renderer errors: NONE`. Inspect the screenshot to confirm the `.md` content shows in the editor.

- [ ] **Step 4: Commit the meta-model wiki content**

```bash
cd /c/Users/Eugene/Projects/plexus_tests   # if it is a git repo; otherwise skip
git add meta-models/tech-architecture   # the annotated concept + wiki/subscription.md
git commit -m "test-data: wiki page for the subscription concept"
```
(If `plexus_tests` is not version-controlled, note that the sample page + annotation are in place and skip the commit.)

---

## Self-Review

**Spec coverage:**
- TODL `annotation wiki { path : string?; }` in prelude, plain (not MuralResource), publish + Plexus bump → Task 1.
- `hasWiki` + `OpenWikiCommand` + `openWiki` + status on failure → Task 3.
- `WikiLocator` (concept → declaring open project, the isolated risk) → Task 2.
- Four surfaces, each exposing `Concept`/`HasWiki` + a `HasWiki`-gated `@OpenWikiMenu` sharing one command → Tasks 4–7.
- Open the `.md` via `CodeEditorService.OpenFile` → Task 3.
- Testing (TODL parse/resolve; `WikiLocator`; `WikiService.openWiki` happy/no-resolve/missing-file; `hasWiki`; per-surface VM DPs; live smoke) → Tasks 1–8.
- Out-of-scope items (publish-baking, rendered viewer, page authoring UI, relationship-member wiki) → not implemented, as intended.

**Refinement vs. spec (noted for the reviewer):** the spec sketched a sync `hasWiki(repo, concept)` reading each surface's repo. Because the two *published* surfaces (Meta-models panel, library tiles) don't carry the wiki annotation in their artifacts (no bake — out of scope), this plan routes BOTH visibility and open through the one `WikiLocator` (`hasWiki` is async). This unifies all four surfaces on a single mechanism and makes "Open Wiki" appear exactly when the page is openable. No scope change; the annotation, surfaces, and out-of-scope set are unchanged.

**Placeholder scan:** none — every code step carries real code + an exact run command. Three steps say "match the exact call site/variable name when implementing" (binding-service constructor call, meta-models entity-loader array, libraries leaf-build method); these are integration points whose surrounding names must be read at implementation time, not placeholders in the delivered code — each names the file, the symbol to find, and the exact edit to make.

**Type consistency:** `resolveWiki(concept): Promise<{root, relPath} | undefined>` defined in Task 2, consumed identically in Task 3. `WikiService.hasWiki(concept): Promise<boolean>` + `OpenWikiCommand` defined in Task 3, consumed in Tasks 4–7. Each surface VM exposes `Concept: string` + `HasWiki: boolean` (settable) — names identical across VM, builder, and `.mu` binding (`$Concept`, `$HasWiki`). `@OpenWikiMenu` defined once (Task 3), referenced by the same key in Tasks 4–7.

**Risk callouts:**
1. `WikiLocator` parsing isolated meta-model sources — if `ModelDraft.fromSources([], …)` throws without the prelude, Task 2 Step 4 falls back to passing the prelude repo as a base. The one genuine unknown; isolated behind one method.
2. Meta-models entity `concept` = `ref.id` assumption (Task 6 Step 5) — verify the ontology entity id equals the concept node id the `@wiki` annotation is keyed on when implementing; if the published id is namespaced, strip to the local segment.
3. HasWiki is async per item — a brief delay before "Open Wiki" becomes available on a freshly built tile/node; acceptable (menu is built on right-click, well after item creation).

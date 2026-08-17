# Base `TodlProjectFactory` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract an abstract `TodlProjectFactory` that owns the shared TODL project plumbing, TODL source collection, and the basic TODL agentic scaffolding, so every TODL project type (architecture, meta-model, library) knows TODL grammar and rules.

**Architecture:** A new abstract class `TodlProjectFactory extends ServiceBase implements IProjectFactory` holds the project lifecycle (`createProject`/`openProject`/`saveProject`/`buildProject`/`populate`), a `formats`-derived node-kind map, and an `ensureScaffold` that writes the union of a base scaffold (`.claude/todl-manual.md` + `.claude/todl-rules.md`) and each subclass's own contributions. The three concrete factories subclass it and declare only what differs (`formats`, `buildManifest`, `scaffoldContributions`, plus their publish/producer/presentation capabilities). The shared `todl-sources` helper relocates out of the meta-model module into `services/todl/`.

**Tech Stack:** TypeScript, `@pragmatic-lab/mural/runtime` (`ServiceBase`, `Model`), `@pragmatic-lab/todl`, Vite `?raw` markdown asset imports, Vitest.

## Global Constraints

- Every test file lives in a `tests/` subfolder next to the code it exercises (verified by `vitest.config.ts` globbing `src/**/*.test.ts`).
- Renderer code must not import `node:fs` / `node:path`; all persistence flows through `IStorage` (project-relative POSIX paths, `''` = root).
- Use real TS enums/types, never string-literal unions, for new type surfaces (existing `ProjectNodeKind` is a pre-existing union — do not widen the rule to it).
- Markdown scaffold docs are `?raw`-imported asset files, never escaped string literals.
- Commit only when the user asks (the executor pauses at the finish menu); each task's steps still show the commit for completeness.
- `npm run typecheck:web` must stay clean; `npm test` must stay green (baseline: 828 passed, 1 skipped).

---

### Task 1: Relocate `todl-sources` into `services/todl/`

Move the shared TODL source-collection helper out of the meta-model module so it is no longer a cross-module import for its five consumers, before the base factory (which conceptually belongs to the same shared layer) is introduced.

**Files:**
- Create: `Plexus/src/renderer/src/services/todl/todl-sources.ts` (moved content)
- Create: `Plexus/src/renderer/src/services/todl/tests/todl-sources.test.ts` (moved test)
- Delete: `Plexus/src/renderer/src/modules/meta-model/services/todl-sources.ts`
- Delete: `Plexus/src/renderer/src/modules/meta-model/services/tests/todl-sources.test.ts`
- Modify (repoint imports): `modules/meta-model/services/meta-model-project-factory.ts`, `modules/library/services/library-project-factory.ts`, `services/wiki/wiki-locator.ts`, `services/todl/todl-language-client.ts`, `modules/architecture-projects/services/architecture-model-service.ts`

**Interfaces:**
- Produces: `services/todl/todl-sources.js` exporting `joinRel(dir, name): string`, `extname(name): string`, `collectTodlSources(storage): Promise<SourceFile[]>`, `collectTaxonomySources(storage, excludeDirs?): Promise<SourceFile[]>` — identical signatures to today.

- [ ] **Step 1: Move the source file with `git mv`**

```bash
cd Plexus
mkdir -p src/renderer/src/services/todl/tests
git mv src/renderer/src/modules/meta-model/services/todl-sources.ts \
       src/renderer/src/services/todl/todl-sources.ts
git mv src/renderer/src/modules/meta-model/services/tests/todl-sources.test.ts \
       src/renderer/src/services/todl/tests/todl-sources.test.ts
```

- [ ] **Step 2: Fix the moved files' relative import depth**

In `services/todl/todl-sources.ts` the storage import stays at the same depth (`../storage/...` → now `../storage/...` is wrong; it moved from `modules/meta-model/services/` (depth 4 to `services/`) to `services/todl/` (depth 1)). Set it to:

```ts
import type { IStorage } from '../storage/storage.js'
```

In `services/todl/tests/todl-sources.test.ts`, repoint its imports to the new relative depth. It imports the helper and `FakeStorage`:

```ts
import { collectTodlSources, collectTaxonomySources } from '../todl-sources.js'
import { FakeStorage } from '../../storage/tests/fake-storage.js'
```

(Adjust any other import in that test to the `services/todl/tests/` depth — the typecheck in Step 4 is the guard.)

- [ ] **Step 3: Repoint the five consumers**

Replace each consumer's import specifier. The symbols are unchanged; only the path moves.

- `modules/meta-model/services/meta-model-project-factory.ts`: change
  `import { collectTodlSources, extname, joinRel } from './todl-sources.js'`
  → `import { collectTodlSources, extname, joinRel } from '../../../services/todl/todl-sources.js'`
- `modules/library/services/library-project-factory.ts`: change
  `import { collectTaxonomySources, extname, joinRel } from '../../meta-model/services/todl-sources.js'`
  → `import { collectTaxonomySources, extname, joinRel } from '../../../services/todl/todl-sources.js'`
- `services/wiki/wiki-locator.ts`, `services/todl/todl-language-client.ts`, `modules/architecture-projects/services/architecture-model-service.ts`: find their `todl-sources` import and repoint it to the new location at the correct relative depth (`services/wiki/` and `services/todl/` are siblings of `services/todl/todl-sources.js`; the architecture module is at `modules/architecture-projects/services/` → `../../../services/todl/todl-sources.js`).

- [ ] **Step 4: Typecheck**

Run: `cd Plexus && npm run typecheck:web`
Expected: PASS (no unresolved-module errors). If any consumer still points at the old path, fix its specifier.

- [ ] **Step 5: Run the moved test**

Run: `cd Plexus && npx vitest run src/renderer/src/services/todl/tests/todl-sources.test.ts`
Expected: PASS (same assertions as before the move).

- [ ] **Step 6: Full suite (nothing else broke)**

Run: `cd Plexus && npm test`
Expected: same green baseline (828 passed, 1 skipped).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: relocate todl-sources to services/todl"
```

---

### Task 2: The abstract `TodlProjectFactory` + shared scaffold assets

Create the base class and the two shared scaffold documents, tested in isolation through a minimal fake subclass. No concrete factory changes yet.

**Files:**
- Create: `Plexus/src/renderer/src/services/projects/todl-project-factory.ts`
- Create: `Plexus/src/renderer/src/services/projects/scaffold/todl-manual.md` (moved from the meta-model scaffold)
- Create: `Plexus/src/renderer/src/services/projects/scaffold/todl-rules.md` (new — the golden-rules digest)
- Create: `Plexus/src/renderer/src/services/projects/tests/todl-project-factory.test.ts`

**Interfaces:**
- Consumes: `services/projects/project.js` (`Project`, `ProjectNode`, `ProjectNodeKind`), `services/projects/project-factory.js` (`PROJECT_MANIFEST_FILENAME`, `IProjectFactory`, `ProjectFileFormat`, `ProjectManifestEnvelope`), `services/projects/base-binding.js` (`BaseBindings`), `services/storage/storage.js` (`IStorage`, `compareStorageEntries`), `@pragmatic-lab/mural/runtime` (`ServiceBase`, `IServiceProvider`).
- Produces (for Tasks 3–5):
  - `abstract class TodlProjectFactory extends ServiceBase implements IProjectFactory`
  - `interface ScaffoldFile { readonly path: string; readonly content: string }`
  - `const TODL_BASE_SCAFFOLD: readonly ScaffoldFile[]`
  - `const CLAUDE_MD_FILENAME = 'CLAUDE.md'`, `const CLAUDE_DIR = '.claude'`
  - protected abstract `buildManifest(name: string, bindings?: BaseBindings): ProjectManifestEnvelope`
  - protected abstract `scaffoldContributions(): readonly ScaffoldFile[]`
  - public abstract `readonly formats: readonly ProjectFileFormat[]`
  - concrete public `createProject`, `openProject`, `saveProject`; protected `ensureScaffold`, `buildProject`.

- [ ] **Step 1: Move `todl-manual.md` into the base scaffold folder**

```bash
cd Plexus
mkdir -p src/renderer/src/services/projects/scaffold
git mv src/renderer/src/modules/meta-model/services/scaffold/todl-manual.md \
       src/renderer/src/services/projects/scaffold/todl-manual.md
```

(The meta-model scaffold source `meta-model-scaffold.ts` still imports it via `?raw`; that import breaks now and is fixed in Task 3. Typecheck at Step 6 of THIS task excludes that by not yet touching it — but `npm run typecheck:web` will flag the dangling `?raw` import. To keep Task 2 self-contained and green, temporarily repoint the meta-model scaffold's `todlManual` import to the new path in this step:)

In `modules/meta-model/services/meta-model-scaffold.ts`, change:
```ts
import todlManual from './scaffold/todl-manual.md?raw'
```
→
```ts
import todlManual from '../../../services/projects/scaffold/todl-manual.md?raw'
```
(Task 3 removes this line entirely; this keeps the tree compiling in between.)

- [ ] **Step 2: Author `todl-rules.md` (the golden-rules digest)**

Create `services/projects/scaffold/todl-rules.md` with the shared TODL golden rules, lifted from the current `CLAUDE.md` scaffold's "Golden rules — the current TODL surface" section so the rules are single-sourced:

```markdown
# TODL golden rules — the current language surface

The rules that trip up authors most, shared by every TODL project (architecture,
meta-model, library). Full reference: `.claude/todl-manual.md`.

- **Everything lives inside a `namespace`.** First line of every file:
  `namespace a.b.c {`, closed by a matching `}` at the end.
- **Every statement ends with `;`** — fields, assignments, relationships,
  imports. A missing `;` is the most common syntax error.
- **Identifiers are C-like** (`[A-Za-z_][A-Za-z0-9_]*`, no hyphens): **types**
  (concepts, primitives, taxonomies, annotations, enums, terms, classes) are
  **PascalCase** (`AppComponent`, never `app-component`) — except the prelude's
  **built-in primitives**, which are lowercase like `string` (`identifier`,
  `slug`, `resourceKey`); **members** (field names, relationship names,
  annotation params) match the surrounding files' casing (lowerCamel or
  lower_snake); **keywords** and **namespace** segments are lowercase.
- **References are bare names — no sigil**: `location`, `subnet.default`. Whether
  a value is a reference or a scalar is decided by the member's declared type
  (concept/taxonomy → reference, primitive → scalar). The characters `@` and
  `$` are reserved for Mural and are hard syntax errors in hand-authored TODL
  (`@name` appears only in serialized model dumps, never in source you write).
- **Cardinality is a suffix on the field's type** — bare = exactly one,
  `?` = optional (0..1), `[]` = many (0..N), `[+]` = one-or-more (1..N). There is
  **no** `[0..1]`, `[*]`, or `list<T>`; for a list of `bar` write `foo : bar [];`.
- **A field's TYPE is a single name** — a primitive, a taxonomy, or another
  concept; never an anonymous `object { … }`. Model structured data as a **nested
  concept**. On the *instance* side you may author that concept inline as a typed
  object literal — `field = SomeConcept { … }`; still typed, never bare `{ … }`.
- **Strings** are `"…"`; multi-line / raw strings are `"""…"""`.
- **Edge glyphs are author-declared, not built in.** `-->`, `==>`, `~>` are
  defined with `operator <glyph> : <Concept>(<from>, <to>);` (reified) or
  `operator <glyph> : <Concept>.<member>;` (relationship), then used between two
  bare endpoints (`a --> b;`) — as a statement or a value.
- **Annotations carry typed metadata.** Declare `annotation Name { param : type; }`
  (it may inherit: `annotation Sub : Base { … }`), then `annotate Name { param =
  value; }` inside a concept body, a relationship-member body, a taxonomy `term`,
  or a `package { … }` block. The prelude ships standard ones you use without
  declaring: `icon`/`label` (presentation), `wiki` (a Markdown page:
  `annotate wiki { path = "wiki/x.md"; }`), and `iconSource` (icon fallback order,
  on a relationship member).
- **Parent-less concepts extend the prelude's `Element`** (free `label` /
  `description`).
```

- [ ] **Step 3: Write the failing base-factory test**

Create `services/projects/tests/todl-project-factory.test.ts`. It drives the base through a minimal fake subclass over `FakeStorage`.

```ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'

import { PROJECT_MANIFEST_FILENAME, type ProjectFileFormat, type ProjectManifestEnvelope } from '../project-factory.js'
import type { BaseBindings } from '../base-binding.js'
import { FakeStorage } from '../../storage/tests/fake-storage.js'
import { TodlProjectFactory, type ScaffoldFile } from '../todl-project-factory.js'

// A minimal concrete factory: one extra scaffold file, a manifest that carries
// an unrelated field to prove saveProject preserves it, and two formats so the
// kind-mapping is exercised (.todl → 'todl', .diagram → 'diagram').
class FakeFactory extends TodlProjectFactory
{
    public readonly formats: readonly ProjectFileFormat[] = [
        { extension: '.diagram', kind: 'diagram', displayName: 'Diagram' },
        { extension: '.todl', kind: 'todl', displayName: 'TODL Definition' },
    ]
    protected buildManifest(name: string, _bindings?: BaseBindings): ProjectManifestEnvelope
    {
        return { type: 'fake', name, version: 1, keep: 'me' } as ProjectManifestEnvelope & { keep: string }
    }
    protected scaffoldContributions(): readonly ScaffoldFile[]
    {
        return [{ path: 'CLAUDE.md', content: 'FAKE ROOT' }]
    }
}

function factory(): FakeFactory { return new FakeFactory(new ServiceProvider()) }

test('createProject writes base scaffold ∪ subclass contribution', async () => {
    const storage = new FakeStorage('fake://P')
    await factory().createProject(storage, 'P')
    expect(await storage.Exists('.claude/todl-manual.md')).toBe(true)
    expect(await storage.Exists('.claude/todl-rules.md')).toBe(true)
    expect(await storage.ReadText('CLAUDE.md')).toBe('FAKE ROOT')
    // base assets are the real docs, not placeholders
    expect(await storage.ReadText('.claude/todl-manual.md')).toMatch(/namespace/)
    expect(await storage.ReadText('.claude/todl-rules.md')).toMatch(/golden rules/i)
})

test('ensureScaffold is write-once (never clobbers an author edit)', async () => {
    const storage = new FakeStorage()
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'fake', name: 'P', version: 1 }))
    await storage.WriteText('.claude/todl-manual.md', 'MY EDIT')
    await factory().openProject(storage)
    expect(await storage.ReadText('.claude/todl-manual.md')).toBe('MY EDIT')       // preserved
    expect(await storage.Exists('.claude/todl-rules.md')).toBe(true)               // missing one filled
})

test('populate maps node kind from formats; unmatched → file; manifest hidden', async () => {
    const storage = new FakeStorage()
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'fake', name: 'P', version: 1 }))
    await storage.WriteText('defs/core.todl', 'namespace d {}')
    await storage.WriteText('view.diagram', '{}')
    await storage.WriteText('notes.md', 'hi')
    const project = await factory().openProject(storage)
    const top = new Map(project.Root.Children.ToArray().map((n) => [n.Name, n.Kind]))
    expect(top.get('view.diagram')).toBe('diagram')
    expect(top.get('notes.md')).toBe('file')
    expect([...top.keys()]).not.toContain(PROJECT_MANIFEST_FILENAME)
    const defs = project.Root.Children.ToArray().find((n) => n.Name === 'defs')!
    expect(defs.Kind).toBe('folder')
    expect(defs.Children.ToArray()[0].Kind).toBe('todl')
    expect(defs.Children.ToArray()[0].Path).toBe('defs/core.todl')
})

test('saveProject renames and preserves unrelated manifest fields', async () => {
    const storage = new FakeStorage()
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'fake', name: 'Old', version: 1, keep: 'me' }))
    // A project object whose Name is 'Renamed', produced by a normal create
    // (Project.Name is read-only, so build it through the factory rather than a setter).
    const renamed = await factory().createProject(new FakeStorage('fake://Renamed'), 'Renamed')
    await factory().saveProject(renamed, storage)
    const m = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
    expect(m.name).toBe('Renamed')
    expect(m.keep).toBe('me')       // untouched
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd Plexus && npx vitest run src/renderer/src/services/projects/tests/todl-project-factory.test.ts`
Expected: FAIL — `Cannot find module '../todl-project-factory.js'`.

- [ ] **Step 5: Implement the base class**

Create `services/projects/todl-project-factory.ts`:

```ts
import { ServiceBase, type IServiceProvider } from '@pragmatic-lab/mural/runtime'

import todlManual from './scaffold/todl-manual.md?raw'
import todlRules from './scaffold/todl-rules.md?raw'
import {
    PROJECT_MANIFEST_FILENAME,
    type IProjectFactory,
    type ProjectFileFormat,
    type ProjectManifestEnvelope,
} from './project-factory.js'
import type { BaseBindings } from './base-binding.js'
import { Project, ProjectNode, type ProjectNodeKind } from './project.js'
import { compareStorageEntries, type IStorage } from '../storage/storage.js'

// The base for every TODL-authoring project type. It owns the whole project
// lifecycle common to architecture / meta-model / library — manifest write+read,
// the storage-tree walk, and the agent-support scaffold — leaving each subclass
// to declare only its manifest shape, its file formats, and its own scaffold
// files. Persistence flows through the rooted IStorage (project-relative paths).

export const CLAUDE_MD_FILENAME = 'CLAUDE.md'
export const CLAUDE_DIR = '.claude'

export interface ScaffoldFile
{
    readonly path: string       // project-relative destination (POSIX)
    readonly content: string
}

// The shared scaffold every TODL project receives: the language manual and the
// golden-rules digest, both under .claude/. Subclasses add their own CLAUDE.md
// and type-specific guides via scaffoldContributions().
export const TODL_BASE_SCAFFOLD: readonly ScaffoldFile[] = [
    { path: `${CLAUDE_DIR}/todl-manual.md`, content: todlManual },
    { path: `${CLAUDE_DIR}/todl-rules.md`,  content: todlRules },
]

export abstract class TodlProjectFactory extends ServiceBase implements IProjectFactory
{
    constructor(provider: IServiceProvider) { super(provider) }

    // Each subclass declares its openable formats; populate derives node kinds
    // from them.
    public abstract readonly formats: readonly ProjectFileFormat[]

    // Build the initial manifest object to serialize on create — the subclass's
    // extended shape (id/modelVersion, id/libVersion/metaModel, metaModel/libraries).
    protected abstract buildManifest(name: string, bindings?: BaseBindings): ProjectManifestEnvelope

    // The subclass's own scaffold files (its CLAUDE.md + any type-specific guides),
    // unioned with TODL_BASE_SCAFFOLD by ensureScaffold.
    protected abstract scaffoldContributions(): readonly ScaffoldFile[]

    public async createProject(storage: IStorage, name: string, bindings?: BaseBindings): Promise<Project>
    {
        const manifest = this.buildManifest(name, bindings)
        await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))
        await this.ensureScaffold(storage)
        return this.buildProject(storage, manifest)
    }

    public async openProject(storage: IStorage): Promise<Project>
    {
        const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as ProjectManifestEnvelope
        await this.ensureScaffold(storage)          // self-heal any missing scaffold file
        return this.buildProject(storage, manifest)
    }

    public async saveProject(project: Project, storage: IStorage): Promise<void>
    {
        // Only the name tracks the project; every other manifest field is preserved.
        const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as ProjectManifestEnvelope
        manifest.name = project.Name
        await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))
    }

    // Write base ∪ subclass scaffold, each only when absent — never overwrites an
    // author's edits.
    protected async ensureScaffold(storage: IStorage): Promise<void>
    {
        await storage.CreateDirectory(`${CLAUDE_DIR}/commands`)
        for (const file of [...TODL_BASE_SCAFFOLD, ...this.scaffoldContributions()]) {
            if (await storage.Exists(file.path)) continue
            await storage.WriteText(file.path, file.content)
        }
    }

    protected async buildProject(storage: IStorage, manifest: ProjectManifestEnvelope): Promise<Project>
    {
        const rootName = basename(storage.Root)
        const root = new ProjectNode(rootName, '', 'folder')     // the root node's path is ''
        await this.populate(storage, root)
        return new Project(manifest.type, manifest.name ?? rootName, storage.Root, root)
    }

    // Recursively fill a folder node from storage. The manifest file is hidden at
    // the root; node kinds come from the subclass's formats. Paths are
    // project-relative (POSIX `/`); the root node's path is ''.
    private async populate(storage: IStorage, node: ProjectNode): Promise<void>
    {
        const entries = [...await storage.List(node.Path)].sort(compareStorageEntries)
        for (const e of entries) {
            if (node.Path === '' && e.Name === PROJECT_MANIFEST_FILENAME) continue
            const childPath = node.Path === '' ? e.Name : `${node.Path}/${e.Name}`
            const kind: ProjectNodeKind = e.IsDirectory ? 'folder' : this.kindForFile(e.Name)
            const child = new ProjectNode(e.Name, childPath, kind)
            node.Children.Add(child)
            if (e.IsDirectory) await this.populate(storage, child)
        }
    }

    // Map a file name to a ProjectNodeKind by matching its extension against the
    // subclass's declared formats; unmatched files are plain 'file' attachments.
    private kindForFile(name: string): ProjectNodeKind
    {
        const ext = extname(name)
        const fmt = this.formats.find((f) => f.extension === ext)
        return fmt !== undefined ? (fmt.kind as ProjectNodeKind) : 'file'
    }
}

function basename(p: string): string
{
    const parts = p.split(/[\\/]/)
    return parts[parts.length - 1] || p
}

function extname(name: string): string
{
    const i = name.lastIndexOf('.')
    return i > 0 ? name.slice(i).toLowerCase() : ''
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd Plexus && npx vitest run src/renderer/src/services/projects/tests/todl-project-factory.test.ts`
Expected: PASS (all four tests).

- [ ] **Step 7: Typecheck + full suite**

Run: `cd Plexus && npm run typecheck:web && npm test`
Expected: typecheck clean; suite green (the moved `todl-manual.md` import in `meta-model-scaffold.ts` was repointed in Step 1, so nothing dangles).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add abstract TodlProjectFactory + shared TODL scaffold"
```

---

### Task 3: Port `MetaModelProjectFactory` onto the base

Shrink the meta-model factory to what differs and move its golden-rules text out of its `CLAUDE.md` into the shared `todl-rules.md`.

**Files:**
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts`
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/meta-model-scaffold.ts`
- Modify: `Plexus/src/renderer/src/modules/meta-model/services/scaffold/claude-root.md`
- Test (keep green + extend): `modules/meta-model/services/tests/meta-model-project-factory.test.ts`

**Interfaces:**
- Consumes: `TodlProjectFactory`, `ScaffoldFile`, `CLAUDE_MD_FILENAME`, `CLAUDE_DIR` from `services/projects/todl-project-factory.js`.
- Produces: `MetaModelProjectFactory` unchanged public surface (`Key`, `ProjectType`, `formats`, `createProject`, `openProject`, `saveProject`, `publish`, `producerKind`, `compileToDocument`, `regeneratePresentation`).

- [ ] **Step 1: Reduce `meta-model-scaffold.ts` to the meta-model's own contributions**

Rewrite it so it no longer owns the scaffold machinery or the shared manual — just exports the three meta-model files as a `ScaffoldFile[]`:

```ts
import type { ScaffoldFile } from '../../../services/projects/todl-project-factory.js'
import { CLAUDE_DIR, CLAUDE_MD_FILENAME } from '../../../services/projects/todl-project-factory.js'
import claudeRoot from './scaffold/claude-root.md?raw'
import metaModelGuide from './scaffold/meta-model-guide.md?raw'
import newConceptCommand from './scaffold/new-concept.md?raw'

// The meta-model project's own scaffold contributions, unioned by
// TodlProjectFactory.ensureScaffold with the shared TODL_BASE_SCAFFOLD
// (todl-manual.md + todl-rules.md). This module owns only the meta-model-specific
// docs: the root CLAUDE.md (meta-model intro + workflow), the authoring guide, and
// the /new-concept command.
export const META_MODEL_SCAFFOLD: readonly ScaffoldFile[] = [
    { path: CLAUDE_MD_FILENAME,                       content: claudeRoot },
    { path: `${CLAUDE_DIR}/meta-model-guide.md`,      content: metaModelGuide },
    { path: `${CLAUDE_DIR}/commands/new-concept.md`,  content: newConceptCommand },
]
```

(This deletes the old `todlManual` import, the `SCAFFOLD_FILES` constant, and the `ensureScaffold` function. `CLAUDE_MD_FILENAME`/`CLAUDE_DIR` now come from the base module.)

- [ ] **Step 2: Rewrite the golden-rules section of the meta-model `CLAUDE.md`**

In `modules/meta-model/services/scaffold/claude-root.md`, replace the whole `## Golden rules — the current TODL surface` section (the intro line plus every bullet, down to just before `## Workflow`) with a short pointer so the rules live only in `todl-rules.md`:

```markdown
## Golden rules — the current TODL surface

The rules that trip up authors most live in **`.claude/todl-rules.md`** (shared by
every TODL project), with the full language reference in **`.claude/todl-manual.md`**.
Read `todl-rules.md` before authoring: namespaces, the trailing `;`, C-like
identifiers, bare references (no `@`/`$`), `?`/`[]`/`[+]` cardinality,
author-declared operator glyphs, typed inline object literals, and the standard
prelude annotations (`icon`/`label`/`wiki`/`iconSource`).
```

Leave the rest of the file (the meta-model intro, "What you edit", "Workflow", "Asking the user", "Go deeper") unchanged, except: in "Go deeper", add a bullet `- \`.claude/todl-rules.md\` — the shared TODL golden rules.` above the existing `todl-manual.md` bullet.

- [ ] **Step 3: Port the factory — change the base class and delete the moved plumbing**

In `meta-model-project-factory.ts`:

Change the class declaration and imports. Replace:
```ts
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
```
with:
```ts
import { ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { TodlProjectFactory, type ScaffoldFile } from '../../../services/projects/todl-project-factory.js'
import { META_MODEL_SCAFFOLD } from './meta-model-scaffold.js'
```
Remove the now-unused imports: `ProjectManifestEnvelope` stays (needed for `buildManifest` return), `Project`, `ProjectNode`, `ProjectNodeKind`, `compareStorageEntries`, `ensureScaffold`, and the `PROJECT_MANIFEST_FILENAME` used only in the deleted `openProject`/`saveProject`. Keep `PROJECT_MANIFEST_FILENAME` — `publish`/`regeneratePresentation`/`compileToDocument` still read the manifest. Keep `IStorage`.

Change the class header:
```ts
export class MetaModelProjectFactory extends TodlProjectFactory
    implements IPublishableProjectFactory, IPresentationProjectFactory, IProducerProjectFactory
```
(`IProjectFactory` is now satisfied through the base; keep the three capability interfaces.)

Delete these members (all moved to the base): `createProject`, `openProject`, `saveProject`, `buildProject`, `populate`, and the file-scope `basename` helper. Delete the `slugify`-adjacent `basename` only — keep `slugify` (still used by `buildManifest`).

Add the two hooks in their place:
```ts
protected buildManifest(name: string): ProjectManifestEnvelope
{
    const manifest: MetaModelManifest = {
        type: MetaModelProjectFactory.ProjectType, name, version: 1,
        id: slugify(name), modelVersion: '0.1.0',
    }
    return manifest
}

protected scaffoldContributions(): readonly ScaffoldFile[]
{
    return META_MODEL_SCAFFOLD
}
```

Keep `constructor(provider: IServiceProvider) { super(provider) }`, `Key`, `ProjectType`, `PRESENTATION_FILE`, `formats`, `publish`, `producerKind`, `compileToDocument`, `regeneratePresentation`, `writePresentation`, and `slugify`.

- [ ] **Step 4: Add a scaffold assertion for the new shared files**

In `meta-model-project-factory.test.ts`, the existing test `createProject writes the agent-support scaffold` already checks `CLAUDE.md`, `.claude/todl-manual.md`, `.claude/meta-model-guide.md`, `.claude/commands/new-concept.md`. Add one line asserting the new shared rules file:

```ts
    expect(await storage.Exists('.claude/todl-rules.md')).toBe(true)
```
(insert after the existing `todl-manual.md` existence check in that test.)

- [ ] **Step 5: Run the meta-model suite**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts`
Expected: PASS (all existing tests + the new assertion). The `openProject self-heals` and `scaffold surfaces in the tree` tests still pass — behavior is identical, just relocated.

- [ ] **Step 6: Typecheck + full suite**

Run: `cd Plexus && npm run typecheck:web && npm test`
Expected: typecheck clean; suite green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: port MetaModelProjectFactory onto TodlProjectFactory"
```

---

### Task 4: Port `LibraryProjectFactory` onto the base (+ library scaffold)

Shrink the library factory and give library projects their own `CLAUDE.md` so they now receive the full TODL scaffold.

**Files:**
- Modify: `Plexus/src/renderer/src/modules/library/services/library-project-factory.ts`
- Create: `Plexus/src/renderer/src/modules/library/services/library-scaffold.ts`
- Create: `Plexus/src/renderer/src/modules/library/services/scaffold/claude-root.md`
- Test (keep green + extend): `modules/library/services/tests/library-project-factory.test.ts`

**Interfaces:**
- Consumes: `TodlProjectFactory`, `ScaffoldFile`, `CLAUDE_MD_FILENAME` from the base module.
- Produces: `LibraryProjectFactory` unchanged public surface; new `LIBRARY_SCAFFOLD: readonly ScaffoldFile[]`.

- [ ] **Step 1: Author the library `CLAUDE.md`**

Create `modules/library/services/scaffold/claude-root.md`:

```markdown
# Library project (TODL)

This project defines a **library** in **TODL** — a set of `taxonomy` terms
(technology classes) authored **against a bound meta-model**, plus the visuals
that render them. You (the agent) help author and refine it. When the project
validates clean, the author **publishes** it to the shared libraries backend,
where architecture projects consume it as `<id>@<libVersion>`.

## What you edit

`.todl` files (taxonomies of classes) and their `presentation/` + `visuals/`
resources. Plexus validates every `.todl` in the project against the bound
meta-model, live: diagnostics appear in the **Problems** panel. **Publishing is
blocked while any error remains.** Example instances belong under `samples/` and
are excluded from the published taxonomy.

## Golden rules — the current TODL surface

The rules that trip up authors most live in **`.claude/todl-rules.md`** (shared by
every TODL project), with the full language reference in **`.claude/todl-manual.md`**.
A library adds one habit: a `taxonomy T : represents <Concept> { … }` whose terms
are **classes** of a meta-model concept, each optionally carrying `annotate icon`
/ `annotate wiki` for presentation.

## Workflow

1. Edit a `.todl` taxonomy.
2. Watch the **Problems** panel — validation runs against the bound meta-model.
3. Clear every **error** (warnings are advisory).
4. When clean, the author runs **Publish** → the compiled model + sources +
   resources are written to the libraries backend.

## Go deeper

- `.claude/todl-rules.md` — the shared TODL golden rules.
- `.claude/todl-manual.md` — the full language reference.
```

- [ ] **Step 2: Add the library scaffold module**

Create `modules/library/services/library-scaffold.ts`:

```ts
import type { ScaffoldFile } from '../../../services/projects/todl-project-factory.js'
import { CLAUDE_MD_FILENAME } from '../../../services/projects/todl-project-factory.js'
import claudeRoot from './scaffold/claude-root.md?raw'

// The library project's own scaffold contribution — its root CLAUDE.md. Unioned
// by TodlProjectFactory.ensureScaffold with the shared TODL_BASE_SCAFFOLD
// (todl-manual.md + todl-rules.md), so a library project gets the full TODL
// guidance a meta-model project already had.
export const LIBRARY_SCAFFOLD: readonly ScaffoldFile[] = [
    { path: CLAUDE_MD_FILENAME, content: claudeRoot },
]
```

- [ ] **Step 3: Port the factory**

In `library-project-factory.ts`:

Replace:
```ts
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
```
with:
```ts
import { ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { TodlProjectFactory, type ScaffoldFile } from '../../../services/projects/todl-project-factory.js'
import { LIBRARY_SCAFFOLD } from './library-scaffold.js'
```

Remove the imports now only used by deleted code: `Project`, `ProjectNode`, `ProjectNodeKind`, `compareStorageEntries`. Keep `PROJECT_MANIFEST_FILENAME` (publish/regeneratePresentation read it), `IStorage`, `BaseBindings`, `BaseRef`, and `ProjectManifestEnvelope` (buildManifest return). Keep the `extname`/`joinRel` import from `services/todl/todl-sources.js` (used by `copyResourceFolder`/`isTextResource`).

Change the class header:
```ts
export class LibraryProjectFactory extends TodlProjectFactory
    implements IPublishableProjectFactory, IProducerProjectFactory, IPresentationProjectFactory
```

Keep `public readonly requiresMetaModel = true` and `formats`.

Delete `createProject`, `openProject`, `saveProject`, `buildProject`, `populate`, and the file-scope `basename`. Keep `slugify`, `isTextResource`, `copyResourceFolder`, `publish`, `producerKind`, `compileToDocument`, `regeneratePresentation`, `writePresentation`.

Add the hooks:
```ts
protected buildManifest(name: string, bindings?: BaseBindings): ProjectManifestEnvelope
{
    const manifest: LibraryManifest = {
        type: LibraryProjectFactory.ProjectType, name, version: 1,
        id: slugify(name), libVersion: '0.1.0',
        ...(bindings?.metaModel !== undefined ? { metaModel: bindings.metaModel } : {}),
    }
    return manifest
}

protected scaffoldContributions(): readonly ScaffoldFile[]
{
    return LIBRARY_SCAFFOLD
}
```

- [ ] **Step 4: Add a scaffold assertion**

In `library-project-factory.test.ts`, add a test asserting a fresh library project now gets the full scaffold:

```ts
test('createProject writes the shared TODL scaffold + a library CLAUDE.md', async () => {
    const storage = new FakeStorage('fake://Acme')
    await factory().createProject(storage, 'Acme Lib', { metaModel: { id: 'ea', version: '5' } })
    expect(await storage.Exists('.claude/todl-manual.md')).toBe(true)
    expect(await storage.Exists('.claude/todl-rules.md')).toBe(true)
    expect(await storage.Exists('CLAUDE.md')).toBe(true)
    expect(await storage.ReadText('CLAUDE.md')).toMatch(/library/i)
})
```

- [ ] **Step 5: Run the library suite**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/library/services/tests/library-project-factory.test.ts`
Expected: PASS (existing publish/create tests + the new scaffold test).

- [ ] **Step 6: Typecheck + full suite**

Run: `cd Plexus && npm run typecheck:web && npm test`
Expected: typecheck clean; suite green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: port LibraryProjectFactory onto TodlProjectFactory + scaffold"
```

---

### Task 5: Port `ArchitectureProjectFactory` onto the base (+ architecture scaffold)

Shrink the architecture factory and give architecture projects their own `CLAUDE.md`. This is the biggest behavioral gain — architecture projects get TODL scaffold for the first time.

**Files:**
- Modify: `Plexus/src/renderer/src/modules/architecture-projects/services/architecture-project-factory.ts`
- Create: `Plexus/src/renderer/src/modules/architecture-projects/services/architecture-scaffold.ts`
- Create: `Plexus/src/renderer/src/modules/architecture-projects/services/scaffold/claude-root.md`
- Test (keep green + extend): `modules/architecture-projects/services/tests/architecture-project-factory.test.ts`

**Interfaces:**
- Consumes: `TodlProjectFactory`, `ScaffoldFile`, `CLAUDE_MD_FILENAME` from the base module.
- Produces: `ArchitectureProjectFactory` unchanged public surface (`Key`, `ProjectType`, `requiresMetaModel`, `offersLibraries`, `formats`, lifecycle via base); new `ARCHITECTURE_SCAFFOLD: readonly ScaffoldFile[]`.

- [ ] **Step 1: Author the architecture `CLAUDE.md`**

Create `modules/architecture-projects/services/scaffold/claude-root.md`:

```markdown
# Architecture project (TODL)

This project holds an **architecture model** in **TODL** — the instance tier:
concrete components, locations, and technologies, authored **against a bound
meta-model and a set of libraries**. You (the agent) help author and refine it.
An architecture project is a terminal consumer — it binds bases but publishes
nothing.

## What you edit

`.todl` files (the instance model) and `.diagram` files (views over it). Plexus
validates every `.todl` in the project against the bound meta-model + libraries,
live: diagnostics appear in the **Problems** panel.

## Golden rules — the current TODL surface

The rules that trip up authors most live in **`.claude/todl-rules.md`** (shared by
every TODL project), with the full language reference in **`.claude/todl-manual.md`**.
On the instance side you mostly create typed instances of the meta-model's
concepts and connect them with the meta-model's declared operator glyphs
(`a --> b;`); you may author nested structure inline as a typed object literal
(`field = SomeConcept { … }`).

## Workflow

1. Edit a `.todl` model file (or a `.diagram` view).
2. Watch the **Problems** panel — validation runs against the bound bases.
3. Clear every **error** (warnings are advisory).

## Go deeper

- `.claude/todl-rules.md` — the shared TODL golden rules.
- `.claude/todl-manual.md` — the full language reference.
```

- [ ] **Step 2: Add the architecture scaffold module**

Create `modules/architecture-projects/services/architecture-scaffold.ts`:

```ts
import type { ScaffoldFile } from '../../../services/projects/todl-project-factory.js'
import { CLAUDE_MD_FILENAME } from '../../../services/projects/todl-project-factory.js'
import claudeRoot from './scaffold/claude-root.md?raw'

// The architecture project's own scaffold contribution — its root CLAUDE.md.
// Unioned by TodlProjectFactory.ensureScaffold with the shared TODL_BASE_SCAFFOLD
// (todl-manual.md + todl-rules.md), so an architecture project now gets the same
// TODL guidance the other TODL project types have.
export const ARCHITECTURE_SCAFFOLD: readonly ScaffoldFile[] = [
    { path: CLAUDE_MD_FILENAME, content: claudeRoot },
]
```

- [ ] **Step 3: Port the factory**

In `architecture-project-factory.ts`:

Replace:
```ts
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
```
with:
```ts
import { ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { TodlProjectFactory, type ScaffoldFile } from '../../../services/projects/todl-project-factory.js'
import { ARCHITECTURE_SCAFFOLD } from './architecture-scaffold.js'
```

Remove imports now only used by deleted code: `PROJECT_MANIFEST_FILENAME` (architecture no longer reads the manifest outside the base — verify with typecheck; if unused, drop it), `Project`, `ProjectNode`, `ProjectNodeKind`, `compareStorageEntries`. Keep `ProjectFileFormat`, `ProjectManifestEnvelope`, `BaseBindings`, `BaseRef`, `IStorage`.

Change the class header:
```ts
export class ArchitectureProjectFactory extends TodlProjectFactory
```
(no capability interfaces — architecture publishes nothing; `IProjectFactory` comes from the base.)

Keep `Key`, `ProjectType`, `requiresMetaModel`, `offersLibraries`, and `formats` (the `.diagram` + `.todl` list).

Delete `createProject`, `openProject`, `saveProject`, `buildProject`, `populate`, and the file-scope `joinRel`/`basename`/`extname` helpers (all now in the base).

Add the hooks:
```ts
protected buildManifest(name: string, bindings?: BaseBindings): ProjectManifestEnvelope
{
    const manifest: ArchitectureManifest = {
        type: ArchitectureProjectFactory.ProjectType, name, version: 1,
        ...(bindings?.metaModel !== undefined ? { metaModel: bindings.metaModel } : {}),
        ...(bindings?.libraries !== undefined && bindings.libraries.length > 0
            ? { libraries: bindings.libraries } : {}),
    }
    return manifest
}

protected scaffoldContributions(): readonly ScaffoldFile[]
{
    return ARCHITECTURE_SCAFFOLD
}
```

Keep `constructor(provider: IServiceProvider) { super(provider) }` and the `ArchitectureManifest` interface.

- [ ] **Step 4: Add a scaffold assertion**

In `architecture-project-factory.test.ts`, add:

```ts
test('createProject now writes the shared TODL scaffold + an architecture CLAUDE.md', async () => {
    const storage = new FakeStorage('fake://Acme')
    await factory().createProject(storage, 'Acme Arch')
    expect(await storage.Exists('.claude/todl-manual.md')).toBe(true)
    expect(await storage.Exists('.claude/todl-rules.md')).toBe(true)
    expect(await storage.Exists('CLAUDE.md')).toBe(true)
    expect(await storage.ReadText('CLAUDE.md')).toMatch(/architecture/i)
})
```

The existing `createProject with no bindings omits both binding fields` test still passes — `buildManifest` reproduces the exact conditional-omit behavior.

- [ ] **Step 5: Run the architecture suite**

Run: `cd Plexus && npx vitest run src/renderer/src/modules/architecture-projects/services/tests/architecture-project-factory.test.ts`
Expected: PASS (all existing tests — including the `.diagram`/`.todl` kind checks, which now flow through the base's `kindForFile` — plus the new scaffold test).

- [ ] **Step 6: Typecheck + full suite**

Run: `cd Plexus && npm run typecheck:web && npm test`
Expected: typecheck clean; suite green (≥ 828 + the new tests).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: port ArchitectureProjectFactory onto TodlProjectFactory + scaffold"
```

---

## Notes for the executor

- **Do not** touch `ProjectFactoryRegistry` wiring, the New-Project dialog, or the module `.mu` files — the factories keep their `Key`/`ProjectType` and registration is unchanged.
- **Do not** publish any package (no Verdaccio interaction); this is renderer-only TS.
- After Task 5, a live smoke (create one project of each type, confirm `.claude/todl-manual.md`, `.claude/todl-rules.md`, and a `CLAUDE.md` land) is a good manual check but is not a task step — the Vitest assertions cover it headless.
```

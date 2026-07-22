# Editor / Project Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split file-editing (open/save/new a `.diagram` or `.todl`) out of project factories into per-format `IDocumentFactory`s resolved by extension through mural's `DocumentTypeRegistry`, and move the `architecture` project *type* off the diagram module onto the architecture module — so editors own files and modules own project types.

**Architecture:** Today `DiagramProjectFactory` (in the diagram module) bundles the `architecture` project lifecycle *and* `.diagram` file I/O. We split it: a Plexus `IDocumentFactory` (open/save/new + optional relocate) owns file I/O, resolved from a `DocumentDefinition.Factory` token via the framework's already-present `DocumentTypeRegistry`; `DiagramDocumentFactory` (diagram module) and `TodlDocumentFactory` (meta-model module) are the editors. The `architecture` project lifecycle moves to an `ArchitectureProjectFactory` registered by the architecture-repository module. `ProjectExplorerService` routes file operations by extension. No mural change is needed — the `.documents:` contribution point and `DocumentTypeRegistry` already exist; we register the registry as a root service so its constructor populates it.

**Tech Stack:** TypeScript (renderer), mural framework (`@pragmatic-lab/mural`), `.mu` declarative modules compiled via `npm run compile:mu`, Vitest.

## Global Constraints

- Every test file lives in a `tests/` subfolder next to the code it exercises (e.g. `services/documents/tests/document-factory.test.ts`), never beside the source. Vitest globs `src/**/*.test.ts` regardless.
- Use real TypeScript enums, never string-literal union types (existing code uses `string` for `kind`/`type` values by convention — keep those as-is; do not introduce new string-literal *union types*).
- Commits are authored as `Eugene Napryaglo <evgen.napryaglo@gmail.com>`; each commit message ends with a trailing `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` line.
- Do NOT stage `src/renderer/src/modules/ontologies/services/ontologies-service.ts` — it is a pre-existing uncommitted change that must stay out of these commits.
- After editing any `.mu` file, regenerate its `.mu.js` with `npm run compile:mu`; commit the `.mu` and the regenerated `.mu.js` together.
- **Editors own files, not projects; modules own project types.** The diagram module contributes only the `.diagram` *editor*; the `architecture` project *type* is owned by the architecture-repository module. Existing `type: "architecture"` manifests keep opening. (Sub-project 4 layers a meta-model/library resolver onto `ArchitectureProjectFactory`.)
- Verification commands run from `c:\Users\Eugene\Projects\architecture-agent\Plexus`:
  - Full test run: `npm test`
  - Typecheck: `npm run typecheck`
  - Recompile modules: `npm run compile:mu`

---

## File Structure

**New files:**
- `src/renderer/src/services/documents/document-factory.ts` — the `IDocumentFactory` interface, `IRelocatableDocumentFactory`, and the `isRelocatable` type guard. The file-I/O half of the old `IProjectFactory`.
- `src/renderer/src/services/documents/tests/document-factory.test.ts` — the guard's behavior.
- `src/renderer/src/modules/diagram/services/diagram-document-factory.ts` — `DiagramDocumentFactory` (`.diagram` I/O, relocatable), a mural service.
- `src/renderer/src/modules/diagram/services/tests/diagram-document-factory.test.ts` — ported from the old diagram-project-factory file-I/O tests.
- `src/renderer/src/modules/meta-model/services/todl-document-factory.ts` — `TodlDocumentFactory` (`.todl` → `CodeDocument` I/O, validator attach, relocatable), a mural service.
- `src/renderer/src/modules/meta-model/services/tests/todl-document-factory.test.ts` — ported from the old meta-model-project-factory file-I/O tests.
- `src/renderer/src/modules/architecture-repository/services/architecture-project-factory.ts` — `ArchitectureProjectFactory` (the `architecture` project lifecycle lifted from `DiagramProjectFactory`; `formats=[.diagram]`).
- `src/renderer/src/modules/architecture-repository/services/tests/architecture-project-factory.test.ts` — ported from the old diagram-project-factory lifecycle tests.

**Modified files:**
- `src/renderer/src/services/projects/project-factory.ts` — slim `IProjectFactory` (drop file I/O); remove `IRelocatableFileFactory` + its `isRelocatable`.
- `src/renderer/src/modules/diagram/services/diagram-project-factory.ts` — **deleted** (file I/O → `DiagramDocumentFactory`; project lifecycle → `ArchitectureProjectFactory`).
- `src/renderer/src/modules/diagram/services/tests/diagram-project-factory.test.ts` — **deleted** (split into the diagram-document-factory + architecture-project-factory tests).
- `src/renderer/src/modules/diagram/diagram.module.mu` (+ regenerated `.mu.js`) — drop `DiagramProjectFactory` from `.services:` and the whole `.projectFactories:` block; add `DiagramDocumentFactory` to `.services:`; set `Factory = DiagramDocumentFactory` on the `.documents:` `DocumentDefinition`.
- `src/renderer/src/modules/architecture-repository/architecture-repository.module.mu` (+ regenerated `.mu.js`) — add `ArchitectureProjectFactory` to `.services:` and a `.projectFactories:` block (`Type="architecture"`, `Factory=ArchitectureProjectFactory`).
- `src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts` — remove `openFile`/`saveFile`/`newFile`/`relocateOpenFile` and the `IRelocatableFileFactory` import; keep lifecycle + `publish` + `formats`.
- `src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts` — drop the file-I/O test; keep create/open/publish tests.
- `src/renderer/src/modules/meta-model/meta-model.module.mu` (+ regenerated `.mu.js`) — add `TodlDocumentFactory` to `.services:`; add a `.documents:` block (`Type="todl"`, `FileExtensions=[".todl"]`, `Factory=TodlDocumentFactory`).
- `src/renderer/src/app.mu` (+ regenerated `.mu.js`) — add `DocumentTypeRegistry` to `.services:`.
- `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts` — route file ops by extension via `DocumentTypeRegistry`; add `resolveDocumentFactory`; switch `isRelocatable` import to document-factory.
- `src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts` — rewrite the fake-factory harness: split project factory from a shared, extension-resolved document factory registered on a fake `DocumentTypeRegistry`.

---

## Task 1: `IDocumentFactory` interface + relocate guard

**Files:**
- Create: `src/renderer/src/services/documents/document-factory.ts`
- Test: `src/renderer/src/services/documents/tests/document-factory.test.ts`

**Interfaces:**
- Consumes: `IDocument` (`@pragmatic-lab/mural/framework`), `IStorage` (`../storage/storage.js`).
- Produces:
  - `interface IDocumentFactory { openFile(storage: IStorage, path: string): Promise<IDocument>; saveFile(document: IDocument): Promise<void>; newFile(storage: IStorage, name: string): Promise<string> }`
  - `interface IRelocatableDocumentFactory { relocateOpenFile(document: IDocument, newPath: string): void }`
  - `function isRelocatable(factory: IDocumentFactory): factory is IDocumentFactory & IRelocatableDocumentFactory`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/services/documents/tests/document-factory.test.ts`:

```ts
import { test, expect } from 'vitest'
import type { IDocument } from '@pragmatic-lab/mural/framework'
import type { IStorage } from '../../storage/storage.js'
import { isRelocatable, type IDocumentFactory, type IRelocatableDocumentFactory } from '../document-factory.js'

const doc = (): IDocument => ({ Id: 'x', Title: 'x', IsDirty: false, Save() {} })

test('isRelocatable is true only when relocateOpenFile is present', () => {
    const plain: IDocumentFactory = {
        openFile: async (_s: IStorage, path: string) => { void path; return doc() },
        saveFile: async () => {},
        newFile: async (_s: IStorage, name: string) => name,
    }
    const relocatable: IDocumentFactory & IRelocatableDocumentFactory = {
        ...plain,
        relocateOpenFile: () => {},
    }
    expect(isRelocatable(plain)).toBe(false)
    expect(isRelocatable(relocatable)).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/services/documents/tests/document-factory.test.ts`
Expected: FAIL — cannot resolve `../document-factory.js`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/src/services/documents/document-factory.ts`:

```ts
import type { IDocument } from '@pragmatic-lab/mural/framework'
import type { IStorage } from '../storage/storage.js'

// The file-editing half of the old IProjectFactory — extracted so an EDITOR owns
// a file format, not a project. A module contributes a DocumentDefinition (mural)
// whose `Factory` service token resolves to an IDocumentFactory; the generic
// ProjectExplorerService resolves it by extension (DocumentTypeRegistry) and
// delegates open/save/new. Any project can open any file whose extension a
// registered editor handles — the editor opens it, regardless of project type.
//
// Persistence flows through the project's IStorage (rooted, project-relative
// paths); the factory never sees an absolute path or the raw file system.
export interface IDocumentFactory
{
    // Deserialize a project file (project-relative path) into a tab document.
    openFile(storage: IStorage, path: string): Promise<IDocument>
    // Serialize a document back to its file.
    saveFile(document: IDocument): Promise<void>
    // Create an empty file (the caller supplies the base name, extension and
    // all) and return its project-relative path.
    newFile(storage: IStorage, name: string): Promise<string>
}

// Optional capability: re-point an already-open document after its file was
// renamed/moved on storage. The explorer feature-tests with isRelocatable before
// re-pointing tabs across a rename; a factory that omits it leaves stale tabs to
// the caller's policy. `newPath` is the document's new project-relative path.
export interface IRelocatableDocumentFactory
{
    relocateOpenFile(document: IDocument, newPath: string): void
}

// Type guard: can this factory re-point an open document to a new path?
export function isRelocatable(factory: IDocumentFactory): factory is IDocumentFactory & IRelocatableDocumentFactory
{
    return typeof (factory as Partial<IRelocatableDocumentFactory>).relocateOpenFile === 'function'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/services/documents/tests/document-factory.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/services/documents/document-factory.ts src/renderer/src/services/documents/tests/document-factory.test.ts
git commit -m "feat(documents): add IDocumentFactory + isRelocatable guard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `DiagramDocumentFactory`

**Files:**
- Create: `src/renderer/src/modules/diagram/services/diagram-document-factory.ts`
- Test: `src/renderer/src/modules/diagram/services/tests/diagram-document-factory.test.ts`

**Interfaces:**
- Consumes: `IDocumentFactory`, `IRelocatableDocumentFactory` (Task 1); `DiagramDocument`, `IDocument` (`@pragmatic-lab/mural/framework`); `FileDiagramStorage` (`../persistence/file-diagram-storage.js`); `IStorage`; `ServiceBase`, `ServiceKey`, `IServiceProvider` (`@pragmatic-lab/mural/runtime`).
- Produces: `class DiagramDocumentFactory extends ServiceBase implements IDocumentFactory, IRelocatableDocumentFactory` with static `Key`; `openFile(storage, path)`, `saveFile(document)`, `newFile(storage, name)`, `relocateOpenFile(document, newPath)`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/modules/diagram/services/tests/diagram-document-factory.test.ts`:

```ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { DiagramDocument } from '@pragmatic-lab/mural/framework'

import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { DiagramDocumentFactory } from '../diagram-document-factory.js'

// Storage-facing behavior against a FakeStorage — no Electron, no disk.
function factory(): DiagramDocumentFactory
{
    return new DiagramDocumentFactory(new ServiceProvider())
}

test('newFile returns a project-relative .diagram path and writes an empty scene', async () => {
    const storage = new FakeStorage()
    const path = await factory().newFile(storage, 'city.diagram')
    expect(path).toBe('city.diagram')
    expect(await storage.Exists('city.diagram')).toBe(true)
})

test('newFile appends .diagram when the name omits it', async () => {
    const storage = new FakeStorage()
    const path = await factory().newFile(storage, 'city')
    expect(path).toBe('city.diagram')
})

test('openFile round-trips a diagram written by newFile, titled by basename', async () => {
    const storage = new FakeStorage()
    const f = factory()
    const path = await f.newFile(storage, 'city')
    const doc = await f.openFile(storage, path)
    expect(doc).toBeInstanceOf(DiagramDocument)
    expect(doc.Title).toBe('city.diagram')
})

test('relocateOpenFile retitles the open document to the new basename', async () => {
    const storage = new FakeStorage()
    const f = factory()
    const doc = await f.openFile(storage, await f.newFile(storage, 'city'))
    f.relocateOpenFile(doc, 'renamed.diagram')
    expect(doc.Title).toBe('renamed.diagram')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/diagram/services/tests/diagram-document-factory.test.ts`
Expected: FAIL — cannot resolve `../diagram-document-factory.js`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/src/modules/diagram/services/diagram-document-factory.ts` (the `.diagram` I/O lifted from `DiagramProjectFactory`, with `newFile` dropping the format arg):

```ts
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { DiagramDocument, type IDocument } from '@pragmatic-lab/mural/framework'

import type { IDocumentFactory, IRelocatableDocumentFactory } from '../../../services/documents/document-factory.js'
import type { IStorage } from '../../../services/storage/storage.js'
import { FileDiagramStorage } from '../persistence/file-diagram-storage.js'

// The `.diagram` editor: a diagram file is a DiagramDocument persisted through
// mural's native Save()/Load() over a FileDiagramStorage (the full scene
// round-trips). Contributed as the DocumentDefinition.Factory for the diagram
// module's `.documents:` entry; the ProjectExplorerService resolves it by the
// `.diagram` extension and delegates. All persistence flows through the
// project's IStorage (rooted, project-relative paths).
export class DiagramDocumentFactory extends ServiceBase implements IDocumentFactory, IRelocatableDocumentFactory
{
    public static readonly Key = new ServiceKey<DiagramDocumentFactory>('DiagramDocumentFactory')

    constructor(provider: IServiceProvider) { super(provider) }

    public async openFile(storage: IStorage, path: string): Promise<IDocument>
    {
        const text = await storage.ReadText(path)
        const store = new FileDiagramStorage(path, storage, text)
        const doc = new DiagramDocument(store)
        doc.Load()
        doc.Title = basename(path)
        return doc
    }

    public async saveFile(document: IDocument): Promise<void>
    {
        const doc = document as DiagramDocument
        doc.Save()
        const store = doc.Storage
        if (store instanceof FileDiagramStorage) await store.WhenWritten()
    }

    // Re-point an open diagram after its file was renamed on storage: re-target
    // the FileDiagramStorage (so later Save()s write to the new path) and retitle
    // the tab. The in-memory scene is untouched.
    public relocateOpenFile(document: IDocument, newPath: string): void
    {
        const doc = document as DiagramDocument
        const store = doc.Storage
        if (store instanceof FileDiagramStorage) store.Path = newPath
        doc.Title = basename(newPath)
    }

    public async newFile(storage: IStorage, name: string): Promise<string>
    {
        const path = ensureExtension(name, '.diagram')   // project-relative, at the root
        const store = new FileDiagramStorage(path, storage, null)
        const doc = new DiagramDocument(store)
        doc.Save()   // writes an empty scene
        await store.WhenWritten()
        return path
    }
}

function basename(p: string): string
{
    const parts = p.split(/[\\/]/)
    return parts[parts.length - 1] || p
}

function ensureExtension(name: string, ext: string): string
{
    return name.toLowerCase().endsWith(ext) ? name : name + ext
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/diagram/services/tests/diagram-document-factory.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/diagram/services/diagram-document-factory.ts src/renderer/src/modules/diagram/services/tests/diagram-document-factory.test.ts
git commit -m "feat(diagram): add DiagramDocumentFactory (.diagram editor)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `TodlDocumentFactory`

**Files:**
- Create: `src/renderer/src/modules/meta-model/services/todl-document-factory.ts`
- Test: `src/renderer/src/modules/meta-model/services/tests/todl-document-factory.test.ts`

**Interfaces:**
- Consumes: `IDocumentFactory`, `IRelocatableDocumentFactory` (Task 1); `IDocument` (`@pragmatic-lab/mural/framework`); `CodeDocument` (`../../code-editor/code-document.js`); `StorageCodeFile` (`../../code-editor/code-file.js`); `MetaModelValidationService` (`./meta-model-validation-service.js`); `IStorage`; `ServiceBase`, `ServiceKey`, `IServiceProvider`.
- Produces: `class TodlDocumentFactory extends ServiceBase implements IDocumentFactory, IRelocatableDocumentFactory` with static `Key`; `openFile(storage, path)` (creates a `CodeDocument`, attaches to the validator if present), `saveFile(document)`, `newFile(storage, name)`, `relocateOpenFile(document, newPath)`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/modules/meta-model/services/tests/todl-document-factory.test.ts`:

```ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'

import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { CodeDocument } from '../../../code-editor/code-document.js'
import { TodlDocumentFactory } from '../todl-document-factory.js'

// The validator is optional (resolved with get, not getRequired) — absent here.
function factory(): TodlDocumentFactory
{
    return new TodlDocumentFactory(new ServiceProvider())
}

test('newFile creates a project-relative .todl and openFile returns a todl CodeDocument', async () => {
    const storage = new FakeStorage()
    const f = factory()
    const path = await f.newFile(storage, 'core')
    expect(path).toBe('core.todl')
    expect(await storage.Exists('core.todl')).toBe(true)

    const doc = await f.openFile(storage, path)
    expect(doc).toBeInstanceOf(CodeDocument)
    expect((doc as CodeDocument).Language).toBe('todl')
    expect(doc.Title).toBe('core.todl')
})

test('newFile keeps an explicit .todl extension', async () => {
    const storage = new FakeStorage()
    const path = await factory().newFile(storage, 'core.todl')
    expect(path).toBe('core.todl')
})

test('saveFile writes the document text back to storage', async () => {
    const storage = new FakeStorage()
    const f = factory()
    const path = await f.newFile(storage, 'core')
    const doc = (await f.openFile(storage, path)) as CodeDocument
    doc.Text = 'namespace n {}'
    await f.saveFile(doc)
    expect(await storage.ReadText('core.todl')).toBe('namespace n {}')
})
```

Note: `CodeDocument` exposes a writable `Text` and a `Language` getter, and `StorageCodeFile` reads/writes through the storage — confirm the `Text` member name against `code-document.ts` when implementing; if the setter differs (e.g. `SetText`), adjust the test's `doc.Text = …` line to match. The round-trip assertion is the contract; the member name is incidental.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/todl-document-factory.test.ts`
Expected: FAIL — cannot resolve `../todl-document-factory.js`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/src/modules/meta-model/services/todl-document-factory.ts` (the `.todl` I/O lifted from `MetaModelProjectFactory`, `newFile` dropping the format arg):

```ts
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import type { IDocument } from '@pragmatic-lab/mural/framework'

import type { IDocumentFactory, IRelocatableDocumentFactory } from '../../../services/documents/document-factory.js'
import type { IStorage } from '../../../services/storage/storage.js'
import { CodeDocument } from '../../code-editor/code-document.js'
import { StorageCodeFile } from '../../code-editor/code-file.js'
import { MetaModelValidationService } from './meta-model-validation-service.js'

// The `.todl` editor: a definition file is plain-text TODL edited in the Monaco
// CodeEditor (a CodeDocument over the project's IStorage). Contributed as the
// DocumentDefinition.Factory for the meta-model module's `.documents:` entry; the
// ProjectExplorerService resolves it by the `.todl` extension and delegates.
export class TodlDocumentFactory extends ServiceBase implements IDocumentFactory, IRelocatableDocumentFactory
{
    public static readonly Key = new ServiceKey<TodlDocumentFactory>('TodlDocumentFactory')

    constructor(provider: IServiceProvider) { super(provider) }

    public async openFile(storage: IStorage, path: string): Promise<IDocument>
    {
        // A .todl file is a CodeDocument over the project storage; its language
        // resolves to 'todl' from the extension. The project-relative path is the
        // document's Id — what whole-project validation keys diagnostics by.
        const doc = new CodeDocument(new StorageCodeFile(storage, path))
        // Register the document + its project storage with the validator so it
        // gets live squiggles within its own project's file set. Optional (`get`,
        // not `getRequired`) — absent in unit tests.
        this.Provider.get(MetaModelValidationService.Key)?.AttachDocument(doc, storage)
        return doc
    }

    public async saveFile(document: IDocument): Promise<void>
    {
        await (document as CodeDocument).Save()
    }

    // Re-point an open .todl document after its file was renamed on storage: the
    // CodeDocument re-targets its StorageCodeFile and refreshes Id/Title/Language.
    // The validator tracks the document by instance and reads its Id live, so no
    // re-registration is needed.
    public relocateOpenFile(document: IDocument, newPath: string): void
    {
        (document as CodeDocument).Relocate(newPath)
    }

    public async newFile(storage: IStorage, name: string): Promise<string>
    {
        const path = ensureExtension(name, '.todl')   // project-relative, at the root
        await storage.WriteText(path, '')
        return path
    }
}

function ensureExtension(name: string, ext: string): string
{
    return name.toLowerCase().endsWith(ext) ? name : name + ext
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/todl-document-factory.test.ts`
Expected: PASS (3 tests). If the `Text` member name differed, this is where you reconciled it in Step 1.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/meta-model/services/todl-document-factory.ts src/renderer/src/modules/meta-model/services/tests/todl-document-factory.test.ts
git commit -m "feat(meta-model): add TodlDocumentFactory (.todl editor)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `ArchitectureProjectFactory` (architecture project type)

Lift the `architecture` project lifecycle out of `DiagramProjectFactory` into its own factory, owned by the architecture-repository module. This is additive — `DiagramProjectFactory` still exists (deleted in Task 5); this task registers no `.projectFactories:` yet (registry ignores a duplicate `architecture` type, so wiring waits for the cutover).

**Files:**
- Create: `src/renderer/src/modules/architecture-repository/services/architecture-project-factory.ts`
- Test: `src/renderer/src/modules/architecture-repository/services/tests/architecture-project-factory.test.ts`

**Interfaces:**
- Consumes: `IProjectFactory`, `ProjectFileFormat`, `ProjectManifestEnvelope`, `PROJECT_MANIFEST_FILENAME` (`../../../services/projects/project-factory.js`); `Project`, `ProjectNode`, `ProjectNodeKind` (`../../../services/projects/project.js`); `compareStorageEntries`, `IStorage` (`../../../services/storage/storage.js`); `ServiceBase`, `ServiceKey`, `IServiceProvider`.
- Produces: `class ArchitectureProjectFactory extends ServiceBase implements IProjectFactory` with static `Key` and static `ProjectType = 'architecture'`; `formats = [{ extension: '.diagram', kind: 'diagram', displayName: 'Diagram' }]`; `createProject`, `openProject`, `saveProject`. No file I/O — that lives on `DiagramDocumentFactory`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/modules/architecture-repository/services/tests/architecture-project-factory.test.ts` (ported lifecycle assertions from the old diagram-project-factory test):

```ts
import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'

import { PROJECT_MANIFEST_FILENAME } from '../../../../services/projects/project-factory.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { ArchitectureProjectFactory } from '../architecture-project-factory.js'

function factory(): ArchitectureProjectFactory
{
    return new ArchitectureProjectFactory(new ServiceProvider())
}

test('createProject writes an architecture manifest and returns the project', async () => {
    const storage = new FakeStorage('fake://Acme')
    const project = await factory().createProject(storage, 'Acme')

    expect(project.Type).toBe('architecture')
    expect(project.Name).toBe('Acme')
    const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
    expect(manifest.type).toBe('architecture')
    expect(manifest.name).toBe('Acme')
})

test('openProject scans storage into a tree, hiding the manifest', async () => {
    const storage = new FakeStorage()
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'architecture', name: 'P' }))
    await storage.WriteText('diagrams/city.diagram', '{}')
    await storage.WriteText('notes.txt', 'hi')

    const project = await factory().openProject(storage)
    const names = project.Root.Children.ToArray().map((n) => n.Name)
    expect(names).toContain('diagrams')
    expect(names).toContain('notes.txt')
    expect(names).not.toContain(PROJECT_MANIFEST_FILENAME)

    const diagramsFolder = project.Root.Children.ToArray().find((n) => n.Name === 'diagrams')!
    expect(diagramsFolder.Kind).toBe('folder')
    const cityDiagram = diagramsFolder.Children.ToArray()[0]
    expect(cityDiagram.Kind).toBe('diagram')
    expect(cityDiagram.Path).toBe('diagrams/city.diagram')   // project-relative
    const notes = project.Root.Children.ToArray().find((n) => n.Name === 'notes.txt')!
    expect(notes.Kind).toBe('file')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-repository/services/tests/architecture-project-factory.test.ts`
Expected: FAIL — cannot resolve `../architecture-project-factory.js`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/src/modules/architecture-repository/services/architecture-project-factory.ts` (the lifecycle half of the old `DiagramProjectFactory`, with `formats` retained and all file I/O removed):

```ts
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'

import {
    PROJECT_MANIFEST_FILENAME,
    type IProjectFactory,
    type ProjectFileFormat,
    type ProjectManifestEnvelope,
} from '../../../services/projects/project-factory.js'
import { Project, ProjectNode, type ProjectNodeKind } from '../../../services/projects/project.js'
import { compareStorageEntries, type IStorage } from '../../../services/storage/storage.js'

// The 'architecture' project type — the architecture-repository module's
// contribution to the generic ProjectExplorerService (declared via
// `.projectFactories:`, resolved through the ProjectFactoryRegistry). It owns the
// project lifecycle only: a folder whose manifest type is "architecture" scans
// into a tree, with `.diagram` files marked openable. The `.diagram` FILE format
// is edited by the diagram module's DiagramDocumentFactory (resolved by
// extension) — editors own files, this factory owns the project.
//
// All persistence flows through the project's IStorage (rooted, project-relative
// paths); the factory never sees an absolute path or the raw file system.
interface ArchitectureManifest extends ProjectManifestEnvelope {}

export class ArchitectureProjectFactory extends ServiceBase implements IProjectFactory
{
    public static readonly Key = new ServiceKey<ArchitectureProjectFactory>('ArchitectureProjectFactory')
    public static readonly ProjectType = 'architecture'

    public readonly formats: readonly ProjectFileFormat[] = [
        { extension: '.diagram', kind: 'diagram', displayName: 'Diagram' },
    ]

    constructor(provider: IServiceProvider) { super(provider) }

    public async createProject(storage: IStorage, name: string): Promise<Project>
    {
        const manifest: ArchitectureManifest = { type: ArchitectureProjectFactory.ProjectType, name, version: 1 }
        await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))
        return this.buildProject(storage, manifest)
    }

    public async openProject(storage: IStorage): Promise<Project>
    {
        const text = await storage.ReadText(PROJECT_MANIFEST_FILENAME)
        const manifest = JSON.parse(text) as ArchitectureManifest
        return this.buildProject(storage, manifest)
    }

    public async saveProject(project: Project, storage: IStorage): Promise<void>
    {
        const manifest: ArchitectureManifest = { type: project.Type, name: project.Name, version: 1 }
        await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))
    }

    private async buildProject(storage: IStorage, manifest: ArchitectureManifest): Promise<Project>
    {
        const rootName = basename(storage.Root)
        const root = new ProjectNode(rootName, '', 'folder')   // the root node's path is ''
        await this.populate(storage, root)
        return new Project(manifest.type, manifest.name ?? rootName, storage.Root, root)
    }

    // Recursively fill a folder node's children from storage. The manifest file
    // is hidden; `.diagram` files are marked openable (kind 'diagram'). Node paths
    // are project-relative (POSIX `/`); the root node's path is ''.
    private async populate(storage: IStorage, node: ProjectNode): Promise<void>
    {
        const entries = [...await storage.List(node.Path)].sort(compareStorageEntries)
        for (const e of entries) {
            if (node.Path === '' && e.Name === PROJECT_MANIFEST_FILENAME) continue
            const childPath = joinRel(node.Path, e.Name)
            const kind: ProjectNodeKind = e.IsDirectory
                ? 'folder'
                : extname(e.Name) === '.diagram' ? 'diagram' : 'file'
            const child = new ProjectNode(e.Name, childPath, kind)
            node.Children.Add(child)
            if (e.IsDirectory) await this.populate(storage, child)
        }
    }
}

// ── project-relative path helpers (POSIX `/`; the storage backend translates) ──
function joinRel(dir: string, name: string): string
{
    return dir === '' ? name : dir + '/' + name
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/architecture-repository/services/tests/architecture-project-factory.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/architecture-repository/services/architecture-project-factory.ts src/renderer/src/modules/architecture-repository/services/tests/architecture-project-factory.test.ts
git commit -m "feat(architecture): add ArchitectureProjectFactory (architecture project type)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Wire document routing end-to-end; move `architecture` off the diagram module

The cutover. `ProjectExplorerService` stops calling `op.Factory.openFile/saveFile/newFile/relocateOpenFile` and resolves an `IDocumentFactory` by extension via `DocumentTypeRegistry` (registered as a root service so its constructor auto-populates from `.documents:` blocks). `DiagramProjectFactory` is deleted; the diagram module contributes the `.diagram` editor via `.documents:`; the architecture-repository module registers `ArchitectureProjectFactory` for the `architecture` project type; the meta-model module gains a `.documents:` block. `IProjectFactory` still carries its (now unused) file-I/O methods after this task — removed in Task 6, keeping this diff focused on routing.

**Files:**
- Modify: `src/renderer/src/modules/project-explorer/services/project-explorer-service.ts`
- Modify: `src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts`
- Modify: `src/renderer/src/modules/diagram/diagram.module.mu` (+ regenerate `.mu.js`)
- Modify: `src/renderer/src/modules/architecture-repository/architecture-repository.module.mu` (+ regenerate `.mu.js`)
- Modify: `src/renderer/src/modules/meta-model/meta-model.module.mu` (+ regenerate `.mu.js`)
- Modify: `src/renderer/src/app.mu` (+ regenerate `.mu.js`)
- Delete: `src/renderer/src/modules/diagram/services/diagram-project-factory.ts`
- Delete: `src/renderer/src/modules/diagram/services/tests/diagram-project-factory.test.ts`

**Interfaces:**
- Consumes: `DocumentTypeRegistry` (`@pragmatic-lab/mural/framework`); `IDocumentFactory`, `isRelocatable` (Task 1); `DiagramDocumentFactory` (Task 2); `TodlDocumentFactory` (Task 3); `ArchitectureProjectFactory` (Task 4).
- Produces: `ProjectExplorerService.resolveDocumentFactory(ext: string): IDocumentFactory | undefined` (private); rewired `openNode`, `openDocument`, `saveActive`, `newFileIn`, `repointOpenDocuments`.

- [ ] **Step 1: Rewrite the explorer test harness (failing test)**

In `tests/project-explorer-service.test.ts`, replace the imports block (lines 1–14) — add `DocumentTypeRegistry` and the document-factory types, drop `IRelocatableFileFactory`:

```ts
import { test, expect } from 'vitest'
import { Key, ServiceProvider, type KeyEventArgs } from '@pragmatic-lab/mural/runtime'
import { ContentHostService, DialogService, DocumentsContentHostService, DocumentTypeRegistry, ProjectFactoryRegistry, type IDocument } from '@pragmatic-lab/mural/framework'

import { EnvironmentService } from '../../../../services/environment/environment-service.js'
import { FileSystemService } from '../../../../services/file-system/file-system-service.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { Project, ProjectNode } from '../../../../services/projects/project.js'
import { OpenProject } from '../../../../services/projects/open-project.js'
import { OpenProjectsStore } from '../../../../services/projects/open-projects-store.js'
import { PROJECT_MANIFEST_FILENAME, type IProjectFactory, type IPublishableProjectFactory } from '../../../../services/projects/project-factory.js'
import type { IDocumentFactory, IRelocatableDocumentFactory } from '../../../../services/documents/document-factory.js'
import { ConfirmDialogModel } from '../../../../services/dialogs/confirm-dialog-model.js'
import { ProjectExplorerService, importFilters, uniqueStorageName } from '../project-explorer-service.js'
```

Replace the `Rec` interface + `fakeFactory` (lines 20–39) with a split project factory + a shared recording document factory. `TodlDocFactoryToken` is a marker class used only as a service token:

```ts
// A picked file as the OS dialog would hand it back (absolute path + raw bytes).
type Picked = { Path: string; Bytes: Uint8Array }
const bytesOf = (s: string): Uint8Array => new TextEncoder().encode(s)

// Editors own files, not projects. The document factory (below) records file
// I/O; a project factory now provides only lifecycle + formats + publish.
interface Rec { opened: string[]; saved: IDocument[]; relocated: Array<[IDocument, string]> }

// A marker class: the DocumentDefinition.Factory token the explorer resolves for
// the `.todl` extension. Registered in the provider to a recording fake below.
class TodlDocFactoryToken {}

function fakeDocFactory(rec: Rec): IDocumentFactory & IRelocatableDocumentFactory
{
    const doc = (id: string): IDocument => ({ Id: id, Title: id, IsDirty: false, Save() {} })
    return {
        openFile: async (_s, path) => { rec.opened.push(path); return doc(path) },
        saveFile: async (d) => { rec.saved.push(d) },
        newFile: async (_s, name) => (name.endsWith('.todl') ? name : `${name}.todl`),
        relocateOpenFile: (d, newPath) => { rec.relocated.push([d, newPath]) },
    }
}

// A project factory: lifecycle + one 'todl' format + optional publish. No file
// I/O — that lives on the document factory, resolved by extension.
function fakeProjectFactory(publishable = true): IProjectFactory
{
    const base: IProjectFactory = {
        formats: [{ extension: '.todl', kind: 'todl', displayName: 'TODL Definition' }],
        createProject: async (_s, name) => projectWith(name, 'C:/x'),
        openProject: async () => projectWith('P', 'C:/x'),
        saveProject: async () => {},
    }
    if (!publishable) return base
    const pub: IProjectFactory & IPublishableProjectFactory = { ...base, publish: async () => ({ ok: true, message: 'Published.' }) }
    return pub
}
```

Update `makeExplorer` (lines 85–104) to register the recording document factory + a fake `DocumentTypeRegistry`, and return `rec`:

```ts
function makeExplorer(openFiles: Picked[] | null = null, confirm = true): {
    service: ProjectExplorerService
    host: DocumentsContentHostService
    store: OpenProjectsStore
    priv: ExplorerPrivates
    shownDialogs: unknown[]
    rec: Rec
}
{
    const provider = new ServiceProvider()
    const host = new DocumentsContentHostService(provider)
    provider.registerInstance(ContentHostService.Key, host)
    provider.registerInstance(FileSystemService.Key, fakeFs(openFiles))
    provider.registerInstance(EnvironmentService.Key, { UserDataDirectory: '/data' } as unknown as EnvironmentService)
    const shownDialogs: unknown[] = []
    provider.registerInstance(DialogService.Key, fakeDialogs(confirm, shownDialogs))
    const store = new OpenProjectsStore(provider)
    provider.registerInstance(OpenProjectsStore.Key, store)
    // Editor routing: a recording `.todl` document factory + a registry that
    // resolves the extension to its token.
    const rec: Rec = { opened: [], saved: [], relocated: [] }
    provider.registerInstance(ServiceProvider.tokenFor(TodlDocFactoryToken), fakeDocFactory(rec))
    provider.registerInstance(DocumentTypeRegistry.Key, {
        GetByExtension: (ext: string) => (ext === '.todl' ? { Factory: TodlDocFactoryToken } : undefined),
    } as unknown as DocumentTypeRegistry)
    const service = new ProjectExplorerService(provider)
    return { service, host, store, priv: service as unknown as ExplorerPrivates, shownDialogs, rec }
}
```

Rewrite the "opens through its OWN project factory" test (lines 122–133) — its premise is the coupling we removed:

```ts
test('opening a node opens it through the registered document editor', async () => {
    const { priv, host, rec } = makeExplorer()
    await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), new FakeStorage('C:/a'))
    const opB = await priv.addOpenProject(projectWith('B', 'C:/b'), fakeProjectFactory(), new FakeStorage('C:/b'))

    await priv.openNode(childNode(opB), opB)

    expect(rec.opened).toEqual(['core.todl'])
    expect(host.OpenDocuments.Count).toBe(1)
})
```

Rewrite the save test (135–145):

```ts
test('the active document saves through the registered document editor', async () => {
    const { host, priv, rec } = makeExplorer()
    const opA = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), new FakeStorage('C:/a'))

    await priv.openNode(childNode(opA), opA)
    host.ActiveDocument = host.OpenDocuments.ToArray()[0]

    await priv.saveActive()
    expect(rec.saved.length).toBe(1)
})
```

Rewrite the New-File test (288–297):

```ts
test('New File in a subfolder is created and opened under that folder', async () => {
    const { priv, rec } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.CreateDirectory('src')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.newFileIn(op, 'src')
    expect(rec.opened).toEqual(['src/todl.todl'])
})
```

Rewrite the relocate test (361–375):

```ts
test('renaming an open file re-points its document to the new path', async () => {
    const { priv, rec } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('core.todl', 'x')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)
    const node = childNode(op)
    await priv.openNode(node, op)   // opens core.todl → tracked as an open document

    priv.beginRename(op, node)
    node.EditingName = 'renamed.todl'
    await priv.commitRename(op, node)

    expect(rec.relocated.map(([, p]) => p)).toEqual(['renamed.todl'])
})
```

Rewrite the Publish test (162–170):

```ts
test('Publish is disabled for a non-publishable project', async () => {
    const { priv } = makeExplorer()
    const pub = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(true), new FakeStorage('C:/a'))
    const plain = await priv.addOpenProject(projectWith('B', 'C:/b'), fakeProjectFactory(false), new FakeStorage('C:/b'))

    expect(pub.PublishCommand!.CanExecute(undefined)).toBe(true)
    expect(plain.PublishCommand!.CanExecute(undefined)).toBe(false)
})
```

For every remaining test, substitute `fakeFactory(rec)` and `fakeFactory({ opened: [], saved: [] })` → `fakeProjectFactory()`, and delete any now-unused per-test `const rec: Rec = …` line. This covers the dedupe test (114–116), close test (150), Add-Existing tests (216, 231, 243), New-Folder tests (269, 282), container-aware test (305), and every delete/rename test (318, 334, 350, 380, 423, 438, 449, 466, 480, 493, 508, 524, 536). The `RestoreSession` test (172–206) exercises only project lifecycle and needs no document registry — leave it unchanged.

- [ ] **Step 2: Run the explorer test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts`
Expected: FAIL — `ProjectExplorerService` still calls `op.Factory.openFile` (absent on `fakeProjectFactory`) and `resolveDocumentFactory` isn't implemented.

- [ ] **Step 3: Rewire `ProjectExplorerService`**

Edit `project-explorer-service.ts`.

3a. Add `DocumentTypeRegistry` to the mural/framework import (lines 31–37):

```ts
import {
    ContentHostService,
    DialogService,
    DocumentTypeRegistry,
    ProjectFactoryRegistry,
    type DocumentsContentHostService,
    type IDocument,
} from '@pragmatic-lab/mural/framework'
```

3b. Change the project-factory import (lines 40–47) to drop `isRelocatable` and add the document-factory import after it:

```ts
import {
    PROJECT_MANIFEST_FILENAME,
    isPublishable,
    type IProjectFactory,
    type ProjectFileFormat,
    type ProjectManifestEnvelope,
} from '../../../services/projects/project-factory.js'
import { isRelocatable, type IDocumentFactory } from '../../../services/documents/document-factory.js'
```

3c. Add a `resolveDocumentFactory` helper after the existing `resolveFactory` method (which stays for project lifecycle):

```ts
// Resolve the editor for a file extension via the framework DocumentTypeRegistry.
// A module contributes a DocumentDefinition whose `Factory` token resolves to an
// IDocumentFactory (see DiagramDocumentFactory / TodlDocumentFactory). Mirrors
// resolveFactory's class→token normalization. Unknown extension → undefined.
private resolveDocumentFactory(ext: string): IDocumentFactory | undefined
{
    const registry = this.Provider.get(DocumentTypeRegistry.Key)
    const def = registry?.GetByExtension(ext)
    if (def?.Factory === undefined) return undefined
    const token = ServiceProvider.tokenFor(def.Factory as unknown as new (...args: never[]) => IDocumentFactory)
    return this.Provider.get(token) as IDocumentFactory | undefined
}
```

3d. Add an `extname` helper alongside the file's existing path helpers (`basename`, `joinRel` near the bottom) if not already present:

```ts
function extname(p: string): string
{
    const i = p.lastIndexOf('.')
    return i > 0 ? p.slice(i).toLowerCase() : ''
}
```

3e. Rewrite `openNode` (lines 504–518):

```ts
private async openNode(node: ProjectNode, op: OpenProject): Promise<void>
{
    if (node.Kind === 'folder') return
    const factory = this.resolveDocumentFactory(extname(node.Path))
    try {
        if (factory !== undefined) {
            await this.openDocument(op, node.Path, factory)
            this.Status = `Opened ${node.Name}.`
        } else if (isLocalFileAccess(op.Storage)) {
            await op.Storage.OpenExternal(node.Path)
        } else {
            this.Status = `Can't open ${node.Name} — no editor for its type.`
        }
    } catch (e) {
        this.Status = `Open failed: ${(e as Error).message}`
    }
}
```

3f. Rewrite `openDocument` (lines 521–527) to take the resolved factory:

```ts
private async openDocument(op: OpenProject, path: string, factory: IDocumentFactory): Promise<void>
{
    const doc = await factory.openFile(op.Storage, path)
    this.docOwners.set(doc, op)
    this.docPaths.set(doc, path)
    this.host.Open(doc)
}
```

3g. Rewrite `saveActive` (lines 529–541):

```ts
private async saveActive(): Promise<void>
{
    const doc: IDocument | undefined = this.host.ActiveDocument
    const op = doc === undefined ? undefined : this.docOwners.get(doc)
    const path = doc === undefined ? undefined : this.docPaths.get(doc)
    if (doc === undefined || op === undefined || path === undefined) { this.Status = 'Nothing to save.'; return }
    const factory = this.resolveDocumentFactory(extname(path))
    if (factory === undefined) { this.Status = `Can't save ${doc.Title} — no editor.`; return }
    try {
        await factory.saveFile(doc)
        this.Status = `Saved ${doc.Title}.`
    } catch (e) {
        this.Status = `Save failed: ${(e as Error).message}`
    }
}
```

3h. Rewrite `newFileIn` (lines 252–267) — resolve the editor from the project's curated format, drop the format arg:

```ts
private async newFileIn(op: OpenProject, parentFolder = ''): Promise<void>
{
    const format = op.Factory.formats[0]
    if (format === undefined) { this.Status = 'This project type has no file format.'; return }
    const factory = this.resolveDocumentFactory(format.extension)
    if (factory === undefined) { this.Status = `No editor for ${format.extension}.`; return }
    try {
        const name = await uniqueStorageName(op.Storage, joinRel(parentFolder, `${format.kind}${format.extension}`))
        const path = await factory.newFile(op.Storage, name)
        // Refresh the project's tree so the new file appears, then open it.
        op.Adopt(await op.Factory.openProject(op.Storage))
        this.wireNodes(op.Root, op)
        await this.openDocument(op, path, factory)
        this.Status = `New ${format.displayName} at ${basename(path)}.`
    } catch (e) {
        this.Status = `New file failed: ${(e as Error).message}`
    }
}
```

3i. Rewrite `repointOpenDocuments` (lines 462–474) — resolve the editor per moved document:

```ts
private repointOpenDocuments(op: OpenProject, oldPath: string, newPath: string): void
{
    for (const [doc, path] of [...this.docPaths]) {
        if (this.docOwners.get(doc) !== op) continue
        const moved = path === oldPath ? newPath
            : path.startsWith(oldPath + '/') ? newPath + path.slice(oldPath.length)
                : undefined
        if (moved === undefined) continue
        const factory = this.resolveDocumentFactory(extname(moved))
        if (factory !== undefined && isRelocatable(factory)) factory.relocateOpenFile(doc, moved)
        this.docPaths.set(doc, moved)
    }
}
```

- [ ] **Step 4: Run the explorer test to verify it passes**

Run: `npx vitest run src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts`
Expected: PASS. A leftover `fakeFactory(` reference fails compilation — replace it with `fakeProjectFactory()`.

- [ ] **Step 5: Delete `DiagramProjectFactory` and rewire the diagram module**

```bash
git rm src/renderer/src/modules/diagram/services/diagram-project-factory.ts
git rm src/renderer/src/modules/diagram/services/tests/diagram-project-factory.test.ts
```

Edit `src/renderer/src/modules/diagram/diagram.module.mu`:

- Replace the import (line 21) `import DiagramProjectFactory from "./services/diagram-project-factory.js"` with:
  ```
  import DiagramDocumentFactory from "./services/diagram-document-factory.js"
  ```
- In `.services:` (lines 24–29) replace `DiagramProjectFactory` with `DiagramDocumentFactory`.
- Delete the entire `.projectFactories:` block (lines 31–40, including its leading comment).
- Set the `Factory` on the `.documents:` `DocumentDefinition` (lines 74–81):
  ```
  .documents: {
      DocumentDefinition
          [ Type            = "diagram",
            Title           = "Diagram",
            Description     = "A node-and-connector diagram.",
            FileExtensions  = [".diagram"],
            Factory         = DiagramDocumentFactory,
            CommandContexts = [DiagramEditingContext] ]
  }
  ```

- [ ] **Step 6: Register `ArchitectureProjectFactory` on the architecture-repository module**

Edit `src/renderer/src/modules/architecture-repository/architecture-repository.module.mu`:

- Add an import under line 10:
  ```
  import ArchitectureProjectFactory from "./services/architecture-project-factory.js"
  ```
- Add `ArchitectureProjectFactory` to `.services:`:
  ```
  .services: {
      ArchitectureRepositoryService
      ArchitectureProjectFactory
  }
  ```
- Add a `.projectFactories:` block after `.services:`:
  ```
  .projectFactories: {
      ProjectFactoryDefinition
          [ Type    = "architecture",
            Title   = "Architecture Project",
            Factory = ArchitectureProjectFactory ]
  }
  ```

- [ ] **Step 7: Add `.documents:` + `TodlDocumentFactory` to the meta-model module**

Edit `src/renderer/src/modules/meta-model/meta-model.module.mu`:

- Add an import under line 16:
  ```
  import TodlDocumentFactory from "./services/todl-document-factory.js"
  ```
- Add `TodlDocumentFactory` to `.services:`:
  ```
  .services: {
      MetaModelProjectFactory
      MetaModelValidationService
      TodlDocumentFactory
  }
  ```
- Add a `.documents:` block after the `.projectFactories:` block:
  ```
  .documents: {
      DocumentDefinition
          [ Type           = "todl",
            Title          = "TODL",
            Description    = "A TODL definition source file.",
            FileExtensions = [".todl"],
            Factory        = TodlDocumentFactory ]
  }
  ```

- [ ] **Step 8: Register `DocumentTypeRegistry` as a root service in `app.mu`**

Edit `src/renderer/src/app.mu`. In `.services:`, add `DocumentTypeRegistry` immediately after `ProjectFactoryRegistry` (bare, no import — the mural compiler resolves framework services from its default symbol table, exactly as for `ProjectFactoryRegistry`):

```
        ProjectFactoryRegistry
        DocumentTypeRegistry
```

- [ ] **Step 9: Recompile the modules**

Run: `npm run compile:mu`
Expected: exits 0; `diagram.module.mu.js`, `architecture-repository.module.mu.js`, `meta-model.module.mu.js`, and `app.mu.js` are regenerated. If it errors on an unresolved `DocumentTypeRegistry` symbol, add an explicit import to `app.mu` mirroring the settings imports (`import DocumentTypeRegistry from "@pragmatic-lab/mural/framework"`) and re-run.

- [ ] **Step 10: Typecheck and run the full suite**

Run: `npm run typecheck`
Expected: PASS. (`IProjectFactory` still declares file-I/O methods, so `MetaModelProjectFactory` still satisfies it; those are removed in Task 6.)

Run: `npm test`
Expected: PASS. The deleted `diagram-project-factory.test.ts` is gone; `architecture-project-factory` + `diagram-document-factory` + `todl-document-factory` + the rewritten explorer tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/renderer/src/modules/project-explorer/services/project-explorer-service.ts \
        src/renderer/src/modules/project-explorer/services/tests/project-explorer-service.test.ts \
        src/renderer/src/modules/diagram/diagram.module.mu src/renderer/src/modules/diagram/diagram.module.mu.js \
        src/renderer/src/modules/architecture-repository/architecture-repository.module.mu src/renderer/src/modules/architecture-repository/architecture-repository.module.mu.js \
        src/renderer/src/modules/meta-model/meta-model.module.mu src/renderer/src/modules/meta-model/meta-model.module.mu.js \
        src/renderer/src/app.mu src/renderer/src/app.mu.js
git add -u src/renderer/src/modules/diagram/services/
git commit -m "refactor(explorer): route file open/save/new by extension; move architecture type to its module

Editors own files, not projects: ProjectExplorerService resolves an
IDocumentFactory by extension instead of calling the project factory.
DiagramDocumentFactory/TodlDocumentFactory are contributed via .documents:.
DiagramProjectFactory is deleted; the architecture project type moves to the
architecture-repository module (ArchitectureProjectFactory). DocumentTypeRegistry
registered as a root service.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Verify the stray ontologies-service.ts was NOT staged: `git status --short` must not list it as staged.

---

## Task 6: Slim `IProjectFactory`; drop dead file-I/O from `MetaModelProjectFactory`

With the explorer no longer calling file-I/O on project factories, remove those methods from the interface and from `MetaModelProjectFactory`.

**Files:**
- Modify: `src/renderer/src/services/projects/project-factory.ts`
- Modify: `src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts`
- Modify: `src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts`

**Interfaces:**
- Produces: `IProjectFactory` reduced to `{ formats; createProject; openProject; saveProject }`. `IRelocatableFileFactory` and the project-factory `isRelocatable` are removed. `IPublishableProjectFactory` / `isPublishable` unchanged.

- [ ] **Step 1: Update the meta-model factory test to drop the file-I/O case**

In `tests/meta-model-project-factory.test.ts`, delete the test at lines 68–79 (`'newFile creates a project-relative .todl and openFile returns a todl CodeDocument'`) — that behavior lives in `todl-document-factory.test.ts` now. Remove the now-unused `CodeDocument` import (line 8). Keep the create/open/publish tests.

- [ ] **Step 2: Slim `IProjectFactory`**

Edit `project-factory.ts`:

- Remove the three file-lifecycle methods from `IProjectFactory` (the `openFile`/`saveFile`/`newFile` block and its comment). The interface becomes:

```ts
export interface IProjectFactory
{
    readonly formats: readonly ProjectFileFormat[]

    // Project lifecycle. createProject writes an initial manifest into a fresh
    // project storage; openProject reads the manifest + builds the file tree;
    // saveProject persists project-level state (the manifest). All operate on a
    // rooted IStorage (project-relative paths).
    createProject(storage: IStorage, name: string): Promise<Project>
    openProject(storage: IStorage): Promise<Project>
    saveProject(project: Project, storage: IStorage): Promise<void>
}
```

- Delete `IRelocatableFileFactory` and its `isRelocatable` guard (near the bottom, originally lines ~84–99). Publishing (`IPublishableProjectFactory`, `isPublishable`, `PublishResult`) stays.
- Remove the now-unused `IDocument` import at the top if nothing else references it (`ProjectFileFormat`/`ProjectManifestEnvelope`/`Project` imports remain).

- [ ] **Step 3: Drop dead file-I/O from `MetaModelProjectFactory`**

Edit `meta-model-project-factory.ts`:

- In the import from `project-factory.js` (lines 4–11) remove `type IRelocatableFileFactory,`.
- Change the class declaration (line 41) to drop `IRelocatableFileFactory`:
  ```ts
  export class MetaModelProjectFactory extends ServiceBase implements IProjectFactory, IPublishableProjectFactory
  ```
- Delete the `openFile`, `saveFile`, `relocateOpenFile`, and `newFile` methods (the file-I/O block, originally lines ~78–105). Keep `createProject`, `openProject`, `saveProject`, `publish`, `buildProject`, `populate`, and helpers.
- Remove now-unused imports: `type IDocument` (`@pragmatic-lab/mural/framework`), `CodeDocument`, `StorageCodeFile`, `MetaModelValidationService` — moved to `TodlDocumentFactory`. Keep `check`, `toJSON`, `Severity`, `ensureMetaModelsBackend`, `collectTodlSources`, `extname`, `joinRel`, `compareStorageEntries`, `IStorage`, `Project`/`ProjectNode`. The Step 5 compile catches any missed reference.

- [ ] **Step 4: Verify the meta-model factory test passes**

Run: `npx vitest run src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts`
Expected: PASS (create/open/publish tests only). If it FAILS because the deleted test still references `f.newFile`/`f.openFile`, you missed the Step 1 deletion — remove it.

- [ ] **Step 5: Typecheck and run the full suite**

Run: `npm run typecheck`
Expected: PASS — no consumer references the removed members (the explorer was rewired in Task 5; `DiagramProjectFactory` is gone; `ArchitectureProjectFactory` never had file I/O).

Run: `npm test`
Expected: PASS (full suite).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/services/projects/project-factory.ts \
        src/renderer/src/modules/meta-model/services/meta-model-project-factory.ts \
        src/renderer/src/modules/meta-model/services/tests/meta-model-project-factory.test.ts
git commit -m "refactor(projects): slim IProjectFactory to project lifecycle

Remove file I/O (openFile/saveFile/newFile) and IRelocatableFileFactory from
IProjectFactory now that editors own files via IDocumentFactory. MetaModelProjectFactory
keeps only lifecycle + publish.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Definition of Done

- `npm run typecheck` and `npm test` both pass.
- `npm run compile:mu` regenerates cleanly; `.mu` and `.mu.js` are committed together.
- `IProjectFactory` carries no file I/O; `IDocumentFactory` (in `services/documents/`) owns open/save/new (+ optional relocate).
- Diagram + meta-model modules contribute their editors via `.documents:` `Factory`; `DocumentTypeRegistry` is a root service.
- `DiagramProjectFactory` and its test are deleted; the `architecture` project type is owned by the architecture-repository module (`ArchitectureProjectFactory`); existing `type: "architecture"` manifests still open.
- The stray `ontologies-service.ts` was never staged.

## Manual smoke (post-merge, optional — GUI)

Not automated (Electron GUI). After merge, in a dev run (`npm run dev`): create an architecture project, add a `.diagram` (New File), edit + save it, rename it with a tab open (tab stays, re-points). Create a meta-model project, add + edit + save a `.todl`, rename with a tab open, and confirm publish still works.

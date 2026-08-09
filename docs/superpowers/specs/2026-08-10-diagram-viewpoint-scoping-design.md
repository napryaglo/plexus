# Diagram Viewpoint Scoping — Design (Sub-project 4c)

**Status:** Design. Final Plexus phase of the viewpoint-scoped multi-file
architecture model (parent: `docs/superpowers/specs/2026-08-09-viewpoint-multifile-architecture-model-design.md`,
§5 sub-project 4 + §8). Builds on SP3 (`ArchitectureModelService`/`ArchModel`),
SP4a (`ArchDiagramBinding`/`ArchDiagramBindingService`), SP4b (drop routing +
resolver).

**Date:** 2026-08-10

## 1. Goal

An architecture diagram selects which **viewpoints** it reads/writes; the
selection persists in the project manifest; the drop/read scope narrows to it
(real read-filter, replacing SP4b's "all viewpoints"). Selection is set two
ways: a modal **picker** when a `.diagram` is created, and an on-open **toggle
panel** to re-scope any time.

## 2. Decisions (from brainstorming)

- **Persistence:** the architecture project **manifest**, keyed by the diagram's
  project-relative path. The `.diagram` file stays the bare mural scene; the
  generic `DiagramDocument`/`DiagramDocumentFactory` are untouched.
- **Selection UX:** **both** — creation-time modal picker AND on-open toggle
  panel.
- **Read-filter effect:** narrows the drop candidate/routing **scope** only.
  Already-placed figures are never hidden (freeform explicit placement).
- **Default:** a diagram with no manifest entry scopes to **all** viewpoints.

## 3. Components

### 3.1 Manifest persistence (headless) — `diagram-viewpoints.ts`
`architecture-projects/services/diagram-viewpoints.ts`

```ts
readDiagramViewpoints(storage: IStorage, path: string): Promise<string[] | undefined>
writeDiagramViewpoints(storage: IStorage, path: string, viewpoints: string[]): Promise<void>
```

- Read-modify-write `PROJECT_MANIFEST_FILENAME`. The manifest gains an optional
  `diagrams?: { [relPath: string]: { viewpoints: string[] } }`.
- `read` returns `manifest.diagrams?.[path]?.viewpoints` (undefined if absent).
- `write` reads the manifest, sets `diagrams[path] = { viewpoints }`, writes it
  back — preserving `type`/`name`/`version`/`metaModel`/`libraries`. Creates the
  `diagrams` map if missing.
- `ArchitectureManifest` (in `architecture-project-factory.ts`) gains the
  `diagrams?` field so `saveProject`/`openProject` preserve it.

### 3.2 Per-diagram scope on the binding (headless)
`arch-diagram-binding.ts` + `arch-diagram-binding-service.ts`

- `ArchDiagramBinding` gains `private scope: string[]` and:
  - `setScope(viewpoints: string[]): void` — replace the scope.
  - `scopeSet(): Set<string>` — the scope as a set; when empty, **all** the
    model's viewpoints (`model.viewpoints().map(v => v.id)`).
- On attach, `ArchDiagramBindingService` reads
  `readDiagramViewpoints(op.Storage, storagePath)` (the doc's
  `FileDiagramStorage.Path`) and calls `binding.setScope(...)` (empty ⇒ default
  all via `scopeSet`).
- `ArchDiagramBindingService` exposes:
  - `scopeForDocument(doc: IDocument): Set<string> | undefined` → the binding's
    `scopeSet()`.
  - `setDocumentScope(doc: IDocument, viewpoints: string[]): Promise<void>` →
    `binding.setScope`, persist via `writeDiagramViewpoints` (using the doc's
    storage + path), then `binding.model.notifyChanged()` (so any live view
    refreshes).

### 3.3 Read-filter in the drop factory (headless)
`arch-instance-drop-factory.ts`

- Replace `const scope = new Set(model.viewpoints().map(v => v.id))` with
  `const scope = this.provider.get(ArchDiagramBindingService.Key)?.scopeForDocument(doc) ?? new Set(model.viewpoints().map(v => v.id))`.
- Thread the same `scope` into `apply` (pass it as a parameter instead of
  recomputing all viewpoints) so routing picks the first **selected** framing
  viewpoint. A term framed only by an unselected viewpoint now yields no
  candidates (rejected).

### 3.4 On-open toggle panel (live-smoke UI) — `DiagramViewpointScopeService` + resources
`architecture-projects/services/diagram-viewpoint-scope-service.ts` + `viewpoint-scope.resources.mu`

```ts
class DiagramViewpointScopeService extends ServiceBase {
  static readonly Key
  // DP: Rows: ObservableCollection<ViewpointToggleRow>   // one per project viewpoint
}
class ViewpointToggleRow extends Model { Label: string; IsSelected: boolean }  // toggle → setDocumentScope
```

- Subscribes to `ContentHostService.ActiveDocument`; when the active document is
  an architecture diagram (has a binding), rebuilds `Rows` from
  `model.viewpoints()`, each row `IsSelected` = membership in the binding's
  `scopeSet()`. Toggling a row recomputes the selected set and calls
  `ArchDiagramBindingService.setDocumentScope(doc, selected)`.
- Rendered as an Inspector-region panel via a `DataTemplate[DiagramViewpointScopeService]`
  (mirrors the layout-inspector's Inspector-region mount). Registered app-scoped
  in `app.mu`; resources merged.

### 3.5 Creation-time picker (live-smoke UI) — explorer participant seam
`services/documents/new-file-participant.ts` (seam) + `architecture-projects/services/arch-new-diagram-participant.ts`

- New seam interface in the documents layer:
  ```ts
  interface INewFileParticipant { OnCreated(op: OpenProject, path: string): Promise<void> }
  const NewFileParticipantKey = new ServiceKey<INewFileParticipant>('NewFileParticipant')
  ```
- `ProjectExplorerService.newFileIn`, after `factory.newFile(...)` and before
  `openDocument`, resolves `NewFileParticipantKey` (optional) and awaits
  `OnCreated(op, path)` when present. No-op when absent — generic explorer stays
  decoupled.
- `ArchNewDiagramParticipant` (architecture-projects) implements it: when `op`
  is an architecture project and `path` ends `.diagram`, it shows a modal
  viewpoint multi-select (a `DiagramViewpointPickerService.pick(viewpoints):
  Promise<string[] | undefined>` popup, adapting the SP4b chooser) and, on
  confirm, `writeDiagramViewpoints(op.Storage, path, chosen)`. Cancel/none →
  leave the manifest empty (defaults to all).

## 4. Data flow

```
create .diagram → newFileIn → factory.newFile → NewFileParticipant.OnCreated
  → ArchNewDiagramParticipant → picker → writeDiagramViewpoints(manifest[path])
open .diagram → ArchDiagramBindingService attach → readDiagramViewpoints → binding.setScope
drop term → factory → scope = scopeForDocument(doc) → resolveDropActions(scope) → route
toggle panel → setDocumentScope → binding.setScope + writeDiagramViewpoints + notifyChanged
```

## 5. Files

| File | Change |
|------|--------|
| Create: `architecture-projects/services/diagram-viewpoints.ts` | manifest read/write helper |
| Modify: `architecture-projects/services/architecture-project-factory.ts` | `diagrams?` on `ArchitectureManifest` |
| Modify: `architecture-projects/services/arch-diagram-binding.ts` | `scope` + `setScope` + `scopeSet` |
| Modify: `architecture-projects/services/arch-diagram-binding-service.ts` | read scope on attach; `scopeForDocument`/`setDocumentScope` |
| Modify: `architecture-projects/services/arch-instance-drop-factory.ts` | scope from binding (read-filter) |
| Create: `architecture-projects/services/diagram-viewpoint-scope-service.ts` | toggle-panel service + row |
| Create: `architecture-projects/services/viewpoint-scope.resources.mu` | panel + picker templates |
| Create: `architecture-projects/services/arch-new-diagram-participant.ts` | creation picker impl |
| Create: `services/documents/new-file-participant.ts` | `INewFileParticipant` + key |
| Modify: `modules/project-explorer/services/project-explorer-service.ts` | call the participant in `newFileIn` |
| Modify: `app.mu` (+ compile:mu list) | register services + merge resources + mount panel |
| Tests | one `tests/` file per headless unit |

## 6. Testing

- **`diagram-viewpoints.test.ts`** (headless): seed a `FakeStorage` with an
  architecture manifest; `writeDiagramViewpoints` then `readDiagramViewpoints`
  round-trips; the write preserves `metaModel`/`libraries`/`name`; reading an
  absent path → `undefined`.
- **`arch-diagram-binding` scope tests** (extend): `scopeSet()` defaults to all
  the model's viewpoints when scope is empty; `setScope(['ComponentView'])`
  narrows it.
- **`arch-diagram-binding-service` scope tests** (extend): on attach with a
  manifest entry, the binding scope reflects it; `setDocumentScope` persists +
  updates the binding; `scopeForDocument` returns the set.
- **`arch-instance-drop-factory` read-filter test** (extend): a term framed only
  by an **unselected** viewpoint yields `null` (no candidates); framed by a
  selected one still creates.
- **`diagram-viewpoint-scope-service.test.ts`** (headless service logic): given a
  fake active arch document + binding, `Rows` mirror the project viewpoints with
  correct `IsSelected`; toggling a row calls `setDocumentScope` with the new set.
- **Live-GUI smoke (manual):** the creation picker appears on new `.diagram`; the
  Inspector toggle panel lists viewpoints and re-scopes; drops respect the scope.

## 7. Constraints

- `@pragmatic-lab/todl@^0.23.0`; real enums; every test in a `tests/` subfolder;
  no relative `../src` mural imports; `app.mu.js` is generated/gitignored (never
  commit); add any new `.mu` to the `compile:mu` list in `package.json`.
- The generic `DiagramDocument`/`DiagramDocumentFactory` remain untouched; the
  `INewFileParticipant` seam keeps the generic explorer decoupled (optional, no-op
  when absent).
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## 8. Out of scope

- Toolbox filtering by viewpoint (the palette still shows all terms; only the
  drop scope narrows).
- Hiding/removing already-placed figures when the scope narrows.
- The term-specific canvas icon (still the SP4b `rectangle` placeholder — a
  separate visual-resolution follow-up).
- Cross-project viewpoints; the `instance`-annotation classifier refinement.

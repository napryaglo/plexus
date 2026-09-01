# SP0 — Diagram viewpoints (creation + editing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single viewpoint-picker dialog used to choose a diagram's viewpoints at creation and to edit them later; the selection serializes inside the `.diagram` file and restores on open; narrowing the set removes out-of-scope nodes after a confirmation that lists them.

**Architecture:** A diagram's viewpoints are its governing scope, read via `ArchDiagramBindingService.scopeForDocument(doc)` (the authority every later sub-project consumes). Persistence moves from the project manifest into the diagram document via a new mural `SerializedDiagram.metadata` slot. Creation and edit share `DiagramViewpointPickerService` + one modal template.

**Tech Stack:** Mural (`@pragmatic-tech-ai/mural`, node:test, Verdaccio); Plexus (electron-vite, vitest, `.mu` templates compiled by the mural CLI).

## Global Constraints

- Work on `main` in both repos. Commit/push only when the user explicitly asks. Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Every test file lives in a `tests/` subfolder next to its source.
- Real TypeScript `enum`s, never string-literal unions.
- Plexus consumes `@pragmatic-tech-ai/*` from local Verdaccio (`http://localhost:4873/`); publish mural there. After a mural bump: `npm install @pragmatic-tech-ai/mural@<v>`, then `rm -rf node_modules/.vite`, then `npm run compile:mu`. User restarts the dev server.
- Do NOT write JSON via PowerShell `Set-Content -Encoding utf8` (BOM breaks vite) — use `node -e`/Write.
- New `.mu` resource files must be added to the `compile:mu` file list in `package.json` and merged/mounted like the existing ones.
- Locked design: ≥1 viewpoint required; creation defaults to all selected and **aborts** on cancel; edit pre-selects the current set; persistence via `metadata['arch.viewpoints']`; manifest is a load-time fallback only.

---

### Task 1: Mural — `SerializedDiagram.metadata` round-trip + `DiagramDocument.Metadata`

**Files:**
- Modify: `src/framework/diagram/diagram-document.ts` (interface `SerializedDiagram` ~line 116; `_serialize` ~876; `_deserialize` ~920; add a `Metadata` accessor on `DiagramDocument`).
- Test: `src/framework/diagram/tests/diagram-document-metadata.test.ts`

**Interfaces:**
- Produces: `SerializedDiagram.metadata?: Record<string, unknown>`; `DiagramDocument.Metadata: Record<string, unknown>` (get returns a defensive copy; set replaces). Metadata survives `Save()`→`Load()` round-trip. Absent/empty metadata is omitted from the serialized JSON (no format churn for diagrams that don't use it).

- [ ] **Step 1: Write the failing test**

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { DiagramDocument } from '../diagram-document.js';

describe('DiagramDocument metadata', () => {
    test('Metadata round-trips through serialize → deserialize', () => {
        initTestApp();
        const a = new DiagramDocument();
        a.Metadata = { 'arch.viewpoints': ['deployment', 'logical'] };
        const json = (a as unknown as { _serialize(): unknown })._serialize();
        const b = new DiagramDocument();
        (b as unknown as { _deserialize(p: unknown): void })._deserialize(json);
        assert.deepEqual(b.Metadata['arch.viewpoints'], ['deployment', 'logical']);
    });

    test('empty metadata is omitted from the serialized payload', () => {
        initTestApp();
        const d = new DiagramDocument();
        const json = (d as unknown as { _serialize(): { metadata?: unknown } })._serialize();
        assert.equal(json.metadata, undefined);
    });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`Metadata` undefined). Run: `npx tsx --conditions=development --test "src/framework/diagram/tests/diagram-document-metadata.test.ts"`

- [ ] **Step 3: Implement.** Add to `SerializedDiagram`: `readonly metadata?: Record<string, unknown>;`. Add a private field `private _metadata: Record<string, unknown> = {};` and `public get Metadata(): Record<string, unknown> { return { ...this._metadata }; }` / `public set Metadata(v: Record<string, unknown>) { this._metadata = { ...v }; }`. In `_serialize()`, after building `{ nodes, connectors }`, include `...(Object.keys(this._metadata).length > 0 ? { metadata: { ...this._metadata } } : {})`. In `_deserialize(payload)`, set `this._metadata = payload.metadata !== undefined ? { ...payload.metadata } : {};`.

- [ ] **Step 4: Run the test — expect PASS.**

- [ ] **Step 5: Full suite + typecheck.** `npm test` (expect prior count + 2, 0 fail), `npx tsc --noEmit`.

- [ ] **Step 6: Bump + publish.** Edit `package.json` version (next patch, e.g. `0.6.24`); `npm run build`; `npm publish`.

---

### Task 2: Plexus — consume the new mural; viewpoint persistence store

**Files:**
- Modify: `package.json` (`@pragmatic-tech-ai/mural` → `^0.6.24`), then install + clear vite + `compile:mu`.
- Create: `src/renderer/src/modules/architecture-projects/services/arch-diagram-viewpoints-store.ts`
- Modify: `src/renderer/src/modules/architecture-projects/services/diagram-viewpoints.ts` (keep `readDiagramViewpoints` as the legacy fallback; the manifest writer is no longer called from the create/edit flow).
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-diagram-viewpoints-store.test.ts`

**Interfaces:**
- Consumes: `DiagramDocument.Metadata` (Task 1); `readDiagramViewpoints(storage, path)` (legacy manifest fallback).
- Produces: `const ARCH_VIEWPOINTS_KEY = 'arch.viewpoints'`; `readViewpoints(doc: DiagramDocument): string[] | undefined` (reads `Metadata[ARCH_VIEWPOINTS_KEY]` as `string[]`, else `undefined`); `writeViewpoints(doc: DiagramDocument, ids: string[]): void` (merges into `Metadata`); `async loadViewpoints(doc, storage, path): Promise<string[] | undefined>` (document first, then manifest fallback).

- [ ] **Step 1: Bump + install mural.** `package.json` → `^0.6.24`; `npm install @pragmatic-tech-ai/mural@0.6.24`; `rm -rf node_modules/.vite`.

- [ ] **Step 2: Write the failing test.**

```ts
import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { DiagramDocument } from '@pragmatic-tech-ai/mural/framework';
import { readViewpoints, writeViewpoints, ARCH_VIEWPOINTS_KEY } from '../arch-diagram-viewpoints-store.js';

describe('arch diagram viewpoints store', () => {
    test('write then read returns the same ids via document metadata', () => {
        const doc = new DiagramDocument();
        writeViewpoints(doc, ['deployment', 'logical']);
        assert.deepEqual(readViewpoints(doc), ['deployment', 'logical']);
        assert.deepEqual(doc.Metadata[ARCH_VIEWPOINTS_KEY], ['deployment', 'logical']);
    });
    test('read returns undefined when the document has no viewpoints', () => {
        assert.equal(readViewpoints(new DiagramDocument()), undefined);
    });
    test('writeViewpoints preserves other metadata keys', () => {
        const doc = new DiagramDocument();
        doc.Metadata = { other: 1 };
        writeViewpoints(doc, ['a']);
        assert.equal(doc.Metadata.other, 1);
        assert.deepEqual(readViewpoints(doc), ['a']);
    });
});
```

- [ ] **Step 3: Run — expect FAIL.** `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-diagram-viewpoints-store.test.ts`

- [ ] **Step 4: Implement `arch-diagram-viewpoints-store.ts`** with `ARCH_VIEWPOINTS_KEY`, `readViewpoints`, `writeViewpoints` (merge into `Metadata`), and `loadViewpoints` (doc → manifest fallback via `readDiagramViewpoints`).

- [ ] **Step 5: Run tests — expect PASS.** Then `npm run typecheck`.

---

### Task 3: Plexus — picker service: pre-selection + cancel

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-new-diagram-participant.ts` (`DiagramViewpointPickerService`).
- Test: `src/renderer/src/modules/architecture-projects/services/tests/diagram-viewpoint-picker.test.ts`

**Interfaces:**
- Produces: `pick(viewpoints: string[], preselected?: ReadonlySet<string>): Promise<string[] | undefined>` (rows checked when in `preselected`, default all checked); `CancelCommand: ICommand` (resolves `undefined`, closes); confirm resolves the checked labels; `CanConfirm` reflects ≥1 selected.

- [ ] **Step 1: Failing test** — `pick(['a','b'], new Set(['b']))` seeds `Rows` with only `b` checked; simulate confirm → resolves `['b']`; a fresh `pick(['a','b'])` defaults both checked; `CancelCommand.Execute()` resolves `undefined` and sets `IsOpen=false`; confirm with zero checked does not resolve (or `CanConfirm===false`).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** the optional `preselected` arg (default: all checked), a `CancelCommandKey` DP + `RelayCommand` resolving `undefined`, and a `CanConfirm` boolean DP recomputed on row toggles (subscribe each `PickerRow.IsSelectedKey`).

- [ ] **Step 4: Run — expect PASS.** Typecheck.

---

### Task 4: Plexus — picker dialog `.mu` template + mount

**Files:**
- Create: `src/renderer/src/modules/architecture-projects/services/viewpoint-picker.resources.mu`
- Modify: `src/renderer/src/modules/architecture-projects/architecture-projects.module.mu` (register the resources), `package.json` `compile:mu` list, and the app-global merge/mount (mirror how `chooser.resources.mu` is wired).
- Test: none (markup); validated by `compile:mu` + live smoke.

**Interfaces:** Consumes `DiagramViewpointPickerService` (`$Rows`, `$IsOpen`, `$ConfirmCommand`, `$CancelCommand`, `$CanConfirm`). A modal overlay (shown while `$IsOpen`) with a title, a `$Rows` list (Checkbox `IsChecked = $IsSelected` two-way + `$Label`), and Confirm (`IsEnabled = $CanConfirm`) / Cancel buttons.

- [ ] **Step 1:** Read `chooser.resources.mu` + its module/mount wiring as the reference pattern.
- [ ] **Step 2:** Author `viewpoint-picker.resources.mu` (modal card, checkbox list, Confirm/Cancel), following the reference.
- [ ] **Step 3:** Add the file to `compile:mu` and register/mount like the chooser.
- [ ] **Step 4:** `npm run compile:mu` — expect clean (24→25 files).

---

### Task 5: Plexus — creation flow (dialog → persist / abort)

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-new-diagram-participant.ts` (`ArchNewDiagramParticipant`).
- Modify: creation wiring so the chosen viewpoints are written to the new document's metadata (via Task 2 `writeViewpoints`) instead of the manifest.
- Test: `.../tests/arch-new-diagram-participant.test.ts` (extend if present).

**Interfaces:** Consumes `pick()` (Task 3), `writeViewpoints` (Task 2). On new `.diagram`: open the dialog with all viewpoints pre-selected; **cancel (`undefined`) aborts creation**; confirm writes the chosen ids to the document metadata and sets the binding scope.

- [ ] **Step 1: Failing test** — participant confirm-path writes viewpoints to the document metadata; cancel-path aborts (no document created / signals abort per the `INewFileParticipant` contract). Use a fake picker resolving a fixed set / `undefined`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — invoke `pick(allViewpoints)`; on `undefined` abort; else `writeViewpoints(doc, chosen)` + `setScope`.
- [ ] **Step 4: Run — expect PASS.** Typecheck.

---

### Task 6: Plexus — edit command + toolbar/tab-menu surface

**Files:**
- Create: `src/renderer/src/modules/architecture-projects/services/edit-diagram-viewpoints-command.ts` (or add to an existing arch service).
- Modify: the diagram toolbar template + document-tab context menu to surface `arch.editDiagramViewpoints`, enabled only for an arch-bound diagram.
- Test: `.../tests/edit-diagram-viewpoints-command.test.ts`

**Interfaces:** Consumes `scopeForDocument(doc)` (current selection), `pick(all, preselectedCurrent)` (Task 3), Task 7 reconciliation. On confirm: hand the chosen set to the reconciliation apply step.

- [ ] **Step 1: Failing test** — command opens the picker pre-selected with the document's current scope; is disabled for a non-arch diagram.
- [ ] **Step 2–4:** Implement the command + toolbar/tab-menu entries (follow an existing diagram command's registration + toolbar wiring); run tests; typecheck; `compile:mu` if templates changed.

---

### Task 7: Plexus — narrowing reconciliation + confirmation dialog

**Files:**
- Create: `src/renderer/src/modules/architecture-projects/services/viewpoint-scope-reconcile.ts` (pure compute) + a confirmation dialog service + `.mu` (or reuse a generic confirm if one exists).
- Test: `.../tests/viewpoint-scope-reconcile.test.ts`

**Interfaces:**
- Produces: `nodesLeavingScope(doc, model, chosen: ReadonlySet<string>): ArchNodeVM[]` — placed `ArchNodeVM`s whose entity concept is framed by none of `chosen` (`repository().viewpointsFraming`). `applyScopeChange(doc, model, bindingSvc, chosen)`: if `nodesLeavingScope` is non-empty, show the confirmation dialog listing their labels; on confirm → `setScope` + `writeViewpoints` + `doc.DeleteNodes(leaving)`; on cancel → no-op (scope unchanged).

- [ ] **Step 1: Failing test** for `nodesLeavingScope` — given entities framed by different viewpoints and a narrowed `chosen`, returns exactly the nodes framed by none of `chosen`; empty when the scope is unchanged or widened.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** the pure computation; then the confirmation dialog (list labels, Confirm/Cancel) + `applyScopeChange`.
- [ ] **Step 4: Run — expect PASS.** Typecheck; `compile:mu` for the confirm template.

---

### Task 8: Plexus — remove the inline Inspector viewpoint panel

**Files:**
- Delete/disable: `src/renderer/src/modules/architecture-projects/services/diagram-viewpoint-scope-service.ts` (`DiagramViewpointScopeService`) and `viewpoint-scope.resources.mu`.
- Modify: `architecture-projects.module.mu`, `package.json` `compile:mu` list, and any main.js/panel mount that seeded the panel.
- Test: remove/adjust `diagram-viewpoint-scope-service` tests.

- [ ] **Step 1:** Find all references (`git grep DiagramViewpointScopeService`) — service, module registration, panel mount, resources, tests.
- [ ] **Step 2:** Remove the service, its `.mu`, its registration/mount, its `compile:mu` entry, and its tests.
- [ ] **Step 3:** `npm run typecheck` + `npm test` + `npm run compile:mu` — all clean.

---

### Task 9: Integration verification

- [ ] Full Plexus suite green; typecheck clean; `compile:mu` clean.
- [ ] Confirm the read authority: `scopeForDocument(doc)` returns the document-metadata viewpoints (Task 2), with manifest fallback for a legacy file.
- [ ] Manual live-smoke checklist (user-run): create a diagram → picker appears (all checked) → confirm → reopen → same viewpoints; edit via toolbar/tab menu → narrow → confirmation lists the leaving nodes → confirm removes them, cancel leaves scope unchanged.

---

## Self-review notes

- Spec coverage: dialog (T3/T4), create (T5), edit entry (T6), serialize-with-diagram (T1/T2), narrowing confirm+remove (T7), panel removal (T8) — all mapped.
- Type consistency: `ARCH_VIEWPOINTS_KEY`, `readViewpoints`/`writeViewpoints`/`loadViewpoints`, `pick(viewpoints, preselected?)`, `nodesLeavingScope`/`applyScopeChange` used consistently across tasks.
- Mural bump (T1) precedes Plexus consumption (T2); every UI task ends with `compile:mu`.

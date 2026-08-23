# Arch draw-to-connect Implementation Plan

> **For agentic workers:** Use TDD, one task at a time. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Drawing a connector between two arch nodes creates a real model `connector` entity (typed edge) that projects back as a labeled diagram connector, survives reload, and can be deleted; illegal draws give feedback instead of silently vanishing.

**Architecture:** Arch diagrams are model-authoritative — a hand-drawn connector is reconciled away unless it maps to the model. Today only concept `relationship` members and scenario steps project as edges; standalone `connector` entities (`{from, to, type}`, the meta-model's actual component↔component edge, connector.todl) are neither projected nor creatable by drawing. This feature adds: (A) projection of `connector` entities as labeled edges, (B) a draw→mint path that creates a `connector` entity (default `type: calls`), (C) status feedback when a draw resolves to nothing. All Plexus-side; the `connector` concept already exists in the tech-architecture meta-model.

**Tech Stack:** Plexus renderer (TypeScript), `@pragmatic-lab/todl` (ModelDraft/Repository), `@pragmatic-lab/mural` diagram (Connector, DiagramDocument, StatusService). Vitest.

**Spec:** this plan (design settled in conversation 2026-08-23).

## Global Constraints

- **Plexus-only.** No TODL/Mural/publish changes. Consume the installed `@pragmatic-lab/mural@^0.21.4`.
- **Every test file lives in a `tests/` subfolder** next to its source.
- **Real enums, never string-literal unions.** Connector `type` values come from the model's `connectors` taxonomy at runtime (data, not a TS union) — read them from the repo; do not hardcode a TS union of type names.
- **Never mutate the real corpus** at `C:/Users/Eugene/Projects/plexus_tests`. e2e runs against a temp clone (`fs.cpSync` + `seedSession(projects)`), mirroring `arch-containment.spec.ts`.
- **Preserve the connector-authoritative invariant:** the only connectors between two bound arch nodes are ones the binding derives from the model (relationships, scenario steps, and now connector entities). A raw user-drawn connector is still reconciled away — replaced by a model-derived one when the draw is legal.
- Default connector type on draw = **`calls`** (meta-model's shorthand default). No type chooser; the relationship chooser still appears only when a concept relationship ALSO applies.
- Projected connector-entity edges are **labeled with their `type`**. Delete = view-only; **Shift+Delete removes the entity** (mirrors node delete).

---

### Task 1: Confirm how a `connector` entity's `type` round-trips

**Files:**
- Test: `src/renderer/src/modules/architecture-projects/services/tests/connector-entity-model.test.ts` (Create)

**Interfaces:**
- Produces: the confirmed member name + call sequence to set a connector's type (used by Tasks 2 & 4). Expected: `model.create('connector', id)` + `addRef(id,'from',src)` + `addRef(id,'to',tgt)` + set type (field `type` referencing a `connectors` term, OR the taxonomy-`represents` mechanism — the test determines which), then `toTodlByFile()` emits `connector <id> { from = ...; to = ...; type = calls; }` (or the emitter's form).

- [ ] **Step 1: Write the failing test** — build a ModelDraft over the tech-architecture meta-model with two placed components, create a `connector` entity, set from/to/type='calls', and assert `draft.toTodlByFile()` output contains a connector record naming both endpoints and `calls`. Use the same in-process ModelDraft construction the existing `containment.test.ts` / model tests use.
- [ ] **Step 2: Run it; observe how `type` must be set** — if `setField(id,'type','calls')` doesn't round-trip, try the taxonomy-term mechanism (`addRef(id,'type', <termId>)` or the `represents` discriminator). Iterate until the emit is correct.
- [ ] **Step 3: Lock the working call sequence** in a tiny helper `mintConnectorEntity(model, fromId, toId, type)` in `connector-entity.ts` (new). Return the new entity id.
- [ ] **Step 4: Run the test green.**
- [ ] **Step 5: Commit.** `feat(arch): mintConnectorEntity helper + confirmed connector type round-trip`

---

### Task 2: Project `connector` entities as labeled edges

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/edge-projection.ts`
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-diagram-binding.ts` (`projectEdges`)
- Test: `src/renderer/src/modules/architecture-projects/services/tests/connector-entity-projection.test.ts` (Create)

**Interfaces:**
- Consumes: `acceptSet` (arch-concept-type.ts) for subtype-aware "is-a connector".
- Produces: `desiredConnectorEntityEdges(repo, ownEntities, placedIds, scope): Map<string, {from,to,type,entityId}>` keyed by `edgeKey(from, CONNECTOR_ENTITY_MEMBER+':'+entityId, to)`. `CONNECTOR_ENTITY_MEMBER = '__connector_entity__'`.

- [ ] **Step 1: Write the failing test** — a model with two placed components and one `connector` entity between them; assert `desiredConnectorEntityEdges` yields exactly one edge keyed by the entity id, carrying `type`. Also assert a connector entity with an UNplaced endpoint yields nothing.
- [ ] **Step 2: Run it (fails — function absent).**
- [ ] **Step 3: Implement `desiredConnectorEntityEdges`** — iterate `ownEntities` where `acceptSet(repo, e.concept).has('connector')`; read `e.refs('from')[0]` / `e.refs('to')[0]`; if both ids ∈ placed (and, for `application` endpoints, only when `type` ∈ app-tier — otherwise skip), emit the keyed edge with `type = <the entity's type term>`.
- [ ] **Step 4: Wire into `projectEdges`** — after the relationship + scenario `desired` set is built, fold in the connector-entity edges: add their keys to `desired`, and when creating the connector (existing add-missing loop) set `c.LabelText = type` for connector-entity keys (parse the key or carry a side map). Keep them in `boundEdges` so the reconcile sweep treats them as ours.
- [ ] **Step 5: Run tests green** (unit) + `npm run typecheck`.
- [ ] **Step 6: Commit.** `feat(arch): project connector entities as labeled diagram edges`

---

### Task 3: Resolve whether a draw is a legal connector-entity pair

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-connector-resolver.ts`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-connector-resolver.test.ts` (Create or extend)

**Interfaces:**
- Produces: `canDrawConnectorEntity(repo, srcConcept, tgtConcept): boolean` — true when `connector`'s `from` accepts `srcConcept` AND `to` accepts `tgtConcept` (read `effectiveSchema('connector').relationships` targets, subtype-aware via `acceptSet`). Application endpoints excluded here (app-tier types aren't the `calls` default); component/block/actor/location pairs qualify.

- [ ] **Step 1: Write the failing test** — component→component ⇒ true; component→technology ⇒ false (technology isn't a from/to target); actor→component ⇒ true.
- [ ] **Step 2: Run (fails).**
- [ ] **Step 3: Implement** `canDrawConnectorEntity` reading the `connector` concept's from/to targets.
- [ ] **Step 4: Green.**
- [ ] **Step 5: Commit.** `feat(arch): resolver for legal connector-entity draws`

---

### Task 4: Draw → mint a `connector` entity (default `calls`)

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-diagram-binding.ts` (`handleConnectorCreated`)
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-connector-created.test.ts` (Create)

**Interfaces:**
- Consumes: `resolveConnectorActions` (relationships), `canDrawConnectorEntity` (Task 3), `mintConnectorEntity` (Task 1).

- [ ] **Step 1: Write the failing test** — a fake ArchModel recording calls; fire `handleConnectorCreated(compA, compB)`; assert a `connector` entity was minted (from=A,to=B,type=calls) and saved, and NO relationship ref was written. Also: component→location (containment `in`) still nests via the existing path (no connector entity). Also: no-relationship + not-a-connector-pair ⇒ neither (Task 6 covers feedback).
- [ ] **Step 2: Run (fails).**
- [ ] **Step 3: Implement** — in `handleConnectorCreated`, after computing `relActions = resolveConnectorActions(...)`: compute `connOk = canDrawConnectorEntity(...)`. Build the action list: relActions (apply=addRef) plus, if `connOk`, ONE connector action (label `"connect (calls)"`, apply=`mintConnectorEntity(model, from, to, 'calls'); save`). Then: 0 ⇒ leave for Task 6; 1 ⇒ auto-apply; >1 ⇒ `chooser.Show`. Preserve the existing `notifyChanged()` raw-drop first.
- [ ] **Step 4: Green** + typecheck.
- [ ] **Step 5: Commit.** `feat(arch): drawing a connector mints a connector entity (default calls)`

---

### Task 5: Delete semantics — Shift+Delete removes the connector entity

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-diagram-binding.ts` (`attachView` onDelete + `handleDeleteRequested`)
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-connector-delete.test.ts` (Create)

**Interfaces:**
- Consumes: `DeleteRequestedArgs.Connectors` (currently dropped — onDelete forwards only `Items`).

- [ ] **Step 1: Write the failing test** — with a projected connector-entity edge bound, Shift+Delete on that connector removes the underlying entity (`model.remove(entityId)` + save); plain Delete does NOT remove the entity (re-projects on next rescan).
- [ ] **Step 2: Run (fails).**
- [ ] **Step 3: Implement** — extend `onDelete` to pass `args.Connectors`; in `handleDeleteRequested`, for each deleted Connector, find its `boundEdges` key; if the key encodes a connector entity (`__connector_entity__:<id>`) AND `shift`, `model.remove(id)` + save. Plain delete: no-op (the reconcile re-adds it — matches node behavior). Map connector→key by identity over `boundEdges`.
- [ ] **Step 4: Green** + typecheck.
- [ ] **Step 5: Commit.** `feat(arch): Shift+Delete on a drawn connector removes its entity`

---

### Task 6: Feedback when a draw resolves to nothing

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-diagram-binding.ts` (constructor + `handleConnectorCreated`)
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-diagram-binding-service.ts` (inject StatusService)
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-connector-created.test.ts` (extend)

**Interfaces:**
- Consumes: `StatusService` (optional ctor arg; `.Text` setter).

- [ ] **Step 1: Write the failing test** — a fake status sink; fire a draw between an illegal pair (0 relations, not a connector pair); assert a message was set naming both concepts.
- [ ] **Step 2: Run (fails).**
- [ ] **Step 3: Implement** — add `private readonly status?: { set Text(v: string): void }` ctor arg (wired from the binding-service via `StatusService.Key`). In `handleConnectorCreated`, when the action list is empty, set `status.Text = \`Can't connect a ${srcConcept} to a ${tgtConcept} here\``. (Keep it a plain message; a timed-clear is optional polish.)
- [ ] **Step 4: Green** + typecheck. Verify the binding-service resolves StatusService optionally (no throw when absent, e.g. in tests).
- [ ] **Step 5: Commit.** `feat(arch): status feedback when a drawn connector is rejected`

---

### Task 7: e2e — draw, project, label, reload, delete (against a corpus copy)

**Files:**
- Test: `Plexus/e2e/arch-draw-connect.spec.ts` (Create)

- [ ] **Step 1: Write the test** — clone corpus to temp (mirror `arch-containment.spec.ts`). Open a diagram with two component nodes (or place two). Fire the real draw (`view._fireConnectorCreated({Source: new Ep({Node}), Target: new Ep({Node})})` with a borrowed `ConnectorEndpoint` class). Assert: (a) a connector appears between them; (b) its LabelText is `calls`; (c) the copy's `.todl` gained a `connector` record (grep, like `todlRecordsIn`); (d) re-open the diagram → the connector re-projects. Then Shift+Delete → the `.todl` connector record is gone.
- [ ] **Step 2: Build the app** (`npm run build`) and run the spec.
- [ ] **Step 3: Iterate** to green.
- [ ] **Step 4: Commit.** `test(e2e): draw-to-connect creates, labels, persists, and deletes a connector entity`

---

## Self-Review Notes

- **Coverage:** A(Task 2) + B(Tasks 1,3,4) + C(Task 6) + delete(Task 5) + e2e(Task 7). Type round-trip (the one unknown) is isolated to Task 1 so later tasks build on a confirmed mechanism.
- **Reconcile safety:** connector-entity edges live in `boundEdges` (keyed by entity id) so the connector-authoritative sweep keeps them and doesn't duplicate across opens — same discipline as relationship/scenario edges.
- **No silent scope drift:** projection respects the diagram's viewpoint `scope` for endpoints, consistent with `desiredEdges`.

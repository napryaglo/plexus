# TodlPresentationRegistry — one registry + one resolver for all published visuals

**Date:** 2026-08-08
**Status:** approved (direction), pending spec review

## Goal

Unify how Plexus loads and resolves the visuals of published TODL packages
(libraries **and** meta-models) behind **one registry** and **one visual
resolver**, and remove the meta-model drawer. Meta-model taxonomy-term tiles and
canvas nodes then render from their published presentation exactly like library
classes.

## Why

Today the two package types diverge:
- Libraries: `LibraryRegistry` loads `presentation.compiled.json`, eager-compiles
  authored `.mural`, merges app-global, and resolves by key; canvas/toolbox use
  `LibraryClassVisualResolver`.
- Meta-models: `MetaModelsService` keeps a private `dictCache`, resolves `mm:<id>`
  directly, and shows it **only** in a modal drawer; canvas/toolbox meta-model
  terms use a *separate* `ConceptVisualResolver` fed inline icons.

Two loaders, two resolvers, a bespoke drawer, and meta-model canvas visuals that
never touch the published presentation. Unify all of it.

## Architecture

### One registry — `TodlPresentationRegistry`

A single service owning **one aggregate `ResourceDictionary`** of every published
package's visuals, merged app-global.

```ts
interface PresentationSource {
  id: string
  // key → DataTemplate, with the source's OWN precedence already resolved
  // (e.g. library authored .mural overriding baked presentation for the same key).
  load(): Promise<Map<string, DataTemplate>>
}

class TodlPresentationRegistry extends ServiceBase {
  static readonly Key: ServiceKey<TodlPresentationRegistry>
  registerSource(src: PresentationSource): void
  async discover(): Promise<void>   // load all sources → aggregate → swap app-global → onChanged
  resolve(key: string): DataTemplate | undefined   // owned aggregate (headless-safe)
  onChanged(cb: (key: string) => void): () => void
}
```

`discover()` builds a **detached** dictionary from every source's map, then swaps
it into `Application.Resources` via `ReplaceMergedDictionary`
(`StyleParticipating = false`) — the eager, O(1)-notification, detached-then-swap
pattern already proven in `LibraryRegistry`. Because it's **one aggregate**,
precedence is resolved *inside* each source's map — the resolver never depends on
cross-dictionary merge order (mural resolves merged dicts last-merged-first, so
relying on merge order across registries would be fragile).

### One resolver — `TodlVisualResolver`

The **only** `IToolboxVisualResolver`. Replaces both `LibraryClassVisualResolver`
and `ConceptVisualResolver`.

```ts
resolve(descriptor, context): Visual {
  const t = this.registry.resolve(descriptor.Key)   // authored > presentation, per source map
  const visual = (t ?? this.default).Apply({})       // figure-only default box otherwise
  if (context === VisualContext.Tile && visual instanceof Element) visual.IsHitTestVisible = false
  return visual
}
```

It bridges `registry.onChanged` so a re-discover (install/uninstall/republish)
upgrades open presenters. Source-agnostic: it only looks up `descriptor.Key`.

### Key strings encode the source

`descriptor.Key` is the native presentation key of the package that owns the
visual — no per-source resolver logic, just data:
- **Library** term / class → `classId` (matches the library presentation key, as
  today).
- **Meta-model** term / bare concept → `mm:<id>` (matches the meta-model
  presentation key).

All descriptors carry the single `TodlVisualResolverKey`.

### Sources

- **`LibraryPresentationSource`** — for each published library (`LibraryRegistry`
  supplies the discovered `LoadedLibrary[]` metadata), load its
  `presentation.compiled.json` and eager-compile its authored `.mural`, returning
  one `classId → template` map with **authored overriding presentation**.
  Compile/parse failures publish per-library Problems (moved here from
  `LibraryRegistry`).
- **`MetaModelPresentationSource`** — `scanPublishedModels` → for each
  `<id>/<version>` load its presentation, returning the `mm:<id> → template` map.

Both use the shared `loadCompiledPresentation(storage, base, ctxExtra)` extracted
from today's duplicated `loadPresentation` / `loadLibraryPresentation` (which keep
thin wrappers only where their differing missing-file behavior is still needed —
otherwise removed).

### `LibraryRegistry` after the move

Keeps its library-only concerns: `discover(): LoadedLibrary[]` (metadata +
discovery Problems, cheap again) for the Libraries panel, and library
install/uninstall. Its presentation + authored-compile + `resolve()` +
`presentationVisuals`/`libraryVisuals`/app-global merge move into
`LibraryPresentationSource`. The eager-compile behavior is **preserved**, just
relocated.

### Drawer removed

- `meta-model.resources.mu`: delete the `SideSheet` block and
  `MetaModelFieldTemplate`.
- `MetaModelsService`: delete `DrawerEntity`/`IsDrawerOpen` DPs, `openEntity`,
  `dictCache`, and the `loadPresentation` call. `reload()` triggers
  `TodlPresentationRegistry.discover()` (so a just-published meta-model's visuals
  are available). Entity rows no longer open anything on double-click.
- Delete `meta-model-entity-builder` (`buildEntity`), `MetaModelField`, and
  `meta-model-converters` (`IsNullToVisibility`) — all drawer-only.
- Trim `MetaModelEntity` to an inert marker class (like `LibraryClassData`): it
  survives **only** as the presentation `DataType` symbol; its drawer members
  (`Fields`, `UITemplate`, `Attrs`, `Annotations`, `Label`, `TypeOf`) go.

## Wiring

- Register `TodlPresentationRegistry` in a `.services:` block reachable by both
  modules (diagram module — it hosts the toolbox/resolver).
- `registerArchToolboxAdapters` registers the single `TodlVisualResolver` (drops
  the two old resolvers + the `ConceptVisualResolver` icon feed) and the drop
  factory; registers both presentation sources into the registry.
- `TodlPresentationRegistry.discover()` is triggered where
  `LibraryRegistry.discover()` is today (arch canvas open in
  `ArchDiagramDocumentFactory`, and the toolbox/panel activations), plus on
  `MetaModelsService.reload()`.
- `contributeTaxonomy`: descriptor key = `isLibrary ? term.id : 'mm:' + term.id`,
  single resolver key, no icon `Register`.
- Descriptor sites — `LibraryTreeNode.leaf`, `InstanceNodeVM` (referenced term →
  `classId`; bare concept → `mm:<concept>`) — point at the single resolver key.

## Consequences (named, accepted)

- **Republish:** existing packages ship `icon + label` author templates; on
  figure-only tiles they double-label until republished icon-only (the scaffold
  already emits icon-only). Pre-presentation meta-models have no artifact and fall
  to the default box.
- **Bare keys, no base-qualification:** multiple published meta-model versions
  with the same term id resolve last-wins (matches library behavior). Documented;
  base-qualify later if it bites.
- **Touches recently-merged `LibraryRegistry`:** its presentation tier relocates.
  Tests move with the behavior; library resolution stays authored > presentation >
  default.

## Testing (high level; detailed in the plan)

- New: `compiled-presentation` (shared loader), `todl-presentation-registry`
  (multi-source aggregate + eager + O(1) notifications + onChanged),
  `todl-visual-resolver` (by-key resolve + default fallback + Tile non-hit-test +
  onChanged bridge), `library-presentation-source`, `meta-model-presentation-source`.
- Rewritten: `register-arch-toolbox-adapters`, `library-registry` (metadata-only
  discover + Problems; resolution assertions move to the source),
  `meta-models-service` (no drawer; triggers discover), `instance-node-vm` /
  `library-tree-node` (single resolver key + `mm:` concept keys),
  `toolbox-service-populate` (single resolver, `mm:` keys), the three host render
  tests, `arch-diagram-document`.
- Deleted: `library-class-visual-resolver.test`, `concept-visual-resolver.test`,
  and any drawer-only tests (`meta-model-entity-builder`, converters).

## Out of scope

- Base-qualified keys / multi-version disambiguation.
- Rerouting away from the toolbox `ToolboxVisualPresenter` (unchanged).
- Any mural framework change.

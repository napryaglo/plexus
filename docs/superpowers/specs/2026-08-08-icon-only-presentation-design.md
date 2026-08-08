# Icon-only presentation — one default template, icon via annotation resource key

**Date:** 2026-08-08
**Status:** approved (direction), pending spec review

## Goal

Kill per-entity presentation DataTemplates entirely. Every published-package
term/class/instance renders through **one** default template in Plexus; its icon
comes from the entity's `icon` annotation resource key, bound through a converter
that resolves the geometry from the app-global resources. No template scaffolding,
no authored per-class templates, no baked labels — so nothing can ever
double-label a tile again.

## Why

The just-merged design bakes one `DataTemplate` per entity into each package's
`presentation.compiled.json`, seeded from a **write-once** author stub. Result:
(1) a "shitload of DataTemplates" no one wants to own; (2) stale packages whose
baked template still draws a label *inside* the icon, double-labelling against the
host caption; (3) the write-once gate means re-publishing can't even fix it. The
presentation package should carry only **assets** (icon geometries); the visual is
one default template + a resource-key binding.

## Architecture

### Presentation package = assets only

Publish emits, per package:
- `presentation/presentation.compiled.json` — the asset `ResourceDictionary`:
  one baked geometry per distinct icon, keyed by its resource key
  (`mm_icon_<slug>`, from `assignResourceKeys`). No DataTemplates.
- `presentation/icon-index.json` — a flat `{ entityKey: resourceKey }` map for
  every entity that has an icon. `entityKey` is the descriptor-key namespace:
  library term/class → `<id>`; meta-model entity → `mm:<id>`. Computed at publish
  time where the doc and `assignResourceKeys` are in hand, so load never
  re-derives keys.

Removed from publish: `scaffoldAuthorStubs`, `readAuthorTemplates`, author-template
inlining, `combinedSource` author args. `presentation-scaffold.ts` is deleted.
Both `library-project-factory` and the meta-model factory drop their
`scaffoldAuthorStubs` calls.

### Registry merges assets app-global + builds an icon-key index

`TodlPresentationRegistry.discover()`, per registered source:
- merges the source's asset dictionary into the one app-global aggregate
  (`ReplaceMergedDictionary`, `StyleParticipating = false`, skip-empty-swap — the
  existing pattern), so any `@mm_icon_…` resolves anywhere via `Application.Resources`;
- merges the source's `icon-index` entries into one `entityKey → resourceKey` index.

New method `iconKeyFor(entityKey): string | undefined`. `resolveAsset(resourceKey):
Geometry | undefined` reads the owned aggregate (headless-safe). `onChanged`
unchanged — still fires per key so live presenters upgrade on install/republish.

`PresentationSource.load()` return type changes from `Map<string, DataTemplate>`
to `{ assets: ResourceDictionary; iconKeys: Map<string, string> }`.

### One default template + IconKeyConverter

The single default template (compiled in `visual-library.ts`, same fragment path):

```
Border [ Background = @SurfaceContainerHigh, CornerRadius = 6, Padding = (10,6,10,6) ] {
    Shape [ Geometry = $IconKey << IconKeyConverter, Fill = @OnSurface, Width = 16, Height = 16 ]
}
```

`IconKeyConverter.convert(key)` → `Application.current.Resources.Resolve(key)`
(with a registry-backed fallback for headless), or the **shipped default icon**
geometry when the key is empty/unresolved. So an entity with no `icon` annotation
still renders a generic glyph, never an empty box. The default icon is a generic
geometry shipped in Plexus's own always-installed resources (`.mu`), key
`PlexusDefaultIcon`; swap the SVG later. The host (tile / canvas node / preview)
still owns the wrapping caption — unchanged.

`buildIconTemplate` / `ICON_SOURCE` / `findIcon` are deleted (the converter path
replaces per-instance icon injection).

### Resolver maps descriptor key → icon key

`TodlVisualResolver.Resolve(descriptor, context)`:
`defaultTemplate.Apply({ IconKey: registry.iconKeyFor(descriptor.Key) ?? '' })`,
Tile → `IsHitTestVisible = false`. Always the one default template; no per-key
template lookup. `registry.resolve(key)` (template lookup) is removed; `onChanged`
bridge stays.

**Descriptor sites are unchanged.** `contributeTaxonomy`, `InstanceNodeVM.refresh`,
and `LibraryTreeNode.leaf` keep their existing keys (`<term.id>`, `mm:<concept>`).
The index is keyed to match, so the canvas node's *remote* referenced term resolves
its icon through the index built during discover — no local icon lookup needed.

### Sources after the change

- `MetaModelPresentationSource.load()`: per published `<id>/<version>`, load the
  asset dict + read `icon-index.json` into the `mm:<id>` keyspace. No DataType
  symbol, no authored tier.
- `LibraryPresentationSource.load()`: per library, load the asset dict + read
  `icon-index.json` into the `<id>` keyspace. **Authored-`.mural` and legacy
  per-class-icon tiers are removed** (full uniformity). Compile Problems it used to
  publish for template failures go away with the templates; missing-icon-asset
  Problems can remain if cheap.

## Consequences (named, accepted)

- **Full uniformity, capability removed:** hand-authored per-class `.mural`
  templates and legacy per-class icon files no longer render. Every visual is
  icon + host caption. (User decision: remove them.)
- **Republish required:** pre-change packages carry the old template artifact and
  no `icon-index.json`; until republished they fall to the default glyph (no baked
  label — the loader ignores templates in the artifact / the artifact is
  replaced). Stale double-labels disappear on republish.
- **Raster icons:** a `Shape [ Geometry ]` renders SVG geometry only. Raster
  (`.png/.jpg`) icons resolve to no geometry → default glyph. Acceptable for v1;
  revisit with an image-capable default template if needed.
- **Cross-package resource-key collisions:** same `mm_icon_<slug>` from two
  packages → last-wins (unchanged accepted behavior).
- **Unwinds part of the 2026-08-08 presentation-registry merge:** the template
  scaffolding + `mm:`-keyed template resolution are replaced by assets + index.

## Testing (high level; detailed in the plan)

- New: `icon-key-converter` (key → resolved geometry / default fallback),
  `icon-index` generator (doc → entityKey→resourceKey), registry
  `iconKeyFor`/`resolveAsset` + assets-merge, default-icon resource present.
- Rewritten: both publishers (assets-only + icon-index, no scaffolding),
  both sources (contribution shape), `todl-visual-resolver` (index-driven
  default template), `visual-library` (icon-bearing default, no icon template),
  `todl-presentation-registry` (contribution merge + index).
- Deleted: `presentation-scaffold.test`, authored-template / legacy-icon tests,
  `buildIconTemplate` tests.

## Out of scope

- Raster-icon rendering; image default template.
- Any authored-visual escape hatch (explicitly removed).
- Base-qualified resource keys / multi-version disambiguation.

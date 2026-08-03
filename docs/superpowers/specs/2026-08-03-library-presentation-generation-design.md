# Library Presentation Generation — Design

**Date:** 2026-08-03
**Status:** Approved (design)
**Project type affected:** `library` (Plexus renderer)

## Problem

The "Generate Presentation" command in the Project Explorer is bound to a
command whose enabled-state is `canGeneratePresentation(op.Factory)` — a
feature-test for `regeneratePresentation()` on the project's factory
(`project-explorer-service.ts`). Only `MetaModelProjectFactory` implements
it (`IPresentationProjectFactory`). `LibraryProjectFactory` does not, so for a
**library** project the menu item is disabled and appears "not working."

We want the library project type to have the same presentation DX as
meta-models: generate an author-editable presentation dictionary with one
template per class, bake it into the published bundle, and load it at runtime
as each class's default rendering.

## Background: how each side works today

### Meta-model presentation (the pattern we mirror)
- `presentation-generator.ts` — pure emitter. `generatePresentationMu(model,
  authorOverrideDicts)` → `.mu` source. Templates keyed `mm:<id>`, typed
  `DataType = MetaModelEntity`, label baked as a literal. Exports the reusable
  helpers `distinctIcons`, `iconKey`, `humanize`, `resolveFacets`,
  `ontologyEntities`, `classEntities`.
- `MetaModelProjectFactory.regeneratePresentation(storage)` — the menu
  command: compile `.todl` → write `presentation.generated.mu` into the
  project. No `.todl` → no-op; a TODL error → leave the file untouched.
- `presentation-publisher.ts` — `publishPresentation(project, dest, base,
  doc)`: pre-read every referenced icon SVG (a missing icon **blocks
  publish**), generate the `.mu`, compile it with the `svgToGeometryJs`
  include resolver, strip `import` lines → `CompiledPresentation { body,
  symbols, className }` written to `<base>/presentation/presentation.compiled.json`.
- `presentation-loader.ts` — `loadPresentation(storage, base)`: `new Function`
  evals the compiled body with the mural runtime supplied via ctx →
  `ResourceDictionary` of `mm:<id>` templates. No parse, no compile, no SVG
  read at load.

### Library rendering (what already exists)
- `library-bundle.ts` — `deriveClasses(model)` returns the instantiable
  classes (Instance-tier clabjects, `attrs.class === true`) with `id`,
  `localId`, `label`, `icon` (annotation path), `concept`.
- `LibraryRegistry.resolve(classId)` — returns a compiled `DataTemplate`:
  authored `visuals/<id>.mural` (lazy-compiled, cached) → an icon+label
  template built from the class's `icon` annotation (`buildIconTemplate`) →
  the single shared default box (`buildDefaultTemplate`). Compiled templates
  merge into `Application.Resources`, string-keyed by **class id**.
- `visual-library.ts` — `compileTemplate` (authored `.mural` → `DataTemplate`),
  `buildDefaultTemplate` (labelled box binding `$Display`), `buildIconTemplate`
  (icon+label binding `$Display`).

**Key difference:** library class templates resolve by **string key = class
id** and bind **`$Display`** against a `{ Display }` data object — not by
`DataType` with a baked literal label. So the emitted template *shape* differs
from the meta-model; the icon/label/humanize plumbing is shared.

## Design

### Component 1 — Emitter: `library/services/library-presentation-generator.ts` (new)

A pure emitter, no I/O, mirroring `presentation-generator.ts` but for the
library's template shape. Reuses the exported shared helpers `distinctIcons`,
`iconKey`, `resolveFacets`, `classEntities` from
`meta-model/services/presentation-generator.ts` unchanged.

`generateLibraryPresentationMu(model, authorOverrideDicts)` emits:

```
resources LibraryPresentation {
    // one include per distinct icon referenced by any class
    include "<iconPath>" as <iconKey>
    ...
    // one DataTemplate per class, keyed by class id (string)
    DataTemplate x:key="<classId>" {
        Border [ Background = @SurfaceContainerHigh, CornerRadius = 6, Padding = (10,6,10,6) ] {
            StackPanel [ Orientation = Horizontal ] {
                Shape [ Geometry = @<iconKey>, Fill = @OnSurface, Width = 16, Height = 16, Margin = (0,0,6,0) ]
                TextBlock [ Text = $Display, Foreground = @OnSurface ]
            }
        }
    }
    ...
    // author overrides merged last (author keys win); omitted when none
    merge <AuthorDictName>
}
```

- Classes come from `classEntities(model)` (the same Instance-tier
  `attrs.class === true` nodes `deriveClasses` uses). Keyed by `node.id` so the
  key matches `LibraryRegistry.resolve(classId)` (`node.TermId` = `cls.id`).
- **Icon** resolves via `resolveFacets(node, projectAnnotations(model,
  node.id)).icon` (attr-primary, annotation-fallback). A class with no icon
  emits the label-only branch: `TextBlock [ Text = $Display, ... ]` directly
  inside the `Border`.
- **Label is bound, not baked:** `Text = $Display` — the canvas supplies
  `Display` per placed instance (matching today's default/icon templates).
  This is the one intentional divergence from the meta-model generator, which
  bakes the label as a literal.
- Deterministic output: icons sorted (via `distinctIcons`), classes in model
  order, author dict names sorted.

### Component 2 — Factory capability: `LibraryProjectFactory implements IPresentationProjectFactory`

Add `regeneratePresentation(storage: IStorage): Promise<void>`:

1. `collectTaxonomySources(storage)`; if empty → no-op (return).
2. Resolve the bound meta-model: read the manifest, `resolveBases(provider,
   { metaModel: manifest.metaModel })`. If the meta-model can't resolve
   (unbound or unresolvable) → no-op (leave any existing file untouched); the
   Problems dock already surfaces base problems.
3. `checkAgainst(bases, sources)`; if any `Severity.Error` → no-op.
4. Write `presentation.generated.mu` via a private `writePresentation(storage,
   doc)` that scans `presentation/*.mu` author dicts (same `scanAuthorDicts`
   logic as the meta-model factory) and calls `generateLibraryPresentationMu`.

The menu is already wired: `canGeneratePresentation` now returns true for a
library, unlocking the existing command. No `project-explorer-service.ts` or
`.mu` menu changes.

### Component 3 — Publish: `library/services/library-presentation-publisher.ts` (new)

`publishLibraryPresentation(project, dest, base, doc)` mirrors
`presentation-publisher.ts`:

1. Pre-read every icon SVG from `distinctIcons(doc)` off the project storage.
   Any missing file → `{ ok: false, missing }` — **blocks publish** before
   anything is written (same strictness as meta-models).
2. `generateLibraryPresentationMu(doc, [])` (no author-override merges in the
   compiled artifact — mirrors the meta-model limitation for consistency).
3. Compile with the `svgToGeometryJs` include resolver + `DEFAULT_SYMBOLS`
   (no `MetaModelEntity` symbol needed — library templates use `$Display` and
   string keys). Strip `import` lines → `CompiledPresentation { body, symbols,
   className }`.
4. Write `<base>/presentation/presentation.compiled.json`.
5. Return `{ ok: true, templates, icons }`.

`LibraryProjectFactory.publish` calls it after the compile/derive step and
before returning success; a `{ ok: false }` result blocks the publish with a
"missing icon file(s)" message. Publish also refreshes the project's
`presentation.generated.mu` (calls `writePresentation` with the just-compiled
`doc`), exactly as the meta-model publish does. The publish summary gains the
template/icon counts.

The `CompiledPresentation` interface is shared: reuse the one exported from
`meta-model/services/presentation-publisher.ts` (import the type) rather than
redeclaring it.

### Component 4 — Runtime consumption: `library-loader.ts` + `LibraryRegistry`

**Loader.** Add `loadLibraryPresentation(backend, id, version):
Promise<ResourceDictionary | undefined>` — reads
`<id>/<version>/presentation/presentation.compiled.json`; if present,
`new Function`-evals it (mirroring `presentation-loader.ts`, but ctx needs no
`MetaModelEntity`) → a `ResourceDictionary` of class-keyed templates; if absent
or unreadable → `undefined` (backward compatible with pre-feature bundles).

**Registry.** `LibraryRegistry`:
- On `discover()`, for each library, load its presentation dictionary (if any)
  and keep it per library id (a `Map<projectId, ResourceDictionary>`), merged
  into the app resources alongside `libraryVisuals`.
- `resolve(classId)` tiers become:
  1. authored `visuals/*.mural` compiled template (lazy, cached) — **wins**;
  2. the class's template from the loaded presentation dictionary, if any;
  3. the shared default box.
- The lazy per-class compile (`compileClass`) still handles the authored
  `.mural` override. The old eager `buildIconTemplate` path becomes the
  **fallback** used only when a library has **no** compiled presentation
  (older bundle): if a presentation dictionary is present, an iconful class's
  default comes from it (geometry already baked) instead of a lazy SVG
  read+parse.

**Backward compatibility:** a bundle published before this feature has no
`presentation.compiled.json`; `loadLibraryPresentation` returns `undefined` and
`resolve` falls back to today's `buildIconTemplate`/`buildDefaultTemplate`
behavior unchanged.

## Data flow

```
Author edits .todl ──► "Generate Presentation" (menu)
                          └► LibraryProjectFactory.regeneratePresentation
                               └► generateLibraryPresentationMu ──► presentation.generated.mu (project, editable)

Publish ──► LibraryProjectFactory.publish
              ├► compile doc, derive classes, scan resources (unchanged)
              ├► publishLibraryPresentation ──► presentation/presentation.compiled.json (bundle)
              │     └► (missing icon ⇒ publish blocked)
              └► writePresentation ──► refresh presentation.generated.mu (project)

Runtime ──► LibraryRegistry.discover
              └► loadLibraryPresentation ──► ResourceDictionary (class-keyed, geometry baked)
                    └► resolve(classId): authored .mural ▸ presentation template ▸ default box
```

## Testing

- **Emitter** (`library-presentation-generator.test.ts`): a model with an
  iconful class + an icon-less class → asserts one `include` per distinct icon,
  a `DataTemplate x:key="<classId>"` per class, the icon branch has a `Shape
  [ Geometry = @<iconKey> ]` and `Text = $Display`, the icon-less branch is
  label-only, and an author-dict argument emits a `merge`. Deterministic
  ordering.
- **Factory** (`library-project-factory.test.ts`, extend): `regeneratePresentation`
  writes `presentation.generated.mu` with a template per class + author merge;
  is a no-op with no `.todl`; is a no-op when `checkAgainst` reports an error;
  is a no-op when the meta-model can't resolve.
- **Publisher** (`library-presentation-publisher.test.ts`): compiles a valid
  model → writes `presentation.compiled.json` whose body evals to a dictionary
  containing the class keys; a referenced-but-missing icon → `{ ok: false,
  missing: [...] }` and nothing written.
- **Loader** (`library-loader.test.ts`, extend): a bundle with a compiled
  presentation → `loadLibraryPresentation` returns a dictionary resolving the
  class key; a bundle without one → `undefined`.
- **Registry** (`library-registry.test.ts`, extend): `resolve` returns the
  presentation template for an iconful class when a compiled presentation is
  loaded; an authored `visuals/*.mural` still overrides it; a library with no
  compiled presentation falls back to the default/icon behavior.

## Decisions

- **Reuse the shared emitter helpers** (`distinctIcons`, `iconKey`,
  `resolveFacets`, `classEntities`) rather than parameterizing
  `generatePresentationMu`. Each generator's template shape stays readable and
  independent; the shared code is the icon/label/id plumbing only.
- **Label bound (`$Display`), not baked** — matches how the canvas supplies
  class instance data and today's runtime templates.
- **Publish always bakes** the compiled artifact from the doc, independent of
  whether the author ran "Generate Presentation"; the project `.mu` is the
  author-facing customizable copy. Mirrors the meta-model.
- **Compiled artifact ignores author `presentation/*.mu` overrides** (only the
  project file merges them). Mirrors the known meta-model limitation, kept for
  consistency rather than fixed here.
- **Missing icon blocks publish** — same strictness as meta-models.
- **Backward compatible** — bundles without a compiled presentation keep
  today's rendering behavior.

## Out of scope

- Merging author overrides into the compiled artifact (a shared meta-model gap;
  tracked separately).
- Per-concept default template tiers (`resolve`'s `_concept` param stays
  unused).
- Any change to the meta-model presentation path.

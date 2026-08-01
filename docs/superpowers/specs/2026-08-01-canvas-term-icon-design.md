# Canvas glyph from a term's icon annotation — design (SP3)

## Goal

An architecture-canvas node whose referenced term (or class) carries an `icon`
annotation should render that icon as its glyph — without the author hand-writing
a `visuals/<id>.mural` template. Today such a node falls back to the default
labelled box (no icon).

## Scope

SP3 of the annotate-rendering work (SP1 = TODL language; SP2 = meta-model
browser). Self-contained in the Plexus **library** module + its canvas consumer.
Concept-level default icons (a node with only a concept, no term) are out of
scope — the canvas resolves a glyph by term, and `LibraryRegistry.resolve`'s
unused `concept` param is where that would later hook.

## Feasibility

The runtime SVG→glyph path already exists in `@pragmatic-lab/mural/basic` (a
runtime module already spread into `buildCtx()`):

- `parseSvgIcon(svgText: string, opts?): IconDefinition`
- the `Icon` element — `Source: IconDefinition`, `Foreground`, `Recolor`.

So no compile-time SVG step and no bespoke path→geometry converter is needed: the
registry reads the bundled SVG at mount, parses it, and renders an `Icon`.

## Decisions

- **Icon assets live in `resources/`.** `publish` adds `resources` to the copied
  resource folders, so `annotate icon { path = "resources/foo.svg" }` bundles and
  resolves the same way as in a meta-model. The annotation path is bundle-relative.
- **Authored template wins.** An explicit `visuals/<id>.mural` always wins; the
  icon annotation only replaces the default box when no authored template exists.

## Design

### 1. Bundle carries the icon

`library-bundle.ts`:
- `PublishedClass` gains `icon?: string` — the term's annotation icon path.
- `deriveClasses(model)` sets `cls.icon = projectAnnotations(doc, n.id).icon?.path`
  when present, reusing the meta-model helper `projectAnnotations`
  (`../../meta-model/services/annotation-projection.js`), consistent with the
  factory already importing `collectTaxonomySources` cross-module.

`library-project-factory.ts`:
- Add `'resources'` to the folder list in `publish` (`['visuals', 'assets',
  'docs', 'samples', 'thumbnails']` → add `'resources'`), so the icon SVGs are
  copied into `<id>/<libVersion>/resources/…`. `copyResourceFolder` already
  handles a missing folder as a no-op and copies non-text files as bytes.
- The bundle manifest's `classes` already serialize `PublishedClass`, so `icon`
  rides along into `library.json` with no extra write.

### 2. Loader carries the icon

`library-loader.ts`:
- `LoadedClass` gains `icon?: string`.
- In `discoverLibraries`, copy `c.icon` onto the `LoadedClass` (a plain scalar,
  unlike the resource paths there is no on-disk existence check — the registry
  reads it lazily at mount and degrades gracefully).

### 3. Registry builds the icon template

`visual-library.ts`:
- Add `buildIconTemplate(iconDef: IconDefinition, ctx: Record<string, unknown>): DataTemplate`
  — the icon analog of `buildDefaultTemplate`. It builds, imperatively, a
  `Border > StackPanel [ Icon(Source = iconDef), TextBlock(Text = $Display) ]`
  visual tree (closing over `iconDef`, which is fixed per class), sets the host
  Content as DataContext (so `$Display` binds like the default), and returns a
  `DataTemplate`. The `Icon` `Foreground` is set to the themed on-surface brush so
  a monochrome glyph adopts the canvas theme.

`library-registry.ts`:
- Add a helper to read a class's bundled SVG text on demand:
  `readIconSource(backend, lib, cls): Promise<string | undefined>` (mirrors
  `readTemplateSource`; reads `${lib.id}/${lib.version}/${cls.icon}`, undefined on
  absence/unreadable).
- In `refresh()`, per class, apply precedence:
  1. authored template source present → `compileTemplate` as today (**authored wins**);
  2. else `cls.icon` set → `readIconSource`; if the text loads, `parseSvgIcon` it
     and `libraryVisuals.Set(cls.id, buildIconTemplate(iconDef, this.ctx))`;
  3. else → set nothing → `resolve` returns the shared default box (unchanged).
- A missing SVG file or a `parseSvgIcon` failure pushes a `warning` LoadProblem
  (surfaced in the Problems dock via the existing `publish(lib, problems)` path)
  and leaves the class on the default box. Never fatal.

## Data flow

```
term @icon annotation (SP1 model.json: Annotated edge + <id>@icon node)
  ─deriveClasses→ PublishedClass.icon ─publish→ library.json + resources/<svg>
  ─discoverLibraries→ LoadedClass.icon
  ─refresh()→ readIconSource → parseSvgIcon → buildIconTemplate → libraryVisuals[classId]
  ─canvas resolve(termId)→ Icon + label glyph
```

## Error handling

- Authored template AND icon → authored wins (icon ignored).
- `cls.icon` set but the SVG file is missing / unreadable → warning + default box.
- `parseSvgIcon` throws (`SvgIconParseError`) → warning + default box.
- No icon and no authored template → default box (unchanged behaviour).

## Testing

`tests/` subfolders, Vitest, `FakeStorage`.

- **Bundle** (`library-bundle.test.ts`): `deriveClasses` sets `icon` from a class
  node's `@icon` annotation (nodes + `Annotated` edge fixture); a class with no
  icon annotation leaves `icon` undefined.
- **Publish** (`library-project-factory.test.ts`): publishing a project with a
  `resources/foo.svg` copies it to `<id>/<ver>/resources/foo.svg` in the bundle.
- **Loader** (`library-loader.test.ts`): a `library.json` class with `icon`
  surfaces on the `LoadedClass`.
- **Visual** (`visual-library.test.ts`): `buildIconTemplate(iconDef, ctx)` applied
  to a data object yields a visual tree containing an `Icon` whose `Source` is the
  passed `IconDefinition`; `parseSvgIcon` of a one-path SVG produces an
  `IconDefinition` with a shape.
- **Registry** (`library-registry.test.ts`): with a mounted library whose class
  has an icon and a bundled SVG, `resolve(classId, concept)` returns a template
  that is not the default; a class with both an authored template and an icon
  resolves the authored template; a class with neither resolves the default.

## Migration note

`deriveClasses` / publish run at library-publish time; the registry reads the icon
at mount. A library published before this change carries no `icon` and no
`resources/` copy until republished. No runtime migration.

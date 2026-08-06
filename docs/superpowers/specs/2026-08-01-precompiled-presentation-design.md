# Pre-compiled meta-model presentation — design

**Status:** ✅ Finished

## Problem

Meta-model `publish` ships the presentation as a raw `presentation.generated.mu`
plus separate icon SVGs, and `loadPresentation` `instantiate()`s that source on
every drawer open. Two real defects (root-caused via systematic-debugging):

1. **Fragile.** The generated `.mu` `include`s each icon SVG, but a referenced
   SVG that isn't in the project at publish time is *silently skipped*
   (`presentation-publisher.test.ts`: "a declared icon with no file is skipped,
   not fatal"). The `.mu` still names the `include`, so at load
   `loadPresentation` reads `<base>/presentation/<path>` for it and **throws**,
   failing the whole presentation.
2. **Wasteful.** A published meta-model is immutable, yet the loader re-parses,
   re-compiles, and re-runs `svgToGeometryJs` on every open.

This reverses the original publish spec's "ship source, no compiled JS" decision.
That decision was justified only on "evaluating a JS module with bare imports at
runtime is harder" — but mural already evaluates a *compiled resources body* at
runtime inside `instantiate` (a `new Function` over the body with imports
supplied from a `ctx`), so persisting that body and evaluating it at load is not
the hard path the old spec feared.

## Goal

Compile the presentation **once at publish** into a self-contained, evaluable
artifact — SVG geometry baked in, no external SVG dependency, no per-load
recompilation. The published meta-model, being immutable, carries a ready-to-run
resource dictionary.

## Decisions

- **Compiled-only + republish.** The loader reads only the new compiled artifact.
  Meta-models published before this change must be republished; the loader shows
  a clear "republish this meta-model" error rather than crashing.
- **Missing icon blocks publish.** A referenced icon SVG with no file makes
  publish fail with a message naming the missing paths (replacing today's silent
  skip). A self-contained artifact cannot carry a dangling reference.
- **Author-override `merge` is out of scope** — it is already unwired at load
  (`loadPresentation` never reads/compiles the override `.mu`), and rare.

## Background: how mural compiles + evaluates a resources doc

`compile(source, { include, symbols })`
([compiler/compile.js](../../../node_modules/@pragmatic-lab/mural/dist/compiler/compile.js))
returns `{ js, imports: Map<module, Set<name>>, resourcesBlocks }`. For a
`resources` doc the emitted `js` is `<import lines>\n\n<export class Name extends
ResourceDictionary {…}>`. The `include` resolver inlines each SVG's geometry
(`svgToGeometryJs` → `valueJs` + the visual-engine `imports`) directly into the
body.

`instantiate`'s resources branch evaluates that body as:

```js
const bodyR = body.replace(/^export class /gm, 'class ')
new Function('_ctx', `const { ${syms.join(', ')} } = _ctx;\n` + bodyR + `\nreturn ${className}.Clone();`)(ctx)
```

with `ctx` supplying every imported symbol. We persist the body at publish and run
exactly this eval at load.

## Design

### 1. Compiled artifact

Written to `<base>/presentation/presentation.compiled.json`:

```ts
interface CompiledPresentation {
    body:    string     // the compiled resources body (with `export class …`), geometry inlined
    symbols: string[]   // sorted, unique imported names to destructure from ctx
    className: string   // the resources block name (e.g. "MetaModelPresentation")
}
```

`body` is `compile().js` with the leading `import … from "…";` lines removed;
`symbols` is the flattened, sorted, de-duplicated union of `imports` values;
`className` is `resourcesBlocks[0].name`.

### 2. Publisher (`presentation-publisher.ts`)

`publishPresentation(project, dest, base, doc, authorDicts)` becomes:

1. `const source = generatePresentationMu(doc, authorDicts)` (unchanged generator).
2. Pre-read every referenced icon SVG from the project (async):
   for each `path` of `distinctIcons(doc)`, `project.ReadText(path)`. Collect the
   paths whose read fails.
3. **If any icon is missing → return a publish failure** whose message lists the
   missing paths. (New: replaces the silent skip.)
4. `const result = compile(source, { include, symbols })` with a **sync**
   `include` resolver that looks each `path` up in the pre-read map and returns
   `{ entries: [{ key: ctx.key ?? path, valueJs }], imports: [{ module: VISUAL_ENGINE, names }] }`
   via `svgToGeometryJs` — identical to today's loader resolver, run at publish.
   `symbols` is `new Map([...DEFAULT_SYMBOLS, ['MetaModelEntity', './meta-model-entity.js']])`.
5. Derive `{ body, symbols, className }` from `result` (strip import lines; flatten
   `imports`; `resourcesBlocks[0].name`) and
   `dest.WriteText(`${base}/presentation/presentation.compiled.json`, JSON.stringify(...))`.
6. Do **not** write the raw `.mu` or copy SVGs into the backend.

Return stats stay `{ templates, icons }` for the publish message; `icons` is the
count of inlined geometries.

The factory (`meta-model-project-factory.ts`) is unchanged except that its call to
`publishPresentation` now yields a `PublishResult`-affecting failure when an icon
is missing — surface that message instead of `ok: true`.

### 3. Loader (`presentation-loader.ts`)

`loadPresentation(storage, base)` becomes:

1. Read `<base>/presentation/presentation.compiled.json`. If absent/unreadable,
   throw `Error('This meta-model was published in an older format — republish it to view its presentation.')`.
2. Parse `{ body, symbols, className }`.
3. `const ctx = { ...MuralRuntime, ...MuralEngine, ...MuralBasic, ...MuralFramework, MetaModelEntity }`
   (unchanged).
4. `const bodyR = body.replace(/^export class /gm, 'class ')`
5. `const fn = new Function('_ctx', 'const { ' + symbols.join(', ') + ' } = _ctx;\n' + bodyR + '\nreturn ' + className + '.Clone();')`
6. `return fn(ctx) as ResourceDictionary`

No `includePaths`, no per-SVG read, no `svgToGeometryJs`, no `instantiate`, no
`compile` at load.

### 4. Unchanged

`MetaModelProjectFactory.writePresentation` still writes the project-side
`presentation.generated.mu` (authoring artifact / the "Generate Presentation"
command). The meta-model tree, entity builder, and drawer are untouched — the
loader's return type (`ResourceDictionary`) is the same.

## Data flow

```
publish: doc ─generatePresentationMu→ .mu ─compile({include: bakeSvg})→ {js,imports,resourcesBlocks}
             → strip imports → presentation.compiled.json {body, symbols, className}   (backend)
load:    presentation.compiled.json → new Function(destructure + body + return Clone)(ctx) → ResourceDictionary
```

## Error handling

- Icon SVG missing at publish → publish fails, message names the paths.
- Compiled artifact missing at load (old-format publish) → clear "republish" error.
- `svgToGeometryJs` throws on a malformed SVG at publish → publish fails with the
  compiler error (a genuine authoring problem, surfaced at publish not load).

## Testing

`tests/` subfolders, Vitest, `FakeStorage`, hand-built `TodlDocument` fixtures.

- **Publisher** (`presentation-publisher.test.ts`, rewritten):
  - publishing writes `presentation.compiled.json` and does **not** write
    `presentation.generated.mu` or any `resources/*.svg` into the backend;
  - the artifact's `body` contains the inlined geometry (assert it references a
    visual-engine geometry constructor and no `include`);
  - a declared icon with no project file makes publish fail with the path named;
  - a model with no icons still publishes a valid label-only artifact.
- **Loader** (`presentation-loader.test.ts`, rewritten):
  - given a `presentation.compiled.json` produced by the publisher, `loadPresentation`
    returns a `ResourceDictionary` that `CanResolve('mm:<id>')` and whose template
    applies (icon geometry present) — with **no** SVG files in storage;
  - a missing artifact throws the republish error.
- **Round-trip** (new or in loader test): publish a fixture into one `FakeStorage`,
  load it back, resolve an `mm:<id>` template — proving self-containment end to end.

## Out of scope

- Author-override `merge` dictionaries (already unwired at load).
- The library visual path (separate subsystem; libraries compile `.mural` at mount).
- Changing the generator's output shape or the project-side `.mu`.

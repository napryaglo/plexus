# MuralResource Keys — Design

**Date:** 2026-08-06 (reconciled 2026-08-07 — see §Reconciliation)
**Status:** Approved, reconciled to the C-like identifier grammar
**Repos:** TODL (`@pragmatic-tech-ai/todl`, prelude schema) + Plexus (all key logic)

> **Reconciliation (2026-08-07).** This spec predates the C-like identifier
> migration (TODL 0.19.0 / Plexus SP2). The body below still uses the old
> lowercase spelling; the authoritative deltas are here.
>
> **Casing.** User-defined annotation **type** names are PascalCase and **params**
> are camelCase now. But the well-known `icon` annotation stays **lowercase** (see
> the folded-prerequisite decision below), the base is `MuralResource` (Pascal),
> and its param is **`key`** (not `Key`). Stamping writes `attrs['key']` onto
> application nodes whose `typeOf === 'icon'`.
>
> **Version.** `0.19.0` is already published (the C-like release). The
> MuralResource prelude change is **`@pragmatic-tech-ai/todl@0.20.0`**; Plexus floor
> → `^0.20.0`.
>
> **Folded prerequisite — well-known annotations are a lowercase exception
> (decided 2026-08-07).** The four prelude "well-known" annotations that tools
> switch on by name — **`icon`, `label`, `toolbox`, `instance`** — are lowercase,
> a deliberate exception to types-are-PascalCase. User-defined annotations stay
> PascalCase. SP1's C-like recaser over-eagerly PascalCased the prelude annotation
> names (`Icon`/`Toolbox`/`Instance`), which broke every consumer — all of which
> correctly read lowercase and were never changed:
> - **TODL** `publish/reflect.js` `deriveClasses` reads `projectAnnotations(…).icon`.
> - **Plexus** `presentation-generator.ts` (`n.typeOf === 'icon'`,
>   `annotations['icon']?.['path']`) and `toolbox-projection.ts`
>   (`projectAnnotations(…)['toolbox']`).
>   With the prelude PascalCased, `annotate Icon` produced a `typeOf: "Icon"` app
>   node these lowercase reads never matched → icon/toolbox projection silently
>   produced nothing. The existing tests hand-build lowercase-`typeOf` graphs,
>   which stayed green and masked it.
>
> **The fix is to revert the prelude, not the consumers.** In the TODL prelude:
> `Icon`→`icon`, `Toolbox`→`toolbox`, `Instance`→`instance`, and **add** a real
> `annotation label { text : string? }` (impossible while it was `Label` — that
> name is taken by `primitive Label`; lowercase `label` coexists fine). All
> consumers and fixtures stay unchanged and correct. This ships in the same
> `0.20.0` bump as MuralResource.
>
> **Doc revert.** SP2's scaffold-doc rewrite PascalCased the well-known
> `annotate Icon`/`annotate Label`/`annotation Icon` mentions in `todl-manual.md`,
> `meta-model-guide.md`, and `claude-root.md`. Revert those four well-known names
> to lowercase; user-defined-annotation examples (`Category`, `Author`, `Owner`)
> stay PascalCase.
>
> **Casing under this decision:** the MuralResource base is `MuralResource`
> (PascalCase — a base type, not a tool-switched key), its param is `key`
> (camelCase), `icon : MuralResource` (lowercase well-known extends the Pascal
> base), the primitive is `ResourceKey`, and stamping writes `attrs['key']` onto
> `typeOf === 'icon'` application nodes.

## Goal

Introduce a `MuralResource` annotation base carrying a generator-assigned
`Key`, with the standard `icon` annotation inheriting it. During presentation
generation the key becomes **collision-aware** and **single-authority**, and is
**stamped into the compiled artifact** (`model.json`) — the annotation gets the
key written back, while the `.todl` source stays untouched.

## Motivation

Today the resource key is not stored: `iconKey(path)` derives it deterministically
(`resources/az.svg` → `mm_icon_az`) and **four** independent call-sites recompute
it — the assets include, the compiled-artifact include, the author-stub icon
element, and `distinctIcons`. Two weaknesses:

1. **Silent collision.** Two icons with the same filename stem
   (`a/az.svg`, `b/az.svg`) both map to `mm_icon_az`; the resource dict gets two
   `include … as mm_icon_az`, last wins, one geometry serves both — the wrong
   icon renders for one. This is a latent bug in the current pure-function
   approach: a pure `iconKey` *cannot* be collision-aware.
2. **No durable key.** Nothing records the assigned key, so a consumer of the
   published `model.json` must recompute `iconKey` (and cannot, once assignment
   is collision-aware and therefore stateful across the icon set).

Making the generator the single key authority fixes (1) — it can dedup — and
stamping the key onto the annotation fixes (2). Annotation inheritance (shipped
in `@pragmatic-tech-ai/todl` 0.18.0) is exactly the mechanism: `MuralResource` as a
base generalises the pattern to future bakeable resource kinds (brush, geometry,
embedded blob) that all inherit the same `Key` slot.

## Decisions (settled during brainstorming)

- **Write-back target: stamp-on-compile, artifact only.** The generator assigns
  `Key` into the compiled `TodlDocument` (→ `model.json`) each publish; the
  `.todl` source is never rewritten. Idempotent, low blast radius, aligns with
  the author-owned-source direction.
- **Scope: end-to-end.** The generator is the sole key authority (collision-aware),
  the key is stamped onto the annotation, and every consumer routes through the
  one assignment instead of recomputing independently.
- **Key logic stays Plexus-side.** `iconKey`, collision handling, and stamping
  are mural/presentation concepts. TODL only *declares* the `MuralResource`/`icon`
  schema so `projectAnnotations` surfaces `Key`. TODL must not learn what a mural
  resource key is (preserves Mural-depends-on-TODL, never the reverse).
- **`ResourceKey` is its own primitive.** `iconKey` emits underscore keys
  (`mm_icon_az`), which the prelude's `slug` and `identifier` primitives forbid
  (both hyphen-only). So `ResourceKey` needs its own regex allowing underscores.
- **`Key` is optional and generator-owned.** Authors omit it; the generator fills
  it. No author-facing validation — if an author writes it, the generator
  overwrites (YAGNI on a warning).

## Architecture

### TODL — schema only

`src/stdlib/prelude.todl`:

```todl
// Standard primitives
primitive ResourceKey : string { regex = "^[a-z][a-z0-9_]*$"; }

// Standard annotations
annotation MuralResource { Key : ResourceKey?; }
annotation icon : MuralResource { path : string?; }
```

- `icon` inherits `Key` via `effectiveSchema` (annotation params are `HasField`
  edges; inheritance walks `Extends` first-wins — already the mechanism).
- Regenerate `prelude.generated.ts` (`npm run gen:prelude`), bump version,
  publish to Verdaccio, bump Plexus `@pragmatic-tech-ai/todl` floor.
- No new TODL validation, no emit change, no reflection change: `projectAnnotations`
  already surfaces every application attr, so a stamped `Key` appears in the
  `icon` bag automatically.

### Plexus — key authority + stamping

All in `src/renderer/src/modules/meta-model/services/`.

**`presentation-generator.ts`**
- Keep `iconKey(path)` as the internal base-key (pre-collision stem) helper.
- Add `assignResourceKeys(doc: TodlDocument): Map<string, string>` —
  deterministic, collision-aware: collect distinct icon paths (same set as
  `distinctIcons`), sort, assign `iconKey(stem)`; on a duplicate key, suffix
  `_2`, `_3`, … in sorted order. Pure function of the doc's icon paths.
- Add `resourceKeyFor(doc: TodlDocument, path: string): string` — lookup into
  `assignResourceKeys(doc)`.
- Because assignment keys off *paths* and stamping only adds `Key` **attrs**
  (never changes the icon-path set), `assignResourceKeys(doc)` stays a pure
  function — every call-site computes the identical map with **no threading**,
  exactly like `iconKey` today but collision-safe.

**Replace the four `iconKey(path)` uses with `resourceKeyFor(doc, path)`:**
- `generatePresentationAssets` — `include "${p}" as ${resourceKeyFor(doc, p)}`.
- `presentation-publisher.ts` `combinedSource` — same (shared with the library
  publisher, so the library project type is fixed by the same edit).
- `presentation-scaffold.ts` `iconElement` — thread `doc` in (via `templateBlock`,
  which already has `doc`): `iconElement(doc, icon)` → `resourceKeyFor(doc, icon)`.

**Stamping.** Add `stampResourceKeys(doc: TodlDocument): void` (mutates in place)
in `presentation-generator.ts`: for each `@icon` application node
(`node.typeOf === 'icon'` with a string `path` attr), set
`node.attrs['Key'] = resourceKeyFor(doc, path)`. Called in the project factory
(both meta-model and library) over the in-memory `TodlDocument` **before**
`model.json` is persisted — this is the write-back, landing in the artifact only.

### What reads the stamped Key

In-process consistency is guaranteed by the shared deterministic assignment, so
the durable stamped `Key` is the contract for **external / downstream / future**
consumers of the published `model.json` (e.g. runtime icon-by-key resolution) —
the explicit "write the key back to the annotation." `deriveClasses` stays
path-based: it runs inside TODL's compile, upstream of the Plexus stamp, and TODL
cannot compute mural keys.

## Data flow (publish)

```
compilePackage(bases, sources) ──► CompiledPackage { document, classes, … }   (TODL; classes path-based)
        │
        ▼  (Plexus factory)
map = assignResourceKeys(document)          ← single collision-aware authority
stampResourceKeys(document)                 ← writes Key onto @icon app nodes (mutates document)
publishPresentation(project, dest, base, document)
        ├─ scaffoldAuthorStubs → iconElement emits @resourceKeyFor(doc, icon)
        └─ combinedSource      → include "path" as resourceKeyFor(doc, p)   (compiler bakes geometry under that key)
        │
        ▼
persist model.json (now carries Key on @icon apps) + presentation.compiled.json + src
```

## Testing

- **TODL:** a compile test that an `icon` application carries the inherited `Key`
  param in its `effectiveSchema` and that `projectAnnotations` surfaces a
  `Key` attr when present on the app node. Prelude-shape assertions (if any)
  updated for the new primitive/annotation.
- **Plexus (pure, no I/O):**
  - `assignResourceKeys` — distinct stems get base keys; **colliding stems get
    deterministic `_2`/`_3` suffixes** in sorted order (the core new behavior).
  - `resourceKeyFor` — returns the assigned (possibly suffixed) key.
  - `stampResourceKeys` — `@icon` app nodes gain `attrs.Key`; non-icon nodes and
    raw `attrs.icon` nodes are untouched.
  - `generatePresentationAssets` / `combinedSource` / `iconElement` — emit the
    assigned key (regression: no collision → identical to today's output).

## Known limitations (documented, not fixed here)

1. **Polymorphic projection surfaces `MuralResource`.** Every `icon` app now also
   indexes under `MuralResource` in `projectAnnotations` output (is-a). Harmless:
   `resolveFacets` and `toolbox-projection` read by explicit annotation name
   (`icon`, `label`, `toolbox`), never enumerate.
2. **Write-once author stubs bake `@key` literally.** A later publish that adds a
   *colliding* icon could reshuffle a suffix and stale an already-written stub's
   `@key`. A mild tail (collisions are rare — same stem, different directory) and
   strictly better than today's silent-wrong-icon overwrite.

## Out of scope

- No `.todl` source rewriting (stamp-on-compile only).
- No new resource subtypes yet (`brush`/`geometry`/`embedded`) — `MuralResource`
  is the base that makes them cheap later.
- `deriveClasses` / `PublishedClass` stay path-based.
- No author-facing validation of the generator-owned `Key`.

# Eager library-visual compile (synchronous resolve)

**Date:** 2026-08-08
**Status:** approved (scope chosen), pending review

## Decision

Make `LibraryRegistry.resolve()` fully synchronous. Compile every class's
authored `.mural` template / legacy icon **eagerly during `discover()`** (already
async) instead of lazily on first `resolve()`. No more "default box → real visual"
async upgrade flash.

This reverses the "lazy library templates" optimization (the panel deferred
per-class compile). The user accepted the tradeoff: eager compile does more work in
`discover()`, but every visual is final by the time it is first resolved.

## Current (lazy) flow being removed

- `resolve()` returns the default box on first miss and schedules an async
  `compileClass()` that reads + compiles the template, then fires `onChanged`; a
  subscribed presenter re-resolves and upgrades in place.
- Bookkeeping: `inFlight`, `attempted`, `classIndex`, `compileClass`, and the
  `resolve()`-time scheduling.

## New (eager) flow

- `discover()`: for each library, load its baked presentation first, then compile
  every class into a **detached** `nextLibrary` dictionary (authored `.mural` wins;
  else the legacy loose-SVG icon *only* when no baked presentation covers the
  class — unchanged precedence). Compile failures publish per-library Problems as
  today.
- Swap `nextLibrary` and `nextPresentation` into the app resources via
  `ReplaceMergedDictionary` — one notification each, **library before
  presentation** (authored-vs-presentation precedence preserved). Skip the library
  swap when `nextLibrary` is empty and was never merged, so the
  no-authored-template case stays at zero library notifications (preserves the
  existing O(1)-notification guarantee).
- `resolve(classId)`: `libraryVisuals.Resolve ?? presentationVisuals.Resolve ??
  default` — no scheduling, no async.
- Keep the `onChanged`/listener API (consumed by `LibraryClassVisualResolver`) and
  fire `onChanged(classId)` for every discovered class at the end of `discover()`,
  so a re-discover (install/uninstall) refreshes any open canvas presenter. First
  load has no subscribers yet, so it is harmless there.

## Removed state

`inFlight`, `attempted`, `classIndex`, `merged`, `ensureMerged`, `compileClass`
(replaced by an eager `compileClassInto(into, presentation, backend, lib, cls)` that
returns whether it added an entry). `libraryVisuals` becomes non-readonly (rebuilt +
swapped each discover, like `presentationVisuals`); add a `libraryMerged` tracker.

## Consumers — no change needed

`LibraryClassVisualResolver.AddChangedListener` still bridges `onChanged`. The
presenter still upgrades on the event; it simply won't fire mid-`resolve()` anymore.

## Testing

Rewrite `library-registry.test.ts`:
- "discover eagerly compiles authored templates; resolve returns the class's own
  template immediately" (no `whenCompiled`).
- "resolve is synchronous and fires no onChanged" (subscribe after discover; three
  resolves fire zero events).
- icon-annotation and authored-wins-over-icon cases resolve non-default right after
  discover.
- compile-failure case publishes the error during `discover()` and resolves to
  default.
- "authored overrides baked presentation" compared across two registries (with vs
  without the authored file) — authored ≠ presentation, both non-default.
- The O(1)-notification test is unchanged (its classes have no authored template, so
  the empty library swap is skipped).
- Delete + presentation-immediate tests unchanged.
- Drop the `whenCompiled` helper.

## Out of scope

- The baked-presentation eval cost in `discover()` (already eager; profiled by the
  opt-in benchmark) — untouched.
- Any change to consumers, the presenter, or `.mu` hosts.

# Plexus Installation Package — Design Spec

**Date:** 2026-09-01
**Status:** Draft for review
**Owner:** Plexus

## Goal

Give Plexus a real distribution story: reproducible, downloadable installers
built by CI. v1 ships a **Windows MSI** (manual updates) and **Linux AppImage +
deb** (AppImage auto-updates), built by a GitHub Actions matrix and published to
GitHub Releases. macOS is explicitly deferred.

## Scope (v1)

In scope:
- `electron-builder` packaging on top of the existing `electron-vite build`.
- Windows target: **MSI** only (no auto-update — MSI is not an electron-updater
  target; updates are manual / IT-managed).
- Linux targets: **AppImage** (auto-updating) + **deb** (plain download).
- **electron-updater** wired for the Linux AppImage only.
- App icon/branding assets.
- **GitHub Actions** release workflow (matrix: `windows-latest`, `ubuntu-latest`)
  publishing one GitHub Release.
- CI resolves the private `@pragmatic-lab/*` packages via **GitHub Packages**.

Out of scope (documented as future work, not built):
- macOS (DMG/zip, signing, notarization, Mac auto-update).
- Windows auto-update (would require adding an NSIS target).
- Code signing on any platform (v1 is unsigned).
- In-app update UI beyond electron-updater's `checkForUpdatesAndNotify`.

## Decisions (locked during brainstorming)

| Question | Decision |
| --- | --- |
| Tooling | electron-builder |
| Platforms | Windows + Linux (macOS dropped for v1) |
| Windows format | MSI only (manual updates) |
| Linux format | AppImage + deb |
| Auto-update | Linux AppImage only, electron-updater → GitHub Releases |
| Signing | Unsigned |
| Build/release | GitHub Actions matrix, publish to GitHub Releases |
| Private deps in CI | GitHub Packages |

## Global Constraints

- **App identity:** `appId = com.pragmatic-lab.plexus`, `productName = Plexus`.
- **Version source of truth:** `package.json` `version`; installers and the
  GitHub Release tag derive from it. Bump `0.0.1 → 0.1.0` for the first release.
- **Unsigned:** users will see SmartScreen "unknown publisher" (Windows) and
  no signature (Linux). Acceptable for v1.
- **No native modules:** all production deps are pure-JS, so no node-gyp rebuild
  step is required in CI.
- Existing repo rules still apply: tests live in `tests/` subfolders next to
  source; `compile:mu` is part of `build`.

## Architecture

```
npm run build            electron-builder                GitHub Actions
(existing)               (new)                           (new)
────────────────         ───────────────                 ────────────────
compile:mu               reads out/** + prod node_modules  matrix:
build:todl-server   ──▶   asar-packs the app         ──▶   - windows-latest → MSI
electron-vite build      emits per-target installers        - ubuntu-latest  → AppImage + deb
  → out/{main,             → release/*.msi                  publishes ONE GitHub Release
     preload,renderer}     → release/*.AppImage             (electron-builder --publish always)
  → out/main/               → release/*.deb
     todl-language-         → release/latest-linux.yml
     server.cjs               (updater metadata)
                                                          electron-updater (in app, Linux only)
                                                          reads latest-linux.yml from the Release
```

The packaging layer is additive: `electron-vite build` is unchanged and remains
the single source of the runnable app under `out/`. electron-builder never
rebuilds the app — it only packages what `out/` already contains, plus the
production `node_modules` electron-vite externalizes for the main process.

## Components

### 1. `electron-builder.yml` (new, repo root)

```yaml
appId: com.pragmatic-lab.plexus
productName: Plexus
directories:
  output: release
  buildResources: build
files:
  - out/**
  - package.json
asar: true
# The build/ folder holds icon.ico + icon.png (buildResources), auto-picked up.
win:
  target: [msi]
linux:
  target: [AppImage, deb]
  category: Development
  maintainer: Pragmatic Lab <evgen.napryaglo@gmail.com>
publish:
  provider: github
  owner: napryaglo
  repo: plexus
```

Notes:
- `files` deliberately ships only `out/**` + `package.json`; electron-builder
  then copies production `dependencies` from `node_modules` automatically.
- `asar: true` bundles app + node_modules into one archive. `out/main/
  todl-language-server.cjs` is inside `out/**`, so it rides along in the asar;
  it is spawned as a child process — verify it launches from within asar (if it
  cannot, add it to `asarUnpack`). This is called out as a verification step.

### 2. Branding assets (`build/`)

- `build/icon.ico` — Windows, 256×256 (multi-size ICO).
- `build/icon.png` — Linux, 512×512.

Source: derive from the existing title-bar logo mark (`@PlexusTitleBar` — a
`Path`/`Ellipse` vector in `title-bar.resources.mu`) rendered to raster, or a
simple placeholder mark the user can replace later. The icon is not
load-bearing; a placeholder is acceptable for v1 and flagged for replacement.

### 3. `package.json` changes

- Add devDependency: `electron-builder` (^25 or current).
- Scripts:
  - `package` — `npm run build && electron-builder` (current platform).
  - `package:win` — `npm run build && electron-builder --win`.
  - `package:linux` — `npm run build && electron-builder --linux`.
- `version`: `0.0.1 → 0.1.0`.
- **Dependency reclassification:** `@pragmatic-lab/mural`, `@pragmatic-lab/fresco`,
  and `monaco-editor` are bundled into `out/renderer` at build time and are not
  required by the main process at runtime. Move them from `dependencies` to
  `devDependencies` so electron-builder does not ship them inside the asar.
  Runtime `dependencies` that remain (used by the main process): `chokidar`,
  `@modelcontextprotocol/sdk`, `vscode-jsonrpc`, `@pragmatic-lab/todl`,
  `marked`, `highlight.js`, `vscode-languageserver-types`. **Verification:** a
  packaged run must exercise diagram open, agent chat, and the TODL language
  server to confirm nothing bundled-only was actually needed at runtime; if a
  reclassified package throws at runtime, move it back.

### 4. `src/main/updater.ts` (new) + wiring

A thin electron-updater wrapper:

```ts
import { autoUpdater } from 'electron-updater'

// Auto-update is wired for the Linux AppImage only. On Windows (MSI) and in dev
// there is no update feed, so this is a guarded no-op there.
export function initAutoUpdate(): void {
  const isLinuxAppImage = process.platform === 'linux' && !!process.env.APPIMAGE
  if (!isLinuxAppImage) return
  autoUpdater.checkForUpdatesAndNotify().catch(() => { /* offline / no release */ })
}
```

Called once from the main entry after the first window is ready. Add
`electron-updater` as a production dependency (it must be in the asar). Tests:
a unit test asserting `initAutoUpdate` is a no-op when `platform !== 'linux'` /
`APPIMAGE` unset (inject `process` values), placed in
`src/main/tests/updater.test.ts`.

### 5. `.github/workflows/release.yml` (new)

Trigger: push of a tag matching `v*` (and `workflow_dispatch` for manual runs).

```yaml
name: release
on:
  push:
    tags: ['v*']
  workflow_dispatch:
permissions:
  contents: write   # create the Release
  packages: read    # read @pragmatic-lab/* from GitHub Packages
jobs:
  build:
    strategy:
      matrix:
        include:
          - os: windows-latest
            args: --win
          - os: ubuntu-latest
            args: --linux
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://npm.pkg.github.com
          scope: '@pragmatic-lab'
      - run: npm ci
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - run: npm run build
      - run: npx electron-builder ${{ matrix.args }} --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Both matrix legs publish to the same Release (electron-builder dedups by tag).

### 6. GitHub Packages prerequisite (private-dep access)

**This is a prerequisite, not code in the Plexus repo.** CI runners cannot reach
the local Verdaccio (`localhost:4873`), so the `@pragmatic-lab/*` packages must
live somewhere the runners can read. Chosen mechanism: GitHub Packages.

Constraint: GitHub Packages' npm registry requires the package **scope to match
the owning org/user**. The scope is `@pragmatic-lab` but the repos are under the
`napryaglo` user — so publishing `@pragmatic-lab/*` to GitHub Packages requires a
**GitHub organization named `pragmatic-lab`** to own those packages. Steps
(one-time + on each framework change):

1. Create a `pragmatic-lab` GitHub org (or accept a scope rename — not chosen).
2. Publish `@pragmatic-lab/mural`, `@pragmatic-lab/fresco`, `@pragmatic-lab/todl`
   **and their transitive `@pragmatic-lab` deps** (e.g. `@pragmatic-lab/todl-runtime`)
   to `https://npm.pkg.github.com` under that org.
3. Plexus repo gets a committed `.npmrc` for CI:
   `@pragmatic-lab:registry=https://npm.pkg.github.com` (auth via `NODE_AUTH_TOKEN`
   in CI). Local dev keeps using Verdaccio via the developer's own `.npmrc`
   (not committed, or via `npm_config_registry`), so local builds are unaffected.

This prerequisite is the gating item for the CI matrix; if it is not in place,
Phase 3 cannot run, but Phases 1–2 (local Windows MSI) still work against
Verdaccio.

## Release process (once built)

1. Bump `package.json` version, commit.
2. Tag `vX.Y.Z`, push the tag.
3. GitHub Actions builds the matrix and publishes the Release with the MSI,
   AppImage, deb, and `latest-linux.yml`.
4. Linux AppImage users auto-update on next launch; Windows users download the
   new MSI manually.

## Testing / Verification

- **Local Windows MSI (Phase 1):** `npm run package:win` produces `release/
  Plexus Setup*.msi` (or `Plexus*.msi`); install it, launch, and verify: window
  opens, a diagram opens, agent chat works, the TODL language server starts
  (proves the `todl-language-server.cjs` runs from inside asar and no reclassified
  dep was runtime-needed).
- **Local Linux (Phase 2, via a Linux box/WSL/CI):** `npm run package:linux`
  produces an AppImage + deb; smoke-launch the AppImage.
- **updater unit test:** `src/main/tests/updater.test.ts` asserts the guard.
- **CI (Phase 3):** a tag push produces a GitHub Release with all four artifacts.
- **Auto-update E2E:** deferred/manual — publish `v0.1.0` then `v0.1.1`, confirm
  an installed AppImage updates. (Full automation is out of scope for v1.)

## Phasing (implementation order)

- **Phase 1 — Local Windows packaging.** electron-builder + `electron-builder.yml`
  + icons + package.json scripts/deps + version bump. Deliverable: a working
  local MSI. (No CI, no updater yet — proves the packaging core against Verdaccio.)
- **Phase 2 — Linux targets + auto-update.** Add AppImage/deb targets +
  `src/main/updater.ts` + wiring + test. Deliverable: Linux artifacts + guarded
  updater.
- **Phase 3 — CI + GitHub Packages.** Publish `@pragmatic-lab/*` to GitHub
  Packages (prerequisite), add `.npmrc` for CI, add `release.yml`. Deliverable: a
  tag push yields a published GitHub Release.

## Risks / open items

- **GitHub Packages org prerequisite** (scope ≠ owner) — needs a `pragmatic-lab`
  org before Phase 3. Biggest external dependency.
- **asar + child process** — `todl-language-server.cjs` and any spawned helper
  must run from inside asar; may need `asarUnpack`. Verified in Phase 1.
- **MSI target maturity** — electron-builder's MSI is basic (WiX). If it proves
  limiting, `msiWrapped` or NSIS-as-well are fallbacks (NSIS would also re-enable
  Windows auto-update — a future option).
- **Unsigned friction** — SmartScreen/Gatekeeper warnings; accepted for v1.
- **Version 0.0.1** — must bump before first release (electron-updater treats
  versions semantically).

## Future work

- macOS (DMG/zip + signing + notarization + Mac auto-update).
- Windows NSIS target → Windows auto-update.
- Code signing (Windows cert, Apple Developer ID).
- Automated auto-update E2E in CI.

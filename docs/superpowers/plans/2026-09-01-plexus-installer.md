# Plexus Installation Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package Plexus into downloadable installers — Windows MSI + Linux AppImage/deb — built and released by CI, with AppImage auto-update.

**Architecture:** electron-builder is added as an additive packaging layer over the existing `electron-vite build` (which emits `out/{main,preload,renderer}` + `out/main/todl-language-server.cjs`). electron-builder asar-packs `out/**` plus production node_modules into per-platform installers. electron-updater (main process, guarded to Linux AppImage only) reads a GitHub Release. A GitHub Actions matrix builds Windows on `windows-latest` and Linux on `ubuntu-latest` and publishes one Release; CI resolves the private `@pragmatic-tech-ai/*` packages from GitHub Packages.

**Tech Stack:** electron-builder, electron-updater, electron-vite (existing), GitHub Actions, GitHub Packages.

**Spec:** `docs/superpowers/specs/2026-09-01-plexus-installer-design.md`

## Global Constraints

- App identity: `appId = com.pragmatic-lab.plexus`, `productName = Plexus`.
- Version source of truth: `package.json` `version`; bump `0.0.1 → 0.1.0` for the first release.
- Windows target: **MSI only** (no auto-update). Linux targets: **AppImage + deb**. macOS: out of scope for v1.
- Auto-update: **Linux AppImage only**, via electron-updater → GitHub Releases.
- Unsigned on all platforms.
- No native modules (all prod deps are pure-JS) — no node-gyp rebuild in CI.
- Tests live in a `tests/` subfolder next to the source they exercise (repo rule).
- `compile:mu` + `build:todl-server` are part of `npm run build` and must run before packaging.
- The committed `.npmrc` points at local Verdaccio; **do not** repoint it — CI overrides the registry in-workflow so local dev is unaffected.

---

## File Structure

- `electron-builder.yml` (new, repo root) — packaging config: appId, productName, targets, publish.
- `build/icon.ico`, `build/icon.png` (new) — app icons (buildResources).
- `package.json` (modify) — add electron-builder + electron-updater deps, packaging scripts, version bump, dependency reclassification.
- `src/main/updater-guard.ts` (new) — pure `shouldAutoUpdate(platform, env)` predicate (no electron import; unit-testable).
- `src/main/updater.ts` (new) — `initAutoUpdate()` wrapping electron-updater, using the guard.
- `src/main/tests/updater-guard.test.ts` (new) — guard unit tests.
- `src/main/index.ts` (modify) — align `setAppUserModelId`; call `initAutoUpdate()` after window creation.
- `.github/workflows/release.yml` (new) — CI release matrix.
- `.gitignore` (modify) — ignore the `release/` output dir.

---

## Phase 1 — Local Windows MSI

### Task 1: Scaffold electron-builder + config + scripts

**Files:**
- Create: `electron-builder.yml`
- Modify: `package.json` (devDeps, scripts, version), `src/main/index.ts:101`, `.gitignore`

**Interfaces:**
- Produces: `npm run package` / `package:win` / `package:linux` scripts; `electron-builder.yml` at repo root; output dir `release/`.

- [ ] **Step 1: Install electron-builder**

```bash
cd Plexus
npm install --save-dev electron-builder@^25 --registry http://localhost:4873/
```

Expected: `electron-builder` appears under devDependencies. (Verdaccio proxies public npm.)

- [ ] **Step 2: Create `electron-builder.yml`**

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

- [ ] **Step 3: Add packaging scripts + bump version in `package.json`**

Add to `scripts`:

```json
"package": "npm run build && electron-builder",
"package:win": "npm run build && electron-builder --win",
"package:linux": "npm run build && electron-builder --linux"
```

Change `"version": "0.0.1"` → `"version": "0.1.0"`.

- [ ] **Step 4: Align the runtime AppUserModelId in `src/main/index.ts`**

At line 101, change:

```ts
electronApp.setAppUserModelId('com.plexus.app')
```

to:

```ts
electronApp.setAppUserModelId('com.pragmatic-lab.plexus')
```

- [ ] **Step 5: Ignore the output dir**

Append to `.gitignore`:

```
release/
```

- [ ] **Step 6: Verify a fast unpacked package builds**

Run:

```bash
npm run build && npx electron-builder --dir
```

Expected: completes without error; produces `release/win-unpacked/Plexus.exe` (a runnable unpacked app). This proves the config + `files` globs + asar are correct without waiting for the full MSI.

- [ ] **Step 7: Smoke-launch the unpacked app**

Run `release/win-unpacked/Plexus.exe`. Expected: the Plexus window opens and renders the shell (no white screen / missing-asset errors). Close it.

- [ ] **Step 8: Commit**

```bash
git add electron-builder.yml package.json .gitignore src/main/index.ts
git commit -m "build: add electron-builder packaging config + scripts"
```

---

### Task 2: App icons

**Files:**
- Create: `build/icon.ico`, `build/icon.png`

**Interfaces:**
- Produces: `build/icon.ico` (Windows, 256×256 multi-size), `build/icon.png` (512×512) — auto-picked up by electron-builder from `buildResources: build`.

- [ ] **Step 1: Provide a 512×512 source PNG**

Create `build/icon.png` (512×512). Source it from the title-bar logo mark (`src/renderer/src/window/title-bar.resources.mu`, the `@PlexusTitleBar` Path/Ellipse) rendered to raster, OR use a solid-color placeholder with the letter "P" — the icon is not load-bearing for v1 and is flagged for later replacement. It MUST be exactly 512×512 or electron-builder warns/fails.

- [ ] **Step 2: Generate `build/icon.ico` from the PNG**

Use electron-icon-builder or any ICO tool to produce a multi-size `build/icon.ico` (must include 256×256). Example:

```bash
npx electron-icon-builder --input=build/icon.png --output=build --flatten
# then rename/copy the produced 256x256 ico to build/icon.ico if needed
```

Verify `build/icon.ico` exists and is a valid ICO (openable in an image viewer).

- [ ] **Step 3: Rebuild unpacked and confirm the icon is applied**

Run:

```bash
npx electron-builder --dir
```

Expected: no icon warnings in output; `release/win-unpacked/Plexus.exe` shows the custom icon in Explorer.

- [ ] **Step 4: Commit**

```bash
git add build/icon.ico build/icon.png
git commit -m "build: add Plexus app icons"
```

---

### Task 3: Windows MSI target

**Files:** (none new — exercises Task 1 config)

**Interfaces:**
- Produces: `release/Plexus 0.1.0.msi` (an installable MSI).

- [ ] **Step 1: Build the MSI**

Run:

```bash
npm run package:win
```

Expected: electron-builder downloads the WiX toolset (first run) and emits an `.msi` under `release/`. Note the exact filename from the output.

- [ ] **Step 2: Install the MSI**

Double-click the `.msi` (or `msiexec /i "release\Plexus 0.1.0.msi"`). Expected: installs without error; a Start-menu entry "Plexus" appears.

- [ ] **Step 3: Launch the installed app and smoke-test core flows**

Launch Plexus from the Start menu. Verify: window opens; open a diagram (renders); open Agent Chat (composer renders). This confirms the renderer assets and preload load correctly from the installed asar.

- [ ] **Step 4: Verify the TODL language server runs from inside asar**

Open a `.todl` file in the installed app and confirm syntax highlighting / no "language server failed" error in the app. This proves `out/main/todl-language-server.cjs` is spawnable from within the asar. **If it fails to spawn:** add to `electron-builder.yml`:

```yaml
asarUnpack:
  - out/main/todl-language-server.cjs
```

then rebuild (Step 1) and re-verify.

- [ ] **Step 5: Uninstall to confirm a clean uninstaller**

Uninstall Plexus via Settings → Apps. Expected: removes cleanly.

- [ ] **Step 6: Commit any asarUnpack change (if needed)**

```bash
git add electron-builder.yml
git commit -m "build: unpack todl language server from asar for spawn" # only if Step 4 required it
```

If no change was needed, skip the commit (this task produced an artifact, not source).

---

### Task 4: Dependency reclassification

**Files:**
- Modify: `package.json` (move bundled deps to devDependencies)

**Interfaces:**
- Produces: a slimmer runtime dependency set — only main-process runtime deps remain in `dependencies`.

- [ ] **Step 1: Move bundled-into-renderer deps to devDependencies**

In `package.json`, move `@pragmatic-tech-ai/mural`, `@pragmatic-tech-ai/fresco`, and `monaco-editor` from `dependencies` to `devDependencies`. Leave in `dependencies`: `chokidar`, `@modelcontextprotocol/sdk`, `vscode-jsonrpc`, `@pragmatic-tech-ai/todl`, `marked`, `highlight.js`, `vscode-languageserver-types`.

- [ ] **Step 2: Reinstall to refresh the tree**

```bash
npm install --registry http://localhost:4873/
```

Expected: no errors; `node_modules` still has all packages (devDeps are installed locally).

- [ ] **Step 3: Rebuild and repackage**

```bash
npm run build && npx electron-builder --dir
```

Expected: build succeeds (mural/fresco/monaco still resolve at build time as devDeps).

- [ ] **Step 4: Smoke-test the packaged app for runtime regressions**

Launch `release/win-unpacked/Plexus.exe` and verify: diagram opens (mural runtime), agent chat works, Monaco code editor opens a `.todl`/`.md` file, TODL language server runs. **If any feature throws a "cannot find module" for a reclassified package**, that package IS needed at runtime — move it back to `dependencies`, reinstall, rebuild, re-verify.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: reclassify renderer-bundled deps to devDependencies"
```

---

## Phase 2 — Linux targets + auto-update

### Task 5: electron-updater guard (pure, TDD)

**Files:**
- Create: `src/main/updater-guard.ts`, `src/main/tests/updater-guard.test.ts`

**Interfaces:**
- Produces: `shouldAutoUpdate(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): boolean` — true only for a Linux AppImage run (`platform === 'linux' && !!env.APPIMAGE`).

- [ ] **Step 1: Write the failing test**

`src/main/tests/updater-guard.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { shouldAutoUpdate } from '../updater-guard'

describe('shouldAutoUpdate', () => {
  it('is true only for a Linux AppImage run', () => {
    expect(shouldAutoUpdate('linux', { APPIMAGE: '/tmp/Plexus.AppImage' })).toBe(true)
  })
  it('is false on Linux when not an AppImage (no APPIMAGE env)', () => {
    expect(shouldAutoUpdate('linux', {})).toBe(false)
  })
  it('is false on Windows even with APPIMAGE set', () => {
    expect(shouldAutoUpdate('win32', { APPIMAGE: '/x' })).toBe(false)
  })
  it('is false on macOS', () => {
    expect(shouldAutoUpdate('darwin', {})).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/tests/updater-guard.test.ts`
Expected: FAIL — cannot find module `../updater-guard`.

- [ ] **Step 3: Implement the guard**

`src/main/updater-guard.ts`:

```ts
// Auto-update is wired for the Linux AppImage only (Windows ships MSI, which has
// no electron-updater feed; macOS is out of scope). electron-builder sets the
// APPIMAGE env var when the app runs from an AppImage bundle.
export function shouldAutoUpdate(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): boolean {
  return platform === 'linux' && Boolean(env.APPIMAGE)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/tests/updater-guard.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/updater-guard.ts src/main/tests/updater-guard.test.ts
git commit -m "feat(updater): pure shouldAutoUpdate guard (Linux AppImage only)"
```

---

### Task 6: Wire electron-updater into main

**Files:**
- Create: `src/main/updater.ts`
- Modify: `package.json` (add `electron-updater` dependency), `src/main/index.ts:127`

**Interfaces:**
- Consumes: `shouldAutoUpdate(platform, env)` from Task 5.
- Produces: `initAutoUpdate(): void` — checks for updates only when `shouldAutoUpdate` is true.

- [ ] **Step 1: Add electron-updater as a runtime dependency**

```bash
npm install --save electron-updater --registry http://localhost:4873/
```

Expected: `electron-updater` under `dependencies` (it must ride inside the asar).

- [ ] **Step 2: Implement `src/main/updater.ts`**

```ts
import { autoUpdater } from 'electron-updater'
import { shouldAutoUpdate } from './updater-guard'

// Called once after the first window is ready. On non-Linux-AppImage runs this
// is a no-op; on a Linux AppImage it checks the GitHub Release feed and notifies
// the user when an update is downloaded. Errors (offline, no release yet) are
// swallowed — a failed update check must never block startup.
export function initAutoUpdate(): void {
  if (!shouldAutoUpdate(process.platform, process.env)) return
  void autoUpdater.checkForUpdatesAndNotify().catch(() => { /* offline / no release */ })
}
```

- [ ] **Step 3: Call it after window creation in `src/main/index.ts`**

In the `app.whenReady().then(async () => { ... })` block, immediately after the `createWindow()` call at line 127, add:

```ts
  createWindow()
  initAutoUpdate()
```

And add the import near the top with the other local imports:

```ts
import { initAutoUpdate } from './updater'
```

- [ ] **Step 4: Typecheck the main process**

Run: `npm run typecheck:node`
Expected: passes (no type errors from the new import / call).

- [ ] **Step 5: Verify the guard tests still pass and the app still builds**

Run: `npx vitest run src/main/tests/updater-guard.test.ts && npm run build`
Expected: tests PASS; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/main/updater.ts src/main/index.ts
git commit -m "feat(updater): wire electron-updater (Linux AppImage auto-update)"
```

---

## Phase 3 — CI release matrix + GitHub Packages

> **DEFERRED — blocked on an org/scope rename (owner-driven).** GitHub Packages requires the npm scope to match the owning org login. The current scope `@pragmatic-tech-ai` cannot be used: the `pragmatic-lab` login is owned by an unrelated third party (a 2020 "Holanda Pets" org), and no org the user owns has that login. Decision (2026-09-01): the user will **rename the package scope** across all framework repos (`@pragmatic-tech-ai/*` → a new scope matching a user-owned org, e.g. `@pragmatic-tech-ais-com/*`) once that org is set up, then publish the packages to GitHub Packages under it.
>
> Until that rename lands, **Task 7 is on hold**. When it does, revisit this task's `owner`, the scope in the CI `.npmrc` step, and `electron-builder.yml` `publish.owner`/`repo` to match the final names. The scope rename itself is a **separate, larger cross-repo task** (every package name + every `@pragmatic-tech-ai/*` import across Mural/Fresco/TODL/todl-runtime/Plexus, plus a Verdaccio republish) — not part of this plan.
>
> Phases 1–2 do NOT depend on any of this and proceed now against local Verdaccio.

### Task 7: GitHub Actions release workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Produces: a `release` workflow that, on a `v*` tag push, builds the Windows + Linux matrix and publishes one GitHub Release with the MSI, AppImage, deb, and `latest-linux.yml`.

- [ ] **Step 1: Create `.github/workflows/release.yml`**

```yaml
name: release
on:
  push:
    tags: ['v*']
  workflow_dispatch:
permissions:
  contents: write   # create the GitHub Release
  packages: read    # read @pragmatic-tech-ai/* from GitHub Packages
jobs:
  build:
    strategy:
      fail-fast: false
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
      - name: Point @pragmatic-tech-ai at GitHub Packages (CI only)
        shell: bash
        run: |
          printf '@pragmatic-tech-ai:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=%s\n' "${GITHUB_TOKEN}" > .npmrc
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - run: npm ci
      - run: npm run build
      - name: Package + publish
        run: npx electron-builder ${{ matrix.args }} --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Notes for the implementer:
- The `.npmrc` written in the workflow **overwrites** the committed Verdaccio `.npmrc` for the CI run only (the checkout's working copy), so local dev is untouched. Because it is written to the repo working dir, npm's project-level `.npmrc` resolution uses the GitHub Packages registry for the `@pragmatic-tech-ai` scope.
- `--publish always` makes electron-builder create/update the GitHub Release named for the tag and upload artifacts + updater metadata.

- [ ] **Step 2: Lint the workflow YAML**

Verify the file parses (e.g. open in an editor with YAML validation, or `npx yaml-lint .github/workflows/release.yml` if available). Expected: valid YAML, correct indentation.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add release matrix (Windows MSI + Linux AppImage/deb) to GitHub Releases"
```

- [ ] **Step 4: End-to-end verification (requires the GitHub Packages prerequisite)**

Once the `pragmatic-lab` org + published packages exist:
1. `git tag v0.1.0 && git push origin v0.1.0`
2. Watch the Actions run; both matrix legs must go green.
3. Confirm a GitHub Release `v0.1.0` exists with: `Plexus 0.1.0.msi`, `Plexus-0.1.0.AppImage`, a `.deb`, and `latest-linux.yml`.

If the prerequisite is not yet met, stop after Step 3 and record that Step 4 is blocked on the org/publishing task — the workflow is correct but cannot run green until then.

---

## Self-Review

**Spec coverage:**
- Windows MSI → Task 1 (config) + Task 3 (build/verify). ✓
- Linux AppImage + deb → Task 1 (config); real build in Task 7 CI (can't build Linux on the Windows dev box — noted). ✓
- electron-updater, Linux-only → Tasks 5–6. ✓
- Icons → Task 2. ✓
- appId/productName/version → Task 1. ✓
- Dependency reclassification → Task 4. ✓
- GitHub Actions matrix + publish → Task 7. ✓
- GitHub Packages private-dep access → Task 7 prerequisite + CI `.npmrc` step. ✓
- asar child-process (todl server) risk → Task 3 Step 4 (asarUnpack fallback). ✓
- Unsigned, no macOS, no Windows auto-update → respected throughout (no signing/mac/NSIS tasks). ✓

**Placeholder scan:** No TBD/TODO. Icon "placeholder acceptable" is a deliberate spec decision, not a gap. Linux build verification is explicitly deferred to CI with a stated reason (can't cross-build from Windows), not hand-waved.

**Type consistency:** `shouldAutoUpdate(platform, env)` signature is identical in Task 5 (definition + tests) and Task 6 (consumer). `initAutoUpdate()` defined in Task 6 and called in `index.ts` in the same task. `electron-builder.yml` keys referenced consistently across Tasks 1/3/4.

**Note on TDD fit:** Tasks 1–4 and 7 are configuration/packaging whose correct-behavior test is "the artifact builds and launches," so their verification steps are build+smoke rather than unit tests. Only Task 5 has pure logic and follows a strict red→green cycle. This is intentional and honest for a packaging subsystem.

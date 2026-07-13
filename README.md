# Plexus

A diagram editor built on **`@visualisation-sub/mural`**, packaged as an
**Electron** desktop app (electron-vite).

*Plexus* — a network of interconnected nodes — for the connective, graph
nature of diagrams (nodes and the edges between them).

## Why it lives in the mural repo (for now)

Plexus is the primary thing driving mural's API to maturity, so it lives here
as a **sibling app** — but it consumes mural through its **published package
surface** (`@visualisation-sub/mural/*`), never relative `../src` paths and
never internals. That gives two things at once:

- **API-boundary discipline** — the app only sees what an external consumer
  would, so it surfaces real gaps in the public surface.
- **Zero-friction iteration** — a framework gap can be fixed and re-tested in
  the same tree, no publish / `npm link` round-trip.

Because it already imports across the package boundary, extracting this app to
its **own repo** later (mural as a versioned npm dependency) is a config
change, not a rewrite. Do that once mural's API stabilises.

## Architecture

Electron gives Plexus native capabilities (file open/save for diagram
documents, app menu, offline). The split:

- **Renderer** (`src/renderer`) is Chromium, so mural's `HtmlTarget` / SVG
  pipeline runs exactly as in a browser. Vite bundles it, resolving
  `@visualisation-sub/mural/*` to the framework's **built dist** (see
  `electron.vite.config.ts` — pinned off the `development` condition so src
  `.ts` isn't bundled). The mural UI is authored in `src/renderer/src/app.mu`
  and compiled to `app.mu.js` by the mural CLI before Vite bundles it.
- **Main** (`src/main`) owns the window and, in time, the native surface —
  file dialogs, menus, recent files — exposed to the renderer as typed IPC.
- **Preload** (`src/preload`) is the context-bridge seam. Native features
  reach the app through an **injected mural service** (like the demo's
  `DiagramStorageKey`), so no view / view-model code imports Electron.

```
apps/plexus/
├─ electron.vite.config.ts   main / preload / renderer builds; mural→dist; opentype shim
├─ src/
│  ├─ main/index.ts          BrowserWindow → renderer
│  ├─ preload/index.ts       contextBridge (native api — empty for now)
│  └─ renderer/
│     ├─ index.html          renderer entry
│     ├─ opentype-shim.mjs   default-export shim for opentype.js (bundler)
│     └─ src/
│        ├─ main.js          bootstrap: mount `app` onto an HtmlTarget
│        └─ app.mu           mural UI → app.mu.js (mural CLI)
├─ package.json              main: out/main/index.js ; electron-vite scripts
├─ tsconfig.{json,node,web}  electron-vite three-config setup
└─ out/                      build output (gitignored)
```

## Build & run

The renderer bundles mural's **built dist**, so build the framework first.

```sh
# from the repo root — build the framework dist Plexus bundles
npm run build

# from apps/plexus
npm install        # once — electron-vite toolchain + the mural symlink
npm run dev        # compile app.mu, then electron-vite dev (HMR) + launch
```

`npm run build` here produces the packaged bundles under `out/`; `npm start`
previews them. Re-run the **root** `npm run build` after editing framework
source (the renderer bundles `dist`); the app's own `.mu` / renderer code
hot-reloads under `npm run dev`.

> Packaging into installers (electron-builder / forge makers) is not wired yet
> — added when there's something worth shipping.

## Status

Skeleton frame only — a header bar over an empty canvas surface, proving the
Electron + electron-vite + mural build loop end to end (main/preload/renderer
all bundle; the mural UI mounts). Next: a tool palette, a `DiagramDocument`
backing the canvas items, an inspector pane, and the file-IO IPC service.

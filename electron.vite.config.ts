import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'electron-vite'

// electron-vite drives three separate Rollup/Vite builds — main (Node),
// preload (Node, isolated bridge), and renderer (Chromium). The renderer is
// where mural lives: Vite bundles `@visualisation-sub/mural/*` from the
// `file:../..` linked dependency.
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      // Pin mural to its BUILT dist (the `default`/`import` export
      // conditions), NOT the `development` condition (which points at
      // src/*.ts). mural's source uses NodeNext `.js` import specifiers that
      // resolve to `.ts` under tsc but that Vite's resolver will not remap —
      // so bundling src would break. Consume the compiled dist instead and
      // rebuild it (root `npm run build`) when framework source changes.
      conditions: ['import', 'module', 'browser', 'default'],
      // Redirect ONLY the bare `opentype.js` specifier (regex-anchored, so
      // the shim's own deep import to dist/opentype.mjs is untouched) to a
      // shim that provides the default export mural imports. opentype.js's
      // ESM bundle ships named exports only; a pure-ESM bundler won't
      // synthesise the default the way Node's CJS interop does.
      alias: [
        {
          find: /^opentype\.js$/,
          replacement: fileURLToPath(new URL('./src/renderer/opentype-shim.mjs', import.meta.url)),
        },
      ],
    },
    // mural is a `file:../..` linked package under active development. Vite's
    // dep pre-bundler snapshots node_modules deps into .vite/deps at dev-server
    // start and does NOT re-optimize when the linked dist changes underneath it —
    // so a framework rebuild (new DPs, services, controls) is silently masked by
    // a stale pre-bundle until the cache is manually cleared. Excluding mural from
    // pre-bundling makes Vite serve the live dist on every request: rebuild the
    // root dist and the renderer picks it up on reload, no cache dance. Safe —
    // exclude only skips bundling, resolution is unaffected.
    optimizeDeps: {
      exclude: ['@visualisation-sub/mural'],
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') },
      },
    },
  },
})

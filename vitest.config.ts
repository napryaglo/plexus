import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit tests only. The pure layout-pipeline logic (adapter, run-modes)
// is tested here; mural-framework/.mu integration is verified via
// typecheck, compile:mu, and manual `npm run dev`, not Vitest.
//
// resolve.conditions pins @pragmatic-tech-ai/mural (a transitive dep of
// fresco) to its built dist. mural's package exports nest
// import.development -> ./src/*.ts (not shipped) and import.default ->
// ./dist/*.js; omitting the "development" condition makes resolution
// fall through to dist. The deps.inline forces the @pragmatic-tech-ai
// packages through Vite's transform pipeline so those conditions apply
// (externalized node_modules deps would bypass them). Mirrors
// electron-vite's condition list.
const CONDITIONS = ['import', 'module', 'browser', 'default']

// @pragmatic-tech-ai/todl exposes only a ROOT ('.') export, whose nested
// import.default → ./dist/index.js trips Vite's resolvePackageEntry (the same
// root-export path fails for @pragmatic-tech-ai/mural too — which is why everything
// else imports mural via subpaths like /runtime). Alias the bare specifier
// straight to the built entry so the root export resolves. Regex-anchored so
// only the exact specifier is redirected.
const TODL_ALIAS = {
    find: /^@pragmatic-tech-ai\/todl$/,
    replacement: fileURLToPath(new URL('./node_modules/@pragmatic-tech-ai/todl/dist/index.js', import.meta.url)),
}

export default defineConfig({
    resolve: { conditions: CONDITIONS, alias: [TODL_ALIAS] },
    ssr: { resolve: { conditions: CONDITIONS } },
    test: {
        include: ['src/**/*.test.ts'],
        environment: 'node',
        server: { deps: { inline: [/@pragmatic-tech-ai\//] } },
    },
})

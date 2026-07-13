import { defineConfig } from 'vitest/config'

// Unit tests only. The pure layout-pipeline logic (adapter, run-modes)
// is tested here; mural-framework/.mu integration is verified via
// typecheck, compile:mu, and manual `npm run dev`, not Vitest.
export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
        environment: 'node',
    },
})

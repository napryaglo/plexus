# CLAUDE.md

Plexus — a diagram editor built on mural, packaged as an Electron desktop app
(electron-vite). Consumes `@pragmatic-tech-ai/mural` and `@pragmatic-tech-ai/fresco` from
the local registry (Verdaccio); no relative `../src` imports into the framework.

## Testing

- **Every test file lives in a `tests/` subfolder next to the code it
  exercises** — `src/main/agent/tests/agent-session.test.ts`, never
  `src/main/agent/agent-session.test.ts`. Vitest globs `src/**/*.test.ts` either
  way (see `vitest.config.ts`), so this is organizational: keep source
  directories free of test files.

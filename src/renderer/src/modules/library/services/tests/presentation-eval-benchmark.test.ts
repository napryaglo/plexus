/// <reference types="node" />
import { test, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import * as MuralRuntime from '@pragmatic-lab/mural/runtime'
import * as MuralBasic from '@pragmatic-lab/mural/basic'
import * as MuralFramework from '@pragmatic-lab/mural/framework'
import * as MuralEngine from '@pragmatic-lab/mural/visual-engine'

import { loadLibraryPresentation } from '../library-loader.js'
import { LibraryClassData } from '../library-class-data.js'
import type { CompiledPresentation } from '../../../meta-model/services/presentation-publisher.js'

// Opt-in profile for the ONE eager, main-thread cost the lazy-template work did
// NOT remove: LibraryRegistry.discover() evals each library's presentation.compiled.json
// (a `new Function` over the whole baked-template JS) synchronously at panel-open.
// This measures that eval against the REAL installed microsoft library — the
// question is whether that eval is the Libraries-panel-open freeze. Runs only when
// PLEXUS_BENCH is set and the bundle is actually installed on disk:
//   PLEXUS_BENCH=1 npx vitest run src/renderer/src/modules/library/services/tests/presentation-eval-benchmark.test.ts
const RUN = process.env.PLEXUS_BENCH === '1'

// <userData>/libraries/microsoft/0.1.0 — userData on Windows is %APPDATA%/<app>.
const APPDATA = process.env.APPDATA ?? ''
const BUNDLE = `${APPDATA}/@pragmatic-lab/plexus/libraries/microsoft/0.1.0`
const COMPILED = `${BUNDLE}/presentation/presentation.compiled.json`

function ms(fn: () => void): number {
    const t0 = performance.now()
    fn()
    return performance.now() - t0
}

// A one-method IStorage stub: loadLibraryPresentation only calls ReadText.
function diskBackend(): { ReadText: (rel: string) => Promise<string> } {
    return { ReadText: (rel: string) => Promise.resolve(readFileSync(`${BUNDLE}/${rel.replace(/^microsoft\/0\.1\.0\//, '')}`, 'utf8')) }
}

test.skipIf(!RUN || !existsSync(COMPILED))('presentation.compiled.json eval cost (real microsoft library)', async () => {
    const raw = readFileSync(COMPILED, 'utf8')
    const parsed = JSON.parse(raw) as CompiledPresentation
    const lines: string[] = []
    lines.push(`bundle: ${COMPILED}`)
    lines.push(`compiled body: ${(parsed.body.length / 1024 / 1024).toFixed(2)} MB (${parsed.body.length} chars), symbols: ${parsed.symbols.length}`)

    // Phase breakdown, replicating loadLibraryPresentation's exact steps so we can
    // see which part of the eval dominates (JSON.parse vs Function build vs Clone).
    const ctx: Record<string, unknown> = { ...MuralRuntime, ...MuralEngine, ...MuralBasic, ...MuralFramework, LibraryClassData }
    const destructure = parsed.symbols.length > 0 ? `const { ${parsed.symbols.join(', ')} } = _ctx;\n` : ''
    const bodyR = parsed.body.replace(/^export class /gm, 'class ')

    const tParse = ms(() => { JSON.parse(raw) })
    let fn!: (c: unknown) => unknown
    const tBuild = ms(() => { fn = new Function('_ctx', `${destructure}${bodyR}\nreturn ${parsed.className}.Clone();`) as (c: unknown) => unknown })
    let dict: unknown
    const tRun = ms(() => { dict = fn(ctx) })
    const count = (dict as { Entries(): Iterable<unknown> }).Entries !== undefined
        ? [...(dict as { Entries(): Iterable<unknown> }).Entries()].length : -1
    lines.push(`JSON.parse: ${tParse.toFixed(1)} ms`)
    lines.push(`new Function (build): ${tBuild.toFixed(1)} ms`)
    lines.push(`fn(ctx) Clone (build ${count} templates): ${tRun.toFixed(1)} ms`)

    // End-to-end via the REAL loader (includes ReadText), warm and cold, to show
    // what discover() actually pays per library. First call is cold (JIT).
    const backend = diskBackend() as unknown as Parameters<typeof loadLibraryPresentation>[0]
    const t0 = performance.now(); await loadLibraryPresentation(backend, 'microsoft', '0.1.0'); const tCold = performance.now() - t0
    const t1 = performance.now(); await loadLibraryPresentation(backend, 'microsoft', '0.1.0'); const tWarm = performance.now() - t1
    lines.push(`loadLibraryPresentation end-to-end: cold ${tCold.toFixed(1)} ms, warm ${tWarm.toFixed(1)} ms`)

    const table = '=== presentation eval profile (real microsoft, 470 classes) ===\n' + lines.join('\n')
    const out = process.env.PLEXUS_BENCH_OUT
    if (out !== undefined) readFileSync // no-op guard for lints; write below
    if (out !== undefined) (await import('node:fs')).writeFileSync(out, table + '\n')
    // eslint-disable-next-line no-console
    console.log('\n' + table + '\n')
    expect(count).toBeGreaterThanOrEqual(470)
})

import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { DiagnosticsService } from '../../../services/diagnostics/diagnostics-service.js'
import { DiagnosticSeverity, type Diagnostic } from '../../../services/diagnostics/diagnostic.js'
import { ProblemsService, ProblemRowKind } from '../problems-service.js'

function diag(over: Partial<Diagnostic>): Diagnostic
{
    return {
        owner: 'todl', projectId: '/p', projectName: 'P', uri: 'a.todl',
        message: 'm', severity: DiagnosticSeverity.Error,
        span: { startLine: 2, startColumn: 3, endLine: 2, endColumn: 4 }, ...over,
    }
}

function env(): { store: DiagnosticsService; problems: ProblemsService }
{
    const provider = new ServiceProvider()
    const store = new DiagnosticsService(provider)
    provider.registerInstance(DiagnosticsService.Key, store)
    const problems = new ProblemsService(provider)
    return { store, problems }
}

test('counts errors and warnings across the store', () => {
    const { store, problems } = env()
    store.Publish('todl', '/p', [
        diag({ uri: 'a.todl', severity: DiagnosticSeverity.Error }),
        diag({ uri: 'a.todl', severity: DiagnosticSeverity.Warning }),
    ])
    expect(problems.ErrorCount).toBe(1)
    expect(problems.WarningCount).toBe(1)
})

test('single project: no project header, one self-contained row per diagnostic', () => {
    const { store, problems } = env()
    store.Publish('todl', '/p', [
        diag({ uri: 'a.todl', message: 'boom', span: { startLine: 2, startColumn: 3, endLine: 2, endColumn: 4 } }),
        diag({ uri: 'b.todl' }),
    ])
    const kinds = [...problems.Rows].map((r) => r.Kind)
    expect(kinds).not.toContain(ProblemRowKind.ProjectHeader)
    expect(kinds).toEqual([ProblemRowKind.Diagnostic, ProblemRowKind.Diagnostic])
    // Each row carries the message AND its file+location in one item.
    const first = [...problems.Rows][0]!
    expect(first.Label).toBe('boom')
    expect(first.Detail).toBe('a.todl 2:3')
})

test('multi-project: a project header per project', () => {
    const { store, problems } = env()
    store.Publish('todl', '/p', [diag({ projectId: '/p', projectName: 'P', uri: 'a.todl' })])
    store.Publish('todl', '/q', [diag({ projectId: '/q', projectName: 'Q', uri: 'a.todl' })])
    const headers = [...problems.Rows].filter((r) => r.Kind === ProblemRowKind.ProjectHeader)
    expect(headers.map((h) => h.Label).sort()).toEqual(['P', 'Q'])
})

test('project-level (null-uri) diagnostic renders as a row with an empty location', () => {
    const { store, problems } = env()
    store.Publish('todl', '/p', [diag({ uri: null, span: null, message: 'Unresolved base: ea@1.' })])
    const diags = [...problems.Rows].filter((r) => r.Kind === ProblemRowKind.Diagnostic)
    expect(diags.length).toBe(1)
    expect(diags[0]!.Label).toBe('Unresolved base: ea@1.')
    expect(diags[0]!.Detail).toBe('')
})

test('IsOpen starts closed; Expand() forces the popup open', () => {
    const { problems } = env()
    expect(problems.IsOpen).toBe(false)
    problems.Expand()
    expect(problems.IsOpen).toBe(true)
})

test('a single Publish of many diagnostics rebuilds the rows once, not once per diagnostic', () => {
    // Regression: DiagnosticsService.All fires one collection-change event PER
    // item (Clear + N Adds). Subscribing to that stream made ProblemsService do a
    // full O(N) regroup + non-virtualized row re-materialization on every event —
    // O(N^2), which froze the app on a project with hundreds of diagnostics. The
    // store must signal "changed" once per Publish, so the rows rebuild once.
    const { store, problems } = env()
    const many = Array.from({ length: 50 }, (_, i) => diag({ uri: `f${i}.todl`, message: `m${i}` }))
    // Warm the rows so a subsequent rebuild's rows.Clear() actually fires.
    store.Publish('todl', '/p', many)
    let clears = 0
    problems.Rows.Subscribe((c) => { if (c.kind === 'cleared') clears += 1 })
    // A second publish of the whole set must rebuild the rows exactly once — not
    // once per diagnostic (pre-fix: ~N clears from N+1 store events).
    store.Publish('todl', '/p', many)
    expect(clears).toBe(1)
    expect([...problems.Rows].length).toBe(50)
})

test('SummaryText reflects the counts', () => {
    const { store, problems } = env()
    expect(problems.SummaryText).toBe('No problems')
    store.Publish('todl', '/p', [
        diag({ uri: 'a.todl', severity: DiagnosticSeverity.Error }),
        diag({ uri: 'a.todl', severity: DiagnosticSeverity.Warning }),
    ])
    expect(problems.SummaryText).toBe('1 error, 1 warning')
})

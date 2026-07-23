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

test('single project: file headers, no project header', () => {
    const { store, problems } = env()
    store.Publish('todl', '/p', [diag({ uri: 'a.todl' }), diag({ uri: 'b.todl' })])
    const kinds = [...problems.Rows].map((r) => r.Kind)
    expect(kinds).not.toContain(ProblemRowKind.ProjectHeader)
    expect(kinds.filter((k) => k === ProblemRowKind.FileHeader).length).toBe(2)
    expect(kinds.filter((k) => k === ProblemRowKind.Diagnostic).length).toBe(2)
})

test('multi-project: a project header per project', () => {
    const { store, problems } = env()
    store.Publish('todl', '/p', [diag({ projectId: '/p', projectName: 'P', uri: 'a.todl' })])
    store.Publish('todl', '/q', [diag({ projectId: '/q', projectName: 'Q', uri: 'a.todl' })])
    const headers = [...problems.Rows].filter((r) => r.Kind === ProblemRowKind.ProjectHeader)
    expect(headers.map((h) => h.Label).sort()).toEqual(['P', 'Q'])
})

test('project-level (null-uri) diagnostic groups under a Project bucket', () => {
    const { store, problems } = env()
    store.Publish('todl', '/p', [diag({ uri: null, message: 'Unresolved base: ea@1.' })])
    const fileHeaders = [...problems.Rows].filter((r) => r.Kind === ProblemRowKind.FileHeader)
    expect(fileHeaders.map((h) => h.Label)).toContain('Project')
})

test('IsExpanded starts collapsed; ToggleCommand flips it; Expand forces open', () => {
    const { problems } = env()
    expect(problems.IsExpanded).toBe(false)
    problems.ToggleCommand.Execute(undefined)
    expect(problems.IsExpanded).toBe(true)
    problems.ToggleCommand.Execute(undefined)
    expect(problems.IsExpanded).toBe(false)
    problems.Expand()
    expect(problems.IsExpanded).toBe(true)
})

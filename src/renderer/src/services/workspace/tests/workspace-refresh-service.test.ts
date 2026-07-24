import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { WorkspaceRefreshService } from '../workspace-refresh-service.js'
import { ProjectExplorerService } from '../../../modules/project-explorer/services/project-explorer-service.js'
import { DiagnosticsService } from '../../diagnostics/diagnostics-service.js'
import { DiagnosticSeverity } from '../../diagnostics/diagnostic.js'
import { AgentEventKind, type AgentEvent, type RefreshProjectResult } from '../../../../../shared/agent-api.js'

// Minimal fakes. onEvent captures the handler so the test can push events; the
// bridge records the results the service sends back. A fake ProjectExplorerService
// exposes two open projects and records the folders passed to RefreshProjects.
function harness(): {
    provider: ServiceProvider
    results: RefreshProjectResult[]
    refreshedWith: string[][]
    push: (e: AgentEvent) => void
}
{
    let handler: ((e: AgentEvent) => void) | undefined
    const results: RefreshProjectResult[] = []
    const refreshedWith: string[][] = []

    ;(globalThis as unknown as { api: unknown }).api = {
        agent: {
            onEvent: (h: (e: AgentEvent) => void) => { handler = h; return () => { handler = undefined } },
            refreshProjectResult: (r: RefreshProjectResult) => { results.push(r); return Promise.resolve() },
        },
    }

    const provider = new ServiceProvider()
    provider.registerInstance(ProjectExplorerService.Key, {
        OpenProjects: { ToArray: () => [
            { Folder: '/p/a', Name: 'A' },
            { Folder: '/p/b', Name: 'B' },
        ] },
        RefreshProjects: async (folders: readonly string[]) => { refreshedWith.push([...folders]) },
    } as unknown as ProjectExplorerService)

    const diagnostics = new DiagnosticsService(provider)
    provider.registerInstance(DiagnosticsService.Key, diagnostics)
    diagnostics.Publish('todl', '/p/a', [
        { owner: 'todl', projectId: '/p/a', projectName: 'A', uri: 'x.todl', message: 'boom', severity: DiagnosticSeverity.Error, span: null },
    ])

    return { provider, results, refreshedWith, push: (e) => handler?.(e) }
}

// Let the async event handler settle (it awaits RefreshProjects).
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('WorkspaceRefreshService', () => {
    beforeEach(() => { delete (globalThis as unknown as { api?: unknown }).api })
    afterEach(() => { delete (globalThis as unknown as { api?: unknown }).api })

    test('no path → refreshes all open projects and returns a summary each', async () => {
        const h = harness()
        const service = new WorkspaceRefreshService(h.provider)
        h.push({ Kind: AgentEventKind.RefreshProject, Request: { id: 'r1' } })
        await settle()
        expect(h.refreshedWith[0]).toEqual(['/p/a', '/p/b'])
        const result = h.results[0]!
        expect(result.id).toBe('r1')
        expect(result.projects.length).toBe(2)
        expect(result.projects.find((p) => p.folder === '/p/a')?.errorCount).toBe(1)
        service.Dispose()
    })

    test('path inside project A → refreshes only A', async () => {
        const h = harness()
        const service = new WorkspaceRefreshService(h.provider)
        h.push({ Kind: AgentEventKind.RefreshProject, Request: { id: 'r2', path: '/p/a/models/x.todl' } })
        await settle()
        expect(h.refreshedWith[0]).toEqual(['/p/a'])
        expect(h.results[0]!.projects.length).toBe(1)
        service.Dispose()
    })

    test('path matching nothing → empty projects with a note', async () => {
        const h = harness()
        const service = new WorkspaceRefreshService(h.provider)
        h.push({ Kind: AgentEventKind.RefreshProject, Request: { id: 'r3', path: '/nope/x.todl' } })
        await settle()
        expect(h.refreshedWith[0]).toEqual([])
        expect(h.results[0]!.projects.length).toBe(0)
        expect((h.results[0]!.note ?? '').length).toBeGreaterThan(0)
        service.Dispose()
    })
})

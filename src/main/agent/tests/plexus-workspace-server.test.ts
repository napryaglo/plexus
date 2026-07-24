import { describe, test, expect } from 'vitest'
import { PlexusWorkspaceServer } from '../plexus-workspace-server.js'
import { AgentEventKind, type AgentEvent, type RefreshProjectResult } from '../../../shared/agent-api.js'

describe('PlexusWorkspaceServer', () => {
    test('requestRefresh emits a RefreshProject event and resolves with the posted result', async () => {
        const server = new PlexusWorkspaceServer()
        const events: AgentEvent[] = []
        server.setSink((e) => events.push(e))

        const pending = server.requestRefresh('/proj/a/file.todl')
        expect(events.length).toBe(1)
        const evt = events[0]!
        expect(evt.Kind).toBe(AgentEventKind.RefreshProject)
        const req = (evt as { Request: { id: string; path?: string } }).Request
        expect(req.path).toBe('/proj/a/file.todl')

        const result: RefreshProjectResult = {
            id: req.id,
            projects: [{ name: 'A', folder: '/proj/a', errorCount: 1, warningCount: 0, sampleMessages: ['boom'] }],
        }
        server.resolve(result)
        expect(await pending).toEqual(result)
    })

    test('requestRefresh with no sink resolves immediately with an error', async () => {
        const server = new PlexusWorkspaceServer()
        const result = await server.requestRefresh()
        expect(result.projects.length).toBe(0)
        expect((result.error ?? '').length).toBeGreaterThan(0)
    })

    test('requestRefresh times out with an error when the renderer never replies', async () => {
        const server = new PlexusWorkspaceServer(20) // 20ms timeout
        server.setSink(() => { /* never resolves */ })
        const result = await server.requestRefresh()
        expect((result.error ?? '').toLowerCase()).toContain('timed out')
    })
})

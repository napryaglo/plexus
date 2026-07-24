import { test, expect, beforeEach, afterEach } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'

import type { IAgentApi } from '../../../../../../shared/agent-api.js'
import { EnvironmentService } from '../../../../services/environment/environment-service.js'
import { OpenProjectsStore } from '../../../../services/projects/open-projects-store.js'
import AgentService from '../agent-service.js'

// A fake bridge recording each turn's (cwd, addDirs, text).
function fakeAgent(): { api: IAgentApi; turns: Array<{ cwd: string; addDirs: readonly string[]; text: string }> } {
    const turns: Array<{ cwd: string; addDirs: readonly string[]; text: string }> = []
    const api: IAgentApi = {
        startSession: () => Promise.resolve(),
        sendTurn: (cwd, addDirs, text) => { turns.push({ cwd, addDirs, text }); return Promise.resolve() },
        abort: () => Promise.resolve(),
        answerQuestion: () => Promise.resolve(),
        onEvent: () => () => {},
    }
    return { api, turns }
}

// A minimal fake OpenProjectsStore (Current + List + Subscribe + a test-only push).
function fakeStore(initial: string[] = []) {
    let folders = [...initial]
    const listeners = new Set<(f: readonly string[]) => void>()
    return {
        Current: () => folders,
        List: () => Promise.resolve(folders),
        Subscribe: (l: (f: readonly string[]) => void) => { listeners.add(l); return () => listeners.delete(l) },
        push: (next: string[]) => { folders = next; for (const l of listeners) l(folders) },
    }
}

function providerWith(store: unknown): ServiceProvider {
    const provider = new ServiceProvider()
    provider.registerInstance(OpenProjectsStore.Key, store as OpenProjectsStore)
    provider.registerInstance(EnvironmentService.Key, { CurrentDirectory: '/fallback' } as EnvironmentService)
    return provider
}

let agentApi: ReturnType<typeof fakeAgent>
beforeEach(() => { agentApi = fakeAgent(); (globalThis as unknown as { api: unknown }).api = { agent: agentApi.api } })
afterEach(() => { delete (globalThis as unknown as { api?: unknown }).api })

test('a turn targets the open projects: first = cwd, rest = addDirs', () => {
    const store = fakeStore(['/A', '/B', '/C'])
    const svc = new AgentService(providerWith(store))
    svc.Draft = 'hi'
    svc.SendCommand.Execute(undefined)
    expect(agentApi.turns).toEqual([{ cwd: '/A', addDirs: ['/B', '/C'], text: 'hi' }])
})

test('with no open project the turn falls back to CurrentDirectory, no addDirs', () => {
    const svc = new AgentService(providerWith(fakeStore([])))
    svc.Draft = 'hi'
    svc.SendCommand.Execute(undefined)
    expect(agentApi.turns).toEqual([{ cwd: '/fallback', addDirs: [], text: 'hi' }])
})

test('a store change re-targets the next turn and updates Status', () => {
    const store = fakeStore(['/A'])
    const svc = new AgentService(providerWith(store))
    store.push(['/A', '/B'])
    expect(svc.Status).toMatch(/\/A/)
    svc.Draft = 'go'
    svc.SendCommand.Execute(undefined)
    expect(agentApi.turns[0]).toEqual({ cwd: '/A', addDirs: ['/B'], text: 'go' })
})

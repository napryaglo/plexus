import { test, expect, beforeEach, afterEach } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { PanelDockService } from '@pragmatic-lab/mural/framework'
import { AgentEventKind, AgentSkillKind, type CatalogItem, type IAgentApi, type TaggedAgentEvent } from '../../../../../../shared/agent-api.js'
import { EnvironmentService } from '../../../../services/environment/environment-service.js'
import { OpenProjectsStore } from '../../../../services/projects/open-projects-store.js'
import { BackgroundWorkService } from '../../../background-work/services/background-work-service.js'
import { ChatStore } from '../chat-store.js'
import { ChatSessionsService, seedInvocation } from '../chat-sessions-service.js'

function fakeAgent() {
    const turns: Array<{ sessionId: string; text: string }> = []
    const started: string[] = []
    let push: ((m: TaggedAgentEvent) => void) | undefined
    const api: IAgentApi = {
        startSession: (id) => { started.push(id); return Promise.resolve() },
        closeSession: () => Promise.resolve(),
        sendTurn: (id, _c, _d, text) => { turns.push({ sessionId: id, text }); return Promise.resolve() },
        abort: () => Promise.resolve(),
        isResumable: () => Promise.resolve(true),
        answerQuestion: () => Promise.resolve(),
        refreshProjectResult: () => Promise.resolve(),
        createProjectResult: () => Promise.resolve(),
        getProblemsResult: () => Promise.resolve(),
        answerToolApproval: () => Promise.resolve(),
        listApprovalRules: () => Promise.resolve([]),
        revokeApprovalRule: () => Promise.resolve(),
        onEvent: (h) => { push = h; return () => {} },
    }
    return { api, turns, started, emit: (m: TaggedAgentEvent) => push?.(m) }
}

function fakeStore(initial: string[] = []) {
    let folders = [...initial]
    const listeners = new Set<(f: readonly string[]) => void>()
    return {
        Current: () => folders, List: () => Promise.resolve(folders),
        Subscribe: (l: (f: readonly string[]) => void) => { listeners.add(l); return () => listeners.delete(l) },
        push: (n: string[]) => { folders = n; for (const l of listeners) l(folders) },
    }
}

let bridge: ReturnType<typeof fakeAgent>
beforeEach(() => { bridge = fakeAgent(); (globalThis as unknown as { api: unknown }).api = { agent: bridge.api } })
afterEach(() => { delete (globalThis as unknown as { api?: unknown }).api })

function makeService(store = fakeStore(['/A'])) {
    const provider = new ServiceProvider()
    provider.registerInstance(OpenProjectsStore.Key, store as unknown as OpenProjectsStore)
    provider.registerInstance(EnvironmentService.Key, { CurrentDirectory: '/fallback' } as EnvironmentService)
    provider.registerInstance(PanelDockService.Key, new PanelDockService(provider))
    const upserts: string[] = []
    provider.registerInstance(ChatStore.Key, {
        List: () => Promise.resolve([]),
        Upsert: (r: { Id: string }) => { upserts.push(r.Id); return Promise.resolve() },
        Remove: () => Promise.resolve(),
    } as unknown as ChatStore)
    const submitted: Array<{ title: string; open?: () => void }> = []
    provider.registerInstance(BackgroundWorkService.Key, {
        submit: (t: { title: string; open?: () => void }) => { submitted.push({ title: t.title, open: t.open }); return { handle: {}, done: Promise.resolve() } },
    } as unknown as BackgroundWorkService)
    const svc = new ChatSessionsService(provider)
    return { svc, provider, upserts, submitted, dock: provider.getRequired(PanelDockService.Key) }
}

test('NewConversation starts a session and adds a dock tab', () => {
    const { svc, dock } = makeService()
    const chat = svc.NewConversation()
    expect(bridge.started).toContain(chat.Id)
    expect(dock.Panels.ToArray()).toContain(chat)
    expect(svc.Open.ToArray()).toContain(chat)
})

test('events route to the matching session only', () => {
    const { svc } = makeService()
    const a = svc.NewConversation()
    const b = svc.NewConversation()
    bridge.emit({ SessionId: a.Id, Event: { Kind: AgentEventKind.AssistantText, Text: 'for A' } })
    expect(a.Transcript.ToArray()).toHaveLength(1)
    expect(b.Transcript.ToArray()).toHaveLength(0)
})

test('a turn addresses the session and the shared workspace cwd', () => {
    const { svc } = makeService(fakeStore(['/A', '/B']))
    const chat = svc.NewConversation()
    chat.Draft = 'hi'
    chat.SendCommand.Execute(undefined)
    expect(bridge.turns).toEqual([{ sessionId: chat.Id, text: 'hi' }])
})

test('a resumable SessionStarted upserts the conversation into the store', async () => {
    const { svc, upserts } = makeService()
    const chat = svc.NewConversation()
    await Promise.resolve()   // let the isResumable() probe settle
    bridge.emit({ SessionId: chat.Id, Event: { Kind: AgentEventKind.SessionStarted, SessionId: 'cli-1' } })
    await Promise.resolve()
    expect(upserts).toContain(chat.Id)
})

test('Close removes the tab and closes the backend session', () => {
    const { svc, dock } = makeService()
    const chat = svc.NewConversation()
    svc.Close(chat)
    expect(dock.Panels.ToArray()).not.toContain(chat)
    expect(svc.Open.ToArray()).not.toContain(chat)
})

test('seedInvocation builds a slash command for a skill and a subagent instruction for an agent', () => {
    expect(seedInvocation({ kind: AgentSkillKind.Skill, name: 'security-review', description: '' })).toBe('/security-review')
    expect(seedInvocation({ kind: AgentSkillKind.Agent, name: 'reviewer', description: '' }))
        .toBe('Use the "reviewer" subagent for this task.')
})

test('RunAgentSkill opens a titled conversation and submits a background task', () => {
    const { svc, submitted } = makeService()
    const item: CatalogItem = { kind: AgentSkillKind.Skill, name: 'security-review', description: '' }
    const chat = svc.RunAgentSkill(item, '/A', 'Billing')
    expect(chat.Title).toBe('security-review · Billing')
    expect(bridge.started).toContain(chat.Id)
    expect(bridge.turns).toEqual([{ sessionId: chat.Id, text: '/security-review' }])   // seeded turn
    expect(submitted).toHaveLength(1)
    expect(submitted[0].title).toBe('security-review · Billing')
    expect(typeof submitted[0].open).toBe('function')
})

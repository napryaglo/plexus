// Multi-conversation agents smoke.
//
// ChatSessionsService manages parallel agent conversations as right-dock tabs. One
// starter conversation is seeded at boot; this adds a second, routes an event to the
// first only, and verifies the two conversations hold independent transcripts —
// exercising NewConversation + per-session event routing in the real app. Drives the
// manager through the dev-only globalThis.__chats hook (wired in main.js).
import { test, expect } from '@playwright/test'
import { launchPlexus, appErrors, type Launched } from './plexus-app'

let L: Launched

test.beforeAll(async () => { L = await launchPlexus(); await L.win.waitForTimeout(800) })
test.afterAll(async () => { await L?.app?.close() })

test('boots without app errors', async () => {
    const errs = appErrors(L.errors)
    expect(errs, errs.join('\n')).toEqual([])
})

test('two conversations open as independent tabs with independent transcripts', async () => {
    const result = await L.win.evaluate(() => {
        const chats = globalThis.__chats
        const a = chats.Open.ToArray()[0]        // the starter conversation
        const b = chats.NewConversation()        // a second, parallel one
        // Route an assistant-text event to A only (the literal is the value of
        // AgentEventKind.AssistantText — test data crossing the evaluate boundary).
        a.apply({ Kind: 'assistant-text', Text: 'hello A' })
        return { a: a.Id, b: b.Id, aCount: a.Transcript.Count, bCount: b.Transcript.Count, open: chats.Open.Count }
    })
    expect(result.open).toBe(2)
    expect(result.a).not.toBe(result.b)
    expect(result.aCount).toBe(1)
    expect(result.bCount).toBe(0)
    expect(appErrors(L.errors), appErrors(L.errors).join('\n')).toEqual([])
})

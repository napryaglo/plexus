import { test, expect } from 'vitest'
import { AgentEventKind, type AgentEvent } from '../../../../../../shared/agent-api.js'
import { ChatSession, type ChatSessionCallbacks } from '../chat-session.js'

function fakeCallbacks() {
    const calls = { sent: [] as Array<{ id: string; text: string }>, created: [] as string[] }
    const cb: ChatSessionCallbacks = {
        send: (id, text) => calls.sent.push({ id, text }),
        answerQuestion: () => {},
        answerToolApproval: () => {},
        createProject: (id) => calls.created.push(id),
    }
    return { cb, calls }
}

test('the panel identity is the session id + title', () => {
    const { cb } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    expect(s.Id).toBe('sess-1')
    expect(s.Title).toBe('Chat 1')
})

test('send forwards the trimmed draft to the callback and clears it', () => {
    const { cb, calls } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.Draft = '  hello  '
    s.SendCommand.Execute(undefined)
    expect(calls.sent).toEqual([{ id: 'sess-1', text: 'hello' }])
    expect(s.Draft).toBe('')
})

test('applying an assistant-text event grows the transcript', () => {
    const { cb } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.apply({ Kind: AgentEventKind.AssistantText, Text: 'hi' })
    expect(s.Transcript.ToArray()).toHaveLength(1)
})

test('a pending question gates input; send is a no-op while gated', () => {
    const { cb, calls } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.apply({ Kind: AgentEventKind.Question, Request: { id: 'q1', questions: [{ question: 'x?', header: 'h', multiSelect: false, options: [{ label: 'a' }] }] } })
    expect(s.CanInput).toBe(false)
    s.Draft = 'nope'
    s.SendCommand.Execute(undefined)
    expect(calls.sent).toHaveLength(0)
})

test('a create-project event is delegated to the callback with the reducer', () => {
    const { cb, calls } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.apply({ Kind: AgentEventKind.CreateProject, Request: { id: 'c1' } } as AgentEvent)
    expect(calls.created).toEqual(['sess-1'])
})

import { test, expect } from 'vitest'
import { Key } from '@pragmatic-lab/mural/runtime'
import { AgentEventKind, type AgentEvent } from '../../../../../../shared/agent-api.js'
import { ChatSession, type ChatSessionCallbacks } from '../chat-session.js'

function fakeCallbacks() {
    const calls = {
        sent: [] as Array<{ id: string; text: string }>, created: [] as string[],
        renamed: [] as Array<{ id: string; title: string }>, closed: [] as string[], revealed: [] as string[],
    }
    const cb: ChatSessionCallbacks = {
        send: (id, text) => calls.sent.push({ id, text }),
        answerQuestion: () => {},
        answerToolApproval: () => {},
        createProject: (id) => calls.created.push(id),
        rename: (id, title) => calls.renamed.push({ id, title }),
        close: (id) => calls.closed.push(id),
        reveal: (id) => calls.revealed.push(id),
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

test('CloseCommand asks the manager to close this session', () => {
    const { cb, calls } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.CloseCommand.Execute(undefined)
    expect(calls.closed).toEqual(['sess-1'])
})

test('RevealCommand focuses this session from the nav list', () => {
    const { cb, calls } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.RevealCommand.Execute(undefined)
    expect(calls.revealed).toEqual(['sess-1'])
})

test('Enter commits a renamed title — updates the tab and calls back', () => {
    const { cb, calls } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.BeginRenameCommand.Execute(undefined)
    expect(s.IsEditing).toBe(true)
    expect(s.EditTitle).toBe('Chat 1')
    s.EditTitle = 'Renamed'
    s.RenameKeyCommand.Execute({ Key: Key.Return })
    expect(s.IsEditing).toBe(false)
    expect(s.Title).toBe('Renamed')
    expect(calls.renamed).toEqual([{ id: 'sess-1', title: 'Renamed' }])
})

test('Escape cancels a rename — no callback, title unchanged', () => {
    const { cb, calls } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.BeginRenameCommand.Execute(undefined)
    s.EditTitle = 'Nope'
    s.RenameKeyCommand.Execute({ Key: Key.Escape })
    expect(s.IsEditing).toBe(false)
    expect(s.Title).toBe('Chat 1')
    expect(calls.renamed).toEqual([])
})

test('setTitle updates the tab title (used when a stored row renames a live chat)', () => {
    const { cb } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.setTitle('Externally renamed')
    expect(s.Title).toBe('Externally renamed')
})

test('a create-project event is delegated to the callback with the reducer', () => {
    const { cb, calls } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.apply({ Kind: AgentEventKind.CreateProject, Request: { id: 'c1' } } as AgentEvent)
    expect(calls.created).toEqual(['sess-1'])
})

import { test, expect } from 'vitest'
import { AgentEventKind } from '../../../../../shared/agent-api.js'
import { TranscriptReducer, UserMessage, AssistantMessage, ToolActivity } from './transcript.js'

function items(r: TranscriptReducer) { return Array.from(r.Transcript) }

test('a user turn appends a UserMessage carrying the text', () => {
    const r = new TranscriptReducer()
    r.beginUserTurn('hello')
    const list = items(r)
    expect(list).toHaveLength(1)
    expect(list[0]).toBeInstanceOf(UserMessage)
    expect((list[0] as UserMessage).Text).toBe('hello')
})

test('assistant text deltas accumulate into ONE growing bubble', () => {
    const r = new TranscriptReducer()
    r.apply({ Kind: AgentEventKind.AssistantText, Text: 'Hel' })
    r.apply({ Kind: AgentEventKind.AssistantText, Text: 'lo' })
    const list = items(r)
    expect(list).toHaveLength(1)
    expect(list[0]).toBeInstanceOf(AssistantMessage)
    expect((list[0] as AssistantMessage).Text).toBe('Hello')
})

test('a tool use starts a new bubble after assistant text', () => {
    const r = new TranscriptReducer()
    r.apply({ Kind: AgentEventKind.AssistantText, Text: 'working' })
    r.apply({ Kind: AgentEventKind.ToolUse, Id: 't1', Name: 'Read', Input: {} })
    const list = items(r)
    expect(list).toHaveLength(2)
    expect(list[1]).toBeInstanceOf(ToolActivity)
    expect((list[1] as ToolActivity).Name).toBe('Read')
    expect((list[1] as ToolActivity).Status).toBe('running')
})

test('a tool result updates the matching activity status', () => {
    const r = new TranscriptReducer()
    r.apply({ Kind: AgentEventKind.ToolUse, Id: 't1', Name: 'Read', Input: {} })
    r.apply({ Kind: AgentEventKind.ToolResult, Id: 't1', Ok: true, Summary: 'ok' })
    const activity = items(r)[0] as ToolActivity
    expect(activity.Status).toBe('done')
})

test('a failed tool result marks the activity failed', () => {
    const r = new TranscriptReducer()
    r.apply({ Kind: AgentEventKind.ToolUse, Id: 't1', Name: 'Bash', Input: {} })
    r.apply({ Kind: AgentEventKind.ToolResult, Id: 't1', Ok: false, Summary: 'boom' })
    expect((items(r)[0] as ToolActivity).Status).toBe('failed')
})

test('assistant text after a tool starts a fresh bubble (does not reopen the old one)', () => {
    const r = new TranscriptReducer()
    r.apply({ Kind: AgentEventKind.AssistantText, Text: 'a' })
    r.apply({ Kind: AgentEventKind.ToolUse, Id: 't1', Name: 'Read', Input: {} })
    r.apply({ Kind: AgentEventKind.AssistantText, Text: 'b' })
    const list = items(r)
    expect(list).toHaveLength(3)
    expect((list[2] as AssistantMessage).Text).toBe('b')
})

test('SessionStarted and TurnComplete add no transcript items', () => {
    const r = new TranscriptReducer()
    r.apply({ Kind: AgentEventKind.SessionStarted, SessionId: 'x' })
    r.apply({ Kind: AgentEventKind.TurnComplete })
    expect(items(r)).toHaveLength(0)
})

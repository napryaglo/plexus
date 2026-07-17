import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { StreamJsonParser } from '../stream-json-parser.js'
import { AgentEventKind, type AgentEvent, type SessionStartedEvent } from '../../../shared/agent-api.js'

function parseFixture(name: string): AgentEvent[] {
    const text = readFileSync(join(__dirname, 'fixtures', name), 'utf8')
    const parser = new StreamJsonParser()
    return text.split('\n').flatMap((line) => parser.push(line))
}

test('parses a hello session: SessionStarted first (with id), streamed text, TurnComplete last, no error', () => {
    const events = parseFixture('hello.stream.jsonl')
    expect(events[0].Kind).toBe(AgentEventKind.SessionStarted)
    expect((events[0] as SessionStartedEvent).SessionId).not.toBe('')
    expect(events.some((e) => e.Kind === AgentEventKind.AssistantText)).toBe(true)
    expect(events[events.length - 1].Kind).toBe(AgentEventKind.TurnComplete)
    expect(events.some((e) => e.Kind === AgentEventKind.Error)).toBe(false)
})

test('surfaces tool use and result from a tool-using session', () => {
    const events = parseFixture('tool.stream.jsonl')
    expect(events.some((e) => e.Kind === AgentEventKind.ToolUse)).toBe(true)
    expect(events.some((e) => e.Kind === AgentEventKind.ToolResult)).toBe(true)
})

test('ignores blank and malformed lines without throwing', () => {
    const parser = new StreamJsonParser()
    expect(parser.push('')).toEqual([])
    expect(parser.push('   ')).toEqual([])
    expect(parser.push('{ not json')).toEqual([])
})

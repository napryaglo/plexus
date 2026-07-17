import { test, expect } from 'vitest'
import { AgentChannel, AgentEventKind } from '../agent-api.js'

test('channel ids are namespaced under agent:', () => {
  expect(AgentChannel.StartSession).toBe('agent:start-session')
  expect(AgentChannel.SendTurn).toBe('agent:send-turn')
  expect(AgentChannel.Abort).toBe('agent:abort')
  expect(AgentChannel.Event).toBe('agent:event')
})

test('every event kind has a distinct string value', () => {
  const values = Object.values(AgentEventKind)
  expect(new Set(values).size).toBe(values.length)
})

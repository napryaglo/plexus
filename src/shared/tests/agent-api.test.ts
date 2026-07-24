import { test, expect } from 'vitest'
import {
  AgentChannel,
  AgentEventKind,
  MCP_SERVER_KEY,
  REFRESH_TOOL_QUALIFIED,
  REFRESH_TOOL_NAME,
} from '../agent-api.js'

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

test('both tools are qualified under the single plexus server key', () => {
  expect(MCP_SERVER_KEY).toBe('plexus')
  expect(REFRESH_TOOL_NAME).toBe('refresh_project')
  expect(REFRESH_TOOL_QUALIFIED).toBe('mcp__plexus__refresh_project')
})

test('the workspace channel and event-kind members exist', () => {
  expect(AgentChannel.RefreshProjectResult).toBe('agent:refresh-project-result')
  expect(AgentEventKind.RefreshProject).toBe('refresh-project')
})

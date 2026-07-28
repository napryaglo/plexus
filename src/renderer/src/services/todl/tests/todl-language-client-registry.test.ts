import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { TodlLanguageClient } from '../todl-language-client.js'
import { FakeStorage } from '../../storage/tests/fake-storage.js'

test('uriFor/resolveUri round-trips through the registry', () => {
  const client = new TodlLanguageClient(new ServiceProvider())
  const storage = new FakeStorage('proj')
  client.registerProject('C:\\p1', 'P1', storage)
  const uri = client.uriFor('C:\\p1', 'src/a.todl')
  expect(uri.startsWith('todl://')).toBe(true)
  const r = client.resolveUri(uri)
  expect(r).toEqual({ projectId: 'C:\\p1', storage, relpath: 'src/a.todl' })
})

test('rootUri is the project prefix with an empty relpath', () => {
  const client = new TodlLanguageClient(new ServiceProvider())
  client.registerProject('C:\\p1', 'P1', new FakeStorage('proj'))
  expect(client.uriFor('C:\\p1', '')).toBe(client.uriFor('C:\\p1', 'x.todl').replace('x.todl', ''))
})

test('resolveUri returns null for an unknown project', () => {
  const client = new TodlLanguageClient(new ServiceProvider())
  expect(client.resolveUri('todl://nope/x.todl')).toBeNull()
})

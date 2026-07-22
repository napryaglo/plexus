import { test, expect } from 'vitest'
import { FakeStorage } from './fake-storage.js'
import { copyTree } from '../copy-tree.js'

test('copies a single file across storages', async () => {
    const a = new FakeStorage('A'); const b = new FakeStorage('B')
    await a.WriteText('x.todl', 'hello')
    await copyTree(a, 'x.todl', b, 'sub/x.todl', false)
    expect(await b.ReadText('sub/x.todl')).toBe('hello')
})

test('copies a nested folder subtree across storages', async () => {
    const a = new FakeStorage('A'); const b = new FakeStorage('B')
    await a.WriteText('src/a.todl', 'A'); await a.WriteText('src/lib/b.todl', 'B')
    await copyTree(a, 'src', b, 'dst/src', true)
    expect(await b.ReadText('dst/src/a.todl')).toBe('A')
    expect(await b.ReadText('dst/src/lib/b.todl')).toBe('B')
})

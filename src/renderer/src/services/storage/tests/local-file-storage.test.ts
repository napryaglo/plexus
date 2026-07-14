import { test, expect } from 'vitest'

import type { FileSystemService } from '../../file-system/file-system-service.js'
import type { FileEntry } from '../../../../../shared/file-system-api.js'
import { LocalFileStorage } from '../local-file-storage.js'
import { isLocalFileAccess } from '../storage.js'

// A FileSystemService stub that records the absolute path each call receives, so
// we can assert LocalFileStorage joins root + relative correctly and delegates.
function stubFs(): { fs: FileSystemService; calls: Array<[string, string]>; listResult: FileEntry[] }
{
    const calls: Array<[string, string]> = []
    const listResult: FileEntry[] = []
    const fs = {
        ReadText: (p: string) => { calls.push(['ReadText', p]); return Promise.resolve('text') },
        WriteText: (p: string, _c: string) => { calls.push(['WriteText', p]); return Promise.resolve() },
        Exists: (p: string) => { calls.push(['Exists', p]); return Promise.resolve(true) },
        Delete: (p: string) => { calls.push(['Delete', p]); return Promise.resolve() },
        ListDirectory: (p: string) => { calls.push(['ListDirectory', p]); return Promise.resolve(listResult) },
        OpenExternal: (p: string) => { calls.push(['OpenExternal', p]); return Promise.resolve() },
    } as unknown as FileSystemService
    return { fs, calls, listResult }
}

test('joins root + project-relative path with the POSIX root separator', async () => {
    const { fs, calls } = stubFs()
    const storage = new LocalFileStorage('/root/proj', fs)
    await storage.ReadText('diagrams/a.diagram')
    expect(calls).toEqual([['ReadText', '/root/proj/diagrams/a.diagram']])
})

test("the root itself ('') resolves to the root, not root + '/'", async () => {
    const { fs, calls } = stubFs()
    const storage = new LocalFileStorage('/root/proj', fs)
    await storage.List('')
    expect(calls).toEqual([['ListDirectory', '/root/proj']])
})

test('joins against a Windows (backslash) root using backslashes', async () => {
    const { fs, calls } = stubFs()
    const storage = new LocalFileStorage('C:\\Users\\proj', fs)
    await storage.WriteText('sub/x.diagram', 'data')
    expect(calls).toEqual([['WriteText', 'C:\\Users\\proj\\sub\\x.diagram']])
})

test('List maps FileEntry → StorageEntry', async () => {
    const { fs, listResult } = stubFs()
    listResult.push({ Name: 'a', IsDirectory: true }, { Name: 'b.diagram', IsDirectory: false })
    const storage = new LocalFileStorage('/r', fs)
    const entries = await storage.List('')
    expect(entries).toEqual([{ Name: 'a', IsDirectory: true }, { Name: 'b.diagram', IsDirectory: false }])
})

test('Root exposes the location descriptor', () => {
    const { fs } = stubFs()
    expect(new LocalFileStorage('/root/proj', fs).Root).toBe('/root/proj')
})

test('ResolveOsPath and OpenExternal go through the absolute join', async () => {
    const { fs, calls } = stubFs()
    const storage = new LocalFileStorage('/root/proj', fs)
    expect(storage.ResolveOsPath('a/b.txt')).toBe('/root/proj/a/b.txt')
    await storage.OpenExternal('a/b.txt')
    expect(calls).toEqual([['OpenExternal', '/root/proj/a/b.txt']])
})

test('is recognized as a local-file-access backend', () => {
    const { fs } = stubFs()
    expect(isLocalFileAccess(new LocalFileStorage('/r', fs))).toBe(true)
})

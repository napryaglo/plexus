import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { ChatStore, type StoredConversation } from '../chat-store.js'
import { FileSystemService } from '../../../../services/file-system/file-system-service.js'
import { EnvironmentService } from '../../../../services/environment/environment-service.js'
import { TranscriptRole } from '../transcript.js'

function fakeFs() {
    const files = new Map<string, string>()
    return {
        Exists: (p: string) => Promise.resolve(files.has(p)),
        ReadText: (p: string) => Promise.resolve(files.get(p) ?? ''),
        WriteText: (p: string, c: string) => { files.set(p, c); return Promise.resolve() },
    }
}

function providerWith(fs: unknown): ServiceProvider {
    const provider = new ServiceProvider()
    provider.registerInstance(FileSystemService.Key, fs as FileSystemService)
    provider.registerInstance(EnvironmentService.Key, { UserDataDirectory: '/data' } as EnvironmentService)
    return provider
}

const rec: StoredConversation = { Id: 's1', Title: 'Chat 1', ResumeToken: 'cli-1', Transcript: [{ Role: TranscriptRole.User, Text: 'hi' }] }

test('upsert then list round-trips a record', async () => {
    const store = new ChatStore(providerWith(fakeFs()))
    await store.Upsert(rec)
    expect(await store.List()).toEqual([rec])
})

test('upsert replaces a record with the same id', async () => {
    const store = new ChatStore(providerWith(fakeFs()))
    await store.Upsert(rec)
    await store.Upsert({ ...rec, Title: 'Renamed' })
    const list = await store.List()
    expect(list).toHaveLength(1)
    expect(list[0].Title).toBe('Renamed')
})

test('remove drops a record', async () => {
    const store = new ChatStore(providerWith(fakeFs()))
    await store.Upsert(rec)
    await store.Remove('s1')
    expect(await store.List()).toEqual([])
})

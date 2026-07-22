import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-lab/mural/runtime'
import { check, toJSON } from '@pragmatic-lab/todl'

import { StorageProviderRegistry } from '../../storage/storage-provider-registry.js'
import { FakeStorage } from '../../storage/tests/fake-storage.js'
import { META_MODELS_BACKEND_ID } from '../../../modules/meta-model/services/meta-models-backend.js'
import { LIBRARIES_BACKEND_ID } from '../../../modules/library/services/libraries-backend.js'
import { resolveBases } from '../base-resolver.js'

const CONCEPTS = 'namespace d { concept model { label : string; } concept location { label : string; } }'

// A provider whose meta-models + libraries backends resolve to inspectable
// FakeStorages (pre-registered so the ensure* Has-check finds them).
function env(): { provider: ServiceProvider; meta: FakeStorage; libs: FakeStorage }
{
    const provider = new ServiceProvider()
    const registry = new StorageProviderRegistry(provider)
    const meta = new FakeStorage('fake://meta-models')
    const libs = new FakeStorage('fake://libraries')
    registry.Register(META_MODELS_BACKEND_ID, () => meta)
    registry.Register(LIBRARIES_BACKEND_ID, () => libs)
    provider.registerInstance(StorageProviderRegistry.Key, registry)
    return { provider, meta, libs }
}

test('resolveBases reads a bound meta-model model.json', async () => {
    const { provider, meta } = env()
    await meta.WriteText('ea/5/model.json', JSON.stringify(toJSON(check([{ uri: 'c.todl', text: CONCEPTS }]).model)))
    const { bases, problems } = await resolveBases(provider, { metaModel: { id: 'ea', version: '5' } })
    expect(problems).toEqual([])
    expect(bases.length).toBe(1)
    expect(bases[0]!.nodes.some((n) => n.id === 'location')).toBe(true)
})

test('a missing base is reported in problems, not thrown', async () => {
    const { provider } = env()
    const { bases, problems } = await resolveBases(provider, { metaModel: { id: 'ghost', version: '1' } })
    expect(bases).toEqual([])
    expect(problems.length).toBe(1)
    expect(problems[0]).toMatch(/ghost/)
})

test('no bindings resolves to empty', async () => {
    const { provider } = env()
    const { bases, problems } = await resolveBases(provider, {})
    expect(bases).toEqual([])
    expect(problems).toEqual([])
})

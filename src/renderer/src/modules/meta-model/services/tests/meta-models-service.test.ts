import { test, expect } from 'vitest'

import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { scanPublishedModels } from '../meta-models-service.js'

// Seed a FakeStorage to look like the published meta-models backend: each model
// lives at `<id>/<modelVersion>/model.json` (+ src/), so the root dirs are ids
// and each id's dirs are versions.
function backendWith(entries: Array<[string, string]>): FakeStorage
{
    const s = new FakeStorage('fake://meta-models')
    for (const [path, text] of entries) void s.WriteText(path, text)
    return s
}

test('groups published models by id and nests their versions', async () => {
    const storage = backendWith([
        ['tech-architecture/0.1.0/model.json', '{}'],
        ['tech-architecture/0.1.0/src/a.todl', 'x'],
        ['tech-architecture/0.2.0/model.json', '{}'],
        ['enterprise/1.0.0/model.json', '{}'],
    ])

    const models = await scanPublishedModels(storage)

    // Ids sorted; enterprise precedes tech-architecture.
    expect(models.map((m) => m.id)).toEqual(['enterprise', 'tech-architecture'])
    expect(models.find((m) => m.id === 'tech-architecture')?.versions).toEqual(['0.1.0', '0.2.0'])
    expect(models.find((m) => m.id === 'enterprise')?.versions).toEqual(['1.0.0'])
})

test('sorts versions numeric-aware so 0.9.0 precedes 0.10.0', async () => {
    const storage = backendWith([
        ['m/0.10.0/model.json', '{}'],
        ['m/0.9.0/model.json', '{}'],
        ['m/0.2.0/model.json', '{}'],
    ])

    const models = await scanPublishedModels(storage)

    expect(models).toHaveLength(1)
    expect(models[0].versions).toEqual(['0.2.0', '0.9.0', '0.10.0'])
})

test('an empty backend yields no models', async () => {
    const models = await scanPublishedModels(new FakeStorage('fake://meta-models'))
    expect(models).toEqual([])
})

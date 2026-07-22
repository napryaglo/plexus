import type { IServiceProvider } from '@pragmatic-lab/mural/runtime'
import type { TodlDocument } from '@pragmatic-lab/todl'

import type { IStorage } from '../storage/storage.js'
import { ensureMetaModelsBackend } from '../../modules/meta-model/services/meta-models-backend.js'
import { ensureLibrariesBackend } from '../../modules/library/services/libraries-backend.js'
import type { BaseBindings, BaseRef } from './base-binding.js'

// Resolve a project's declared bases into parsed TodlDocuments, meta-model first
// then libraries (a stable order; TODL checkAgainst dedups any overlap). A
// binding whose compiled model.json is missing/unreadable is collected in
// `problems` (so validation can surface "meta-model not published") rather than
// thrown — a consuming project stays usable while its bases are being published.
export async function resolveBases(
    provider: IServiceProvider,
    bindings: BaseBindings,
): Promise<{ bases: TodlDocument[]; problems: string[] }>
{
    const bases: TodlDocument[] = []
    const problems: string[] = []

    const read = async (backend: IStorage, ref: BaseRef, kind: string): Promise<void> => {
        const path = `${ref.id}/${ref.version}/model.json`
        try {
            bases.push(JSON.parse(await backend.ReadText(path)) as TodlDocument)
        } catch {
            problems.push(`${kind} "${ref.id}@${ref.version}" is not published`)
        }
    }

    if (bindings.metaModel !== undefined) {
        await read(ensureMetaModelsBackend(provider), bindings.metaModel, 'meta-model')
    }
    for (const lib of bindings.libraries ?? []) {
        await read(ensureLibrariesBackend(provider), lib, 'library')
    }
    return { bases, problems }
}

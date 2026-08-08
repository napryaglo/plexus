import type { IServiceProvider } from '@pragmatic-lab/mural/runtime'
import type { DataTemplate } from '@pragmatic-lab/mural/basic'

import type { PresentationSource } from '../../diagram/services/todl-presentation-registry.js'
import { ensureMetaModelsBackend } from './meta-models-backend.js'
import { scanPublishedModels } from './meta-model-tree-builder.js'
import { loadCompiledPresentation } from './compiled-presentation.js'
import { MetaModelEntity } from './meta-model-entity.js'

// A PresentationSource that loads all published meta-model visual templates for
// the TodlPresentationRegistry. For each published <id>/<version> it reads the
// baked presentation artifact (if present) and adds every mm:<entity-id> key to
// the map. Presentation-only: no authored .mural tier, no Problems publishing.
// A version whose artifact is absent contributes nothing (no throw).
export class MetaModelPresentationSource implements PresentationSource
{
    readonly id = 'meta-model'

    constructor(private readonly provider: IServiceProvider) {}

    public async load(): Promise<Map<string, DataTemplate>>
    {
        const backend = ensureMetaModelsBackend(this.provider)
        const map = new Map<string, DataTemplate>()
        for (const { id, versions } of await scanPublishedModels(backend)) {
            for (const version of versions) {
                const pres = await loadCompiledPresentation(backend, `${id}/${version}`, { MetaModelEntity })
                if (pres !== undefined) {
                    for (const [k, v] of pres.Entries()) map.set(k as string, v as DataTemplate)
                }
            }
        }
        return map
    }
}

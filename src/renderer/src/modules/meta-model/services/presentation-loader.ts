// presentation-loader.ts — load a published presentation at runtime by evaluating
// the pre-compiled artifact (see presentation-publisher.ts). The artifact's body
// is a compiled `resources` class with all icon geometry inlined, so there is no
// parse, no compile, and no SVG read at load — just a `new Function` eval with the
// mural runtime supplied via ctx (mirrors the compiler's own instantiate()).
import { ResourceDictionary } from '@pragmatic-lab/mural/runtime'

import type { IStorage } from '../../../services/storage/storage.js'
import { MetaModelEntity } from './meta-model-entity.js'
import { loadCompiledPresentation } from './compiled-presentation.js'

export async function loadPresentation(storage: IStorage, base: string): Promise<ResourceDictionary>
{
    const dict = await loadCompiledPresentation(storage, base, { MetaModelEntity })
    if (dict === undefined)
        throw new Error('This meta-model was published in an older format — republish it to view its presentation.')
    return dict
}

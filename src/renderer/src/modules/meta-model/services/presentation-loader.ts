// presentation-loader.ts — load a published presentation at runtime by evaluating
// the pre-compiled artifact (see presentation-publisher.ts). The artifact's body
// is a compiled `resources` class with all icon geometry inlined, so there is no
// parse, no compile, and no SVG read at load — just a `new Function` eval with the
// mural runtime supplied via ctx (mirrors the compiler's own instantiate()).
import * as MuralRuntime from '@pragmatic-lab/mural/runtime'
import * as MuralBasic from '@pragmatic-lab/mural/basic'
import * as MuralFramework from '@pragmatic-lab/mural/framework'
import * as MuralEngine from '@pragmatic-lab/mural/visual-engine'
import { ResourceDictionary } from '@pragmatic-lab/mural/runtime'

import type { IStorage } from '../../../services/storage/storage.js'
import { MetaModelEntity } from './meta-model-entity.js'
import type { CompiledPresentation } from './presentation-publisher.js'

const COMPILED = 'presentation/presentation.compiled.json'

export async function loadPresentation(storage: IStorage, base: string): Promise<ResourceDictionary>
{
    let raw: string
    try { raw = await storage.ReadText(`${base}/${COMPILED}`) }
    catch {
        throw new Error('This meta-model was published in an older format — republish it to view its presentation.')
    }
    const { body, symbols, className } = JSON.parse(raw) as CompiledPresentation

    const ctx: Record<string, unknown> = {
        ...MuralRuntime, ...MuralEngine, ...MuralBasic, ...MuralFramework, MetaModelEntity,
    }
    const destructure = symbols.length > 0 ? `const { ${symbols.join(', ')} } = _ctx;\n` : ''
    const bodyR = body.replace(/^export class /gm, 'class ')
    const fn = new Function('_ctx', `${destructure}${bodyR}\nreturn ${className}.Clone();`)
    return fn(ctx) as ResourceDictionary
}

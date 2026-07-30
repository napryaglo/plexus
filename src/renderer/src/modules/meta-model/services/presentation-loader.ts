// presentation-loader.ts — load a published presentation dictionary at runtime.
// Reads <base>/presentation/presentation.generated.mu and instantiate()s it into
// a live ResourceDictionary. The compiler's include resolver is synchronous, so
// the SVGs each `include` names are pre-read from storage first, then a sync
// resolver converts each to a Geometry via svgToGeometryJs.
import * as MuralRuntime from '@pragmatic-lab/mural/runtime'
import * as MuralBasic from '@pragmatic-lab/mural/basic'
import * as MuralFramework from '@pragmatic-lab/mural/framework'
import * as MuralEngine from '@pragmatic-lab/mural/visual-engine'
import { ResourceDictionary } from '@pragmatic-lab/mural/runtime'
import {
    instantiate, DEFAULT_SYMBOLS, svgToGeometryJs,
    type IncludeResolver, type IncludeResolution,
} from '@pragmatic-lab/mural/compiler'

import type { IStorage } from '../../../services/storage/storage.js'
import { MetaModelEntity } from './meta-model-entity.js'

const GENERATED = 'presentation/presentation.generated.mu'
const VISUAL_ENGINE = '@pragmatic-lab/mural/visual-engine'

// Every `include "<path>" …` path named in the source.
function includePaths(source: string): string[]
{
    const paths: string[] = []
    const re = /include\s+"([^"]+)"/g
    let m: RegExpExecArray | null
    while ((m = re.exec(source)) !== null) paths.push(m[1]!)
    return paths
}

export async function loadPresentation(storage: IStorage, base: string): Promise<ResourceDictionary>
{
    const source = await storage.ReadText(`${base}/${GENERATED}`)

    // Pre-read each included SVG (async) into a path → text map.
    const svgByPath = new Map<string, string>()
    for (const path of includePaths(source))
    {
        svgByPath.set(path, await storage.ReadText(`${base}/presentation/${path}`))
    }

    // Sync include resolver: SVG text → geometry JS + the visual-engine names it needs.
    const include: IncludeResolver = (path, ctx): IncludeResolution =>
    {
        const text = svgByPath.get(path)
        if (text === undefined) throw new Error(`presentation include not pre-read: ${path}`)
        const { valueJs, names } = svgToGeometryJs(text)
        return {
            entries: [{ key: ctx.key ?? path, valueJs }],
            imports: [{ module: VISUAL_ENGINE, names: [...names] }],
        }
    }

    const ctx: Record<string, unknown> = {
        ...MuralRuntime, ...MuralEngine, ...MuralBasic, ...MuralFramework, MetaModelEntity,
    }
    const symbols = new Map([...DEFAULT_SYMBOLS, ['MetaModelEntity', './meta-model-entity.js']])
    return instantiate(source, ctx, { include, symbols }) as ResourceDictionary
}

import type { TodlDocument } from '@pragmatic-lab/todl'
import {
    compile, DEFAULT_SYMBOLS, svgToGeometryJs,
    type IncludeResolver, type IncludeResolution,
} from '@pragmatic-lab/mural/compiler'

import type { IStorage } from '../../../services/storage/storage.js'
import { generatePresentationMu, distinctIcons, ontologyEntities } from './presentation-generator.js'

const PRESENTATION_DIR = 'presentation'
const COMPILED_FILE = 'presentation.compiled.json'
const VISUAL_ENGINE = '@pragmatic-lab/mural/visual-engine'

// The self-contained, evaluable presentation payload written into the backend.
// `body` is the compiled resources class (geometry inlined, imports stripped);
// `symbols` are the names the loader destructures from its ctx; `className` is
// the resources block to instantiate.
export interface CompiledPresentation { body: string; symbols: string[]; className: string }

export type PublishPresentationResult =
    | { ok: true; templates: number; icons: number }
    | { ok: false; missing: string[] }

// Compile the meta-model's presentation once and write it into `dest` under
// `<base>/presentation/presentation.compiled.json`. Icon SVGs are read from the
// project and baked into the compiled body via svgToGeometryJs — the artifact
// has no external file dependency. A referenced icon with no project file blocks
// the publish (nothing is written). Author overrides are intentionally ignored
// (the compiled artifact merges nothing).
export async function publishPresentation(
    project: IStorage, dest: IStorage, base: string, doc: TodlDocument,
): Promise<PublishPresentationResult>
{
    // Pre-read every referenced icon SVG (compiler include resolution is sync).
    const svgByPath = new Map<string, string>()
    const missing: string[] = []
    for (const path of distinctIcons(doc)) {
        try { svgByPath.set(path, await project.ReadText(path)) }
        catch { missing.push(path) }
    }
    if (missing.length > 0) return { ok: false, missing }

    const source = generatePresentationMu(doc, [])   // no author-override merges

    const include: IncludeResolver = (path, ctx): IncludeResolution => {
        const text = svgByPath.get(path)
        if (text === undefined) throw new Error(`presentation include not pre-read: ${path}`)
        const { valueJs, names } = svgToGeometryJs(text)
        return {
            entries: [{ key: ctx.key ?? path, valueJs }],
            imports: [{ module: VISUAL_ENGINE, names: [...names] }],
        }
    }
    const symbols = new Map([...DEFAULT_SYMBOLS, ['MetaModelEntity', './meta-model-entity.js']])
    const result = compile(source, { include, symbols })

    const names = new Set<string>()
    for (const set of result.imports.values()) for (const n of set) names.add(n)
    const className = result.resourcesBlocks?.[0]?.name
    if (className === undefined) throw new Error('presentation compile produced no resources block')

    const body = result.js.split('\n').filter((l) => !/^import\b.*\bfrom\b/.test(l)).join('\n').trim()
    const artifact: CompiledPresentation = { body, symbols: [...names].sort(), className }
    await dest.WriteText(`${base}/${PRESENTATION_DIR}/${COMPILED_FILE}`, JSON.stringify(artifact))

    return { ok: true, templates: ontologyEntities(doc).length, icons: svgByPath.size }
}

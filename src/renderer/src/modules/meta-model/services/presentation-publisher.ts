import type { TodlDocument } from '@pragmatic-lab/todl'
import {
    compile, DEFAULT_SYMBOLS,
    type IncludeResolver, type IncludeResolution,
} from '@pragmatic-lab/mural/compiler'

import type { IStorage } from '../../../services/storage/storage.js'
import { distinctIcons, assignResourceKeys, buildIconIndex } from './presentation-generator.js'

const PRESENTATION_DIR = 'presentation'
const COMPILED_FILE = 'presentation.compiled.json'
export const ICON_INDEX_FILE = 'icon-index.json'
const BASIC = '@pragmatic-lab/mural/basic'
const DICT_NAME = 'MetaModelPresentation'

// The self-contained, evaluable presentation payload written into the backend.
// `body` is the compiled resources class (geometry inlined, imports stripped);
// `symbols` are the names the loader destructures from its ctx; `className` is
// the resources block to instantiate.
export interface CompiledPresentation { body: string; symbols: string[]; className: string }

export type PublishPresentationResult =
    | { ok: true; icons: number }
    | { ok: false; missing: string[] }

// Compile the meta-model's presentation once and write it into `dest` under
// `<base>/presentation/presentation.compiled.json`. The artifact is ASSETS ONLY:
// one baked icon geometry per distinct icon, keyed by its resource key. No
// DataTemplates — every entity renders through Plexus's one default template,
// which draws the icon named by `icon-index.json` (entityKey → resourceKey). The
// compiler bakes the icon SVGs (svgToGeometryJs) into the block, so the artifact
// has no external file dependency. A referenced icon with no project file blocks
// the publish (nothing is written).
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

    const source = combinedSource(doc, DICT_NAME, [])

    // Bake each SVG as a COLORED IconDefinition (parseSvgIcon preserves per-shape
    // fills/strokes) parsed at load — the default template's Icon draws it with
    // Recolor=false so the icon's own colors show. The SVG text is embedded; no
    // external file dependency.
    const include: IncludeResolver = (path, ctx): IncludeResolution => {
        const text = svgByPath.get(path)
        if (text === undefined) throw new Error(`presentation include not pre-read: ${path}`)
        return {
            entries: [{ key: ctx.key ?? path, valueJs: `parseSvgIcon(${JSON.stringify(text)})` }],
            imports: [{ module: BASIC, names: ['parseSvgIcon'] }],
        }
    }
    const result = compile(source, { include, symbols: new Map(DEFAULT_SYMBOLS) })

    const names = new Set<string>()
    for (const set of result.imports.values()) for (const n of set) names.add(n)
    const className = result.resourcesBlocks?.[0]?.name
    if (className === undefined) throw new Error('presentation compile produced no resources block')

    const body = result.js.split('\n').filter((l) => !/^import\b.*\bfrom\b/.test(l)).join('\n').trim()
    const artifact: CompiledPresentation = { body, symbols: [...names].sort(), className }
    await dest.WriteText(`${base}/${PRESENTATION_DIR}/${COMPILED_FILE}`, JSON.stringify(artifact))

    // Sidecar: entityKey → icon resource key, so load never re-derives keys.
    await dest.WriteText(
        `${base}/${PRESENTATION_DIR}/${ICON_INDEX_FILE}`,
        JSON.stringify(Object.fromEntries(buildIconIndex(doc, 'mm:'))),
    )

    return { ok: true, icons: svgByPath.size }
}

// One self-contained assets `resources` block: icon includes the compiler bakes
// into geometry/ImageBrush resources keyed by resource key. `authorInners` is kept
// for signature compatibility but is always empty now (no author templates). Shared
// with the library publisher.
export function combinedSource(doc: TodlDocument, dictName: string, authorInners: readonly string[]): string
{
    const includes = [...assignResourceKeys(doc)].map(([p, k]) => `    include "${p}" as ${k}`)
    return [
        `resources ${dictName} {`,
        ...includes,
        ...authorInners.map((inner) => `    ${inner}`),
        '}',
    ].join('\n')
}

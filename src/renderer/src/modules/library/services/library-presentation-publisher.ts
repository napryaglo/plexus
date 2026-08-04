// library-presentation-publisher.ts — compile the library's presentation once and
// bake it into the bundle as presentation.compiled.json (geometry inlined, imports
// stripped), mirroring meta-model/services/presentation-publisher.ts. A referenced
// icon with no project file blocks publish (nothing written). Author overrides are
// intentionally ignored (the compiled artifact merges nothing).
import type { TodlDocument } from '@pragmatic-lab/todl'
import {
    compile, DEFAULT_SYMBOLS, svgToGeometryJs,
    type IncludeResolver, type IncludeResolution,
} from '@pragmatic-lab/mural/compiler'

import type { IStorage } from '../../../services/storage/storage.js'
import type { CompiledPresentation } from '../../meta-model/services/presentation-publisher.js'
import { distinctIcons } from '../../meta-model/services/presentation-generator.js'
import { generateLibraryPresentationMu, isRasterIcon } from './library-presentation-generator.js'

const PRESENTATION_DIR = 'presentation'
const COMPILED_FILE = 'presentation.compiled.json'
const VISUAL_ENGINE = '@pragmatic-lab/mural/visual-engine'

// Raster icon extensions → MIME type for the baked data URI.
const RASTER_MIME: Readonly<Record<string, string>> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
}

function mimeOf(path: string): string
{
    const dot = path.lastIndexOf('.')
    return (dot >= 0 ? RASTER_MIME[path.slice(dot).toLowerCase()] : undefined) ?? 'application/octet-stream'
}

// Base64-encode bytes without Buffer (renderer + node both have btoa). Chunked so a
// large image never overflows the argument list of String.fromCharCode.
function bytesToBase64(bytes: Uint8Array): string
{
    let bin = ''
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
    return btoa(bin)
}

export type PublishLibraryPresentationResult =
    | { ok: true; templates: number; icons: number }
    | { ok: false; missing: string[] }

export async function publishLibraryPresentation(
    project: IStorage, dest: IStorage, base: string, doc: TodlDocument,
): Promise<PublishLibraryPresentationResult>
{
    // Pre-read every referenced icon (compiler include resolution is sync). SVGs are
    // read as text and baked to geometry; raster images are read as bytes and baked
    // as an ImageBrush data URI.
    const svgByPath = new Map<string, string>()
    const rasterUriByPath = new Map<string, string>()
    const missing: string[] = []
    for (const path of distinctIcons(doc)) {
        if (isRasterIcon(path)) {
            try { rasterUriByPath.set(path, `data:${mimeOf(path)};base64,${bytesToBase64(await project.ReadBytes(path))}`) }
            catch { missing.push(path) }
        } else {
            try { svgByPath.set(path, await project.ReadText(path)) }
            catch { missing.push(path) }
        }
    }
    if (missing.length > 0) return { ok: false, missing }

    const source = generateLibraryPresentationMu(doc, [])   // no author-override merges

    const include: IncludeResolver = (path, ctx): IncludeResolution => {
        if (isRasterIcon(path)) {
            const uri = rasterUriByPath.get(path)
            if (uri === undefined) throw new Error(`presentation raster include not pre-read: ${path}`)
            return {
                entries: [{ key: ctx.key ?? path, valueJs: `new ImageBrush(new BitmapImage(${JSON.stringify(uri)}))` }],
                imports: [{ module: VISUAL_ENGINE, names: ['BitmapImage', 'ImageBrush'] }],
            }
        }
        const text = svgByPath.get(path)
        if (text === undefined) throw new Error(`presentation include not pre-read: ${path}`)
        const { valueJs, names } = svgToGeometryJs(text)
        return { entries: [{ key: ctx.key ?? path, valueJs }], imports: [{ module: VISUAL_ENGINE, names: [...names] }] }
    }
    // LibraryClassData is the inert DataType the generated templates declare; add
    // it to the symbol table so the compiler resolves it. The import line it emits
    // is stripped from the artifact body below (the loader supplies it via ctx).
    const symbols = new Map([...DEFAULT_SYMBOLS, ['LibraryClassData', './library-class-data.js']])
    const result = compile(source, { include, symbols })

    const names = new Set<string>()
    for (const set of result.imports.values()) for (const n of set) names.add(n)
    const className = result.resourcesBlocks?.[0]?.name
    if (className === undefined) throw new Error('library presentation compile produced no resources block')

    const body = result.js.split('\n').filter((l) => !/^import\b.*\bfrom\b/.test(l)).join('\n').trim()
    const artifact: CompiledPresentation = { body, symbols: [...names].sort(), className }
    await dest.WriteText(`${base}/${PRESENTATION_DIR}/${COMPILED_FILE}`, JSON.stringify(artifact))

    const templates = doc.nodes.filter((n) => n.tier === 'Instance' && n.attrs['class'] === true).length
    return { ok: true, templates, icons: svgByPath.size + rasterUriByPath.size }
}

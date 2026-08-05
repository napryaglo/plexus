import type { TodlDocument } from '@pragmatic-lab/todl'
import {
    compile, DEFAULT_SYMBOLS, svgToGeometryJs,
    type IncludeResolver, type IncludeResolution,
} from '@pragmatic-lab/mural/compiler'

import type { IStorage } from '../../../services/storage/storage.js'
import { distinctIcons, iconKey } from './presentation-generator.js'
import { scaffoldAuthorStubs, META_MODEL_ROLE } from './presentation-scaffold.js'

const PRESENTATION_DIR = 'presentation'
const COMPILED_FILE = 'presentation.compiled.json'
const VISUAL_ENGINE = '@pragmatic-lab/mural/visual-engine'
const DICT_NAME = 'MetaModelPresentation'

// The self-contained, evaluable presentation payload written into the backend.
// `body` is the compiled resources class (geometry inlined, imports stripped);
// `symbols` are the names the loader destructures from its ctx; `className` is
// the resources block to instantiate.
export interface CompiledPresentation { body: string; symbols: string[]; className: string }

export type PublishPresentationResult =
    | { ok: true; templates: number; icons: number }
    | { ok: false; missing: string[] }

// Compile the meta-model's presentation once and write it into `dest` under
// `<base>/presentation/presentation.compiled.json`. The templates are now
// AUTHOR-owned (presentation/*.mu): missing stubs are scaffolded write-once, and
// every author template is INLINED into the single assets `resources` block so
// its `@icon` references resolve as local vars — the compiler bakes the icon
// SVGs (svgToGeometryJs) into that same block, so the artifact has no external
// file dependency. A referenced icon with no project file blocks the publish
// (nothing is written).
export async function publishPresentation(
    project: IStorage, dest: IStorage, base: string, doc: TodlDocument,
): Promise<PublishPresentationResult>
{
    // Ensure every entity has an editable author-template stub (write-once),
    // so a freshly published model ships styled templates, not bare labels.
    await scaffoldAuthorStubs(project, doc, META_MODEL_ROLE, PRESENTATION_DIR)

    // Pre-read every referenced icon SVG (compiler include resolution is sync).
    const svgByPath = new Map<string, string>()
    const missing: string[] = []
    for (const path of distinctIcons(doc)) {
        try { svgByPath.set(path, await project.ReadText(path)) }
        catch { missing.push(path) }
    }
    if (missing.length > 0) return { ok: false, missing }

    const author = await readAuthorTemplates(project, PRESENTATION_DIR)
    const source = combinedSource(doc, DICT_NAME, author.inners)

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

    return { ok: true, templates: author.count, icons: svgByPath.size }
}

// The author DataTemplate bodies to inline, in deterministic (filename) order,
// plus the total DataTemplate count. One `resources <Name> { … }` dict per file
// by convention; we splice its inner declarations into the assets block.
async function readAuthorTemplates(project: IStorage, dir: string): Promise<{ inners: string[]; count: number }>
{
    let entries
    try { entries = await project.List(dir) }
    catch { return { inners: [], count: 0 } }
    const files = [...entries]
        .filter((e) => !e.IsDirectory && e.Name.endsWith('.mu'))
        .sort((a, b) => a.Name.localeCompare(b.Name))
    const inners: string[] = []
    let count = 0
    for (const e of files) {
        const inner = extractResourcesInner(await project.ReadText(`${dir}/${e.Name}`))
        if (inner === undefined) continue
        inners.push(inner)
        count += (inner.match(/\bDataTemplate\b/g) ?? []).length
    }
    return { inners, count }
}

// The declarations inside a single `resources <Name> { … }` block (its inner
// body), or undefined when the file has no resources block.
function extractResourcesInner(text: string): string | undefined
{
    const m = /resources\s+[A-Za-z_]\w*\s*\{/.exec(text)
    if (m === null) return undefined
    const start = m.index + m[0].length
    const end = text.lastIndexOf('}')
    if (end <= start) return undefined
    return text.slice(start, end).trim()
}

// One self-contained `resources` block: icon includes (baked by the compiler)
// followed by the inlined author templates that reference them (`@icon` resolves
// as a local var because it's declared earlier in the SAME block).
function combinedSource(doc: TodlDocument, dictName: string, authorInners: readonly string[]): string
{
    const includes = distinctIcons(doc).map((p) => `    include "${p}" as ${iconKey(p)}`)
    return [
        `resources ${dictName} {`,
        ...includes,
        ...authorInners.map((inner) => `    ${inner}`),
        '}',
    ].join('\n')
}

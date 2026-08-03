import * as MuralRuntime from '@pragmatic-lab/mural/runtime'
import * as MuralBasic from '@pragmatic-lab/mural/basic'
import * as MuralFramework from '@pragmatic-lab/mural/framework'
import * as MuralEngine from '@pragmatic-lab/mural/visual-engine'
import { ResourceDictionary } from '@pragmatic-lab/mural/runtime'

import type { IStorage } from '../../../services/storage/storage.js'
import type { CompiledPresentation } from '../../meta-model/services/presentation-publisher.js'
import { LibraryClassData } from './library-class-data.js'

export interface LoadProblem { uri: string | null; message: string; severity: 'error' | 'warning' }

export interface LoadedClass
{
    id:            string
    localId?:      string
    label?:        string
    icon?:         string
    concept:       string
    templatePath?: string
    thumbnailPath?: string
    docPath?:      string
}

export interface LoadedLibrary
{
    id:        string
    version:   string
    name:      string
    metaModel: { id: string; version: string }
    classes:   LoadedClass[]
    problems:  LoadProblem[]
}

// Every published <id>/<version> under the backend, loaded. Directory layout is
// the Phase-1 publish layout: root dirs are ids, each id's dirs are versions.
export async function discoverLibraries(backend: IStorage): Promise<LoadedLibrary[]>
{
    const out: LoadedLibrary[] = []
    const ids = (await backend.List('')).filter((e) => e.IsDirectory).map((e) => e.Name).sort()
    for (const id of ids) {
        const versions = (await backend.List(id)).filter((e) => e.IsDirectory).map((e) => e.Name).sort()
        for (const version of versions) out.push(await loadLibrary(backend, id, version))
    }
    return out
}

// Load one library's manifest into a LoadedLibrary. A malformed/unreadable
// manifest yields empty classes + one error problem (never throws). A class that
// cites a template/thumbnail/doc file with no file on disk records a warning.
export async function loadLibrary(backend: IStorage, id: string, version: string): Promise<LoadedLibrary>
{
    const base = `${id}/${version}`
    const problems: LoadProblem[] = []
    let manifest: {
        id: string; version: string; name: string
        metaModel: { id: string; version: string }
        classes: Array<{ id: string; localId?: string; label?: string; concept: string; template?: string; thumbnail?: string; doc?: string; icon?: string }>
    }
    try {
        manifest = JSON.parse(await backend.ReadText(`${base}/library.json`))
    } catch (e) {
        return { id, version, name: id, metaModel: { id: '', version: '' }, classes: [],
                 problems: [{ severity: 'error', uri: 'library.json', message: `Library manifest is invalid: ${(e as Error).message}` }] }
    }

    const classes: LoadedClass[] = []
    for (const c of manifest.classes ?? []) {
        const cls: LoadedClass = { id: c.id, concept: c.concept }
        if (c.localId !== undefined) cls.localId = c.localId
        if (c.label !== undefined) cls.label = c.label
        if (c.icon !== undefined) cls.icon = c.icon
        for (const [field, path] of [['templatePath', c.template], ['thumbnailPath', c.thumbnail], ['docPath', c.doc]] as const) {
            if (path === undefined) continue
            if (await backend.Exists(`${base}/${path}`)) (cls as unknown as Record<string, unknown>)[field] = path
            else problems.push({ severity: 'warning', uri: path, message: `Referenced resource is missing: ${path}` })
        }
        classes.push(cls)
    }
    return { id: manifest.id, version: manifest.version, name: manifest.name, metaModel: manifest.metaModel, classes, problems }
}

// Read a class's template source on demand; undefined if absent/unreadable.
export async function readTemplateSource(backend: IStorage, lib: LoadedLibrary, cls: LoadedClass): Promise<string | undefined>
{
    if (cls.templatePath === undefined) return undefined
    try { return await backend.ReadText(`${lib.id}/${lib.version}/${cls.templatePath}`) }
    catch { return undefined }
}

// Read a class's icon SVG source on demand; undefined if absent/unreadable.
export async function readIconSource(backend: IStorage, lib: LoadedLibrary, cls: LoadedClass): Promise<string | undefined>
{
    if (cls.icon === undefined) return undefined
    try { return await backend.ReadText(`${lib.id}/${lib.version}/${cls.icon}`) }
    catch { return undefined }
}

// Load a library's baked presentation (class-keyed DataTemplates, geometry inlined)
// by evaluating the compiled artifact — no parse, no compile, no SVG read. Returns
// undefined when the bundle predates the feature (no artifact). Mirrors the
// meta-model's presentation-loader; LibraryClassData is the templates' inert
// DataType, supplied via ctx.
const COMPILED_PRESENTATION = 'presentation/presentation.compiled.json'

export async function loadLibraryPresentation(backend: IStorage, id: string, version: string): Promise<ResourceDictionary | undefined>
{
    let raw: string
    try { raw = await backend.ReadText(`${id}/${version}/${COMPILED_PRESENTATION}`) }
    catch { return undefined }
    const { body, symbols, className } = JSON.parse(raw) as CompiledPresentation
    const ctx: Record<string, unknown> = {
        ...MuralRuntime, ...MuralEngine, ...MuralBasic, ...MuralFramework, LibraryClassData,
    }
    const destructure = symbols.length > 0 ? `const { ${symbols.join(', ')} } = _ctx;\n` : ''
    const bodyR = body.replace(/^export class /gm, 'class ')
    const fn = new Function('_ctx', `${destructure}${bodyR}\nreturn ${className}.Clone();`)
    return fn(ctx) as ResourceDictionary
}

// presentation-scaffold.ts — write-once author-template stubs.
//
// The generated presentation dictionary carries only assets (icons); the
// per-entity/class visuals are AUTHOR-OWNED templates in presentation/*.mu.
// This scaffolder seeds one editable DataTemplate stub per entity — icon + label
// box, the same shape the generator used to bake — but ONLY for keys not already
// declared across presentation/*.mu, so author edits (and consolidations) survive
// every regeneration. The one per-domain difference (mm:<id> + baked label vs a
// class id + $Display binding) is isolated to the role descriptor below.
import { projectAnnotations, type TodlDocument, type JsonNode } from '@pragmatic-lab/todl'

import type { IStorage } from '../../../services/storage/storage.js'
import { ontologyEntities, classEntities, resolveFacets, resourceKeyFor, isRasterIcon } from './presentation-generator.js'

// Note: stubs are FIGURE-ONLY (icon or a neutral box, never a label). The host —
// toolbox tile, canvas node, library preview — draws the caption, so a single
// visual reads correctly wherever it is presented and nothing double-labels.

// Which domain a stub is authored for. Markup-facing (drives DataType), so a
// real enum with stable values.
export enum PresentationRoleKind
{
    MetaModel = 'meta-model',
    Library = 'library',
}

// A role parameterises the per-domain differences: which nodes are presentable,
// how a node maps to a template key, the template's DataType, and the
// `resources <Name>` identifier of the single scaffolded templates file.
export interface PresentationRole
{
    kind: PresentationRoleKind
    entities(doc: TodlDocument): JsonNode[]
    key(node: JsonNode): string
    dataType: string
    templatesDict: string
}

export const META_MODEL_ROLE: PresentationRole = {
    kind: PresentationRoleKind.MetaModel,
    entities: (doc) => [...ontologyEntities(doc), ...classEntities(doc)],
    key: (n) => `mm:${n.id}`,
    dataType: 'MetaModelEntity',
    templatesDict: 'MetaModelPresentationTemplates',
}

export const LIBRARY_ROLE: PresentationRole = {
    kind: PresentationRoleKind.Library,
    entities: (doc) => classEntities(doc),
    key: (n) => n.id,
    dataType: 'LibraryClassData',
    templatesDict: 'LibraryPresentationTemplates',
}

// The single author-templates file all scaffolded stubs live in.
const TEMPLATES_FILE = 'templates.mu'

// Seed missing author templates into a SINGLE `presentation/templates.mu` dict —
// one editable DataTemplate per entity. Write-once: an entity whose key is
// already declared in ANY presentation/*.mu is skipped, and regeneration only
// APPENDS new entities (existing declarations are never rewritten), so author
// edits survive. Returns the number of templates added.
export async function scaffoldAuthorStubs(
    storage: IStorage,
    doc: TodlDocument,
    role: PresentationRole,
    dir: string,
): Promise<number>
{
    const have = await existingKeys(storage, dir)
    const missing = role.entities(doc).filter((n) => !have.has(role.key(n)))
    if (missing.length === 0) return 0

    const blocks = missing.map((n) => templateBlock(role, doc, n))
    const path = `${dir}/${TEMPLATES_FILE}`
    const existing = await readOrEmpty(storage, path)
    const next = existing.trim() === ''
        ? [
            '// AUTHOR TEMPLATES — edit freely; regeneration only APPENDS new entities.',
            `resources ${role.templatesDict} {`,
            blocks.join('\n\n'),
            '}',
            '',
          ].join('\n')
        : insertBeforeLastBrace(existing, `\n${blocks.join('\n\n')}\n`)
    await storage.WriteText(path, next)
    return missing.length
}

async function readOrEmpty(storage: IStorage, path: string): Promise<string>
{
    try { return await storage.ReadText(path) }
    catch { return '' }
}

// Splice new template blocks in just before the templates dict's closing brace,
// leaving every existing declaration byte-for-byte intact.
function insertBeforeLastBrace(text: string, insertion: string): string
{
    const idx = text.lastIndexOf('}')
    if (idx < 0) return `${text}\n${insertion}`
    return text.slice(0, idx) + insertion + text.slice(idx)
}

// The x:key values already declared across presentation/*.mu — the write-once
// gate. Missing folder → empty set.
async function existingKeys(storage: IStorage, dir: string): Promise<Set<string>>
{
    const keys = new Set<string>()
    let entries
    try { entries = await storage.List(dir) }
    catch { return keys }
    for (const e of entries) {
        if (e.IsDirectory || !e.Name.endsWith('.mu')) continue
        const text = await storage.ReadText(`${dir}/${e.Name}`)
        for (const m of text.matchAll(/x:key="([^"]+)"/g)) keys.add(m[1])
    }
    return keys
}

// One editable author template (a DataTemplate declaration, indented to sit
// inside the templates `resources` block): a figure-only Border — the icon when
// the node resolves one, otherwise an empty neutral box. The host draws the label.
function templateBlock(role: PresentationRole, doc: TodlDocument, node: JsonNode): string
{
    const { icon } = resolveFacets(node, projectAnnotations(doc, node.id))
    const border = icon === undefined
        ? [`        Border [ Background = @SurfaceContainerHigh, CornerRadius = 6, Padding = (8,6,8,6) ]`]
        : [
            `        Border [ Background = @SurfaceContainerHigh, CornerRadius = 6, Padding = (8,6,8,6) ] {`,
            `            ${iconElement(doc, icon)}`,
            `        }`,
          ]
    return [
        `    DataTemplate x:key="${role.key(node)}" [ DataType = ${role.dataType} ] {`,
        ...border,
        `    }`,
    ].join('\n')
}

// The 16×16 icon element: a Shape drawing a baked SVG geometry, or — for a raster
// icon — a Border filled with the baked ImageBrush.
function iconElement(doc: TodlDocument, icon: string): string
{
    const key = resourceKeyFor(doc, icon)
    return isRasterIcon(icon)
        ? `Border [ Width = 16, Height = 16, Margin = (0,0,6,0), Background = @${key} ]`
        : `Shape [ Geometry = @${key}, Fill = @OnSurface, Width = 16, Height = 16, Margin = (0,0,6,0) ]`
}

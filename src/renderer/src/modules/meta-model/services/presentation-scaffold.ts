// presentation-scaffold.ts — write-once author-template stubs.
//
// The generated presentation dictionary carries only assets (icons); the
// per-entity/class visuals are AUTHOR-OWNED templates in presentation/*.mu.
// This scaffolder seeds one editable DataTemplate stub per entity — icon + label
// box, the same shape the generator used to bake — but ONLY for keys not already
// declared across presentation/*.mu, so author edits (and consolidations) survive
// every regeneration. The one per-domain difference (mm:<id> + baked label vs a
// class id + $Display binding) is isolated to the role descriptor below.
import type { TodlDocument, JsonNode } from '@pragmatic-lab/todl'

import type { IStorage } from '../../../services/storage/storage.js'
import { ontologyEntities, classEntities, resolveFacets, iconKey, isRasterIcon } from './presentation-generator.js'
import { projectAnnotations } from './annotation-projection.js'

// Which domain a stub is authored for. Markup-facing (drives DataType), so a
// real enum with stable values.
export enum PresentationRoleKind
{
    MetaModel = 'meta-model',
    Library = 'library',
}

// A role parameterises the per-domain differences: which nodes are presentable,
// how a node maps to a template key, the template's DataType, and the label
// expression (a mural attribute value — a baked string vs a `$Display` binding).
export interface PresentationRole
{
    kind: PresentationRoleKind
    entities(doc: TodlDocument): JsonNode[]
    key(node: JsonNode): string
    dataType: string
    labelExpr(doc: TodlDocument, node: JsonNode): string
}

export const META_MODEL_ROLE: PresentationRole = {
    kind: PresentationRoleKind.MetaModel,
    entities: (doc) => [...ontologyEntities(doc), ...classEntities(doc)],
    key: (n) => `mm:${n.id}`,
    dataType: 'MetaModelEntity',
    labelExpr: (doc, n) => `"${escapeMu(resolveFacets(n, projectAnnotations(doc, n.id)).label)}"`,
}

export const LIBRARY_ROLE: PresentationRole = {
    kind: PresentationRoleKind.Library,
    entities: (doc) => classEntities(doc),
    key: (n) => n.id,
    dataType: 'LibraryClassData',
    labelExpr: () => '$Display',
}

// Seed missing author stubs. Returns the number written. Never overwrites an
// existing file, and never re-creates a key already declared in presentation/*.mu.
export async function scaffoldAuthorStubs(
    storage: IStorage,
    doc: TodlDocument,
    role: PresentationRole,
    dir: string,
): Promise<number>
{
    const have = await existingKeys(storage, dir)
    let written = 0
    for (const node of role.entities(doc)) {
        const key = role.key(node)
        if (have.has(key)) continue
        await storage.WriteText(`${dir}/${slug(node.id)}.mu`, stubMu(role, doc, node))
        have.add(key)
        written++
    }
    return written
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

// One editable author stub: a Border wrapping an icon + label (or label only).
function stubMu(role: PresentationRole, doc: TodlDocument, node: JsonNode): string
{
    const { icon } = resolveFacets(node, projectAnnotations(doc, node.id))
    const label = `TextBlock [ Text = ${role.labelExpr(doc, node)}, Foreground = @OnSurface ]`
    const inner = icon === undefined
        ? [`            ${label}`]
        : [
            `            StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {`,
            `                ${iconElement(icon)}`,
            `                ${label}`,
            `            }`,
          ]
    return [
        '// AUTHOR STUB — edit freely; regeneration will not overwrite this file.',
        `resources Pres_${slug(node.id)} {`,
        `    DataTemplate x:key="${role.key(node)}" [ DataType = ${role.dataType} ] {`,
        `        Border [ Background = @SurfaceContainerHigh, CornerRadius = 6, Padding = (8,6,8,6) ] {`,
        ...inner,
        `        }`,
        `    }`,
        '}',
        '',
    ].join('\n')
}

// The 16×16 icon element: a Shape drawing a baked SVG geometry, or — for a raster
// icon — a Border filled with the baked ImageBrush.
function iconElement(icon: string): string
{
    const key = iconKey(icon)
    return isRasterIcon(icon)
        ? `Border [ Width = 16, Height = 16, Margin = (0,0,6,0), Background = @${key} ]`
        : `Shape [ Geometry = @${key}, Fill = @OnSurface, Width = 16, Height = 16, Margin = (0,0,6,0) ]`
}

// Slug an id into a filesystem-safe stem + identifier fragment (iconKey's rules).
function slug(id: string): string
{
    return id.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

// Escape a string for a double-quoted mural attribute value.
function escapeMu(s: string): string { return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') }

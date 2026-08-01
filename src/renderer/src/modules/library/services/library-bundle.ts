import type { TodlDocument } from '@pragmatic-lab/todl'

import type { IStorage } from '../../../services/storage/storage.js'
import { projectAnnotations } from '../../meta-model/services/annotation-projection.js'

// One instantiable class a published library provides — a palette item. Derived
// from the compiled model's Instance-tier clabjects; resource paths are attached
// later (present only when the conventionally-named file exists).
export interface PublishedClass
{
    id:         string     // qualified class NodeId, e.g. "microsoft.azure"
    localId?:   string     // attrs.id, the short name, e.g. "azure"
    label?:     string     // attrs.label, if present, e.g. "Azure"
    icon?:      string     // annotation icon path, e.g. "resources/azure.svg" (bundle-relative)
    concept:    string     // node.typeOf — the meta-model concept it realises, e.g. "location"
    template?:  string     // "visuals/<id>.mural"    — present only if the file exists
    thumbnail?: string     // "thumbnails/<id>.png"   — present only if the file exists
    doc?:       string     // "docs/<id>.md"          — present only if the file exists
}

// The library.json bundle manifest — the index a consumer reads to discover and
// mount a published library. `classes` are the palette items; `assets`/`docs`/
// `samples` list every file under those bundle folders.
export interface LibraryBundleManifest
{
    id:          string
    version:     string
    name:        string
    description?: string
    metaModel:   { id: string; version: string }
    classes:     PublishedClass[]
    assets:      string[]
    docs:        string[]
    samples:     string[]
}

// The instantiable classes a library provides: Instance-tier clabjects
// (`attrs.class === true`), each simultaneously an instance of a meta concept and
// a class for further instantiation. `tier` is compared to the literal "Instance"
// because toJSON emits the Tier enum by member name; `attrs.class` is a boolean
// scalar. Ontology-tier concept/field/taxonomy definitions are NOT classes.
export function deriveClasses(model: TodlDocument): PublishedClass[]
{
    const out: PublishedClass[] = []
    for (const n of model.nodes) {
        if (n.tier !== 'Instance' || n.attrs.class !== true) continue
        const cls: PublishedClass = { id: n.id, concept: n.typeOf }
        if (typeof n.attrs.id === 'string') cls.localId = n.attrs.id
        if (typeof n.attrs.label === 'string') cls.label = n.attrs.label
        const iconPath = projectAnnotations(model, n.id).icon?.path
        if (typeof iconPath === 'string') cls.icon = iconPath
        out.push(cls)
    }
    return out
}

export interface ScannedResources
{
    byClass:  Map<string, { template?: string; thumbnail?: string; doc?: string }>
    assets:   string[]
    docs:     string[]
    samples:  string[]
    warnings: string[]
}

// Scan the reserved resource folders and bind files to classes by filename
// convention (stem = class id): visuals/<id>.mural, thumbnails/<id>.png,
// docs/<id>.md attach to a known class; every asset/doc/sample file is also
// listed for the bundle manifest. A visuals/thumbnails file whose stem is not a
// known class id is an orphan — warned, never fatal. Folders are listed flat
// (Phase 1 assumes no nesting inside them); a missing folder lists as empty.
export async function scanResources(
    storage: IStorage,
    classIds: readonly string[],
): Promise<ScannedResources>
{
    const known = new Set(classIds)
    const byClass = new Map<string, { template?: string; thumbnail?: string; doc?: string }>()
    const warnings: string[] = []

    const ensure = (id: string): { template?: string; thumbnail?: string; doc?: string } => {
        let e = byClass.get(id)
        if (e === undefined) { e = {}; byClass.set(id, e) }
        return e
    }
    const files = async (dir: string): Promise<string[]> => {
        const names: string[] = []
        for (const e of await storage.List(dir)) if (!e.IsDirectory) names.push(e.Name)
        return names
    }
    const stem = (name: string): string => {
        const i = name.lastIndexOf('.')
        return i > 0 ? name.slice(0, i) : name
    }

    for (const name of await files('visuals')) {
        if (!name.endsWith('.mural')) continue
        const id = stem(name)
        if (known.has(id)) ensure(id).template = `visuals/${name}`
        else warnings.push(`visuals/${name} targets unknown class "${id}"`)
    }
    for (const name of await files('thumbnails')) {
        const id = stem(name)
        if (known.has(id)) ensure(id).thumbnail = `thumbnails/${name}`
        else warnings.push(`thumbnails/${name} targets unknown class "${id}"`)
    }
    for (const name of await files('docs')) {
        const id = stem(name)
        if (name.endsWith('.md') && known.has(id)) ensure(id).doc = `docs/${name}`
    }

    const assets  = (await files('assets')).map((n) => `assets/${n}`)
    const docs    = (await files('docs')).map((n) => `docs/${n}`)
    const samples = (await files('samples')).map((n) => `samples/${n}`)
    return { byClass, assets, docs, samples, warnings }
}

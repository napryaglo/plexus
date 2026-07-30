// presentation-generator.ts — pure emitter for a meta-model's presentation
// resource dictionary. No I/O, no mural import; deterministic text only. All
// model/filesystem access lives in the factory that calls this.

// "resources/actor-internal.svg" → "mm_icon_actor_internal". Strips the
// directory + extension, lowercases, and replaces every non-identifier run with
// a single '_', so distinct paths yield distinct keys usable as a mural resource
// key (`@mm_icon_…`).
export function iconKey(path: string): string
{
    const stem = path.replace(/^.*\//, '').replace(/\.[^.]+$/, '')
    const slug = stem.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    return `mm_icon_${slug}`
}

// "app-component" → "App Component". Splits on '-'/'.'/'_' and title-cases each
// word. Used as the fallback label when an entity declares no attrs.label.
export function humanize(id: string): string
{
    return id.split(/[-._]/).filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
}

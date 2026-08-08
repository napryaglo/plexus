import { Application } from '@pragmatic-lab/mural/runtime'
import { parseSvgIcon, type IconDefinition } from '@pragmatic-lab/mural/basic'

// The fallback glyph an entity renders when its icon resource key is empty or
// resolves nothing. A neutral "category" grid, monochrome (currentColor → themed
// by the Icon's Foreground). Swap this SVG to change the default look.
const DEFAULT_ICON_SVG =
    '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z"/></svg>'

export const DEFAULT_ICON: IconDefinition = parseSvgIcon(DEFAULT_ICON_SVG)

let resolver: ((key: string) => unknown) | undefined

// Override the resource resolver. undefined restores the default
// Application.Resources lookup. Used by headless tests and by the registry to
// bridge its owned aggregate (headless-safe, no Application.current needed).
export function setIconResourceResolver(fn: ((key: string) => unknown) | undefined): void
{
    resolver = fn
}

function resolve(key: string): unknown
{
    if (resolver !== undefined) return resolver(key)
    return Application.current?.Resources.Resolve(key)
}

// Binding converter: an icon resource-key string → its colored IconDefinition, or
// the default glyph when the key is empty or resolves nothing. Instantiated
// zero-arg by markup (`$IconKey << IconKeyConverter`); receives the bound value only.
export class IconKeyConverter
{
    public convert(key: unknown): unknown
    {
        const k = typeof key === 'string' ? key : ''
        const hit = k === '' ? undefined : resolve(k)
        return hit ?? DEFAULT_ICON
    }
}

import { Application } from '@pragmatic-lab/mural/runtime'

// The fallback glyph resolved when an entity's icon resource key is empty or
// resolves nothing. Baked into DiagramResources (see diagram.resources.mu).
export const DEFAULT_ICON_KEY = 'category'

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

// Binding converter: an icon resource-key string → its Geometry, or the shipped
// default glyph when the key is empty or resolves nothing. Instantiated zero-arg
// by markup (`$IconKey << IconKeyConverter`); receives the bound value only.
export class IconKeyConverter
{
    public convert(key: unknown): unknown
    {
        const k = typeof key === 'string' ? key : ''
        const hit = k === '' ? undefined : resolve(k)
        return hit ?? resolve(DEFAULT_ICON_KEY)
    }
}

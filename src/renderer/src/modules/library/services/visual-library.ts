import { instantiate } from '@pragmatic-lab/mural/compiler'
import * as muralRuntime from '@pragmatic-lab/mural/runtime'
import * as muralBasic from '@pragmatic-lab/mural/basic'
import * as muralEngine from '@pragmatic-lab/mural/visual-engine'
import { DataTemplate, type DataTemplateFactory, Icon, type IconDefinition } from '@pragmatic-lab/mural/basic'
import type { Visual } from '@pragmatic-lab/mural/runtime'

// The runtime symbol table instantiate() destructures the fragment's referenced
// symbols from. Built once per registry.
export function buildCtx(): Record<string, unknown>
{
    return { ...muralRuntime, ...muralBasic, ...muralEngine }
}

// Compile a `.mural` fragment (a bare-element root) into a DataTemplate. instantiate
// returns a zero-arg factory that builds the fragment's visual; we wrap it so the
// host's Content becomes the visual's DataContext (bindings like $Display resolve
// against it). Throws (via instantiate) if the source can't compile.
export function compileTemplate(source: string, ctx: Record<string, unknown>): DataTemplate
{
    const factory = instantiate(source, ctx) as () => Visual
    const wrapped: DataTemplateFactory = (data) => {
        const v = factory() as Visual & { DataContext: unknown }
        v.DataContext = data
        return v
    }
    return new DataTemplate(wrapped)
}

// The always-installed default visual — a neutral, figure-only box for any class
// without its own template. Authored as a fragment so it goes through the same
// compile path. It carries NO label: the host (tile / canvas node / preview) draws
// the caption, so a no-icon class reads as a plain box under its host-owned name.
const DEFAULT_SOURCE =
      'Border [ Background = @SurfaceContainerHigh, CornerRadius = 6, Padding = (10,6,10,6) ]'

export function buildDefaultTemplate(ctx: Record<string, unknown>): DataTemplate
{
    return compileTemplate(DEFAULT_SOURCE, ctx)
}

// A figure-only icon template for a class with an `icon` annotation but no authored
// `.mural`. The chrome compiles through the same fragment path as the default; the
// parsed IconDefinition (fixed per class) is set onto the one Icon element after the
// tree is built (found by a visual-tree walk), so no per-instance binding is needed
// for it. No label — the host draws the caption.
const ICON_SOURCE =
      'Border [ Background = @SurfaceContainerHigh, CornerRadius = 6, Padding = (10,6,10,6) ] {'
    + ' Icon [ Foreground = @OnSurface, Width = 16, Height = 16 ] }'

export function buildIconTemplate(iconDef: IconDefinition, ctx: Record<string, unknown>): DataTemplate
{
    const factory = instantiate(ICON_SOURCE, ctx) as () => Visual
    const wrapped: DataTemplateFactory = (data) => {
        const v = factory() as Visual & { DataContext: unknown }
        v.DataContext = data
        const icon = findIcon(v)
        if (icon !== undefined) icon.Source = iconDef
        return v
    }
    return new DataTemplate(wrapped)
}

// First Icon in the visual tree (depth-first over logical + visual children).
function findIcon(v: Visual): Icon | undefined
{
    if (v instanceof Icon) return v
    for (const c of [...v.logicalChildren, ...v.visualChildren]) {
        const f = findIcon(c)
        if (f !== undefined) return f
    }
    return undefined
}

import { instantiate } from '@pragmatic-lab/mural/compiler'
import * as muralRuntime from '@pragmatic-lab/mural/runtime'
import * as muralBasic from '@pragmatic-lab/mural/basic'
import * as muralEngine from '@pragmatic-lab/mural/visual-engine'
import { DataTemplate, type DataTemplateFactory } from '@pragmatic-lab/mural/basic'
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

// The always-installed default visual — a labelled box for any class without its
// own template. Authored as a fragment so it goes through the same compile path.
// $Display is the class's display string (see ClassData).
const DEFAULT_SOURCE =
      'Border [ Background = @SurfaceContainerHigh, CornerRadius = 6, Padding = (10,6,10,6) ] {'
    + ' TextBlock [ Text = $Display, Foreground = @OnSurface ] }'

export function buildDefaultTemplate(ctx: Record<string, unknown>): DataTemplate
{
    return compileTemplate(DEFAULT_SOURCE, ctx)
}

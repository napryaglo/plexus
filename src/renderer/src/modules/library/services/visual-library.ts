import { instantiate, DEFAULT_SYMBOLS } from '@pragmatic-lab/mural/compiler'
import * as muralRuntime from '@pragmatic-lab/mural/runtime'
import * as muralBasic from '@pragmatic-lab/mural/basic'
import * as muralEngine from '@pragmatic-lab/mural/visual-engine'
import { DataTemplate, type DataTemplateFactory } from '@pragmatic-lab/mural/basic'
import type { Visual } from '@pragmatic-lab/mural/runtime'
import { IconKeyConverter } from '../../diagram/services/icon-key-converter.js'

// Compiler symbol table extended with the fragment-referenced converters so
// `$IconKey << IconKeyConverter` resolves (the module string is unused by
// instantiate — the value comes from ctx — but must be present so ensureImport
// does not reject the symbol).
const SYMBOLS = new Map([...DEFAULT_SYMBOLS, ['IconKeyConverter', '../../diagram/services/icon-key-converter.js']])

// The runtime symbol table instantiate() destructures the fragment's referenced
// symbols from. Built once per registry. A no-arg converter reference
// (`$IconKey << IconKeyConverter`) resolves to the bare symbol and the binding
// calls `.convert` on it, so ctx must map the name to a converter INSTANCE.
export function buildCtx(): Record<string, unknown>
{
    return { ...muralRuntime, ...muralBasic, ...muralEngine, IconKeyConverter: new IconKeyConverter() }
}

// Compile a `.mural` fragment (a bare-element root) into a DataTemplate. instantiate
// returns a zero-arg factory that builds the fragment's visual; we wrap it so the
// host's Content becomes the visual's DataContext (bindings like $Display resolve
// against it). Throws (via instantiate) if the source can't compile.
export function compileTemplate(source: string, ctx: Record<string, unknown>): DataTemplate
{
    const factory = instantiate(source, ctx, { symbols: SYMBOLS }) as () => Visual
    const wrapped: DataTemplateFactory = (data) => {
        const v = factory() as Visual & { DataContext: unknown }
        v.DataContext = data
        return v
    }
    return new DataTemplate(wrapped)
}

// The always-installed default visual — the ONE template every published-package
// entity renders through. A neutral figure-only box whose Icon draws the entity's
// colored IconDefinition, resolved from the bound $IconKey via IconKeyConverter
// (empty/unknown key → the default glyph). Recolor=false keeps each icon's own
// fills; Foreground themes any currentColor shapes. It carries NO label: the host
// (tile / canvas node / preview) draws the caption.
const DEFAULT_SOURCE =
      'Border [ Background = @SurfaceContainerHigh, CornerRadius = 6 ] {'
    + ' Icon [ Source = $IconKey << IconKeyConverter, Recolor = false, Foreground = @OnSurface,'
    + ' Width = $IconWidth, Height = $IconHeight, HorizontalAlignment = Center, VerticalAlignment = Center ] }'

export function buildDefaultTemplate(ctx: Record<string, unknown>): DataTemplate
{
    return compileTemplate(DEFAULT_SOURCE, ctx)
}

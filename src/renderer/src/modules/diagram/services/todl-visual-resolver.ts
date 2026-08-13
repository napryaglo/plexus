import { Application, Element, ServiceKey, type Visual } from '@pragmatic-lab/mural/runtime'
import { ApplicationSettings, DiagramSettings, VisualContext, type IToolboxVisualResolver, type ToolboxVisualDescriptor } from '@pragmatic-lab/mural/framework'
import { buildCtx, buildDefaultTemplate, buildFigureTemplate } from '../../library/services/visual-library.js'
import type { TodlPresentationRegistry } from './todl-presentation-registry.js'

export const TodlVisualResolverKey = new ServiceKey<IToolboxVisualResolver>('TodlVisualResolver')

// Setting keys (match diagram.module.mu) that size the Tile-context icon; the
// Figure context (canvas nodes) reads the shared shape-default-size setting so a
// canvas icon renders at the same size as a geometric shape.
const ITEM_WIDTH_SETTING = 'toolbox.item.width'
const ITEM_HEIGHT_SETTING = 'toolbox.item.height'
const TILE_ICON_FALLBACK = 48

// Resolves every published-package visual through the ONE default template, drawing
// the entity's icon named by the registry's entityKey → resource-key index (unknown
// key → the default glyph). Bridges registry.onChanged so re-discovers push visual
// upgrades to live presenters.
export class TodlVisualResolver implements IToolboxVisualResolver
{
    private readonly unsubs = new Map<(key: string) => void, () => void>()
    private readonly ctx = buildCtx()
    // Tile context draws a @SurfaceContainerHigh chip behind the icon; Figure (canvas
    // node) draws the icon on a transparent background.
    private readonly tileTemplate = buildDefaultTemplate(this.ctx)
    private readonly figureTemplate = buildFigureTemplate(this.ctx)

    constructor(private readonly registry: TodlPresentationRegistry) {}

    public Resolve(descriptor: ToolboxVisualDescriptor, context: VisualContext): Visual
    {
        // descriptor.Key is an entity key: a library term id (bare, e.g.
        // `microsoft_tech.azure_front_door`) or a meta-model entity id. Map it to a
        // baked resource key through the presentation index — the same lookup the
        // toolbox tiles use. The `mm:` fallback covers a bare meta-model term id an
        // arch canvas node carries (the meta-model keyspace is `mm:`-prefixed).
        // Unknown key → '' → default glyph.
        const iconKey = this.registry.iconKeyFor(descriptor.Key)
            ?? this.registry.iconKeyFor(`mm:${descriptor.Key}`)
            ?? ''
        const { width, height } = this.iconSize(context)
        const template = context === VisualContext.Tile ? this.tileTemplate : this.figureTemplate
        const visual = template.Apply({ IconKey: iconKey, IconWidth: width, IconHeight: height })
        // Tiles are drag chrome: the enclosing Border owns the gesture, so the
        // rendered visual must not swallow hit-testing.
        if (context === VisualContext.Tile && visual instanceof Element) visual.IsHitTestVisible = false
        return visual
    }

    // The icon size for a context: Tile (toolbox tiles + library preview) reads the
    // toolbox item size settings so entity icons match the 48px tiles; Figure
    // (canvas nodes) reads the shape-default-size setting so a canvas icon renders
    // at the same size as a geometric shape. Read at resolve time so a settings
    // change takes effect on the next reload.
    private iconSize(context: VisualContext): { width: number; height: number }
    {
        if (context !== VisualContext.Tile)
        {
            const size = DiagramSettings.ShapeDefaultSize()
            return { width: size, height: size }
        }
        const settings = Application.current?.Services.get(ApplicationSettings.Key)
        const w = settings?.Get(ITEM_WIDTH_SETTING)
        const h = settings?.Get(ITEM_HEIGHT_SETTING)
        return {
            width: typeof w === 'number' ? w : TILE_ICON_FALLBACK,
            height: typeof h === 'number' ? h : TILE_ICON_FALLBACK,
        }
    }

    public AddChangedListener(cb: (key: string) => void): void
    {
        if (this.unsubs.has(cb)) return
        this.unsubs.set(cb, this.registry.onChanged((key) => cb(key)))
    }

    public RemoveChangedListener(cb: (key: string) => void): void
    {
        const u = this.unsubs.get(cb)
        if (u !== undefined) { u(); this.unsubs.delete(cb) }
    }
}

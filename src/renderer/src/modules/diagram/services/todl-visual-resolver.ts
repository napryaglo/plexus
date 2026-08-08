import { Application, Element, ServiceKey, type Visual } from '@pragmatic-lab/mural/runtime'
import { ApplicationSettings, VisualContext, type IToolboxVisualResolver, type ToolboxVisualDescriptor } from '@pragmatic-lab/mural/framework'
import { buildCtx, buildDefaultTemplate } from '../../library/services/visual-library.js'
import type { TodlPresentationRegistry } from './todl-presentation-registry.js'

export const TodlVisualResolverKey = new ServiceKey<IToolboxVisualResolver>('TodlVisualResolver')

// Setting keys (match diagram.module.mu) that size the Tile-context icon; the
// Figure context (canvas nodes) keeps its own fixed size.
const ITEM_WIDTH_SETTING = 'toolbox.item.width'
const ITEM_HEIGHT_SETTING = 'toolbox.item.height'
const TILE_ICON_FALLBACK = 48
const FIGURE_ICON_SIZE = 32

// Resolves every published-package visual through the ONE default template, drawing
// the entity's icon named by the registry's entityKey → resource-key index (unknown
// key → the default glyph). Bridges registry.onChanged so re-discovers push visual
// upgrades to live presenters.
export class TodlVisualResolver implements IToolboxVisualResolver
{
    private readonly unsubs = new Map<(key: string) => void, () => void>()
    private readonly defaultTemplate = buildDefaultTemplate(buildCtx())

    constructor(private readonly registry: TodlPresentationRegistry) {}

    public Resolve(descriptor: ToolboxVisualDescriptor, context: VisualContext): Visual
    {
        const iconKey = this.registry.iconKeyFor(descriptor.Key) ?? ''
        const { width, height } = this.iconSize(context)
        const visual = this.defaultTemplate.Apply({ IconKey: iconKey, IconWidth: width, IconHeight: height })
        // Tiles are drag chrome: the enclosing Border owns the gesture, so the
        // rendered visual must not swallow hit-testing.
        if (context === VisualContext.Tile && visual instanceof Element) visual.IsHitTestVisible = false
        return visual
    }

    // The icon size for a context: Tile (toolbox tiles + library preview) reads the
    // toolbox item size settings so entity icons match the 48px shapes; Figure
    // (canvas nodes) keeps a fixed size. Read at resolve time so a settings change
    // takes effect on the next reload.
    private iconSize(context: VisualContext): { width: number; height: number }
    {
        if (context !== VisualContext.Tile) return { width: FIGURE_ICON_SIZE, height: FIGURE_ICON_SIZE }
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

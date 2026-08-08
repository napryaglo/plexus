import { Element, ServiceKey, type Visual } from '@pragmatic-lab/mural/runtime'
import { VisualContext, type IToolboxVisualResolver, type ToolboxVisualDescriptor } from '@pragmatic-lab/mural/framework'
import { buildCtx, buildDefaultTemplate } from '../../library/services/visual-library.js'
import type { TodlPresentationRegistry } from './todl-presentation-registry.js'

export const TodlVisualResolverKey = new ServiceKey<IToolboxVisualResolver>('TodlVisualResolver')

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
        const visual = this.defaultTemplate.Apply({ IconKey: iconKey })
        // Tiles are drag chrome: the enclosing Border owns the gesture, so the
        // rendered visual must not swallow hit-testing.
        if (context === VisualContext.Tile && visual instanceof Element) visual.IsHitTestVisible = false
        return visual
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

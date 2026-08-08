import { Element, ServiceKey, type Visual } from '@pragmatic-lab/mural/runtime'
import { VisualContext, type IToolboxVisualResolver, type ToolboxVisualDescriptor } from '@pragmatic-lab/mural/framework'
import type { LibraryRegistry } from '../../library/services/library-registry.js'

export const LibraryClassVisualResolverKey = new ServiceKey<IToolboxVisualResolver>('LibraryClassVisualResolver')

// Resolves a library class descriptor to its visual through the LibraryRegistry
// (compiled template / baked presentation / default box). Never sets DataContext —
// the class template inherits the presenter's (the item / node / preview row), so
// $Display binds to that host. Bridges registry.onChanged so a re-discover
// (library install/uninstall) upgrades the presenter's content in place.
export class LibraryClassVisualResolver implements IToolboxVisualResolver
{
    private readonly unsubs = new Map<(key: string) => void, () => void>()

    constructor(private readonly registry: LibraryRegistry) {}

    public Resolve(descriptor: ToolboxVisualDescriptor, context: VisualContext): Visual
    {
        const template = this.registry.resolve(descriptor.Key, '')
        const visual = template.Apply({})
        // Tiles are drag chrome: the enclosing Border owns the gesture, so the
        // rendered class visual must not swallow hit-testing.
        if (context === VisualContext.Tile && visual instanceof Element) visual.IsHitTestVisible = false
        return visual
    }

    public AddChangedListener(cb: (key: string) => void): void
    {
        if (this.unsubs.has(cb)) return
        this.unsubs.set(cb, this.registry.onChanged((classId) => cb(classId)))
    }

    public RemoveChangedListener(cb: (key: string) => void): void
    {
        const u = this.unsubs.get(cb)
        if (u !== undefined) { u(); this.unsubs.delete(cb) }
    }
}

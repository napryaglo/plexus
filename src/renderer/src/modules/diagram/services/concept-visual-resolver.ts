import { Element, ServiceKey, type Visual } from '@pragmatic-lab/mural/runtime'
import { parseSvgIcon } from '@pragmatic-lab/mural/basic'
import { VisualContext, type IToolboxVisualResolver, type ToolboxVisualDescriptor } from '@pragmatic-lab/mural/framework'
import { buildCtx, buildIconTemplate, buildDefaultTemplate } from '../../library/services/visual-library.js'

export const ConceptVisualResolverKey = new ServiceKey<IToolboxVisualResolver>('ConceptVisualResolver')

// Renders a meta-model concept term's visual from its annotation-driven icon (an
// SVG the populator supplies via Register). Ready-now: never fires changed. A key
// with no registered icon (e.g. a bare concept id on a reference-less canvas node)
// falls back to the same default box the LibraryRegistry uses — parity with today.
export class ConceptVisualResolver implements IToolboxVisualResolver
{
    private readonly icons = new Map<string, string>()
    private readonly ctx = buildCtx()

    public Register(key: string, icon: string | undefined): void
    {
        if (icon !== undefined && icon !== '') this.icons.set(key, icon)
    }

    public Resolve(descriptor: ToolboxVisualDescriptor, context: VisualContext): Visual
    {
        const svg = this.icons.get(descriptor.Key)
        const template = svg !== undefined
            ? buildIconTemplate(parseSvgIcon(svg), this.ctx)
            : buildDefaultTemplate(this.ctx)
        // Figure-only: nothing binds $Display, the host draws the caption.
        const visual = template.Apply({})
        if (context === VisualContext.Tile && visual instanceof Element) visual.IsHitTestVisible = false
        return visual
    }

    public AddChangedListener(_cb: (key: string) => void): void {}
    public RemoveChangedListener(_cb: (key: string) => void): void {}
}

import { ToolboxPage, ToolboxVisualDescriptor } from '@pragmatic-tech-ai/mural/framework'
import { ArchToolboxItem } from './arch-toolbox-item.js'
import { TodlVisualResolverKey } from './todl-visual-resolver.js'
import { ArchInstanceDropFactoryKey } from '../../architecture-projects/services/arch-instance-drop-factory.js'

// What a library page needs from its host: how to enumerate a library ref's terms,
// and how to learn the library set changed (install / uninstall / publish).
export interface LibraryPageDeps
{
    termsFor(sourceRef: string): ReadonlyArray<{ id: string; label: string }>
    onLibrariesChanged(cb: () => void): () => void
}

// One toolbox page per published library ref. Content trigger: any library change
// (coarse — reconcile-by-key makes an unchanged library a no-op). Visible when the
// active document's ToolboxContexts contains this library's ref.
export class LibraryToolboxPage extends ToolboxPage
{
    private off: (() => void) | undefined

    constructor(
        private readonly sourceRef: string,
        id: string,
        label: string,
        private readonly deps: LibraryPageDeps,
    )
    {
        super(id, label)
        this.Context = sourceRef
    }

    public override attach(): void
    {
        this.off = this.deps.onLibrariesChanged(() => this.refresh())
        this.refresh()
    }

    public override detach(): void
    {
        this.off?.()
        this.off = undefined
    }

    private refresh(): void
    {
        // Library terms key their descriptor on the bare term id (meta-model terms
        // use the `mm:` prefix — see contributeTaxonomy).
        const desired = this.deps.termsFor(this.sourceRef).map((t) =>
            new ArchToolboxItem(
                'term:' + t.id,
                t.label,
                new ToolboxVisualDescriptor(TodlVisualResolverKey, t.id),
                ArchInstanceDropFactoryKey,
            ))
        this.reconcileItems(desired)
    }
}

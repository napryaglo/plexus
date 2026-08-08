// diagram-panel-services.ts — the unified Toolbox: the primary palette for
// visual architecture content.
//
// One global left-panel Capability (rendered by `DataTemplate [DataType =
// ToolboxService]` in diagram.resources.mu). It POPULATES the mural
// ToolboxRepository: mural's built-in *Shapes* page (via ensureToolboxDefaults)
// plus one page per taxonomy an author marked `annotate toolbox { visible = true
// }`, aggregated across every published meta-model and library. Each toolbox item
// carries a visual descriptor resolved by the tile/canvas/preview through the
// shared ToolboxVisualPresenter, and a drop factory key. A term marked `toolbox {
// visible = false }` is dropped from its page.
import {
    Application,
    MetaData,
    Model,
    ObservableCollection,
    ServiceKey,
    type IServiceProvider,
    type ServiceProvider,
} from '@pragmatic-lab/mural/runtime'
import {
    ensureToolboxDefaults,
    ToolboxRepository,
    ToolboxPage,
    ToolboxVisualDescriptor,
    type IActivatable,
} from '@pragmatic-lab/mural/framework'
import type { TodlDocument } from '@pragmatic-lab/todl'

import { PlexusPanelService } from '../../../services/panels/panel-services.js'
import { StorageProviderRegistry } from '../../../services/storage/storage-provider-registry.js'
import type { IStorage } from '../../../services/storage/storage.js'
import { ensureMetaModelsBackend } from '../../meta-model/services/meta-models-backend.js'
import { ensureLibrariesBackend } from '../../library/services/libraries-backend.js'
import { scanPublishedModels } from '../../meta-model/services/meta-model-tree-builder.js'
import { projectToolbox, type ToolboxTaxonomy } from '../../meta-model/services/toolbox-projection.js'
import { ArchToolboxItem } from './arch-toolbox-item.js'
import { LibraryClassVisualResolverKey } from './library-class-visual-resolver.js'
import { ConceptVisualResolverKey, type ConceptVisualResolver } from './concept-visual-resolver.js'
import { ArchInstanceDropFactoryKey } from '../../architecture-projects/services/arch-instance-drop-factory.js'
import { registerArchToolboxAdapters } from './register-arch-toolbox-adapters.js'

// Add one taxonomy's page + items to the repository. Library terms get the
// library-class resolver; meta-model terms the concept resolver (and their icon is
// registered on it). `seen` is caller-owned so a term appearing in more than one
// source is added once. EnsurePage merges terms from repeated taxonomy ids.
export function contributeTaxonomy(
    repo: ToolboxRepository,
    conceptResolver: ConceptVisualResolver,
    tax: ToolboxTaxonomy,
    isLibrary: boolean,
    seen: Set<string>,
): void
{
    const page = repo.EnsurePage(tax.id, tax.label)
    for (const term of tax.terms) {
        if (seen.has(term.id)) continue
        seen.add(term.id)
        const resolverKey = isLibrary ? LibraryClassVisualResolverKey : ConceptVisualResolverKey
        if (!isLibrary) conceptResolver.Register(term.id, term.icon)
        const descriptor = new ToolboxVisualDescriptor(resolverKey, term.id)
        page.Items.Add(new ArchToolboxItem('term:' + term.id, term.label, descriptor, ArchInstanceDropFactoryKey))
    }
}

export class ToolboxService extends PlexusPanelService implements IActivatable
{
    public static readonly Key = new ServiceKey<ToolboxService>('ToolboxService')

    // The palette panel binds `$Pages`; this DP is pointed at the repository's
    // Pages collection on the first reload so the panel reflects it live.
    public static readonly PagesKey = Model.RegisterProperty<ObservableCollection<ToolboxPage>>(
        ToolboxService, 'Pages',
        undefined as unknown as ObservableCollection<ToolboxPage>, MetaData.None)

    private reloadSeq = 0
    private contributedPageIds: string[] = []

    constructor(provider: IServiceProvider)
    {
        super(provider, [])
        this.set_property_value(ToolboxService.PagesKey, new ObservableCollection<ToolboxPage>())
        void this.reload()
    }

    // The mural ToolboxRepository singleton — the drop router and the presenter both
    // key off Application.current.Services, so populate the repository there. Falls
    // back to the injected provider in headless tests without an Application.
    public get Repository(): ToolboxRepository
    {
        return this.services().getRequired(ToolboxRepository.Key)
    }

    public get Pages(): ObservableCollection<ToolboxPage> { return this.get_property_value(ToolboxService.PagesKey) }

    // IActivatable: re-scan whenever the Toolbox becomes the active capability, so
    // a just-published meta-model/library shows up without a restart.
    public OnActivated(): void { void this.reload() }

    // Rebuild the repository's taxonomy pages: ensure the repo + Shapes exist, then
    // replace only our contributed taxonomy pages (leaving mural's Shapes page) with
    // one deduped page per visible taxonomy across all published meta-models +
    // libraries.
    public async reload(): Promise<void>
    {
        const seq = ++this.reloadSeq
        const collected = await this.collectTaxonomies()
        if (seq !== this.reloadSeq) return                                 // a newer reload superseded this one

        const services = this.services()
        ensureToolboxDefaults(services)
        const repo = services.getRequired(ToolboxRepository.Key)
        const conceptResolver = registerArchToolboxAdapters(services)
        this.set_property_value(ToolboxService.PagesKey, repo.Pages)

        for (const pid of this.contributedPageIds) repo.RemovePage(pid)
        this.contributedPageIds = []

        const seen = new Set<string>()
        const pageIds = new Set<string>()
        for (const { tax, isLibrary } of collected) {
            contributeTaxonomy(repo, conceptResolver, tax, isLibrary, seen)
            pageIds.add(tax.id)
        }
        this.contributedPageIds = [...pageIds]
    }

    // Scan the published-content backends into (taxonomy, source) pairs. Overridable
    // seam for tests. Library terms → LibraryClassVisualResolver; meta-model terms →
    // ConceptVisualResolver, chosen from the backend the taxonomy came from.
    protected async collectTaxonomies(): Promise<Array<{ tax: ToolboxTaxonomy; isLibrary: boolean }>>
    {
        const out: Array<{ tax: ToolboxTaxonomy; isLibrary: boolean }> = []
        for (const { backend, isLibrary } of this.sourceBackends()) {
            const models = await scanPublishedModels(backend)
            for (const { id, versions } of models) {
                for (const version of versions) {
                    const doc = await this.readModel(backend, `${id}/${version}`)
                    if (doc === undefined) continue
                    for (const tax of projectToolbox(doc)) out.push({ tax, isLibrary })
                }
            }
        }
        return out
    }

    private services(): ServiceProvider
    {
        return (Application.current?.Services ?? this.Provider) as ServiceProvider
    }

    // The published-content backends to scan, each best-effort: a missing backend
    // (headless, or storage not wired) contributes nothing rather than throwing.
    // Meta-models → concept terms; libraries → library classes.
    private sourceBackends(): Array<{ backend: IStorage; isLibrary: boolean }>
    {
        if (this.Provider.get(StorageProviderRegistry.Key) === undefined) return []
        const out: Array<{ backend: IStorage; isLibrary: boolean }> = []
        try { out.push({ backend: ensureMetaModelsBackend(this.Provider), isLibrary: false }) } catch { /* no meta-models backend */ }
        try { out.push({ backend: ensureLibrariesBackend(this.Provider), isLibrary: true }) } catch { /* no libraries backend */ }
        return out
    }

    private async readModel(backend: IStorage, base: string): Promise<TodlDocument | undefined>
    {
        try { return JSON.parse(await backend.ReadText(`${base}/model.json`)) as TodlDocument }
        catch { return undefined }
    }
}

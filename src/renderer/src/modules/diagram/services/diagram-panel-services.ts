// diagram-panel-services.ts — the unified Toolbox: the primary palette for
// visual architecture content.
//
// One global left-panel Capability (rendered by `DataTemplate [DataType =
// ToolboxService]` in diagram.resources.mu). It presents draggable content as
// pages: a built-in *Shapes* page (the diagram's live ToolboxShapes) plus one
// page per taxonomy an author marked `annotate toolbox { visible = true }`,
// aggregated across every published meta-model and library. A term marked
// `toolbox { visible = false }` is dropped from its page.
import {
    MetaData,
    Model,
    ObservableCollection,
    ServiceKey,
    type IServiceProvider,
} from '@pragmatic-lab/mural/runtime'
import type { IActivatable } from '@pragmatic-lab/mural/framework'
import type { ToolboxShape } from '@pragmatic-lab/mural/framework'
import type { TodlDocument } from '@pragmatic-lab/todl'

import { PlexusPanelService } from '../../../services/panels/panel-services.js'
import { StorageProviderRegistry } from '../../../services/storage/storage-provider-registry.js'
import type { IStorage } from '../../../services/storage/storage.js'
import { ensureMetaModelsBackend } from '../../meta-model/services/meta-models-backend.js'
import { ensureLibrariesBackend } from '../../library/services/libraries-backend.js'
import { scanPublishedModels } from '../../meta-model/services/meta-model-tree-builder.js'
import { projectToolbox } from '../../meta-model/services/toolbox-projection.js'
import { LibraryRegistry } from '../../library/services/library-registry.js'
import { DiagramWorkspaceService } from './diagram-workspace-service.js'
import { ToolboxPage, ToolboxPageKind, TermTile } from './toolbox-page.js'
import { resolveTermTemplate } from './toolbox-term-template.js'

export class ToolboxService extends PlexusPanelService implements IActivatable
{
    public static readonly Key = new ServiceKey<ToolboxService>('ToolboxService')

    public static readonly PagesKey = Model.RegisterProperty<ObservableCollection<ToolboxPage>>(
        ToolboxService, 'Pages',
        undefined as unknown as ObservableCollection<ToolboxPage>, MetaData.None)

    private reloadSeq = 0

    constructor(provider: IServiceProvider)
    {
        super(provider, [])
        this.set_property_value(ToolboxService.PagesKey, new ObservableCollection<ToolboxPage>())
        void this.reload()
    }

    public get Pages(): ObservableCollection<ToolboxPage> { return this.get_property_value(ToolboxService.PagesKey) }

    // IActivatable: re-scan whenever the Toolbox becomes the active capability, so
    // a just-published meta-model/library shows up without a restart.
    public OnActivated(): void { void this.reload() }

    // Rebuild Pages: the Shapes page first, then one deduped page per visible
    // taxonomy across all published meta-models + libraries.
    public async reload(): Promise<void>
    {
        const seq = ++this.reloadSeq

        const shapesPage = this.buildShapesPage()
        const registry = this.Provider.get(LibraryRegistry.Key)
        const byTaxonomy = new Map<string, { page: ToolboxPage; seen: Set<string> }>()

        for (const backend of this.sourceBackends()) {
            const models = await scanPublishedModels(backend)
            for (const { id, versions } of models) {
                for (const version of versions) {
                    const doc = await this.readModel(backend, `${id}/${version}`)
                    if (doc === undefined) continue
                    for (const tax of projectToolbox(doc)) {
                        let entry = byTaxonomy.get(tax.id)
                        if (entry === undefined) {
                            entry = { page: new ToolboxPage(tax.label, ToolboxPageKind.Taxonomy), seen: new Set() }
                            byTaxonomy.set(tax.id, entry)
                        }
                        for (const term of tax.terms) {
                            if (entry.seen.has(term.id)) continue          // dedupe terms across sources
                            entry.seen.add(term.id)
                            const template = resolveTermTemplate(registry, term.id, term.concept, term.label)
                            entry.page.Items.Add(new TermTile(term.id, term.label, term.concept, template))
                        }
                    }
                }
            }
        }

        if (seq !== this.reloadSeq) return                                 // a newer reload superseded this one

        const pages = this.Pages
        pages.Clear()
        pages.Add(shapesPage)
        for (const { page } of byTaxonomy.values()) pages.Add(page)
        this.wireAccordion(pages)
    }

    // Single-expand accordion: opening a section collapses the others, and the
    // first section (Shapes) starts open. Each reload builds fresh ToolboxPage
    // instances, so the listeners are new — nothing to unsubscribe. Setting a
    // sibling false re-enters the listener with IsExpanded === false, which the
    // guard ignores, so there is no cascade.
    private wireAccordion(pages: ObservableCollection<ToolboxPage>): void
    {
        const all = pages.ToArray()
        for (const page of all) {
            page.AddPropertyChangedListener(ToolboxPage.IsExpandedKey, () => {
                if (!page.IsExpanded) return
                for (const other of all) if (other !== page) other.IsExpanded = false
            })
        }
        if (all.length > 0) all[0].IsExpanded = true
    }

    // The built-in Shapes page: a snapshot of the diagram's live ToolboxShapes.
    private buildShapesPage(): ToolboxPage
    {
        const page = new ToolboxPage('Shapes', ToolboxPageKind.Shapes)
        const workspace = this.Provider.get(DiagramWorkspaceService.Key)
        const shapes = workspace?.Document.ToolboxShapes as ObservableCollection<ToolboxShape> | undefined
        if (shapes !== undefined) for (const s of shapes) page.Items.Add(s)
        return page
    }

    // The published-content backends to scan, each best-effort: a missing backend
    // (headless, or storage not wired) contributes nothing rather than throwing.
    private sourceBackends(): IStorage[]
    {
        if (this.Provider.get(StorageProviderRegistry.Key) === undefined) return []
        const out: IStorage[] = []
        try { out.push(ensureMetaModelsBackend(this.Provider)) } catch { /* no meta-models backend */ }
        try { out.push(ensureLibrariesBackend(this.Provider)) } catch { /* no libraries backend */ }
        return out
    }

    private async readModel(backend: IStorage, base: string): Promise<TodlDocument | undefined>
    {
        try { return JSON.parse(await backend.ReadText(`${base}/model.json`)) as TodlDocument }
        catch { return undefined }
    }
}

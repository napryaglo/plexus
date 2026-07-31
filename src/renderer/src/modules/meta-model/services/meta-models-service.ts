// meta-models-service.ts — the Meta-model module's left-panel content service.
// Module-local: registered by the module's `.services:` block and named by its
// Capability's `ServiceKey`. It renders published meta-models as a virtualized
// tree (model id → version → ontology entities), so it owns its own data shape
// (a MetaModelTreeNode forest) and its own `DataTemplate [DataType =
// MetaModelsService]` (meta-model.resources.mu).
//
// It reads the shared meta-models storage backend (where MetaModelProjectFactory
// publishes under `<id>/<modelVersion>/`) and re-scans every time the panel
// becomes active (IActivatable). Version nodes load their entities lazily on
// first expand (see MetaModelTreeNode / meta-model-tree-builder).
import {
    MetaData,
    Model,
    ObservableCollection,
    ServiceBase,
    ServiceKey,
    type IServiceProvider,
    type ResourceDictionary,
    type Visual,
} from '@pragmatic-lab/mural/runtime'
import type { IActivatable } from '@pragmatic-lab/mural/framework'
import { DataTemplate } from '@pragmatic-lab/mural/basic'
import type { TodlDocument } from '@pragmatic-lab/todl'

import { ensureMetaModelsBackend } from './meta-models-backend.js'
import { buildCatalog } from './meta-model-tree-builder.js'
import { loadPresentation } from './presentation-loader.js'
import { buildEntity } from './meta-model-entity-builder.js'
import { MetaModelEntity } from './meta-model-entity.js'
import type { MetaModelTreeNode, EntityRef } from './meta-model-tree-node.js'

export class MetaModelsService extends ServiceBase implements IActivatable
{
    public static readonly Key = new ServiceKey<MetaModelsService>('MetaModelsService')

    public static readonly NodesKey = Model.RegisterProperty<ObservableCollection<MetaModelTreeNode>>(
        MetaModelsService, 'Nodes',
        undefined as unknown as ObservableCollection<MetaModelTreeNode>, MetaData.None)

    // True when nothing has been published yet — drives the empty-state text.
    public static readonly IsEmptyKey = Model.RegisterProperty<boolean>(
        MetaModelsService, 'IsEmpty', false, MetaData.None)

    // The double-clicked entity shown in the drawer, and whether the drawer is
    // open — the panel's Modal SideSheet binds both.
    public static readonly DrawerEntityKey = Model.RegisterProperty<MetaModelEntity | undefined>(
        MetaModelsService, 'DrawerEntity', undefined, MetaData.None)
    public static readonly IsDrawerOpenKey = Model.RegisterProperty<boolean>(
        MetaModelsService, 'IsDrawerOpen', false, MetaData.None)

    // Bumped each reload; a slower earlier scan whose seq is stale is discarded,
    // so overlapping OnActivated/ctor reloads can't clobber the newest result.
    private reloadSeq = 0

    // Presentation dictionaries keyed `modelId@version` — published versions are
    // immutable, so a loaded dict is reusable for the session. Cleared on reload.
    private readonly dictCache = new Map<string, ResourceDictionary>()

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.set_property_value(MetaModelsService.NodesKey, new ObservableCollection<MetaModelTreeNode>())
        void this.reload()
    }

    public get Nodes(): ObservableCollection<MetaModelTreeNode>
    {
        return this.get_property_value(MetaModelsService.NodesKey)
    }

    public get IsEmpty(): boolean { return this.get_property_value(MetaModelsService.IsEmptyKey) }

    public get DrawerEntity(): MetaModelEntity | undefined { return this.get_property_value(MetaModelsService.DrawerEntityKey) }
    public get IsDrawerOpen(): boolean { return this.get_property_value(MetaModelsService.IsDrawerOpenKey) }

    // IActivatable: re-scan whenever this panel becomes the active capability.
    public OnActivated(): void { void this.reload() }

    // Re-read the backend and rebuild the node tree in place (the bound
    // ObservableCollection updates the panel reactively).
    public async reload(): Promise<void>
    {
        const seq = ++this.reloadSeq
        this.dictCache.clear()
        const backend = ensureMetaModelsBackend(this.Provider)
        const built = await buildCatalog(backend, (ref) => { void this.openEntity(ref) })
        if (seq !== this.reloadSeq) return   // a newer reload superseded this one

        const nodes = this.Nodes
        nodes.Clear()
        for (const n of built) nodes.Add(n)
        this.set_property_value(MetaModelsService.IsEmptyKey, built.length === 0)
    }

    // Open the drawer for a double-clicked entity: load-or-cache the version's
    // presentation dictionary, build the entity from model.json, resolve + apply
    // its mm:<id> template, and open. A load/resolve failure still opens the
    // drawer (Presentation undefined → the template shows a note).
    public async openEntity(ref: EntityRef): Promise<void>
    {
        const backend = ensureMetaModelsBackend(this.Provider)
        const base = `${ref.modelId}/${ref.version}`

        let entity: MetaModelEntity
        try
        {
            const doc = JSON.parse(await backend.ReadText(`${base}/model.json`)) as TodlDocument
            entity = buildEntity(doc, ref.id)
        }
        catch
        {
            entity = new MetaModelEntity()
            entity.Id = ref.id
        }

        try
        {
            let dict = this.dictCache.get(base)
            if (dict === undefined)
            {
                dict = await loadPresentation(backend, base)
                this.dictCache.set(base, dict)
            }
            const key = `mm:${ref.id}`
            if (dict.CanResolve(key))
            {
                const tmpl = dict.Resolve(key)
                if (tmpl instanceof DataTemplate) entity.Presentation = tmpl.Apply(entity) as Visual
                else console.warn(`[meta-model] ${key} resolved to a non-DataTemplate:`, tmpl)
            }
            else
            {
                console.warn(`[meta-model] ${key} not found in the presentation dictionary for ${base}`)
            }
        }
        catch (err)
        {
            // Presentation unavailable — degrade to detail-only, but surface why.
            console.warn(`[meta-model] presentation load failed for ${base}:`, err)
        }

        this.set_property_value(MetaModelsService.DrawerEntityKey, entity)
        this.set_property_value(MetaModelsService.IsDrawerOpenKey, true)
    }
}

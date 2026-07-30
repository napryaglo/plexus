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
} from '@pragmatic-lab/mural/runtime'
import type { IActivatable } from '@pragmatic-lab/mural/framework'

import { ensureMetaModelsBackend } from './meta-models-backend.js'
import { buildCatalog } from './meta-model-tree-builder.js'
import type { MetaModelTreeNode } from './meta-model-tree-node.js'

export class MetaModelsService extends ServiceBase implements IActivatable
{
    public static readonly Key = new ServiceKey<MetaModelsService>('MetaModelsService')

    public static readonly NodesKey = Model.RegisterProperty<ObservableCollection<MetaModelTreeNode>>(
        MetaModelsService, 'Nodes',
        undefined as unknown as ObservableCollection<MetaModelTreeNode>, MetaData.None)

    // True when nothing has been published yet — drives the empty-state text.
    public static readonly IsEmptyKey = Model.RegisterProperty<boolean>(
        MetaModelsService, 'IsEmpty', false, MetaData.None)

    // Bumped each reload; a slower earlier scan whose seq is stale is discarded,
    // so overlapping OnActivated/ctor reloads can't clobber the newest result.
    private reloadSeq = 0

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

    // IActivatable: re-scan whenever this panel becomes the active capability.
    public OnActivated(): void { void this.reload() }

    // Re-read the backend and rebuild the node tree in place (the bound
    // ObservableCollection updates the panel reactively).
    public async reload(): Promise<void>
    {
        const seq = ++this.reloadSeq
        const backend = ensureMetaModelsBackend(this.Provider)
        const built = await buildCatalog(backend)
        if (seq !== this.reloadSeq) return   // a newer reload superseded this one

        const nodes = this.Nodes
        nodes.Clear()
        for (const n of built) nodes.Add(n)
        this.set_property_value(MetaModelsService.IsEmptyKey, built.length === 0)
    }
}

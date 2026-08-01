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
import { DialogService, type IActivatable } from '@pragmatic-lab/mural/framework'
import { DataTemplate } from '@pragmatic-lab/mural/basic'
import type { TodlDocument } from '@pragmatic-lab/todl'

import type { IStorage } from '../../../services/storage/storage.js'
import { ConfirmDialogModel } from '../../../services/dialogs/confirm-dialog-model.js'
import { ensureLibrariesBackend } from '../../library/services/libraries-backend.js'
import { discoverLibraries, type LoadedLibrary } from '../../library/services/library-loader.js'
import { ensureMetaModelsBackend } from './meta-models-backend.js'
import { buildCatalog, type DeleteTarget } from './meta-model-tree-builder.js'
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
        const built = await buildCatalog(
            backend,
            (ref) => { void this.openEntity(ref) },
            (t) => { void this.deleteTarget(t) },
        )
        if (seq !== this.reloadSeq) return   // a newer reload superseded this one

        const nodes = this.Nodes
        nodes.Clear()
        for (const n of built) nodes.Add(n)
        this.set_property_value(MetaModelsService.IsEmptyKey, built.length === 0)
    }

    // Delete a published meta-model — one version (`<id>/<version>`) or a whole id
    // (all versions). Warns in the confirm about installed libraries that bind it;
    // headless (no DialogService) proceeds. Cleans an emptied id folder, then
    // reloads so the row disappears.
    public async deleteTarget(target: DeleteTarget): Promise<void>
    {
        const backend = ensureMetaModelsBackend(this.Provider)
        const dialogs = this.Provider.get(DialogService.Key)
        if (dialogs !== undefined)
        {
            const deps = await this.dependentLibraries(target.id, target.version)
            const message = await this.confirmMessage(backend, target, deps)
            const vm = new ConfirmDialogModel(message, 'Delete', (r) => dialogs.Close(r))
            const ok = await dialogs.Show<boolean>({ Title: 'Delete Meta-Model', Content: vm, Width: 440 })
            if (ok !== true) return
        }

        const path = target.version !== undefined ? `${target.id}/${target.version}` : target.id
        await backend.Delete(path)
        if (target.version !== undefined)
        {
            const remaining = (await backend.List(target.id)).filter((e) => e.IsDirectory)
            if (remaining.length === 0) await backend.Delete(target.id)
        }
        await this.reload()
    }

    // Installed libraries bound to this meta-model, by name. Degrades to [] if the
    // libraries store is unavailable.
    private async dependentLibraries(id: string, version?: string): Promise<string[]>
    {
        try
        {
            const libs = await discoverLibraries(ensureLibrariesBackend(this.Provider))
            return dependentLibraryNames(libs, id, version)
        }
        catch { return [] }
    }

    private async confirmMessage(backend: IStorage, target: DeleteTarget, deps: string[]): Promise<string>
    {
        let base: string
        if (target.version !== undefined)
        {
            base = `Delete meta-model "${target.id} ${target.version}"? This removes the published copy.`
        }
        else
        {
            const n = (await backend.List(target.id)).filter((e) => e.IsDirectory).length
            base = `Delete all ${n} version(s) of meta-model "${target.id}"? This removes every published copy.`
        }
        if (deps.length === 0) return base
        return `${base}\n\n${deps.length} installed library(ies) bind to it: ${deps.join(', ')}. `
            + `They'll fail to resolve until rebound. (Architecture projects that bind it aren't tracked here.)`
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

// The names of installed libraries that bind the given meta-model — all versions
// when `version` is omitted, else the exact version. Pure over already-loaded
// libraries.
export function dependentLibraryNames(libs: readonly LoadedLibrary[], id: string, version?: string): string[]
{
    return libs
        .filter((l) => l.metaModel.id === id && (version === undefined || l.metaModel.version === version))
        .map((l) => l.name)
}

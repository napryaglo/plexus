// meta-models-service.ts — the Meta-model module's left-panel content service.
// Module-local: registered by the module's `.services:` block and named by its
// Capability's `ServiceKey`. Unlike the other capability panels it does NOT
// extend the flat PlexusPanelService — it renders published meta-models as a
// group-by-id tree (id header + nested versions), so it owns its own data shape
// and its own `DataTemplate [DataType = MetaModelsService]` (meta-model.resources.mu).
//
// It reads the shared meta-models storage backend (where MetaModelProjectFactory
// publishes to, under `<id>/<modelVersion>/`) and re-scans every time the panel
// becomes active (IActivatable), so a model published this session shows up on
// return.
import {
    MetaData,
    Model,
    ObservableCollection,
    ServiceBase,
    ServiceKey,
    type IServiceProvider,
} from '@pragmatic-lab/mural/runtime';
import type { IActivatable } from '@pragmatic-lab/mural/framework';

import type { IStorage } from '../../../services/storage/storage.js';
import { ensureMetaModelsBackend } from './meta-models-backend.js';

// A published meta-model as plain data: its id and the versions found under it.
// The scan (below) is a pure function of IStorage returning these, so it is unit
// -testable with FakeStorage without constructing the DI-heavy service.
export interface PublishedModel { id: string; versions: string[] }

// Scan the meta-models backend for published models. Layout on disk is
// `<id>/<modelVersion>/…` (see MetaModelProjectFactory.publish), so the root's
// directories are ids and each id's directories are versions. Ids and versions
// are sorted with a numeric-aware compare so 0.9.0 precedes 0.10.0.
export async function scanPublishedModels(storage: IStorage): Promise<PublishedModel[]>
{
    const byName = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });
    const ids = (await storage.List('')).filter((e) => e.IsDirectory).map((e) => e.Name).sort(byName);
    const out: PublishedModel[] = [];
    for (const id of ids)
    {
        const versions = (await storage.List(id)).filter((e) => e.IsDirectory).map((e) => e.Name).sort(byName);
        out.push({ id, versions });
    }
    return out;
}

// One published version row (a leaf under a model id).
export class MetaModelVersionRow extends Model
{
    public static readonly LabelKey = Model.RegisterProperty<string>(
        MetaModelVersionRow, 'Label', '', MetaData.None);

    constructor(label: string)
    {
        super();
        this.set_property_value(MetaModelVersionRow.LabelKey, label);
    }

    public get Label(): string { return this.get_property_value(MetaModelVersionRow.LabelKey); }
}

// One published meta-model (an id) with its versions nested underneath.
export class MetaModelRow extends Model
{
    public static readonly IdKey = Model.RegisterProperty<string>(
        MetaModelRow, 'Id', '', MetaData.None);

    public static readonly VersionsKey = Model.RegisterProperty<ObservableCollection<MetaModelVersionRow>>(
        MetaModelRow, 'Versions',
        undefined as unknown as ObservableCollection<MetaModelVersionRow>, MetaData.None);

    constructor(id: string, versions: readonly string[])
    {
        super();
        this.set_property_value(MetaModelRow.IdKey, id);
        const rows = new ObservableCollection<MetaModelVersionRow>();
        for (const v of versions) rows.Add(new MetaModelVersionRow(v));
        this.set_property_value(MetaModelRow.VersionsKey, rows);
    }

    public get Id(): string { return this.get_property_value(MetaModelRow.IdKey); }
    public get Versions(): ObservableCollection<MetaModelVersionRow>
    {
        return this.get_property_value(MetaModelRow.VersionsKey);
    }
}

export class MetaModelsService extends ServiceBase implements IActivatable
{
    public static readonly Key = new ServiceKey<MetaModelsService>('MetaModelsService');

    public static readonly ModelsKey = Model.RegisterProperty<ObservableCollection<MetaModelRow>>(
        MetaModelsService, 'Models',
        undefined as unknown as ObservableCollection<MetaModelRow>, MetaData.None);

    // True when nothing has been published yet — drives the empty-state text.
    public static readonly IsEmptyKey = Model.RegisterProperty<boolean>(
        MetaModelsService, 'IsEmpty', false, MetaData.None);

    // Bumped each reload; a slower earlier scan whose seq is stale is discarded,
    // so overlapping OnActivated/ctor reloads can't clobber the newest result.
    private reloadSeq = 0;

    constructor(provider: IServiceProvider)
    {
        super(provider);
        this.set_property_value(MetaModelsService.ModelsKey, new ObservableCollection<MetaModelRow>());
        void this.reload();
    }

    public get Models(): ObservableCollection<MetaModelRow>
    {
        return this.get_property_value(MetaModelsService.ModelsKey);
    }

    public get IsEmpty(): boolean { return this.get_property_value(MetaModelsService.IsEmptyKey); }

    // IActivatable: re-scan whenever this panel becomes the active capability.
    public OnActivated(): void { void this.reload(); }

    // Re-read the backend and rebuild the Models tree in place (the bound
    // ObservableCollection updates the panel reactively).
    public async reload(): Promise<void>
    {
        const seq = ++this.reloadSeq;
        const backend = ensureMetaModelsBackend(this.Provider);
        const published = await scanPublishedModels(backend);
        if (seq !== this.reloadSeq) return;   // a newer reload superseded this one

        const models = this.Models;
        models.Clear();
        for (const p of published) models.Add(new MetaModelRow(p.id, p.versions));
        this.set_property_value(MetaModelsService.IsEmptyKey, published.length === 0);
    }
}

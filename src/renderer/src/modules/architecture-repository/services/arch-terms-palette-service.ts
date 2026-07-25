import { DataObject, DragDropEffects, MetaData, Model, ObservableCollection, ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { TOOLBOX_NODE_KIND_FORMAT, type IActivatable } from '@pragmatic-lab/mural/framework'
import type { DataTemplate } from '@pragmatic-lab/mural/basic'

import { LibraryRegistry } from '../../library/services/library-registry.js'

// One draggable palette tile: a published library term. `TermId` is the full
// dotted id (e.g. `stack.azure-openai`) that the drop resolver + reference wiring
// consume; `Display`/`Concept` label it; `Template` is the term's mounted visual
// (the same one the canvas node renders through). Dragging a tile carries the
// term id under the framework's canvas-drop format (TOOLBOX_NODE_KIND_FORMAT) —
// the only payload the Diagram's drop pipeline recognises — via `BeginKindDragData`
// wired to the tile's `OnDragStart`, mirroring ToolboxShape. The canvas's
// ItemDropped handler reads it back and calls applyTermDrop.
export class TermTile extends Model
{
    public static readonly TermIdKey   = Model.RegisterProperty<string>(TermTile, 'TermId', '', MetaData.None)
    public static readonly DisplayKey  = Model.RegisterProperty<string>(TermTile, 'Display', '', MetaData.None)
    public static readonly ConceptKey  = Model.RegisterProperty<string>(TermTile, 'Concept', '', MetaData.None)
    public static readonly TemplateKey = Model.RegisterProperty<DataTemplate>(
        TermTile, 'Template', undefined as unknown as DataTemplate, MetaData.None)
    public static readonly BeginKindDragDataKey = Model.RegisterProperty<(() => { data: DataObject; effects: DragDropEffects }) | undefined>(
        TermTile, 'BeginKindDragData', undefined, MetaData.None)

    constructor(termId: string, display: string, concept: string, template: DataTemplate)
    {
        super()
        this.set_property_value(TermTile.TermIdKey, termId)
        this.set_property_value(TermTile.DisplayKey, display)
        this.set_property_value(TermTile.ConceptKey, concept)
        this.set_property_value(TermTile.TemplateKey, template)
        this.set_property_value(TermTile.BeginKindDragDataKey, () => ({
            data:    new DataObject().Set(TOOLBOX_NODE_KIND_FORMAT, this.TermId),
            effects: DragDropEffects.Copy,
        }))
    }

    public get TermId(): string { return this.get_property_value(TermTile.TermIdKey) }
    public get Display(): string { return this.get_property_value(TermTile.DisplayKey) }
    public get Concept(): string { return this.get_property_value(TermTile.ConceptKey) }
    public get Template(): DataTemplate { return this.get_property_value(TermTile.TemplateKey) }
    public get BeginKindDragData(): (() => { data: DataObject; effects: DragDropEffects }) | undefined {
        return this.get_property_value(TermTile.BeginKindDragDataKey)
    }
}

// The architecture canvas's term palette: every published library term as a
// draggable tile. Mirrors LibrariesPanelService but flattens libraries into one
// tile list and carries the full term id the drop resolver needs. v1 lists all
// published libraries; filtering to a document's bound `libraries[]` is a follow-up.
export class ArchTermsPaletteService extends ServiceBase implements IActivatable
{
    public static readonly Key = new ServiceKey<ArchTermsPaletteService>('ArchTermsPaletteService')

    public static readonly TermsKey = Model.RegisterProperty<ObservableCollection<TermTile>>(
        ArchTermsPaletteService, 'Terms', undefined as unknown as ObservableCollection<TermTile>, MetaData.None)
    public static readonly IsEmptyKey = Model.RegisterProperty<boolean>(ArchTermsPaletteService, 'IsEmpty', true, MetaData.None)

    private reloadSeq = 0

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.set_property_value(ArchTermsPaletteService.TermsKey, new ObservableCollection<TermTile>())
        void this.Reload()
    }

    public get Terms(): ObservableCollection<TermTile> { return this.get_property_value(ArchTermsPaletteService.TermsKey) }
    public get IsEmpty(): boolean { return this.get_property_value(ArchTermsPaletteService.IsEmptyKey) }

    public OnActivated(): void { void this.Reload() }

    public async Reload(): Promise<void>
    {
        const seq = ++this.reloadSeq
        const registry = this.Provider.get(LibraryRegistry.Key)
        if (registry === undefined) return                    // no library backend wired (headless) — empty palette
        const libs = await registry.refresh()
        if (seq !== this.reloadSeq) return

        const tiles = this.Terms
        tiles.Clear()
        for (const lib of libs) {
            for (const cls of lib.classes) {
                const display = cls.label ?? cls.localId ?? cls.id
                tiles.Add(new TermTile(cls.id, display, cls.concept, registry.resolve(cls.id, cls.concept)))
            }
        }
        this.set_property_value(ArchTermsPaletteService.IsEmptyKey, tiles.Count === 0)
    }
}

import { MetaData, Model, ObservableCollection, ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import type { IActivatable } from '@pragmatic-lab/mural/framework'
import type { DataTemplate } from '@pragmatic-lab/mural/basic'

import { LibraryRegistry } from './library-registry.js'

// The data context a class's mounted template binds to ($Display etc.).
export class ClassData extends Model
{
    public static readonly DisplayKey = Model.RegisterProperty<string>(ClassData, 'Display', '', MetaData.None)
    public static readonly LabelKey   = Model.RegisterProperty<string>(ClassData, 'Label', '', MetaData.None)
    public static readonly LocalIdKey = Model.RegisterProperty<string>(ClassData, 'LocalId', '', MetaData.None)
    public static readonly ConceptKey = Model.RegisterProperty<string>(ClassData, 'Concept', '', MetaData.None)

    constructor(display: string, label: string, localId: string, concept: string)
    {
        super()
        this.set_property_value(ClassData.DisplayKey, display)
        this.set_property_value(ClassData.LabelKey, label)
        this.set_property_value(ClassData.LocalIdKey, localId)
        this.set_property_value(ClassData.ConceptKey, concept)
    }

    public get Display(): string { return this.get_property_value(ClassData.DisplayKey) }
}

// One class row: its data context + the DataTemplate to render it with.
export class ClassRow extends Model
{
    public static readonly DataKey     = Model.RegisterProperty<ClassData>(ClassRow, 'Data', undefined as unknown as ClassData, MetaData.None)
    public static readonly TemplateKey = Model.RegisterProperty<DataTemplate>(ClassRow, 'Template', undefined as unknown as DataTemplate, MetaData.None)

    constructor(data: ClassData, template: DataTemplate)
    {
        super()
        this.set_property_value(ClassRow.DataKey, data)
        this.set_property_value(ClassRow.TemplateKey, template)
    }

    public get Data(): ClassData { return this.get_property_value(ClassRow.DataKey) }
    public get Template(): DataTemplate { return this.get_property_value(ClassRow.TemplateKey) }
}

// One library: header + its class rows.
export class LibraryRow extends Model
{
    public static readonly NameKey    = Model.RegisterProperty<string>(LibraryRow, 'Name', '', MetaData.None)
    public static readonly ClassesKey = Model.RegisterProperty<ObservableCollection<ClassRow>>(
        LibraryRow, 'Classes', undefined as unknown as ObservableCollection<ClassRow>, MetaData.None)

    constructor(name: string, classes: ObservableCollection<ClassRow>)
    {
        super()
        this.set_property_value(LibraryRow.NameKey, name)
        this.set_property_value(LibraryRow.ClassesKey, classes)
    }

    public get Name(): string { return this.get_property_value(LibraryRow.NameKey) }
    public get Classes(): ObservableCollection<ClassRow> { return this.get_property_value(LibraryRow.ClassesKey) }
}

// The Libraries capability's panel content: browses all published libraries,
// each class rendered through its mounted template (via LibraryRegistry).
export class LibrariesPanelService extends ServiceBase implements IActivatable
{
    public static readonly Key = new ServiceKey<LibrariesPanelService>('LibrariesPanelService')

    public static readonly LibrariesKey = Model.RegisterProperty<ObservableCollection<LibraryRow>>(
        LibrariesPanelService, 'Libraries', undefined as unknown as ObservableCollection<LibraryRow>, MetaData.None)
    public static readonly IsEmptyKey = Model.RegisterProperty<boolean>(LibrariesPanelService, 'IsEmpty', false, MetaData.None)

    private reloadSeq = 0

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.set_property_value(LibrariesPanelService.LibrariesKey, new ObservableCollection<LibraryRow>())
        void this.Reload()
    }

    public get Libraries(): ObservableCollection<LibraryRow> { return this.get_property_value(LibrariesPanelService.LibrariesKey) }
    public get IsEmpty(): boolean { return this.get_property_value(LibrariesPanelService.IsEmptyKey) }

    public OnActivated(): void { void this.Reload() }

    public async Reload(): Promise<void>
    {
        const seq = ++this.reloadSeq
        const registry = this.Provider.getRequired(LibraryRegistry.Key)
        const libs = await registry.refresh()
        if (seq !== this.reloadSeq) return

        const rows = this.Libraries
        rows.Clear()
        for (const lib of libs) {
            const classRows = new ObservableCollection<ClassRow>()
            for (const cls of lib.classes) {
                const display = cls.label ?? cls.localId ?? cls.id
                const data = new ClassData(display, cls.label ?? '', cls.localId ?? '', cls.concept)
                classRows.Add(new ClassRow(data, registry.resolve(cls.id, cls.concept)))
            }
            rows.Add(new LibraryRow(`${lib.name}  ·  ${lib.version}`, classRows))
        }
        this.set_property_value(LibrariesPanelService.IsEmptyKey, rows.Count === 0)
    }
}

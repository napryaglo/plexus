import {
    MetaData, Model, ObservableCollection, RelayCommand, ServiceBase, ServiceKey,
    type ICommand, type IServiceProvider,
} from '@pragmatic-lab/mural/runtime'
import type { DropAction } from './arch-drop-resolver.js'

// One selectable candidate row. A Model so the .mu template binds $Label / $Command.
export class ChooserRow extends Model
{
    public static readonly LabelKey = Model.RegisterProperty<string>(ChooserRow, 'Label', '', MetaData.None)
    public static readonly CommandKey = Model.RegisterProperty<ICommand | undefined>(ChooserRow, 'Command', undefined, MetaData.None)

    public constructor(label: string, command: ICommand)
    {
        super()
        this.set_property_value(ChooserRow.LabelKey, label)
        this.set_property_value(ChooserRow.CommandKey, command)
    }

    public get Label(): string { return this.get_property_value(ChooserRow.LabelKey) }
    public get Command(): ICommand | undefined { return this.get_property_value(ChooserRow.CommandKey) }
}

// App-scoped popup for the multi-candidate drop case: Show() lists the candidates
// and invokes onPick with the chosen one (click-away leaves it unchosen). The
// .mu chooser.resources popup binds $IsOpen / $Rows against this service.
export class DropCandidateChooserService extends ServiceBase
{
    public static readonly Key = new ServiceKey<DropCandidateChooserService>('DropCandidateChooserService')

    public static readonly IsOpenKey = Model.RegisterProperty<boolean>(DropCandidateChooserService, 'IsOpen', false, MetaData.None)
    public static readonly RowsKey = Model.RegisterProperty<ObservableCollection<ChooserRow>>(
        DropCandidateChooserService, 'Rows', undefined as unknown as ObservableCollection<ChooserRow>, MetaData.None)

    public constructor(provider: IServiceProvider)
    {
        super(provider)
        this.set_property_value(DropCandidateChooserService.RowsKey, new ObservableCollection<ChooserRow>())
    }

    public get IsOpen(): boolean { return this.get_property_value(DropCandidateChooserService.IsOpenKey) }
    public get Rows(): ObservableCollection<ChooserRow> { return this.get_property_value(DropCandidateChooserService.RowsKey) }

    public Show(candidates: DropAction[], onPick: (a: DropAction) => void): void
    {
        const rows = this.Rows
        rows.Clear()
        for (const action of candidates) {
            const row = new ChooserRow(action.label, new RelayCommand(() => { this.close(); onPick(action) }))
            rows.Add(row)
        }
        this.set_property_value(DropCandidateChooserService.IsOpenKey, true)
    }

    private close(): void
    {
        this.set_property_value(DropCandidateChooserService.IsOpenKey, false)
        this.Rows.Clear()
    }
}

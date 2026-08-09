import {
    MetaData, Model, ObservableCollection, RelayCommand, ServiceBase, ServiceKey,
    type ICommand, type IServiceProvider,
} from '@pragmatic-lab/mural/runtime'
import type { INewFileParticipant } from '../../../services/documents/new-file-participant.js'
import type { OpenProject } from '../../../services/projects/open-project.js'
import { ArchitectureModelService } from './architecture-model-service.js'
import { writeDiagramViewpoints } from './diagram-viewpoints.js'

// One selectable viewpoint in the creation picker.
export class PickerRow extends Model
{
    public static readonly LabelKey = Model.RegisterProperty<string>(PickerRow, 'Label', '', MetaData.None)
    public static readonly IsSelectedKey = Model.RegisterProperty<boolean>(PickerRow, 'IsSelected', false, MetaData.None)
    public constructor(label: string) { super(); this.set_property_value(PickerRow.LabelKey, label) }
    public get Label(): string { return this.get_property_value(PickerRow.LabelKey) }
    public get IsSelected(): boolean { return this.get_property_value(PickerRow.IsSelectedKey) }
    public set IsSelected(v: boolean) { this.set_property_value(PickerRow.IsSelectedKey, v) }
}

// A modal multi-select of the project's viewpoints. pick() resolves the chosen
// ids (or undefined on cancel). The .mu picker template binds $Rows / $IsOpen /
// $ConfirmCommand against this service.
export class DiagramViewpointPickerService extends ServiceBase
{
    public static readonly Key = new ServiceKey<DiagramViewpointPickerService>('DiagramViewpointPickerService')

    public static readonly IsOpenKey = Model.RegisterProperty<boolean>(DiagramViewpointPickerService, 'IsOpen', false, MetaData.None)
    public static readonly RowsKey = Model.RegisterProperty<ObservableCollection<PickerRow>>(
        DiagramViewpointPickerService, 'Rows', undefined as unknown as ObservableCollection<PickerRow>, MetaData.None)
    public static readonly ConfirmCommandKey = Model.RegisterProperty<ICommand | undefined>(DiagramViewpointPickerService, 'ConfirmCommand', undefined, MetaData.None)

    private resolve: ((v: string[] | undefined) => void) | undefined

    public constructor(provider: IServiceProvider)
    {
        super(provider)
        this.set_property_value(DiagramViewpointPickerService.RowsKey, new ObservableCollection<PickerRow>())
        this.set_property_value(DiagramViewpointPickerService.ConfirmCommandKey, new RelayCommand(() => this.confirm()))
    }

    public get IsOpen(): boolean { return this.get_property_value(DiagramViewpointPickerService.IsOpenKey) }
    public get Rows(): ObservableCollection<PickerRow> { return this.get_property_value(DiagramViewpointPickerService.RowsKey) }
    public get ConfirmCommand(): ICommand | undefined { return this.get_property_value(DiagramViewpointPickerService.ConfirmCommandKey) }

    public pick(viewpoints: string[]): Promise<string[] | undefined>
    {
        const rows = this.Rows
        rows.Clear()
        for (const v of viewpoints) rows.Add(new PickerRow(v))
        this.set_property_value(DiagramViewpointPickerService.IsOpenKey, true)
        return new Promise((res) => { this.resolve = res })
    }

    private confirm(): void
    {
        const chosen = this.Rows.ToArray().filter((r) => r.IsSelected).map((r) => r.Label)
        this.set_property_value(DiagramViewpointPickerService.IsOpenKey, false)
        this.resolve?.(chosen)
        this.resolve = undefined
    }
}

// The architecture-projects new-file participant: for a new `.diagram` in an
// architecture project, pick viewpoints and record them in the manifest.
export class ArchNewDiagramParticipant extends ServiceBase implements INewFileParticipant
{
    public static readonly Key = new ServiceKey<ArchNewDiagramParticipant>('ArchNewDiagramParticipant')

    public constructor(provider: IServiceProvider) { super(provider) }

    public async OnCreated(op: OpenProject, path: string): Promise<void>
    {
        if (op.Project.Type !== 'architecture' || !path.toLowerCase().endsWith('.diagram')) return
        const model = await this.Provider.getRequired(ArchitectureModelService.Key).modelFor(op)
        const viewpoints = model.viewpoints().map((v) => v.id)
        if (viewpoints.length === 0) return
        const picker = this.Provider.getRequired(DiagramViewpointPickerService.Key)
        const chosen = await picker.pick(viewpoints)
        if (chosen !== undefined && chosen.length > 0) await writeDiagramViewpoints(op.Storage, path, chosen)
    }
}

import {
    MetaData,
    Model,
    ObservableCollection,
    RelayCommand,
    type ICommand,
} from '@pragmatic-lab/mural/runtime'

import type { FileSystemService } from '../file-system/file-system-service.js'
import type { BaseRef } from './base-binding.js'

// The New Project dialog's view-model + its per-type choice model. Rendered by
// DataTemplate[NewProjectDialogModel] / DataTemplate[ProjectTypeChoice]. It is a
// plain Model (not a service): the ProjectExplorerService builds one, hands it a
// `close` callback wired to DialogService.Close, and awaits the result.

export interface NewProjectResult
{
    type:      string
    name:      string
    location:  string
    // The meta-model the project is authored against — present only for a type
    // that RequiresMetaModel (a library today, an architecture later).
    metaModel?: BaseRef
}

// One selectable project type in the picker (always a full list, even with a
// single registered factory). Marker is the selection glyph the VM toggles —
// themable text, no triggers/converters needed.
export class ProjectTypeChoice extends Model
{
    static readonly TypeKey = Model.RegisterProperty<string>(ProjectTypeChoice, 'Type', '', MetaData.None)
    static readonly TitleKey = Model.RegisterProperty<string>(ProjectTypeChoice, 'Title', '', MetaData.None)
    static readonly DescriptionKey = Model.RegisterProperty<string>(ProjectTypeChoice, 'Description', '', MetaData.None)
    static readonly MarkerKey = Model.RegisterProperty<string>(ProjectTypeChoice, 'Marker', '○', MetaData.None)
    static readonly RequiresMetaModelKey = Model.RegisterProperty<boolean>(
        ProjectTypeChoice, 'RequiresMetaModel', false, MetaData.None)
    static readonly SelectCommandKey = Model.RegisterProperty<ICommand | undefined>(
        ProjectTypeChoice, 'SelectCommand', undefined, MetaData.None)

    constructor(type: string, title: string, description: string, requiresMetaModel = false)
    {
        super()
        this.set_property_value(ProjectTypeChoice.TypeKey, type)
        this.set_property_value(ProjectTypeChoice.TitleKey, title)
        this.set_property_value(ProjectTypeChoice.DescriptionKey, description)
        this.set_property_value(ProjectTypeChoice.RequiresMetaModelKey, requiresMetaModel)
    }

    public get Type(): string { return this.get_property_value(ProjectTypeChoice.TypeKey) }
    public get Title(): string { return this.get_property_value(ProjectTypeChoice.TitleKey) }
    public get Description(): string { return this.get_property_value(ProjectTypeChoice.DescriptionKey) }
    public get Marker(): string { return this.get_property_value(ProjectTypeChoice.MarkerKey) }
    public set Marker(v: string) { this.set_property_value(ProjectTypeChoice.MarkerKey, v) }
    public get RequiresMetaModel(): boolean { return this.get_property_value(ProjectTypeChoice.RequiresMetaModelKey) }
    public set RequiresMetaModel(v: boolean) { this.set_property_value(ProjectTypeChoice.RequiresMetaModelKey, v) }
    public get SelectCommand(): ICommand | undefined { return this.get_property_value(ProjectTypeChoice.SelectCommandKey) }
    public set SelectCommand(v: ICommand | undefined) { this.set_property_value(ProjectTypeChoice.SelectCommandKey, v) }
}

// One selectable meta-model in the library picker: a published BaseRef plus a
// human `id @ version` label the combo displays.
export class MetaModelChoice extends Model
{
    static readonly LabelKey = Model.RegisterProperty<string>(MetaModelChoice, 'Label', '', MetaData.None)

    constructor(public readonly Ref: BaseRef)
    {
        super()
        this.set_property_value(MetaModelChoice.LabelKey, `${Ref.id} @ ${Ref.version}`)
    }

    public get Label(): string { return this.get_property_value(MetaModelChoice.LabelKey) }
    public toString(): string { return this.Label }
}

export class NewProjectDialogModel extends Model
{
    static readonly TypesKey = Model.RegisterProperty<ObservableCollection<ProjectTypeChoice>>(
        NewProjectDialogModel, 'Types', undefined as unknown as ObservableCollection<ProjectTypeChoice>, MetaData.None)
    static readonly SelectedTypeKey = Model.RegisterProperty<ProjectTypeChoice | undefined>(
        NewProjectDialogModel, 'SelectedType', undefined, MetaData.None)
    static readonly NameKey = Model.RegisterProperty<string>(NewProjectDialogModel, 'Name', '', MetaData.None)
    static readonly LocationKey = Model.RegisterProperty<string>(NewProjectDialogModel, 'Location', '', MetaData.None)
    static readonly MetaModelsKey = Model.RegisterProperty<ObservableCollection<MetaModelChoice>>(
        NewProjectDialogModel, 'MetaModels', undefined as unknown as ObservableCollection<MetaModelChoice>, MetaData.None)
    static readonly SelectedMetaModelKey = Model.RegisterProperty<MetaModelChoice | undefined>(
        NewProjectDialogModel, 'SelectedMetaModel', undefined, MetaData.None)
    static readonly ShowMetaModelPickerKey = Model.RegisterProperty<boolean>(
        NewProjectDialogModel, 'ShowMetaModelPicker', false, MetaData.None)
    static readonly ErrorKey = Model.RegisterProperty<string>(NewProjectDialogModel, 'Error', '', MetaData.None)
    static readonly CanConfirmKey = Model.RegisterProperty<boolean>(NewProjectDialogModel, 'CanConfirm', false, MetaData.None)
    static readonly BrowseCommandKey = Model.RegisterProperty<ICommand>(
        NewProjectDialogModel, 'BrowseCommand', undefined as unknown as ICommand, MetaData.None)
    static readonly ConfirmCommandKey = Model.RegisterProperty<ICommand>(
        NewProjectDialogModel, 'ConfirmCommand', undefined as unknown as ICommand, MetaData.None)
    static readonly CancelCommandKey = Model.RegisterProperty<ICommand>(
        NewProjectDialogModel, 'CancelCommand', undefined as unknown as ICommand, MetaData.None)

    constructor(
        choices: readonly ProjectTypeChoice[],
        private readonly fs: FileSystemService,
        // Returns an error message to show in-dialog, or null to proceed/close.
        private readonly validate: (result: NewProjectResult) => Promise<string | null>,
        private readonly close: (result?: NewProjectResult) => void,
        // The published meta-models offered when a RequiresMetaModel type is chosen.
        metaModels: readonly BaseRef[] = [],
    )
    {
        super()
        const types = new ObservableCollection<ProjectTypeChoice>()
        for (const c of choices) {
            c.SelectCommand = new RelayCommand(() => this.select(c))
            types.Add(c)
        }
        this.set_property_value(NewProjectDialogModel.TypesKey, types)
        const metas = new ObservableCollection<MetaModelChoice>()
        for (const ref of metaModels) metas.Add(new MetaModelChoice(ref))
        this.set_property_value(NewProjectDialogModel.MetaModelsKey, metas)
        this.set_property_value(NewProjectDialogModel.BrowseCommandKey, new RelayCommand(() => void this.browse()))
        this.set_property_value(NewProjectDialogModel.ConfirmCommandKey, new RelayCommand(() => void this.confirm()))
        this.set_property_value(NewProjectDialogModel.CancelCommandKey, new RelayCommand(() => this.close(undefined)))

        this.AddPropertyChangedListener(NewProjectDialogModel.NameKey, () => this.recompute())
        this.AddPropertyChangedListener(NewProjectDialogModel.LocationKey, () => this.recompute())
        this.AddPropertyChangedListener(NewProjectDialogModel.SelectedMetaModelKey, () => this.recompute())

        if (choices.length > 0) this.select(choices[0])
    }

    public get Types(): ObservableCollection<ProjectTypeChoice> { return this.get_property_value(NewProjectDialogModel.TypesKey) }
    public get SelectedType(): ProjectTypeChoice | undefined { return this.get_property_value(NewProjectDialogModel.SelectedTypeKey) }
    public get Name(): string { return this.get_property_value(NewProjectDialogModel.NameKey) }
    public set Name(v: string) { this.set_property_value(NewProjectDialogModel.NameKey, v) }
    public get Location(): string { return this.get_property_value(NewProjectDialogModel.LocationKey) }
    public set Location(v: string) { this.set_property_value(NewProjectDialogModel.LocationKey, v) }
    public get MetaModels(): ObservableCollection<MetaModelChoice> { return this.get_property_value(NewProjectDialogModel.MetaModelsKey) }
    public get SelectedMetaModel(): MetaModelChoice | undefined { return this.get_property_value(NewProjectDialogModel.SelectedMetaModelKey) }
    public set SelectedMetaModel(v: MetaModelChoice | undefined) { this.set_property_value(NewProjectDialogModel.SelectedMetaModelKey, v) }
    public get ShowMetaModelPicker(): boolean { return this.get_property_value(NewProjectDialogModel.ShowMetaModelPickerKey) }
    public get Error(): string { return this.get_property_value(NewProjectDialogModel.ErrorKey) }
    public get CanConfirm(): boolean { return this.get_property_value(NewProjectDialogModel.CanConfirmKey) }
    public get BrowseCommand(): ICommand { return this.get_property_value(NewProjectDialogModel.BrowseCommandKey) }
    public get ConfirmCommand(): ICommand { return this.get_property_value(NewProjectDialogModel.ConfirmCommandKey) }
    public get CancelCommand(): ICommand { return this.get_property_value(NewProjectDialogModel.CancelCommandKey) }

    // Select a type: mark it, clear the others, toggle the meta-model picker, and
    // refresh confirmability. Selecting a meta-model-requiring type with nothing
    // published surfaces a guiding error.
    private select(choice: ProjectTypeChoice): void
    {
        for (const c of this.Types.ToArray()) c.Marker = c === choice ? '●' : '○'
        this.set_property_value(NewProjectDialogModel.SelectedTypeKey, choice)
        this.set_property_value(NewProjectDialogModel.ShowMetaModelPickerKey, choice.RequiresMetaModel)
        if (choice.RequiresMetaModel && this.MetaModels.Count === 0)
            this.set_property_value(NewProjectDialogModel.ErrorKey, 'Publish a meta-model first.')
        else
            this.set_property_value(NewProjectDialogModel.ErrorKey, '')
        this.recompute()
    }

    private async browse(): Promise<void>
    {
        const folder = await this.fs.OpenFolder({ Title: 'Choose an empty folder for the project' })
        if (folder !== null) this.Location = folder
    }

    private async confirm(): Promise<void>
    {
        if (!this.CanConfirm || this.SelectedType === undefined) return
        const result: NewProjectResult = {
            type: this.SelectedType.Type,
            name: this.Name.trim(),
            location: this.Location,
            // Only a meta-model-requiring type carries a binding.
            ...(this.ShowMetaModelPicker && this.SelectedMetaModel !== undefined
                ? { metaModel: this.SelectedMetaModel.Ref }
                : {}),
        }
        const error = await this.validate(result)
        if (error !== null) { this.set_property_value(NewProjectDialogModel.ErrorKey, error); return }
        this.close(result)
    }

    private recompute(): void
    {
        // A meta-model-requiring type also needs a chosen meta-model before confirm.
        const metaOk = !this.ShowMetaModelPicker || this.SelectedMetaModel !== undefined
        const ok = this.SelectedType !== undefined
            && this.Name.trim().length > 0
            && this.Location.length > 0
            && metaOk
        this.set_property_value(NewProjectDialogModel.CanConfirmKey, ok)
        if (ok) this.set_property_value(NewProjectDialogModel.ErrorKey, '')
    }
}

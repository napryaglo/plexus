import {
    MetaData, MuralBase, RelayCommand, type ICommand,
} from '@pragmatic-lab/mural/runtime'
import { DialogService } from '@pragmatic-lab/mural/framework'

// Content view-model for the "save layout preset" dialog. Rendered by
// DataTemplate[SavePresetPromptModel] (a name field + Cancel/Save). The host
// shows it through DialogService and awaits the typed name: ConfirmCommand
// closes with the trimmed name, CancelCommand closes with undefined (as does a
// scrim/Escape dismiss). Confirm is blocked while the name is blank (CanConfirm
// drives the button's IsEnabled).
export class SavePresetPromptModel extends MuralBase
{
    public static readonly NameKey = MuralBase.RegisterProperty<string>(SavePresetPromptModel, 'Name', '', MetaData.None)
    public static readonly CanConfirmKey = MuralBase.RegisterProperty<boolean>(SavePresetPromptModel, 'CanConfirm', false, MetaData.None)
    public static readonly ConfirmCommandKey = MuralBase.RegisterProperty<ICommand>(
        SavePresetPromptModel, 'ConfirmCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly CancelCommandKey = MuralBase.RegisterProperty<ICommand>(
        SavePresetPromptModel, 'CancelCommand', undefined as unknown as ICommand, MetaData.None)

    public constructor(initial: string, private readonly close: (name: string | undefined) => void)
    {
        super()
        this.set_property_value(SavePresetPromptModel.NameKey, initial)
        this.set_property_value(SavePresetPromptModel.ConfirmCommandKey, new RelayCommand(() => this.confirm()))
        this.set_property_value(SavePresetPromptModel.CancelCommandKey, new RelayCommand(() => this.close(undefined)))
        this.AddPropertyChangedListener(SavePresetPromptModel.NameKey, () => this.recompute())
        this.recompute()
    }

    public get Name(): string { return this.get_property_value(SavePresetPromptModel.NameKey) }
    public set Name(v: string) { this.set_property_value(SavePresetPromptModel.NameKey, v) }
    public get CanConfirm(): boolean { return this.get_property_value(SavePresetPromptModel.CanConfirmKey) }
    public get ConfirmCommand(): ICommand { return this.get_property_value(SavePresetPromptModel.ConfirmCommandKey) }
    public get CancelCommand(): ICommand { return this.get_property_value(SavePresetPromptModel.CancelCommandKey) }

    private recompute(): void
    {
        this.set_property_value(SavePresetPromptModel.CanConfirmKey, this.Name.trim().length > 0)
    }

    private confirm(): void
    {
        const name = this.Name.trim()
        if (name.length === 0) return
        this.close(name)
    }
}

// Open the save-preset prompt as a modal dialog and resolve the typed name (or
// undefined on cancel/dismiss). `initial` pre-fills the field (the currently
// selected preset, for a quick overwrite).
export function promptPresetName(dialogs: DialogService, initial: string): Promise<string | undefined>
{
    const model = new SavePresetPromptModel(initial, (name) => dialogs.Close(name))
    return dialogs.Show<string>({ Title: 'Save layout preset', Content: model, Width: 360 })
}

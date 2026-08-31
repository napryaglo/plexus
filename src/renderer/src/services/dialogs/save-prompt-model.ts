import { MetaData, MuralBase, RelayCommand, type ICommand } from '@pragmatic-lab/mural/runtime'
import type { DialogService } from '@pragmatic-lab/mural/framework'

// A three-way "unsaved changes" prompt view-model. The host shows it through
// DialogService and awaits a SavePromptResult: Save persists then proceeds,
// Don't Save proceeds discarding, Cancel aborts. DialogService resolves
// `undefined` on a scrim/Escape dismiss, which promptSave() maps to Cancel.
// Rendered by DataTemplate[SavePromptModel]; the labels are DPs so the same VM
// serves both tab-close ("Save"/"Don't Save") and quit ("Save All"/"Discard All").
export enum SavePromptResult { Save, DontSave, Cancel }

export class SavePromptModel extends MuralBase
{
    static readonly MessageKey = MuralBase.RegisterProperty<string>(
        SavePromptModel, 'Message', '', MetaData.None)
    static readonly SaveLabelKey = MuralBase.RegisterProperty<string>(
        SavePromptModel, 'SaveLabel', 'Save', MetaData.None)
    static readonly DontSaveLabelKey = MuralBase.RegisterProperty<string>(
        SavePromptModel, 'DontSaveLabel', "Don't Save", MetaData.None)
    static readonly SaveCommandKey = MuralBase.RegisterProperty<ICommand>(
        SavePromptModel, 'SaveCommand', undefined as unknown as ICommand, MetaData.None)
    static readonly DontSaveCommandKey = MuralBase.RegisterProperty<ICommand>(
        SavePromptModel, 'DontSaveCommand', undefined as unknown as ICommand, MetaData.None)
    static readonly CancelCommandKey = MuralBase.RegisterProperty<ICommand>(
        SavePromptModel, 'CancelCommand', undefined as unknown as ICommand, MetaData.None)

    constructor(
        message: string,
        saveLabel: string,
        dontSaveLabel: string,
        private readonly close: (result: SavePromptResult) => void,
    )
    {
        super()
        this.set_property_value(SavePromptModel.MessageKey, message)
        this.set_property_value(SavePromptModel.SaveLabelKey, saveLabel)
        this.set_property_value(SavePromptModel.DontSaveLabelKey, dontSaveLabel)
        this.set_property_value(SavePromptModel.SaveCommandKey, new RelayCommand(() => this.close(SavePromptResult.Save)))
        this.set_property_value(SavePromptModel.DontSaveCommandKey, new RelayCommand(() => this.close(SavePromptResult.DontSave)))
        this.set_property_value(SavePromptModel.CancelCommandKey, new RelayCommand(() => this.close(SavePromptResult.Cancel)))
    }

    public get Message(): string { return this.get_property_value(SavePromptModel.MessageKey) }
    public get SaveLabel(): string { return this.get_property_value(SavePromptModel.SaveLabelKey) }
    public get DontSaveLabel(): string { return this.get_property_value(SavePromptModel.DontSaveLabelKey) }
    public get SaveCommand(): ICommand { return this.get_property_value(SavePromptModel.SaveCommandKey) }
    public get DontSaveCommand(): ICommand { return this.get_property_value(SavePromptModel.DontSaveCommandKey) }
    public get CancelCommand(): ICommand { return this.get_property_value(SavePromptModel.CancelCommandKey) }
}

// Show the prompt and resolve a SavePromptResult. With no DialogService
// (headless/tests) or a scrim dismiss, resolves Cancel — the safe default that
// neither loses work nor forces a close.
export async function promptSave(
    dialogs: DialogService | undefined,
    opts: { title: string; message: string; saveLabel?: string; dontSaveLabel?: string },
): Promise<SavePromptResult>
{
    if (dialogs === undefined) return SavePromptResult.Cancel
    const model = new SavePromptModel(
        opts.message, opts.saveLabel ?? 'Save', opts.dontSaveLabel ?? "Don't Save",
        (r) => dialogs.Close(r))
    const result = await dialogs.Show<SavePromptResult>({ Title: opts.title, Content: model, Width: 400 })
    return result ?? SavePromptResult.Cancel
}

export default SavePromptModel

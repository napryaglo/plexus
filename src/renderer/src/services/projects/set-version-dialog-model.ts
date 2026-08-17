import { MetaData, Model, RelayCommand, type ICommand } from '@pragmatic-lab/mural/runtime'

import { isValidVersion } from './semver-bump.js'

// The Custom… version dialog's view-model. The host shows it through
// DialogService and awaits a SetVersionResult (or undefined on cancel/scrim).
// Rendered by DataTemplate[SetVersionDialogModel]. NewVersion is pre-filled with
// the current version; CanConfirm gates OK on isValidVersion; the Publish
// checkbox asks the host to publish right after setting the version.
export interface SetVersionResult
{
    version: string
    publish: boolean
}

export class SetVersionDialogModel extends Model
{
    static readonly CurrentKey = Model.RegisterProperty<string>(SetVersionDialogModel, 'Current', '', MetaData.None)
    static readonly NewVersionKey = Model.RegisterProperty<string>(SetVersionDialogModel, 'NewVersion', '', MetaData.None)
    static readonly PublishKey = Model.RegisterProperty<boolean>(SetVersionDialogModel, 'Publish', false, MetaData.None)
    static readonly ErrorKey = Model.RegisterProperty<string>(SetVersionDialogModel, 'Error', '', MetaData.None)
    static readonly CanConfirmKey = Model.RegisterProperty<boolean>(SetVersionDialogModel, 'CanConfirm', false, MetaData.None)
    static readonly ConfirmCommandKey = Model.RegisterProperty<ICommand>(
        SetVersionDialogModel, 'ConfirmCommand', undefined as unknown as ICommand, MetaData.None)
    static readonly CancelCommandKey = Model.RegisterProperty<ICommand>(
        SetVersionDialogModel, 'CancelCommand', undefined as unknown as ICommand, MetaData.None)

    constructor(current: string, private readonly close: (result?: SetVersionResult) => void)
    {
        super()
        this.set_property_value(SetVersionDialogModel.CurrentKey, current)
        this.set_property_value(SetVersionDialogModel.NewVersionKey, current)
        this.set_property_value(SetVersionDialogModel.ConfirmCommandKey, new RelayCommand(() => this.confirm()))
        this.set_property_value(SetVersionDialogModel.CancelCommandKey, new RelayCommand(() => this.close(undefined)))
        this.AddPropertyChangedListener(SetVersionDialogModel.NewVersionKey, () => this.recompute())
        this.recompute()
    }

    public get Current(): string { return this.get_property_value(SetVersionDialogModel.CurrentKey) }
    public get NewVersion(): string { return this.get_property_value(SetVersionDialogModel.NewVersionKey) }
    public set NewVersion(v: string) { this.set_property_value(SetVersionDialogModel.NewVersionKey, v) }
    public get Publish(): boolean { return this.get_property_value(SetVersionDialogModel.PublishKey) }
    public set Publish(v: boolean) { this.set_property_value(SetVersionDialogModel.PublishKey, v) }
    public get Error(): string { return this.get_property_value(SetVersionDialogModel.ErrorKey) }
    public get CanConfirm(): boolean { return this.get_property_value(SetVersionDialogModel.CanConfirmKey) }
    public get ConfirmCommand(): ICommand { return this.get_property_value(SetVersionDialogModel.ConfirmCommandKey) }
    public get CancelCommand(): ICommand { return this.get_property_value(SetVersionDialogModel.CancelCommandKey) }

    // Valid → enable OK, clear error. Invalid-and-nonblank → show an error.
    // Blank → disabled but no error (the field is just incomplete).
    private recompute(): void
    {
        const ok = isValidVersion(this.NewVersion)
        this.set_property_value(SetVersionDialogModel.CanConfirmKey, ok)
        const blank = this.NewVersion.trim() === ''
        this.set_property_value(SetVersionDialogModel.ErrorKey, ok || blank ? '' : 'Not a valid version.')
    }

    private confirm(): void
    {
        if (!this.CanConfirm) return
        this.close({ version: this.NewVersion.trim(), publish: this.Publish })
    }
}

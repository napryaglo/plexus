import {
    MetaData,
    Model,
    ObservableCollection,
    RelayCommand,
    type ICommand,
} from '@pragmatic-lab/mural/runtime'

import type { BaseRef } from './base-binding.js'
import { LibraryChoice } from './new-project-dialog-model.js'

// The "Add Library Reference" dialog's view-model. Shown from an open project's
// context menu (for a type that OffersLibraries — an architecture) to bind one or
// more already-published libraries that were not chosen at creation time. The host
// builds one with the published-but-not-yet-bound libraries, awaits the checked
// set through DialogService, and appends it to the manifest's `libraries`.
//
// Reuses LibraryChoice (a two-way `IsSelected` Switch row) so it shares the
// DataTemplate[LibraryChoice] the New-Project libraries picker already renders.
export class AddLibraryReferenceDialogModel extends Model
{
    static readonly LibrariesKey = Model.RegisterProperty<ObservableCollection<LibraryChoice>>(
        AddLibraryReferenceDialogModel, 'Libraries', undefined as unknown as ObservableCollection<LibraryChoice>, MetaData.None)
    // Guidance shown when there is nothing to add (every published library is
    // already bound, or none are published) — the confirm button stays disabled.
    static readonly EmptyLabelKey = Model.RegisterProperty<string>(
        AddLibraryReferenceDialogModel, 'EmptyLabel', '', MetaData.None)
    static readonly CanConfirmKey = Model.RegisterProperty<boolean>(
        AddLibraryReferenceDialogModel, 'CanConfirm', false, MetaData.None)
    static readonly ConfirmCommandKey = Model.RegisterProperty<ICommand>(
        AddLibraryReferenceDialogModel, 'ConfirmCommand', undefined as unknown as ICommand, MetaData.None)
    static readonly CancelCommandKey = Model.RegisterProperty<ICommand>(
        AddLibraryReferenceDialogModel, 'CancelCommand', undefined as unknown as ICommand, MetaData.None)

    constructor(
        // The addable libraries — published and not already bound by this project.
        addable: readonly BaseRef[],
        // Resolves the checked refs on confirm, or undefined on cancel/dismiss.
        private readonly close: (result?: readonly BaseRef[]) => void,
    )
    {
        super()
        const libs = new ObservableCollection<LibraryChoice>()
        for (const ref of addable) {
            const choice = new LibraryChoice(ref)
            choice.AddPropertyChangedListener(LibraryChoice.IsSelectedKey, () => this.recompute())
            libs.Add(choice)
        }
        this.set_property_value(AddLibraryReferenceDialogModel.LibrariesKey, libs)
        this.set_property_value(AddLibraryReferenceDialogModel.EmptyLabelKey,
            addable.length === 0 ? 'Every published library is already referenced.' : '')
        this.set_property_value(AddLibraryReferenceDialogModel.ConfirmCommandKey,
            new RelayCommand(() => this.close(this.SelectedLibraries)))
        this.set_property_value(AddLibraryReferenceDialogModel.CancelCommandKey,
            new RelayCommand(() => this.close(undefined)))
    }

    public get Libraries(): ObservableCollection<LibraryChoice> { return this.get_property_value(AddLibraryReferenceDialogModel.LibrariesKey) }
    public get EmptyLabel(): string { return this.get_property_value(AddLibraryReferenceDialogModel.EmptyLabelKey) }
    public get CanConfirm(): boolean { return this.get_property_value(AddLibraryReferenceDialogModel.CanConfirmKey) }
    public get ConfirmCommand(): ICommand { return this.get_property_value(AddLibraryReferenceDialogModel.ConfirmCommandKey) }
    public get CancelCommand(): ICommand { return this.get_property_value(AddLibraryReferenceDialogModel.CancelCommandKey) }

    // The BaseRefs of the currently-checked libraries (empty when none checked).
    public get SelectedLibraries(): readonly BaseRef[]
    {
        return this.Libraries.ToArray().filter((l) => l.IsSelected).map((l) => l.Ref)
    }

    private recompute(): void
    {
        this.set_property_value(AddLibraryReferenceDialogModel.CanConfirmKey, this.SelectedLibraries.length > 0)
    }
}

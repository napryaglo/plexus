// One row in the Conversations panel's "Stored" (restorable) list: the stored
// record's title + an Open command that reveals/rehydrates it. A class (not the
// bare StoredConversation record) so the row renders through DataTemplate[DataType
// = StoredConversationRow] and carries its own command.
import { MetaData, MuralBase, RelayCommand, type ICommand } from '@pragmatic-lab/mural/runtime'
import type { StoredConversation } from './chat-store.js'

export class StoredConversationRow extends MuralBase
{
    public static readonly TitleKey = MuralBase.RegisterProperty<string>(
        StoredConversationRow, 'Title', '', MetaData.None)
    public static readonly OpenCommandKey = MuralBase.RegisterProperty<ICommand>(
        StoredConversationRow, 'OpenCommand', undefined as unknown as ICommand, MetaData.None)

    public readonly Record: StoredConversation

    constructor(record: StoredConversation, onOpen: (id: string) => void)
    {
        super()
        this.Record = record
        this.set_property_value(StoredConversationRow.TitleKey, record.Title)
        this.set_property_value(StoredConversationRow.OpenCommandKey, new RelayCommand(() => onOpen(record.Id)))
    }

    public get Title(): string { return this.get_property_value(StoredConversationRow.TitleKey) }
    public get OpenCommand(): ICommand { return this.get_property_value(StoredConversationRow.OpenCommandKey) }
}

export default StoredConversationRow

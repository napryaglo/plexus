import { MetaData, MuralBase, RelayCommand, ServiceBase, ServiceKey, type ICommand, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { ContentHostService, DialogService, type DocumentsContentHostService, type IDocument } from '@pragmatic-lab/mural/framework'
import { promptSave, SavePromptResult } from '../dialogs/save-prompt-model.js'

// The host surface the guard needs (a subset of DocumentsContentHostService),
// named so tests can supply a fake without the whole framework service.
export interface CloseGuardHost
{
    OpenDocuments: { ToArray(): IDocument[] }
    Save(doc: IDocument): void | Promise<void>
    Close(doc: IDocument): void
}

// Optional injected seams — production leaves these undefined and resolves the
// real host/DialogService from the provider; tests pass fakes.
export interface CloseGuardDeps
{
    host?: CloseGuardHost
    prompt?: (title: string, message: string, saveLabel: string, dontSaveLabel: string) => Promise<SavePromptResult>
}

// Intercepts every document-close affordance (tab ✕, overflow Close/Close-All,
// Ctrl+W, project close) so a dirty document prompts Save / Don't Save / Cancel
// before it disappears. There is no framework "closing" veto hook, so the tab
// template and other callers are re-pointed at THIS service's commands instead of
// the content host's CloseDocumentCommand. TryClose* return whether the close
// happened (false = user cancelled), so batch closers (Close-All, project close,
// quit) can abort cleanly on the first Cancel.
export class DocumentCloseGuard extends ServiceBase
{
    public static readonly Key = new ServiceKey<DocumentCloseGuard>('DocumentCloseGuard')

    public static readonly CloseDocumentCommandKey = MuralBase.RegisterProperty<ICommand>(
        DocumentCloseGuard, 'CloseDocumentCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly CloseAllCommandKey = MuralBase.RegisterProperty<ICommand>(
        DocumentCloseGuard, 'CloseAllCommand', undefined as unknown as ICommand, MetaData.None)

    public constructor(provider: IServiceProvider, private readonly deps: CloseGuardDeps = {})
    {
        super(provider)
        this.set_property_value(DocumentCloseGuard.CloseDocumentCommandKey, new RelayCommand((id) => {
            const doc = this.host()?.OpenDocuments.ToArray().find((d) => d.Id === id)
            if (doc !== undefined) void this.TryCloseDocument(doc)
        }))
        this.set_property_value(DocumentCloseGuard.CloseAllCommandKey, new RelayCommand(() => void this.TryCloseAll()))
    }

    public get CloseDocumentCommand(): ICommand { return this.get_property_value(DocumentCloseGuard.CloseDocumentCommandKey) }
    public get CloseAllCommand(): ICommand { return this.get_property_value(DocumentCloseGuard.CloseAllCommandKey) }

    // Resolved lazily so registration order is free (mirrors CodeEditorService).
    private host(): CloseGuardHost | undefined
    {
        return this.deps.host ?? (this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined)
    }

    private prompt(title: string, message: string, saveLabel: string, dontSaveLabel: string): Promise<SavePromptResult>
    {
        if (this.deps.prompt !== undefined) return this.deps.prompt(title, message, saveLabel, dontSaveLabel)
        return promptSave(this.Provider.get(DialogService.Key), { title, message, saveLabel, dontSaveLabel })
    }

    public async TryCloseDocument(doc: IDocument): Promise<boolean>
    {
        const host = this.host()
        if (host === undefined) return false
        if (!doc.IsDirty) { host.Close(doc); return true }
        const choice = await this.prompt(
            'Unsaved changes', `"${doc.Title}" has unsaved changes.`, 'Save', "Don't Save")
        if (choice === SavePromptResult.Cancel) return false
        if (choice === SavePromptResult.Save) {
            try { await host.Save(doc) }
            catch { return false }   // save failed → keep the tab open + dirty
        }
        host.Close(doc)
        return true
    }

    public async TryCloseAll(): Promise<boolean>
    {
        const host = this.host()
        if (host === undefined) return false
        for (const doc of host.OpenDocuments.ToArray()) {
            if (!(await this.TryCloseDocument(doc))) return false   // Cancel aborts the batch
        }
        return true
    }
}

export default DocumentCloseGuard

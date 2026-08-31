import { RelayCommand, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { DocumentsContentHostService, type IDocument } from '@pragmatic-lab/mural/framework'
import { DocumentCloseGuard } from './document-close-guard.js'

// The Plexus content host: the framework document host with its USER-INITIATED
// close commands re-pointed through DocumentCloseGuard, so a dirty document
// prompts Save / Don't Save / Cancel before it closes. The framework tab ✕ binds
// ServiceBinding(ContentHostService, "CloseDocumentCommand") and the overflow
// ✕ / Close All bind the same command properties, so overriding just these two
// DP values guards every user close affordance WITHOUT touching a template.
//
// Deliberately NOT overriding the low-level Close(doc): programmatic closes
// (e.g. removing a document while deleting its file, or on project close) must
// stay silent — prompting "save changes?" for a file being deleted would be
// wrong. The guard itself calls Close(doc) to perform the actual removal after
// the user chooses, which is why leaving Close intact also avoids recursion.
//
// The guard is resolved lazily at click time (not in the constructor) so this
// host has no construction-order dependency on the guard's registration.
export class PlexusDocumentHost extends DocumentsContentHostService
{
    public constructor(provider: IServiceProvider)
    {
        super(provider)
        const guard = (): DocumentCloseGuard | undefined => provider.get(DocumentCloseGuard.Key)
        this.set_property_value(DocumentsContentHostService.CloseDocumentCommandKey, new RelayCommand(
            (id) => { const doc = this.byId(id); if (doc !== undefined) void guard()?.TryCloseDocument(doc) },
            undefined, { Text: 'Close', Description: 'Close this document.' }))
        this.set_property_value(DocumentsContentHostService.CloseAllCommandKey, new RelayCommand(
            () => void guard()?.TryCloseAll(),
            undefined, { Text: 'Close All', Description: 'Close all open documents.' }))
    }

    private byId(id: unknown): IDocument | undefined
    {
        return typeof id === 'string'
            ? this.OpenDocuments.ToArray().find((d) => d.Id === id)
            : undefined
    }
}

export default PlexusDocumentHost

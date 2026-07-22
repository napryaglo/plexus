import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import type { IDocument } from '@pragmatic-lab/mural/framework'

import type { IDocumentFactory, IRelocatableDocumentFactory } from '../../../services/documents/document-factory.js'
import type { IStorage } from '../../../services/storage/storage.js'
import { CodeDocument } from '../../code-editor/code-document.js'
import { StorageCodeFile } from '../../code-editor/code-file.js'
import { TodlValidationService } from '../../../services/todl/todl-validation-service.js'

// The `.todl` editor: a definition file is plain-text TODL edited in the Monaco
// CodeEditor (a CodeDocument over the project's IStorage). Contributed as the
// DocumentDefinition.Factory for the meta-model module's `.documents:` entry; the
// ProjectExplorerService resolves it by the `.todl` extension and delegates.
export class TodlDocumentFactory extends ServiceBase implements IDocumentFactory, IRelocatableDocumentFactory
{
    public static readonly Key = new ServiceKey<TodlDocumentFactory>('TodlDocumentFactory')

    constructor(provider: IServiceProvider) { super(provider) }

    public async openFile(storage: IStorage, path: string): Promise<IDocument>
    {
        // A .todl file is a CodeDocument over the project storage; its language
        // resolves to 'todl' from the extension. The project-relative path is the
        // document's Id — what whole-project validation keys diagnostics by.
        const doc = new CodeDocument(new StorageCodeFile(storage, path))
        // Register the document + its project storage with the validator so it
        // gets live squiggles within its own project's file set. Optional (`get`,
        // not `getRequired`) — absent in unit tests.
        this.Provider.get(TodlValidationService.Key)?.AttachDocument(doc, storage)
        return doc
    }

    public async saveFile(document: IDocument): Promise<void>
    {
        await (document as CodeDocument).Save()
    }

    // Re-point an open .todl document after its file was renamed on storage: the
    // CodeDocument re-targets its StorageCodeFile and refreshes Id/Title/Language.
    // The validator tracks the document by instance and reads its Id live, so no
    // re-registration is needed.
    public relocateOpenFile(document: IDocument, newPath: string): void
    {
        (document as CodeDocument).Relocate(newPath)
    }

    // Cross-project move: re-point the document at the target project's storage +
    // path (tab stays open) and re-attach it to the validator under that storage,
    // so it validates against the new project's bases.
    public relocateAcrossStorage(document: IDocument, storage: IStorage, newPath: string): void
    {
        (document as CodeDocument).RelocateTo(storage, newPath)
        this.Provider.get(TodlValidationService.Key)?.ReattachDocument(document as CodeDocument, storage)
    }

    public async newFile(storage: IStorage, name: string): Promise<string>
    {
        const path = ensureExtension(name, '.todl')   // project-relative, at the root
        await storage.WriteText(path, '')
        return path
    }
}

function ensureExtension(name: string, ext: string): string
{
    return name.toLowerCase().endsWith(ext) ? name : name + ext
}

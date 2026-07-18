import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { ContentHostService } from '@pragmatic-lab/mural/framework'
import type { DocumentsContentHostService } from '@pragmatic-lab/mural/framework'
import { FileSystemService } from '../../services/file-system/file-system-service.js'
import { CodeDocument } from './code-document.js'
import { FileSystemCodeFile } from './code-file.js'

// Opens files as Monaco-backed code documents in the shell's content host.
// Dedupes by path so re-opening a file re-activates its existing tab rather than
// stacking duplicates (and preserves its editor + undo history).
export class CodeEditorService extends ServiceBase
{
    public static readonly Key = new ServiceKey<CodeEditorService>('CodeEditorService')

    private readonly open = new Map<string, CodeDocument>()

    constructor(provider: IServiceProvider) { super(provider) }

    private get fs(): FileSystemService
    {
        return this.Provider.getRequired(FileSystemService.Key)
    }

    private get host(): DocumentsContentHostService
    {
        return this.Provider.getRequired(ContentHostService.Key) as DocumentsContentHostService
    }

    // Open (or re-activate) `path` as a code-document tab.
    public OpenFile(path: string): void
    {
        let doc = this.open.get(path)
        if (doc === undefined)
        {
            doc = new CodeDocument(new FileSystemCodeFile(this.fs, path))
            this.open.set(path, doc)
        }
        this.host.Open(doc)
    }
}

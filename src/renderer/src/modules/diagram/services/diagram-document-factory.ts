import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { DiagramDocument, type IDocument } from '@pragmatic-lab/mural/framework'

import type { IDocumentFactory, IRelocatableDocumentFactory } from '../../../services/documents/document-factory.js'
import type { IStorage } from '../../../services/storage/storage.js'
import { FileDiagramStorage } from '../persistence/file-diagram-storage.js'

// The `.diagram` editor: a diagram file is a DiagramDocument persisted through
// mural's native Save()/Load() over a FileDiagramStorage (the full scene
// round-trips). Contributed as the DocumentDefinition.Factory for the diagram
// module's `.documents:` entry; the ProjectExplorerService resolves it by the
// `.diagram` extension and delegates. All persistence flows through the
// project's IStorage (rooted, project-relative paths).
export class DiagramDocumentFactory extends ServiceBase implements IDocumentFactory, IRelocatableDocumentFactory
{
    public static readonly Key = new ServiceKey<DiagramDocumentFactory>('DiagramDocumentFactory')

    constructor(provider: IServiceProvider) { super(provider) }

    public async openFile(storage: IStorage, path: string): Promise<IDocument>
    {
        const text = await storage.ReadText(path)
        const store = new FileDiagramStorage(path, storage, text)
        const doc = new DiagramDocument(store)
        doc.Load()
        doc.Title = basename(path)
        return doc
    }

    public async saveFile(document: IDocument): Promise<void>
    {
        const doc = document as DiagramDocument
        doc.Save()
        const store = doc.Storage
        if (store instanceof FileDiagramStorage) await store.WhenWritten()
    }

    // Re-point an open diagram after its file was renamed on storage: re-target
    // the FileDiagramStorage (so later Save()s write to the new path) and retitle
    // the tab. The in-memory scene is untouched.
    public relocateOpenFile(document: IDocument, newPath: string): void
    {
        const doc = document as DiagramDocument
        const store = doc.Storage
        if (store instanceof FileDiagramStorage) store.Path = newPath
        doc.Title = basename(newPath)
    }

    public async newFile(storage: IStorage, name: string): Promise<string>
    {
        const path = ensureExtension(name, '.diagram')   // project-relative, at the root
        const store = new FileDiagramStorage(path, storage, null)
        const doc = new DiagramDocument(store)
        doc.Save()   // writes an empty scene
        await store.WhenWritten()
        return path
    }
}

function basename(p: string): string
{
    const parts = p.split(/[\\/]/)
    return parts[parts.length - 1] || p
}

function ensureExtension(name: string, ext: string): string
{
    return name.toLowerCase().endsWith(ext) ? name : name + ext
}

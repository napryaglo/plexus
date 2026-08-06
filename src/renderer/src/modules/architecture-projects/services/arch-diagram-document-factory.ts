import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import type { IDocument } from '@pragmatic-lab/mural/framework'

import type { IDocumentFactory } from '../../../services/documents/document-factory.js'
import type { IStorage } from '../../../services/storage/storage.js'
import { WorkspaceBaseResolver } from '../../../services/projects/workspace-base-resolver.js'
import { LibraryRegistry } from '../../library/services/library-registry.js'
import { ArchInstanceModel } from './architecture-instance-model.js'
import { ArchDiagramDocument, type ArchLayout } from './arch-diagram-document.js'

// The `.archdiagram` editor: an architecture-diagram file pairs a layout sidecar
// (positions) with a sibling `.todl` (the emitted instance semantics). Open loads
// the project's bases + the `.todl` into an ArchInstanceModel; save emits the
// `.todl` + writes the layout. Contributed as the architecture module's
// `.documents:` factory, resolved by the `.archdiagram` extension.
export class ArchDiagramDocumentFactory extends ServiceBase implements IDocumentFactory
{
    public static readonly Key = new ServiceKey<ArchDiagramDocumentFactory>('ArchDiagramDocumentFactory')

    constructor(provider: IServiceProvider) { super(provider) }

    public async openFile(storage: IStorage, path: string): Promise<IDocument>
    {
        const layoutDoc = JSON.parse(await storage.ReadText(path)) as ArchLayout
        const { bases } = await this.Provider.getRequired(WorkspaceBaseResolver.Key).ResolveForStorage(storage)
        const source = (await storage.Exists(layoutDoc.todlFile)) ? await storage.ReadText(layoutDoc.todlFile) : ''
        const model = ArchInstanceModel.load(bases, source, layoutDoc.namespace)
        const registry = this.Provider.get(LibraryRegistry.Key)
        // Ensure the registry has discovered its libraries so the diagram's nodes
        // can resolve (and lazily compile) their class visuals — independent of
        // whether the Libraries panel was ever opened. Cheap: metadata only.
        await registry?.discover()
        return new ArchDiagramDocument(path, model, storage, layoutDoc.todlFile, layoutDoc.layout ?? {}, basename(path), registry)
    }

    public async saveFile(document: IDocument): Promise<void>
    {
        await (document as ArchDiagramDocument).Save()
    }

    public async newFile(storage: IStorage, name: string): Promise<string>
    {
        const base = name.replace(/\.archdiagram$/i, '')
        const path = `${base}.archdiagram`
        const layout: ArchLayout = { namespace: base, todlFile: `${base}.todl`, layout: {}, version: 1 }
        await storage.WriteText(path, JSON.stringify(layout, null, 2))
        await storage.WriteText(layout.todlFile, `namespace ${base}\n{\n}\n`)
        return path
    }
}

function basename(p: string): string { const s = p.split(/[\\/]/); return s[s.length - 1] || p }

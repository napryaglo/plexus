import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import type { IDocument } from '@pragmatic-lab/mural/framework'

import type { IDocumentFactory } from '../../../services/documents/document-factory.js'
import type { IStorage } from '../../../services/storage/storage.js'
import { PROJECT_MANIFEST_FILENAME } from '../../../services/projects/project-factory.js'
import type { BaseBindings } from '../../../services/projects/base-binding.js'
import { resolveBases } from '../../../services/projects/base-resolver.js'
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
        const { bases } = await resolveBases(this.Provider, await this.bindings(storage))
        const source = (await storage.Exists(layoutDoc.todlFile)) ? await storage.ReadText(layoutDoc.todlFile) : ''
        const model = ArchInstanceModel.load(bases, source, layoutDoc.namespace)
        const registry = this.Provider.get(LibraryRegistry.Key)
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

    private async bindings(storage: IStorage): Promise<BaseBindings>
    {
        try {
            const m = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as BaseBindings
            return { metaModel: m.metaModel, libraries: m.libraries }
        } catch { return {} }
    }
}

function basename(p: string): string { const s = p.split(/[\\/]/); return s[s.length - 1] || p }

import { ServiceBase, ServiceKey, ServiceProvider, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import type { IDocument } from '@pragmatic-lab/mural/framework'

import type { IDocumentFactory } from '../../../services/documents/document-factory.js'
import type { IStorage } from '../../../services/storage/storage.js'
import { WorkspaceBaseResolver } from '../../../services/projects/workspace-base-resolver.js'
import { ArchInstanceModel } from './architecture-instance-model.js'
import { ArchDiagramDocument, type ArchLayout } from './arch-diagram-document.js'
import { registerArchToolboxAdapters } from '../../diagram/services/register-arch-toolbox-adapters.js'
import { TodlPresentationRegistry } from '../../diagram/services/todl-presentation-registry.js'

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
        // Register the presentation sources + resolver, then discover, so the
        // diagram's nodes resolve their visuals through the shared TodlVisualResolver
        // / TodlPresentationRegistry — independent of whether the Libraries or
        // Meta-models panels were ever opened. LibraryPresentationSource (registered
        // here via registerArchToolboxAdapters) calls LibraryRegistry.discover()
        // internally through its thunk, so no separate direct discover() is needed.
        registerArchToolboxAdapters(this.Provider as ServiceProvider)
        await this.Provider.get(TodlPresentationRegistry.Key)?.discover()
        return new ArchDiagramDocument(path, model, storage, layoutDoc.todlFile, layoutDoc.layout ?? {}, basename(path))
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

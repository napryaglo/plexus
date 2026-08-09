import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { ContentHostService, DiagramDocument, type DocumentsContentHostService, type IDocument } from '@pragmatic-lab/mural/framework'

import { FileDiagramStorage } from '../../diagram/persistence/file-diagram-storage.js'
import { ProjectExplorerService } from '../../project-explorer/services/project-explorer-service.js'
import type { OpenProject } from '../../../services/projects/open-project.js'
import { ArchitectureModelService } from './architecture-model-service.js'
import { ArchDiagramBinding } from './arch-diagram-binding.js'
import type { ArchModel } from './arch-model.js'

// App-scoped observer: watches the open-documents set and, for each opened
// DiagramDocument whose owning project is an architecture project, attaches an
// ArchDiagramBinding against that project's ArchModel; disposes it on close.
// The generic diagram is untouched — a standalone diagram simply has no binding.
export class ArchDiagramBindingService extends ServiceBase
{
    public static readonly Key = new ServiceKey<ArchDiagramBindingService>('ArchDiagramBindingService')

    private readonly bindings = new Map<IDocument, ArchDiagramBinding>()
    private readonly attaching = new Set<IDocument>()

    public constructor(provider: IServiceProvider)
    {
        super(provider)
        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        host?.OpenDocuments.Subscribe(() => { void this.sync(host) })
    }

    private async sync(host: DocumentsContentHostService): Promise<void>
    {
        const current = new Set(host.OpenDocuments.ToArray())

        // Closed documents: dispose + forget.
        for (const [doc, binding] of [...this.bindings]) {
            if (!current.has(doc)) {
                binding.dispose()
                this.bindings.delete(doc)
            }
        }

        // Newly opened architecture diagrams: attach.
        for (const doc of current) {
            if (this.bindings.has(doc) || this.attaching.has(doc)) continue
            if (!(doc instanceof DiagramDocument)) continue
            const op = this.projectFor(doc)
            if (op === undefined) continue
            this.attaching.add(doc)
            try {
                const model = await this.Provider.getRequired(ArchitectureModelService.Key).modelFor(op)
                if (host.OpenDocuments.ToArray().includes(doc)) {
                    const binding = new ArchDiagramBinding(doc, model)
                    binding.attach()
                    this.bindings.set(doc, binding)
                }
            } finally {
                this.attaching.delete(doc)
            }
        }
    }

    // The ArchModel bound to an open document, if it is an attached architecture
    // diagram. Used by the drop factory to route a term-drop.
    public modelForDocument(doc: IDocument): ArchModel | undefined
    {
        return this.bindings.get(doc)?.model
    }

    // The architecture OpenProject that owns this diagram's storage, if any.
    private projectFor(doc: DiagramDocument): OpenProject | undefined
    {
        const store = doc.Storage
        if (!(store instanceof FileDiagramStorage)) return undefined
        const explorer = this.Provider.get(ProjectExplorerService.Key)
        if (explorer === undefined) return undefined
        for (const op of explorer.OpenProjects.ToArray()) {
            if (op.Storage === store.ProjectStorage && op.Project.Type === 'architecture') return op
        }
        return undefined
    }
}

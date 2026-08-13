import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-lab/mural/runtime'
import { ContentHostService, DiagramDocument, type DocumentsContentHostService, type IDocument } from '@pragmatic-lab/mural/framework'

import { FileDiagramStorage } from '../../diagram/persistence/file-diagram-storage.js'
import { ProjectExplorerService } from '../../project-explorer/services/project-explorer-service.js'
import type { OpenProject } from '../../../services/projects/open-project.js'
import { ArchitectureModelService } from './architecture-model-service.js'
import { ArchDiagramBinding } from './arch-diagram-binding.js'
import type { ArchModel } from './arch-model.js'
import { loadViewpoints, writeViewpoints } from './arch-diagram-viewpoints-store.js'
import { nodesLeavingScope, type LeavingNode } from './viewpoint-scope-reconcile.js'
import { registerArchNodeSerializer } from './arch-node-serializer.js'

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
        registerArchNodeSerializer()
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
        for (const doc of current) await this.attachDoc(host, doc)
    }

    // Attach a binding to one document if it is an open architecture diagram that
    // isn't already bound (or mid-attach). Idempotent; safe to call repeatedly.
    private async attachDoc(host: DocumentsContentHostService, doc: IDocument): Promise<void>
    {
        if (this.bindings.has(doc) || this.attaching.has(doc)) return
        if (!(doc instanceof DiagramDocument)) return
        const op = this.projectFor(doc)
        if (op === undefined) return
        this.attaching.add(doc)
        try {
            const model = await this.Provider.getRequired(ArchitectureModelService.Key).modelFor(op)
            if (host.OpenDocuments.ToArray().includes(doc)) {
                const binding = new ArchDiagramBinding(doc, model)
                binding.attach()
                const store = doc.Storage
                if (store instanceof FileDiagramStorage) {
                    // Governing viewpoints travel with the diagram (its metadata),
                    // falling back to the legacy manifest for older diagrams.
                    const vps = await loadViewpoints(doc, store.ProjectStorage, store.Path)
                    if (vps !== undefined) binding.setScope(vps)
                }
                this.bindings.set(doc, binding)
            }
        } finally {
            this.attaching.delete(doc)
        }
    }

    // Ensure a document is bound before a caller acts on its binding — closes the
    // gap between opening a diagram and the OpenDocuments subscription attaching
    // it. A no-op for a non-architecture or already-bound document.
    public async ensureBound(doc: IDocument): Promise<void>
    {
        if (this.bindings.has(doc)) return
        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        if (host !== undefined) await this.attachDoc(host, doc)
    }

    // The ArchModel bound to an open document, if it is an attached architecture
    // diagram. Used by the drop factory to route a term-drop.
    public modelForDocument(doc: IDocument): ArchModel | undefined
    {
        return this.bindings.get(doc)?.model
    }

    // The selected-viewpoint scope of an attached architecture diagram.
    public scopeForDocument(doc: IDocument): Set<string> | undefined
    {
        return this.bindings.get(doc)?.scopeSet()
    }

    // The nodes that would leave scope if this diagram were re-scoped to
    // `viewpoints` — for the caller to list in a confirmation before committing.
    // Empty when the document isn't a bound architecture diagram.
    public nodesLeavingScope(doc: IDocument, viewpoints: string[]): LeavingNode[]
    {
        const binding = this.bindings.get(doc)
        if (binding === undefined) return []
        return nodesLeavingScope(doc as DiagramDocument, binding.model, viewpoints)
    }

    // Narrow (or widen) a diagram's scope: drop the nodes that fall out of the
    // new scope, update the binding, persist the selection into the diagram's
    // metadata (so it travels with the file and restores on open), and re-notify
    // so any live view refreshes. The caller confirms node removal beforehand.
    public async setDocumentScope(doc: IDocument, viewpoints: string[]): Promise<void>
    {
        const binding = this.bindings.get(doc)
        if (binding === undefined) return
        const diagram = doc as DiagramDocument
        const leaving = nodesLeavingScope(diagram, binding.model, viewpoints)
        if (leaving.length > 0) diagram.DeleteNodes(leaving.map((l) => l.node))
        binding.setScope(viewpoints)
        writeViewpoints(diagram, viewpoints)
        diagram.Save()
        const store = diagram.Storage
        if (store instanceof FileDiagramStorage) await store.WhenWritten()
        binding.model.notifyChanged()
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

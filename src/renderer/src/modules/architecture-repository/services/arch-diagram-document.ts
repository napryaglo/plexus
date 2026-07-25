import { MetaData, Model, ObservableCollection } from '@pragmatic-lab/mural/runtime'
import type { IDocument } from '@pragmatic-lab/mural/framework'
import type { DataTemplate } from '@pragmatic-lab/mural/basic'

import type { IStorage } from '../../../services/storage/storage.js'
import type { LibraryRegistry } from '../../library/services/library-registry.js'
import type { ArchInstanceModel } from './architecture-instance-model.js'
import { InstanceNodeVM } from './instance-node-vm.js'

// The on-disk shape of a `.archdiagram` file: the layout (positions) + the
// pointer to the sibling `.todl` that holds the semantics.
export interface ArchLayout
{
    namespace: string
    todlFile:  string
    layout:    Record<string, { x: number; y: number }>
    version:   number
}

// An architecture-diagram document (a tab). The TODL instance model is the source
// of truth; this document adds node view-models + their canvas positions. Save
// emits the `.todl` (validated by the existing pipeline) and writes the layout.
export class ArchDiagramDocument extends Model implements IDocument
{
    public static readonly TitleKey = Model.RegisterProperty<string>(ArchDiagramDocument, 'Title', '', MetaData.None)

    public readonly Nodes = new ObservableCollection<InstanceNodeVM>()
    private readonly positions = new Map<string, { x: number; y: number }>()
    private dirty = false

    constructor(
        public readonly Id: string,               // the .archdiagram project-relative path
        public readonly Model: ArchInstanceModel,
        public readonly storage: IStorage,
        public readonly todlFile: string,
        layout: Record<string, { x: number; y: number }>,
        title: string,
        private readonly registry?: LibraryRegistry,
    )
    {
        super()
        this.set_property_value(ArchDiagramDocument.TitleKey, title)
        for (const [id, p] of Object.entries(layout)) this.positions.set(id, p)
        for (const id of Model.ownInstances()) this.AddNode(id)
        Model.onChanged(() => { this.dirty = true })
    }

    public get Title(): string { return this.get_property_value(ArchDiagramDocument.TitleKey) }
    public get IsDirty(): boolean { return this.dirty }

    // The visual template for a node — its referenced term's template (else its
    // concept), resolved through the LibraryRegistry (which returns the default box
    // when nothing is mounted). Undefined only when no registry is wired.
    public ResolveTemplate(vm: InstanceNodeVM): DataTemplate | undefined
    {
        const key = vm.ReferencedTerm !== '' ? vm.ReferencedTerm : vm.Concept
        return this.registry?.resolve(key, vm.Concept)
    }

    public LayoutOf(id: string): { x: number; y: number } | undefined { return this.positions.get(id) }
    public SetLayout(id: string, x: number, y: number): void { this.positions.set(id, { x, y }); this.dirty = true }

    // Materialise a node VM for an instance id (on open + on drop-create).
    public AddNode(id: string): InstanceNodeVM
    {
        const vm = new InstanceNodeVM(this.Model, id)
        this.Nodes.Add(vm)
        return vm
    }

    public async Save(): Promise<void>
    {
        await this.storage.WriteText(this.todlFile, this.Model.emit())
        const doc: ArchLayout = {
            namespace: this.Model.namespace,
            todlFile:  this.todlFile,
            layout:    Object.fromEntries(this.positions),
            version:   1,
        }
        await this.storage.WriteText(this.Id, JSON.stringify(doc, null, 2))
        this.dirty = false
    }
}

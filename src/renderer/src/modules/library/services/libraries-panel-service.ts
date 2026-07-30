import { MetaData, Model, ObservableCollection, RelayCommand, ServiceBase, ServiceKey, type IServiceProvider, type PropertyDescriptor } from '@pragmatic-lab/mural/runtime'
import { DialogService, type IActivatable } from '@pragmatic-lab/mural/framework'
import type { DataTemplate } from '@pragmatic-lab/mural/basic'

import { LibraryRegistry } from './library-registry.js'
import { LibraryTreeNode, LibraryNodeKind } from './library-tree-node.js'
import { ConfirmDialogModel } from '../../../services/dialogs/confirm-dialog-model.js'

// The Libraries capability's panel content: a TreeView of published libraries
// grouped Library -> Concept -> Class. Class leaves are draggable onto the
// architecture canvas (via the term payload on the node) and, when selected,
// drive a preview pane docked at the bottom of the panel (the class's mounted
// visual + its concept). The preview is panel-level (not per-row) because the
// tree's list rows are fixed-height and can't host tall inline content.
export class LibrariesPanelService extends ServiceBase implements IActivatable
{
    public static readonly Key = new ServiceKey<LibrariesPanelService>('LibrariesPanelService')

    public static readonly RootsKey = Model.RegisterProperty<ObservableCollection<LibraryTreeNode>>(
        LibrariesPanelService, 'Roots', undefined as unknown as ObservableCollection<LibraryTreeNode>, MetaData.None)
    public static readonly SelectedNodeKey = Model.RegisterProperty<LibraryTreeNode | undefined>(
        LibrariesPanelService, 'SelectedNode', undefined, MetaData.None)
    public static readonly IsEmptyKey = Model.RegisterProperty<boolean>(LibrariesPanelService, 'IsEmpty', false, MetaData.None)

    // Bottom preview pane, driven by the selected class leaf.
    public static readonly PreviewDataKey = Model.RegisterProperty<LibraryTreeNode | undefined>(
        LibrariesPanelService, 'PreviewData', undefined, MetaData.None)
    public static readonly PreviewTemplateKey = Model.RegisterProperty<DataTemplate | undefined>(
        LibrariesPanelService, 'PreviewTemplate', undefined, MetaData.None)
    public static readonly PreviewConceptKey = Model.RegisterProperty<string>(LibrariesPanelService, 'PreviewConcept', '', MetaData.None)
    public static readonly HasPreviewKey = Model.RegisterProperty<boolean>(LibrariesPanelService, 'HasPreview', false, MetaData.None)

    private reloadSeq = 0

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.set_property_value(LibrariesPanelService.RootsKey, new ObservableCollection<LibraryTreeNode>())
        void this.Reload()
    }

    public get Roots(): ObservableCollection<LibraryTreeNode> { return this.get_property_value(LibrariesPanelService.RootsKey) }
    public get SelectedNode(): LibraryTreeNode | undefined { return this.get_property_value(LibrariesPanelService.SelectedNodeKey) }
    public set SelectedNode(v: LibraryTreeNode | undefined) { this.set_property_value(LibrariesPanelService.SelectedNodeKey, v) }
    public get IsEmpty(): boolean { return this.get_property_value(LibrariesPanelService.IsEmptyKey) }
    public get PreviewData(): LibraryTreeNode | undefined { return this.get_property_value(LibrariesPanelService.PreviewDataKey) }
    public get PreviewTemplate(): DataTemplate | undefined { return this.get_property_value(LibrariesPanelService.PreviewTemplateKey) }
    public get PreviewConcept(): string { return this.get_property_value(LibrariesPanelService.PreviewConceptKey) }
    public get HasPreview(): boolean { return this.get_property_value(LibrariesPanelService.HasPreviewKey) }

    public OnActivated(): void { void this.Reload() }

    // Uninstall a library after a confirm, then reload so its row disappears. When
    // no DialogService is registered (headless), skips the confirm and proceeds.
    private async deleteLibrary(node: LibraryTreeNode): Promise<void>
    {
        const registry = this.Provider.get(LibraryRegistry.Key)
        if (registry === undefined) return
        const dialogs = this.Provider.get(DialogService.Key)
        if (dialogs !== undefined) {
            const vm = new ConfirmDialogModel(
                `Delete library "${node.Name}"? This removes it from your installed libraries.`,
                'Delete', (r) => dialogs.Close(r))
            const ok = await dialogs.Show<boolean>({ Title: 'Delete Library', Content: vm, Width: 420 })
            if (ok !== true) return
        }
        await registry.delete(node.LibId, node.LibVersion)
        await this.Reload()
    }

    public async Reload(): Promise<void>
    {
        const seq = ++this.reloadSeq
        const registry = this.Provider.get(LibraryRegistry.Key)
        const roots = this.Roots
        if (registry === undefined) { roots.Clear(); this.set_property_value(LibrariesPanelService.IsEmptyKey, true); return }
        const libs = await registry.refresh()
        if (seq !== this.reloadSeq) return

        roots.Clear()
        this.clearPreview()
        for (const lib of libs) {
            const libNode = LibraryTreeNode.library(`${lib.name}  ·  ${lib.version}`, lib.id, lib.version)
            libNode.DeleteCommand = new RelayCommand(() => void this.deleteLibrary(libNode))
            const byConcept = new Map<string, LibraryTreeNode>()
            const sorted = [...lib.classes].sort((x, y) => (x.label ?? x.localId ?? x.id).localeCompare(y.label ?? y.localId ?? y.id))
            for (const cls of sorted) {
                let conceptNode = byConcept.get(cls.concept)
                if (conceptNode === undefined) { conceptNode = LibraryTreeNode.group(cls.concept, LibraryNodeKind.Concept); byConcept.set(cls.concept, conceptNode) }
                const display = cls.label ?? cls.localId ?? cls.id
                conceptNode.Children.Add(LibraryTreeNode.leaf(
                    { display, label: cls.label ?? '', localId: cls.localId ?? '', termId: cls.id, concept: cls.concept },
                    registry.resolve(cls.id, cls.concept),
                ))
            }
            for (const conceptName of [...byConcept.keys()].sort()) libNode.Children.Add(byConcept.get(conceptName)!)
            roots.Add(libNode)
        }
        this.set_property_value(LibrariesPanelService.IsEmptyKey, roots.Count === 0)
    }

    // Selection drives the bottom preview pane: a Class leaf populates it with the
    // class's data + mounted template + concept; any other selection clears it.
    protected override OnPropertyChanged(descriptor: PropertyDescriptor, oldValue: unknown, newValue: unknown): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue)
        if (descriptor.Name !== 'SelectedNode') return
        const node = newValue instanceof LibraryTreeNode ? newValue : undefined
        if (node !== undefined && node.Kind === LibraryNodeKind.Class) {
            this.set_property_value(LibrariesPanelService.PreviewDataKey, node)
            this.set_property_value(LibrariesPanelService.PreviewTemplateKey, node.Template)
            this.set_property_value(LibrariesPanelService.PreviewConceptKey, node.Concept)
            this.set_property_value(LibrariesPanelService.HasPreviewKey, true)
        } else {
            this.clearPreview()
        }
    }

    private clearPreview(): void
    {
        this.set_property_value(LibrariesPanelService.PreviewDataKey, undefined)
        this.set_property_value(LibrariesPanelService.PreviewTemplateKey, undefined)
        this.set_property_value(LibrariesPanelService.PreviewConceptKey, '')
        this.set_property_value(LibrariesPanelService.HasPreviewKey, false)
    }
}

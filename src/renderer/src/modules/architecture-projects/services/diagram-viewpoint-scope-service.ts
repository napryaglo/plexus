import {
    MetaData, Model, ObservableCollection, RelayCommand, ServiceBase, ServiceKey,
    type ICommand, type IServiceProvider,
} from '@pragmatic-lab/mural/runtime'
import { ContentHostService, type DocumentsContentHostService, type IDocument } from '@pragmatic-lab/mural/framework'
import { ArchDiagramBindingService } from './arch-diagram-binding-service.js'

// One viewpoint toggle for the active diagram.
export class ViewpointToggleRow extends Model
{
    public static readonly LabelKey = Model.RegisterProperty<string>(ViewpointToggleRow, 'Label', '', MetaData.None)
    public static readonly IsSelectedKey = Model.RegisterProperty<boolean>(ViewpointToggleRow, 'IsSelected', false, MetaData.None)
    public static readonly ToggleCommandKey = Model.RegisterProperty<ICommand | undefined>(ViewpointToggleRow, 'ToggleCommand', undefined, MetaData.None)

    public constructor(label: string, isSelected: boolean, toggle: ICommand)
    {
        super()
        this.set_property_value(ViewpointToggleRow.LabelKey, label)
        this.set_property_value(ViewpointToggleRow.IsSelectedKey, isSelected)
        this.set_property_value(ViewpointToggleRow.ToggleCommandKey, toggle)
    }

    public get Label(): string { return this.get_property_value(ViewpointToggleRow.LabelKey) }
    public get IsSelected(): boolean { return this.get_property_value(ViewpointToggleRow.IsSelectedKey) }
    public get ToggleCommand(): ICommand | undefined { return this.get_property_value(ViewpointToggleRow.ToggleCommandKey) }
}

// Inspector panel: the active architecture diagram's viewpoint toggles. Toggling
// a row flips its membership in the diagram's scope and persists via the binding
// service. Rebuilt when the active document changes (call refresh()).
export class DiagramViewpointScopeService extends ServiceBase
{
    public static readonly Key = new ServiceKey<DiagramViewpointScopeService>('DiagramViewpointScopeService')

    public static readonly RowsKey = Model.RegisterProperty<ObservableCollection<ViewpointToggleRow>>(
        DiagramViewpointScopeService, 'Rows', undefined as unknown as ObservableCollection<ViewpointToggleRow>, MetaData.None)

    public constructor(provider: IServiceProvider)
    {
        super(provider)
        this.set_property_value(DiagramViewpointScopeService.RowsKey, new ObservableCollection<ViewpointToggleRow>())
        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        // Rebuild when the open/active document set changes.
        host?.OpenDocuments?.Subscribe(() => this.refresh())
    }

    public get Rows(): ObservableCollection<ViewpointToggleRow> { return this.get_property_value(DiagramViewpointScopeService.RowsKey) }

    public refresh(): void
    {
        const rows = this.Rows
        rows.Clear()
        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        const doc = host?.ActiveDocument
        const bindingSvc = this.Provider.get(ArchDiagramBindingService.Key)
        if (doc === undefined || bindingSvc === undefined) return
        const model = bindingSvc.modelForDocument(doc)
        const scope = bindingSvc.scopeForDocument(doc)
        if (model === undefined || scope === undefined) return

        for (const vp of model.viewpoints()) {
            const id = vp.id
            rows.Add(new ViewpointToggleRow(id, scope.has(id), new RelayCommand(() => this.toggle(doc, id))))
        }
    }

    private toggle(doc: IDocument, id: string): void
    {
        const bindingSvc = this.Provider.getRequired(ArchDiagramBindingService.Key)
        const scope = bindingSvc.scopeForDocument(doc) ?? new Set<string>()
        const next = new Set(scope)
        if (next.has(id)) next.delete(id); else next.add(id)
        void bindingSvc.setDocumentScope(doc, [...next])
        this.refresh()
    }
}

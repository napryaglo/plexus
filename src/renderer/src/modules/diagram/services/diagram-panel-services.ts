// diagram-panel-services.ts — the Diagram module's left-panel content services.
//
// Module-local services: registered by diagram.module.mu's `.services:` block
// and named by its Capabilities via `ServiceKey`. Each extends the SHARED
// PlexusPanelService base (root services/panels/) and is rendered by the shared
// `DataTemplate [DataType = PlexusPanelService]`. Only the Diagram module
// registers these, so they live with the module, not in the root services tree.
import {
    PlexusPanelService,
} from '../../../services/panels/panel-services.js';
import {
    MetaData,
    Model,
    ObservableCollection,
    ServiceKey,
    type IServiceProvider,
} from '@visualisation-sub/mural/runtime';
import type { ToolboxShape } from '@visualisation-sub/mural/framework';
import { DiagramWorkspaceService } from './diagram-workspace-service.js';

// Shapes — the toolbox of shapes to drag onto the canvas. Unlike the other
// panel services (a static section list), this one surfaces the diagram's live
// ToolboxShapes palette so `DataTemplate [DataType = ToolBoxService]` (in
// diagram.resources.mu) can render draggable tiles. The palette comes from the
// shared DiagramWorkspaceService's Document — resolving it here also triggers
// the workspace to build the canvas + present it in the content region.
export class ToolBoxService extends PlexusPanelService
{
    public static readonly Key = new ServiceKey<ToolBoxService>('ToolBoxService');

    public static readonly ShapesKey = Model.RegisterProperty<ObservableCollection<ToolboxShape>>(
        ToolBoxService, 'Shapes',
        undefined as unknown as ObservableCollection<ToolboxShape>, MetaData.None);

    constructor(provider: IServiceProvider)
    {
        super(provider, []);
        const workspace = provider.get(DiagramWorkspaceService.Key);
        this.set_property_value(ToolBoxService.ShapesKey,
            workspace?.Document.ToolboxShapes ?? new ObservableCollection<ToolboxShape>());
    }

    public get Shapes(): ObservableCollection<ToolboxShape>
    {
        return this.get_property_value(ToolBoxService.ShapesKey);
    }
}

// Layers — the document's layer stack.
export class LayersService extends PlexusPanelService
{
    public static readonly Key = new ServiceKey<LayersService>('LayersService');
    constructor(provider: IServiceProvider) { super(provider, []); }
}

// Outline — a tree of the diagram's nodes.
export class OutlineService extends PlexusPanelService
{
    public static readonly Key = new ServiceKey<OutlineService>('OutlineService');
    constructor(provider: IServiceProvider) { super(provider, []); }
}

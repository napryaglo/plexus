// meta-model.resources.mu — view resources for the Meta-models capability panel
// (MetaModelsService). Merged app-global by app.mu (`merge MetaModelResources`).
//
// Renders the published meta-models as a virtualized tree: model id → version →
// ontology entities (grouped by kind), the entities loaded lazily when a version
// row is first expanded (MetaModelTreeNode.OnExpand via mural's TreeView hook).
// One HierarchicalDataTemplate governs every level; MetaModelKindToGeometry maps
// a node's Kind to its leading glyph.

import MetaModelsService from "./services/meta-models-service.js"
import MetaModelTreeNode from "./services/meta-model-tree-node.js"
import MetaModelKindToGeometry from "./services/meta-model-node-icon.js"

resources MetaModelResources {
    // The panel body: a virtualized tree of the published models, plus an
    // empty-state line shown only while nothing has been published.
    DataTemplate [ DataType = MetaModelsService ] {
        StackPanel [ Orientation = Vertical, Margin = (12,12,12,12) ] {
            TreeView [ Indent = 14, IsVirtualizing = true,
                       ItemsSource = $Nodes, ItemTemplate = @MetaModelNodeTemplate ]
            TextBlock [ Style = @BodyMedium, Text = "No published meta-models yet.",
                        Foreground = @OnSurfaceVariant, TextWrapping = Wrap,
                        Visibility = $IsEmpty << ToVisibility ]
        }
    }

    // One tree row (any level): the per-kind leading icon + the node's label.
    // `itemsselector = Children` recurses the template down the tree; the
    // framework's TreeView chrome supplies chevrons, indent, hover, selection.
    HierarchicalDataTemplate x:key="MetaModelNodeTemplate"
        [ DataType = MetaModelTreeNode, itemsselector = Children ] {
        StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {
            Shape [ Geometry = $Kind << MetaModelKindToGeometry, Fill = @OnSurfaceVariant,
                    Width = 16, Height = 16, Margin = (0,0,6,0), VerticalAlignment = Center ]
            TextBlock [ Text = $Label, Style = @BodyMedium, VerticalAlignment = Center ]
        }
    }
}

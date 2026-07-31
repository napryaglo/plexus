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
import MetaModelField from "./services/meta-model-entity.js"
import IsNullToVisibility from "./services/meta-model-converters.js"

resources MetaModelResources {
    // The panel body: a virtualized tree of the published models, plus an
    // empty-state line shown only while nothing has been published. A DockPanel
    // (not a vertical StackPanel) so the TreeView, as the LastChildFill, inherits
    // the pane's bounded height and fills it — a StackPanel would measure the
    // tree with infinite height, collapsing the virtualizing panel to a thin
    // strip. The empty-state text docks above; it's collapsed while non-empty,
    // so the tree then fills the whole pane.
    DataTemplate [ DataType = MetaModelsService ] {
        DockPanel [ LastChildFill = true, Margin = (12,12,12,12) ] {
            TextBlock [ DockPanel.Dock = Top, Style = @BodyMedium,
                        Text = "No published meta-models yet.",
                        Foreground = @OnSurfaceVariant, TextWrapping = Wrap,
                        Visibility = $IsEmpty << ToVisibility ]
            // The entity drawer. Modal → out of flow (mounts on the overlay when
            // open), so it measures to zero here; docking it Top keeps it target-
            // attached (needed for IsOpen to mount) without disturbing the tree,
            // which stays the LastChildFill.
            // The entity drawer. The body's DataContext binds to $DrawerEntity so
            // every inner binding re-resolves when a different entity is opened —
            // binding a ContentPresenter's Content directly to $DrawerEntity does
            // NOT re-render on change, but a DataContext rebind does (and works
            // through the Modal overlay). Presentation is the applied mm:<id>
            // template (undefined when unavailable → the note shows instead).
            SideSheet [ DockPanel.Dock = Top, Variant = Modal, SheetSize = 360,
                        IsOpen = $IsDrawerOpen ] {
                StackPanel [ DataContext = $DrawerEntity, Orientation = Vertical, Margin = (16,16,16,16) ] {
                    ContentPresenter [ Content = $Presentation, Margin = (0,0,0,12) ]
                    TextBlock [ Text = "Presentation unavailable — republish the meta-model.",
                                Style = @BodySmall, Foreground = @OnSurfaceVariant, TextWrapping = Wrap,
                                Visibility = $Presentation << IsNullToVisibility, Margin = (0,0,0,12) ]
                    TextBlock [ Text = $TypeOf, Style = @LabelSmall, Foreground = @OnSurfaceVariant ]
                    TextBlock [ Text = $Label, Style = @TitleMedium, Foreground = @OnSurface, Margin = (0,0,0,8) ]
                    TextBlock [ Text = "Fields", Style = @LabelMedium, Foreground = @OnSurfaceVariant ]
                    ItemsControl [ ItemsSource = $Fields, ItemTemplate = @MetaModelFieldTemplate ]
                }
            }
            TreeView [ Indent = 14, IsVirtualizing = true,
                       ItemsSource = $Nodes, ItemTemplate = @MetaModelNodeTemplate ]
        }
    }

    // One field row in the drawer's detail list: name : type.
    DataTemplate x:key="MetaModelFieldTemplate" [ DataType = MetaModelField ] {
        StackPanel [ Orientation = Horizontal, Margin = (0,2,0,2) ] {
            TextBlock [ Text = $Name, Style = @BodyMedium, Foreground = @OnSurface ]
            TextBlock [ Text = " : ", Style = @BodyMedium, Foreground = @OnSurfaceVariant ]
            TextBlock [ Text = $Type, Style = @BodyMedium, Foreground = @OnSurfaceVariant ]
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

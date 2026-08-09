// viewpoint-scope.resources.mu — the active arch diagram's viewpoint toggles,
// shown in the Inspector region. A row per project viewpoint; the checkbox binds
// IsSelected and the ToggleCommand flips + persists the scope.

import DiagramViewpointScopeService from "./diagram-viewpoint-scope-service.js"
import ViewpointToggleRow from "./diagram-viewpoint-scope-service.js"

resources ViewpointScopeResources {

    ItemsPanelTemplate x:key="ViewpointScopeListPanel" {
        StackPanel [ Orientation = Vertical ]
    }

    DataTemplate [ DataType = ViewpointToggleRow ] {
        ToggleButton [ IsChecked = $IsSelected, Command = $ToggleCommand, Margin = (8,3,8,3) ] {
            TextBlock [ Text = $Label ]
        }
    }

    // Inspector-region panel for the active architecture diagram.
    DataTemplate [ DataType = DiagramViewpointScopeService ] {
        DockPanel [ Margin = (8,8,8,8) ] {
            TextBlock [ DockPanel.Dock = Top, Text = "Viewpoints", Margin = (0,0,0,6) ]
            ItemsControl [ ItemsSource = $Rows, ItemsPanel = @ViewpointScopeListPanel ]
        }
    }
}

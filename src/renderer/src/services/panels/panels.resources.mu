// panels.resources.mu — view resources for the capability panel services
// (panel-services.ts). Merged app-global by app.mu (`merge PanelsResources`) so
// the shell's side pane resolves these implicit-by-type templates.
//
// @VerticalStackPanel is an app-level shared resource (defined in app.mu); it
// resolves at render time from the merged app resources.

import PlexusPanelService from "./panel-services.js"
import PanelSection from "./panel-services.js"

resources PanelsResources {
    // Left-panel content for the active capability. The shell shows
    // NavigationService.ActiveService (resolved from the selected capability's
    // ServiceKey) in the side pane through this implicit-by-type template; the
    // base DataType matches every concrete PlexusPanelService subclass via the
    // resource-chain prototype walk. The pane header already shows the capability
    // name, so the body is just the section list.
    DataTemplate [ DataType = PlexusPanelService ] {
        ItemsControl [ ItemsSource = $Sections, ItemsPanel = @VerticalStackPanel, Margin = (12,12,12,12) ]
    }

    // One section row inside a panel.
    DataTemplate [ DataType = PanelSection ] {
        TextBlock [ Style = @BodyMedium, Text = $Label, Foreground = @OnSurfaceVariant, Margin = (0,3,0,3) ]
    }
}

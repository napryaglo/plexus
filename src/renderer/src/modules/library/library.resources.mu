// library.resources.mu — view resources for the Libraries capability panel
// (LibrariesPanelService). Merged app-global by app.mu. Browses published
// libraries; each class renders through its mounted template via a
// ContentPresenter whose ContentTemplate is the registry-resolved DataTemplate.

import LibrariesPanelService from "./services/libraries-panel-service.js"
import LibraryRow from "./services/libraries-panel-service.js"
import ClassRow from "./services/libraries-panel-service.js"

resources LibraryResources {
    DataTemplate [ DataType = LibrariesPanelService ] {
        StackPanel [ Orientation = Vertical, Margin = (12,12,12,12) ] {
            ItemsControl [ ItemsSource = $Libraries, ItemsPanel = @VerticalStackPanel ]
            TextBlock [ Style = @BodyMedium, Text = "No published libraries yet.",
                        Foreground = @OnSurfaceVariant, TextWrapping = Wrap,
                        Visibility = $IsEmpty << ToVisibility ]
        }
    }

    DataTemplate [ DataType = LibraryRow ] {
        StackPanel [ Orientation = Vertical, Margin = (0,4,0,8) ] {
            TextBlock [ Style = @BodyMedium, Text = $Name, Foreground = @OnSurface ]
            ItemsControl [ ItemsSource = $Classes, ItemsPanel = @VerticalStackPanel, Margin = (12,4,0,0) ]
        }
    }

    DataTemplate [ DataType = ClassRow ] {
        ContentPresenter [ Content = $Data, ContentTemplate = $Template, Margin = (0,3,0,3) ]
    }
}

// meta-model.resources.mu — view resources for the Meta-models capability panel
// (MetaModelsService). Merged app-global by app.mu (`merge MetaModelResources`).
//
// Renders the published meta-models as a group-by-id tree: each model id is a
// header row with its versions nested (indented) beneath. A more-derived
// `DataTemplate [DataType = MetaModelsService]` wins over the base
// `DataTemplate [DataType = PlexusPanelService]` in the resource-chain walk.
//
// @VerticalStackPanel is the app-level shared ItemsPanelTemplate (app.mu); the
// theme styles/brushes (@BodyMedium, @OnSurface…) and the ToVisibility converter
// resolve from the merged app resources at render time.

import MetaModelsService from "./services/meta-models-service.js"
import MetaModelRow from "./services/meta-models-service.js"
import MetaModelVersionRow from "./services/meta-models-service.js"

resources MetaModelResources {
    // The panel body: the list of published models, plus an empty-state line
    // shown only while nothing has been published.
    DataTemplate [ DataType = MetaModelsService ] {
        StackPanel [ Orientation = Vertical, Margin = (12,12,12,12) ] {
            ItemsControl [ ItemsSource = $Models, ItemsPanel = @VerticalStackPanel ]
            TextBlock [ Style = @BodyMedium, Text = "No published meta-models yet.",
                        Foreground = @OnSurfaceVariant, TextWrapping = Wrap,
                        Visibility = $IsEmpty << ToVisibility ]
        }
    }

    // One model id: the id as a header, its versions indented below.
    DataTemplate [ DataType = MetaModelRow ] {
        StackPanel [ Orientation = Vertical, Margin = (0,4,0,4) ] {
            TextBlock [ Style = @BodyMedium, Text = $Id, Foreground = @OnSurface ]
            ItemsControl [ ItemsSource = $Versions, ItemsPanel = @VerticalStackPanel, Margin = (12,2,0,0) ]
        }
    }

    // One published version.
    DataTemplate [ DataType = MetaModelVersionRow ] {
        TextBlock [ Style = @BodySmall, Text = $Label, Foreground = @OnSurfaceVariant, Margin = (0,2,0,2) ]
    }
}

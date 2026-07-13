// layout-inspector.resources.mu — the builder view for the layout
// pipeline inspector. Merged app-global by app.mu; rendered in the shell's
// Inspector region when a LayoutInspector is added to the InspectorService.
//
// The template binds to the shell-scoped LayoutPipelineService via
// $service(...): the run mode, the Run / preview commands, the status
// readout, and a catalog-derived stage summary all live there. v1 shows the
// pipeline stages read-only (StagesSummary) and drives the core run loop;
// per-slot interactive strategy editing is the next iteration.

import LayoutInspector from "./layout-inspector.js"
import LayoutPipelineService from "./layout-pipeline-service.js"

resources LayoutInspectorResources {

    DataTemplate [ DataType = LayoutInspector ] {
        ScrollViewer [ HorizontalScrollEnabled = false ] {
            StackPanel [ Orientation = Vertical, Margin = (12,12,12,12) ] {

                TextBlock [ Style = @TitleMedium, Text = "Layout Pipeline",
                            Foreground = @OnSurface, Margin = (0,0,0,10) ]

                // Run mode — two buttons; the active one is described in the status line.
                TextBlock [ Style = @BodySmall, Text = "Run mode", Foreground = @OnSurfaceVariant ]
                StackPanel [ Orientation = Horizontal, Margin = (0,2,0,10) ] {
                    Button [ Content = "Positions", Margin = (0,0,6,0),
                             Command = $service(LayoutPipelineService).UsePositionsModeCommand ]
                    Button [ Content = "Preview",
                             Command = $service(LayoutPipelineService).UsePreviewModeCommand ]
                }

                // Primary actions.
                StackPanel [ Orientation = Horizontal, Margin = (0,0,0,10) ] {
                    Button [ Content = "Run", Margin = (0,0,6,0),
                             Command = $service(LayoutPipelineService).RunCommand ]
                    Button [ Content = "Apply", Margin = (0,0,6,0),
                             Command = $service(LayoutPipelineService).ApplyPreviewCommand ]
                    Button [ Content = "Cancel",
                             Command = $service(LayoutPipelineService).CancelPreviewCommand ]
                }

                TextBlock [ Style = @BodySmall, Text = $service(LayoutPipelineService).Status,
                            Foreground = @OnSurfaceVariant, TextWrapping = Wrap, Margin = (0,0,0,12) ]

                // Catalog-derived list of pipeline stages (read-only in v1).
                TextBlock [ Style = @BodySmall, Text = "Pipeline stages (strategy count)",
                            Foreground = @OnSurfaceVariant ]
                TextBlock [ Style = @BodySmall, Text = $service(LayoutPipelineService).StagesSummary,
                            Foreground = @OnSurface, TextWrapping = Wrap, Margin = (0,2,0,0) ]
            }
        }
    }
}

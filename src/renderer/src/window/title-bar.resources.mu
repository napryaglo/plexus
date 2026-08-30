// title-bar.resources.mu — the mural-painted app title bar.
//
// Set as EditorShell.HeaderContent in app.mu, this fills the shell's top Header
// region (PART_HeaderHost) — a full-width 32dp strip:
//   • a 48dp logo box on the left, painted the shared @Surface chrome tone with
//     the rail's 1dp @OutlineVariant right divider, so the rail column reads as
//     continuing to the top-left corner. It holds the Plexus brand mark (a
//     distilled owl face + swept wings + nodes), drawn as flat vector
//     Path/Ellipse shapes in fixed brand blues.
//   • the title text, bound to $service(TitleService).Title (active document,
//     else open project, else "Plexus").
//
// The strip is only PAINTED here; OS window-dragging + the native caption
// buttons stay HTML/OS concerns (a transparent #drag-strip in index.html gives
// the drag affordance, the Window Controls Overlay draws the buttons). The band
// reserves ~140dp on the right so a long title never slides under those buttons.
//
// Merged into Application.Resources by app.mu; referenced there as
// `HeaderContent = @PlexusTitleBar`.

// The title feed the strip binds ($service(TitleService).Title) — imported so
// the compiler knows the symbol.
import TitleService from "./title-service.js"

resources PlexusTitleBar {
    Border x:key="PlexusTitleBar" [ Height = 32, Fill = @Surface ] {
        DockPanel [ LastChildFill = true ] {
            // Logo box — same @Surface chrome as the rail below (and the title,
            // status bar, window background): one flat VSCode-style frame tone.
            Border [ DockPanel.Dock = Left, Width = 48, Fill = @Surface ] {
                // Brand mark, pre-scaled to ~28dp and centred in the 48×32 box.
                // Paths paint their coordinates verbatim (layout-free); Ellipses
                // position via Canvas.Left/Top. Drawn back-to-front.
                Canvas [ Width = 48, Height = 32 ] {
                    // wings + ears (back)
                    Path [ Data = "M 19.3,12.5 L 10.6,10.2 L 10.9,12.2 L 18.2,14.3 Z", Fill = #5bb0e6 ]
                    Path [ Data = "M 18.2,14.8 L 11.2,14.3 L 11.5,16 L 18.2,16.6 Z", Fill = #86c9f2 ]
                    Path [ Data = "M 28.7,12.5 L 37.4,10.2 L 37.1,12.2 L 29.8,14.3 Z", Fill = #5bb0e6 ]
                    Path [ Data = "M 29.8,14.8 L 36.8,14.3 L 36.5,16 L 29.8,16.6 Z", Fill = #86c9f2 ]
                    Path [ Data = "M 20.5,9.6 L 21.7,6.1 L 23.4,9 Z", Fill = #7fc4ee ]
                    Path [ Data = "M 27.5,9.6 L 26.3,6.1 L 24.6,9 Z", Fill = #7fc4ee ]
                    // floating nodes
                    Ellipse [ Width = 1.4, Height = 1.4, Fill = #86c9f2, Canvas.Left = 23.3, Canvas.Top = 3.9 ]
                    Ellipse [ Width = 1.2, Height = 1.2, Fill = #86c9f2, Canvas.Left = 23.4, Canvas.Top = 25.0 ]
                    Ellipse [ Width = 1, Height = 1, Fill = #86c9f2, Canvas.Left = 35.2, Canvas.Top = 17.3 ]
                    Ellipse [ Width = 1, Height = 1, Fill = #86c9f2, Canvas.Left = 11.8, Canvas.Top = 17.3 ]
                    // face + beak
                    Path [ Data = "M 24,7.3 L 28.1,9 L 29.3,13.7 L 26.3,20.1 L 24,23.6 L 21.7,20.1 L 18.8,13.7 L 19.9,9 Z", Fill = #eaf4fb ]
                    Path [ Data = "M 23.1,16 L 24.9,16 L 24,21.3 Z", Fill = #5bb0e6 ]
                    // eyes (front)
                    Ellipse [ Width = 5.2, Height = 5.2, Fill = #ffffff, Canvas.Left = 18.8, Canvas.Top = 11.7 ]
                    Ellipse [ Width = 4, Height = 4, Fill = #2f86c8, Canvas.Left = 19.4, Canvas.Top = 12.3 ]
                    Ellipse [ Width = 1.8, Height = 1.8, Fill = #14314f, Canvas.Left = 20.5, Canvas.Top = 13.4 ]
                    Ellipse [ Width = 0.8, Height = 0.8, Fill = #ffffff, Canvas.Left = 21.4, Canvas.Top = 13.3 ]
                    Ellipse [ Width = 5.2, Height = 5.2, Fill = #ffffff, Canvas.Left = 24.0, Canvas.Top = 11.7 ]
                    Ellipse [ Width = 4, Height = 4, Fill = #2f86c8, Canvas.Left = 24.6, Canvas.Top = 12.3 ]
                    Ellipse [ Width = 1.8, Height = 1.8, Fill = #14314f, Canvas.Left = 25.7, Canvas.Top = 13.4 ]
                    Ellipse [ Width = 0.8, Height = 0.8, Fill = #ffffff, Canvas.Left = 26.7, Canvas.Top = 13.3 ]
                }
            }
            // 1dp divider continuing the rail's right edge up through the strip.
            Line [ DockPanel.Dock = Left, Orientation = Vertical, Stroke = (@OutlineVariant, 1) ]
            // Title — active document / open project / "Plexus". Right margin keeps
            // it clear of the ~138dp Window-Controls-Overlay caption buttons.
            TextBlock
                [ Text              = $service(TitleService).Title,
                  Foreground        = @OnSurfaceVariant,
                  FontSize          = 12,
                  VerticalAlignment = Center,
                  Margin            = (12,0,140,0) ]
        }
    }
}

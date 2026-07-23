// problems.resources.mu — the Problems dock (Status-region) view.
//
// DataTemplate[ProblemsService] renders a collapsed summary cell (error/warning
// counts) that expands into a scrollable, grouped list of ProblemsRow items. The
// ShellControlDefinition in problems.module.mu places it in the StatusBar region
// with DataContext = ProblemsService (always visible, document-independent).
//
// @VerticalStackPanel is an app-level shared resource (defined in app.mu). The
// ToVisibility converter is a framework built-in (resolved by default symbol table).

import ProblemsService from "./problems-service.js"
import ProblemsRow from "./problems-service.js"

resources ProblemsResources {
    // Collapsed summary + expandable list. The summary button toggles IsExpanded;
    // the list is shown only when expanded (bottom-anchored, height-capped).
    // Keyed so the StatusBar ShellControlDefinition references it by @ProblemsDock.
    DataTemplate x:key="ProblemsDock" [ DataType = ProblemsService ] {
        StackPanel [ Orientation = Vertical, VerticalAlignment = Bottom ] {
            // Expanded list — grouped rows. Shown only while IsExpanded.
            Border [ Visibility     = $IsExpanded << ToVisibility,
                     Background      = @Surface,
                     BorderBrush     = @OutlineVariant,
                     BorderThickness = (0,1,0,0),
                     MaxHeight       = 220 ] {
                ScrollViewer [ HorizontalScrollEnabled = false ] {
                    ItemsControl [ ItemsSource = $Rows, ItemsPanel = @VerticalStackPanel, Margin = (4,4,4,4) ]
                }
            }
            // Collapsed summary cell — a toggle that reveals the panel.
            Button [ Command = $ToggleCommand, HorizontalAlignment = Left ] {
                StackPanel [ Orientation = Horizontal, VerticalAlignment = Center, Margin = (8,2,8,2) ] {
                    Border [ Width = 8, Height = 8, CornerRadius = (4), Background = #f44336, Margin = (0,0,4,0), VerticalAlignment = Center ]
                    TextBlock [ Text = $ErrorText, FontSize = 11, Foreground = @OnSurfaceVariant, Margin = (0,0,10,0), VerticalAlignment = Center ]
                    Border [ Width = 8, Height = 8, CornerRadius = (4), Background = #ff9800, Margin = (0,0,4,0), VerticalAlignment = Center ]
                    TextBlock [ Text = $WarningText, FontSize = 11, Foreground = @OnSurfaceVariant, VerticalAlignment = Center ]
                }
            }
        }
    }

    // One row: project header / file header / diagnostic. A button bound to the
    // row's ActivateCommand (null for headers → inert): diagnostic rows navigate
    // to their file + span, headers do nothing.
    DataTemplate [ DataType = ProblemsRow ] {
        Button [ Command = $ActivateCommand, HorizontalAlignment = Stretch ] {
            DockPanel [ Margin = (8,1,8,1) ] {
                TextBlock [ DockPanel.Dock = Right, Text = $Detail, FontSize = 11, Foreground = @OnSurfaceVariant, Margin = (8,0,0,0) ]
                TextBlock [ Text = $Label, FontSize = 11, Foreground = @OnSurface ]
            }
        }
    }
}

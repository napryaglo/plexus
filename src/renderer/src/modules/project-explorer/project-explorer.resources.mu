// project-explorer.resources.mu — the Project Explorer's left-panel view.
//
// Renders the generic ProjectExplorerService: a small command bar (Open / New
// project, New Diagram, Save), a status line, and the project file tree. The
// tree is a recursive DataTemplate[ProjectNode] — each node shows a row bound
// to its OpenCommand and an ItemsControl over its Children, which resolve back
// to this same template by DataType, giving arbitrary-depth folders.

import ProjectExplorerService from "./services/project-explorer-service.js"
import ProjectNode from "../../services/projects/project.js"
import NewProjectDialogModel from "../../services/projects/new-project-dialog-model.js"
import ProjectTypeChoice from "../../services/projects/new-project-dialog-model.js"
import OpenProjectDialogModel from "../../services/projects/open-project-dialog-model.js"
import RecentProjectItem from "../../services/projects/open-project-dialog-model.js"

resources ProjectExplorerResources {

    // One tree node: its row + (recursively) its children, indented.
    DataTemplate [ DataType = ProjectNode ] {
        StackPanel [ Orientation = Vertical ] {
            Button [ Content = $Name, Command = $OpenCommand,
                     HorizontalAlignment = Left, Margin = (0,1,0,1) ]
            ItemsControl [ ItemsSource = $Children, ItemsPanel = @VerticalStackPanel,
                           Margin = (12,0,0,0) ]
        }
    }

    DataTemplate [ DataType = ProjectExplorerService ] {
        ScrollViewer [ HorizontalScrollEnabled = false ] {
            StackPanel [ Orientation = Vertical, Margin = (8,8,8,8) ] {

                StackPanel [ Orientation = Horizontal, Margin = (0,0,0,8) ] {
                    Button [ Content = "Open",        Margin = (0,0,4,0), Command = $OpenProjectCommand ]
                    Button [ Content = "New",         Margin = (0,0,4,0), Command = $NewProjectCommand ]
                    Button [ Content = "New Diagram", Margin = (0,0,4,0), Command = $NewDiagramCommand ]
                    Button [ Content = "Save",                            Command = $SaveActiveCommand ]
                }

                TextBlock [ Style = @BodySmall, Text = $Status, Foreground = @OnSurfaceVariant,
                            TextWrapping = Wrap, Margin = (0,0,0,8) ]

                ItemsControl [ ItemsSource = $Project.Root.Children, ItemsPanel = @VerticalStackPanel ]
            }
        }
    }

    // ── New Project dialog ───────────────────────────────────────────────
    // One project-type choice: a full row (always shown, even for a single
    // factory). The leading marker (● / ○) is the VM-toggled selection glyph.
    DataTemplate [ DataType = ProjectTypeChoice ] {
        Button [ Variant = Text, Command = $SelectCommand, HorizontalAlignment = Stretch, Margin = (0,1,0,1) ] {
            DockPanel [ LastChildFill = true ] {
                TextBlock [ DockPanel.Dock = Left, Text = $Marker, Foreground = @Primary,
                            Margin = (0,0,10,0), VerticalAlignment = Top ]
                StackPanel [ Orientation = Vertical ] {
                    TextBlock [ Style = @BodyLarge, Text = $Title, Foreground = @OnSurface ]
                    TextBlock [ Style = @BodySmall, Text = $Description, Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
                }
            }
        }
    }

    // The dialog body (DialogService supplies the surface, title, and padding).
    DataTemplate [ DataType = NewProjectDialogModel ] {
        StackPanel [ Orientation = Vertical ] {
            TextBlock [ Style = @BodyLarge, Text = "Project type", Foreground = @OnSurface, Margin = (0,0,0,4) ]
            Border [ BorderBrush = @OutlineVariant, BorderThickness = (1,1,1,1), CornerRadius = 6,
                     Padding = (4,4,4,4), Margin = (0,0,0,14) ] {
                ItemsControl [ ItemsSource = $Types, ItemsPanel = @VerticalStackPanel ]
            }

            TextBlock [ Style = @BodyLarge, Text = "Name", Foreground = @OnSurface ]
            TextBox [ Text = $Name, Margin = (0,4,0,14) ]

            TextBlock [ Style = @BodyLarge, Text = "Location", Foreground = @OnSurface ]
            DockPanel [ LastChildFill = true, Margin = (0,4,0,8) ] {
                Button [ DockPanel.Dock = Right, Variant = Outlined, Command = $BrowseCommand, Margin = (8,0,0,0) ] {
                    TextBlock [ Text = "Browse…" ]
                }
                TextBox [ Text = $Location ]
            }

            TextBlock [ Style = @BodySmall, Text = $Error, Foreground = @Error, TextWrapping = Wrap, Margin = (0,0,0,10) ]

            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right ] {
                Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel" ] }
                Button [ Variant = Filled, Command = $ConfirmCommand, IsEnabled = $CanConfirm ] { TextBlock [ Text = "Create" ] }
            }
        }
    }

    // ── Open Project dialog ──────────────────────────────────────────────
    // One recent-projects row: click to open (OpenCommand closes with its path).
    DataTemplate [ DataType = RecentProjectItem ] {
        Button [ Variant = Text, Command = $OpenCommand, HorizontalAlignment = Stretch, Margin = (0,1,0,1) ] {
            StackPanel [ Orientation = Vertical ] {
                TextBlock [ Style = @BodyLarge, Text = $Name, Foreground = @OnSurface ]
                TextBlock [ Style = @BodySmall, Text = $Path, Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
            }
        }
    }

    DataTemplate [ DataType = OpenProjectDialogModel ] {
        StackPanel [ Orientation = Vertical ] {
            TextBlock [ Style = @BodyLarge, Text = "Recent", Foreground = @OnSurface, Margin = (0,0,0,4) ]
            ItemsControl [ ItemsSource = $Recents, ItemsPanel = @VerticalStackPanel ]
            TextBlock [ Style = @BodySmall, Text = $EmptyLabel, Foreground = @OnSurfaceVariant, Margin = (0,2,0,0) ]

            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right, Margin = (0,14,0,0) ] {
                Button [ Variant = Outlined, Command = $BrowseCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Browse…" ] }
                Button [ Variant = Text, Command = $CancelCommand ] { TextBlock [ Text = "Cancel" ] }
            }
        }
    }
}

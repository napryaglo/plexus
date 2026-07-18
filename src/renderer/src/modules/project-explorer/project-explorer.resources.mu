// project-explorer.resources.mu — the Project Explorer's left-panel view.
//
// Renders the generic ProjectExplorerService: a small command bar (Open / New
// project, Save), a status line, and the OPEN PROJECTS — each an OpenProject
// root (a header row carrying a right-click context menu of project-specific
// actions: New File / Publish / Close) over its file tree. A node's row binds
// its OpenCommand; the recursive DataTemplate[ProjectNode] gives arbitrary-depth
// folders.

import ProjectExplorerService from "./services/project-explorer-service.js"
import ProjectNode from "../../services/projects/project.js"
import OpenProject from "../../services/projects/open-project.js"
import NewProjectDialogModel from "../../services/projects/new-project-dialog-model.js"
import ProjectTypeChoice from "../../services/projects/new-project-dialog-model.js"
import OpenProjectDialogModel from "../../services/projects/open-project-dialog-model.js"
import RecentProjectItem from "../../services/projects/open-project-dialog-model.js"

resources ProjectExplorerResources {

    // The project-specific actions — a shared context menu opened on a project's
    // header row. Its Command bindings resolve against that row's OpenProject.
    ContextMenu x:key="ProjectContextMenu" {
        MenuItem
            [ Header = "New File",
              Command = $NewFileCommand,
              Icon = Shape [ Geometry = @NoteAdd, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header = "Publish",
              Command = $PublishCommand,
              Icon = Shape [ Geometry = @Publish, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuSeparator
        MenuItem [ Header = "Close Project", Command = $CloseCommand ]
    }

    // One open project: a header row (name + context menu) over its file tree.
    DataTemplate [ DataType = OpenProject ] {
        StackPanel [ Orientation = Vertical, Margin = (0,0,0,6) ] {
            Button [ Content = $Name, Variant = Text, HorizontalAlignment = Stretch, Margin = (0,2,0,2),
                     ContextMenuService.ContextMenu = @ProjectContextMenu ]
            ItemsControl [ ItemsSource = $Root.Children, ItemsPanel = @VerticalStackPanel,
                           Margin = (12,0,0,0) ]
        }
    }

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
                    PanelButton [ Margin = (0,0,4,0), Command = $OpenProjectCommand ] {
                        Shape [ Geometry = @Folder, Fill = @OnSurfaceVariant, Width = 20, Height = 20 ]
                    }
                    PanelButton [ Margin = (0,0,4,0), Command = $NewProjectCommand ] {
                        Shape [ Geometry = @NewFolder, Fill = @OnSurfaceVariant, Width = 20, Height = 20 ]
                    }
                    PanelButton [ Command = $SaveActiveCommand ] {
                        Shape [ Geometry = @Save, Fill = @OnSurfaceVariant, Width = 20, Height = 20 ]
                    }
                }

                TextBlock [ Style = @BodySmall, Text = $Status, Foreground = @OnSurfaceVariant,
                            TextWrapping = Wrap, Margin = (0,0,0,8) ]

                ItemsControl [ ItemsSource = $OpenProjects, ItemsPanel = @VerticalStackPanel ]
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
    // HorizontalAlignment = Stretch so the panel fills the dialog width — a bare
    // StackPanel shrinks to its widest child and the content presenter pins it
    // to one side (leaving Name/Location collapsed).
    DataTemplate [ DataType = NewProjectDialogModel ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
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
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
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

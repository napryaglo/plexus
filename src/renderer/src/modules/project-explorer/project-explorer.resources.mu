// project-explorer.resources.mu — the Project Explorer's left-panel view.
//
// Renders the generic ProjectExplorerService: a small command bar (Open / New
// project, New Diagram, Save), a status line, and the project file tree. The
// tree is a recursive DataTemplate[ProjectNode] — each node shows a row bound
// to its OpenCommand and an ItemsControl over its Children, which resolve back
// to this same template by DataType, giving arbitrary-depth folders.

import ProjectExplorerService from "./services/project-explorer-service.js"
import ProjectNode from "../../services/projects/project.js"

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
}

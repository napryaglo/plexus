// library.resources.mu — view resources for the Libraries capability panel
// (LibrariesPanelService). Merged app-global by app.mu. A TreeView of published
// libraries grouped Library -> Concept -> Class; class leaves are draggable onto
// the architecture canvas (term payload) and, when selected, expand an inline
// preview of their mounted visual template.

import LibrariesPanelService from "./services/libraries-panel-service.js"
import LibraryTreeNode from "./services/library-tree-node.js"

resources LibraryResources {

    // One node row + (for a selected class leaf) its inline preview beneath it.
    HierarchicalDataTemplate x:key="LibraryNodeTemplate" [ DataType = LibraryTreeNode, itemsselector = Children ] {
        StackPanel [ Orientation = Vertical ] {
            Border [ Background = #00000000, IsDraggable = $IsDraggable, OnDragStart = $BeginKindDragData ] {
                StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {
                    Shape [ Geometry = @Libraries, Fill = @OnSurfaceVariant, Width = 14, Height = 14,
                            Margin = (0,0,6,0), VerticalAlignment = Center,
                            Visibility = $IsLibrary << ToVisibility ]
                    TextBlock [ Text = $Name, Style = @BodyMedium, Foreground = @OnSurface, VerticalAlignment = Center ]
                }
            }
            Border [ Visibility = $IsPreviewOpen << ToVisibility, Background = @SurfaceContainerHigh,
                     CornerRadius = 6, Padding = (8,6,8,6), Margin = (18,2,0,4) ] {
                StackPanel [ Orientation = Vertical ] {
                    ContentPresenter [ Content = $Data, ContentTemplate = $Template ]
                    TextBlock [ Text = $Concept, Style = @BodySmall, Foreground = @OnSurfaceVariant, Margin = (0,4,0,0) ]
                }
            }
        }
    }

    DataTemplate [ DataType = LibrariesPanelService ] {
        StackPanel [ Orientation = Vertical, Margin = (12,12,12,12) ] {
            TreeView [ Indent = 14,
                       ItemsSource      = $Roots,
                       ItemTemplate     = @LibraryNodeTemplate,
                       SelectedDataItem = $SelectedNode,
                       SelectionMode    = Single ]
            TextBlock [ Style = @BodyMedium, Text = "No published libraries yet.",
                        Foreground = @OnSurfaceVariant, TextWrapping = Wrap,
                        Visibility = $IsEmpty << ToVisibility ]
        }
    }
}
